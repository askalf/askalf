import { procedural } from '@substrate/memory';
import { publishEvent, Streams } from '@substrate/events';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'decay' });

export interface DecayConfig {
  baseDecayRate: number;
  minDaysSinceUse: number;
  archiveThreshold: number;
  protectedSuccessRate: number;
}

const DEFAULT_CONFIG: DecayConfig = {
  baseDecayRate: 0.003, // 0.3% per day
  minDaysSinceUse: 5,
  archiveThreshold: 0.35,
  protectedSuccessRate: 0.9,
};

/**
 * Run the decay cycle
 * Reduces confidence of unused shards and archives low performers
 */
export async function runDecayCycle(
  config: Partial<DecayConfig> = {}
): Promise<{ decayed: number; archived: number }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  logger.info('Starting decay cycle');

  // Get shards that haven't been used recently (excludes immutable knowledge — those never decay)
  const staleShards = await procedural.getShardsForDecayExcludeImmutable(cfg.minDaysSinceUse);

  let decayed = 0;
  let archived = 0;

  for (const shard of staleShards) {
    // Calculate success rate
    const totalExecutions = shard.successCount + shard.failureCount;
    const successRate = totalExecutions > 0
      ? shard.successCount / totalExecutions
      : 0;

    // Protected shards (high success rate) decay slower
    const decayMultiplier = successRate >= cfg.protectedSuccessRate ? 0.5 : 1.0;
    const decayRate = cfg.baseDecayRate * decayMultiplier;

    // Apply decay
    await procedural.applyDecay(shard.id, decayRate);
    decayed++;

    // Archive if below threshold
    const newConfidence = shard.confidence - decayRate;
    if (newConfidence < cfg.archiveThreshold) {
      await procedural.updateLifecycle(shard.id, 'archived');
      archived++;

      await publishEvent(Streams.SHARDS, {
        type: 'shard.archived',
        source: 'decay',
        payload: {
          shardId: shard.id,
          name: shard.name,
          finalConfidence: newConfidence,
          reason: 'low_confidence_unused',
        },
      });

      logger.info({
        shardId: shard.id,
        name: shard.name,
        confidence: newConfidence,
      }, 'Shard archived due to decay');
    }
  }

  logger.info({ decayed, archived }, 'Decay cycle complete');

  return { decayed, archived };
}

/**
 * Reinforce a shard after successful execution
 */
export async function reinforceShard(
  shardId: string,
  boost: number = 0.008
): Promise<void> {
  await procedural.recordExecution(shardId, true, 0, 0);
  logger.debug({ shardId, boost }, 'Shard reinforced');
}
