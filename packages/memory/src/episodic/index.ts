import { query, queryOne } from '@substrate/database';
import { Episode, ids } from '@substrate/core';
import { generateEmbedding } from '@substrate/ai';

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

/**
 * Record a new episode (SAO chain)
 * @param episode - Episode data
 * @param options - Optional tenant context and visibility
 */
export async function recordEpisode(
  episode: Omit<Episode, 'id' | 'createdAt'>,
  options?: { tenant?: TenantContext; visibility?: Visibility }
): Promise<Episode> {
  const id = ids.episode();
  const now = new Date();

  // Generate embedding for the episode summary
  const embedding = await generateEmbedding(episode.summary);

  // Determine owner and visibility
  // User-owned episodes default to private; system/unowned default to public
  const ownerId = options?.tenant?.tenantId !== 'tenant_system' ? options?.tenant?.tenantId : null;
  const visibility = options?.visibility ?? (ownerId ? 'private' : 'public');

  await query(
    `INSERT INTO episodes (
      id, situation, action, outcome, type, summary,
      success, valence, importance, lessons_learned,
      embedding, agent_id, session_id, related_shard_id,
      parent_episode_id, metadata, timestamp,
      owner_id, visibility, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
    [
      id,
      JSON.stringify(episode.situation),
      JSON.stringify(episode.action),
      JSON.stringify(episode.outcome),
      episode.type,
      episode.summary,
      episode.success,
      episode.valence,
      episode.importance,
      JSON.stringify(episode.lessonsLearned),
      `[${embedding.join(',')}]`,
      episode.agentId,
      episode.sessionId,
      episode.relatedShardId,
      episode.parentEpisodeId,
      JSON.stringify(episode.metadata),
      episode.timestamp,
      ownerId,
      visibility,
      now,
    ]
  );

  return { ...episode, id, embedding, createdAt: now };
}

/**
 * Find similar past episodes (tenant-aware)
 * Ranks by combined score: vector similarity weighted by importance.
 * High-importance episodes (real interactions, failures) surface above
 * low-importance noise (automated shard executions).
 *
 * @param searchText - Search query
 * @param limit - Max results
 * @param tenant - Optional tenant context for visibility filtering
 * @param excludeTypes - Episode types to exclude (e.g. ['shard_execution'])
 */
export async function findSimilarEpisodes(
  searchText: string,
  limit = 5,
  tenant?: TenantContext,
  excludeTypes?: string[]
): Promise<Episode[]> {
  const embedding = await generateEmbedding(searchText);
  const embeddingStr = `[${embedding.join(',')}]`;

  // Build visibility filter
  const visFilter = buildVisibilityClause(tenant);
  const params: unknown[] = [embeddingStr, ...visFilter.params];

  // Optional type exclusion filter
  let typeFilter = '';
  if (excludeTypes && excludeTypes.length > 0) {
    const typeIdx = params.length + 1;
    params.push(excludeTypes);
    typeFilter = `AND type != ALL($${typeIdx})`;
  }

  const limitIdx = params.length + 1;
  params.push(limit);

  // Rank by vector distance divided by importance (higher importance = lower score = better rank)
  // importance ranges 0-1, so we add 0.1 floor to avoid division issues
  const visClause = visFilter.params.length > 0
    ? visFilter.clause.replace(/\$1/g, '$2')
    : visFilter.clause;

  const rows = await query<Record<string, unknown>>(
    `SELECT *, (embedding <=> $1::vector) / (importance + 0.1) AS weighted_distance
     FROM episodes
     WHERE embedding IS NOT NULL
       AND ${visClause}
       ${typeFilter}
     ORDER BY weighted_distance ASC
     LIMIT $${limitIdx}`,
    params
  );

  return rows.map(mapRowToEpisode);
}

/**
 * Get episode chain (parent episodes)
 */
export async function getEpisodeChain(episodeId: string): Promise<Episode[]> {
  const chain: Episode[] = [];
  let currentId: string | undefined = episodeId;

  while (currentId) {
    const episode = await queryOne<Record<string, unknown>>(
      'SELECT * FROM episodes WHERE id = $1',
      [currentId]
    );

    if (!episode) break;

    const mapped = mapRowToEpisode(episode);
    chain.unshift(mapped);
    currentId = mapped.parentEpisodeId;
  }

  return chain;
}

function mapRowToEpisode(row: Record<string, unknown>): Episode {
  return {
    id: row['id'] as string,
    situation: row['situation'] as Episode['situation'],
    action: row['action'] as Episode['action'],
    outcome: row['outcome'] as Episode['outcome'],
    type: row['type'] as string,
    summary: row['summary'] as string,
    success: row['success'] as boolean | undefined,
    valence: row['valence'] as Episode['valence'],
    importance: row['importance'] as number,
    lessonsLearned: row['lessons_learned'] as string[],
    embedding: row['embedding'] as number[] | undefined,
    agentId: row['agent_id'] as string | undefined,
    sessionId: row['session_id'] as string | undefined,
    relatedShardId: row['related_shard_id'] as string | undefined,
    parentEpisodeId: row['parent_episode_id'] as string | undefined,
    metadata: row['metadata'] as Record<string, unknown>,
    timestamp: new Date(row['timestamp'] as string),
    createdAt: new Date(row['created_at'] as string),
  };
}
