#!/usr/bin/env node

/**
 * SUBSTRATE MCP Server - HTTP/SSE Transport
 *
 * This version runs as a containerized service with:
 * - SSE (Server-Sent Events) for server -> client communication
 * - HTTP POST for client -> server messages
 * - API key authentication for secure remote access
 */

import express from 'express';
import cors from 'cors';
import { Redis } from 'ioredis';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { initializePool, query, queryOne } from '@substrate/database';
import { initializeAI, generateEmbedding, extractIntent } from '@substrate/ai';
import { procedural, episodic, semantic, working, TenantContext, Visibility } from '@substrate/memory';
import { execute as executeShard } from '@substrate/sandbox';
import { validateApiKey as authValidateApiKey } from '@substrate/auth/api-keys';
// Traces are unlimited - no usage tracking needed
import type { ApiKey } from '@substrate/auth/types';

const PORT = parseInt(process.env['PORT'] ?? '3002', 10);
const log = (msg: string) => console.log(`[substrate-mcp] ${new Date().toISOString()} ${msg}`);

// Initialize database connection
const databaseUrl = process.env['DATABASE_URL'] ?? 'postgresql://substrate:substrate_dev@localhost:5432/substrate';
initializePool({ connectionString: databaseUrl });

// Initialize AI (for embeddings)
initializeAI({
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
  openaiApiKey: process.env['OPENAI_API_KEY'],
});

// ===========================================
// REDIS SESSION STORE (for horizontal scaling)
// ===========================================
// Note: SSEServerTransport objects cannot be serialized to Redis
// (they contain live response streams). Session metadata is stored
// in Redis for coordination, but transports remain in-memory.
// For multi-instance deployment, use sticky sessions at the load balancer.

interface SessionMetadata {
  tenantId: string;
  apiKeyName: string;
  createdAt: string;
  lastActivity: string;
  serverId: string;
}

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const SERVER_ID = process.env['HOSTNAME'] ?? `mcp-${Date.now()}`;
const SESSION_TTL = 3600; // 1 hour

let redis: Redis | null = null;

async function initializeRedis(): Promise<Redis | null> {
  try {
    redis = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 100, 3000),
    });

    redis.on('error', (err) => {
      log(`Redis error: ${err.message}`);
    });

    redis.on('connect', () => {
      log('Connected to Redis for session store');
    });

    // Test connection
    await redis.ping();
    return redis;
  } catch (error) {
    log(`Redis connection failed (sessions will be local-only): ${error}`);
    return null;
  }
}

async function storeSessionMetadata(sessionId: string, metadata: SessionMetadata): Promise<void> {
  if (!redis) return;
  try {
    await redis.setex(
      `mcp:session:${sessionId}`,
      SESSION_TTL,
      JSON.stringify(metadata)
    );
  } catch (error) {
    log(`Failed to store session metadata: ${error}`);
  }
}

async function updateSessionActivity(sessionId: string): Promise<void> {
  if (!redis) return;
  try {
    const key = `mcp:session:${sessionId}`;
    const data = await redis.get(key);
    if (data) {
      const metadata = JSON.parse(data) as SessionMetadata;
      metadata.lastActivity = new Date().toISOString();
      await redis.setex(key, SESSION_TTL, JSON.stringify(metadata));
    }
  } catch {
    // Non-critical, ignore
  }
}

async function removeSessionMetadata(sessionId: string): Promise<void> {
  if (!redis) return;
  try {
    await redis.del(`mcp:session:${sessionId}`);
  } catch {
    // Non-critical, ignore
  }
}

// Initialize Redis on startup
initializeRedis();

// ===========================================
// API KEY AUTHENTICATION
// ===========================================

async function validateApiKey(authHeader: string | undefined): Promise<ApiKey | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const apiKey = authHeader.substring(7);
  if (!apiKey) return null;

  // Use the auth package's validation (handles hashing, expiry, status checks)
  return authValidateApiKey(apiKey);
}

// ===========================================
// EXPRESS APP SETUP
// ===========================================

const app = express();

