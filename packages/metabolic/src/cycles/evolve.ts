/**
 * Evolution Cycle
 *
 * Improves shards that have failures by using cross-model validation.
 * Sonnet generates the improvement, GPT-5.2 validates/fixes if needed.
 *
 * Process:
 * 1. Find shards with recent failures
 * 2. Get failure records from shard_executions
 * 3. Use improveProcedureWithValidation to evolve the logic
 * 4. Validate evolved logic against test cases
 * 5. Create new shard version if improvement passes
 */

import { query } from '@substrate/database';
import { procedural } from '@substrate/memory';
import { improveProcedureWithValidation } from '@substrate/ai';
import { execute } from '@substrate/sandbox';
import { publishEvent, Streams } from '@substrate/events';
import { createLogger } from '@substrate/observability';
import { shardLogicScanner, ids } from '@substrate/core';

const logger = createLogger({ component: 'evolve' });

export interface EvolutionConfig {
  minFailures: number;
  maxShardsPerCycle: number;
  maxFailuresToAnalyze: number;
  requiredPassRate: number;
}

const DEFAULT_CONFIG: EvolutionConfig = {
  minFailures: 2,
  maxShardsPerCycle: 5,
  maxFailuresToAnalyze: 10,
  requiredPassRate: 0.8,
};

export interface EvolutionResult {
  processed: number;
  evolved: number;
  failed: number;
  shards: Array<{
    shardId: string;
    name: string;
    success: boolean;
    reason?: string;
    newVersion?: number;
  }>;
}

interface FailureRecord {
  id: string;
  input: string;
  output: string | null;
  error: string | null;
}

/**
 * Run the evolution cycle
 */
