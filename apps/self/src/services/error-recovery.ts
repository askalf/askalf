/**
 * Error Recovery & Self-Healing
 * Monitors SELF health and automatically recovers from errors.
 */

import { query, queryOne } from '../database.js';
import { logActivity } from './activity-logger.js';
import { recordHeartbeat } from './heartbeat.js';

// ============================================
// Health Monitoring
// ============================================

interface HealthCheck {
  selfId: string;
  consecutiveErrors: number;
  lastError: string | null;
  lastErrorAt: Date | null;
}

const healthTrackers = new Map<string, HealthCheck>();

const MAX_CONSECUTIVE_ERRORS = 5;
const ERROR_WINDOW_MS = 300_000; // 5 minutes

/**
 * Record a SELF error and potentially trigger recovery
 */
export async function recordError(
  selfId: string,
  userId: string,
  error: string,
  context?: Record<string, unknown>,
): Promise<void> {
  let tracker = healthTrackers.get(selfId);

  if (!tracker) {
    tracker = {
      selfId,
      consecutiveErrors: 0,
      lastError: null,
      lastErrorAt: null,
    };
    healthTrackers.set(selfId, tracker);
  }

  // Reset counter if last error was outside window
  if (tracker.lastErrorAt && Date.now() - tracker.lastErrorAt.getTime() > ERROR_WINDOW_MS) {
    tracker.consecutiveErrors = 0;
  }

  tracker.consecutiveErrors++;
  tracker.lastError = error;
  tracker.lastErrorAt = new Date();

  // Log the error
  await logActivity({
    selfId,
    userId,
    type: 'error',
    title: `Error: ${error.length > 80 ? error.slice(0, 77) + '...' : error}`,
    body: error,
    metadata: context ?? {},
    importance: 7,
  });

  // Check if we need to trigger recovery
  if (tracker.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
    await triggerRecovery(selfId, userId, tracker);
  }
}

/**
 * Record a successful operation (resets error counter)
 */
export function recordSuccess(selfId: string): void {
  const tracker = healthTrackers.get(selfId);
  if (tracker) {
    tracker.consecutiveErrors = 0;
  }
}

// ============================================
// Recovery Procedures
// ============================================

async function triggerRecovery(
  selfId: string,
  userId: string,
  tracker: HealthCheck,
): Promise<void> {
  console.warn(`[SELF Recovery] Triggering recovery for ${selfId} after ${tracker.consecutiveErrors} errors`);

  // Step 1: Pause SELF to prevent further errors
  await query(
    `UPDATE self_instances SET status = 'error', updated_at = NOW() WHERE id = $1`,
    [selfId],
  );

  // Step 2: Log recovery attempt
  await logActivity({
    selfId,
    userId,
    type: 'system',
    title: 'SELF paused due to repeated errors',
    body: `SELF encountered ${tracker.consecutiveErrors} consecutive errors in the last 5 minutes. Last error: ${tracker.lastError}. SELF has been paused to prevent further issues. Resume when ready.`,
    importance: 9,
  });

  // Step 3: Cancel pending schedules/actions
  await query(
    `UPDATE self_schedules SET enabled = false, updated_at = NOW()
     WHERE self_id = $1 AND enabled = true`,
    [selfId],
  );

  // Step 4: Expire pending approvals
  await query(
    `UPDATE self_approvals SET status = 'expired'
     WHERE self_id = $1 AND status = 'pending'`,
    [selfId],
  );

  // Step 5: Reset tracker
  tracker.consecutiveErrors = 0;
}

/**
 * Attempt to resume a SELF instance that was in error state
 */
export async function attemptResume(selfId: string, userId: string): Promise<boolean> {
  const self = await queryOne<{ status: string }>(
    `SELECT status FROM self_instances WHERE id = $1`,
    [selfId],
  );

  if (!self || self.status !== 'error') {
    return false;
  }

  // Reset to active
  await query(
    `UPDATE self_instances SET status = 'active', updated_at = NOW() WHERE id = $1`,
    [selfId],
  );

  // Re-enable schedules
  await query(
    `UPDATE self_schedules SET enabled = true, updated_at = NOW()
     WHERE self_id = $1`,
    [selfId],
  );

  // Record heartbeat
  await recordHeartbeat(selfId);

  // Reset health tracker
  healthTrackers.delete(selfId);

  await logActivity({
    selfId,
    userId,
    type: 'system',
    title: 'SELF resumed from error state',
    body: 'Error recovery complete. SELF is back online.',
    importance: 7,
  });

  return true;
}

// ============================================
// Stale Connection Cleanup
// ============================================

/**
 * Clean up stale integration connections.
 * Called periodically to mark disconnected integrations.
 */
export async function cleanupStaleIntegrations(): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE self_integrations
     SET status = 'error', updated_at = NOW()
     WHERE status = 'connected'
       AND last_sync IS NOT NULL
       AND last_sync < NOW() - INTERVAL '24 hours'
     RETURNING id`,
  );
  return result.length;
}

/**
 * Clean up expired approvals
 */
export async function cleanupExpiredApprovals(): Promise<number> {
  const result = await query<{ id: string }>(
    `UPDATE self_approvals
     SET status = 'expired'
     WHERE status = 'pending'
       AND timeout_at IS NOT NULL
       AND timeout_at < NOW()
     RETURNING id`,
  );
  return result.length;
}
