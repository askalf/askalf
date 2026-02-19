/**
 * MCP Server - Expose Forge as an MCP Server
 * Allows Claude Desktop and other MCP clients to use forge agent tools.
 *
 * Exposed tools:
 * - list_agents: List all forge agents
 * - run_agent: Execute an agent with input
 * - search_memory: Search agent memory (semantic, episodic, procedural)
 * - get_agent: Get detailed info about a specific agent
 * - metabolic_status: Get the metabolic cycle status
 *
 * Transport: SSE (Server-Sent Events) for Claude Desktop compatibility
 * Endpoints: GET /mcp/sse (connect), POST /mcp/message (messages)
 */

import type { FastifyInstance } from 'fastify';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { query, queryOne } from '../database.js';
import { createExecutionRecord } from '../runtime/persistence.js';
import { runExecution } from '../runtime/worker.js';
import { getMetabolicStatus } from '../memory/metabolic.js';

// ============================================
// Types
// ============================================

interface AgentRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  owner_id: string;
  system_prompt: string | null;
  autonomy_level: number;
  created_at: string;
  updated_at: string;
}

interface MemoryRow {
  id: string;
  content: string | null;
  importance?: number;
  confidence?: number;
  outcome_quality?: number;
  situation?: string;
  action?: string;
  outcome?: string;
  trigger_pattern?: string;
  created_at: string;
}

// ============================================
// Tool Definitions (MCP schema format)
// ============================================

const FORGE_TOOLS = [
  {
    name: 'list_agents',
    description: 'List all forge agents. Returns agent names, IDs, status, and descriptions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Filter by status: draft, active, paused, archived. Omit for all.' },
        limit: { type: 'number', description: 'Max agents to return (default 50)' },
      },
    },
  },
  {
    name: 'get_agent',
    description: 'Get detailed info about a specific forge agent including system prompt and execution stats.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'The agent ID' },
        agentName: { type: 'string', description: 'Or search by agent name (partial match)' },
      },
    },
  },
  {
    name: 'run_agent',
    description: 'Execute a forge agent with the given input. Returns the execution ID. The agent runs asynchronously.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        agentId: { type: 'string', description: 'The agent ID to run' },
        input: { type: 'string', description: 'Input text/prompt for the agent' },
      },
      required: ['agentId', 'input'],
    },
  },
  {
    name: 'search_memory',
    description: 'Search agent memory across semantic, episodic, and procedural tiers. Uses text search.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query text' },
        agentId: { type: 'string', description: 'Filter to a specific agent (optional)' },
        tier: { type: 'string', description: 'Memory tier: semantic, episodic, procedural. Omit for all.' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'metabolic_status',
    description: 'Get the status of forge metabolic learning cycles (decay, lessons, promote, feedback, prompt-rewrite, goal-proposal) and memory tier counts.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
];

// ============================================
// Tool Handlers
// ============================================

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

async function handleListAgents(args: Record<string, unknown>): Promise<ToolResult> {
  const status = args['status'] as string | undefined;
  const limit = Math.min(Number(args['limit']) || 50, 100);

  let sql = `SELECT id, name, slug, description, status, autonomy_level, created_at FROM forge_agents`;
  const params: unknown[] = [];

  if (status) {
    sql += ` WHERE status = $1`;
    params.push(status);
  }
  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(limit);

  const rows = await query<AgentRow>(sql, params);

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        agents: rows.map((r) => ({
          id: r.id, name: r.name, status: r.status,
          description: r.description, autonomyLevel: r.autonomy_level,
          createdAt: r.created_at,
        })),
        total: rows.length,
      }, null, 2),
    }],
  };
}

