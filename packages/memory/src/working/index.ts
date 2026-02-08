import { query, queryOne } from '@substrate/database';
import { WorkingContext, ids } from '@substrate/core';
import { complete, generateEmbedding } from '@substrate/ai';

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
 * Build visibility filter for queries
 *
 * VISIBILITY LEVELS & ACCESS:
 * - public:       Visible to ALL users
 * - private:      Visible ONLY to owner (personal)
 * - organization: Visible to organization members (enterprise feature)
 * - system:       Visible ONLY to admins (internal - hidden from users)
 */
function buildVisibilityClause(
  tenant: TenantContext | undefined,
  tableAlias: string = ''
): { clause: string; params: unknown[] } {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  // System tenant / Admin sees everything
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

// Content type importance multipliers
const CONTENT_TYPE_WEIGHTS: Record<string, number> = {
  'decision': 1.0,       // Critical decisions
  'error': 0.9,          // Errors are important to remember
  'instruction': 0.85,   // User instructions
  'task': 0.8,           // Task context
  'observation': 0.6,    // General observations
  'conversation': 0.5,   // Regular conversation
  'noise': 0.1,          // Identified noise
};

/**
 * Calculate importance score for a context
 */
function calculateImportance(
  contentType: string,
  extractedFacts: Array<Record<string, unknown>>,
  extractedEntities: string[]
): number {
  const typeWeight = CONTENT_TYPE_WEIGHTS[contentType] ?? 0.5;
  const factBonus = Math.min(extractedFacts.length * 0.05, 0.25);
  const entityBonus = Math.min(extractedEntities.length * 0.02, 0.15);

  return Math.min(typeWeight + factBonus + entityBonus, 1.0);
}

/**
 * Create a working context
 * @param context - Context data
 * @param options - Optional tenant context and visibility
 */
export async function createContext(
  context: Omit<WorkingContext, 'id' | 'createdAt' | 'updatedAt' | 'status'>,
  options?: { tenant?: TenantContext; visibility?: Visibility }
): Promise<WorkingContext> {
  const id = ids.context();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (context.ttlSeconds * 1000));

  // Generate embedding for similarity search
  const embedding = await generateEmbedding(context.rawContent);

  // Determine owner and visibility
  const ownerId = options?.tenant?.tenantId !== 'tenant_system' ? options?.tenant?.tenantId : null;
  const visibility = options?.visibility ?? 'private'; // Working contexts default to private

  await query(
    `INSERT INTO working_contexts (
      id, session_id, agent_id, raw_content, content_type,
      status, original_tokens, ttl_seconds, expires_at,
      embedding, importance, owner_id, visibility,
      created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, 'raw', $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      id,
      context.sessionId,
      context.agentId,
      context.rawContent,
      context.contentType,
      context.originalTokens,
      context.ttlSeconds,
      expiresAt,
      `[${embedding.join(',')}]`,
      CONTENT_TYPE_WEIGHTS[context.contentType] ?? 0.5,
      ownerId,
      visibility,
      now,
      now,
    ]
  );

  return {
    ...context,
    id,
    status: 'raw',
    expiresAt,
    extractedFacts: [],
    extractedEntities: [],
    noiseRemoved: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Liquidate a context - extract facts, compress, and calculate importance
 */
export async function liquidateContext(contextId: string): Promise<WorkingContext> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM working_contexts WHERE id = $1',
    [contextId]
  );

  if (!row) {
    throw new Error(`Context not found: ${contextId}`);
  }

  // Use LLM to extract facts
  const prompt = `Extract key facts and entities from this context. Remove noise and irrelevant information.
Identify factual statements that should be remembered long-term.

Context:
${row['raw_content']}

Respond in JSON format:
{
  "facts": [{"subject": "...", "predicate": "...", "object": "...", "confidence": 0.8}],
  "entities": ["entity1", "entity2"],
  "noise": ["removed text 1", "removed text 2"],
  "summary": "compressed version of important information",
  "shouldPromote": true
}

Set shouldPromote to true if this contains important factual information worth keeping in long-term memory.`;

  const response = await complete(prompt, { temperature: 0, maxTokens: 1024 });

  let extracted;
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : { facts: [], entities: [], noise: [], shouldPromote: false };
  } catch {
    extracted = { facts: [], entities: [], noise: [], shouldPromote: false };
  }

  // Calculate compression ratio
  const originalTokens = row['original_tokens'] as number || 0;
  const liquidatedTokens = Math.ceil((extracted.summary?.length ?? 0) / 4);
  const compressionRatio = originalTokens > 0 ? liquidatedTokens / originalTokens : 1;

  // Calculate importance score
  const importance = calculateImportance(
    row['content_type'] as string,
    extracted.facts,
    extracted.entities
  );

  await query(
    `UPDATE working_contexts SET
       status = 'liquidated',
       extracted_facts = $2,
       extracted_entities = $3,
       noise_removed = $4,
       liquidated_tokens = $5,
       compression_ratio = $6,
       importance = $7,
       summary = $8,
       updated_at = NOW()
     WHERE id = $1`,
    [
      contextId,
      JSON.stringify(extracted.facts),
      JSON.stringify(extracted.entities),
      extracted.noise,
      liquidatedTokens,
      compressionRatio,
      importance,
      extracted.summary ?? '',
    ]
  );

  return {
    id: contextId,
    sessionId: row['session_id'] as string,
    agentId: row['agent_id'] as string | undefined,
    rawContent: row['raw_content'] as string,
    contentType: row['content_type'] as string,
    status: 'liquidated',
    extractedFacts: extracted.facts,
    extractedEntities: extracted.entities,
    noiseRemoved: extracted.noise,
    originalTokens,
    liquidatedTokens,
    compressionRatio,
    ttlSeconds: row['ttl_seconds'] as number,
    expiresAt: row['expires_at'] ? new Date(row['expires_at'] as string) : undefined,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(),
  };
}

/**
 * Promote important facts from working memory to semantic memory
 * @param contextId - The working context ID to promote
 * @param tenant - Optional tenant context (if not provided, reads owner_id from the working context)
 */
export async function promoteToSemantic(contextId: string, tenant?: TenantContext): Promise<{
  promoted: number;
  factIds: string[];
}> {
  const { storeFact } = await import('../semantic/index.js');

  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM working_contexts WHERE id = $1 AND status = $2',
    [contextId, 'liquidated']
  );

  if (!row) {
    throw new Error(`Context not found or not liquidated: ${contextId}`);
  }

  // Resolve tenant context: use provided tenant, or fall back to the working context's owner_id
  const ownerId = row['owner_id'] as string | null;
  const resolvedTenant = tenant ?? (ownerId ? { tenantId: ownerId } : undefined);

  const extractedFacts = row['extracted_facts'] as Array<{
    subject: string;
    predicate: string;
    object: string;
    confidence?: number;
  }> || [];

  const factIds: string[] = [];

  for (const fact of extractedFacts) {
    if (!fact.subject || !fact.predicate || !fact.object) continue;

    const statement = `${fact.subject} ${fact.predicate} ${fact.object}`;
    try {
      const storedFact = await storeFact({
        subject: fact.subject,
        predicate: fact.predicate,
        object: fact.object,
        statement,
        confidence: fact.confidence ?? 0.6,
        sources: [`working_context:${contextId}`],
        evidence: [],
        category: row['content_type'] as string,
        isTemporal: false,
      }, resolvedTenant ? { tenant: resolvedTenant, visibility: 'private' as Visibility } : undefined);

      factIds.push(storedFact.id);
    } catch (err) {
      // Fact may be rejected by poison validation — skip and continue
      continue;
    }
  }

  // Mark context as promoted
  await query(
    `UPDATE working_contexts SET status = 'promoted', updated_at = NOW() WHERE id = $1`,
    [contextId]
  );

  return { promoted: factIds.length, factIds };
}

/**
 * Find similar contexts by embedding similarity (tenant-aware)
 * @param searchText - Search query
 * @param limit - Max results
 * @param sessionId - Optional session filter
 * @param tenant - Optional tenant context for visibility filtering
 */
export async function findSimilarContexts(
  searchText: string,
  limit = 5,
  sessionId?: string,
  tenant?: TenantContext
): Promise<WorkingContext[]> {
  const embedding = await generateEmbedding(searchText);
  const embeddingStr = `[${embedding.join(',')}]`;

  // Build visibility filter
  const visFilter = buildVisibilityClause(tenant);

  let sql = `SELECT *, 1 - (embedding <=> $1::vector) as similarity
             FROM working_contexts
             WHERE embedding IS NOT NULL
               AND (expires_at IS NULL OR expires_at > NOW())
               AND status IN ('raw', 'liquidated')`;

  const params: unknown[] = [embeddingStr];

  // Add visibility filter
  if (visFilter.params.length > 0) {
    sql += ` AND ${visFilter.clause.replace(/\$1/g, `$${params.length + 1}`)}`;
    params.push(...visFilter.params);
  } else {
    sql += ` AND ${visFilter.clause}`;
  }

  if (sessionId) {
    sql += ` AND session_id = $${params.length + 1}`;
    params.push(sessionId);
  }

  sql += ` ORDER BY embedding <=> $1::vector LIMIT $${params.length + 1}`;
  params.push(limit);

  const rows = await query<Record<string, unknown>>(sql, params);

  return rows.map(mapRowToContext);
}

/**
 * Get context summary for continuation
 * Returns a compressed summary of relevant context for a session
 */
export async function getContextForContinuation(
  sessionId: string,
  currentInput: string,
  maxTokens = 2000
): Promise<{
  summary: string;
  contexts: WorkingContext[];
  totalTokens: number;
}> {
  // Get session contexts ordered by importance
  const sessionContexts = await query<Record<string, unknown>>(
    `SELECT * FROM working_contexts
     WHERE session_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())
       AND status IN ('liquidated', 'raw')
     ORDER BY importance DESC, created_at DESC
     LIMIT 10`,
    [sessionId]
  );

  // Also find similar contexts from other sessions
  const similarContexts = await findSimilarContexts(currentInput, 3);

  // Deduplicate and combine
  const allContexts = [...sessionContexts.map(mapRowToContext)];
  for (const ctx of similarContexts) {
    if (!allContexts.find(c => c.id === ctx.id)) {
      allContexts.push(ctx);
    }
  }

  // Build summary respecting token limit
  let totalTokens = 0;
  const includedContexts: WorkingContext[] = [];
  const summaryParts: string[] = [];

  for (const ctx of allContexts) {
    const summary = (ctx as Record<string, unknown>)['summary'] as string ||
      ctx.rawContent.substring(0, 200);
    const tokens = Math.ceil(summary.length / 4);

    if (totalTokens + tokens > maxTokens) break;

    summaryParts.push(`[${ctx.contentType}] ${summary}`);
    totalTokens += tokens;
    includedContexts.push(ctx);
  }

  return {
    summary: summaryParts.join('\n\n'),
    contexts: includedContexts,
    totalTokens,
  };
}

/**
 * Batch liquidate all raw contexts for a session
 * @param sessionId - Session to liquidate
 * @param tenant - Optional tenant context for fact ownership
 */
export async function liquidateSession(sessionId: string, tenant?: TenantContext): Promise<{
  liquidated: number;
  promoted: number;
  errors: string[];
}> {
  const rows = await query<{ id: string }>(
    `SELECT id FROM working_contexts
     WHERE session_id = $1 AND status = 'raw'`,
    [sessionId]
  );

  let liquidated = 0;
  let promoted = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const ctx = await liquidateContext(row.id);
      liquidated++;

      // Auto-promote high-importance contexts
      const importance = (ctx as Record<string, unknown>)['importance'] as number ?? 0;
      if (importance >= 0.7) {
        const result = await promoteToSemantic(row.id, tenant);
        promoted += result.promoted;
      }
    } catch (e) {
      errors.push(`Failed to liquidate ${row.id}: ${e}`);
    }
  }

  return { liquidated, promoted, errors };
}

/**
 * Helper function to map database row to WorkingContext
 */
function mapRowToContext(row: Record<string, unknown>): WorkingContext {
  return {
    id: row['id'] as string,
    sessionId: row['session_id'] as string,
    agentId: row['agent_id'] as string | undefined,
    rawContent: row['raw_content'] as string,
    contentType: row['content_type'] as string,
    status: row['status'] as WorkingContext['status'],
    extractedFacts: row['extracted_facts'] as Array<Record<string, unknown>> ?? [],
    extractedEntities: row['extracted_entities'] as string[] ?? [],
    noiseRemoved: row['noise_removed'] as string[] ?? [],
    originalTokens: row['original_tokens'] as number | undefined,
    liquidatedTokens: row['liquidated_tokens'] as number | undefined,
    compressionRatio: row['compression_ratio'] as number | undefined,
    ttlSeconds: row['ttl_seconds'] as number,
    expiresAt: row['expires_at'] ? new Date(row['expires_at'] as string) : undefined,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
  };
}

/**
 * Clean up expired contexts
 */
export async function cleanupExpiredContexts(): Promise<number> {
  const result = await query<{ count: string }>(
    `WITH deleted AS (
       DELETE FROM working_contexts
       WHERE expires_at < NOW()
       RETURNING id
     )
     SELECT COUNT(*) as count FROM deleted`
  );

  return parseInt(result[0]?.count ?? '0', 10);
}

/**
 * Get active contexts for a session
 */
export async function getSessionContexts(sessionId: string): Promise<WorkingContext[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM working_contexts
     WHERE session_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY importance DESC, created_at DESC`,
    [sessionId]
  );

  return rows.map(mapRowToContext);
}

