/**
 * Forge Cost Tracker
 * Per-execution cost accounting with aggregation queries
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';

interface TrackCostOptions {
  executionId: string;
  agentId: string;
  ownerId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  metadata?: Record<string, unknown>;
}

interface CostSummaryOptions {
  startDate?: string | undefined;
  endDate?: string | undefined;
  agentId?: string | undefined;
}

interface CostSummaryRow {
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  total_events: string;
}

interface DailyCostRow {
  date: string;
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  event_count: string;
}

interface CostEventRow {
  id: string;
  execution_id: string;
  agent_id: string;
  owner_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

/**
 * Record a cost event for an execution.
 * Retries up to 3 times with exponential backoff to prevent silent data loss.
 */
export async function trackCost(opts: TrackCostOptions): Promise<string> {
  const id = ulid();
  const MAX_RETRIES = 3;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await query(
        `INSERT INTO forge_cost_events (id, execution_id, agent_id, owner_id, provider, model, input_tokens, output_tokens, cost, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          opts.executionId,
          opts.agentId,
          opts.ownerId,
          opts.provider,
          opts.model,
          opts.inputTokens,
          opts.outputTokens,
          opts.cost,
          JSON.stringify(opts.metadata ?? {}),
        ],
      );
      return id;
    } catch (err) {
      if (attempt < MAX_RETRIES) {
        const delayMs = 500 * Math.pow(2, attempt); // 500ms, 1s, 2s
        console.warn(`[Cost] Retry ${attempt + 1}/${MAX_RETRIES} for execution ${opts.executionId} (waiting ${delayMs}ms):`, err instanceof Error ? err.message : err);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      } else {
        // Final failure — log enough detail to reconstruct manually
        console.error(`[Cost] FAILED to record cost after ${MAX_RETRIES} retries. MANUAL RECOVERY NEEDED:`, JSON.stringify({
          executionId: opts.executionId,
          agentId: opts.agentId,
          cost: opts.cost,
          inputTokens: opts.inputTokens,
          outputTokens: opts.outputTokens,
          model: opts.model,
        }));
        throw err;
      }
    }
  }

  return id; // unreachable but satisfies TS
}

/**
 * Get aggregated cost summary for an owner.
 */
export async function getCostSummary(
  ownerId: string,
  opts?: CostSummaryOptions,
): Promise<{
  totalCost: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalEvents: number;
}> {
  const conditions: string[] = ['owner_id = $1'];
  const params: unknown[] = [ownerId];
  let paramIndex = 2;

  if (opts?.startDate) {
    conditions.push(`created_at >= $${paramIndex}`);
    params.push(opts.startDate);
    paramIndex++;
  }

  if (opts?.endDate) {
    conditions.push(`created_at <= $${paramIndex}`);
    params.push(opts.endDate);
    paramIndex++;
  }

  if (opts?.agentId) {
    conditions.push(`agent_id = $${paramIndex}`);
    params.push(opts.agentId);
    paramIndex++;
  }

  const whereClause = conditions.join(' AND ');

  const row = await queryOne<CostSummaryRow>(
    `SELECT
       COALESCE(SUM(cost), 0) AS total_cost,
       COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
       COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
       COUNT(*) AS total_events
     FROM forge_cost_events
     WHERE ${whereClause}`,
    params,
  );

  return {
    totalCost: row ? (parseFloat(row.total_cost ?? '0') || 0) : 0,
    totalInputTokens: row ? (parseInt(row.total_input_tokens ?? '0', 10) || 0) : 0,
    totalOutputTokens: row ? (parseInt(row.total_output_tokens ?? '0', 10) || 0) : 0,
    totalEvents: row ? (parseInt(row.total_events ?? '0', 10) || 0) : 0,
  };
}

/**
 * Get daily cost breakdown for the last N days.
 */
export async function getDailyCosts(
  ownerId: string,
  days: number,
): Promise<
  {
    date: string;
    totalCost: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    eventCount: number;
  }[]
> {
  const rows = await query<DailyCostRow>(
    `SELECT
       DATE(created_at) AS date,
       COALESCE(SUM(cost), 0) AS total_cost,
       COALESCE(SUM(input_tokens), 0) AS total_input_tokens,
       COALESCE(SUM(output_tokens), 0) AS total_output_tokens,
       COUNT(*) AS event_count
     FROM forge_cost_events
     WHERE owner_id = $1
       AND created_at >= NOW() - INTERVAL '1 day' * $2
     GROUP BY DATE(created_at)
     ORDER BY date DESC`,
    [ownerId, days],
  );

  return rows.map((row) => ({
    date: row.date,
    totalCost: parseFloat(row.total_cost ?? '0') || 0,
    totalInputTokens: parseInt(row.total_input_tokens ?? '0', 10) || 0,
    totalOutputTokens: parseInt(row.total_output_tokens ?? '0', 10) || 0,
    eventCount: parseInt(row.event_count ?? '0', 10) || 0,
  }));
}
