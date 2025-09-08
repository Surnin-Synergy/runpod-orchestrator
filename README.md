# Runpod Task Orchestrator

A Redis-backed, multi-instance task orchestrator for Runpod Serverless that guarantees terminal outcomes even across crashes and restarts.

## Features

- **Multi-instance safe**: Run multiple instances in parallel with distributed coordination
- **Persistent state**: All job state stored in Redis with atomic transitions
- **Idempotent operations**: Safe to retry with same `clientJobId`
- **Automatic recovery**: Recovers orphaned jobs on startup
- **Exponential backoff**: Intelligent retry strategy with jitter
- **Event-driven**: Real-time progress updates via EventEmitter
- **Metadata support**: Pass additional data with jobs for analytics and user tracking
- **TypeScript support**: Full type definitions included

## Installation

```bash
npm install @surninsynergy/runpod-orchestrator ioredis
```

## Quick Start

```typescript
import { createOrchestrator } from '@surninsynergy/runpod-orchestrator';

const orchestrator = await createOrchestrator({
  redis: { url: process.env.REDIS_URL },
  runpod: { 
    apiKey: process.env.RUNPOD_API_KEY!,
    endpointId: process.env.RUNPOD_ENDPOINT_ID!
  },
  dedupe: { enable: true, useInputHash: true },
});

// Listen for events
orchestrator.on('completed', ({ clientJobId, output, metadata }) => {
  console.log('Job completed:', clientJobId, output);
  if (metadata?.userId) {
    console.log('User:', metadata.userId);
  }
});

orchestrator.on('failed', ({ clientJobId, error, status, metadata }) => {
  console.error('Job failed:', clientJobId, error, status);
  if (metadata?.userId) {
    console.log('User:', metadata.userId);
  }
});

// Submit a job with metadata
const { clientJobId } = await orchestrator.submit({
  clientJobId: crypto.randomUUID(),
  input: { prompt: "A cat in space" },
  inputHash: "sha256:...", // optional for deduplication
  metadata: {
    userId: "user-123",
    priority: "high",
    source: "web-app"
  }
});

// Wait for result
const result = await orchestrator.awaitResult(clientJobId, 15 * 60_000);
if (result.status === "COMPLETED") {
  console.log('Result:', result.output);
  console.log('User:', result.metadata?.userId);
} else {
  console.error('Failed:', result.error);
}
```

## Custom Namespace

You can customize the Redis key namespace to avoid conflicts with other applications:

```typescript
const orchestrator = await createOrchestrator({
  redis: { url: process.env.REDIS_URL },
  runpod: { 
    apiKey: process.env.RUNPOD_API_KEY!,
    endpointId: process.env.RUNPOD_ENDPOINT_ID!
  },
  namespace: "myapp:runpod:", // Custom namespace
});
```

This will use keys like `myapp:runpod:job:<clientJobId>` instead of the default `runpod:job:<clientJobId>`.

## Configuration

```typescript
interface RunpodOrchestratorConfig {
  instanceId?: string;                 // unique per process; default = hostname:pid:random
  redis: { url?: string } | { client: import("ioredis").Redis };
  runpod: { apiKey: string; endpointId: string };
  namespace?: string;                  // Redis key namespace; default = "runpod:"
  polling: {
    enableStreaming?: boolean;         // try stream() if supported
    initialBackoffMs?: number;         // default 2000
    maxBackoffMs?: number;             // default 10000
    jitterPct?: number;                // default 0.2
    batchSize?: number;                // default 100
  };
  storage: {
    persistInput?: boolean;            // store original input JSON in Redis
    resultTtlSec?: number;             // TTL for terminal jobs (default 7 days)
  };
  dedupe?: { enable?: boolean; useInputHash?: boolean };
  logging?: { debug?: (...args: any[]) => void; info?: (...args: any[]) => void; error?: (...args: any[]) => void };
}
```

## API Reference

### `submit(options: SubmitOptions)`

Submit a new job to the orchestrator.

```typescript
interface SubmitOptions {
  clientJobId: string;                 // caller-generated UUID
  input: unknown;                      // Runpod endpoint input
  inputHash?: string;                  // optional dedupe key
  metadata?: Record<string, any>;      // optional additional data
}
```

**Returns:** `Promise<{ clientJobId: string; runpodJobId: string }>`

### `awaitResult(clientJobId: string, timeoutMs?: number)`

Wait for a job to complete with optional timeout.

**Returns:** `Promise<{ status: "COMPLETED"|"FAILED"|"TIMED_OUT"|"CANCELED"; output?: any; error?: any; metadata?: Record<string, any> }>`

### `get(clientJobId: string)`

Get current job status and details.

**Returns:** `Promise<JobRecord | null>`

### `cancel(clientJobId: string)`

Cancel a running job.

**Returns:** `Promise<void>`

### `recoverAllPending()`

Recover all non-terminal jobs (useful on startup).

