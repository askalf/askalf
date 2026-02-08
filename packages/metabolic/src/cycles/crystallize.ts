import { query } from '@substrate/database';
import { procedural, TenantContext, Visibility, CommunityStatus } from '@substrate/memory';
import { synthesizeWithValidation, generateEmbedding, ValidationResult, ModelStats } from '@substrate/ai';
import { publishEvent, Streams } from '@substrate/events';
import { createLogger } from '@substrate/observability';
import { execute as sandboxExecute } from '@substrate/sandbox';

const logger = createLogger({ component: 'crystallize' });

/**
 * Get model performance stats from production episode data.
 * Tracks which model (sonnet vs gpt5) produced shards with fewer runtime failures.
 */
async function getModelStats(): Promise<ModelStats> {
  const results = await query<{
    synthesis_method: string;
    success_count: number;
    failure_count: number;
  }>(`
    SELECT
      ps.synthesis_method,
      COUNT(CASE WHEN e.success = true THEN 1 END)::int as success_count,
      COUNT(CASE WHEN e.success = false THEN 1 END)::int as failure_count
    FROM episodes e
    JOIN procedural_shards ps ON e.related_shard_id = ps.id
    WHERE ps.synthesis_method LIKE 'crystallize-hybrid-%'
    GROUP BY ps.synthesis_method
  `);

  const stats: ModelStats = {
    sonnet: { successes: 0, failures: 0 },
    gpt5: { successes: 0, failures: 0 },
  };

  for (const row of results) {
    if (row.synthesis_method.includes('sonnet')) {
      stats.sonnet.successes += row.success_count;
      stats.sonnet.failures += row.failure_count;
    }
    if (row.synthesis_method.includes('gpt5')) {
      stats.gpt5.successes += row.success_count;
      stats.gpt5.failures += row.failure_count;
    }
  }

  logger.debug({ stats }, 'Model performance stats');
  return stats;
}

export interface CrystallizeConfig {
  minTracesPerCluster: number;
  maxClustersPerCycle: number;
}

const DEFAULT_CONFIG: CrystallizeConfig = {
  minTracesPerCluster: 2,
  maxClustersPerCycle: 25,
};

/**
 * Run the crystallization cycle
 * Clusters traces by INTENT TEMPLATE (not pattern hash) and synthesizes shards
 */
