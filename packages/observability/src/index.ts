import pino, { Logger, LoggerOptions } from 'pino';

// ===========================================
// LOGGING
// ===========================================

export interface LogContext {
  component?: string;
  shardId?: string;
  traceId?: string;
  sessionId?: string;
  [key: string]: unknown;
}

let rootLogger: Logger | null = null;

/**
 * Initialize the root logger
 */
export function initializeLogger(options?: LoggerOptions): Logger {
  if (rootLogger) {
    return rootLogger;
  }

  const logLevel = process.env['LOG_LEVEL'] ?? process.env['PINO_LOG_LEVEL'] ?? 'info';
  const isProd = process.env['NODE_ENV'] === 'production';
  const isSilent = logLevel === 'silent';

  const defaultOptions: LoggerOptions = {
    level: logLevel,
    base: {
      service: 'substrate',
    },
    // Don't use pino-pretty in production or when silent
    ...(!isProd && !isSilent ? {
      transport: { target: 'pino-pretty', options: { colorize: true } },
    } : {}),
  };

  rootLogger = pino({ ...defaultOptions, ...options });
  return rootLogger;
}

/**
 * Get the root logger (initializes if needed)
 */
export function getLogger(): Logger {
  if (!rootLogger) {
    return initializeLogger();
  }
  return rootLogger;
}

/**
 * Create a child logger with context
 */
export function createLogger(context: LogContext): Logger {
  return getLogger().child(context);
}

/**
 * Log a metabolic event with structured data
 */
export function logMetabolicEvent(
  event: string,
  data: Record<string, unknown>,
  level: 'info' | 'warn' | 'error' = 'info'
): void {
  const logger = getLogger();
  logger[level]({ event, ...data }, `Metabolic: ${event}`);
}

/**
 * Log a shard execution
 */
export function logShardExecution(
  shardId: string,
  success: boolean,
  executionMs: number,
  tokensSaved: number
): void {
  getLogger().info({
    event: 'shard.executed',
    shardId,
    success,
    executionMs,
    tokensSaved,
  }, `Shard ${shardId} executed: ${success ? 'success' : 'failure'}`);
}

/**
 * Log a quality gate result
 */
export function logGateResult(
  gateType: string,
  entityId: string,
  decision: 'pass' | 'fail' | 'warn',
  score?: number
): void {
  const level = decision === 'fail' ? 'warn' : 'info';
  getLogger()[level]({
    event: 'gate.result',
    gateType,
    entityId,
    decision,
    score,
  }, `Gate ${gateType}: ${decision}`);
}

// Re-export pino types
export { Logger, LoggerOptions } from 'pino';

// ===========================================
// METRICS
// ===========================================

export interface MetricLabels {
  [key: string]: string;
}

interface CounterMetric {
  type: 'counter';
  name: string;
  help: string;
  values: Map<string, number>;
}

interface GaugeMetric {
  type: 'gauge';
  name: string;
  help: string;
  values: Map<string, number>;
}

interface HistogramMetric {
  type: 'histogram';
  name: string;
  help: string;
  buckets: number[];
  values: Map<string, { counts: number[]; sum: number; count: number }>;
}

type Metric = CounterMetric | GaugeMetric | HistogramMetric;

// Global metrics registry
const metricsRegistry = new Map<string, Metric>();

// Default histogram buckets (in milliseconds for latency)
const DEFAULT_BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

/**
 * Generate a label key from labels object
 */
function labelsToKey(labels: MetricLabels = {}): string {
  const sorted = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([k, v]) => `${k}="${v}"`).join(',');
}

/**
 * Create a counter metric
 */
export function createCounter(name: string, help: string): {
  inc: (labels?: MetricLabels, value?: number) => void;
} {
  const metric: CounterMetric = {
    type: 'counter',
    name,
    help,
    values: new Map(),
  };
  metricsRegistry.set(name, metric);

  return {
    inc: (labels: MetricLabels = {}, value: number = 1) => {
      const key = labelsToKey(labels);
      const current = metric.values.get(key) ?? 0;
      metric.values.set(key, current + value);
    },
  };
}

/**
 * Create a gauge metric
 */
