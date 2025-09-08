import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { RedisUtils } from './redis-utils';
import { RunpodClient } from './runpod-client';
import { Coordinator } from './coordinator';
import { 
  RunpodOrchestrator, 
  RunpodOrchestratorConfig, 
  SubmitOptions, 
  JobRecord,
  OrchestratorEvents 
} from './types';
import { DEFAULT_CONFIG, TERMINAL_STATUSES } from './constants';

export class RunpodOrchestratorImpl extends EventEmitter implements RunpodOrchestrator {
  private redis: Redis;
  private redisUtils: RedisUtils;
  private runpodClient: RunpodClient;
  private coordinator: Coordinator;
  private config: RunpodOrchestratorConfig;
  private isStarted: boolean = false;

  constructor(config: RunpodOrchestratorConfig) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize Redis connection
    if ('client' in config.redis) {
      this.redis = config.redis.client;
    } else {
      const Redis = require('ioredis');
      this.redis = new Redis(config.redis.url || 'redis://localhost:6379');
    }
    
    this.redisUtils = new RedisUtils(this.redis, 'runpod:');
    this.runpodClient = new RunpodClient(
      config.runpod.apiKey,
      config.runpod.endpointId
    );
    this.coordinator = new Coordinator(this.redis, this.runpodClient, this.config);
    
