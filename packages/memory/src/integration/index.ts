// MEMORY INTEGRATION LAYER
// Bridges procedural shards with episodic, semantic, and working memory
// Enables shards to learn from past experiences and access accumulated knowledge

import { query } from '@substrate/database';
import { generateEmbedding } from '@substrate/ai';
import * as episodic from '../episodic/index.js';
import * as semantic from '../semantic/index.js';
import * as working from '../working/index.js';
import type { TenantContext } from '../procedural/store.js';

// ============================================
// MEMORY CONTEXT TYPES
// ============================================

export interface MemoryContext {
  // Similar past experiences (SAO chains)
  episodes: Array<{
    id: string;
    situation: Record<string, unknown>;
    action: Record<string, unknown>;
    outcome: Record<string, unknown>;
    success: boolean | undefined;
    summary: string;
    similarity?: number;
  }>;

  // Relevant facts from truth store
  facts: Array<{
    id: string;
    statement: string;
    confidence: number;
    category?: string;
    similarity?: number;
  }>;

  // Current session context
  workingContext: Array<{
    id: string;
    contentType: string;
    summary: string;
    importance: number;
  }>;

  // Aggregated insights
  insights: {
    successPatterns: string[];  // What worked in similar situations
    failurePatterns: string[];  // What failed in similar situations
    relevantKnowledge: string[];  // Key facts to consider
    sessionContext: string;  // Compressed current context
  };
}

export interface MemoryEnrichedInput {
  // Original input to the shard
  original: unknown;

  // Memory context for decision-making
  memory: MemoryContext;

  // Compact memory summary for constrained shards
  memorySummary: string;
}

// ============================================
// MEMORY GATHERING
// ============================================

/**
 * Gather relevant memory context for a shard execution
 * @param query - The user query or situation description
 * @param shardName - Name of the shard being executed (for finding related episodes)
 * @param sessionId - Current session ID (for working memory)
 * @param tenant - Tenant context for visibility filtering
 */
export async function gatherMemoryContext(
  searchQuery: string,
  shardName?: string,
  sessionId?: string,
  tenant?: TenantContext
): Promise<MemoryContext> {
  // Parallel fetch all memory types
  const [similarEpisodes, similarFacts, sessionContext] = await Promise.all([
    // Find similar past experiences (exclude shard_execution noise from general search)
    episodic.findSimilarEpisodes(searchQuery, 5, tenant, ['shard_execution']).catch(() => []),

    // Find relevant facts
    semantic.findSimilarFacts(searchQuery, 5, tenant).catch(() => []),

    // Get working context if session provided
    sessionId
      ? working.getContextForContinuation(sessionId, searchQuery, 1000).catch(() => ({
          summary: '',
          contexts: [],
          totalTokens: 0,
        }))
      : Promise.resolve({ summary: '', contexts: [], totalTokens: 0 }),
  ]);

  // If we have a shard name, also look for episodes specifically related to this shard
  let shardEpisodes: typeof similarEpisodes = [];
  if (shardName) {
    try {
      shardEpisodes = await episodic.findSimilarEpisodes(`shard execution: ${shardName}`, 3, tenant);
    } catch {
      // Ignore errors
    }
  }

  // Combine and deduplicate episodes
  const allEpisodeIds = new Set<string>();
  const combinedEpisodes = [...similarEpisodes, ...shardEpisodes].filter(ep => {
    if (allEpisodeIds.has(ep.id)) return false;
    allEpisodeIds.add(ep.id);
    return true;
  });

  // Extract insights from episodes
  const successPatterns: string[] = [];
  const failurePatterns: string[] = [];

  for (const ep of combinedEpisodes) {
    if (ep.success === true && ep.lessonsLearned?.length) {
      successPatterns.push(...ep.lessonsLearned);
    } else if (ep.success === false && ep.lessonsLearned?.length) {
      failurePatterns.push(...ep.lessonsLearned);
    }
  }

  // Extract key facts
  const relevantKnowledge = similarFacts
    .filter(f => f.confidence >= 0.7)
    .map(f => f.statement);

  return {
    episodes: combinedEpisodes.map(ep => ({
      id: ep.id,
      situation: ep.situation,
      action: ep.action,
      outcome: ep.outcome,
      success: ep.success,
      summary: ep.summary,
    })),

    facts: similarFacts.map(f => {
      const fact: MemoryContext['facts'][number] = {
        id: f.id,
        statement: f.statement,
        confidence: f.confidence,
      };
      if (f.category !== undefined) {
        fact.category = f.category;
      }
      return fact;
    }),

    workingContext: sessionContext.contexts.map(ctx => ({
      id: ctx.id,
      contentType: ctx.contentType,
      summary: (ctx as Record<string, unknown>)['summary'] as string || ctx.rawContent.substring(0, 200),
      importance: (ctx as Record<string, unknown>)['importance'] as number || 0.5,
    })),

    insights: {
      successPatterns: [...new Set(successPatterns)].slice(0, 5),
      failurePatterns: [...new Set(failurePatterns)].slice(0, 5),
      relevantKnowledge: [...new Set(relevantKnowledge)].slice(0, 5),
      sessionContext: sessionContext.summary,
    },
  };
}