app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Health check (no auth required)
app.get('/health', async (_req, res) => {
  const redisConnected = redis?.status === 'ready';
  res.json({
    status: 'healthy',
    service: 'substrate-mcp',
    serverId: SERVER_ID,
    activeSessions: transports.size,
    redis: redisConnected ? 'connected' : 'disconnected',
  });
});

// Sessions monitoring endpoint (useful for debugging horizontal scaling)
app.get('/sessions', async (req, res) => {
  // Require API key for security
  const apiKey = await validateApiKey(req.headers.authorization);
  if (!apiKey) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  // Get local sessions
  const localSessions = Array.from(transports.keys());

  // Get all sessions from Redis if available
  let allSessions: string[] = [];
  if (redis) {
    try {
      const keys = await redis.keys('mcp:session:*');
      allSessions = keys.map(k => k.replace('mcp:session:', ''));
    } catch {
      // Redis unavailable
    }
  }

  res.json({
    serverId: SERVER_ID,
    localSessionCount: localSessions.length,
    localSessions,
    totalSessionCount: allSessions.length,
    allSessions,
    hint: 'For horizontal scaling, ensure sticky sessions at the load balancer level.',
  });
});

// Track active transports by session ID (from SSEServerTransport)
const transports = new Map<string, SSEServerTransport>();

// ===========================================
// SSE ENDPOINT (Server -> Client)
// ===========================================

