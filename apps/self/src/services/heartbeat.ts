/**
 * SELF Heartbeat Service
 * The always-on proactive loop. Phase 1 is a stub — the full implementation
 * comes in Phase 2 when we add integration polling and proactive actions.
 */

import { query, queryOne } from '../database.js';

interface SelfInstanceRow {
  id: string;
  user_id: string;
  status: string;
  daily_budget_usd: string;
  daily_spent_usd: string;
  heartbeat_interval_ms: number;
  forge_agent_id: string | null;
}

/**
 * Update the SELF heartbeat timestamp.
 * Called when any activity occurs (chat, schedule, integration poll).
 */
export async function recordHeartbeat(selfId: string): Promise<void> {
  await query(
    `UPDATE self_instances SET last_heartbeat = NOW(), updated_at = NOW() WHERE id = $1`,
    [selfId],
  );
}

/**
 * Get SELF instances that are due for a heartbeat check.
 * Used by the worker to find instances that need proactive processing.
 */
export async function getDueHeartbeats(): Promise<SelfInstanceRow[]> {
  return query<SelfInstanceRow>(
    `SELECT id, user_id, status, daily_budget_usd, daily_spent_usd,
            heartbeat_interval_ms, forge_agent_id
     FROM self_instances
     WHERE status = 'active'
       AND (last_heartbeat IS NULL
            OR last_heartbeat + (heartbeat_interval_ms || ' milliseconds')::interval <= NOW())
     ORDER BY last_heartbeat ASC NULLS FIRST
     LIMIT 100`,
  );
}

/**
 * Reset daily budget spent (called by daily cron)
 */
export async function resetDailyBudgets(): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE self_instances
     SET daily_spent_usd = 0, updated_at = NOW()
     WHERE daily_spent_usd > 0
     RETURNING id`,
  );
  return result.length;
}

/**
 * Reset monthly budget spent (called by monthly cron)
 */
export async function resetMonthlyBudgets(): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE self_instances
     SET monthly_spent_usd = 0, updated_at = NOW()
     WHERE monthly_spent_usd > 0
     RETURNING id`,
  );
  return result.length;
}
