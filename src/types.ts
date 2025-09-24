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

export interface SubmitOptions<TMetadata = Record<string, any>> {
  clientJobId: string;
  input: unknown;
  inputHash?: string;
  metadata?: TMetadata;
}

export interface JobRecord<TMetadata = Record<string, any>> {
  clientJobId: string;
  runpodJobId?: string | null;
  status: RunpodTaskStatus;
  output?: any;
  error?: any;
  runpodStatus?: any;
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

export interface OrchestratorEvents<TMetadata = Record<string, any>> {
  submitted: (payload: { clientJobId: string; runpodJobId: string; metadata?: TMetadata }) => void;
  progress: (payload: { clientJobId: string; status: RunpodTaskStatus; runpodStatus?: any; metadata?: TMetadata }) => void;
  completed: (payload: { clientJobId: string; output: any; runpodStatus?: any; metadata?: TMetadata }) => void;
  failed: (payload: { clientJobId: string; error: any; status: RunpodTaskStatus; runpodStatus?: any; metadata?: TMetadata }) => void;
}

// Typed EventEmitter interface for orchestrator events
export interface TypedEventEmitter<TMetadata = Record<string, any>> {
  on<E extends keyof OrchestratorEvents<TMetadata>>(event: E, handler: OrchestratorEvents<TMetadata>[E]): this;
  off<E extends keyof OrchestratorEvents<TMetadata>>(event: E, handler: OrchestratorEvents<TMetadata>[E]): this;
  emit<E extends keyof OrchestratorEvents<TMetadata>>(event: E, ...args: Parameters<OrchestratorEvents<TMetadata>[E]>): boolean;
}

export interface RunpodOrchestrator<TMetadata = Record<string, any>> extends TypedEventEmitter<TMetadata> {
  submit(opts: SubmitOptions<TMetadata>): Promise<{ clientJobId: string; runpodJobId: string }>;
  awaitResult(clientJobId: string, timeoutMs?: number): Promise<{ 
    status: "COMPLETED"|"FAILED"|"TIMED_OUT"|"CANCELED"; 
    output?: any; 
    error?: any;
    runpodStatus?: any;
    metadata?: TMetadata;
  }>;
  get(clientJobId: string): Promise<JobRecord<TMetadata> | null>;
  cancel(clientJobId: string): Promise<void>;
  recoverAllPending(): Promise<number>;
  close(): Promise<void>;
}

export interface RunpodJobStatus {
  id: string;
  status: string;
  output?: any;
  error?: any;
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