app.get('/sse', async (req, res) => {
  log(`SSE connection request from ${req.ip}`);

  // Validate API key
  const apiKey = await validateApiKey(req.headers.authorization);
  if (!apiKey) {
    log('SSE connection rejected: Invalid API key');
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  // Use tenant_id for multi-tenancy (user_id may be null for tenant-wide keys)
  const tenantId = apiKey.tenant_id;
  log(`SSE connection authenticated for tenant ${tenantId} (key: ${apiKey.name})`);

  // Build tenant context from authenticated API key
  const tenantContext: TenantContext = { tenantId };
  const visibility: Visibility = 'private';

  // Set headers to prevent buffering at any layer (nginx, cloudflare, etc.)
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Type', 'text/event-stream');

  // Helper to send SSE error events to client
  const sendErrorEvent = (code: string, message: string, details?: Record<string, unknown>) => {
    try {
      const errorData = JSON.stringify({ code, message, details, timestamp: new Date().toISOString() });
      res.write(`event: error\ndata: ${errorData}\n\n`);
      if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
        (res as unknown as { flush: () => void }).flush();
      }
    } catch {
      // Connection already closed
    }
  };

  // Create SSE transport - it auto-generates sessionId and sends it to client
  const transport = new SSEServerTransport('/message', res);

  // Get the session ID from the transport (it's set after construction)
  // The transport sends: event: endpoint\ndata: /message?sessionId=xxx
  const sessionId = (transport as unknown as { _sessionId: string })._sessionId;

  // Store transport for message routing by sessionId
  transports.set(sessionId, transport);
  log(`SSE transport created with sessionId: ${sessionId}`);

  // Store session metadata in Redis for horizontal scaling coordination
  await storeSessionMetadata(sessionId, {
    tenantId,
    apiKeyName: apiKey.name,
    createdAt: new Date().toISOString(),
    lastActivity: new Date().toISOString(),
    serverId: SERVER_ID,
  });

  // Heartbeat to keep connection alive through Cloudflare
  // Using actual SSE data events instead of comments for better proxy compatibility
  const heartbeatInterval = setInterval(() => {
    try {
      // Send actual SSE event (not just comment) to ensure Cloudflare sees activity
      const timestamp = Date.now();
      res.write(`event: heartbeat\ndata: {"ts":${timestamp}}\n\n`);
      // Flush to ensure data is sent immediately through proxies
      if (typeof (res as unknown as { flush?: () => void }).flush === 'function') {
        (res as unknown as { flush: () => void }).flush();
      }
    } catch {
      clearInterval(heartbeatInterval);
    }
  }, 10000); // 10 seconds to stay well under Cloudflare's 100s limit

  // Clean up on disconnect
  req.on('close', () => {
    log(`SSE connection closed for tenant ${tenantId} (session: ${sessionId})`);
    clearInterval(heartbeatInterval);
    transports.delete(sessionId);
    removeSessionMetadata(sessionId);
  });

  // Create and connect MCP Server with error handling
  try {
    const server = createMCPServer(tenantContext, visibility);
    await server.connect(transport);
    log(`MCP server connected for tenant ${tenantId} (session: ${sessionId})`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    log(`MCP server connection failed for tenant ${tenantId}: ${errorMessage}`);

    // Send error event to client before closing
    sendErrorEvent('CONNECTION_FAILED', 'Failed to initialize MCP server', {
      reason: errorMessage,
      sessionId,
    });

    // Clean up
    clearInterval(heartbeatInterval);
    transports.delete(sessionId);
    removeSessionMetadata(sessionId);

    // End the response
    res.end();
  }
});

// ===========================================
// MESSAGE ENDPOINT (Client -> Server)
// ===========================================

app.post('/message', async (req, res) => {
  // Validate API key
  const apiKeyInfo = await validateApiKey(req.headers.authorization);
  if (!apiKeyInfo) {
    log('Message rejected: Invalid API key');
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }

  // Get session ID from query parameter (sent by SSE endpoint event)
  const sessionId = req.query['sessionId'] as string;
  if (!sessionId) {
    log('Message rejected: Missing sessionId');
    res.status(400).json({ error: 'Missing sessionId query parameter' });
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    log(`Message rejected: Transport not found for session ${sessionId}`);
    res.status(404).json({
      error: 'Transport not found. Reconnect to /sse first.',
      code: 'SESSION_NOT_FOUND',
      hint: 'Your session may have expired or connected to a different server instance.',
    });
    return;
  }

  log(`Message received for session ${sessionId}`);

  // Update session activity in Redis
  updateSessionActivity(sessionId);

  // Forward message to transport
  await transport.handlePostMessage(req, res);
});

// ===========================================
// CREATE MCP SERVER
// ===========================================

function createMCPServer(tenantContext: TenantContext, visibility: Visibility): Server {
  const server = new Server(
    {
      name: 'substrate',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  // Tool definitions
  const TOOLS = [
    {
      name: 'execute_shard',
      description: 'Execute a procedural shard (learned procedure) by ID or semantic search. Returns the computed result without using LLM tokens.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          shardId: {
            type: 'string',
            description: 'The ID of the shard to execute (optional if using query)',
          },
          query: {
            type: 'string',
            description: 'Semantic search query to find a matching shard (optional if using shardId)',
          },
          input: {
            type: 'string',
            description: 'The input to pass to the shard',
          },
        },
        required: ['input'],
      },
    },
    {
      name: 'search_shards',
      description: 'Search for procedural shards by semantic similarity. Use this to discover what learned procedures are available.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'The search query',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 5)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'ingest_trace',
      description: 'Record a reasoning trace for future crystallization into a procedural shard. Call this after completing a task to help the system learn.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          input: {
            type: 'string',
            description: 'The original user input/request',
          },
          reasoning: {
            type: 'string',
            description: 'Your reasoning process (optional)',
          },
          output: {
            type: 'string',
            description: 'The final output/response',
          },
          tokensUsed: {
            type: 'number',
            description: 'Approximate tokens used for this interaction',
          },
        },
        required: ['input', 'output'],
      },
    },
    {
      name: 'recall_episodes',
      description: 'Search episodic memory for similar past experiences. Returns Situation-Action-Outcome chains with lessons learned.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Description of the current situation to find similar episodes',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of results (default: 5)',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'query_knowledge',
      description: 'Query the semantic knowledge store for facts. Returns confidence-weighted knowledge with sources.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          subject: {
            type: 'string',
            description: 'The subject to query about (optional)',
          },
          query: {
            type: 'string',
            description: 'Semantic search query for facts (optional)',
          },
          minConfidence: {
            type: 'number',
            description: 'Minimum confidence threshold (0-1, default: 0.5)',
          },
        },
      },
    },
    {
      name: 'store_fact',
      description: 'Store a learned fact in semantic memory. Use this to persist important knowledge.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          subject: {
            type: 'string',
            description: 'The subject of the fact',
          },
          predicate: {
            type: 'string',
            description: 'The relationship/predicate',
          },
          object: {
            type: 'string',
            description: 'The object of the fact',
          },
          confidence: {
            type: 'number',
            description: 'Confidence level (0-1, default: 0.7)',
          },
          source: {
            type: 'string',
            description: 'Source of this knowledge',
          },
        },
        required: ['subject', 'predicate', 'object'],
      },
    },
    {
      name: 'get_stats',
      description: 'Get SUBSTRATE system statistics including shard counts, execution metrics, and token savings.',
      inputSchema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'record_episode',
      description: 'Record an episode (Situation-Action-Outcome chain) in episodic memory.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          situation: {
            type: 'string',
            description: 'Description of the situation/context',
          },
          action: {
            type: 'string',
            description: 'Description of the action taken',
          },
          outcome: {
            type: 'string',
            description: 'Description of the outcome/result',
          },
          type: {
            type: 'string',
            description: 'Category of episode',
          },
          success: {
            type: 'boolean',
            description: 'Whether the outcome was successful',
          },
          lessons: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lessons learned',
          },
          importance: {
            type: 'number',
            description: 'Importance score from 0 to 1',
          },
        },
        required: ['situation', 'action', 'outcome', 'type', 'success'],
      },
    },
    {
      name: 'create_context',
      description: 'Create a working memory context to store temporary information.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          content: {
            type: 'string',
            description: 'The content to store',
          },
          contentType: {
            type: 'string',
            description: 'Type: decision, error, instruction, task, observation, conversation',
          },
          sessionId: {
            type: 'string',
            description: 'Session identifier',
          },
          ttlSeconds: {
            type: 'number',
            description: 'Time-to-live in seconds',
          },
        },
        required: ['content'],
      },
    },
    {
      name: 'liquidate_context',
      description: 'Process a working memory context to extract facts.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          contextId: {
            type: 'string',
            description: 'The context ID to liquidate',
          },
          promoteIfImportant: {
            type: 'boolean',
            description: 'Auto-promote if importance >= 0.7',
          },
        },
        required: ['contextId'],
      },
    },
    {
      name: 'get_session_context',
      description: 'Get compressed context summary for a session.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID',
          },
          currentInput: {
            type: 'string',
            description: 'Current input for relevance matching',
          },
          maxTokens: {
            type: 'number',
            description: 'Maximum tokens to return',
          },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'find_similar_contexts',
      description: 'Find similar working memory contexts.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          query: {
            type: 'string',
            description: 'Search query',
          },
          limit: {
            type: 'number',
            description: 'Max results',
          },
          sessionId: {
            type: 'string',
            description: 'Optional session filter',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_working_stats',
      description: 'Get working memory statistics.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID',
          },
        },
        required: ['sessionId'],
      },
    },
  ];

  // ===========================================
  // TOOL HANDLERS
  // ===========================================

  async function handleExecuteShard(args: {
    shardId?: string;
    query?: string;
    input: string;
  }): Promise<string> {
    if (!args.input || typeof args.input !== 'string') {
      return JSON.stringify({
        success: false,
        error: 'Input is required',
        code: 'MISSING_INPUT',
      });
    }

    const trimmedInput = args.input.trim();
    if (trimmedInput.length === 0) {
      return JSON.stringify({
        success: false,
        error: 'Input cannot be empty',
        code: 'EMPTY_INPUT',
      });
    }

    let shard;
    let matchMethod = 'none';

    if (args.shardId) {
      shard = await procedural.getShardById(args.shardId);
      matchMethod = 'direct';
    } else {
      const intent = await extractIntent(args.input, '');
      shard = await procedural.findShardByIntentTemplate(intent.template, true, 0.55, tenantContext);

      if (shard) {
        matchMethod = 'intent';
      } else if (args.query) {
        const matches = await procedural.findSimilarShards(args.query, 1, tenantContext);
        shard = matches[0];
        if (shard) matchMethod = 'semantic';
      } else {
        const matches = await procedural.findSimilarShards(args.input, 1, tenantContext);
        shard = matches[0];
        if (shard) matchMethod = 'semantic';
      }
    }

    if (!shard) {
      return JSON.stringify({
        success: false,
        error: 'No matching shard found.',
        suggestion: 'Use ingest_trace to record this interaction.',
      });
    }

    const result = await executeShard(shard.logic, args.input);
    const tokensSaved = shard.estimatedTokens || 100;
    await procedural.recordExecution(shard.id, result.success, result.executionMs, result.success ? tokensSaved : 0);

    if (result.success) {
      // Use per-shard token estimate for environmental impact
      const waterMlSaved = Math.round((tokensSaved / 1000) * 500);
      const powerWhSaved = parseFloat(((tokensSaved / 1000) * 10).toFixed(2));
      const carbonGSaved = parseFloat(((tokensSaved / 1000) * 5).toFixed(2));

      return JSON.stringify({
        success: true,
        shardId: shard.id,
        shardName: shard.name,
        matchMethod,
        result: result.output,
        executionMs: result.executionMs,
        tokensSaved,
        waterMlSaved,
        powerWhSaved,
        carbonGSaved,
      });
    } else {
      return JSON.stringify({
        success: false,
        shardId: shard.id,
        matchMethod,
        error: result.error ?? 'Execution failed',
      });
    }
  }

  async function handleSearchShards(args: {
    query: string;
    limit?: number;
  }): Promise<string> {
    const limit = args.limit ?? 5;
    const shards = await procedural.findSimilarShards(args.query, limit, tenantContext);

    return JSON.stringify({
      count: shards.length,
      shards: shards.map(s => ({
        id: s.id,
        name: s.name,
        confidence: s.confidence,
        patterns: s.patterns,
        lifecycle: s.lifecycle,
        executionCount: s.executionCount,
        successRate: s.executionCount > 0
          ? (s.successCount / s.executionCount * 100).toFixed(1) + '%'
          : 'N/A',
      })),
    });
  }

  async function handleIngestTrace(args: {
    input: string;
    reasoning?: string;
    output: string;
    tokensUsed?: number;
  }): Promise<string> {
    // Traces are unlimited - no caps, only per-minute throttling for abuse prevention
    const { ids, generatePatternHash } = await import('@substrate/core');
    const { hashIntentTemplate } = await import('@substrate/ai');

    const id = ids.trace();
    const intent = await extractIntent(args.input, args.output);
    const intentHash = hashIntentTemplate(intent.template);
    const patternHash = generatePatternHash(args.input, args.output);
    const embedding = await generateEmbedding(args.input + ' ' + args.output);

    await query(
      `INSERT INTO reasoning_traces (
        id, input, reasoning, output, pattern_hash, embedding,
        intent_template, intent_category, intent_name, intent_parameters,
        tokens_used, execution_ms, source, owner_id, visibility, timestamp
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13, $14, NOW())`,
      [
        id,
        args.input,
        args.reasoning ?? null,
        args.output,
        patternHash,
        `[${embedding.join(',')}]`,
        intent.template,
        intent.category,
        intent.intentName,
        JSON.stringify(intent.parameters),
        args.tokensUsed ?? 0,
        'mcp',
        tenantContext.tenantId,
        visibility,
      ]
    );

    return JSON.stringify({
      success: true,
      traceId: id,
      intentTemplate: intent.template,
      intentHash,
      patternHash,
      message: 'Trace recorded.',
    });
  }

  async function handleRecallEpisodes(args: {
    query: string;
    limit?: number;
  }): Promise<string> {
    const limit = args.limit ?? 5;
    const episodes = await episodic.findSimilarEpisodes(args.query, limit, tenantContext);

    return JSON.stringify({
      count: episodes.length,
      episodes: episodes.map(e => ({
        id: e.id,
        type: e.type,
        summary: e.summary,
        situation: e.situation,
        action: e.action,
        outcome: e.outcome,
        success: e.success,
        lessonsLearned: e.lessonsLearned,
        importance: e.importance,
      })),
    });
  }

  async function handleQueryKnowledge(args: {
    subject?: string;
    query?: string;
    minConfidence?: number;
  }): Promise<string> {
    const minConf = args.minConfidence ?? 0.5;

    let facts;
    if (args.query) {
      facts = await semantic.findSimilarFacts(args.query, 10, tenantContext);
      facts = facts.filter(f => f.confidence >= minConf);
    } else if (args.subject) {
      facts = await semantic.getFactsBySubject(args.subject, tenantContext);
      facts = facts.filter(f => f.confidence >= minConf);
    } else {
      // Get recent high-confidence facts (tenant-scoped)
      const visParams: unknown[] = [minConf];
      let visClause: string;
      if (!tenantContext || tenantContext.tenantId === 'tenant_system') {
        visClause = '1=1';
      } else {
        visParams.push(tenantContext.tenantId);
        visClause = `(visibility = 'public' OR owner_id IS NULL OR (visibility = 'private' AND owner_id = $2))`;
      }
      const rows = await query<Record<string, unknown>>(
        `SELECT * FROM knowledge_facts
         WHERE confidence >= $1 AND ${visClause}
         ORDER BY updated_at DESC
         LIMIT 20`,
        visParams
      );
      facts = rows.map(r => ({
        id: r['id'] as string,
        subject: r['subject'] as string,
        predicate: r['predicate'] as string,
        object: r['object'] as string,
        statement: r['statement'] as string,
        confidence: r['confidence'] as number,
        sources: r['sources'] as string[],
      }));
    }

    return JSON.stringify({
      count: facts.length,
      facts: facts.map(f => ({
        statement: f.statement ?? `${f.subject} ${f.predicate} ${f.object}`,
        confidence: f.confidence,
        sources: f.sources,
      })),
    });
  }

  async function handleStoreFact(args: {
    subject: string;
    predicate: string;
    object: string;
    confidence?: number;
    source?: string;
  }): Promise<string> {
    const fact = await semantic.storeFact({
      subject: args.subject,
      predicate: args.predicate,
      object: args.object,
      statement: `${args.subject} ${args.predicate} ${args.object}`,
      confidence: args.confidence ?? 0.7,
      sources: args.source ? [args.source] : ['mcp'],
      evidence: [],
      category: 'general',
      isTemporal: false,
    }, { tenant: tenantContext, visibility });

    return JSON.stringify({
      success: true,
      factId: fact.id,
      message: 'Fact stored.',
    });
  }

  async function handleRecordEpisode(args: {
    situation: string;
    action: string;
    outcome: string;
    type: string;
    success: boolean;
    lessons?: string[];
    importance?: number;
  }): Promise<string> {
    const summary = `${args.type}: ${args.situation.substring(0, 50)}... → ${args.outcome.substring(0, 50)}`;

    const episode = await episodic.recordEpisode({
      situation: { context: args.situation, entities: [], state: {} },
      action: { type: args.type, description: args.action, parameters: {} },
      outcome: { result: args.outcome, success: args.success, effects: [], metrics: {} },
      type: args.type,
      summary,
      success: args.success,
      valence: args.success ? 'positive' : 'negative',
      importance: args.importance ?? 0.5,
      lessonsLearned: args.lessons ?? [],
      timestamp: new Date(),
      metadata: {},
    }, { tenant: tenantContext, visibility });

    return JSON.stringify({
      success: true,
      episodeId: episode.id,
      summary,
      message: 'Episode recorded.',
    });
  }

  async function handleCreateContext(args: {
    content: string;
    contentType?: string;
    sessionId?: string;
    ttlSeconds?: number;
  }): Promise<string> {
    const { ids } = await import('@substrate/core');

    const sessionId = args.sessionId ?? ids.session();
    const contentType = args.contentType ?? 'observation';
    const ttlSeconds = args.ttlSeconds ?? 3600;
    const originalTokens = Math.ceil(args.content.length / 4);

    const context = await working.createContext({
      sessionId,
      rawContent: args.content,
      contentType,
      originalTokens,
      ttlSeconds,
      extractedFacts: [],
      extractedEntities: [],
      noiseRemoved: [],
    }, { tenant: tenantContext, visibility: 'private' });

    return JSON.stringify({
      success: true,
      contextId: context.id,
      sessionId,
      contentType,
      originalTokens,
      expiresAt: context.expiresAt,
      message: 'Context stored.',
    });
  }

  async function handleLiquidateContext(args: {
    contextId: string;
    promoteIfImportant?: boolean;
  }): Promise<string> {
    const promoteIfImportant = args.promoteIfImportant ?? true;
    const liquidated = await working.liquidateContext(args.contextId);

    let promoted = { promoted: 0, factIds: [] as string[] };
    const importance = (liquidated as Record<string, unknown>)['importance'] as number ?? 0;

    if (promoteIfImportant && importance >= 0.7) {
      promoted = await working.promoteToSemantic(args.contextId);
    }

    return JSON.stringify({
      success: true,
      contextId: args.contextId,
      status: promoted.promoted > 0 ? 'promoted' : 'liquidated',
      importance: importance.toFixed(2),
      extractedFacts: liquidated.extractedFacts?.length ?? 0,
      compressionRatio: liquidated.compressionRatio?.toFixed(2) ?? 'N/A',
      originalTokens: liquidated.originalTokens,
      liquidatedTokens: liquidated.liquidatedTokens,
      promotedFacts: promoted.promoted,
      factIds: promoted.factIds,
    });
  }

  async function handleGetSessionContext(args: {
    sessionId: string;
    currentInput?: string;
    maxTokens?: number;
  }): Promise<string> {
    const result = await working.getContextForContinuation(
      args.sessionId,
      args.currentInput ?? '',
      args.maxTokens ?? 2000
    );

    return JSON.stringify({
      success: true,
      sessionId: args.sessionId,
      contextCount: result.contexts.length,
      totalTokens: result.totalTokens,
      summary: result.summary,
      contexts: result.contexts.map(c => ({
        id: c.id,
        contentType: c.contentType,
        status: c.status,
      })),
    });
  }

  async function handleFindSimilarContexts(args: {
    query: string;
    limit?: number;
    sessionId?: string;
  }): Promise<string> {
    const contexts = await working.findSimilarContexts(
      args.query,
      args.limit ?? 5,
      args.sessionId,
      tenantContext
    );

    return JSON.stringify({
      count: contexts.length,
      contexts: contexts.map(c => ({
        id: c.id,
        sessionId: c.sessionId,
        contentType: c.contentType,
        status: c.status,
        rawContent: c.rawContent.substring(0, 200) + (c.rawContent.length > 200 ? '...' : ''),
      })),
    });
  }

  async function handleGetWorkingStats(args: {
    sessionId: string;
  }): Promise<string> {
    const stats = await working.getSessionStats(args.sessionId);

    return JSON.stringify({
      sessionId: args.sessionId,
      total: stats.total,
      raw: stats.raw,
      liquidated: stats.liquidated,
      promoted: stats.promoted,
      avgImportance: stats.avgImportance.toFixed(2),
      totalTokensSaved: stats.totalTokensSaved,
    });
  }

  async function handleGetStats(): Promise<string> {
    const shardStats = await queryOne<{
      total: string;
      promoted: string;
    }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE lifecycle = 'promoted') as promoted
       FROM procedural_shards`
    );

    const traceStats = await queryOne<{
      total: string;
      synthesized: string;
    }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE synthesized = true) as synthesized
       FROM reasoning_traces`
    );

    const execStats = await queryOne<{
      total: string;
      successful: string;
      tokens_saved: string;
    }>(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE success = true) as successful,
         COALESCE(SUM(tokens_saved), 0) as tokens_saved
       FROM shard_executions`
    );

    const episodeCount = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM episodes'
    );

    const factCount = await queryOne<{ count: string }>(
      'SELECT COUNT(*) as count FROM knowledge_facts'
    );

    return JSON.stringify({
      shards: {
        total: parseInt(shardStats?.total ?? '0'),
        promoted: parseInt(shardStats?.promoted ?? '0'),
      },
      traces: {
        total: parseInt(traceStats?.total ?? '0'),
        synthesized: parseInt(traceStats?.synthesized ?? '0'),
      },
      executions: {
        total: parseInt(execStats?.total ?? '0'),
        successful: parseInt(execStats?.successful ?? '0'),
        successRate: execStats && parseInt(execStats.total) > 0
          ? (parseInt(execStats.successful) / parseInt(execStats.total) * 100).toFixed(1) + '%'
          : 'N/A',
        tokensSaved: parseInt(execStats?.tokens_saved ?? '0'),
      },
      memory: {
        episodes: parseInt(episodeCount?.count ?? '0'),
        facts: parseInt(factCount?.count ?? '0'),
      },
    });
  }

  // ===========================================
  // MCP REQUEST HANDLERS
  // ===========================================

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    log(`Tool called: ${name} (tenant: ${tenantContext.tenantId})`);

    try {
      let result: string;

      switch (name) {
        case 'execute_shard':
          result = await handleExecuteShard(args as Parameters<typeof handleExecuteShard>[0]);
          break;
        case 'search_shards':
          result = await handleSearchShards(args as Parameters<typeof handleSearchShards>[0]);
          break;
        case 'ingest_trace':
          result = await handleIngestTrace(args as Parameters<typeof handleIngestTrace>[0]);
          break;
        case 'recall_episodes':
          result = await handleRecallEpisodes(args as Parameters<typeof handleRecallEpisodes>[0]);
          break;
        case 'query_knowledge':
          result = await handleQueryKnowledge(args as Parameters<typeof handleQueryKnowledge>[0]);
          break;
        case 'store_fact':
          result = await handleStoreFact(args as Parameters<typeof handleStoreFact>[0]);
          break;
        case 'get_stats':
          result = await handleGetStats();
          break;
        case 'record_episode':
          result = await handleRecordEpisode(args as Parameters<typeof handleRecordEpisode>[0]);
          break;
        case 'create_context':
          result = await handleCreateContext(args as Parameters<typeof handleCreateContext>[0]);
          break;
        case 'liquidate_context':
          result = await handleLiquidateContext(args as Parameters<typeof handleLiquidateContext>[0]);
          break;
        case 'get_session_context':
          result = await handleGetSessionContext(args as Parameters<typeof handleGetSessionContext>[0]);
          break;
        case 'find_similar_contexts':
          result = await handleFindSimilarContexts(args as Parameters<typeof handleFindSimilarContexts>[0]);
          break;
        case 'get_working_stats':
          result = await handleGetWorkingStats(args as Parameters<typeof handleGetWorkingStats>[0]);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [{ type: 'text', text: result }],
      };
    } catch (error) {
      log(`Tool execution failed: ${name} - ${error}`);
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
        }],
        isError: true,
      };
    }
  });

  // ===========================================
  // RESOURCES
  // ===========================================

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
      resources: [
        {
          uri: 'substrate://stats',
          name: 'System Statistics',
          description: 'Current SUBSTRATE system statistics',
          mimeType: 'application/json',
        },
        {
          uri: 'substrate://shards/promoted',
          name: 'Promoted Shards',
          description: 'List of all promoted shards',
          mimeType: 'application/json',
        },
      ],
    };
  });

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;

    if (uri === 'substrate://stats') {
      const stats = await handleGetStats();
      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: stats,
        }],
      };
    }

    if (uri === 'substrate://shards/promoted') {
      const shards = await query<Record<string, unknown>>(
        `SELECT id, name, patterns, confidence, execution_count, success_count
         FROM procedural_shards
         WHERE lifecycle = 'promoted'
         ORDER BY confidence DESC`
      );

      return {
        contents: [{
          uri,
          mimeType: 'application/json',
          text: JSON.stringify({
            count: shards.length,
            shards: shards.map(s => ({
              id: s['id'],
              name: s['name'],
              patterns: s['patterns'],
              confidence: s['confidence'],
              executionCount: s['execution_count'],
              successCount: s['success_count'],
            })),
          }),
        }],
      };
    }

    throw new Error(`Unknown resource: ${uri}`);
  });

  return server;
}

// ===========================================
// START SERVER
// ===========================================

app.listen(PORT, '0.0.0.0', () => {
  log(`SUBSTRATE MCP HTTP/SSE server listening on port ${PORT}`);
  log('Endpoints:');
  log(`  GET  /health  - Health check`);
  log(`  GET  /sse     - SSE endpoint (requires Authorization header)`);
  log(`  POST /message - Message endpoint (requires Authorization header)`);
});
