export interface BackoffConfig {
  initialMs: number;
  maxMs: number;
  jitterPct: number;
}

export class BackoffCalculator {
  private config: BackoffConfig;

  constructor(config: BackoffConfig) {
    this.config = config;
  }

  calculate(attempt: number): number {
    const baseDelay = Math.min(
      this.config.initialMs * Math.pow(1.5, attempt),
      this.config.maxMs
    );

    const jitter = baseDelay * this.config.jitterPct * (Math.random() * 2 - 1);
    return Math.max(0, Math.floor(baseDelay + jitter));
  }

  getNextPollTime(attempt: number): number {
    return Date.now() + this.calculate(attempt);
  }
}

export function createBackoffCalculator(
  config: Partial<BackoffConfig> = {}
): BackoffCalculator {
  const defaultConfig: BackoffConfig = {
    initialMs: 2000,
    maxMs: 10000,
    jitterPct: 0.2,
  };

  return new BackoffCalculator({ ...defaultConfig, ...config });
}
