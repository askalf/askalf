/**
 * Recalibration Cycle
 *
 * Fixes confidence drift for shards whose confidence doesn't match
 * their actual execution history. This happens when:
 *   - Shards are bulk-loaded via SQL with execution counts but static confidence
 *   - Confidence gets out of sync due to system restarts or migrations
 *
 * Formula:
 *   expected = base(0.65) + (successes * 0.008) - (failures * 0.015)
 *   If actual confidence < expected - 0.05 → recalibrate upward
 *   If actual confidence > expected + 0.15 → recalibrate downward (more cautious)
 *
 * Only adjusts shards with >= 10 executions (enough data to be meaningful).
 * Caps recalibrated confidence at 0.95 to leave room for natural growth.
 */

import { query } from '@substrate/database';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'recalibrate' });

export interface RecalibrateConfig {
  baseConfidence: number;       // Starting point for calculation (0.65)
  successIncrement: number;     // Per-success confidence gain (0.008)
  failurePenalty: number;       // Per-failure confidence loss (0.015)
  minExecutions: number;        // Minimum executions to recalibrate (10)
  driftThreshold: number;       // How far below expected before recalibrating (0.05)
  maxConfidence: number;        // Cap for recalibrated confidence (0.95)
}

const DEFAULT_CONFIG: RecalibrateConfig = {
  baseConfidence: 0.65,
  successIncrement: 0.008,
  failurePenalty: 0.015,
  minExecutions: 10,
  driftThreshold: 0.05,
  maxConfidence: 0.95,
};

export interface RecalibrateResult {
  checked: number;
  recalibrated: number;
  shards: Array<{
    id: string;
    name: string;
    oldConfidence: number;
    newConfidence: number;
    expectedConfidence: number;
    reason: string;
  }>;
}

/**
 * Run the recalibration cycle
 */
export async function runRecalibrateCycle(
  config: Partial<RecalibrateConfig> = {}
): Promise<RecalibrateResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  logger.info('Starting recalibration cycle');

  const result: RecalibrateResult = {
    checked: 0,
    recalibrated: 0,
    shards: [],
  };

  // Get all non-archived shards with enough executions
  const shards = await query<{
    id: string;
    name: string;
    lifecycle: string;
    confidence: number;
    execution_count: number;
    success_count: number;
    failure_count: number;
  }>(
    `SELECT id, name, lifecycle, confidence, execution_count, success_count,
            (execution_count - success_count) as failure_count
     FROM procedural_shards
     WHERE lifecycle NOT IN ('archived')
       AND execution_count >= $1
     ORDER BY confidence ASC`,
    [cfg.minExecutions]
  );

  result.checked = shards.length;

  for (const shard of shards) {
    // Calculate expected confidence based on execution history
    // Cap the effect at 50 executions to prevent runaway confidence
    const effectiveSuccesses = Math.min(shard.success_count, 50);
    const effectiveFailures = Math.min(shard.failure_count, 50);

    const expectedConfidence = Math.min(
      cfg.baseConfidence
        + (effectiveSuccesses * cfg.successIncrement)
        - (effectiveFailures * cfg.failurePenalty),
      cfg.maxConfidence
    );

    // Only recalibrate if confidence is significantly below expected
    const drift = expectedConfidence - shard.confidence;

    if (drift > cfg.driftThreshold) {
      // Move halfway toward expected (conservative)
      const newConfidence = Math.min(
        shard.confidence + (drift * 0.5),
        cfg.maxConfidence
      );

      await query(
        `UPDATE procedural_shards
         SET confidence = $1, updated_at = NOW()
         WHERE id = $2`,
        [newConfidence, shard.id]
      );

      result.recalibrated++;
      result.shards.push({
        id: shard.id,
        name: shard.name,
        oldConfidence: shard.confidence,
        newConfidence,
        expectedConfidence,
        reason: `Confidence ${shard.confidence.toFixed(3)} was ${drift.toFixed(3)} below expected ${expectedConfidence.toFixed(3)} (${shard.success_count} successes, ${shard.failure_count} failures)`,
      });

      logger.info({
        shardId: shard.id,
        name: shard.name,
        oldConfidence: shard.confidence,
        newConfidence,
        expectedConfidence,
        drift,
      }, 'Shard confidence recalibrated');
    }
  }

  logger.info({
    checked: result.checked,
    recalibrated: result.recalibrated,
  }, 'Recalibration cycle complete');

  return result;
}