export function createGauge(name: string, help: string): {
  set: (value: number, labels?: MetricLabels) => void;
  inc: (labels?: MetricLabels, value?: number) => void;
  dec: (labels?: MetricLabels, value?: number) => void;
} {
  const metric: GaugeMetric = {
    type: 'gauge',
    name,
    help,
    values: new Map(),
  };
  metricsRegistry.set(name, metric);

  return {
    set: (value: number, labels: MetricLabels = {}) => {
      const key = labelsToKey(labels);
      metric.values.set(key, value);
    },
    inc: (labels: MetricLabels = {}, value: number = 1) => {
      const key = labelsToKey(labels);
      const current = metric.values.get(key) ?? 0;
      metric.values.set(key, current + value);
    },
    dec: (labels: MetricLabels = {}, value: number = 1) => {
      const key = labelsToKey(labels);
      const current = metric.values.get(key) ?? 0;
      metric.values.set(key, current - value);
    },
  };
}

/**
 * Create a histogram metric
 */
export function createHistogram(
  name: string,
  help: string,
  buckets: number[] = DEFAULT_BUCKETS
): {
  observe: (value: number, labels?: MetricLabels) => void;
  startTimer: (labels?: MetricLabels) => () => number;
} {
  const sortedBuckets = [...buckets].sort((a, b) => a - b);

  const metric: HistogramMetric = {
    type: 'histogram',
    name,
    help,
    buckets: sortedBuckets,
    values: new Map(),
  };
  metricsRegistry.set(name, metric);

  return {
    observe: (value: number, labels: MetricLabels = {}) => {
      const key = labelsToKey(labels);
      let data = metric.values.get(key);

      if (!data) {
        data = {
          counts: new Array(sortedBuckets.length + 1).fill(0),
          sum: 0,
          count: 0,
        };
        metric.values.set(key, data);
      }

      data.sum += value;
      data.count++;

      // Increment bucket counts
      for (let i = 0; i < sortedBuckets.length; i++) {
        if (value <= sortedBuckets[i]!) {
          data.counts[i]!++;
        }
      }
      // +Inf bucket
      data.counts[sortedBuckets.length]!++;
    },
    startTimer: (labels: MetricLabels = {}) => {
      const start = process.hrtime.bigint();
      return () => {
        const end = process.hrtime.bigint();
        const durationMs = Number(end - start) / 1_000_000;
        const key = labelsToKey(labels);
        let data = metric.values.get(key);

        if (!data) {
          data = {
            counts: new Array(sortedBuckets.length + 1).fill(0),
            sum: 0,
            count: 0,
          };
          metric.values.set(key, data);
        }

        data.sum += durationMs;
        data.count++;

        for (let i = 0; i < sortedBuckets.length; i++) {
          if (durationMs <= sortedBuckets[i]!) {
            data.counts[i]!++;
          }
        }
        data.counts[sortedBuckets.length]!++;

        return durationMs;
      };
    },
  };
}

/**
 * Get all metrics in Prometheus text format
 */
export function getPrometheusMetrics(): string {
  const lines: string[] = [];

  for (const metric of metricsRegistry.values()) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);

    if (metric.type === 'counter' || metric.type === 'gauge') {
      for (const [labels, value] of metric.values.entries()) {
        const labelStr = labels ? `{${labels}}` : '';
        lines.push(`${metric.name}${labelStr} ${value}`);
      }
    } else if (metric.type === 'histogram') {
      for (const [labels, data] of metric.values.entries()) {
        const labelPrefix = labels ? `${labels},` : '';

        // Bucket values
        for (let i = 0; i < metric.buckets.length; i++) {
          const bucket = metric.buckets[i];
          const count = data.counts[i];
          lines.push(`${metric.name}_bucket{${labelPrefix}le="${bucket}"} ${count}`);
        }
        lines.push(`${metric.name}_bucket{${labelPrefix}le="+Inf"} ${data.counts[metric.buckets.length]}`);

        // Sum and count
        lines.push(`${metric.name}_sum{${labels ? labels : ''}} ${data.sum}`);
        lines.push(`${metric.name}_count{${labels ? labels : ''}} ${data.count}`);
      }
    }

    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get metrics as JSON
 */
