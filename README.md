# Runpod Task Orchestrator

A Redis-backed, multi-instance task orchestrator for Runpod Serverless that guarantees terminal outcomes even across crashes and restarts.

## Features

- **Multi-instance safe**: Run multiple instances in parallel with distributed coordination
- **Persistent state**: All job state stored in Redis with atomic transitions
- **Idempotent operations**: Safe to retry with same `clientJobId`
- **Automatic recovery**: Recovers orphaned jobs on startup
- **Exponential backoff**: Intelligent retry strategy with jitter
- **Event-driven**: Real-time progress updates via EventEmitter
- **TypeScript support**: Full type definitions included

## Installation

```bash
npm install @yourscope/runpod-orchestrator ioredis
```

## Quick Start

```typescript
import { createOrchestrator } from '@yourscope/runpod-orchestrator';

const orchestrator = await createOrchestrator({
  redis: { url: process.env.REDIS_URL },
  runpod: { 
    apiKey: process.env.RUNPOD_API_KEY!,
    endpointId: process.env.RUNPOD_ENDPOINT_ID!
  },
  dedupe: { enable: true, useInputHash: true },
});

// Listen for events
orchestrator.on('completed', ({ clientJobId, output }) => {
  console.log('Job completed:', clientJobId, output);
});

orchestrator.on('failed', ({ clientJobId, error, status }) => {
  console.error('Job failed:', clientJobId, error, status);
});

// Submit a job
const { clientJobId } = await orchestrator.submit({
  clientJobId: crypto.randomUUID(),
  input: { prompt: "A cat in space" },
  inputHash: "sha256:...", // optional for deduplication
});

// Wait for result
const result = await orchestrator.awaitResult(clientJobId, 15 * 60_000);
if (result.status === "COMPLETED") {
  console.log('Result:', result.output);
} else {
  console.error('Failed:', result.error);
}
```

## Configuration

```typescript
interface RunpodOrchestratorConfig {
  instanceId?: string;                 // unique per process; default = hostname:pid:random
  redis: { url?: string } | { client: import("ioredis").Redis };
  runpod: { apiKey: string; endpointId: string };
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
}
```

**Returns:** `Promise<{ clientJobId: string; runpodJobId: string }>`

### `awaitResult(clientJobId: string, timeoutMs?: number)`

Wait for a job to complete with optional timeout.

**Returns:** `Promise<{ status: "COMPLETED"|"FAILED"|"TIMED_OUT"|"CANCELED"; output?: any; error?: any }>`

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
orchestrator.on('submitted', ({ clientJobId, runpodJobId }) => {});
orchestrator.on('progress', ({ clientJobId, status, metrics }) => {});
orchestrator.on('completed', ({ clientJobId, output }) => {});
orchestrator.on('failed', ({ clientJobId, error, status }) => {});
```

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

The orchestrator uses the following Redis keys:

- `runpod:job:<clientJobId>` - Job hash with all metadata
- `runpod:pending` - Sorted set of jobs to poll (score = nextPollAt)
- `runpod:locks:<clientJobId>` - Distributed lock token
- `runpod:events` - Pub/Sub channel for cross-instance events
- `runpod:index:inputHash:<hash>` - Input hash deduplication index

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

## License

MIT
