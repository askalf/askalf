/**
 * Test Utilities for Isolated, Repeatable Integration Tests
 *
 * Provides:
 * - Unique test run IDs for isolation
 * - Cleanup functions to remove test data
 * - API helpers with proper error handling
 * - Fixture management
 */

export const API_BASE = process.env.API_URL || 'http://localhost:3000';

// Unique prefix for this test run - allows parallel test runs
export const TEST_RUN_ID = `__test_${process.pid}_${Date.now()}__`;

// Track all test data created for cleanup
const createdTraceIds: string[] = [];
const createdShardIds: string[] = [];
const createdEpisodeIds: string[] = [];

// Response types
export interface TraceResponse {
  id: string;
  intentTemplate: string;
  intentHash: string;
  patternHash: string;
}

export interface ExecuteResponse {
  success: boolean;
  output?: string;
  error?: string;
  method: string;
  matchMethod?: string;
  shardId?: string;
  shardName?: string;
  executionMs?: number;
  episodeId?: string;
}

export interface CrystallizeResponse {
  shardsCreated: number;
  tracesProcessed: number;
  shards?: Array<{ id: string; name: string }>;
}

export interface PromoteResponse {
  promoted: number;
  demoted: number;
  candidates: string[];
}

export interface DecayResponse {
  decayed: number;
  archived: number;
}

export interface EvolveResponse {
  processed: number;
  evolved: number;
  failed: number;
  shards?: Array<{ id: string; evolved: boolean }>;
}

export interface LessonsResponse {
  processed: number;
  factsCreated: number;
  duplicatesSkipped: number;
}

export interface HealthResponse {
  status: string;
  database: boolean;
  redis: boolean;
  stats?: {
    traces: number;
    shards: number;
    episodes: number;
    facts: number;
  };
}

/**
 * Generic API call with proper error handling
 */
export async function api<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: HeadersInit = options.body
    ? { 'Content-Type': 'application/json', ...options.headers }
    : { ...options.headers };

  const res = await fetch(`${API_BASE}${path}`, {
    headers,
    ...options,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}

/**
 * Ingest a trace and track it for cleanup
 */
export async function ingestTrace(
  input: string,
  output: string,
  reasoning?: string
): Promise<TraceResponse> {
  const result = await api<TraceResponse>('/api/v1/traces', {
    method: 'POST',
    body: JSON.stringify({
      input,
      output,
      reasoning,
      tokensUsed: 50,
    }),
  });
  createdTraceIds.push(result.id);
  return result;
}

/**
 * Ingest a test trace with automatic prefix
 */
export async function ingestTestTrace(
  input: string,
  output: string,
  reasoning?: string
): Promise<TraceResponse> {
  return ingestTrace(`${TEST_RUN_ID} ${input}`, output, reasoning);
}

/**
 * Execute a shard
 */
export async function execute(
  input: string,
  options?: { shardId?: string; includeAll?: boolean }
): Promise<ExecuteResponse> {
  const result = await api<ExecuteResponse>('/api/v1/execute', {
    method: 'POST',
    body: JSON.stringify({ input, ...options }),
  });
  if (result.episodeId) {
    createdEpisodeIds.push(result.episodeId);
  }
  return result;
}

/**
 * Run crystallization cycle
 */
export async function crystallize(): Promise<CrystallizeResponse> {
  const result = await api<CrystallizeResponse>('/api/v1/metabolic/crystallize', {
    method: 'POST',
  });
  if (result.shards) {
    result.shards.forEach(s => createdShardIds.push(s.id));
  }
  return result;
}

/**
 * Run promotion cycle
 */
export async function promote(): Promise<PromoteResponse> {
  return api<PromoteResponse>('/api/v1/metabolic/promote', {
    method: 'POST',
  });
}

/**
 * Run decay cycle
 */
export async function decay(): Promise<DecayResponse> {
  return api<DecayResponse>('/api/v1/metabolic/decay', {
    method: 'POST',
  });
}

/**
 * Run evolution cycle
 */
export async function evolve(): Promise<EvolveResponse> {
  return api<EvolveResponse>('/api/v1/metabolic/evolve', {
    method: 'POST',
  });
}

/**
 * Run lesson extraction cycle
 */
export async function extractLessons(): Promise<LessonsResponse> {
  return api<LessonsResponse>('/api/v1/metabolic/lessons', {
    method: 'POST',
  });
}

/**
 * Get database statistics
 */
export async function getStats(): Promise<{
  traces: number;
  shards: number;
  episodes: number;
  facts: number;
}> {
  return api('/api/v1/stats');
}

/**
 * Clean up all test data created during this test run
 * Call this in afterAll() hooks
 */
export async function cleanupTestData(): Promise<{
  tracesDeleted: number;
  shardsDeleted: number;
  episodesDeleted: number;
}> {
  const result = {
    tracesDeleted: 0,
    shardsDeleted: 0,
    episodesDeleted: 0,
  };

  // Clean up via API endpoint (we'll need to add this)
  try {
    const cleanup = await api<{
      tracesDeleted: number;
      shardsDeleted: number;
      episodesDeleted: number;
    }>('/api/v1/test/cleanup', {
      method: 'POST',
      body: JSON.stringify({
        testRunId: TEST_RUN_ID,
        traceIds: createdTraceIds,
        shardIds: createdShardIds,
        episodeIds: createdEpisodeIds,
      }),
    });
    return cleanup;
  } catch (e) {
    // If cleanup endpoint doesn't exist, log warning
    console.warn('Cleanup endpoint not available, test data may remain:', e);
    return result;
  }
}

/**
 * Wait for a condition with timeout
 */
export async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 10000,
  intervalMs = 100
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await condition()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
}

/**
 * Retry an operation with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 100
): Promise<T> {
  let lastError: Error | undefined;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, i)));
    }
  }
  throw lastError;
}

/**
 * Check if API is healthy
 */
export async function isApiHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Wait for API to be ready
 */
export async function waitForApi(timeoutMs = 30000): Promise<void> {
  await waitFor(isApiHealthy, timeoutMs, 500);
}
