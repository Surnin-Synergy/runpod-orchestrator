import { RunpodTaskStatus } from "./types";

export const DEFAULT_CONFIG = {
  polling: {
    enableStreaming: false,
    initialBackoffMs: 2000,
    maxBackoffMs: 10000,
    jitterPct: 0.2,
    batchSize: 100,
  },
  storage: {
    persistInput: true,
    resultTtlSec: 604800, // 7 days
  },
  dedupe: {
    enable: false,
    useInputHash: false,
  },
  namespace: "runpod:",
  lockLeaseMs: 10000, // 10 seconds
  lockRenewMs: 5000, // 5 seconds
  maxRetries: 3,
  statusCheckIntervalMs: 1000,
} as const;

export const REDIS_KEYS = {
  job: (clientJobId: string) => `runpod:job:${clientJobId}`,
  pending: "runpod:pending",
  lock: (clientJobId: string) => `runpod:locks:${clientJobId}`,
  events: "runpod:events",
  inputHashIndex: (hash: string) => `runpod:index:inputHash:${hash}`,
} as const;

export const RUNPOD_STATUS_MAP = {
  IN_QUEUE: "QUEUED",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELED",
  TIMED_OUT: "TIMED_OUT",
} as const;

export const TERMINAL_STATUSES: RunpodTaskStatus[] = [
  "COMPLETED",
  "FAILED",
  "TIMED_OUT",
  "CANCELED",
] as const;

export const NON_TERMINAL_STATUSES: RunpodTaskStatus[] = [
  "SUBMITTED",
  "QUEUED",
  "IN_PROGRESS",
] as const;
