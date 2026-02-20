/**
 * Runtime Error Handler
 * Retry logic with exponential backoff, circuit breaker pattern,
 * and typed execution errors.
 */

// ============================================
// ExecutionError
// ============================================

export type ExecutionErrorCode =
  | 'PROVIDER_ERROR'
  | 'TOOL_EXECUTION_FAILED'
  | 'BUDGET_EXCEEDED'
  | 'MAX_ITERATIONS'
  | 'CONTEXT_OVERFLOW'
  | 'TIMEOUT'
  | 'CIRCUIT_OPEN'
  | 'CANCELLED'
  | 'INVALID_AGENT'
  | 'DATABASE_ERROR'
  | 'UNKNOWN';

export class ExecutionError extends Error {
  public readonly code: ExecutionErrorCode;
  public readonly retryable: boolean;
  public readonly metadata: Record<string, unknown>;

  constructor(
    message: string,
    code: ExecutionErrorCode,
    retryable: boolean,
    metadata: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ExecutionError';
    this.code = code;
    this.retryable = retryable;
    this.metadata = metadata;
  }
}

// ============================================
// Retry with Exponential Backoff
// ============================================

export interface RetryOptions {
  /** Maximum number of retry attempts (not including the initial call). Defaults to 3. */
  maxRetries?: number | undefined;
  /** Initial delay in milliseconds before the first retry. Defaults to 1000. */
  baseDelayMs?: number | undefined;
  /** Maximum delay in milliseconds between retries. Defaults to 30000. */
  maxDelayMs?: number | undefined;
  /** Multiplier applied to the delay after each retry. Defaults to 2. */
  backoffMultiplier?: number | undefined;
  /** Jitter factor (0 to 1) to randomize delays. Defaults to 0.1. */
  jitter?: number | undefined;
  /** Optional predicate to decide if an error is retryable. Defaults to checking ExecutionError.retryable. */
  shouldRetry?: ((error: unknown) => boolean) | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wraps an async function with retry logic using exponential backoff.
 * Only retries on errors deemed retryable.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30_000;
  const backoffMultiplier = options.backoffMultiplier ?? 2;
  const jitterFactor = options.jitter ?? 0.1;
  const shouldRetry =
    options.shouldRetry ??
    ((err: unknown): boolean => {
      if (err instanceof ExecutionError) return err.retryable;
      return false;
    });

  let attempt = 0;
  let lastError: unknown;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      attempt++;

      if (attempt > maxRetries || !shouldRetry(error)) {
        throw error;
      }

      // Calculate delay with exponential backoff and jitter
      const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
      const jitter = exponentialDelay * jitterFactor * (Math.random() * 2 - 1);
      const delay = Math.min(exponentialDelay + jitter, maxDelayMs);

      await sleep(Math.max(0, delay));
    }
  }
}

// ============================================
// Circuit Breaker
// ============================================

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before the circuit opens. Defaults to 5. */
  failureThreshold?: number | undefined;
  /** Time in milliseconds the circuit stays open before moving to half-open. Defaults to 60000. */
  resetTimeoutMs?: number | undefined;
  /** Number of successful calls in half-open state to close the circuit. Defaults to 2. */
  halfOpenSuccessThreshold?: number | undefined;
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly halfOpenSuccessThreshold: number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? 60_000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
  }

  /**
   * Execute a function through the circuit breaker.
   * Throws an ExecutionError with code CIRCUIT_OPEN if the circuit is open.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'open') {
      throw new ExecutionError(
        'Circuit breaker is open; provider calls are temporarily blocked',
        'CIRCUIT_OPEN',
        true,
        {
          failureCount: this.failureCount,
          lastFailureTime: this.lastFailureTime,
          resetTimeoutMs: this.resetTimeoutMs,
        },
      );
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  /**
   * Returns the current state, transitioning from open to half_open
   * when the reset timeout has elapsed.
   */
  getState(): CircuitState {
    if (this.state === 'open') {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        this.state = 'half_open';
        this.successCount = 0;
      }
    }
    return this.state;
  }

  /**
   * Returns current metrics for observability.
   */
  getMetrics(): { state: CircuitState; failureCount: number; successCount: number } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
    };
  }

  /**
   * Manually reset the circuit breaker to the closed state.
   */
  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  private onSuccess(): void {
    if (this.state === 'half_open') {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      // In closed state, reset failure count on success
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half_open') {
      // Any failure in half-open immediately opens the circuit
      this.state = 'open';
    } else if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
    }
  }
}

// ============================================
// Named Circuit Breaker Registry
// ============================================

const circuitBreakers = new Map<string, CircuitBreaker>();

export function registerCircuitBreaker(name: string, breaker: CircuitBreaker): void {
  circuitBreakers.set(name, breaker);
}

export function getCircuitBreaker(name: string): CircuitBreaker | undefined {
  return circuitBreakers.get(name);
}

export function getCircuitBreakerNames(): string[] {
  return Array.from(circuitBreakers.keys());
}
