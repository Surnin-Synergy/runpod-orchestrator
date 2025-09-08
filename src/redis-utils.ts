import { Redis } from 'ioredis';
import { JobRecord, RunpodTaskStatus, LockResult } from './types';
import { createRedisKeys, DEFAULT_CONFIG } from './constants';

export class RedisUtils {
  private redisKeys: ReturnType<typeof createRedisKeys>;

  constructor(
    public redis: Redis,
    private namespace: string = DEFAULT_CONFIG.namespace
  ) {
    this.redisKeys = createRedisKeys(namespace);
  }

  // Job hash operations
  async createJob(job: JobRecord): Promise<boolean> {
    const key = this.redisKeys.job(job.clientJobId);
    const fields = this.jobToHash(job);
    
    // Use HSETNX to prevent race conditions
    const pipeline = this.redis.pipeline();
    pipeline.hsetnx(key, 'clientJobId', job.clientJobId);
    
    // Only call hmset if there are fields to set
    if (Object.keys(fields).length > 0) {
      pipeline.hmset(key, fields);
    }
    
    const results = await pipeline.exec();
    return results?.[0]?.[1] === 1; // First command (HSETNX) succeeded
  }

  async updateJob(clientJobId: string, updates: Partial<JobRecord>): Promise<void> {
    const key = this.redisKeys.job(clientJobId);
    const fields = this.jobToHash(updates);
    
    // Only call hmset if there are fields to update
    if (Object.keys(fields).length > 0) {
      await this.redis.hmset(key, fields);
    }
    await this.redis.hset(key, 'updatedAt', Date.now());
  }

  async getJob(clientJobId: string): Promise<JobRecord | null> {
    const key = this.redisKeys.job(clientJobId);
    const hash = await this.redis.hgetall(key);
    
    if (!hash.clientJobId) {
      return null;
    }
    
    return this.hashToJob(hash);
  }

  async deleteJob(clientJobId: string): Promise<void> {
    const key = this.redisKeys.job(clientJobId);
    await this.redis.del(key);
  }

  // Pending queue operations
  async addToPending(clientJobId: string, nextPollAt: number): Promise<void> {
    await this.redis.zadd(this.redisKeys.pending, nextPollAt, clientJobId);
  }

  async removeFromPending(clientJobId: string): Promise<void> {
    await this.redis.zrem(this.redisKeys.pending, clientJobId);
  }

  async getPendingJobs(limit: number = DEFAULT_CONFIG.polling.batchSize): Promise<string[]> {
    const now = Date.now();
    return await this.redis.zrangebyscore(
      this.redisKeys.pending,
      '-inf',
      now,
      'LIMIT',
      0,
      limit
    );
  }

  // Lock operations
  async acquireLock(clientJobId: string, instanceId: string): Promise<LockResult> {
    const lockKey = this.redisKeys.lock(clientJobId);
    const token = `${instanceId}:${Date.now()}:${Math.random()}`;
    const leaseMs = DEFAULT_CONFIG.lockLeaseMs;
    
    const result = await this.redis.set(
      lockKey,
      token,
      'PX',
      leaseMs,
      'NX'
    );
    
    if (result === 'OK') {
      // Update job with lock info
      await this.updateJob(clientJobId, {
        ownerInstanceId: instanceId,
        lockUntil: Date.now() + leaseMs
      });
      
      return { success: true, token };
    }
    
    return { success: false };
  }

  async renewLock(clientJobId: string, token: string): Promise<boolean> {
    const lockKey = this.redisKeys.lock(clientJobId);
    const leaseMs = DEFAULT_CONFIG.lockLeaseMs;
    
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        redis.call("PEXPIRE", KEYS[1], ARGV[2])
        return 1
      else
        return 0
      end
    `;
    
    const result = await this.redis.eval(script, 1, lockKey, token, leaseMs);
    return result === 1;
  }

  async releaseLock(clientJobId: string, token: string): Promise<void> {
    const lockKey = this.redisKeys.lock(clientJobId);
    
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        redis.call("DEL", KEYS[1])
        return 1
      else
        return 0
      end
    `;
    
    await this.redis.eval(script, 1, lockKey, token);
    
    // Clear lock info from job
    await this.updateJob(clientJobId, {
      ownerInstanceId: null,
      lockUntil: null
    });
  }

