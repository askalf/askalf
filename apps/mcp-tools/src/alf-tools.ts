/**
 * ALF tool handlers: alf_profile_read, alf_profile_update, shard_search, convergence_stats
 *
 * Migrated from mcp-alf server. These tools interact with the substrate database
 * for ALF profile management, knowledge shard search, and convergence stats.
 */

import { getSubstratePool } from '@substrate/db';

const log = (msg: string) => console.log(`[mcp-tools:alf] ${new Date().toISOString()} ${msg}`);

// ============================================
// Tool Definitions
// ============================================

export const TOOLS = [
  {
    name: 'alf_profile_read',
    description: 'Read a user\'s ALF profile including preferences, interests, goals, and custom instructions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string', description: 'The tenant ID to read the profile for' },
      },
      required: ['tenant_id'],
    },
  },
  {
    name: 'alf_profile_update',
    description: 'Update user preferences based on learning from conversations. Supports partial updates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string', description: 'The tenant ID to update the profile for' },
        updates: {
          type: 'object',
          description: 'Fields to update on the ALF profile',
          properties: {
            display_name: { type: 'string', description: 'User display name' },
            personality_style: { type: 'string', description: 'ALF personality style preference' },
            communication_tone: { type: 'string', description: 'Preferred communication tone' },
            interests: { type: 'array', items: { type: 'string' }, description: 'User interests' },
            goals: { type: 'array', items: { type: 'string' }, description: 'User goals' },
            custom_instructions: { type: 'string', description: 'Custom instructions for ALF' },
          },
        },
      },
      required: ['tenant_id', 'updates'],
    },
  },
  {
    name: 'shard_search',
    description: 'Search knowledge shards by query string. Matches against shard name and description.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query to match against shard name and description' },
        limit: { type: 'number', description: 'Maximum number of results to return (default: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'convergence_stats',
    description: 'Get environmental impact statistics: water saved (ml), power saved (Wh), carbon saved (g), and total shard hits.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant_id: { type: 'string', description: 'Tenant ID to scope stats to. If omitted, returns global stats.' },
      },
      required: [],
    },
  },
];

// ============================================
// Tool Dispatch
// ============================================

export async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'alf_profile_read': return handleAlfProfileRead(args);
    case 'alf_profile_update': return handleAlfProfileUpdate(args);
    case 'shard_search': return handleShardSearch(args);
    case 'convergence_stats': return handleConvergenceStats(args);
    default: throw new Error(`Unknown ALF tool: ${name}`);
  }
}

// ============================================
// Handlers
// ============================================

async function handleAlfProfileRead(args: Record<string, unknown>): Promise<string> {
  const tenantId = args['tenant_id'] as string;
  if (!tenantId?.trim()) return JSON.stringify({ error: 'tenant_id is required' });

  try {
    const pool = getSubstratePool();
    const result = await pool.query(
      'SELECT * FROM alf_profiles WHERE tenant_id = $1',
      [tenantId],
    );

    if (result.rows.length === 0) {
      return JSON.stringify({ error: 'Profile not found', tenant_id: tenantId });
    }

    return JSON.stringify({ profile: result.rows[0], tenant_id: tenantId });
  } catch (err) {
    log(`alf_profile_read error: ${err}`);
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAlfProfileUpdate(args: Record<string, unknown>): Promise<string> {
  const tenantId = args['tenant_id'] as string;
  const updates = args['updates'] as Record<string, unknown> | undefined;

  if (!tenantId?.trim()) return JSON.stringify({ error: 'tenant_id is required' });
  if (!updates || Object.keys(updates).length === 0) {
    return JSON.stringify({ error: 'updates object is required and must contain at least one field' });
  }

  const allowedFields = ['display_name', 'personality_style', 'communication_tone', 'interests', 'goals', 'custom_instructions'];
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  for (const field of allowedFields) {
    if (field in updates) {
      const value = updates[field];
      setClauses.push(`${field} = $${paramIndex}`);
      if (Array.isArray(value)) {
        values.push(JSON.stringify(value));
      } else {
        values.push(value);
      }
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    return JSON.stringify({ error: 'No valid fields to update. Allowed: ' + allowedFields.join(', ') });
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(tenantId);

  try {
    const pool = getSubstratePool();
    const sql = `UPDATE alf_profiles SET ${setClauses.join(', ')} WHERE tenant_id = $${paramIndex} RETURNING *`;
    const result = await pool.query(sql, values);

    if (result.rows.length === 0) {
      return JSON.stringify({ error: 'Profile not found', tenant_id: tenantId });
    }

    return JSON.stringify({
      updated: true,
      profile: result.rows[0],
      fields_updated: Object.keys(updates).filter(k => allowedFields.includes(k)),
    });
  } catch (err) {
    log(`alf_profile_update error: ${err}`);
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleShardSearch(args: Record<string, unknown>): Promise<string> {
  const query = args['query'] as string;
  const limit = (args['limit'] as number) ?? 10;

  if (!query?.trim()) return JSON.stringify({ error: 'query is required' });

  try {
    const pool = getSubstratePool();
    const result = await pool.query(
      `SELECT id, name, description, category, estimated_tokens, execution_count, lifecycle, knowledge_type, created_at, updated_at
       FROM procedural_shards
       WHERE (name ILIKE $1 OR description ILIKE $1) AND lifecycle != 'archived'
       ORDER BY execution_count DESC, created_at DESC
       LIMIT $2`,
      [`%${query}%`, Math.min(limit, 100)],
    );

    return JSON.stringify({ query, shards: result.rows, total: result.rows.length });
  } catch (err) {
    log(`shard_search error: ${err}`);
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleConvergenceStats(args: Record<string, unknown>): Promise<string> {
  const tenantId = args['tenant_id'] as string | undefined;

  try {
    const pool = getSubstratePool();
    let sql: string;
    let params: unknown[];

    if (tenantId?.trim()) {
      sql = `SELECT
               COALESCE(SUM(tokens_saved), 0) AS total_tokens_saved,
               COALESCE(SUM(water_ml_saved), 0) AS total_water_ml_saved,
               COALESCE(SUM(power_wh_saved), 0) AS total_power_wh_saved,
               COALESCE(SUM(carbon_g_saved), 0) AS total_carbon_g_saved,
               COUNT(*) FILTER (WHERE shard_id IS NOT NULL) AS total_shard_hits
             FROM chat_messages
             WHERE tenant_id = $1`;
      params = [tenantId];
    } else {
      sql = `SELECT
               COALESCE(SUM(tokens_saved), 0) AS total_tokens_saved,
               COALESCE(SUM(water_ml_saved), 0) AS total_water_ml_saved,
               COALESCE(SUM(power_wh_saved), 0) AS total_power_wh_saved,
               COALESCE(SUM(carbon_g_saved), 0) AS total_carbon_g_saved,
               COUNT(*) FILTER (WHERE shard_id IS NOT NULL) AS total_shard_hits
             FROM chat_messages`;
      params = [];
    }

    const result = await pool.query(sql, params);
    const row = result.rows[0] as Record<string, unknown>;

    return JSON.stringify({
      scope: tenantId ? 'tenant' : 'global',
      tenant_id: tenantId ?? null,
      stats: {
        total_tokens_saved: Number(row['total_tokens_saved']),
        total_water_ml_saved: Number(row['total_water_ml_saved']),
        total_power_wh_saved: Number(row['total_power_wh_saved']),
        total_carbon_g_saved: Number(row['total_carbon_g_saved']),
        total_shard_hits: Number(row['total_shard_hits']),
      },
    });
  } catch (err) {
    log(`convergence_stats error: ${err}`);
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}