**Returns:** `Promise<number>` (number of recovered jobs)

### Events

```typescript
orchestrator.on('submitted', ({ clientJobId, runpodJobId, metadata }) => {});
orchestrator.on('progress', ({ clientJobId, status, metrics, metadata }) => {});
orchestrator.on('completed', ({ clientJobId, output, metadata }) => {});
orchestrator.on('failed', ({ clientJobId, error, status, metadata }) => {});
```

## Metadata Support

The orchestrator supports passing additional metadata with jobs, which is useful for:

- **User tracking**: Associate jobs with specific users
- **Analytics**: Track campaigns, experiments, or business metrics
- **Debugging**: Include debugging information or request context
- **Business logic**: Pass business context through the job lifecycle

### Using Metadata

```typescript
// Submit job with metadata
const job = await orchestrator.submit({
  clientJobId: 'job-123',
  input: { prompt: 'Generate an image' },
  metadata: {
    userId: 'user-123',
    priority: 'high',
    source: 'web-app',
    analytics: {
      campaign: 'summer-promo',
      experiment: 'A',
      sessionId: 'sess-456'
    }
  }
});

// Metadata is available in all events
orchestrator.on('completed', ({ clientJobId, output, metadata }) => {
  console.log(`Job ${clientJobId} completed for user ${metadata?.userId}`);
  
  // Send result to user via WebSocket or API
  if (metadata?.userId) {
    sendToUser(metadata.userId, { jobId: clientJobId, result: output });
  }
  
  // Track analytics
  if (metadata?.analytics) {
    trackEvent('job_completed', metadata.analytics);
  }
});

// Metadata is available in results
const result = await orchestrator.awaitResult(job.clientJobId);
console.log('User ID:', result.metadata?.userId);
console.log('Campaign:', result.metadata?.analytics?.campaign);
```

### Metadata Best Practices

- **Keep it small**: Metadata is stored in Redis, so avoid large objects
- **Use consistent structure**: Define a schema for your metadata
- **Include user context**: Always include `userId` for user-facing applications
- **Add debugging info**: Include request IDs, session IDs, or trace IDs
- **Consider privacy**: Don't store sensitive data in metadata

## Job States

- `SUBMITTED` - Accepted locally, not yet on Runpod
- `QUEUED` - Runpod accepted, waiting to start
- `IN_PROGRESS` - Currently executing
- `COMPLETED` - Successfully finished (terminal)
- `FAILED` - Failed with error (terminal)
- `TIMED_OUT` - Exceeded timeout (terminal)
- `CANCELED` - Canceled by user (terminal)

## Multi-Instance Deployment

The orchestrator is designed to run multiple instances safely:

1. **Distributed locks** prevent duplicate processing
2. **Work sharding** via Redis sorted sets
3. **Automatic recovery** of orphaned jobs
4. **Cross-instance events** via Redis Pub/Sub

```bash
# Start multiple instances
NODE_ENV=production node app.js &
NODE_ENV=production node app.js &
NODE_ENV=production node app.js &
```

## Redis Schema

The orchestrator uses the following Redis keys (with configurable namespace):

- `<namespace>job:<clientJobId>` - Job hash with all metadata
- `<namespace>pending` - Sorted set of jobs to poll (score = nextPollAt)
- `<namespace>locks:<clientJobId>` - Distributed lock token
- `<namespace>events` - Pub/Sub channel for cross-instance events
- `<namespace>index:inputHash:<hash>` - Input hash deduplication index

By default, `<namespace>` is `"runpod:"`, but you can customize it via the `namespace` configuration option.

## Error Handling

The orchestrator handles various error scenarios:

- **Transient errors**: Network issues, 5xx responses, rate limits
- **Permanent errors**: 4xx responses, invalid input, authentication
- **Lock timeouts**: Automatic recovery by other instances
- **Process crashes**: Jobs recovered on restart

## Monitoring

Use the logging hooks to integrate with your monitoring system:

```typescript
const orchestrator = await createOrchestrator({
  // ... config
  logging: {
    debug: (msg, ...args) => console.debug(`[DEBUG] ${msg}`, ...args),
    info: (msg, ...args) => console.info(`[INFO] ${msg}`, ...args),
    error: (msg, ...args) => console.error(`[ERROR] ${msg}`, ...args),
  }
});
```

## Development

### Local Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build
npm run build

# Lint
npm run lint
```

### Docker Development

```bash
# Start Redis and run the basic example
docker-compose up

# Run in detached mode
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Rebuild and run
docker-compose up --build
```

The docker-compose setup includes:
- **Redis**: Redis 7 with persistence enabled
- **Orchestrator**: Runs the basic usage example with environment variables from `.env`

Make sure to create a `.env` file with your Runpod credentials:
```bash
RUNPOD_API_KEY=your_api_key_here
RUNPOD_ENDPOINT_ID=your_endpoint_id_here
```

## License

MIT