/**
 * Get a single context by ID
 */
export async function getContext(contextId: string): Promise<WorkingContext | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM working_contexts WHERE id = $1',
    [contextId]
  );

  return row ? mapRowToContext(row) : null;
}

/**
 * Get working memory stats for a session
 */
export async function getSessionStats(sessionId: string): Promise<{
  total: number;
  raw: number;
  liquidated: number;
  promoted: number;
  avgImportance: number;
  totalTokensSaved: number;
}> {
  const [stats] = await query<{
    total: string;
    raw: string;
    liquidated: string;
    promoted: string;
    avg_importance: string;
    total_saved: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'raw') as raw,
       COUNT(*) FILTER (WHERE status = 'liquidated') as liquidated,
       COUNT(*) FILTER (WHERE status = 'promoted') as promoted,
       COALESCE(AVG(importance), 0) as avg_importance,
       COALESCE(SUM(original_tokens - COALESCE(liquidated_tokens, original_tokens)), 0) as total_saved
     FROM working_contexts
     WHERE session_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [sessionId]
  );

  return {
    total: parseInt(stats?.total ?? '0', 10),
    raw: parseInt(stats?.raw ?? '0', 10),
    liquidated: parseInt(stats?.liquidated ?? '0', 10),
    promoted: parseInt(stats?.promoted ?? '0', 10),
    avgImportance: parseFloat(stats?.avg_importance ?? '0'),
    totalTokensSaved: parseInt(stats?.total_saved ?? '0', 10),
  };
}
