/**
 * Reseed/Resynthesize Cycle
 *
 * Provides controlled reset capabilities:
 * - Full reseed: Deletes all shards and re-crystallizes from traces
 * - Partial reseed: Re-synthesizes specific shard categories
 * - Re-cluster: Re-runs intent extraction on traces for better clustering
 *
 * USE WITH CAUTION: This can reset learned knowledge.
 */

import { query } from '@substrate/database';
import { extractIntent, generateEmbedding, hashIntentTemplate } from '@substrate/ai';
import { publishEvent, Streams } from '@substrate/events';
import { createLogger } from '@substrate/observability';
import { runCrystallizeCycle } from './crystallize.js';

const logger = createLogger({ component: 'reseed' });

export interface ReseedConfig {
  preservePromotedShards: boolean;
  preserveHighConfidence: boolean;
  confidenceThreshold: number;
  reExtractIntents: boolean;
  regenerateEmbeddings: boolean;
}

const DEFAULT_CONFIG: ReseedConfig = {
  preservePromotedShards: false,
  preserveHighConfidence: true,
  confidenceThreshold: 0.8,
  reExtractIntents: true,
  regenerateEmbeddings: true,
};

export interface ReseedResult {
  shardsDeleted: number;
  shardsPreserved: number;
  tracesReprocessed: number;
  intentsReExtracted: number;
  embeddingsRegenerated: number;
  newShardsCreated: number;
}

/**
 * Full reseed - reset shards and re-crystallize from traces
 */
export async function runFullReseed(
  config: Partial<ReseedConfig> = {}
): Promise<ReseedResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  logger.warn('Starting FULL RESEED - this will reset procedural memory');

  const result: ReseedResult = {
    shardsDeleted: 0,
    shardsPreserved: 0,
    tracesReprocessed: 0,
    intentsReExtracted: 0,
    embeddingsRegenerated: 0,
    newShardsCreated: 0,
  };

  // Step 1: Identify shards to preserve vs delete
  const shardsToPreserve = cfg.preserveHighConfidence
    ? await query<{ id: string }>(
        `SELECT id FROM procedural_shards WHERE confidence >= $1`,
        [cfg.confidenceThreshold]
      )
    : [];

  const preserveIds = new Set(shardsToPreserve.map(s => s.id));
  result.shardsPreserved = preserveIds.size;

  // Step 2: Unlink traces from shards being deleted
  await query(
    `UPDATE reasoning_traces
     SET attracted_to_shard = NULL, synthesized = false
     WHERE attracted_to_shard NOT IN (SELECT unnest($1::text[]))`,
    [Array.from(preserveIds)]
  );

  // Step 3: Delete episodes linked to shards being deleted
  await query(
    `DELETE FROM episodes
     WHERE related_shard_id IS NOT NULL
       AND related_shard_id NOT IN (SELECT unnest($1::text[]))`,
    [Array.from(preserveIds)]
  );

  // Step 4: Delete shard executions for shards being deleted
  await query(
    `DELETE FROM shard_executions
     WHERE shard_id NOT IN (SELECT unnest($1::text[]))`,
    [Array.from(preserveIds)]
  );

  // Step 5: Delete evolutions for shards being deleted
  await query(
    `DELETE FROM shard_evolutions
     WHERE parent_shard_id NOT IN (SELECT unnest($1::text[]))`,
    [Array.from(preserveIds)]
  );

  // Step 6: Delete shards not being preserved
  const deleteResult = await query(
    `DELETE FROM procedural_shards
     WHERE id NOT IN (SELECT unnest($1::text[]))
     RETURNING id`,
    [Array.from(preserveIds)]
  );
  result.shardsDeleted = deleteResult.length;

  logger.info({
    deleted: result.shardsDeleted,
    preserved: result.shardsPreserved,
  }, 'Shards reset');

  // Step 7: Re-extract intents if configured
  if (cfg.reExtractIntents) {
    const traces = await query<{ id: string; input: string; output: string }>(
      `SELECT id, input, output FROM reasoning_traces WHERE synthesized = false`
    );

    for (const trace of traces) {
      try {
        const intent = await extractIntent(trace.input, trace.output);
        const intentHash = hashIntentTemplate(intent.template);

        await query(
          `UPDATE reasoning_traces
           SET intent_template = $1, intent_category = $2, intent_name = $3,
               intent_parameters = $4
           WHERE id = $5`,
          [intent.template, intent.category, intent.intentName,
           JSON.stringify(intent.parameters), trace.id]
        );

        result.intentsReExtracted++;
      } catch (err) {
        logger.error({ traceId: trace.id, error: err }, 'Failed to re-extract intent');
      }
    }

    logger.info({ count: result.intentsReExtracted }, 'Intents re-extracted');
  }

  // Step 8: Regenerate embeddings if configured
  if (cfg.regenerateEmbeddings) {
    const traces = await query<{ id: string; input: string; output: string }>(
      `SELECT id, input, output FROM reasoning_traces WHERE synthesized = false`
    );

    for (const trace of traces) {
      try {
        const embedding = await generateEmbedding(`${trace.input} ${trace.output}`);
        await query(
          `UPDATE reasoning_traces SET embedding = $1 WHERE id = $2`,
          [`[${embedding.join(',')}]`, trace.id]
        );
        result.embeddingsRegenerated++;
      } catch (err) {
        logger.error({ traceId: trace.id, error: err }, 'Failed to regenerate embedding');
      }
    }

    logger.info({ count: result.embeddingsRegenerated }, 'Embeddings regenerated');
  }

  // Step 9: Re-crystallize
  const crystallizeResult = await runCrystallizeCycle({ minTracesPerCluster: 2 });
  result.newShardsCreated = crystallizeResult.shardsCreated;
  result.tracesReprocessed = crystallizeResult.tracesProcessed;

  // Publish event
  await publishEvent(Streams.SHARDS, {
    type: 'system.reseed',
    source: 'reseed',
    payload: result as unknown as Record<string, unknown>,
  });

  logger.warn(result, 'FULL RESEED complete');

  return result;
}