export async function runCrystallizeCycle(
  config: Partial<CrystallizeConfig> = {}
): Promise<{ shardsCreated: number; tracesProcessed: number }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  logger.info('Starting crystallization cycle');

  // Get unsynthesized traces WITH intent_template and owner info
  const traces = await query<{
    id: string;
    input: string;
    output: string;
    reasoning: string | null;
    intent_template: string | null;
    intent_category: string | null;
    pattern_hash: string;
    embedding: number[] | null;
    owner_id: string | null;
    visibility: string | null;
  }>(
    `SELECT id, input, output, reasoning, intent_template, intent_category, pattern_hash, embedding, owner_id, visibility
     FROM reasoning_traces
     WHERE synthesized = false
     ORDER BY timestamp DESC
     LIMIT 500`
  );

  if (traces.length === 0) {
    logger.info('No unsynthesized traces found');
    return { shardsCreated: 0, tracesProcessed: 0 };
  }

  logger.info({ traceCount: traces.length }, 'Found traces to process');

  // Cluster traces by OWNER_ID + INTENT TEMPLATE (multi-tenant aware)
  // This ensures different tenants' traces don't get mixed together
  // Falls back to pattern_hash for traces without intent_template
  const clusters = new Map<string, typeof traces>();
  for (const trace of traces) {
    // Use owner_id as prefix to separate tenant traces
    // NULL owner_id becomes 'public' (system-owned, can be mixed)
    const ownerPrefix = trace.owner_id ?? 'public';
    const intentKey = trace.intent_template || trace.pattern_hash;
    const clusterKey = `${ownerPrefix}::${intentKey}`;
    const existing = clusters.get(clusterKey) ?? [];
    existing.push(trace);
    clusters.set(clusterKey, existing);
  }

  let shardsCreated = 0;
  let tracesProcessed = 0;

  // Process clusters that meet threshold
  for (const [clusterKey, clusterTraces] of clusters) {
    if (clusterTraces.length < cfg.minTracesPerCluster) {
      continue;
    }

    if (shardsCreated >= cfg.maxClustersPerCycle) {
      break;
    }

    // Get the intent template (first trace with one, or null)
    const intentTemplate = clusterTraces.find(t => t.intent_template)?.intent_template;
    const intentCategory = clusterTraces.find(t => t.intent_category)?.intent_category;

    // Get owner info from traces (all traces in cluster have same owner due to clustering)
    // We know clusterTraces has at least minTracesPerCluster elements due to the filter above
    const firstTrace = clusterTraces[0]!;
    const ownerId = firstTrace.owner_id;
    const traceVisibility = firstTrace.visibility;

    // Build tenant context if there's an owner
    const tenantContext: TenantContext | undefined = ownerId
      ? { tenantId: ownerId }
      : undefined;

    // Determine shard visibility and community status:
    // SIMPLIFIED MODEL:
    // - ALF Public: owner_id=NULL, visibility='public', community_status=NULL
    // - Community Public: owner_id set, visibility='public', community_status='approved'
    // - Private: owner_id set, visibility='private', community_status=NULL
    const shardVisibility: Visibility = ownerId && traceVisibility === 'private'
      ? 'private'
      : 'public';

    // Community status for user-owned public shards (auto-approved since from their own traces)
    const communityStatus: CommunityStatus = ownerId && shardVisibility === 'public' ? 'approved' : null;

    try {
      // Synthesize procedure from cluster using HYBRID parallel approach
      const traceData = clusterTraces.map(t => {
        const trace: { input: string; output: string; reasoning?: string } = {
          input: t.input,
          output: t.output,
        };
        if (t.reasoning) {
          trace.reasoning = t.reasoning;
        }
        return trace;
      });

      // Create validator that tests synthesized code against trace examples
      const validator = async (logic: string): Promise<ValidationResult> => {
        const failedInputs: Array<{ input: string; expected: string; actual: string }> = [];

        for (const trace of traceData.slice(0, 3)) { // Test first 3 traces
          try {
            const result = await sandboxExecute(logic, trace.input);
            if (!result.success) {
              return { success: false, error: result.error || 'Execution failed' };
            }
            // Check if output matches (trim whitespace, case-insensitive for strings)
            const expected = trace.output.trim();
            const actual = String(result.output).trim();
            if (expected.toLowerCase() !== actual.toLowerCase() && expected !== actual) {
              failedInputs.push({ input: trace.input, expected, actual });
            }
          } catch (error) {
            return { success: false, error: String(error) };
          }
        }

        if (failedInputs.length > 0) {
          return { success: false, failedInputs };
        }
        return { success: true };
      };

      // Use hybrid parallel synthesis with validation and production stats
      const synthesized = await synthesizeWithValidation(traceData, validator, getModelStats);

      logger.info({
        synthesizedBy: synthesized.synthesizedBy,
        fixedBy: synthesized.fixedBy,
        validationPassed: synthesized.validationPassed,
        attempts: synthesized.attempts,
        parallelRace: synthesized.parallelRace,
      }, 'Hybrid synthesis complete');

      // Generate embedding for the procedure based on intent template or patterns
      const embeddingText = intentTemplate || synthesized.patterns.join(' ');
      const embedding = await generateEmbedding(embeddingText);

      // Create the shard with tenant context
      // Extract the intent key from clusterKey (remove owner prefix)
      const intentKey = clusterKey.split('::')[1] || clusterKey;

      // Build options with tenant context and community status
      const options = tenantContext
        ? { tenant: tenantContext, visibility: shardVisibility, communityStatus }
        : { visibility: shardVisibility };

      const shard = await procedural.createShard({
        name: synthesized.name,
        version: 1,
        logic: synthesized.logic,
        inputSchema: {},
        outputSchema: {},
        patterns: synthesized.patterns,
        embedding,
        patternHash: intentKey, // Use just the intent key, not the full cluster key
        intentTemplate: intentTemplate || undefined,
        confidence: 0.65,
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        avgLatencyMs: 0,
        tokensSaved: 0,
        estimatedTokens: 100, // Default estimate for newly crystallized shards
        synthesisMethod: `crystallize-hybrid-${synthesized.synthesizedBy}${synthesized.fixedBy ? '-fixed-' + synthesized.fixedBy : ''}`,
        synthesisConfidence: synthesized.validationPassed ? 0.9 : 0.6, // Higher if validation passed
        sourceTraceIds: clusterTraces.map(t => t.id),
        lifecycle: 'candidate',
        category: intentCategory || undefined,
        knowledgeType: 'procedural',
        verificationCount: 0,
        verificationStatus: 'unverified',
        visibility: shardVisibility, // Options visibility takes precedence, but TS needs this
      }, options);

      // Mark traces as synthesized
      await query(
        `UPDATE reasoning_traces
         SET synthesized = true, attracted_to_shard = $2
         WHERE id = ANY($1)`,
        [clusterTraces.map(t => t.id), shard.id]
      );

      // Publish event
      await publishEvent(Streams.SHARDS, {
        type: 'shard.created',
        source: 'crystallize',
        payload: {
          shardId: shard.id,
          name: shard.name,
          lifecycle: shard.lifecycle,
          intentTemplate: intentTemplate,
          synthesisMethod: 'crystallize',
          sourceTraceIds: shard.sourceTraceIds,
          ownerId: ownerId,
          visibility: shardVisibility,
        },
      });

      shardsCreated++;
      tracesProcessed += clusterTraces.length;

      logger.info({
        shardId: shard.id,
        name: shard.name,
        intentTemplate,
        traceCount: clusterTraces.length,
        ownerId: ownerId,
        visibility: shardVisibility,
      }, 'Shard crystallized');

    } catch (error) {
      logger.error({ error, clusterKey, intentTemplate }, 'Failed to crystallize cluster');
    }
  }

  logger.info({ shardsCreated, tracesProcessed }, 'Crystallization cycle complete');

  return { shardsCreated, tracesProcessed };
}
