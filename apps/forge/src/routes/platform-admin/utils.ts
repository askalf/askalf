/**
 * Platform Admin — shared types, helpers, constants
 */

import { ulid } from 'ulid';
import { runCliQuery } from '../../runtime/worker.js';
import { query, queryOne } from '../../database.js';

// Re-export for sub-modules
export { ulid };

// ============================================
// Types
// ============================================

export interface ForgeAgent {
  id: string; name: string; description: string | null; system_prompt: string | null;
  status: string; autonomy_level: number; metadata: Record<string, unknown> | null;
  provider_config: Record<string, unknown> | null; model_id: string | null;
  enabled_tools: string[]; type: string;
  created_at: string; updated_at: string;
}

export interface ForgeExecution {
  id: string; agent_id: string; status: string; input: string | null; output: string | null;
  error: string | null; started_at: string | null; completed_at: string | null;
  created_at: string; total_tokens: number | null; cost: string | null;
  duration_ms: number | null; metadata: Record<string, unknown> | null;
}

// ============================================
// Helpers
// ============================================

export function paginationResponse(total: number, page: number, limit: number) {
  const totalPages = Math.ceil(total / limit) || 1;
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
}

export function mapAgentType(metadata: Record<string, unknown> | null): string {
  const typeMap: Record<string, string> = {
    development: 'dev', dev: 'dev', research: 'research',
    support: 'support', content: 'content', monitoring: 'monitor', monitor: 'monitor',
    security: 'security',
  };
  const raw = (metadata?.['type'] as string) || '';
  return typeMap[raw.toLowerCase()] || 'custom';
}

export function mapAgentStatus(status: string): string {
  if (status === 'paused') return 'paused';
  if (status === 'archived') return 'idle';
  return 'idle';
}

export function transformAgent(a: ForgeAgent, executions: ForgeExecution[] = [], pendingInterventions = 0) {
  const agentExecs = executions.filter(e => e.agent_id === a.id);
  const completed = agentExecs.filter(e => e.status === 'completed');
  const failed = agentExecs.filter(e => e.status === 'failed');
  const running = agentExecs.find(e => e.status === 'running' || e.status === 'pending');
  const lastCompleted = completed.sort((x, y) =>
    new Date(y.completed_at || y.created_at).getTime() - new Date(x.completed_at || x.created_at).getTime()
  )[0];

  return {
    id: a.id,
    name: a.name,
    type: a.type || mapAgentType(a.metadata),
    status: running ? 'running' : mapAgentStatus(a.status),
    description: a.description || '',
    system_prompt: a.system_prompt || '',
    schedule: null,
    config: a.provider_config || {},
    enabled_tools: a.enabled_tools || [],
    autonomy_level: a.autonomy_level ?? 2,
    is_decommissioned: a.status === 'archived',
    decommissioned_at: a.status === 'archived' ? a.updated_at : null,
    tasks_completed: completed.length,
    tasks_failed: failed.length,
    current_task: running ? running.id : null,
    last_run_at: lastCompleted?.completed_at || lastCompleted?.created_at || null,
    pending_interventions: pendingInterventions,
    created_at: a.created_at,
    updated_at: a.updated_at,
    // Raw fields preserved for dashboard routes that need them
    metadata: a.metadata || {},
    model_id: a.model_id || null,
    raw_status: a.status,
  };
}

// ============================================
// AI Review Store (in-memory cache + DB persistence)
// ============================================

export interface ReviewEntry {
  status: 'pending' | 'completed' | 'failed';
  branch?: string;
  diff?: string;
  result?: {
    summary: string;
    issues: Array<{ severity: string; file: string; line: number | null; message: string }>;
    suggestions: Array<{ file: string; message: string }>;
    approved: boolean;
  };
  rawOutput?: string;
  error?: string;
}

// Bounded review store: max 50 entries (evict oldest on overflow).
// Entries are also persisted to DB so eviction only affects in-process cache.
const REVIEW_STORE_MAX = 50;
export const reviewStore = new Map<string, ReviewEntry>();

function evictOldestReview(): void {
  const firstKey = reviewStore.keys().next().value;
  if (firstKey !== undefined) {
    reviewStore.delete(firstKey);
  }
}

export function reviewStoreSet(id: string, entry: ReviewEntry): void {
  if (!reviewStore.has(id) && reviewStore.size >= REVIEW_STORE_MAX) {
    evictOldestReview();
  }
  reviewStore.set(id, entry);
}

/** Upsert review to forge_reviews table (fire-and-forget). */
export async function persistReview(id: string, data: ReviewEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO forge_reviews (id, status, branch, diff, result, raw_output, error, completed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         result = EXCLUDED.result,
         raw_output = EXCLUDED.raw_output,
         error = EXCLUDED.error,
         completed_at = EXCLUDED.completed_at`,
      [
        id,
        data.status,
        data.branch ?? null,
        data.diff ?? null,
        data.result ? JSON.stringify(data.result) : null,
        data.rawOutput ?? null,
        data.error ?? null,
        data.status !== 'pending' ? new Date().toISOString() : null,
      ],
    );
  } catch (err) {
    console.warn(`[Review] Failed to persist review ${id}:`, err instanceof Error ? err.message : err);
  }
}

/** Load review from DB when Map cache misses. Backfills cache on hit. */
export async function loadReviewFromDb(id: string): Promise<ReviewEntry | null> {
  try {
    const row = await queryOne<{
      status: string;
      branch: string | null;
      diff: string | null;
      result: Record<string, unknown> | null;
      raw_output: string | null;
      error: string | null;
    }>(
      `SELECT status, branch, diff, result, raw_output, error FROM forge_reviews WHERE id = $1`,
      [id],
    );
    if (!row) return null;
    const entry: ReviewEntry = {
      status: row.status as ReviewEntry['status'],
      branch: row.branch ?? undefined,
      diff: row.diff ?? undefined,
      result: row.result as ReviewEntry['result'],
      rawOutput: row.raw_output ?? undefined,
      error: row.error ?? undefined,
    };
    // Backfill Map cache
    reviewStoreSet(id, entry);
    return entry;
  } catch {
    return null;
  }
}

export const REVIEW_SYSTEM_PROMPT = `You are an expert code reviewer. Analyze the git diff below and return ONLY valid JSON (no markdown fences, no extra text):
{
  "summary": "1-2 sentence overview of changes",
  "issues": [{ "severity": "error|warning|info", "file": "path/to/file", "line": null, "message": "description of the issue" }],
  "suggestions": [{ "file": "path/to/file", "message": "improvement suggestion" }],
  "approved": true
}
Focus on: bugs, security vulnerabilities, performance problems, code style issues, and correctness. Set approved to false if there are any error-severity issues. Return an empty issues/suggestions array if the code looks good.`;

// ============================================
// Scheduler state (mutable)
// ============================================

export const schedulerState = { running: true };

export const AUTO_APPROVE_PATTERNS = [
  /restart.*container/i,
  /install.*extension/i,
  /apply.*migration/i,
  /create.*index/i,
  /enable.*monitoring/i,
  /update.*schedule/i,
];

// Re-export runCliQuery for git.ts
export { runCliQuery };