    // Forward events from coordinator
    this.coordinator.on('submitted', (payload) => this.emit('submitted', payload));
    this.coordinator.on('progress', (payload) => this.emit('progress', payload));
    this.coordinator.on('completed', (payload) => this.emit('completed', payload));
    this.coordinator.on('failed', (payload) => this.emit('failed', payload));
  }

  async start(): Promise<void> {
    if (this.isStarted) {
      return;
    }
    
    await this.coordinator.start();
    this.isStarted = true;
    this.log('info', 'Orchestrator started');
  }

  async submit(opts: SubmitOptions): Promise<{ clientJobId: string; runpodJobId: string }> {
    const { clientJobId, input, inputHash } = opts;
    
    // Check for existing job (idempotency)
    const existingJob = await this.redisUtils.getJob(clientJobId);
    if (existingJob) {
      this.log('info', `Job ${clientJobId} already exists, returning existing job`);
      return {
        clientJobId,
        runpodJobId: existingJob.runpodJobId || ''
      };
    }
    
    // Check for input hash deduplication
    if (this.config.dedupe?.enable && this.config.dedupe?.useInputHash && inputHash) {
      const existingClientJobId = await this.redisUtils.getInputHashIndex(inputHash);
      if (existingClientJobId) {
        const existingJob = await this.redisUtils.getJob(existingClientJobId);
        if (existingJob && TERMINAL_STATUSES.includes(existingJob.status)) {
          this.log('info', `Found existing job with same input hash: ${existingClientJobId}`);
          return {
            clientJobId: existingClientJobId,
            runpodJobId: existingJob.runpodJobId || ''
          };
        }
      }
    }
    
    // Create job record
    const job: JobRecord = {
      clientJobId,
      runpodJobId: null,
      status: 'SUBMITTED',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      attempt: 0,
      nextPollAt: Date.now(),
      pollBackoffMs: 0,
      ownerInstanceId: null,
      lockUntil: null,
      endpointId: this.config.runpod.endpointId,
      input: this.config.storage.persistInput ? JSON.stringify(input) : undefined,
      inputHash,
    };
    
    // Create job in Redis
    const created = await this.redisUtils.createJob(job);
    if (!created) {
      // Job already exists (race condition)
      const existingJob = await this.redisUtils.getJob(clientJobId);
      if (existingJob) {
        return {
          clientJobId,
          runpodJobId: existingJob.runpodJobId || ''
        };
      }
      throw new Error('Failed to create job');
    }
    
    // Set input hash index for deduplication
    if (this.config.dedupe?.enable && this.config.dedupe?.useInputHash && inputHash) {
      await this.redisUtils.setInputHashIndex(inputHash, clientJobId);
    }
    
    // Add to pending queue for processing
    await this.redisUtils.addToPending(clientJobId, Date.now());
    
    this.log('info', `Job ${clientJobId} submitted`);
    
    return {
      clientJobId,
      runpodJobId: '' // Will be set when actually submitted to Runpod
    };
  }

  async awaitResult(
    clientJobId: string, 
    timeoutMs: number = 15 * 60 * 1000
  ): Promise<{ 
    status: "COMPLETED"|"FAILED"|"TIMED_OUT"|"CANCELED"; 
    output?: any; 
    error?: any;
  }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({
          status: 'TIMED_OUT',
          error: 'Operation timed out'
        });
      }, timeoutMs);
      
      const cleanup = () => {
        clearTimeout(timeout);
        this.off('completed', onCompleted);
        this.off('failed', onFailed);
      };
      
      const onCompleted = (payload: { clientJobId: string; output: any }) => {
        if (payload.clientJobId === clientJobId) {
          cleanup();
          resolve({
            status: 'COMPLETED',
            output: payload.output
          });
        }
      };
      
      const onFailed = (payload: { clientJobId: string; error: any; status: string }) => {
        if (payload.clientJobId === clientJobId) {
          cleanup();
          resolve({
            status: payload.status as "FAILED"|"TIMED_OUT"|"CANCELED",
            error: payload.error
          });
        }
      };
      
      // Check if job is already terminal
      this.get(clientJobId).then(job => {
        if (job && TERMINAL_STATUSES.includes(job.status)) {
          cleanup();
          if (job.status === 'COMPLETED') {
            resolve({
              status: 'COMPLETED',
              output: job.output
            });
          } else {
            resolve({
              status: job.status as "FAILED"|"TIMED_OUT"|"CANCELED",
              error: job.error
            });
          }
          return;
        }
        
        // Listen for events
        this.on('completed', onCompleted);
        this.on('failed', onFailed);
      }).catch(error => {
        cleanup();
        reject(error);
      });
    });
  }

  async get(clientJobId: string): Promise<JobRecord | null> {
    return await this.redisUtils.getJob(clientJobId);
  }

  async cancel(clientJobId: string): Promise<void> {
    const job = await this.redisUtils.getJob(clientJobId);
    if (!job) {
      throw new Error(`Job ${clientJobId} not found`);
    }
    
    if (TERMINAL_STATUSES.includes(job.status)) {
      this.log('info', `Job ${clientJobId} is already in terminal state: ${job.status}`);
      return;
    }
    
    // Try to acquire lock to cancel
    const lockResult = await this.redisUtils.acquireLock(clientJobId, this.coordinator['instanceId']);
    
    try {
      // Cancel on Runpod if job is active
      if (job.runpodJobId && (job.status === 'QUEUED' || job.status === 'IN_PROGRESS')) {
        try {
          await this.runpodClient.cancel(job.runpodJobId);
        } catch (error) {
          this.log('error', `Failed to cancel job on Runpod: ${error}`);
          // Continue with local cancellation
        }
      }
      
      // Transition to CANCELED
      const success = await this.redisUtils.transitionJobState(
        clientJobId,
        job.status,
        'CANCELED',
        {
          error: { message: 'Job canceled by user', type: 'CANCELED' }
        }
      );
      
      if (success) {
        // Remove from pending queue
        await this.redisUtils.removeFromPending(clientJobId);
        
        this.emit('failed', {
          clientJobId,
          error: 'Job canceled by user',
          status: 'CANCELED'
        });
        
        this.log('info', `Job ${clientJobId} canceled`);
      }
      
    } finally {
      if (lockResult.success) {
        await this.redisUtils.releaseLock(clientJobId, lockResult.token!);
      }
    }
  }

  async recoverAllPending(): Promise<number> {
    const nonTerminalJobs = await this.redisUtils.getAllNonTerminalJobs();
    let recovered = 0;
    
    for (const job of nonTerminalJobs) {
      try {
        // Add to pending queue with immediate polling
        await this.redisUtils.addToPending(job.clientJobId, Date.now());
        recovered++;
      } catch (error) {
        this.log('error', `Failed to recover job ${job.clientJobId}:`, error);
      }
    }
    
    this.log('info', `Recovered ${recovered} pending jobs`);
    return recovered;
  }

  async close(): Promise<void> {
    if (!this.isStarted) {
      return;
    }
    
    await this.coordinator.stop();
    await this.redis.disconnect();
    this.isStarted = false;
    this.log('info', 'Orchestrator closed');
  }

  private log(level: 'debug' | 'info' | 'error', message: string, ...args: any[]): void {
    const logger = this.config.logging?.[level];
    if (logger) {
      logger(`[Orchestrator] ${message}`, ...args);
    }
  }
}