/**
 * Create memory-enriched input for a shard
 * @param originalInput - The original input to the shard
 * @param searchQuery - Query for memory search (can be derived from input)
 * @param shardName - Name of the shard
 * @param sessionId - Current session ID
 * @param tenant - Tenant context
 */
export async function enrichInputWithMemory(
  originalInput: unknown,
  searchQuery: string,
  shardName?: string,
  sessionId?: string,
  tenant?: TenantContext
): Promise<MemoryEnrichedInput> {
  const memory = await gatherMemoryContext(searchQuery, shardName, sessionId, tenant);

  // Build compact summary for shards with limited context
  const summaryParts: string[] = [];

  if (memory.insights.successPatterns.length > 0) {
    summaryParts.push(`WHAT WORKED: ${memory.insights.successPatterns.join('; ')}`);
  }

  if (memory.insights.failurePatterns.length > 0) {
    summaryParts.push(`WHAT FAILED: ${memory.insights.failurePatterns.join('; ')}`);
  }

  if (memory.insights.relevantKnowledge.length > 0) {
    summaryParts.push(`KNOWN FACTS: ${memory.insights.relevantKnowledge.join('; ')}`);
  }

  if (memory.insights.sessionContext) {
    summaryParts.push(`CONTEXT: ${memory.insights.sessionContext.substring(0, 200)}`);
  }

  return {
    original: originalInput,
    memory,
    memorySummary: summaryParts.join('\n') || 'No relevant memory context found.',
  };
}

// ============================================
// EXECUTION RECORDING
// ============================================

/**
 * Record a shard execution as an episode for future learning.
 *
 * Only records episodes worth remembering:
 * - Failures (always important to learn from)
 * - Memory-assisted executions (track if memory helped)
 * - Slow executions (> 5s, potential performance issues)
 *
 * Routine successes without memory are NOT recorded to avoid noise.
 * Returns empty string if skipped.
 */
export async function recordExecutionAsEpisode(
  shardId: string,
  shardName: string,
  input: unknown,
  output: unknown,
  success: boolean,
  executionMs: number,
  memoryContext?: MemoryContext,
  tenant?: TenantContext
): Promise<string> {
  // Skip routine successes - only record episodes worth learning from
  const isFailure = !success;
  const usedMemory = !!memoryContext && (memoryContext.episodes.length > 0 || memoryContext.facts.length > 0);
  const isSlow = executionMs > 5000;

  if (success && !usedMemory && !isSlow) {
    return ''; // Routine success, nothing to learn
  }

  // Build SAO (Situation-Action-Outcome) chain matching Episode schema
  const inputStr = typeof input === 'string' ? input.substring(0, 500) : JSON.stringify(input).substring(0, 500);
  const outputStr = typeof output === 'string' ? output.substring(0, 500) : JSON.stringify(output).substring(0, 500);

  const situation = {
    context: `Shard execution: ${shardName} with ${memoryContext ? 'memory context' : 'no memory'}`,
    entities: [shardName, shardId],
    state: {
      input: inputStr,
      memoryAvailable: !!memoryContext,
      episodesConsidered: memoryContext?.episodes.length || 0,
      factsConsidered: memoryContext?.facts.length || 0,
    } as Record<string, unknown>,
  };

  const action = {
    type: 'shard_execution',
    description: `Execute shard ${shardName}`,
    parameters: {
      shardId,
      executionMs,
    } as Record<string, unknown>,
  };

  const outcome = {
    result: outputStr,
    success,
    effects: success ? ['shard_executed_successfully'] : ['shard_execution_failed'],
    metrics: {
      executionMs,
      episodesUsed: memoryContext?.episodes.length || 0,
      factsUsed: memoryContext?.facts.length || 0,
    } as Record<string, number>,
  };

  // Derive lessons from the execution
  const lessons: string[] = [];
  if (success) {
    if (memoryContext?.episodes.length) {
      lessons.push(`Memory context helped: ${memoryContext.episodes.length} similar experiences consulted`);
    }
    lessons.push(`Shard ${shardName} succeeded with this input pattern`);
  } else {
    lessons.push(`Shard ${shardName} failed - may need refinement`);
    if (!memoryContext?.episodes.length) {
      lessons.push('No prior experience was available - consider building more examples');
    }
  }

  const episode = await episodic.recordEpisode(
    {
      type: 'shard_execution',
      situation,
      action,
      outcome,
      summary: `Executed ${shardName}: ${success ? 'SUCCESS' : 'FAILURE'} in ${executionMs}ms`,
      success,
      valence: success ? 'positive' as const : 'negative' as const,
      importance: isFailure ? 0.8 : isSlow ? 0.6 : 0.5, // Failures most important, then slow, then memory-assisted
      lessonsLearned: lessons,
      relatedShardId: shardId,
      timestamp: new Date(),
      metadata: {
        memoryIntegrated: !!memoryContext,
      } as Record<string, unknown>,
    },
    tenant ? { tenant, visibility: 'private' as const } : { visibility: 'private' as const }
  );

  return episode.id;
}

