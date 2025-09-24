export type RunpodTaskStatus =
  | "SUBMITTED" 
  | "QUEUED" 
  | "IN_PROGRESS"
  | "COMPLETED" 
  | "FAILED" 
  | "TIMED_OUT" 
  | "CANCELED";

export interface RunpodStatus {
  id: string;
  delayTime: number;
  executionTime: number;
  status: string;
  workerId: string;
  error?: any;
}

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

export interface SubmitOptions<TMetadata = Record<string, any>, TOutput = any> {
  clientJobId: string;
  input: unknown;
  inputHash?: string;
  metadata?: TMetadata;
}

export interface JobRecord<TMetadata = Record<string, any>, TOutput = any> {
  clientJobId: string;
  runpodJobId?: string | null;
  status: RunpodTaskStatus;
  output?: TOutput;
  error?: any;
  runpodStatus?: RunpodStatus;
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
  metadata?: TMetadata;
}

export interface OrchestratorEvents<TMetadata = Record<string, any>, TOutput = any> {
  submitted: (payload: { clientJobId: string; runpodJobId: string; metadata?: TMetadata }) => void;
  progress: (payload: { clientJobId: string; status: RunpodTaskStatus; runpodStatus?: RunpodStatus; metadata?: TMetadata }) => void;
  completed: (payload: { clientJobId: string; output: TOutput; runpodStatus?: RunpodStatus; metadata?: TMetadata }) => void;
  failed: (payload: { clientJobId: string; error: any; status: RunpodTaskStatus; runpodStatus?: RunpodStatus; metadata?: TMetadata }) => void;
}

// Typed EventEmitter interface for orchestrator events
export interface TypedEventEmitter<TMetadata = Record<string, any>, TOutput = any> {
  on<E extends keyof OrchestratorEvents<TMetadata, TOutput>>(event: E, handler: OrchestratorEvents<TMetadata, TOutput>[E]): this;
  off<E extends keyof OrchestratorEvents<TMetadata, TOutput>>(event: E, handler: OrchestratorEvents<TMetadata, TOutput>[E]): this;
  emit<E extends keyof OrchestratorEvents<TMetadata, TOutput>>(event: E, ...args: Parameters<OrchestratorEvents<TMetadata, TOutput>[E]>): boolean;
}

export interface RunpodOrchestrator<TMetadata = Record<string, any>, TOutput = any> extends TypedEventEmitter<TMetadata, TOutput> {
  submit(opts: SubmitOptions<TMetadata, TOutput>): Promise<{ clientJobId: string; runpodJobId: string }>;
  awaitResult(clientJobId: string, timeoutMs?: number): Promise<{ 
    status: "COMPLETED"|"FAILED"|"TIMED_OUT"|"CANCELED"; 
    output?: TOutput; 
    error?: any;
    runpodStatus?: RunpodStatus;
    metadata?: TMetadata;
  }>;
  get(clientJobId: string): Promise<JobRecord<TMetadata, TOutput> | null>;
  cancel(clientJobId: string): Promise<void>;
  recoverAllPending(): Promise<number>;
  close(): Promise<void>;
}

// RunpodJobStatus is now the same as RunpodStatus
export type RunpodJobStatus = RunpodStatus;

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
