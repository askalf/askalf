import { query, queryOne } from '@substrate/database';
import { ProceduralShard, ShardExecution, ids, shardLogicScanner } from '@substrate/core';
import { generateEmbedding } from '@substrate/ai';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'procedural-store' });

// ============================================
// TENANT CONTEXT
// ============================================

export interface TenantContext {
  tenantId: string;
  tier?: 'free' | 'pro' | 'enterprise' | 'system';
  role?: 'user' | 'admin' | 'super_admin';  // User role for permission checks
  orgIds?: string[];  // Organization IDs the user belongs to (for enterprise)
}

export type Visibility = 'public' | 'private' | 'organization' | 'system';

/**
 * Community submission status for user-contributed shards
 */
export type CommunityStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | null;

/**
 * Build visibility filter for queries
 *
 * SIMPLIFIED VISIBILITY MODEL:
 * - public:       Visible to ALL users
 *                 - ALF Public: owner_id=NULL (ALF-owned shards)
 *                 - Community Public: owner_id set + community_status='approved'
 * - private:      Visible ONLY to owner (personal shards)
 * - organization: Visible to organization members (enterprise feature)
 * - system:       DEPRECATED - treated as 'public' (use ALF Public instead)
 *
 * CATEGORIES:
 * - ALF Public:       owner_id=NULL, visibility='public'
 * - Community Public: owner_id set, visibility='public', community_status='approved'
 * - Private:          owner_id set, visibility='private'
 *
 * @param tenant - Tenant context with optional orgIds for org membership
 */
function buildVisibilityClause(
  tenant: TenantContext | undefined,
  tableAlias: string = ''
): { clause: string; params: unknown[] } {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  // System tenant / Admin sees everything (including system visibility)
  if (!tenant || tenant.tenantId === 'tenant_system') {
    return { clause: '1=1', params: [] };
  }

  const params: unknown[] = [tenant.tenantId];

  // Base visibility: public + legacy (null owner) + own private
  // NOTE: 'system' visibility is NOT included - only admins see those
  let clause = `(
    ${prefix}visibility = 'public'
    OR ${prefix}owner_id IS NULL
    OR (${prefix}visibility = 'private' AND ${prefix}owner_id = $1)
  )`;

  // If user has organization memberships, add org visibility
  if (tenant.orgIds && tenant.orgIds.length > 0) {
    // Add org IDs as parameters
    const orgPlaceholders = tenant.orgIds.map((_, i) => `$${params.length + i + 1}`).join(', ');
    params.push(...tenant.orgIds);

    clause = `(
      ${prefix}visibility = 'public'
      OR ${prefix}owner_id IS NULL
      OR (${prefix}visibility = 'private' AND ${prefix}owner_id = $1)
      OR (${prefix}visibility = 'organization' AND ${prefix}owner_id IN (${orgPlaceholders}))
    )`;
  }

  return { clause, params };
}

/**
 * Create a new procedural shard
 * @param shard - Shard data
 * @param options - Optional tenant context, visibility, and security settings
 */
