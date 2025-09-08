import { RunpodClient } from '../runpod-client';

// Mock fetch
global.fetch = jest.fn();

describe('RunpodClient', () => {
  let client: RunpodClient;
  const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    client = new RunpodClient('test-api-key', 'test-endpoint-id');
    mockFetch.mockClear();
  });

  describe('run', () => {
    it('should submit job successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ id: 'runpod-123' }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.run({ prompt: 'test' });

      expect(result).toEqual({ id: 'runpod-123' });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.runpod.io/v2/test-endpoint-id/run',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({ input: { prompt: 'test' } }),
        })
      );
    });

    it('should handle API errors', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ 
          errors: [{ message: 'Invalid input' }] 
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await expect(client.run({ prompt: 'test' })).rejects.toThrow('Runpod run error: Invalid input');
    });

    it('should handle HTTP errors', async () => {
      const mockResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await expect(client.run({ prompt: 'test' })).rejects.toThrow('Runpod run failed: 400 Bad Request');
    });
  });

  describe('status', () => {
    it('should get job status successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({ 
          status: 'IN_PROGRESS',
          output: null,
          error: null,
          metrics: { gpu_util: 50 }
        }),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.status('runpod-123');

      expect(result).toEqual({
        id: 'runpod-123',
        status: 'IN_PROGRESS',
        output: null,
        error: null,
        metrics: { gpu_util: 50 }
      });
    });

    it('should handle 404 as NOT_FOUND', async () => {
      const mockResponse = {
        ok: false,
        status: 404,
        statusText: 'Not Found',
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      const result = await client.status('runpod-123');

      expect(result).toEqual({
        id: 'runpod-123',
        status: 'NOT_FOUND',
        error: 'Job not found or expired'
      });
    });
  });

  describe('cancel', () => {
    it('should cancel job successfully', async () => {
      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({}),
      };
      mockFetch.mockResolvedValue(mockResponse as any);

      await client.cancel('runpod-123');

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.runpod.io/v2/test-endpoint-id/cancel/runpod-123',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
          }),
        })
      );
    });
  });

  describe('mapRunpodStatus', () => {
    it('should map Runpod statuses correctly', () => {
      expect(client.mapRunpodStatus('IN_QUEUE')).toBe('QUEUED');
      expect(client.mapRunpodStatus('IN_PROGRESS')).toBe('IN_PROGRESS');
      expect(client.mapRunpodStatus('COMPLETED')).toBe('COMPLETED');
      expect(client.mapRunpodStatus('FAILED')).toBe('FAILED');
      expect(client.mapRunpodStatus('CANCELLED')).toBe('CANCELED');
      expect(client.mapRunpodStatus('TIMED_OUT')).toBe('TIMED_OUT');
      expect(client.mapRunpodStatus('UNKNOWN')).toBe('FAILED');
    });
  });

  describe('isTransientError', () => {
    it('should identify transient errors', () => {
      expect(client.isTransientError(new Error('Network error'))).toBe(true);
      expect(client.isTransientError(new Error('Timeout'))).toBe(true);
      expect(client.isTransientError(new Error('ECONNRESET'))).toBe(true);
      expect(client.isTransientError(new Error('500 Internal Server Error'))).toBe(true);
      expect(client.isTransientError(new Error('502 Bad Gateway'))).toBe(true);
      expect(client.isTransientError(new Error('503 Service Unavailable'))).toBe(true);
      expect(client.isTransientError(new Error('504 Gateway Timeout'))).toBe(true);
      expect(client.isTransientError(new Error('429 Too Many Requests'))).toBe(true);
    });

    it('should identify non-transient errors', () => {
      expect(client.isTransientError(new Error('400 Bad Request'))).toBe(false);
      expect(client.isTransientError(new Error('401 Unauthorized'))).toBe(false);
      expect(client.isTransientError(new Error('403 Forbidden'))).toBe(false);
      expect(client.isTransientError(new Error('Invalid input'))).toBe(false);
    });
  });
});