  // Event publishing
  async publishEvent(event: string, payload: any): Promise<void> {
    await this.redis.publish(this.redisKeys.events, JSON.stringify({ event, payload }));
  }

  // Input hash deduplication
  async setInputHashIndex(hash: string, clientJobId: string): Promise<void> {
    const key = this.redisKeys.inputHashIndex(hash);
    await this.redis.set(key, clientJobId);
  }

  async getInputHashIndex(hash: string): Promise<string | null> {
    const key = this.redisKeys.inputHashIndex(hash);
    return await this.redis.get(key);
  }

  // Recovery operations
  async getAllNonTerminalJobs(): Promise<JobRecord[]> {
    const pattern = this.redisKeys.job('*');
    const keys = await this.redis.keys(pattern);
    
    if (keys.length === 0) {
      return [];
    }
    
    const pipeline = this.redis.pipeline();
    keys.forEach(key => pipeline.hgetall(key));
    
    const results = await pipeline.exec();
    const jobs: JobRecord[] = [];
    
    results?.forEach((result, index) => {
      if (result?.[1] && typeof result[1] === 'object') {
        const hash = result[1] as Record<string, string>;
        if (hash.clientJobId && !TERMINAL_STATUSES.includes(hash.status as RunpodTaskStatus)) {
          jobs.push(this.hashToJob(hash));
        }
      }
    });
    
    return jobs;
  }

  // Atomic state transition
  async transitionJobState(
    clientJobId: string, 
    fromStatus: RunpodTaskStatus, 
    toStatus: RunpodTaskStatus,
    updates: Partial<JobRecord> = {}
  ): Promise<boolean> {
    const key = this.redisKeys.job(clientJobId);
    
    const script = `
      local current = redis.call("HGET", KEYS[1], "status")
      if current == ARGV[1] then
        local fieldCount = #ARGV - 2
        if fieldCount > 0 then
          redis.call("HMSET", KEYS[1], unpack(ARGV, 2, #ARGV - 1))
        end
        redis.call("HSET", KEYS[1], "updatedAt", ARGV[#ARGV])
        return 1
      else
        return 0
      end
    `;
    
    const fields = this.jobToHash({ ...updates, status: toStatus });
    const args = [fromStatus, ...Object.entries(fields).flat(), Date.now().toString()];
    
    const result = await this.redis.eval(script, 1, key, ...args);
    return result === 1;
  }

  // Utility methods
  getJobKey(clientJobId: string): string {
    return this.redisKeys.job(clientJobId);
  }

  private jobToHash(job: Partial<JobRecord>): Record<string, string> {
    const hash: Record<string, string> = {};
    
    Object.entries(job).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        if (typeof value === 'object') {
          hash[key] = JSON.stringify(value);
        } else {
          hash[key] = String(value);
        }
      }
    });
    
    return hash;
  }

  private hashToJob(hash: Record<string, string>): JobRecord {
    const job: JobRecord = {
      clientJobId: hash.clientJobId,
      runpodJobId: hash.runpodJobId || null,
      status: hash.status as RunpodTaskStatus,
      output: hash.output ? JSON.parse(hash.output) : undefined,
      error: hash.error ? JSON.parse(hash.error) : undefined,
      createdAt: parseInt(hash.createdAt) || 0,
      updatedAt: parseInt(hash.updatedAt) || 0,
      attempt: parseInt(hash.attempt) || 0,
      nextPollAt: parseInt(hash.nextPollAt) || 0,
      pollBackoffMs: parseInt(hash.pollBackoffMs) || 0,
      ownerInstanceId: hash.ownerInstanceId || null,
      lockUntil: hash.lockUntil ? parseInt(hash.lockUntil) : null,
      endpointId: hash.endpointId,
      input: hash.input,
      inputHash: hash.inputHash,
      metadata: hash.metadata ? JSON.parse(hash.metadata) : undefined,
    };
    
    return job;
  }
}

// Import TERMINAL_STATUSES from constants
import { TERMINAL_STATUSES } from './constants';
