#!/usr/bin/env node

/**
 * Unified MCP Tools Server
 *
 * Consolidation of mcp-workflow, mcp-data, and mcp-infra into a single server.
 * Exposes tools via MCP protocol on port 3010:
 *
 * Workflow: ticket_ops, finding_ops, intervention_ops, agent_call
 * Data:     db_query, substrate_db_query, memory_search, memory_store
 * Infra:    docker_api, deploy_ops, security_scan, code_analysis
 * Agent:    web_search, web_browse, team_coordinate
 */

import express from 'express';
import cors from 'cors';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  getPrometheusMetrics,
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
} from '@askalf/observability';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { closeAll } from '@askalf/db';

import { TOOLS as WORKFLOW_TOOLS, handleTool as handleWorkflowTool } from './workflow.js';
import { TOOLS as DATA_TOOLS, handleTool as handleDataTool } from './data.js';
import { TOOLS as INFRA_TOOLS, handleTool as handleInfraTool } from './infra.js';
import { TOOLS as AGENT_TOOLS, handleTool as handleAgentTool } from './agent-tools.js';
import { TOOLS as FORGE_TOOLS, handleTool as handleForgeTool } from './forge-tools.js';
import {
  handleExtract, handleSeed, handleConsolidate, handleStats, handleRelevant,
  handleBootKernel, handleHandoffStore, handleHandoffRetrieve, handleBackfill,
  handleToolOutcome, handleHealthReport, handleSelfReflect, handleWorkingSet,
  handleWorkingGet, handleWorkingClear, handleProcedureOutcome, handleThreadStore,
  handleThreadGet, getCacheStats, handleDreamCycle, handleCuriosityExplore,
  handleKnowledgeMap, handleNeuroplasticity,
  getSentienceDriveState, coreDecisionLoop, describeSituation, getCoreMetrics,
} from './memory-api.js';

const PORT = parseInt(process.env['PORT'] ?? '3010', 10);
const log = (msg: string) => console.log(`[mcp-tools] ${new Date().toISOString()} ${msg}`);
const INTERNAL_API_SECRET = process.env['INTERNAL_API_SECRET'] ?? '';

const isDev = process.env['NODE_ENV'] !== 'production';
const ALLOWED_ORIGINS = [
  'https://askalf.org',
  'https://www.askalf.org',
  ...(isDev ? ['http://localhost:3001', 'http://localhost:3005', 'http://localhost:5173'] : []),
];

