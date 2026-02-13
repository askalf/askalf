#!/usr/bin/env node

/**
 * MCP Data Server (port 3011)
 *
 * Exposes data access tools via MCP protocol:
 * - db_query: Read-only SQL against forge database
 * - substrate_db_query: Read-only SQL against substrate database
 * - memory_search: Search fleet 4-tier cognitive memory
 * - memory_store: Store knowledge/episodes/procedures in fleet memory
 *
 * Connects to both forge and substrate databases plus Redis.
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
  getForgePool,
  getSubstratePool,
  getRedis,
  generateId,
  closeAll,
} from '@substrate/db';
import OpenAI from 'openai';

const PORT = parseInt(process.env['PORT'] ?? '3011', 10);
const MAX_ROWS = 100;
const log = (msg: string) => console.log(`[mcp-data] ${new Date().toISOString()} ${msg}`);

// ============================================
// OpenAI Embeddings (for vector memory search)
// ============================================

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY required for fleet memory embeddings');
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

async function embed(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  });
  return response.data[0]!.embedding;
}

// ============================================
// Express + MCP setup
// ============================================

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'mcp-data' });
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
    name: 'db_query',
    description: 'Execute a read-only SQL query against the forge database. Only SELECT, WITH, EXPLAIN allowed. Max 100 rows.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'The SQL query to execute' },
        params: { type: 'array', items: {}, description: 'Query parameters for $1, $2, etc.' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'substrate_db_query',
    description: 'Execute a read-only SQL query against the substrate database. Only SELECT, WITH, EXPLAIN allowed. Max 100 rows.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'The SQL query to execute' },
        params: { type: 'array', items: {}, description: 'Query parameters for $1, $2, etc.' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search fleet cognitive memory (semantic, episodic, procedural tiers) for relevant knowledge.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        agent_id: { type: 'string', description: 'Agent ID to scope the search' },
        memory_type: { type: 'string', enum: ['semantic', 'episodic', 'procedural', 'all'], description: 'Memory tier to search (default: all)' },
        limit: { type: 'number', description: 'Maximum results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_store',
    description: 'Store knowledge, experiences, or procedures in fleet cognitive memory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['semantic', 'episodic', 'procedural'], description: 'Memory tier to store in' },
        agent_id: { type: 'string', description: 'Agent ID storing the memory' },
        content: { type: 'string', description: 'Content to store. For episodic: the situation.' },
        action: { type: 'string', description: 'For episodic: the action taken' },
        outcome: { type: 'string', description: 'For episodic: the outcome' },
        quality: { type: 'number', description: 'For episodic: quality 0-1 (1=success, 0=failure)' },
        trigger_pattern: { type: 'string', description: 'For procedural: trigger pattern' },
        tool_sequence: { type: 'array', description: 'For procedural: tool sequence array' },
        importance: { type: 'number', description: 'For semantic: importance 0-1' },
        source: { type: 'string', description: 'Source label' },
        metadata: { type: 'object', description: 'Additional metadata' },
      },
      required: ['type', 'content'],
    },
  },
];

// ============================================
// Tool Handlers
// ============================================

function validateReadOnly(sql: string): string | null {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH') && !trimmed.startsWith('EXPLAIN')) {
    return 'Only SELECT, WITH (CTE), and EXPLAIN queries are allowed';
  }
  return null;
}

async function handleDbQuery(args: Record<string, unknown>): Promise<string> {
  const sql = args['sql'] as string;
  const params = (args['params'] as unknown[]) ?? [];

  const error = validateReadOnly(sql);
  if (error) return JSON.stringify({ error });

  try {
    const p = getForgePool();
    let finalSql = sql;
    if (!sql.toUpperCase().includes('LIMIT')) {
      finalSql = `${sql} LIMIT ${MAX_ROWS}`;
    }
    const result = await p.query(finalSql, params);
    return JSON.stringify({
      rows: result.rows,
      rowCount: result.rows.length,
      truncated: result.rows.length >= MAX_ROWS,
      database: 'forge',
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleSubstrateDbQuery(args: Record<string, unknown>): Promise<string> {
  const sql = args['sql'] as string;
  const params = (args['params'] as unknown[]) ?? [];

  const error = validateReadOnly(sql);
  if (error) return JSON.stringify({ error });

  try {
    const p = getSubstratePool();
    let finalSql = sql;
    if (!sql.toUpperCase().includes('LIMIT')) {
      finalSql = `${sql} LIMIT ${MAX_ROWS}`;
    }
    const result = await p.query(finalSql, params);
    return JSON.stringify({
      rows: result.rows,
      rowCount: result.rows.length,
      truncated: result.rows.length >= MAX_ROWS,
      database: 'substrate',
    });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleMemorySearch(args: Record<string, unknown>): Promise<string> {
  const queryText = args['query'] as string;
  const agentId = (args['agent_id'] as string) ?? null;
  const memoryType = (args['memory_type'] as string) ?? 'all';
  const limit = (args['limit'] as number) ?? 5;

  if (!queryText.trim()) return JSON.stringify({ error: 'Search query cannot be empty' });

  try {
    const p = getForgePool();
    const memories: Array<Record<string, unknown>> = [];

    // Generate embedding for vector search
    let queryEmbedding: number[];
    try {
      queryEmbedding = await embed(queryText);
    } catch (embErr) {
      // Fallback to text search if embedding fails
      log(`Embedding failed, falling back to text search: ${embErr}`);
      return handleMemorySearchFallback(args);
    }

    const vecLiteral = `[${queryEmbedding.join(',')}]`;

    // Search semantic memory (forge DB, pgvector)
    if (memoryType === 'all' || memoryType === 'semantic') {
      try {
        const agentFilter = agentId ? 'AND agent_id = $2' : '';
        const params: unknown[] = [vecLiteral];
        if (agentId) params.push(agentId);

        const result = await p.query(
          `SELECT id, agent_id, content, source, importance, access_count,
                  1 - (embedding <=> $1::vector) AS similarity, created_at
           FROM forge_semantic_memories
           WHERE embedding IS NOT NULL ${agentFilter}
           ORDER BY embedding <=> $1::vector
           LIMIT ${limit}`,
          params,
        );
        for (const row of result.rows) {
          const r = row as Record<string, unknown>;
          memories.push({
            id: r['id'],
            memoryType: 'semantic',
            content: r['content'],
            source: r['source'],
            importance: r['importance'],
            similarity: r['similarity'],
            agentId: r['agent_id'],
            createdAt: r['created_at'],
          });
        }
      } catch (err) {
        log(`Semantic search error: ${err}`);
      }
    }

    // Search episodic memory (forge DB, pgvector)
    if (memoryType === 'all' || memoryType === 'episodic') {
      try {
        const agentFilter = agentId ? 'AND agent_id = $2' : '';
        const params: unknown[] = [vecLiteral];
        if (agentId) params.push(agentId);

        const result = await p.query(
          `SELECT id, agent_id, situation, action, outcome, outcome_quality,
                  execution_id, 1 - (embedding <=> $1::vector) AS similarity, created_at
           FROM forge_episodic_memories
           WHERE embedding IS NOT NULL ${agentFilter}
           ORDER BY embedding <=> $1::vector
           LIMIT ${limit}`,
          params,
        );
        for (const row of result.rows) {
          const r = row as Record<string, unknown>;
          memories.push({
            id: r['id'],
            memoryType: 'episodic',
            situation: r['situation'],
            action: r['action'],
            outcome: r['outcome'],
            quality: r['outcome_quality'],
            similarity: r['similarity'],
            agentId: r['agent_id'],
            executionId: r['execution_id'],
            createdAt: r['created_at'],
          });
        }
      } catch (err) {
        log(`Episodic search error: ${err}`);
      }
    }

    // Search procedural memory (forge DB, pgvector)
    if (memoryType === 'all' || memoryType === 'procedural') {
      try {
        const agentFilter = agentId ? 'AND agent_id = $2' : '';
        const params: unknown[] = [vecLiteral];
        if (agentId) params.push(agentId);

        const result = await p.query(
          `SELECT id, agent_id, trigger_pattern, tool_sequence, success_count,
                  failure_count, confidence, 1 - (embedding <=> $1::vector) AS similarity, created_at
           FROM forge_procedural_memories
           WHERE embedding IS NOT NULL ${agentFilter}
           ORDER BY embedding <=> $1::vector
           LIMIT ${limit}`,
          params,
        );
        for (const row of result.rows) {
          const r = row as Record<string, unknown>;
          memories.push({
            id: r['id'],
            memoryType: 'procedural',
            triggerPattern: r['trigger_pattern'],
            toolSequence: r['tool_sequence'],
            confidence: r['confidence'],
            successCount: r['success_count'],
            failureCount: r['failure_count'],
            similarity: r['similarity'],
            agentId: r['agent_id'],
            createdAt: r['created_at'],
          });
        }
      } catch (err) {
        log(`Procedural search error: ${err}`);
      }
    }

    // Also check Redis working memory if agent specified
    if (agentId && (memoryType === 'all' || memoryType === 'working')) {
      try {
        const redis = getRedis();
        // Scan for any working memory keys for this agent
        let cursor = '0';
        const wmKeys: string[] = [];
        do {
          const [next, found] = await redis.scan(cursor, 'MATCH', `fleet:forge:wm:${agentId}:*`, 'COUNT', 50);
          cursor = next;
          wmKeys.push(...found);
        } while (cursor !== '0');

        for (const key of wmKeys.slice(0, 3)) {
          const data = await redis.hgetall(key);
          if (Object.keys(data).length > 0) {
            memories.push({
              memoryType: 'working',
              key,
              fields: Object.keys(data),
              agentId,
            });
          }
        }
      } catch { /* working memory scan failed, non-fatal */ }
    }

    return JSON.stringify({
      query: queryText,
      memoryType,
      memories,
      total: memories.length,
    });
  } catch (err) {
    return JSON.stringify({ error: `Memory search failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

/** Text-based fallback when embeddings are unavailable */
async function handleMemorySearchFallback(args: Record<string, unknown>): Promise<string> {
  const queryText = args['query'] as string;
  const agentId = (args['agent_id'] as string) ?? null;
  const memoryType = (args['memory_type'] as string) ?? 'all';
  const limit = (args['limit'] as number) ?? 5;

  const p = getForgePool();
  const memories: Array<Record<string, unknown>> = [];
  const agentFilter = agentId ? 'AND agent_id = $2' : '';
  const baseParams: unknown[] = [`%${queryText}%`];
  if (agentId) baseParams.push(agentId);

  if (memoryType === 'all' || memoryType === 'semantic') {
    try {
      const result = await p.query(
        `SELECT id, agent_id, content, source, importance, created_at
         FROM forge_semantic_memories
         WHERE content ILIKE $1 ${agentFilter}
         ORDER BY importance DESC LIMIT ${limit}`,
        baseParams,
      );
      for (const r of result.rows as Array<Record<string, unknown>>) {
        memories.push({ id: r['id'], memoryType: 'semantic', content: r['content'], importance: r['importance'], agentId: r['agent_id'], createdAt: r['created_at'] });
      }
    } catch { /* */ }
  }

  if (memoryType === 'all' || memoryType === 'episodic') {
    try {
      const result = await p.query(
        `SELECT id, agent_id, situation, action, outcome, outcome_quality, created_at
         FROM forge_episodic_memories
         WHERE situation ILIKE $1 OR action ILIKE $1 OR outcome ILIKE $1 ${agentFilter}
         ORDER BY outcome_quality DESC LIMIT ${limit}`,
        baseParams,
      );
      for (const r of result.rows as Array<Record<string, unknown>>) {
        memories.push({ id: r['id'], memoryType: 'episodic', situation: r['situation'], action: r['action'], outcome: r['outcome'], quality: r['outcome_quality'], agentId: r['agent_id'], createdAt: r['created_at'] });
      }
    } catch { /* */ }
  }

  if (memoryType === 'all' || memoryType === 'procedural') {
    try {
      const result = await p.query(
        `SELECT id, agent_id, trigger_pattern, tool_sequence, confidence, created_at
         FROM forge_procedural_memories
         WHERE trigger_pattern ILIKE $1 ${agentFilter}
         ORDER BY confidence DESC LIMIT ${limit}`,
        baseParams,
      );
      for (const r of result.rows as Array<Record<string, unknown>>) {
        memories.push({ id: r['id'], memoryType: 'procedural', triggerPattern: r['trigger_pattern'], toolSequence: r['tool_sequence'], confidence: r['confidence'], agentId: r['agent_id'], createdAt: r['created_at'] });
      }
    } catch { /* */ }
  }

  return JSON.stringify({ query: queryText, memoryType, memories, total: memories.length, fallback: true });
}

async function handleMemoryStore(args: Record<string, unknown>): Promise<string> {
  const type = args['type'] as string;
  const content = args['content'] as string;
  const agentId = (args['agent_id'] as string) ?? 'fleet:system';

  if (!content?.trim() && type !== 'procedural') {
    return JSON.stringify({ error: 'content is required' });
  }

  try {
    const p = getForgePool();
    const memoryId = generateId();

    switch (type) {
      case 'semantic': {
        const importance = (args['importance'] as number) ?? 0.5;
        const source = (args['source'] as string) ?? 'agent';
        const metadata = (args['metadata'] as Record<string, unknown>) ?? {};

        // Generate embedding for vector search
        let embedding: number[] | null = null;
        try {
          embedding = await embed(content);
        } catch (embErr) {
          log(`Embedding failed for semantic store, storing without vector: ${embErr}`);
        }

        await p.query(
          `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, embedding, source, importance, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            memoryId,
            agentId,
            agentId,
            content,
            embedding ? `[${embedding.join(',')}]` : null,
            source,
            importance,
            JSON.stringify(metadata),
          ],
        );
        return JSON.stringify({ stored: true, memoryId, type: 'semantic', hasEmbedding: !!embedding });
      }

      case 'episodic': {
        const action = (args['action'] as string) ?? 'No action recorded';
        const outcome = (args['outcome'] as string) ?? 'No outcome recorded';
        const quality = (args['quality'] as number) ?? 0.5;
        const metadata = (args['metadata'] as Record<string, unknown>) ?? {};
        const executionId = (args['execution_id'] as string) ?? null;

        // Generate embedding from situation+action+outcome
        let embedding: number[] | null = null;
        try {
          embedding = await embed(`${content} ${action} ${outcome}`);
        } catch (embErr) {
          log(`Embedding failed for episodic store, storing without vector: ${embErr}`);
        }

        await p.query(
          `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, execution_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            memoryId,
            agentId,
            agentId,
            content,
            action,
            outcome,
            quality,
            embedding ? `[${embedding.join(',')}]` : null,
            executionId,
            JSON.stringify(metadata),
          ],
        );
        return JSON.stringify({ stored: true, memoryId, type: 'episodic', hasEmbedding: !!embedding });
      }

      case 'procedural': {
        const triggerPattern = (args['trigger_pattern'] as string) ?? content;
        const toolSequence = (args['tool_sequence'] as unknown[]) ?? [];
        if (!triggerPattern) return JSON.stringify({ error: 'trigger_pattern is required for procedural memory' });
        if (!toolSequence?.length) return JSON.stringify({ error: 'tool_sequence is required for procedural memory' });
        const metadata = (args['metadata'] as Record<string, unknown>) ?? {};

        // Generate embedding from trigger pattern
        let embedding: number[] | null = null;
        try {
          embedding = await embed(triggerPattern);
        } catch (embErr) {
          log(`Embedding failed for procedural store, storing without vector: ${embErr}`);
        }

        await p.query(
          `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, embedding, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            memoryId,
            agentId,
            agentId,
            triggerPattern,
            JSON.stringify(toolSequence),
            embedding ? `[${embedding.join(',')}]` : null,
            JSON.stringify(metadata),
          ],
        );
        return JSON.stringify({ stored: true, memoryId, type: 'procedural', hasEmbedding: !!embedding });
      }

      default:
        return JSON.stringify({ error: `Unknown memory type: ${type}. Supported: semantic, episodic, procedural` });
    }
  } catch (err) {
    return JSON.stringify({ error: `Memory store failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

// ============================================
// Create MCP Server
// ============================================

function createMCPServer(): Server {
  const server = new Server(
    { name: 'mcp-data', version: '1.0.0' },
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
        case 'db_query':
          result = await handleDbQuery(args as Record<string, unknown>);
          break;
        case 'substrate_db_query':
          result = await handleSubstrateDbQuery(args as Record<string, unknown>);
          break;
        case 'memory_search':
          result = await handleMemorySearch(args as Record<string, unknown>);
          break;
        case 'memory_store':
          result = await handleMemoryStore(args as Record<string, unknown>);
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
  log(`MCP Data server listening on port ${PORT}`);
  log(`  POST /mcp     - Streamable HTTP endpoint`);
});