export async function createShard(
  shard: Omit<ProceduralShard, 'id' | 'createdAt' | 'updatedAt'>,
  options?: { tenant?: TenantContext; visibility?: Visibility; communityStatus?: CommunityStatus; skipLogicScan?: boolean }
): Promise<ProceduralShard> {
  const id = ids.shard();
  const now = new Date();

  // Security: Scan shard logic for malicious patterns (unless explicitly skipped by trusted source)
  if (!options?.skipLogicScan && shard.logic) {
    const scanResult = shardLogicScanner.scan(shard.logic);

    if (scanResult.shouldBlock) {
      logger.warn({
        shardName: shard.name,
        errors: scanResult.errors,
        riskLevel: scanResult.riskLevel,
      }, 'Shard logic blocked by security scanner');
      throw new Error(`Shard logic blocked: ${scanResult.errors.join('; ')}`);
    }

    if (scanResult.flagForReview) {
      logger.warn({
        shardName: shard.name,
        warnings: scanResult.warnings,
        riskLevel: scanResult.riskLevel,
      }, 'Shard logic flagged for review');
      // Continue but log for audit - could be enhanced to set a flag in DB
    }
  }

  // Generate embedding for patterns if not provided
  let embedding = shard.embedding;
  if (!embedding && shard.patterns.length > 0) {
    embedding = await generateEmbedding(shard.patterns.join(' '));
  }

  // Generate embedding for intent template (for similarity matching)
  let intentTemplateEmbedding: number[] | null = null;
  if (shard.intentTemplate) {
    intentTemplateEmbedding = await generateEmbedding(shard.intentTemplate);
  }

  // Determine owner, visibility, and community status
  const ownerId = options?.tenant?.tenantId !== 'tenant_system' ? options?.tenant?.tenantId : null;
  const visibility = options?.visibility ?? 'public';
  const communityStatus = options?.communityStatus ?? null;
  // Auto-set reviewed_at if auto-approved
  const reviewedAt = communityStatus === 'approved' ? now : null;

  // Immutable shards (math, constants, conversions) are auto-verified at creation
  const isImmutable = (shard.knowledgeType || 'procedural') === 'immutable';

  await query(
    `INSERT INTO procedural_shards (
      id, name, version, logic, input_schema, output_schema,
      patterns, embedding, pattern_hash, intent_template, intent_template_embedding,
      confidence, lifecycle, synthesis_method, synthesis_confidence, source_trace_ids,
      owner_id, visibility, community_status, reviewed_at,
      knowledge_type, category, expires_at, last_verified_at,
      verification_count, verification_status, source_url, source_type,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)`,
    [
      id,
      shard.name,
      shard.version,
      shard.logic,
      JSON.stringify(shard.inputSchema),
      JSON.stringify(shard.outputSchema),
      JSON.stringify(shard.patterns),
      embedding ? `[${embedding.join(',')}]` : null,
      shard.patternHash,
      shard.intentTemplate || null,
      intentTemplateEmbedding ? `[${intentTemplateEmbedding.join(',')}]` : null,
      shard.confidence,
      shard.lifecycle,
      shard.synthesisMethod,
      shard.synthesisConfidence,
      shard.sourceTraceIds,
      ownerId,
      visibility,
      communityStatus,
      reviewedAt,
      shard.knowledgeType || 'procedural',
      shard.category || null,
      shard.expiresAt || null,
      isImmutable ? now : null,           // last_verified_at — immutable shards verified at creation
      isImmutable ? 1 : 0,               // verification_count
      isImmutable ? 'verified' : 'unverified', // verification_status
      shard.sourceUrl || null,
      shard.sourceType || null,
      now,
      now,
    ]
  );

  logger.info({ shardId: id, name: shard.name, ownerId, visibility }, 'Shard created');

  return {
    ...shard,
    id,
    embedding,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Get a shard by ID
 */
export async function getShardById(id: string): Promise<ProceduralShard | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM procedural_shards WHERE id = $1',
    [id]
  );

  return row ? mapRowToShard(row) : null;
}

/**
 * Get all promoted shards for pattern matching (tenant-aware)
 */
