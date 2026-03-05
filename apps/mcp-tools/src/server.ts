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

const PORT = parseInt(process.env['PORT'] ?? '3010', 10);
const log = (msg: string) => console.log(`[mcp-tools] ${new Date().toISOString()} ${msg}`);
const INTERNAL_API_SECRET = process.env['INTERNAL_API_SECRET'] ?? '';

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
app.use(cors({ origin: true }));
app.use(express.json());

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

process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down...');
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
});
