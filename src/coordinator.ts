import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { RedisUtils } from './redis-utils';
import { RunpodClient } from './runpod-client';
import { BackoffCalculator } from './backoff';
import { 
  JobRecord, 
  RunpodTaskStatus, 
  RunpodOrchestratorConfig,
  OrchestratorEvents 
} from './types';
import { TERMINAL_STATUSES, NON_TERMINAL_STATUSES } from './constants';

export class Coordinator extends EventEmitter {
  private redisUtils: RedisUtils;
  private runpodClient: RunpodClient;
  private backoffCalculator: BackoffCalculator;
  private instanceId: string;
  private isRunning: boolean = false;
  private pollingInterval?: NodeJS.Timeout;
  private config: RunpodOrchestratorConfig;

  constructor(
    redis: Redis,
    runpodClient: RunpodClient,
    config: RunpodOrchestratorConfig
  ) {
    super();
    this.redisUtils = new RedisUtils(redis, config.namespace);
    this.runpodClient = runpodClient;
    this.config = config;
    this.instanceId = config.instanceId || this.generateInstanceId();
    
    this.backoffCalculator = new BackoffCalculator({
      initialMs: config.polling.initialBackoffMs || 2000,
      maxMs: config.polling.maxBackoffMs || 10000,
      jitterPct: config.polling.jitterPct || 0.2,
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.log('info', 'Starting coordinator polling loop');
    
    // Start polling loop
    this.pollingInterval = setInterval(
      () => this.pollingLoop(),
      1000 // Fixed interval for polling loop
    );
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = undefined;
    }
    
    this.log('info', 'Coordinator stopped');
  }

  private async pollingLoop(): Promise<void> {
    try {
      const pendingJobs = await this.redisUtils.getPendingJobs(
        this.config.polling.batchSize || 100
      );
      
      for (const clientJobId of pendingJobs) {
        await this.processJob(clientJobId);
      }
    } catch (error) {
      this.log('error', 'Error in polling loop:', error);
    }
  }

  private async processJob(clientJobId: string): Promise<void> {
    try {
      // Try to acquire lock
      const lockResult = await this.redisUtils.acquireLock(clientJobId, this.instanceId);
      
      if (!lockResult.success) {
        // Another instance is processing this job
        return;
      }

      const job = await this.redisUtils.getJob(clientJobId);
      if (!job) {
        await this.redisUtils.releaseLock(clientJobId, lockResult.token!);
        return;
      }

      // Process the job based on its current status
      await this.processJobByStatus(job, lockResult.token!);
      
    } catch (error) {
      this.log('error', `Error processing job ${clientJobId}:`, error);
      // Release lock on error
      try {
        await this.redisUtils.releaseLock(clientJobId, '');
      } catch (releaseError) {
        this.log('error', `Error releasing lock for ${clientJobId}:`, releaseError);
      }
    }
  }

  private async processJobByStatus(job: JobRecord, lockToken: string): Promise<void> {
    switch (job.status) {
      case 'SUBMITTED':
        await this.handleSubmittedJob(job, lockToken);
        break;
      case 'QUEUED':
      case 'IN_PROGRESS':
        await this.handleActiveJob(job, lockToken);
        break;
      default:
        // Terminal state, clean up
        await this.cleanupTerminalJob(job, lockToken);
    }
  }

  private async handleSubmittedJob(job: JobRecord, lockToken: string): Promise<void> {
    try {
      // Parse input if it's a string (when persistInput is enabled)
      const input = typeof job.input === 'string' ? JSON.parse(job.input) : job.input;
      
      // Submit to Runpod
      const runpodResponse = await this.runpodClient.run(input);
      
      // Update job with Runpod ID and transition to QUEUED
      const success = await this.redisUtils.transitionJobState(
        job.clientJobId,
        'SUBMITTED',
        'QUEUED',
        {
          runpodJobId: runpodResponse.id,
          nextPollAt: Date.now() + this.backoffCalculator.calculate(0),
          pollBackoffMs: this.backoffCalculator.calculate(0),
        }
      );

      if (success) {
        // Add to pending queue for polling
        await this.redisUtils.addToPending(job.clientJobId, Date.now());
        
        // Emit event
        this.emit('submitted', {
          clientJobId: job.clientJobId,
          runpodJobId: runpodResponse.id,
          metadata: job.metadata
        });
        
        this.log('info', `Job ${job.clientJobId} submitted to Runpod: ${runpodResponse.id}`);
      }
      
    } catch (error) {
      this.log('error', `Failed to submit job ${job.clientJobId}:`, error);
      
      // Mark as failed
      await this.redisUtils.transitionJobState(
        job.clientJobId,
        'SUBMITTED',
        'FAILED',
        {
          error: {
            message: error instanceof Error ? error.message : String(error),
            type: 'SUBMISSION_ERROR'
          }
        }
      );
      
      this.emit('failed', {
        clientJobId: job.clientJobId,
        error: error instanceof Error ? error.message : String(error),
        status: 'FAILED',
        metadata: job.metadata
      });
    } finally {
      await this.redisUtils.releaseLock(job.clientJobId, lockToken);
    }
  }

  private async handleActiveJob(job: JobRecord, lockToken: string): Promise<void> {
    if (!job.runpodJobId) {
      this.log('error', `Job ${job.clientJobId} has no Runpod ID`);
      await this.redisUtils.releaseLock(job.clientJobId, lockToken);
      return;
    }

    try {
      // Check status with Runpod
      const runpodStatus = await this.runpodClient.status(job.runpodJobId);
      const mappedStatus = this.runpodClient.mapRunpodStatus(runpodStatus.status);
      
      // Handle different statuses
      if (TERMINAL_STATUSES.includes(mappedStatus as RunpodTaskStatus)) {
        await this.handleTerminalStatus(job, mappedStatus as RunpodTaskStatus, runpodStatus, lockToken);
      } else if (mappedStatus === 'IN_PROGRESS') {
        await this.handleInProgress(job, runpodStatus, lockToken);
      } else {
        // Still queued, schedule next poll
        await this.scheduleNextPoll(job, lockToken);
      }
      
    } catch (error) {
      this.log('error', `Error checking status for job ${job.clientJobId}:`, error);
      
      if (this.runpodClient.isTransientError(error as Error)) {
        // Transient error, schedule retry
        await this.scheduleNextPoll(job, lockToken, true);
      } else {
        // Permanent error, mark as failed
        await this.redisUtils.transitionJobState(
          job.clientJobId,
          job.status,
          'FAILED',
          {
            error: {
              message: error instanceof Error ? error.message : String(error),
              type: 'STATUS_CHECK_ERROR'
            }
          }
        );
        
        this.emit('failed', {
          clientJobId: job.clientJobId,
          error: error instanceof Error ? error.message : String(error),
          status: 'FAILED',
          metadata: job.metadata
        });
        
        await this.cleanupTerminalJob(job, lockToken);
      }
    }
  }

  private async handleTerminalStatus(
    job: JobRecord, 
    status: RunpodTaskStatus, 
    runpodStatus: any, 
    lockToken: string
  ): Promise<void> {
    const updates: Partial<JobRecord> = {
      status,
      output: runpodStatus.output,
      error: runpodStatus.error,
    };

    const success = await this.redisUtils.transitionJobState(
      job.clientJobId,
      job.status,
      status,
      updates
    );

    if (success) {
      // Remove from pending queue
      await this.redisUtils.removeFromPending(job.clientJobId);
      
      // Emit appropriate event
      if (status === 'COMPLETED') {
        this.emit('completed', {
          clientJobId: job.clientJobId,
          output: runpodStatus.output,
          metadata: job.metadata
        });
      } else {
        this.emit('failed', {
          clientJobId: job.clientJobId,
          error: runpodStatus.error || 'Unknown error',
          status,
          metadata: job.metadata
        });
      }
      
      this.log('info', `Job ${job.clientJobId} reached terminal state: ${status}`);
    }
    
    await this.redisUtils.releaseLock(job.clientJobId, lockToken);
  }

  private async handleInProgress(job: JobRecord, runpodStatus: any, lockToken: string): Promise<void> {
    // Update status to IN_PROGRESS if not already
    if (job.status !== 'IN_PROGRESS') {
      await this.redisUtils.transitionJobState(
        job.clientJobId,
        job.status,
        'IN_PROGRESS',
        {}
      );
    }
    
    // Emit progress event (throttled)
    this.emit('progress', {
      clientJobId: job.clientJobId,
      status: 'IN_PROGRESS',
      metrics: runpodStatus.metrics,
      metadata: job.metadata
    });
    
    // Schedule next poll
    await this.scheduleNextPoll(job, lockToken);
  }

  private async scheduleNextPoll(job: JobRecord, lockToken: string, isRetry: boolean = false): Promise<void> {
    const attempt = isRetry ? (job.attempt || 0) + 1 : (job.attempt || 0);
    const nextPollAt = this.backoffCalculator.getNextPollTime(attempt);
    const backoffMs = this.backoffCalculator.calculate(attempt);
    
    await this.redisUtils.updateJob(job.clientJobId, {
      attempt,
      nextPollAt,
      pollBackoffMs: backoffMs,
    });
    
    // Update pending queue
    await this.redisUtils.addToPending(job.clientJobId, nextPollAt);
    
    await this.redisUtils.releaseLock(job.clientJobId, lockToken);
  }

  private async cleanupTerminalJob(job: JobRecord, lockToken: string): Promise<void> {
    // Remove from pending queue
    await this.redisUtils.removeFromPending(job.clientJobId);
    
    // Set TTL for terminal jobs
    if (this.config.storage.resultTtlSec) {
      const key = this.redisUtils.getJobKey(job.clientJobId);
      await this.redisUtils.redis.expire(key, this.config.storage.resultTtlSec);
    }
    
    await this.redisUtils.releaseLock(job.clientJobId, lockToken);
  }

  private generateInstanceId(): string {
    const hostname = require('os').hostname();
    const pid = process.pid;
    const random = Math.random().toString(36).substring(2, 8);
    return `${hostname}:${pid}:${random}`;
  }

  private log(level: 'debug' | 'info' | 'error', message: string, ...args: any[]): void {
    const logger = this.config.logging?.[level];
    if (logger) {
      logger(`[${this.instanceId}] ${message}`, ...args);
    }
  }
}