export async function getPromotedShards(
  includeNonPromoted = false,
  tenant?: TenantContext
): Promise<ProceduralShard[]> {
  const lifecycleFilter = includeNonPromoted
    ? "lifecycle IN ('promoted', 'candidate', 'testing')"
    : "lifecycle = 'promoted'";

  const visFilter = buildVisibilityClause(tenant);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE ${lifecycleFilter}
       AND verification_status NOT IN ('failed', 'expired')
       AND ${visFilter.clause}
     ORDER BY confidence DESC`,
    visFilter.params
  );

  return rows.map(mapRowToShard);
}

/**
 * Find shards by lifecycle
 */
export async function findShardsByLifecycle(
  lifecycle: string,
  limit = 100
): Promise<ProceduralShard[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM procedural_shards WHERE lifecycle = $1 ORDER BY confidence DESC LIMIT $2',
    [lifecycle, limit]
  );

  return rows.map(mapRowToShard);
}

/**
 * Find similar shards by embedding (tenant-aware)
 * @param embedding - Query embedding vector
 * @param threshold - Similarity threshold (0-1)
 * @param limit - Max results
 * @param includeNonPromoted - Include testing/candidate shards
 * @param tenant - Optional tenant context for visibility filtering
 */
export async function findSimilarShardsByEmbedding(
  embedding: number[],
  threshold = 0.7,
  limit = 10,
  includeNonPromoted = false,
  tenant?: TenantContext
): Promise<Array<ProceduralShard & { similarity: number }>> {
  const embeddingStr = `[${embedding.join(',')}]`;

  const lifecycleFilter = includeNonPromoted
    ? "lifecycle IN ('promoted', 'candidate', 'testing')"
    : "lifecycle = 'promoted'";

  // Build visibility filter
  const visFilter = buildVisibilityClause(tenant);
  const params: unknown[] = [embeddingStr, ...visFilter.params];
  const thresholdIdx = params.length + 1;
  const limitIdx = params.length + 2;
  params.push(threshold, limit);

  const rows = await query<Record<string, unknown>>(
    `SELECT *, 1 - (embedding <=> $1::vector) as similarity
     FROM procedural_shards
     WHERE ${lifecycleFilter}
       AND embedding IS NOT NULL
       AND verification_status NOT IN ('failed', 'expired')
       AND 1 - (embedding <=> $1::vector) >= $${thresholdIdx}
       AND ${visFilter.clause.replace(/\$1/g, `$${visFilter.params.length > 0 ? 2 : 1}`)}
     ORDER BY embedding <=> $1::vector
     LIMIT $${limitIdx}`,
    params
  );

  return rows.map(row => ({
    ...mapRowToShard(row),
    similarity: row['similarity'] as number,
  }));
}

/**
 * Find similar shards by text query (tenant-aware)
 */
export async function findSimilarShards(
  searchText: string,
  limit = 10,
  tenant?: TenantContext
): Promise<ProceduralShard[]> {
  const embedding = await generateEmbedding(searchText);
  const results = await findSimilarShardsByEmbedding(embedding, 0.5, limit, false, tenant);
  return results;
}

/**
 * Find shard by intent template (exact, normalized, or embedding similarity)
 * @param intentTemplate - The intent template to match
 * @param includeNonPromoted - Include testing/candidate shards
 * @param similarityThreshold - Embedding similarity threshold
 * @param tenant - Optional tenant context for visibility filtering
 */
export async function findShardByIntentTemplate(
  intentTemplate: string,
  includeNonPromoted = false,
  similarityThreshold = 0.55,
  tenant?: TenantContext
): Promise<ProceduralShard | null> {
  const lifecycleFilter = includeNonPromoted
    ? "lifecycle IN ('promoted', 'candidate', 'testing')"
    : "lifecycle = 'promoted'";

  // Build visibility filter
  const visFilter = buildVisibilityClause(tenant);

  // Strategy 1: Exact match
  const exactParams: unknown[] = [intentTemplate, ...visFilter.params];
  const exactMatch = await queryOne<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE intent_template = $1
       AND ${lifecycleFilter}
       AND verification_status NOT IN ('failed', 'expired')
       AND ${visFilter.clause.replace(/\$1/g, `$${visFilter.params.length > 0 ? 2 : 1}`)}
     ORDER BY confidence DESC
     LIMIT 1`,
    exactParams
  );

  if (exactMatch) {
    logger.debug({ template: intentTemplate, method: 'exact' }, 'Intent template matched');
    return mapRowToShard(exactMatch);
  }

  // Strategy 2: Normalized match (lowercase, trimmed)
  const normalizedTemplate = intentTemplate.toLowerCase().trim();
  const normalizedParams: unknown[] = [normalizedTemplate, ...visFilter.params];
  const normalizedMatch = await queryOne<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE LOWER(TRIM(intent_template)) = $1
       AND ${lifecycleFilter}
       AND verification_status NOT IN ('failed', 'expired')
       AND ${visFilter.clause.replace(/\$1/g, `$${visFilter.params.length > 0 ? 2 : 1}`)}
     ORDER BY confidence DESC
     LIMIT 1`,
    normalizedParams
  );

  if (normalizedMatch) {
    logger.debug({ template: intentTemplate, method: 'normalized' }, 'Intent template matched');
    return mapRowToShard(normalizedMatch);
  }

  // Strategy 3: Embedding similarity on intent templates
  // This catches cases where LLM generates slightly different template wording
  try {
    const templateEmbedding = await generateEmbedding(intentTemplate);
    const embeddingStr = `[${templateEmbedding.join(',')}]`;

    const similarParams: unknown[] = [embeddingStr, ...visFilter.params];
    const thresholdIdx = similarParams.length + 1;
    similarParams.push(similarityThreshold);

    const similarMatch = await queryOne<Record<string, unknown> & { similarity: number }>(
      `SELECT *, 1 - (intent_template_embedding <=> $1::vector) as similarity
       FROM procedural_shards
       WHERE intent_template_embedding IS NOT NULL
         AND ${lifecycleFilter}
         AND verification_status NOT IN ('failed', 'expired')
         AND 1 - (intent_template_embedding <=> $1::vector) >= $${thresholdIdx}
         AND ${visFilter.clause.replace(/\$1/g, `$${visFilter.params.length > 0 ? 2 : 1}`)}
       ORDER BY similarity DESC, confidence DESC
       LIMIT 1`,
      similarParams
    );

    if (similarMatch) {
      logger.debug({
        template: intentTemplate,
        matchedTemplate: similarMatch['intent_template'],
        similarity: similarMatch.similarity,
        method: 'embedding',
      }, 'Intent template matched via embedding similarity');
      return mapRowToShard(similarMatch);
    }
  } catch (err) {
    logger.error({ error: err }, 'Failed to do embedding similarity match for intent template');
  }

  logger.debug({ template: intentTemplate }, 'No intent template match found');
  return null;
}

/**
 * Update shard confidence and metrics after execution
 */
export async function recordExecution(
  shardId: string,
  success: boolean,
  executionMs: number,
  tokensSaved: number,
  executorTenantId?: string,
  inputText?: string,
  matchMethod?: string
): Promise<void> {
  const executionId = ids.execution();

  // Layer 4: Compute input hash for phrasing diversity tracking
  const inputHash = inputText ? simpleHash(inputText.toLowerCase().trim()) : null;

  // Record execution with optional tenant tracking and input hash
  await query(
    `INSERT INTO shard_executions (id, shard_id, input, success, execution_ms, tokens_saved, executor_tenant_id, input_hash, match_method, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
    [executionId, shardId, inputText || '', success, executionMs, tokensSaved, executorTenantId || null, inputHash, matchMethod || null]
  );

  // Check if this is a new unique phrasing (Layer 4)
  let isNewPhrasing = false;
  if (inputHash && success) {
    const existing = await query<{ cnt: string }>(
      `SELECT COUNT(*) as cnt FROM shard_executions
       WHERE shard_id = $1 AND input_hash = $2 AND id != $3`,
      [shardId, inputHash, executionId]
    );
    isNewPhrasing = parseInt(existing[0]?.cnt || '0', 10) === 0;
  }

  // Update shard metrics atomically
  await query(
    `UPDATE procedural_shards SET
       execution_count = execution_count + 1,
       success_count = success_count + CASE WHEN $2 THEN 1 ELSE 0 END,
       failure_count = failure_count + CASE WHEN $2 THEN 0 ELSE 1 END,
       avg_latency_ms = CASE
         WHEN execution_count = 0 THEN $3::float
         ELSE (COALESCE(avg_latency_ms, 0) * execution_count + $3::float) / (execution_count + 1)
       END,
       tokens_saved = tokens_saved + $4,
       last_executed = NOW(),
       confidence = CASE
         WHEN $2 THEN LEAST(confidence + 0.008, 1.0)
         ELSE GREATEST(confidence - 0.015, 0.0)
       END,
       unique_phrasings = unique_phrasings + CASE WHEN $5 THEN 1 ELSE 0 END
     WHERE id = $1`,
    [shardId, success, executionMs, tokensSaved, isNewPhrasing]
  );
}