/**
 * Soft reseed - only reset testing/candidate shards, keep promoted
 */
export async function runSoftReseed(): Promise<ReseedResult> {
  return runFullReseed({
    preservePromotedShards: true,
    preserveHighConfidence: false,
    confidenceThreshold: 0,
    reExtractIntents: false,
    regenerateEmbeddings: false,
  });
}

/**
 * Re-cluster traces without deleting shards
 * Useful when intent extraction has been improved
 */
export async function reClusterTraces(): Promise<{ reprocessed: number }> {
  logger.info('Re-clustering traces with new intent extraction');

  const traces = await query<{ id: string; input: string; output: string }>(
    `SELECT id, input, output FROM reasoning_traces`
  );

  let reprocessed = 0;

  for (const trace of traces) {
    try {
      const intent = await extractIntent(trace.input, trace.output);
      const embedding = await generateEmbedding(`${trace.input} ${trace.output}`);

      await query(
        `UPDATE reasoning_traces
         SET intent_template = $1,
             intent_category = $2,
             intent_name = $3,
             intent_parameters = $4,
             embedding = $5
         WHERE id = $6`,
        [
          intent.template,
          intent.category,
          intent.intentName,
          JSON.stringify(intent.parameters),
          `[${embedding.join(',')}]`,
          trace.id,
        ]
      );

      reprocessed++;
    } catch (err) {
      logger.error({ traceId: trace.id, error: err }, 'Failed to re-cluster trace');
    }
  }

  logger.info({ reprocessed }, 'Trace re-clustering complete');

  return { reprocessed };
}

/**
 * Migrate non-hybrid shards to hybrid synthesis.
 * Specifically targets shards synthesized with old methods and re-crystallizes them.
 */
