#!/usr/bin/env node

/**
 * Unified MCP Tools Server
 *
 * Consolidation of mcp-workflow, mcp-data, and mcp-infra into a single server.
 * Exposes 12 tools via MCP protocol on port 3010:
 *
 * Workflow: ticket_ops, finding_ops, intervention_ops, agent_call
 * Data:     db_query, substrate_db_query, memory_search, memory_store
 * Infra:    docker_api, deploy_ops, security_scan, code_analysis
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
import { closeAll } from '@substrate/db';

import { TOOLS as WORKFLOW_TOOLS, handleTool as handleWorkflowTool } from './workflow.js';
import { TOOLS as DATA_TOOLS, handleTool as handleDataTool } from './data.js';
import { TOOLS as INFRA_TOOLS, handleTool as handleInfraTool } from './infra.js';
import { TOOLS as AGENT_TOOLS, handleTool as handleAgentTool } from './agent-tools.js';
import { TOOLS as ALF_TOOLS, handleTool as handleAlfTool } from './alf-tools.js';

const PORT = parseInt(process.env['PORT'] ?? '3010', 10);
const log = (msg: string) => console.log(`[mcp-tools] ${new Date().toISOString()} ${msg}`);

// ============================================
// All Tools
// ============================================

const ALL_TOOLS = [...WORKFLOW_TOOLS, ...DATA_TOOLS, ...INFRA_TOOLS, ...AGENT_TOOLS, ...ALF_TOOLS];

const WORKFLOW_TOOL_NAMES = new Set(WORKFLOW_TOOLS.map((t) => t.name));
const DATA_TOOL_NAMES = new Set(DATA_TOOLS.map((t) => t.name));
const INFRA_TOOL_NAMES = new Set(INFRA_TOOLS.map((t) => t.name));
const AGENT_TOOL_NAMES = new Set(AGENT_TOOLS.map((t) => t.name));
const ALF_TOOL_NAMES = new Set(ALF_TOOLS.map((t) => t.name));

async function dispatchTool(name: string, args: Record<string, unknown>): Promise<string> {
  if (WORKFLOW_TOOL_NAMES.has(name)) return handleWorkflowTool(name, args);
  if (DATA_TOOL_NAMES.has(name)) return handleDataTool(name, args);
  if (INFRA_TOOL_NAMES.has(name)) return handleInfraTool(name, args);
  if (AGENT_TOOL_NAMES.has(name)) return handleAgentTool(name, args);
  if (ALF_TOOL_NAMES.has(name)) return handleAlfTool(name, args);
  throw new Error(`Unknown tool: ${name}`);
}

// ============================================
// Express + MCP setup
// ============================================

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', service: 'mcp-tools', tools: ALL_TOOLS.length });
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
