import { EventEmitter } from 'events';
import { Redis } from 'ioredis';
import { RedisUtils } from './redis-utils';
import { RunpodOrchestratorConfig } from './types';
import { DEFAULT_CONFIG } from './constants';

export interface OrchestratorInstance {
  endpointId: string;
  instanceId: string;
  processJob: (clientJobId: string) => Promise<void>;
  isHealthy: () => boolean;
}

export class CentralDispatcher<TMetadata = Record<string, any>> extends EventEmitter {
  private redisUtils: RedisUtils<TMetadata>;
  private orchestrators: Map<string, OrchestratorInstance> = new Map();
  private isRunning: boolean = false;
  private pollingInterval?: NodeJS.Timeout;
  private config: RunpodOrchestratorConfig;

  constructor(
    redis: Redis,
    config: RunpodOrchestratorConfig
  ) {
    super();
    this.redisUtils = new RedisUtils<TMetadata>(redis, config.namespace);
    this.config = config;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.log('info', 'Starting central dispatcher polling loop');
    
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
    
    this.log('info', 'Central dispatcher stopped');
  }

  registerOrchestrator(orchestrator: OrchestratorInstance): void {
    this.orchestrators.set(orchestrator.endpointId, orchestrator);
    this.log('info', `Registered orchestrator for endpoint: ${orchestrator.endpointId}`);
  }

  unregisterOrchestrator(endpointId: string): void {
    this.orchestrators.delete(endpointId);
    this.log('info', `Unregistered orchestrator for endpoint: ${endpointId}`);
  }

  private async pollingLoop(): Promise<void> {
    try {
      const pendingJobs = await this.redisUtils.getPendingJobs(
        this.config.polling.batchSize || 100
      );
      
      for (const clientJobId of pendingJobs) {
        await this.routeJob(clientJobId);
      }
    } catch (error) {
      this.log('error', 'Error in dispatcher polling loop:', error);
    }
  }

  private async routeJob(clientJobId: string): Promise<void> {
    try {
      // Get job details
      const job = await this.redisUtils.getJob(clientJobId);
      if (!job) {
        this.log('warn', `Job ${clientJobId} not found in Redis`);
        return;
      }

      // Check if we have an orchestrator for this endpoint
      const orchestrator = this.orchestrators.get(job.endpointId || '');
      if (!orchestrator) {
        this.log('warn', `No orchestrator registered for endpoint: ${job.endpointId}`);
        return;
      }

      // Check if orchestrator is healthy
      if (!orchestrator.isHealthy()) {
        this.log('warn', `Orchestrator for endpoint ${job.endpointId} is not healthy`);
        return;
      }

      // Route job to the correct orchestrator
      this.log('debug', `Routing job ${clientJobId} to orchestrator for endpoint: ${job.endpointId}`);
      await orchestrator.processJob(clientJobId);

    } catch (error) {
      this.log('error', `Error routing job ${clientJobId}:`, error);
    }
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
    if (level === 'warn') {
      // Use error logger for warn level
      const logger = this.config.logging?.error;
      if (logger) {
        logger(`[Dispatcher] ${message}`, ...args);
      }
    } else {
      const logger = this.config.logging?.[level];
      if (logger) {
        logger(`[Dispatcher] ${message}`, ...args);
      }
    }
  }
}