// ============================================
// MEMORY-AWARE SHARD LOOKUP
// ============================================

/**
 * Find the best shard for a query, considering past execution history
 * Uses memory to boost shards that have succeeded with similar inputs
 */
export async function findBestShardWithMemory(
  searchQuery: string,
  tenant?: TenantContext
): Promise<Array<{
  shardId: string;
  shardName: string;
  confidence: number;
  memoryBoost: number;
  reason: string;
}>> {
  // Find similar past episodes to see what shards worked
  const episodes = await episodic.findSimilarEpisodes(searchQuery, 10, tenant);

  // Count successes/failures by shard
  const shardStats: Map<string, { successes: number; failures: number; shardName: string }> = new Map();

  for (const ep of episodes) {
    const shardId = ep.relatedShardId;
    if (!shardId) continue;

    const shardName = (ep.situation as { shardName?: string })?.shardName || 'unknown';
    const stats = shardStats.get(shardId) || { successes: 0, failures: 0, shardName };

    if (ep.success === true) {
      stats.successes++;
    } else if (ep.success === false) {
      stats.failures++;
    }

    shardStats.set(shardId, stats);
  }

  // Calculate memory-based recommendations
  const recommendations: Array<{
    shardId: string;
    shardName: string;
    confidence: number;
    memoryBoost: number;
    reason: string;
  }> = [];

  for (const [shardId, stats] of shardStats) {
    const total = stats.successes + stats.failures;
    if (total === 0) continue;

    const successRate = stats.successes / total;
    const memoryBoost = (successRate - 0.5) * 0.2; // -0.1 to +0.1 boost

    recommendations.push({
      shardId,
      shardName: stats.shardName,
      confidence: successRate,
      memoryBoost,
      reason: `${stats.successes}/${total} successful executions on similar inputs`,
    });
  }

  // Sort by confidence
  recommendations.sort((a, b) => b.confidence - a.confidence);

  return recommendations;
}

// ============================================
// MEMORY HEALTH CHECK
// ============================================

/**
 * Check health of all memory systems
 */
export async function checkMemoryHealth(): Promise<{
  episodic: { count: number; recentCount: number; healthy: boolean };
  semantic: { count: number; highConfidenceCount: number; healthy: boolean };
  working: { activeCount: number; expiredCount: number; healthy: boolean };
  integration: { executionsWithMemory: number; successRate: number; healthy: boolean };
}> {
  const [episodicStats, semanticStats, workingStats, integrationStats] = await Promise.all([
    query<{ total: string; recent: string }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as recent
      FROM episodes
    `),

    query<{ total: string; high_conf: string }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE confidence >= 0.8) as high_conf
      FROM knowledge_facts
    `),

    query<{ active: string; expired: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > NOW()) as active,
        COUNT(*) FILTER (WHERE expires_at <= NOW()) as expired
      FROM working_contexts
    `),

    query<{ with_memory: string; success_rate: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE metadata->>'memoryIntegrated' = 'true') as with_memory,
        COALESCE(
          AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) FILTER (WHERE metadata->>'memoryIntegrated' = 'true'),
          0.5
        ) as success_rate
      FROM episodes
      WHERE type = 'shard_execution'
        AND created_at > NOW() - INTERVAL '7 days'
    `),
  ]);

  const ep = episodicStats[0] || { total: '0', recent: '0' };
  const sem = semanticStats[0] || { total: '0', high_conf: '0' };
  const wrk = workingStats[0] || { active: '0', expired: '0' };
  const int = integrationStats[0] || { with_memory: '0', success_rate: '0.5' };

  return {
    episodic: {
      count: parseInt(ep.total, 10),
      recentCount: parseInt(ep.recent, 10),
      healthy: parseInt(ep.recent, 10) > 0,
    },
    semantic: {
      count: parseInt(sem.total, 10),
      highConfidenceCount: parseInt(sem.high_conf, 10),
      healthy: parseInt(sem.total, 10) > 0,
    },
    working: {
      activeCount: parseInt(wrk.active, 10),
      expiredCount: parseInt(wrk.expired, 10),
      healthy: true, // Working memory is ephemeral, always considered healthy
    },
    integration: {
      executionsWithMemory: parseInt(int.with_memory, 10),
      successRate: parseFloat(int.success_rate),
      healthy: parseFloat(int.success_rate) >= 0.5,
    },
  };
}