/**
 * Simple string hash for phrasing deduplication
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Update shard lifecycle
 */
export async function updateLifecycle(
  shardId: string,
  lifecycle: string
): Promise<void> {
  await query(
    'UPDATE procedural_shards SET lifecycle = $2, updated_at = NOW() WHERE id = $1',
    [shardId, lifecycle]
  );

  logger.info({ shardId, lifecycle }, 'Shard lifecycle updated');
}

/**
 * Get shards needing decay
 */
export async function getShardsForDecay(
  minDaysSinceUse: number
): Promise<ProceduralShard[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE lifecycle = 'promoted'
       AND (last_executed IS NULL OR last_executed < NOW() - INTERVAL '1 day' * $1)
     ORDER BY confidence ASC`,
    [minDaysSinceUse]
  );

  return rows.map(mapRowToShard);
}

/**
 * Apply decay to a shard
 */
export async function applyDecay(
  shardId: string,
  decayRate: number
): Promise<void> {
  await query(
    `UPDATE procedural_shards SET
       confidence = GREATEST(confidence - $2, 0.0),
       updated_at = NOW()
     WHERE id = $1`,
    [shardId, decayRate]
  );
}

/**
 * Backfill intent template embeddings for existing shards
 * Returns count of shards updated
 */
export async function backfillIntentTemplateEmbeddings(): Promise<{ total: number; updated: number; errors: number }> {
  const result = { total: 0, updated: 0, errors: 0 };

  // Find shards with intent_template but no intent_template_embedding
  const shards = await query<{ id: string; intent_template: string }>(
    `SELECT id, intent_template FROM procedural_shards
     WHERE intent_template IS NOT NULL
       AND intent_template_embedding IS NULL`
  );

  result.total = shards.length;
  logger.info({ count: shards.length }, 'Backfilling intent template embeddings');

  for (const shard of shards) {
    try {
      const embedding = await generateEmbedding(shard.intent_template);
      await query(
        `UPDATE procedural_shards SET intent_template_embedding = $1 WHERE id = $2`,
        [`[${embedding.join(',')}]`, shard.id]
      );
      result.updated++;
    } catch (err) {
      logger.error({ shardId: shard.id, error: err }, 'Failed to generate intent template embedding');
      result.errors++;
    }
  }

  logger.info(result, 'Intent template embedding backfill complete');
  return result;
}

/**
 * Backfill pattern embeddings for existing shards
 * Generates embeddings from patterns.join(' ') for shards missing the embedding column
 */
export async function backfillPatternEmbeddings(): Promise<{ total: number; updated: number; errors: number }> {
  const result = { total: 0, updated: 0, errors: 0 };

  const shards = await query<{ id: string; patterns: string[] }>(
    `SELECT id, patterns FROM procedural_shards
     WHERE embedding IS NULL
       AND patterns IS NOT NULL
       AND array_length(patterns, 1) > 0`
  );

  result.total = shards.length;
  logger.info({ count: shards.length }, 'Backfilling pattern embeddings');

  for (const shard of shards) {
    try {
      const patternsText = Array.isArray(shard.patterns)
        ? shard.patterns.join(' ')
        : String(shard.patterns);
      const embedding = await generateEmbedding(patternsText);
      await query(
        `UPDATE procedural_shards SET embedding = $1 WHERE id = $2`,
        [`[${embedding.join(',')}]`, shard.id]
      );
      result.updated++;
    } catch (err) {
      logger.error({ shardId: shard.id, error: err }, 'Failed to generate pattern embedding');
      result.errors++;
    }
  }

  logger.info(result, 'Pattern embedding backfill complete');
  return result;
}

/**
 * Map database row to ProceduralShard
 */
function mapRowToShard(row: Record<string, unknown>): ProceduralShard {
  return {
    id: row['id'] as string,
    name: row['name'] as string,
    version: row['version'] as number,
    logic: row['logic'] as string,
    inputSchema: row['input_schema'] as Record<string, unknown>,
    outputSchema: row['output_schema'] as Record<string, unknown>,
    patterns: row['patterns'] as string[],
    embedding: row['embedding'] as number[] | undefined,
    patternHash: row['pattern_hash'] as string | undefined,
    intentTemplate: row['intent_template'] as string | undefined,
    confidence: row['confidence'] as number,
    executionCount: row['execution_count'] as number,
    successCount: row['success_count'] as number,
    failureCount: row['failure_count'] as number,
    avgLatencyMs: row['avg_latency_ms'] as number,
    tokensSaved: row['tokens_saved'] as number,
    estimatedTokens: (row['estimated_tokens'] as number) || 100,
    synthesisMethod: row['synthesis_method'] as string,
    synthesisConfidence: row['synthesis_confidence'] as number,
    sourceTraceIds: row['source_trace_ids'] as string[],
    lifecycle: row['lifecycle'] as ProceduralShard['lifecycle'],
    knowledgeType: (row['knowledge_type'] as ProceduralShard['knowledgeType']) || 'procedural',
    category: row['category'] as string | undefined,
    expiresAt: row['expires_at'] ? new Date(row['expires_at'] as string) : undefined,
    lastVerifiedAt: row['last_verified_at'] ? new Date(row['last_verified_at'] as string) : undefined,
    verificationCount: (row['verification_count'] as number) || 0,
    verificationStatus: (row['verification_status'] as ProceduralShard['verificationStatus']) || 'unverified',
    sourceUrl: row['source_url'] as string | undefined,
    sourceType: row['source_type'] as string | undefined,
    ownerId: row['owner_id'] as string | null | undefined,
    visibility: (row['visibility'] as 'public' | 'private' | 'organization') || 'public',
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
    lastExecuted: row['last_executed'] ? new Date(row['last_executed'] as string) : undefined,
  };
}

/**
 * Find shards that match input by regex pattern (tenant-aware)
 * This is a deterministic match - more reliable than embedding similarity for structured patterns
 * @param input - User input to match against shard patterns
 * @param tenant - Optional tenant context for visibility filtering
 */
export async function findShardsByPattern(
  input: string,
  tenant?: TenantContext
): Promise<Array<ProceduralShard & { matchedPattern: string }>> {
  const visFilter = buildVisibilityClause(tenant);

  // Get all promoted shards with patterns (exclude failed/expired verification)
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE lifecycle = 'promoted'
       AND patterns IS NOT NULL
       AND jsonb_array_length(patterns) > 0
       AND verification_status NOT IN ('failed', 'expired')
       AND ${visFilter.clause}
     ORDER BY confidence DESC`,
    visFilter.params
  );

  const matches: Array<ProceduralShard & { matchedPattern: string }> = [];
  const normalizedInput = input.toLowerCase().trim();

  for (const row of rows) {
    const shard = mapRowToShard(row);
    const patterns = shard.patterns || [];

    for (const pattern of patterns) {
      try {
        // For short patterns (3 chars or less), require word boundary matching
        // This prevents "hi" from matching "chicken", "this", etc.
        const patternToUse = pattern.length <= 3
          ? `\\b${pattern}\\b`
          : pattern;
        const regex = new RegExp(patternToUse, 'i');
        if (regex.test(normalizedInput)) {
          matches.push({ ...shard, matchedPattern: pattern });
          break; // Only add shard once even if multiple patterns match
        }
      } catch {
        // If regex is invalid, try word boundary match for short patterns
        // or substring match for longer patterns
        const lowerPattern = pattern.toLowerCase();
        if (pattern.length <= 3) {
          // For short patterns, require word boundary (space or start/end)
          const wordBoundaryRegex = new RegExp(`\\b${lowerPattern}\\b`, 'i');
          if (wordBoundaryRegex.test(normalizedInput)) {
            matches.push({ ...shard, matchedPattern: pattern });
            break;
          }
        } else if (normalizedInput.includes(lowerPattern)) {
          matches.push({ ...shard, matchedPattern: pattern });
          break;
        }
      }
    }
  }

  logger.debug({ input, matchCount: matches.length }, 'Pattern matching complete');
  return matches;
}

