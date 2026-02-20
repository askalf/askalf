/**
 * Classifier Seed (Layer 3 Bootstrap)
 *
 * Replays recent chat messages through the shadow classifier to build up
 * comparison data between the existing regex/embedding matching and the
 * LLM classifier. This accelerates shadow mode data collection.
 *
 * For each recent user message:
 * 1. Gather shard candidates (pattern + embedding matches)
 * 2. Run the classifier
 * 3. Compare with what actually happened (shard hit or not)
 * 4. Log the result for analysis
 */

import { query } from '@substrate/database';
import { procedural } from '@substrate/memory';
import { generateEmbedding, classifyShardMatch, logShadowComparison } from '@substrate/ai';
import type { ShardCandidate } from '@substrate/ai';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'classifier-seed' });

export interface SeedConfig {
  daysBack: number;
  maxMessages: number;
  batchSize: number;
  delayBetweenMs: number;
}

const DEFAULT_SEED_CONFIG: SeedConfig = {
  daysBack: 14,
  maxMessages: 200,
  batchSize: 10,
  delayBetweenMs: 500,
};

export interface SeedResult {
  processed: number;
  withCandidates: number;
  classifierMatched: number;
  classifierNoMatch: number;
  agreementsWithExisting: number;
  disagreementsWithExisting: number;
  errors: number;
}

interface ChatPair {
  userMessageId: string;
  userContent: string;
  responseShardId: string | null;
  responseShardName: string | null;
  responseModel: string | null;
}

/**
 * Run the classifier seed cycle
 */
export async function runClassifierSeed(
  config: Partial<SeedConfig> = {}
): Promise<SeedResult> {
  const cfg = { ...DEFAULT_SEED_CONFIG, ...config };

  logger.info({
    daysBack: cfg.daysBack,
    maxMessages: cfg.maxMessages,
  }, 'Starting classifier seed cycle');

  const result: SeedResult = {
    processed: 0,
    withCandidates: 0,
    classifierMatched: 0,
    classifierNoMatch: 0,
    agreementsWithExisting: 0,
    disagreementsWithExisting: 0,
    errors: 0,
  };

  // Fetch recent user messages paired with their responses
  const pairs = await query<{
    user_message_id: string;
    user_content: string;
    response_shard_id: string | null;
    response_shard_name: string | null;
    response_model: string | null;
  }>(`
    WITH user_msgs AS (
      SELECT
        m.id as user_message_id,
        m.content as user_content,
        m.session_id,
        m.created_at,
        ROW_NUMBER() OVER (ORDER BY m.created_at DESC) as rn
      FROM chat_messages m
      WHERE m.role = 'user'
        AND m.created_at > NOW() - INTERVAL '1 day' * $1
        AND LENGTH(m.content) > 3
        AND LENGTH(m.content) < 500
      ORDER BY m.created_at DESC
      LIMIT $2
    )
    SELECT
      u.user_message_id,
      u.user_content,
      r.shard_id as response_shard_id,
      r.shard_name as response_shard_name,
      r.model as response_model
    FROM user_msgs u
    LEFT JOIN LATERAL (
      SELECT shard_id, shard_name, model
      FROM chat_messages
      WHERE session_id = u.session_id
        AND role = 'assistant'
        AND created_at > u.created_at
      ORDER BY created_at ASC
      LIMIT 1
    ) r ON true
    ORDER BY u.created_at DESC
  `, [cfg.daysBack, cfg.maxMessages]);

  logger.info({ pairsFound: pairs.length }, 'Fetched chat message pairs');

  // Process in batches
  for (let i = 0; i < pairs.length; i += cfg.batchSize) {
    const batch = pairs.slice(i, i + cfg.batchSize);

    for (const pair of batch) {
      try {
        await processPair({
          userMessageId: pair.user_message_id,
          userContent: pair.user_content,
          responseShardId: pair.response_shard_id,
          responseShardName: pair.response_shard_name,
          responseModel: pair.response_model,
        }, result);
      } catch (err) {
        result.errors++;
        logger.error({
          messageId: pair.user_message_id,
          error: err instanceof Error ? err.message : String(err),
        }, 'Failed to process message pair');
      }
    }

    // Delay between batches to avoid overwhelming the LLM
    if (i + cfg.batchSize < pairs.length) {
      await new Promise(resolve => setTimeout(resolve, cfg.delayBetweenMs));
    }
  }

  logger.info(result, 'Classifier seed cycle complete');
  return result;
}

async function processPair(pair: ChatPair, result: SeedResult): Promise<void> {
  result.processed++;

  // Gather shard candidates
  const candidates: ShardCandidate[] = [];

  // Pattern matches
  try {
    const patternMatches = await procedural.findShardsByPattern(pair.userContent);
    for (const pm of patternMatches) {
      candidates.push({
        id: pm.id,
        name: pm.name,
        patterns: pm.patterns,
        intentTemplate: pm.intentTemplate,
        knowledgeType: pm.knowledgeType,
        confidence: pm.confidence,
      });
    }
  } catch {
    // Pattern matching failed, continue
  }

  // Embedding matches
  try {
    const embedding = await generateEmbedding(pair.userContent);
    const embeddingMatches = await procedural.findSimilarShardsByEmbedding(embedding, 0.5, 5);
    for (const em of embeddingMatches) {
      if (!candidates.find(c => c.id === em.id)) {
        candidates.push({
          id: em.id,
          name: em.name,
          patterns: em.patterns,
          intentTemplate: em.intentTemplate,
          knowledgeType: em.knowledgeType,
          confidence: em.confidence,
          similarity: em.similarity,
        });
      }
    }
  } catch {
    // Embedding matching failed, continue
  }

  if (candidates.length === 0) {
    return; // No candidates to classify
  }

  result.withCandidates++;

  // Run the classifier
  const classifierResult = await classifyShardMatch(pair.userContent, candidates, {
    shadowMode: true,
  });

  if (classifierResult.bestMatch) {
    result.classifierMatched++;
  } else {
    result.classifierNoMatch++;
  }

  // Compare with what actually happened
  const existingMatch = pair.responseShardId
    ? { shardId: pair.responseShardId, shardName: pair.responseShardName || 'unknown', method: 'existing' }
    : null;

  logShadowComparison(pair.userContent, existingMatch, classifierResult);

  // Track agreement
  const existingHit = pair.responseShardId || null;
  const classifierHit = classifierResult.bestMatch?.id || null;

  if (existingHit === classifierHit) {
    result.agreementsWithExisting++;
  } else {
    result.disagreementsWithExisting++;

    // Log disagreements with more detail for analysis
    logger.info({
      query: pair.userContent.substring(0, 100),
      existingHit: existingHit ? { id: existingHit, name: pair.responseShardName } : 'none',
      classifierHit: classifierHit ? { id: classifierHit, name: classifierResult.bestMatch?.name } : 'none',
      classifierConfidence: classifierResult.confidence,
      classifierReason: classifierResult.reason,
      candidateCount: candidates.length,
    }, 'SEED DISAGREEMENT — classifier and existing matching differ');
  }
}