export async function runEvolveCycle(
  config: Partial<EvolutionConfig> = {}
): Promise<EvolutionResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  logger.info('Starting evolution cycle');

  const result: EvolutionResult = {
    processed: 0,
    evolved: 0,
    failed: 0,
    shards: [],
  };

  // Find shards with failures
  const shardsWithFailures = await query<{
    id: string;
    name: string;
    version: number;
    logic: string;
    failure_count: number;
    success_count: number;
    lifecycle: string;
  }>(
    `SELECT id, name, version, logic, failure_count, success_count, lifecycle
     FROM procedural_shards
     WHERE failure_count >= $1
       AND lifecycle IN ('promoted', 'testing', 'candidate')
     ORDER BY failure_count DESC
     LIMIT $2`,
    [cfg.minFailures, cfg.maxShardsPerCycle]
  );

  if (shardsWithFailures.length === 0) {
    logger.info('No shards with failures found');
    return result;
  }

  logger.info({ count: shardsWithFailures.length }, 'Found shards with failures');

  for (const shard of shardsWithFailures) {
    try {
      // Get recent failures for this shard
      const failures = await query<FailureRecord>(
        `SELECT id, input, output, error
         FROM shard_executions
         WHERE shard_id = $1
           AND success = false
         ORDER BY created_at DESC
         LIMIT $2`,
        [shard.id, cfg.maxFailuresToAnalyze]
      );

      if (failures.length === 0) {
        logger.debug({ shardId: shard.id }, 'No failure records found');
        continue;
      }

      // Get some successful executions to understand expected behavior
      const successes = await query<{ input: string; output: string }>(
        `SELECT input, output
         FROM shard_executions
         WHERE shard_id = $1
           AND success = true
         ORDER BY created_at DESC
         LIMIT 5`,
        [shard.id]
      );

      // Format failures for the improvement function
      const failureData = failures.map(f => ({
        input: f.input,
        expected: f.error ? `Should not error: ${f.error}` : 'Valid output',
        actual: f.output || f.error || 'No output',
      }));

      // Create validator function that tests against failure cases
      const validator = async (logic: string): Promise<{ success: boolean; errors: string[] }> => {
        const errors: string[] = [];
        let passed = 0;

        // Test against successes (should still work)
        for (const s of successes) {
          try {
            const result = await execute(logic, s.input);
            if (result.success && result.output === s.output) {
              passed++;
            } else if (!result.success) {
              errors.push(`Regression: ${s.input} now errors: ${result.error}`);
            }
          } catch {
            errors.push(`Regression: ${s.input} threw exception`);
          }
        }

        // Test against failures (should now work or at least not error)
        for (const f of failures.slice(0, 5)) {
          try {
            const result = await execute(logic, f.input);
            if (result.success && result.output && result.output !== '') {
              passed++;
            } else if (!result.success) {
              errors.push(`Still failing: ${f.input} - ${result.error}`);
            }
          } catch {
            errors.push(`Still failing: ${f.input} threw exception`);
          }
        }

        const total = successes.length + Math.min(5, failures.length);
        const passRate = total > 0 ? passed / total : 0;

        return {
          success: passRate >= cfg.requiredPassRate && errors.length === 0,
          errors,
        };
      };

      logger.info({
        shardId: shard.id,
        name: shard.name,
        failureCount: failures.length,
      }, 'Attempting to evolve shard');

      // Use cross-model validation to improve the procedure
      const evolution = await improveProcedureWithValidation(
        shard.logic,
        failureData,
        validator
      );

      result.processed++;

      if (evolution.validationPassed && evolution.logic) {
        // Security scan the evolved logic before storing
        const scanResult = shardLogicScanner.scan(evolution.logic);
        if (scanResult.shouldBlock) {
          logger.warn({
            shardId: shard.id,
            name: shard.name,
            errors: scanResult.errors,
            riskLevel: scanResult.riskLevel,
          }, 'Evolved shard logic blocked by security scanner');

          result.failed++;
          result.shards.push({
            shardId: shard.id,
            name: shard.name,
            success: false,
            reason: `Security scan blocked: ${scanResult.errors.join('; ')}`,
          });
          continue;
        }

        if (scanResult.flagForReview) {
          logger.warn({
            shardId: shard.id,
            name: shard.name,
            warnings: scanResult.warnings,
            riskLevel: scanResult.riskLevel,
          }, 'Evolved shard logic flagged for review');
        }

        // Create new version of the shard
        const newVersion = shard.version + 1;
        const crossModelValidated = evolution.fixedBy === 'gpt5';

        await query(
          `UPDATE procedural_shards
           SET logic = $1,
               version = $2,
               failure_count = 0,
               updated_at = NOW()
           WHERE id = $3`,
          [evolution.logic, newVersion, shard.id]
        );

        // Record evolution in history
        await query(
          `INSERT INTO shard_evolutions (
            id, parent_shard_id, type, proposed_version, proposed_logic,
            reason, evidence, status, test_results, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())`,
          [
            ids.evolution(),
            shard.id,
            'improvement',
            newVersion,
            evolution.logic,
            'failure_recovery',
            failures.map(f => f.input),
            'approved',
            JSON.stringify({
              failuresAnalyzed: failures.length,
              model: evolution.evolvedBy,
              crossModelValidated,
              fromVersion: shard.version,
            }),
          ]
        );

        await publishEvent(Streams.SHARDS, {
          type: 'shard.evolved',
          source: 'evolve',
          payload: {
            shardId: shard.id,
            name: shard.name,
            fromVersion: shard.version,
            toVersion: newVersion,
            model: evolution.evolvedBy,
            crossModelValidated,
          },
        });

        result.evolved++;
        result.shards.push({
          shardId: shard.id,
          name: shard.name,
          success: true,
          newVersion,
        });

        logger.info({
          shardId: shard.id,
          name: shard.name,
          fromVersion: shard.version,
          toVersion: newVersion,
          model: evolution.evolvedBy,
        }, 'Shard evolved successfully');

      } else {
        result.failed++;
        result.shards.push({
          shardId: shard.id,
          name: shard.name,
          success: false,
          reason: 'Evolution did not pass validation',
        });

        logger.warn({
          shardId: shard.id,
          name: shard.name,
        }, 'Shard evolution failed validation');
      }

    } catch (error) {
      result.failed++;
      result.shards.push({
        shardId: shard.id,
        name: shard.name,
        success: false,
        reason: error instanceof Error ? error.message : 'Unknown error',
      });

      logger.error({
        shardId: shard.id,
        name: shard.name,
        error,
      }, 'Failed to evolve shard');
    }
  }

  logger.info({
    processed: result.processed,
    evolved: result.evolved,
    failed: result.failed,
  }, 'Evolution cycle complete');

  return result;
}

/**
 * Get shards that need evolution
 */
export async function getShardsNeedingEvolution(
  minFailures: number = 2
): Promise<Array<{
  id: string;
  name: string;
  failureCount: number;
  successRate: number;
}>> {
  const shards = await query<{
    id: string;
    name: string;
    failure_count: number;
    success_count: number;
  }>(
    `SELECT id, name, failure_count, success_count
     FROM procedural_shards
     WHERE failure_count >= $1
       AND lifecycle IN ('promoted', 'testing', 'candidate')
     ORDER BY failure_count DESC`,
    [minFailures]
  );

  return shards.map(s => ({
    id: s.id,
    name: s.name,
    failureCount: s.failure_count,
    successRate: s.success_count / Math.max(1, s.success_count + s.failure_count),
  }));
}