// ============================================
// KNOWLEDGE TYPE & VERIFICATION (Layer 1)
// ============================================

/**
 * Find temporal shards that have expired and need re-verification
 */
export async function findExpiredShards(
  limit = 50
): Promise<ProceduralShard[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE knowledge_type = 'temporal'
       AND lifecycle = 'promoted'
       AND expires_at IS NOT NULL
       AND expires_at <= NOW()
       AND verification_status != 'challenged'
     ORDER BY expires_at ASC
     LIMIT $1`,
    [limit]
  );

  return rows.map(mapRowToShard);
}

/**
 * Find shards needing initial verification (never verified)
 */
export async function findUnverifiedShards(
  limit = 50
): Promise<ProceduralShard[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE lifecycle = 'promoted'
       AND verification_status = 'unverified'
       AND knowledge_type IN ('temporal', 'procedural')
     ORDER BY execution_count DESC
     LIMIT $1`,
    [limit]
  );

  return rows.map(mapRowToShard);
}

/**
 * Find procedural shards eligible for execution-based verification.
 * Shards with sufficient execution history and high success rate
 * can be verified based on real-world usage data — no LLM needed.
 */
export async function findExecutionVerifiableShards(
  limit = 50,
  minExecutions = 10,
  minSuccessRate = 0.9
): Promise<ProceduralShard[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE knowledge_type = 'procedural'
       AND verification_status = 'unverified'
       AND lifecycle IN ('promoted', 'shadow', 'testing')
       AND execution_count >= $2
       AND (success_count::float / NULLIF(execution_count, 0)) >= $3
     ORDER BY execution_count DESC
     LIMIT $1`,
    [limit, minExecutions, minSuccessRate]
  );

  return rows.map(mapRowToShard);
}

/**
 * Update verification status for a shard
 */
export async function updateVerificationStatus(
  shardId: string,
  status: 'unverified' | 'verified' | 'expired' | 'challenged' | 'failed',
  newExpiresAt?: Date
): Promise<void> {
  const params: unknown[] = [shardId, status];
  let expiresClause = '';

  if (status === 'verified') {
    // Reset expiration on successful verification
    if (newExpiresAt) {
      params.push(newExpiresAt);
      expiresClause = `, expires_at = $${params.length}`;
    }
    await query(
      `UPDATE procedural_shards SET
         verification_status = $2,
         last_verified_at = NOW(),
         verification_count = verification_count + 1
         ${expiresClause}
       WHERE id = $1`,
      params
    );
  } else if (status === 'failed') {
    // Failed verification — demote the shard
    await query(
      `UPDATE procedural_shards SET
         verification_status = $2,
         last_verified_at = NOW(),
         verification_count = verification_count + 1,
         lifecycle = 'archived'
       WHERE id = $1`,
      params
    );
    logger.warn({ shardId }, 'Shard failed verification, archived');
  } else {
    await query(
      `UPDATE procedural_shards SET
         verification_status = $2
       WHERE id = $1`,
      params
    );
  }

  logger.info({ shardId, status }, 'Shard verification status updated');
}

/**
 * Update knowledge type and category for a shard
 */
export async function updateKnowledgeType(
  shardId: string,
  knowledgeType: 'immutable' | 'temporal' | 'contextual' | 'procedural',
  options?: { category?: string; expiresAt?: Date; sourceUrl?: string; sourceType?: string }
): Promise<void> {
  await query(
    `UPDATE procedural_shards SET
       knowledge_type = $2,
       category = COALESCE($3, category),
       expires_at = $4,
       source_url = COALESCE($5, source_url),
       source_type = COALESCE($6, source_type)
     WHERE id = $1`,
    [
      shardId,
      knowledgeType,
      options?.category || null,
      options?.expiresAt || null,
      options?.sourceUrl || null,
      options?.sourceType || null,
    ]
  );

  logger.info({ shardId, knowledgeType, category: options?.category }, 'Shard knowledge type updated');
}

/**
 * Get shards by category (for convergence tracking)
 */
export async function findShardsByCategory(
  category: string,
  tenant?: TenantContext
): Promise<ProceduralShard[]> {
  const visFilter = buildVisibilityClause(tenant);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE category = $1
       AND lifecycle = 'promoted'
       AND ${visFilter.clause.replace(/\$1/g, `$${visFilter.params.length > 0 ? 2 : 1}`)}
     ORDER BY confidence DESC`,
    [category, ...visFilter.params]
  );

  return rows.map(mapRowToShard);
}

/**
 * Override: Immutable shards should never decay.
 * Call this in the decay cycle to skip immutable shards.
 */
export async function getShardsForDecayExcludeImmutable(
  minDaysSinceUse: number
): Promise<ProceduralShard[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM procedural_shards
     WHERE lifecycle = 'promoted'
       AND knowledge_type != 'immutable'
       AND (last_executed IS NULL OR last_executed < NOW() - INTERVAL '1 day' * $1)
     ORDER BY confidence ASC`,
    [minDaysSinceUse]
  );

  return rows.map(mapRowToShard);
}