export function getMetricsJson(): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const metric of metricsRegistry.values()) {
    if (metric.type === 'counter' || metric.type === 'gauge') {
      const values: Record<string, number> = {};
      for (const [labels, value] of metric.values.entries()) {
        values[labels || 'default'] = value;
      }
      result[metric.name] = { type: metric.type, help: metric.help, values };
    } else if (metric.type === 'histogram') {
      const values: Record<string, unknown> = {};
      for (const [labels, data] of metric.values.entries()) {
        values[labels || 'default'] = {
          sum: data.sum,
          count: data.count,
          buckets: Object.fromEntries(
            metric.buckets.map((b, i) => [b, data.counts[i]])
          ),
        };
      }
      result[metric.name] = { type: metric.type, help: metric.help, values };
    }
  }

  return result;
}

/**
 * Reset all metrics (useful for testing)
 */
export function resetMetrics(): void {
  metricsRegistry.clear();
}

// ===========================================
// DEFAULT METRICS
// ===========================================

// HTTP request metrics
export const httpRequestsTotal = createCounter(
  'substrate_http_requests_total',
  'Total number of HTTP requests'
);

export const httpRequestDuration = createHistogram(
  'substrate_http_request_duration_ms',
  'HTTP request duration in milliseconds'
);

export const httpRequestsInFlight = createGauge(
  'substrate_http_requests_in_flight',
  'Number of HTTP requests currently being processed'
);

// Shard execution metrics
export const shardExecutionsTotal = createCounter(
  'substrate_shard_executions_total',
  'Total number of shard executions'
);

export const shardExecutionDuration = createHistogram(
  'substrate_shard_execution_duration_ms',
  'Shard execution duration in milliseconds'
);

// Memory tier metrics
export const memoryItemsTotal = createGauge(
  'substrate_memory_items_total',
  'Total items in each memory tier'
);

export const tokensSavedTotal = createCounter(
  'substrate_tokens_saved_total',
  'Total tokens saved by shard execution'
);

// Metabolic cycle metrics
export const metabolicCyclesTotal = createCounter(
  'substrate_metabolic_cycles_total',
  'Total metabolic cycles run'
);

export const metabolicCycleDuration = createHistogram(
  'substrate_metabolic_cycle_duration_ms',
  'Metabolic cycle duration in milliseconds'
);

// ===========================================
// HEALTH CHECKS
// ===========================================

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<string, {
    status: 'pass' | 'warn' | 'fail';
    message?: string;
    latency_ms?: number;
  }>;
  version?: string;
  uptime_seconds?: number;
}

type HealthCheckFn = () => Promise<{ status: 'pass' | 'warn' | 'fail'; message?: string }>;

const healthChecks = new Map<string, HealthCheckFn>();
const startTime = Date.now();

/**
 * Register a health check
 */
export function registerHealthCheck(name: string, check: HealthCheckFn): void {
  healthChecks.set(name, check);
}

/**
 * Run all health checks
 */
export async function runHealthChecks(): Promise<HealthCheckResult> {
  const checks: HealthCheckResult['checks'] = {};
  let overallStatus: HealthCheckResult['status'] = 'healthy';

  for (const [name, checkFn] of healthChecks.entries()) {
    const start = Date.now();
    try {
      const result = await checkFn();
      const checkResult: { status: 'pass' | 'warn' | 'fail'; message?: string; latency_ms?: number } = {
        status: result.status,
        latency_ms: Date.now() - start,
      };
      if (result.message) {
        checkResult.message = result.message;
      }
      checks[name] = checkResult;

      if (result.status === 'fail') {
        overallStatus = 'unhealthy';
      } else if (result.status === 'warn' && overallStatus !== 'unhealthy') {
        overallStatus = 'degraded';
      }
    } catch (err) {
      checks[name] = {
        status: 'fail',
        message: err instanceof Error ? err.message : 'Unknown error',
        latency_ms: Date.now() - start,
      };
      overallStatus = 'unhealthy';
    }
  }

  return {
    status: overallStatus,
    checks,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
  };
}

/**
 * Simple liveness check (just confirms the process is running)
 */
export function livenessCheck(): { status: 'ok' } {
  return { status: 'ok' };
}

/**
 * Get uptime in seconds
 */
export function getUptimeSeconds(): number {
  return Math.floor((Date.now() - startTime) / 1000);
}