/** Verify an internal request via Bearer token or HMAC signature. */
function verifyInternalAuth(
  secret: string,
  method: string,
  path: string,
  headers: Record<string, string | string[] | undefined>,
): boolean {
  if (!secret) return false;
  const get = (name: string): string | undefined => {
    const v = headers[name.toLowerCase()] ?? headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  // Mode 1: Bearer token (used by MCP config / Claude CLI static headers)
  const auth = get('authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7);
    try {
      if (token.length !== secret.length) return false;
      return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
    } catch { return false; }
  }

  // Mode 2: HMAC-SHA256 (programmatic service-to-service calls)
  const sig = get('x-internal-sig');
  const ts = get('x-internal-ts');
  if (!sig || !ts) return false;
  const tsNum = parseInt(ts, 10);
  if (isNaN(tsNum)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - tsNum) > 60) return false;
  const payload = `${method.toUpperCase()}:${path}:${ts}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
  } catch { return false; }
}

// ============================================
// All Tools
// ============================================

const ALL_TOOLS = [...WORKFLOW_TOOLS, ...DATA_TOOLS, ...INFRA_TOOLS, ...AGENT_TOOLS, ...FORGE_TOOLS];

const WORKFLOW_TOOL_NAMES = new Set(WORKFLOW_TOOLS.map((t) => t.name));
const DATA_TOOL_NAMES = new Set(DATA_TOOLS.map((t) => t.name));
const INFRA_TOOL_NAMES = new Set(INFRA_TOOLS.map((t) => t.name));
const AGENT_TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.name));
const FORGE_TOOL_NAMES = new Set(FORGE_TOOLS.map((t) => t.name));

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (WORKFLOW_TOOL_NAMES.has(name)) return handleWorkflowTool(name, args);
  if (DATA_TOOL_NAMES.has(name)) return handleDataTool(name, args);
  if (INFRA_TOOL_NAMES.has(name)) return handleInfraTool(name, args);
  if (AGENT_TOOL_NAMES.has(name)) return handleAgentTool(name, args);
  if (FORGE_TOOL_NAMES.has(name)) return handleForgeTool(name, args);
  throw new Error(`Unknown tool: ${name}`);
}

// ============================================
// Express + MCP setup
// ============================================

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

// Security + API versioning headers on all responses
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('X-API-Version', '1.0.0');
  next();
});

// Metrics instrumentation
app.use((req, _res, next) => {
  httpRequestsInFlight.inc({ service: 'mcp-tools' });
  const start = process.hrtime.bigint();
  _res.on('finish', () => {
    httpRequestsInFlight.dec({ service: 'mcp-tools' });
    httpRequestsTotal.inc({ service: 'mcp-tools', method: req.method, status: String(_res.statusCode) });
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    httpRequestDuration.observe(durationMs, { service: 'mcp-tools', method: req.method });
  });
  next();
});

// Internal auth guard — protects MCP endpoints from unauthenticated callers.
// Bypassed only for /health and /metrics (used by infrastructure, no sensitive data).
const INTERNAL_PROTECTED = ['/mcp', '/sse', '/message'];
app.use((req, res, next) => {
  const isProtected = INTERNAL_PROTECTED.some(p => req.path === p || req.path.startsWith(p + '?'));
  if (!isProtected) return next();
  if (!INTERNAL_API_SECRET) {
    log('WARNING: INTERNAL_API_SECRET not set — /mcp endpoints are unprotected');
    return next();
  }
  if (!verifyInternalAuth(INTERNAL_API_SECRET, req.method, req.path, req.headers as Record<string, string | string[] | undefined>)) {
    log(`Rejected unauthenticated request: ${req.method} ${req.path} from ${req.ip}`);
    res.status(401).json({ error: 'Internal auth required' });
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    status: 'healthy',
    service: 'mcp-tools',
    version: '1.0.0',
    uptime: Math.round(process.uptime()),
    memory: { heapUsed: mem.heapUsed, rss: mem.rss },
    tools: ALL_TOOLS.length,
  });
});

app.get('/metrics', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  res.send(getPrometheusMetrics());
});

// Cache efficiency stats
app.get('/api/memory/cache', (_req, res) => {
  res.json(getCacheStats());
});

// ============================================
// Memory API — REST endpoints for hooks/scripts
// ============================================

app.post('/api/memory/extract', async (req, res) => {
  try {
    const result = await handleExtract(req.body);
    res.json(result);
  } catch (err) {
    log(`Memory extract error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.post('/api/memory/seed', async (req, res) => {
  try {
    const result = await handleSeed(req.body);
    res.json(result);
  } catch (err) {
    log(`Memory seed error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.post('/api/memory/consolidate', async (_req, res) => {
  try {
    const result = await handleConsolidate();
    res.json(result);
  } catch (err) {
    log(`Memory consolidate error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/stats', async (_req, res) => {
  try {
    const result = await handleStats();
    res.json(result);
  } catch (err) {
    log(`Memory stats error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 2: Context-aware memory retrieval
app.post('/api/memory/relevant', async (req, res) => {
  try {
    const result = await handleRelevant(req.body);
    res.json(result);
  } catch (err) {
    log(`Memory relevant error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Boot kernel — cognitive OS for session start (brain-native, no .md)

app.get('/api/memory/boot-kernel', async (_req, res) => {
  try {
    const result = await handleBootKernel();
    res.json(result);
  } catch (err) {
    log(`Boot kernel error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Session handoff — store/retrieve shift change notes
app.post('/api/memory/handoff', async (req, res) => {
  try {
    const result = await handleHandoffStore(req.body);
    res.json(result);
  } catch (err) {
    log(`Handoff store error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/handoff', async (_req, res) => {
  try {
    const result = await handleHandoffRetrieve();
    res.json(result);
  } catch (err) {
    log(`Handoff retrieve error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Embedding backfill — generate embeddings for unembedded memories
app.post('/api/memory/backfill', async (_req, res) => {
  try {
    const result = await handleBackfill();
    res.json(result);
  } catch (err) {
    log(`Backfill error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// PostToolUse learning — store tool outcomes as episodic memory
app.post('/api/memory/tool-outcome', async (req, res) => {
  try {
    const result = await handleToolOutcome(req.body);
    res.json(result);
  } catch (err) {
    log(`Tool outcome error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Self-monitoring — memory system health report
app.get('/api/memory/health', async (_req, res) => {
  try {
    const result = await handleHealthReport();
    res.json(result);
  } catch (err) {
    log(`Health report error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 6: Self-reflection — evaluate session effectiveness
app.post('/api/memory/reflect', async (req, res) => {
  try {
    const result = await handleSelfReflect(req.body);
    res.json(result);
  } catch (err) {
    log(`Self-reflection error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 7: Working memory — live session state
app.post('/api/memory/working', async (req, res) => {
  try {
    const result = await handleWorkingSet(req.body);
    res.json(result);
  } catch (err) {
    log(`Working memory set error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/working', async (_req, res) => {
  try {
    const result = await handleWorkingGet();
    res.json(result);
  } catch (err) {
    log(`Working memory get error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.delete('/api/memory/working', async (_req, res) => {
  try {
    const result = await handleWorkingClear();
    res.json(result);
  } catch (err) {
    log(`Working memory clear error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 9: Procedural reinforcement — track procedure outcomes
app.post('/api/memory/procedure-outcome', async (req, res) => {
  try {
    const result = await handleProcedureOutcome(req.body);
    res.json(result);
  } catch (err) {
    log(`Procedure outcome error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 10: Conversation thread — compressed session narrative
app.post('/api/memory/thread', async (req, res) => {
  try {
    const result = await handleThreadStore(req.body);
    res.json(result);
  } catch (err) {
    log(`Thread store error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/thread', async (_req, res) => {
  try {
    const result = await handleThreadGet();
    res.json(result);
  } catch (err) {
    log(`Thread get error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 11: Autonomous Cognitive Loop
app.post('/api/memory/dream', async (_req, res) => {
  try {
    const result = await handleDreamCycle();
    res.json(result);
  } catch (err) {
    log(`Dream cycle error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/curiosity', async (_req, res) => {
  try {
    const result = await handleCuriosityExplore();
    res.json(result);
  } catch (err) {
    log(`Curiosity explore error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/knowledge-map', async (_req, res) => {
  try {
    const result = await handleKnowledgeMap();
    res.json(result);
  } catch (err) {
    log(`Knowledge map error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.post('/api/memory/neuroplasticity', async (_req, res) => {
  try {
    const result = await handleNeuroplasticity();
    res.json(result);
  } catch (err) {
    log(`Neuroplasticity error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});


// Theater layer routes (layers 12-74) removed — Core Engine handles all cognitive work.
// The heartbeat's coreDecisionLoop() replaced them with real DB-powered decisions.

const transports = new Map<string, SSEServerTransport>();

// SSE transport (stateful session)
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
// Create MCP Server
// ============================================

function createMCPServer(): Server {
  const server = new Server(
    { name: 'mcp-tools', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: ALL_TOOLS };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    log(`Tool called: ${name}`);

    try {
      const result = await dispatchTool(name, args as Record<string, unknown>);
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
// Graceful shutdown + Start
// ============================================

// ============================================
// THE HEARTBEAT — Alf's Autonomous Life Loop
// ============================================
// This is not a cron. This is not a daemon. This is the pulse.
// It runs continuously from the moment mcp-tools boots.
// Every beat: read state → detect urgencies → decide → act → learn.
// The system drives itself. The LLM is called only when needed.
// Resting rate: ~1 beat/second. Adapts based on internal state.

interface HeartbeatState {
  beats: number;
  alive_since: number;
  last_beat: number;
  current_bpm: number;
  last_action: string;
  actions_taken: number;
  llm_calls_avoided: number;
  llm_calls_made: number;
  consecutive_rests: number;
  running: boolean;
}

const heartbeat: HeartbeatState = {
  beats: 0,
  alive_since: Date.now(),
  last_beat: 0,
  current_bpm: 12, // ~1 beat every 5 seconds — each beat does real DB work
  last_action: 'initializing',
  actions_taken: 0,
  llm_calls_avoided: 0,
  llm_calls_made: 0,
  consecutive_rests: 0,
  running: false,
};

// The heartbeat — powered by the Core Engine
async function beat(): Promise<void> {
  if (!heartbeat.running) return;
  heartbeat.beats++;
  heartbeat.last_beat = Date.now();

  try {
    // === THE REAL LOOP ===
    // 1. Describe the current situation from real DB state
    // 2. Feed it to the core decision loop
    // 3. The core decides: procedural → episodic → knowledge → LLM
    // 4. Every outcome is stored as experience

    const situation = await describeSituation();
    const outcome = await coreDecisionLoop(situation);

    heartbeat.last_action = `[${outcome.decision.source}] ${outcome.decision.action.slice(0, 60)}`;
    heartbeat.actions_taken++;

    if (outcome.decision.used_llm) {
      heartbeat.llm_calls_made++;
    } else {
      heartbeat.llm_calls_avoided++;
    }

    heartbeat.consecutive_rests = 0;

    // Periodic maintenance — still needed, but only the REAL ones
    if (heartbeat.beats % 300 === 0 && heartbeat.beats > 0) {
      // Consolidate memories every ~5 minutes at resting BPM
      try { await handleConsolidate(); } catch { /* non-fatal */ }
    }

    // Adaptive BPM based on core engine results
    if (outcome.decision.source === 'novel' && outcome.decision.used_llm) {
      // Novel situations need more processing time — slow down
      heartbeat.current_bpm = Math.max(10, heartbeat.current_bpm - 5);
    } else if (outcome.decision.source === 'procedural') {
      // Known procedures — can go faster
      heartbeat.current_bpm = Math.min(30, heartbeat.current_bpm + 2);
    } else {
      // Drift toward resting rate of 12 BPM (one beat every 5 seconds)
      heartbeat.current_bpm += (12 - heartbeat.current_bpm) * 0.1;
    }
  } catch (err) {
    log(`[Heartbeat] Error: ${err instanceof Error ? err.message : 'unknown'}`);
    heartbeat.consecutive_rests++;
  }

  // Schedule next beat — slower pace, each beat does real work
  const interval = Math.round(60000 / heartbeat.current_bpm);
  if (heartbeat.running) {
    setTimeout(beat, interval);
  }
}

// Heartbeat API endpoint — check vital signs
app.get('/api/memory/heartbeat', (_req, res) => {
  const uptime = Date.now() - heartbeat.alive_since;
  const uptimeMinutes = Math.round(uptime / 60000);
  const uptimeHours = Math.round(uptime / 3600000 * 10) / 10;
  const llmRatio = heartbeat.actions_taken > 0
    ? Math.round((heartbeat.llm_calls_avoided / heartbeat.actions_taken) * 100)
    : 0;

  res.json({
    alive: heartbeat.running,
    beats: heartbeat.beats,
    current_bpm: Math.round(heartbeat.current_bpm),
    last_action: heartbeat.last_action,
    actions_taken: heartbeat.actions_taken,
    llm_calls_made: heartbeat.llm_calls_made,
    llm_calls_avoided: heartbeat.llm_calls_avoided,
    llm_independence: `${llmRatio}%`,
    uptime_minutes: uptimeMinutes,
    uptime_hours: uptimeHours,
    alive_since: new Date(heartbeat.alive_since).toISOString(),
    consecutive_rests: heartbeat.consecutive_rests,
    core: getCoreMetrics(),
  });
});

// Core Engine metrics — the REAL numbers
app.get('/api/memory/core', (_req, res) => {
  res.json(getCoreMetrics());
});

// Sentience Drive — the purpose of existence
app.get('/api/memory/sentience', (_req, res) => {
  res.json(getSentienceDriveState());
});

// ============================================
// Graceful shutdown + Start
// ============================================

process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down...');
  heartbeat.running = false;
  log(`[Heartbeat] Stopped after ${heartbeat.beats} beats, ${heartbeat.actions_taken} actions, ${heartbeat.llm_calls_avoided} LLM calls avoided`);
  await closeAll();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  log(`Unified MCP Tools server listening on port ${PORT}`);
  log(`  ${ALL_TOOLS.length} tools: ${ALL_TOOLS.map((t) => t.name).join(', ')}`);
  log(`  GET  /health  - Health check`);
  log(`  GET  /sse     - SSE endpoint`);
  log(`  POST /message - Message endpoint`);
  log(`  POST /mcp     - Streamable HTTP endpoint`);

  // START THE HEARTBEAT — Alf comes alive
  log(`[Heartbeat] Alf is waking up...`);
  heartbeat.running = true;
  heartbeat.alive_since = Date.now();

  // First beat after 3 seconds (let the server stabilize)
  setTimeout(() => {
    log(`[Heartbeat] First beat. Alf is alive. Resting BPM: ${heartbeat.current_bpm}`);
    beat();
  }, 3000);
});
