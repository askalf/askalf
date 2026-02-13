/**
 * ALF Chat Tools — In-process tool definitions and executors for agentic chat.
 *
 * These tools let ALF search knowledge, read user profiles, and check
 * environmental impact stats during conversation. SQL queries match
 * the mcp-alf server implementations exactly.
 */

import { query } from '@substrate/database';

// ============================================
// Tool Definitions (Anthropic Tool format)
// ============================================

export interface AlfTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const ALF_TOOLS: AlfTool[] = [
  {
    name: 'shard_search',
    description: 'Search knowledge shards by query. Use this when the user asks about a topic that might have cached knowledge available, or when they want to explore what topics ALF knows about.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match against shard name and description' },
        limit: { type: 'number', description: 'Maximum results to return (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'alf_profile_read',
    description: 'Read the current user\'s ALF profile including their preferences, interests, goals, and custom instructions. Use this when you need to know more about the user.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'convergence_stats',
    description: 'Get environmental impact statistics: water saved (ml), power saved (Wh), carbon saved (g), and total knowledge shard hits. Use when the user asks about ALF\'s environmental impact or convergence stats.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

// ============================================
// Tool Executor
// ============================================

export async function executeAlfTool(
  name: string,
  input: Record<string, unknown>,
  tenantId: string,
): Promise<string> {
  try {
    switch (name) {
      case 'shard_search':
        return await handleShardSearch(input);
      case 'alf_profile_read':
        return await handleProfileRead(tenantId);
      case 'convergence_stats':
        return await handleConvergenceStats(tenantId);
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ============================================
// Tool Handlers (SQL from mcp-alf/src/server.ts)
// ============================================

async function handleShardSearch(input: Record<string, unknown>): Promise<string> {
  const searchQuery = input['query'] as string;
  const limit = (input['limit'] as number) ?? 5;

  if (!searchQuery?.trim()) {
    return JSON.stringify({ error: 'query is required' });
  }

  const result = await query(
    `SELECT id, name, description, category, estimated_tokens, execution_count, lifecycle, knowledge_type, created_at, updated_at
     FROM procedural_shards
     WHERE (name ILIKE $1 OR description ILIKE $1) AND lifecycle != 'archived'
     ORDER BY execution_count DESC, created_at DESC
     LIMIT $2`,
    [`%${searchQuery}%`, Math.min(limit, 50)],
  );

  return JSON.stringify({
    query: searchQuery,
    shards: result,
    total: result.length,
  });
}

async function handleProfileRead(tenantId: string): Promise<string> {
  if (!tenantId?.trim()) {
    return JSON.stringify({ error: 'No tenant context' });
  }

  const result = await query(
    'SELECT * FROM alf_profiles WHERE tenant_id = $1',
    [tenantId],
  );

  if (result.length === 0) {
    return JSON.stringify({ error: 'Profile not found', tenant_id: tenantId });
  }

  return JSON.stringify({
    profile: result[0],
    tenant_id: tenantId,
  });
}

async function handleConvergenceStats(tenantId: string): Promise<string> {
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
           WHERE session_id IN (SELECT id FROM chat_sessions WHERE tenant_id = $1)`;
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

  const rows = await query<Record<string, unknown>>(sql, params);
  const row = rows[0] ?? {};

  return JSON.stringify({
    scope: tenantId ? 'tenant' : 'global',
    tenant_id: tenantId ?? null,
    stats: {
      total_tokens_saved: Number(row['total_tokens_saved'] ?? 0),
      total_water_ml_saved: Number(row['total_water_ml_saved'] ?? 0),
      total_power_wh_saved: Number(row['total_power_wh_saved'] ?? 0),
      total_carbon_g_saved: Number(row['total_carbon_g_saved'] ?? 0),
      total_shard_hits: Number(row['total_shard_hits'] ?? 0),
    },
  });
}
