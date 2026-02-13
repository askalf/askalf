#!/usr/bin/env node

/**
 * MCP ALF Server (port 3013)
 *
 * Exposes ALF-specific capabilities via MCP protocol:
 * - alf_profile_read: Read user ALF profile (preferences, interests, goals, custom instructions)
 * - alf_profile_update: Update user preferences from conversation learning
 * - shard_search: Search knowledge shards by query
 * - convergence_stats: Get environmental impact statistics (water, power, carbon saved)
 *
 * Connects to the substrate database via @substrate/db.
 */

import express from 'express';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  getSubstratePool,
  closeAll,
} from '@substrate/db';

const PORT = parseInt(process.env['PORT'] ?? '3013', 10);
const log = (msg: string) => console.log(`[mcp-alf] ${new Date().toISOString()} ${msg}`);

// ============================================
// Express + MCP setup
// ============================================

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'mcp-alf' });
});

const transports = new Map<string, SSEServerTransport>();

app.get('/sse', async (_req, res) => {
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', 'text/event-stream');

  const transport = new SSEServerTransport('/message', res);
  const sessionId = (transport as unknown as { _sessionId: string })._sessionId;
  transports.set(sessionId, transport);

  const heartbeat = setInterval(() => {
    try { res.write(`event: heartbeat\ndata: {"ts":${Date.now()}}\n\n`); } catch { clearInterval(heartbeat); }
  }, 10000);

  _req.on('close', () => { clearInterval(heartbeat); transports.delete(sessionId); });

  try {
    const server = createMCPServer();
    await server.connect(transport);
    log(`Session ${sessionId} connected`);
  } catch {
    clearInterval(heartbeat);
    transports.delete(sessionId);
    res.end();
  }
});

app.post('/message', async (req, res) => {
  const sessionId = req.query['sessionId'] as string;
  if (!sessionId) { res.status(400).json({ error: 'Missing sessionId' }); return; }
  const transport = transports.get(sessionId);
  if (!transport) { res.status(404).json({ error: 'Session not found' }); return; }
  await transport.handlePostMessage(req, res);
});

// Streamable HTTP transport (stateless, per-request)
app.post('/mcp', async (req, res) => {
  try {
    const server = createMCPServer();
    const transport = new StreamableHTTPServerTransport({});
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    log(`Streamable HTTP error: ${error}`);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/mcp', (_req, res) => { res.status(405).json({ error: 'Use POST for streamable HTTP' }); });
app.delete('/mcp', (_req, res) => { res.status(405).json({ error: 'Session cleanup not supported in stateless mode' }); });

// ============================================
// Tool Definitions
// ============================================

const TOOLS = [
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
// Tool Handlers
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

    return JSON.stringify({
      profile: result.rows[0],
      tenant_id: tenantId,
    });
  } catch (err) {
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
      // Arrays (interests, goals) need to be stored as JSON
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

  // Add updated_at
  setClauses.push(`updated_at = NOW()`);

  // Add tenant_id as last param
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

    return JSON.stringify({
      query,
      shards: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
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
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

// ============================================
// Create MCP Server
// ============================================

function createMCPServer(): Server {
  const server = new Server(
    { name: 'mcp-alf', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log(`Tool called: ${name}`);

    try {
      let result: string;
      switch (name) {
        case 'alf_profile_read':
          result = await handleAlfProfileRead(args as Record<string, unknown>);
          break;
        case 'alf_profile_update':
          result = await handleAlfProfileUpdate(args as Record<string, unknown>);
          break;
        case 'shard_search':
          result = await handleShardSearch(args as Record<string, unknown>);
          break;
        case 'convergence_stats':
          result = await handleConvergenceStats(args as Record<string, unknown>);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return { content: [{ type: 'text', text: result }] };
    } catch (error) {
      log(`Tool failed: ${name} - ${error}`);
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }) }],
        isError: true,
      };
    }
  });

  return server;
}

// ============================================
// Graceful shutdown
// ============================================

process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down...');
  await closeAll();
  process.exit(0);
});

// ============================================
// Start
// ============================================

app.listen(PORT, '0.0.0.0', () => {
  log(`MCP ALF server listening on port ${PORT}`);
  log(`  POST /mcp     - Streamable HTTP endpoint`);
});
