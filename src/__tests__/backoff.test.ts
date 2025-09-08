import { BackoffCalculator, createBackoffCalculator } from '../backoff';

describe('BackoffCalculator', () => {
  let calculator: BackoffCalculator;

  beforeEach(() => {
    calculator = new BackoffCalculator({
      initialMs: 1000,
      maxMs: 5000,
      jitterPct: 0.1,
    });
  });

  describe('calculate', () => {
    it('should calculate exponential backoff', () => {
      const attempt0 = calculator.calculate(0);
      const attempt1 = calculator.calculate(1);
      const attempt2 = calculator.calculate(2);

      expect(attempt0).toBeGreaterThan(0);
      expect(attempt1).toBeGreaterThan(attempt0);
      expect(attempt2).toBeGreaterThan(attempt1);
    });

    it('should respect maximum backoff', () => {
      const attempt10 = calculator.calculate(10);
      expect(attempt10).toBeLessThanOrEqual(5000 + 5000 * 0.1); // Max + jitter
    });

    it('should apply jitter', () => {
      const results = Array.from({ length: 10 }, () => calculator.calculate(1));
      const uniqueResults = new Set(results);
      
      // With jitter, we should get different results
      expect(uniqueResults.size).toBeGreaterThan(1);
    });
  });

  describe('getNextPollTime', () => {
    it('should return future timestamp', () => {
      const now = Date.now();
      const nextPollTime = calculator.getNextPollTime(0);
      
      expect(nextPollTime).toBeGreaterThan(now);
    });
  });
});

describe('createBackoffCalculator', () => {
  it('should create calculator with default config', () => {
    const calculator = createBackoffCalculator();
    expect(calculator).toBeInstanceOf(BackoffCalculator);
  });

  it('should create calculator with custom config', () => {
    const calculator = createBackoffCalculator({
      initialMs: 2000,
      maxMs: 10000,
      jitterPct: 0.2,
    });
    
    expect(calculator).toBeInstanceOf(BackoffCalculator);
  });
});
