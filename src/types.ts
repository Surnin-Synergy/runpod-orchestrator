export type RunpodTaskStatus =
  | "SUBMITTED" 
  | "QUEUED" 
  | "IN_PROGRESS"
  | "COMPLETED" 
  | "FAILED" 
  | "TIMED_OUT" 
  | "CANCELED";

export interface RunpodOrchestratorConfig {
  instanceId?: string;
  redis: { url?: string } | { client: import("ioredis").Redis };
  runpod: { 
    apiKey: string; 
    endpointId: string;
  };
  namespace?: string;
  polling: {
    enableStreaming?: boolean;
    initialBackoffMs?: number;
    maxBackoffMs?: number;
    jitterPct?: number;
    batchSize?: number;
  };
  storage: {
    persistInput?: boolean;
    resultTtlSec?: number;
  };
  dedupe?: { 
    enable?: boolean; 
    useInputHash?: boolean;
  };
  logging?: { 
    debug?: (...args: any[]) => void; 
    info?: (...args: any[]) => void; 
    error?: (...args: any[]) => void;
  };
}

export interface SubmitOptions {
  clientJobId: string;
  input: unknown;
  inputHash?: string;
}

export interface JobRecord {
  clientJobId: string;
  runpodJobId?: string | null;
  status: RunpodTaskStatus;
  output?: any;
  error?: any;
  createdAt: number;
  updatedAt: number;
  attempt?: number;
  nextPollAt?: number;
  pollBackoffMs?: number;
  ownerInstanceId?: string | null;
  lockUntil?: number | null;
  endpointId?: string;
  input?: string;
  inputHash?: string;
}

export interface OrchestratorEvents {
  submitted: (payload: { clientJobId: string; runpodJobId: string }) => void;
  progress: (payload: { clientJobId: string; status: RunpodTaskStatus; metrics?: any }) => void;
  completed: (payload: { clientJobId: string; output: any }) => void;
  failed: (payload: { clientJobId: string; error: any; status: RunpodTaskStatus }) => void;
}

export interface RunpodOrchestrator {
  submit(opts: SubmitOptions): Promise<{ clientJobId: string; runpodJobId: string }>;
  awaitResult(clientJobId: string, timeoutMs?: number): Promise<{ 
    status: "COMPLETED"|"FAILED"|"TIMED_OUT"|"CANCELED"; 
    output?: any; 
    error?: any;
  }>;
  get(clientJobId: string): Promise<JobRecord | null>;
  cancel(clientJobId: string): Promise<void>;
  recoverAllPending(): Promise<number>;
  on<E extends keyof OrchestratorEvents>(event: E, handler: OrchestratorEvents[E]): this;
  off<E extends keyof OrchestratorEvents>(event: E, handler: OrchestratorEvents[E]): this;
  close(): Promise<void>;
}

export interface RunpodJobStatus {
  id: string;
  status: string;
  output?: any;
  error?: any;
  metrics?: any;
}

export interface RunpodRunResponse {
  id: string;
}

export interface LockResult {
  success: boolean;
  token?: string;
}

export interface PollingJob {
  clientJobId: string;
  nextPollAt: number;
}