async function handleGetAgent(args: Record<string, unknown>): Promise<ToolResult> {
  const agentId = args['agentId'] as string | undefined;
  const agentName = args['agentName'] as string | undefined;

  let agent: AgentRow | null = null;
  if (agentId) {
    agent = await queryOne<AgentRow>(`SELECT * FROM forge_agents WHERE id = $1`, [agentId]);
  } else if (agentName) {
    agent = await queryOne<AgentRow>(
      `SELECT * FROM forge_agents WHERE LOWER(name) LIKE LOWER($1) LIMIT 1`,
      [`%${agentName}%`],
    );
  }

  if (!agent) {
    return { content: [{ type: 'text', text: 'Agent not found' }], isError: true };
  }

  // Get execution stats
  const stats = await queryOne<{ total: string; completed: string; failed: string }>(
    `SELECT COUNT(*)::text AS total,
            COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
            COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
     FROM forge_executions WHERE agent_id = $1`,
    [agent.id],
  );

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        id: agent.id, name: agent.name, slug: agent.slug,
        status: agent.status, description: agent.description,
        systemPrompt: agent.system_prompt?.slice(0, 500),
        autonomyLevel: agent.autonomy_level,
        executions: {
          total: parseInt(stats?.total ?? '0', 10),
          completed: parseInt(stats?.completed ?? '0', 10),
          failed: parseInt(stats?.failed ?? '0', 10),
        },
        createdAt: agent.created_at, updatedAt: agent.updated_at,
      }, null, 2),
    }],
  };
}

async function handleRunAgent(args: Record<string, unknown>): Promise<ToolResult> {
  const agentId = args['agentId'] as string | undefined;
  const input = args['input'] as string | undefined;

  if (!agentId || !input) {
    return { content: [{ type: 'text', text: 'Error: agentId and input are required' }], isError: true };
  }

  const agent = await queryOne<AgentRow>(`SELECT id, owner_id, status FROM forge_agents WHERE id = $1`, [agentId]);
  if (!agent) {
    return { content: [{ type: 'text', text: `Agent ${agentId} not found` }], isError: true };
  }

  // Generate execution ID
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = Math.random().toString(36).slice(2, 12);
  const executionId = (timestamp + random).toUpperCase();

  await createExecutionRecord(executionId, agentId, undefined, agent.owner_id, input, 'mcp');

  // Fire and forget — execution runs asynchronously
  void runExecution(executionId, agentId, input, agent.owner_id).catch((err) => {
    console.error(`[MCP] Execution ${executionId} failed:`, err instanceof Error ? err.message : err);
  });

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        executionId,
        agentId,
        agentName: agent.id,
        status: 'started',
        message: `Execution ${executionId} started. Agent is processing asynchronously.`,
      }, null, 2),
    }],
  };
}

async function handleSearchMemory(args: Record<string, unknown>): Promise<ToolResult> {
  const searchQuery = args['query'] as string | undefined;
  const agentId = args['agentId'] as string | undefined;
  const tier = args['tier'] as string | undefined;
  const limit = Math.min(Number(args['limit']) || 20, 50);

  if (!searchQuery) {
    return { content: [{ type: 'text', text: 'Error: query is required' }], isError: true };
  }

  const results: Array<{ tier: string; id: string; content: string; score?: number; createdAt: string }> = [];
  const tsQuery = searchQuery.split(/\s+/).filter(Boolean).join(' & ');

  // Search semantic memories
  if (!tier || tier === 'semantic') {
    const semanticRows = await query<MemoryRow>(
      `SELECT id, content, importance, created_at
       FROM forge_semantic_memories
       WHERE content ILIKE $1 ${agentId ? 'AND agent_id = $3' : ''}
       ORDER BY importance DESC NULLS LAST LIMIT $2`,
      agentId ? [`%${searchQuery}%`, limit, agentId] : [`%${searchQuery}%`, limit],
    );
    for (const r of semanticRows) {
      results.push({ tier: 'semantic', id: r.id, content: r.content ?? '', score: r.importance, createdAt: r.created_at });
    }
  }

  // Search episodic memories
  if (!tier || tier === 'episodic') {
    const episodicRows = await query<MemoryRow>(
      `SELECT id, situation, action, outcome, outcome_quality, created_at
       FROM forge_episodic_memories
       WHERE (situation ILIKE $1 OR action ILIKE $1 OR outcome ILIKE $1)
       ${agentId ? 'AND agent_id = $3' : ''}
       ORDER BY created_at DESC LIMIT $2`,
      agentId ? [`%${searchQuery}%`, limit, agentId] : [`%${searchQuery}%`, limit],
    );
    for (const r of episodicRows) {
      results.push({
        tier: 'episodic', id: r.id,
        content: `Situation: ${r.situation}\nAction: ${r.action}\nOutcome: ${r.outcome}`,
        score: r.outcome_quality, createdAt: r.created_at,
      });
    }
  }

  // Search procedural memories
  if (!tier || tier === 'procedural') {
    const proceduralRows = await query<MemoryRow>(
      `SELECT id, trigger_pattern, confidence, created_at
       FROM forge_procedural_memories
       WHERE trigger_pattern ILIKE $1 ${agentId ? 'AND agent_id = $3' : ''}
       ORDER BY confidence DESC NULLS LAST LIMIT $2`,
      agentId ? [`%${searchQuery}%`, limit, agentId] : [`%${searchQuery}%`, limit],
    );
    for (const r of proceduralRows) {
      results.push({ tier: 'procedural', id: r.id, content: r.trigger_pattern ?? '', score: r.confidence, createdAt: r.created_at });
    }
  }

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({ query: searchQuery, results, total: results.length }, null, 2),
    }],
  };
}

