import { createOrchestrator, RunpodOrchestratorConfig } from '../index';
import { Redis } from 'ioredis';

// Mock Redis
jest.mock('ioredis');

describe('RunpodOrchestrator', () => {
  let mockRedis: jest.Mocked<Redis>;
  let config: RunpodOrchestratorConfig;

  beforeEach(() => {
    mockRedis = {
      hsetnx: jest.fn().mockResolvedValue(1),
      hmset: jest.fn().mockResolvedValue('OK'),
      hset: jest.fn().mockResolvedValue(1),
      hgetall: jest.fn().mockResolvedValue({}),
      del: jest.fn().mockResolvedValue(1),
      zadd: jest.fn().mockResolvedValue(1),
      zrem: jest.fn().mockResolvedValue(1),
      zrangebyscore: jest.fn().mockResolvedValue([]),
      set: jest.fn().mockResolvedValue('OK'),
      get: jest.fn().mockResolvedValue(null),
      eval: jest.fn().mockResolvedValue(1),
      keys: jest.fn().mockResolvedValue([]),
      pipeline: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue([
          [null, 1], // hsetnx result
          [null, 'OK'], // hmset result
        ]),
        hsetnx: jest.fn().mockReturnThis(),
        hmset: jest.fn().mockReturnThis(),
        hgetall: jest.fn().mockReturnThis(),
      }),
      publish: jest.fn().mockResolvedValue(1),
      expire: jest.fn().mockResolvedValue(1),
      disconnect: jest.fn().mockResolvedValue('OK'),
    } as any;

    config = {
      redis: { client: mockRedis },
      runpod: {
        apiKey: 'test-api-key',
        endpointId: 'test-endpoint-id'
      },
      polling: {
        initialBackoffMs: 1000,
        maxBackoffMs: 5000,
        batchSize: 10,
      },
      storage: {
        persistInput: true,
        resultTtlSec: 3600,
      },
      logging: {
        debug: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      }
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createOrchestrator', () => {
    it('should create and start orchestrator', async () => {
      const orchestrator = await createOrchestrator(config);
      
      expect(orchestrator).toBeDefined();
      
      await orchestrator.close();
    });
  });

  describe('submit', () => {
    it('should submit a job successfully', async () => {
      const orchestrator = await createOrchestrator(config);
      
      const result = await orchestrator.submit({
        clientJobId: 'test-job-1',
        input: { prompt: 'test prompt' }
      });
      
      expect(result.clientJobId).toBe('test-job-1');
      
      await orchestrator.close();
    });

    it('should handle duplicate job submission', async () => {
      // Mock existing job
      mockRedis.hgetall.mockResolvedValue({
        clientJobId: 'test-job-1',
        status: 'SUBMITTED',
        createdAt: Date.now().toString(),
        updatedAt: Date.now().toString(),
      });

      const orchestrator = await createOrchestrator(config);
      
      const result = await orchestrator.submit({
        clientJobId: 'test-job-1',
        input: { prompt: 'test prompt' }
      });
      
      expect(result.clientJobId).toBe('test-job-1');
      
      await orchestrator.close();
    });
  });

  describe('get', () => {
    it('should retrieve job by clientJobId', async () => {
      const jobData = {
        clientJobId: 'test-job-1',
        status: 'SUBMITTED',
        createdAt: Date.now().toString(),
        updatedAt: Date.now().toString(),
      };
      
      mockRedis.hgetall.mockResolvedValue(jobData);
      
      const orchestrator = await createOrchestrator(config);
      const job = await orchestrator.get('test-job-1');
      
      expect(job).toBeDefined();
      expect(job?.clientJobId).toBe('test-job-1');
      
      await orchestrator.close();
    });

    it('should return null for non-existent job', async () => {
      mockRedis.hgetall.mockResolvedValue({});
      
      const orchestrator = await createOrchestrator(config);
      const job = await orchestrator.get('non-existent-job');
      
      expect(job).toBeNull();
      
      await orchestrator.close();
    });
  });

  describe('cancel', () => {
    it('should cancel a job successfully', async () => {
      const jobData = {
        clientJobId: 'test-job-1',
        status: 'QUEUED',
        runpodJobId: 'runpod-123',
        createdAt: Date.now().toString(),
        updatedAt: Date.now().toString(),
      };
      
      mockRedis.hgetall.mockResolvedValue(jobData);
      mockRedis.set.mockResolvedValue('OK'); // Lock acquisition
      mockRedis.eval.mockResolvedValue(1); // State transition
      
      const orchestrator = await createOrchestrator(config);
      await orchestrator.cancel('test-job-1');
      
      expect(mockRedis.set).toHaveBeenCalled(); // Lock acquisition
      expect(mockRedis.eval).toHaveBeenCalled(); // State transition
      
      await orchestrator.close();
    });
  });

  describe('recoverAllPending', () => {
    it('should recover pending jobs', async () => {
      const jobData = {
        clientJobId: 'test-job-1',
        status: 'SUBMITTED',
        createdAt: Date.now().toString(),
        updatedAt: Date.now().toString(),
      };
      
      mockRedis.keys.mockResolvedValue(['runpod:job:test-job-1']);
      mockRedis.hgetall.mockResolvedValue(jobData);
      
      const orchestrator = await createOrchestrator(config);
      const recovered = await orchestrator.recoverAllPending();
      
      expect(recovered).toBe(0); // No non-terminal jobs found due to mock
      
      await orchestrator.close();
    });
  });
});