export async function migrateToHybrid(): Promise<{
  oldShardsRemoved: number;
  tracesUnlinked: number;
  newShardsCreated: number;
  episodesPreserved: number;
}> {
  logger.info('Starting migration to hybrid synthesis');

  // Step 1: Find non-hybrid shards
  const nonHybridShards = await query<{ id: string; name: string }>(
    `SELECT id, name FROM procedural_shards
     WHERE synthesis_method NOT LIKE 'crystallize-hybrid-%'
       AND synthesis_method IS NOT NULL`
  );

  if (nonHybridShards.length === 0) {
    logger.info('No non-hybrid shards found, nothing to migrate');
    return { oldShardsRemoved: 0, tracesUnlinked: 0, newShardsCreated: 0, episodesPreserved: 0 };
  }

  const shardIds = nonHybridShards.map(s => s.id);
  logger.info({ count: shardIds.length }, 'Found non-hybrid shards to migrate');

  // Step 2: Count episodes that will be preserved (they'll be orphaned but kept for learning)
  const episodeCount = await query<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM episodes WHERE related_shard_id = ANY($1)`,
    [shardIds]
  );
  const episodesPreserved = episodeCount[0]?.count ?? 0;

  // Step 3: Unlink episodes from shards (preserve for lesson learning)
  await query(
    `UPDATE episodes SET related_shard_id = NULL WHERE related_shard_id = ANY($1)`,
    [shardIds]
  );

  // Step 4: Unlink traces from old shards (mark for re-synthesis)
  const unlinkResult = await query(
    `UPDATE reasoning_traces
     SET attracted_to_shard = NULL, synthesized = false
     WHERE attracted_to_shard = ANY($1)
     RETURNING id`,
    [shardIds]
  );
  const tracesUnlinked = unlinkResult.length;

  // Step 5: Delete shard executions for old shards
  await query(`DELETE FROM shard_executions WHERE shard_id = ANY($1)`, [shardIds]);

  // Step 6: Delete shard evolutions for old shards
  await query(`DELETE FROM shard_evolutions WHERE parent_shard_id = ANY($1)`, [shardIds]);

  // Step 7: Delete old shards
  await query(`DELETE FROM procedural_shards WHERE id = ANY($1)`, [shardIds]);

  logger.info({
    shardsRemoved: shardIds.length,
    tracesUnlinked,
    episodesPreserved,
  }, 'Old shards removed, traces ready for re-synthesis');

  // Step 8: Re-crystallize with hybrid approach
  const crystallizeResult = await runCrystallizeCycle({ minTracesPerCluster: 2 });

  logger.info({
    oldShardsRemoved: shardIds.length,
    tracesUnlinked,
    newShardsCreated: crystallizeResult.shardsCreated,
    episodesPreserved,
  }, 'Hybrid migration complete');

  return {
    oldShardsRemoved: shardIds.length,
    tracesUnlinked,
    newShardsCreated: crystallizeResult.shardsCreated,
    episodesPreserved,
  };
}

/**
 * Get stats about what would be affected by a reseed
 */
export async function getReseedPreview(
  config: Partial<ReseedConfig> = {}
): Promise<{
  shardsToDelete: number;
  shardsToPreserve: number;
  tracesToReprocess: number;
  episodesToDelete: number;
}> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const preserveCondition = cfg.preserveHighConfidence
    ? `confidence >= ${cfg.confidenceThreshold}`
    : 'FALSE';

  const stats = await query<{
    shards_to_delete: number;
    shards_to_preserve: number;
    traces_to_reprocess: number;
    episodes_to_delete: number;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM procedural_shards WHERE NOT (${preserveCondition})) as shards_to_delete,
      (SELECT COUNT(*) FROM procedural_shards WHERE ${preserveCondition}) as shards_to_preserve,
      (SELECT COUNT(*) FROM reasoning_traces WHERE synthesized = false OR attracted_to_shard IN (
        SELECT id FROM procedural_shards WHERE NOT (${preserveCondition})
      )) as traces_to_reprocess,
      (SELECT COUNT(*) FROM episodes WHERE related_shard_id IN (
        SELECT id FROM procedural_shards WHERE NOT (${preserveCondition})
      )) as episodes_to_delete
  `);

  return {
    shardsToDelete: Number(stats[0]?.shards_to_delete ?? 0),
    shardsToPreserve: Number(stats[0]?.shards_to_preserve ?? 0),
    tracesToReprocess: Number(stats[0]?.traces_to_reprocess ?? 0),
    episodesToDelete: Number(stats[0]?.episodes_to_delete ?? 0),
  };
}