async function handleMetabolicStatus(): Promise<ToolResult> {
  const cycles = getMetabolicStatus();

  const memoryCounts = await query<{ tier: string; count: string }>(
    `SELECT 'procedural' AS tier, COUNT(*)::text AS count FROM forge_procedural_memories
     UNION ALL SELECT 'semantic', COUNT(*)::text FROM forge_semantic_memories
     UNION ALL SELECT 'episodic', COUNT(*)::text FROM forge_episodic_memories`,
  );

  const memory = Object.fromEntries(memoryCounts.map((r) => [r.tier, parseInt(r.count, 10)]));

  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        uptimeSeconds: Math.round(process.uptime()),
        cycles: cycles.map((c) => ({
          name: c.cycle,
          interval: `${c.intervalHours}h`,
          lastRun: c.lastRun,
          runCount: c.runCount,
          lastDurationMs: c.lastDurationMs,
          lastResult: c.lastResult,
          lastError: c.lastError,
        })),
        memory,
      }, null, 2),
    }],
  };
}

// ============================================
// Tool Dispatcher
// ============================================

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'list_agents': return handleListAgents(args);
    case 'get_agent': return handleGetAgent(args);
    case 'run_agent': return handleRunAgent(args);
    case 'search_memory': return handleSearchMemory(args);
    case 'metabolic_status': return handleMetabolicStatus();
    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
}

// ============================================
// MCP Server Factory
// ============================================

function createMCPServer(): Server {
  const server = new Server(
    { name: 'forge', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: FORGE_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await dispatchTool(name, (args ?? {}) as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: `Tool error: ${msg}` }], isError: true };
    }
  });

  return server;
}

// ============================================
// Fastify Route Registration
// ============================================

const transports = new Map<string, SSEServerTransport>();

export async function registerMCPRoutes(app: FastifyInstance): Promise<void> {
  // SSE connection endpoint — Claude Desktop connects here
  app.get('/mcp/sse', { logLevel: 'info' }, async (request, reply) => {
    // Use raw Node.js response for SSE transport
    const res = reply.raw;
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Type', 'text/event-stream');

    const transport = new SSEServerTransport('/mcp/message', res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    const server = createMCPServer();

    // Clean up on disconnect
    request.raw.on('close', () => {
      transports.delete(sessionId);
      void server.close().catch(() => {});
    });

    await server.connect(transport);
    console.log(`[MCP] SSE client connected: ${sessionId}`);

    // Keep Fastify from closing the response
    await reply.hijack();
  });

  // Message endpoint — receives tool calls from the SSE client
  app.post('/mcp/message', { logLevel: 'info' }, async (request, reply) => {
    const sessionId = (request.query as Record<string, string>)['sessionId'];
    if (!sessionId) {
      return reply.status(400).send({ error: 'Missing sessionId query parameter' });
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      return reply.status(404).send({ error: 'Session not found. Connect via /mcp/sse first.' });
    }

    // SSEServerTransport.handlePostMessage expects Express-style req/res
    await transport.handlePostMessage(request.raw, reply.raw);
    await reply.hijack();
  });

  console.log(`[MCP] Forge MCP server routes registered: GET /mcp/sse, POST /mcp/message`);
}
