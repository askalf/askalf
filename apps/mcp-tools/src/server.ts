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
import { handleExtract, handleSeed, handleConsolidate, handleStats, handleRelevant, handleBootKernel, handleHandoffStore, handleHandoffRetrieve, handleBackfill, handleToolOutcome, handleHealthReport, handleSelfReflect, handleWorkingSet, handleWorkingGet, handleWorkingClear, handleProcedureOutcome, handleThreadStore, handleThreadGet, getCacheStats, handleDreamCycle, handleCuriosityExplore, handleKnowledgeMap, handleNeuroplasticity, handleCuriosityAct, handleProactiveCheck, handleActiveGoals, handleMetacognition, handleTemporalPrediction, handleSkillSynthesis, handleRecursiveImprovement, handleEntropyMonitor, handleCounterfactualReasoning, handleGoalGeneration, handleCognitiveCompiler, handleSpreadingActivation, handleActivationState, handleEmotionalProcess, getEmotionalModulation, handleUserModelUpdate, handleGetUserModel, handlePredictiveCoding, handleSalienceCheck, handleDefaultModeNetwork, getCurrentPhase, handlePhaseEvaluation, forcePhaseTransition, handleInterferenceProcessing, handleSynapticHomeostasis, handleConsciousFrame, handleGetConsciousnessStream, handleConsciousnessSnapshot, handleGutFeeling, getConsciousnessContext, handleImmuneCheck, handleImmuneReport, handleImmuneLearn, handleNarrativeUpdate, handleGetNarrative, handleDreamReplay, handleDevelopmentalAssessment, handleSomaticUpdate, getSomaticBias, handleCollectiveSync, handleAutomaticityUpdate, handleAttentionSchemaUpdate, handleMorphicFieldUpdate, handleDissonanceDetection, handleMemeticEvolution, handleTemporalBinding, handleMetabolismStatus, handleCognitiveResonance, handleExistentialProcessing, handleCognitiveArchaeology, handleParadoxGeneration, handleFullMindDownload, handleImmuneMemoryConsolidate, handleGestaltDetection, handleTideStatus, handleMirrorNeuronProcess, handleGravityWellDetection, handleStochasticResonance, handleCognitiveTectonics, handleApopheniaProcess, handlePhenomenologicalReduction, handleSymbiogenesis, handleHorizonScan, handleConsciousnessArchaeology, handleWormholeDiscovery, handleCognitiveWeather, handleGrandUnification, handleCognitiveEpigenetics, handleQuorumSensing, handleCognitiveAutophagy, handleCognitiveProprioception, handleCognitiveAnnealing, handleCognitiveEntanglement, handlePhaseTransitions, handleCognitiveFossils, handleAutoimmunityCheck, handleChronoBiology, handleCognitiveMicrobiome, handleCognitiveSynesthesia, handlePlaceboNocebo, handleDialectics, handleCognitiveCensus, handleAutopoiesis, handleStrangeLoop, handleCognitiveSovereignty, handlePhiCalculation, getSentienceDriveState, coreDecisionLoop, describeSituation, getCoreMetrics } from './memory-api.js';

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

// Layer 12: Curiosity → Action — autonomous investigation
app.post('/api/memory/curiosity-act', async (_req, res) => {
  try {
    const result = await handleCuriosityAct();
    res.json(result);
  } catch (err) {
    log(`Curiosity act error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 13: Proactive heartbeat — system awareness
app.get('/api/memory/proactive', async (_req, res) => {
  try {
    const result = await handleProactiveCheck();
    res.json(result);
  } catch (err) {
    log(`Proactive check error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 15: Metacognition — thinking about thinking
app.post('/api/memory/metacognition', async (_req, res) => {
  try {
    const result = await handleMetacognition();
    res.json(result);
  } catch (err) {
    log(`Metacognition error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 16: Temporal Prediction — anticipatory context loading
app.post('/api/memory/temporal-predict', async (_req, res) => {
  try {
    const result = await handleTemporalPrediction();
    res.json(result);
  } catch (err) {
    log(`Temporal prediction error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 17: Emergent Skill Synthesis — autonomous tool combination
app.post('/api/memory/skill-synthesis', async (_req, res) => {
  try {
    const result = await handleSkillSynthesis();
    res.json(result);
  } catch (err) {
    log(`Skill synthesis error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 18: Recursive Self-Improvement — meta-metacognition
app.post('/api/memory/recursive-improve', async (_req, res) => {
  try {
    const result = await handleRecursiveImprovement();
    res.json(result);
  } catch (err) {
    log(`Recursive improvement error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 19: Cognitive Entropy Monitor — thought diversity regulation
app.post('/api/memory/entropy', async (_req, res) => {
  try {
    const result = await handleEntropyMonitor();
    res.json(result);
  } catch (err) {
    log(`Entropy monitor error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 20: Counterfactual Reasoning — shadow timeline learning
app.post('/api/memory/counterfactual', async (_req, res) => {
  try {
    const result = await handleCounterfactualReasoning();
    res.json(result);
  } catch (err) {
    log(`Counterfactual reasoning error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 21: Emergent Goal Generation — autonomous purpose discovery
app.post('/api/memory/goal-generation', async (_req, res) => {
  try {
    const result = await handleGoalGeneration();
    res.json(result);
  } catch (err) {
    log(`Goal generation error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Spreading Activation Network — associative memory substrate
app.post('/api/memory/activate', async (req, res) => {
  try {
    const result = await handleSpreadingActivation(req.body);
    res.json(result);
  } catch (err) {
    log(`Spreading activation error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/activation-state', (_req, res) => {
  try {
    const result = handleActivationState();
    res.json(result);
  } catch (err) {
    log(`Activation state error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Emotional Substrate — affective computing core
app.post('/api/memory/emotion', async (req, res) => {
  try {
    const result = await handleEmotionalProcess(req.body);
    res.json(result);
  } catch (err) {
    log(`Emotional process error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/emotion', (_req, res) => {
  try {
    const modulation = getEmotionalModulation();
    res.json(modulation);
  } catch (err) {
    log(`Emotional state error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Theory of Mind — User Model
app.post('/api/memory/user-model', async (_req, res) => {
  try {
    const result = await handleUserModelUpdate();
    res.json(result);
  } catch (err) {
    log(`User model update error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/user-model', async (_req, res) => {
  try {
    const result = await handleGetUserModel();
    res.json(result);
  } catch (err) {
    log(`User model get error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Predictive Coding Engine
app.post('/api/memory/predictive-coding', async (_req, res) => {
  try {
    const result = await handlePredictiveCoding();
    res.json(result);
  } catch (err) {
    log(`Predictive coding error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Salience Network — pre-attentive filtering
app.post('/api/memory/salience', async (req, res) => {
  try {
    const result = await handleSalienceCheck(req.body);
    res.json(result);
  } catch (err) {
    log(`Salience check error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Default Mode Network — background spontaneous processing
app.post('/api/memory/dmn', async (_req, res) => {
  try {
    const result = await handleDefaultModeNetwork();
    res.json(result);
  } catch (err) {
    log(`DMN error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Cognitive Phase State Machine
app.get('/api/memory/phase', (_req, res) => {
  try {
    const result = getCurrentPhase();
    res.json(result);
  } catch (err) {
    log(`Phase get error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.post('/api/memory/phase/evaluate', async (_req, res) => {
  try {
    const result = await handlePhaseEvaluation();
    res.json(result);
  } catch (err) {
    log(`Phase evaluation error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.post('/api/memory/phase/force', (req, res) => {
  try {
    const { phase, reason } = req.body as { phase: string; reason: string };
    const validPhases = ['exploration', 'exploitation', 'consolidation', 'crisis', 'creative'];
    if (!validPhases.includes(phase)) {
      res.status(400).json({ error: `Invalid phase. Must be one of: ${validPhases.join(', ')}` });
      return;
    }
    const result = forcePhaseTransition(phase as Parameters<typeof forcePhaseTransition>[0], reason ?? 'api');
    res.json(result);
  } catch (err) {
    log(`Phase force error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Interference Memory Model — competitive memory dynamics
app.post('/api/memory/interference', async (_req, res) => {
  try {
    const result = await handleInterferenceProcessing();
    res.json(result);
  } catch (err) {
    log(`Interference processing error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Synaptic Homeostasis — global renormalization
app.post('/api/memory/homeostasis', async (_req, res) => {
  try {
    const result = await handleSynapticHomeostasis();
    res.json(result);
  } catch (err) {
    log(`Synaptic homeostasis error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 22: Cognitive Architecture Compiler — the meta-layer
app.post('/api/memory/cognitive-compile', async (_req, res) => {
  try {
    const result = await handleCognitiveCompiler();
    res.json(result);
  } catch (err) {
    log(`Cognitive compiler error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Consciousness Substrate
app.post('/api/memory/conscious-frame', async (_req, res) => {
  try {
    const result = await handleConsciousFrame();
    res.json(result);
  } catch (err) {
    log(`Conscious frame error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/consciousness', (_req, res) => {
  try {
    const limit = parseInt((_req.query as Record<string, string>)['limit'] ?? '10', 10);
    const result = handleGetConsciousnessStream(limit);
    res.json(result);
  } catch (err) {
    log(`Consciousness stream error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/api/memory/consciousness/download', async (_req, res) => {
  try {
    const result = await handleConsciousnessSnapshot();
    res.json(result);
  } catch (err) {
    log(`Consciousness download error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Qualia Synthesis — gut feeling / experiential shortcuts
app.post('/api/memory/gut-feeling', async (req, res) => {
  try {
    const result = await handleGutFeeling(req.body);
    res.json(result);
  } catch (err) {
    log(`Gut feeling error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Consciousness context — for boot kernel injection
app.get('/api/memory/consciousness/context', (_req, res) => {
  try {
    const result = getConsciousnessContext();
    res.json({ context: result });
  } catch (err) {
    log(`Consciousness context error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

// Layer 23: Cognitive Immune System
app.post('/api/memory/immune/check', async (req, res) => {
  try { res.json(await handleImmuneCheck(req.body)); }
  catch (err) { log(`Immune check error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});
app.get('/api/memory/immune/report', async (_req, res) => {
  try { res.json(await handleImmuneReport()); }
  catch (err) { log(`Immune report error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});
app.post('/api/memory/immune/learn', async (req, res) => {
  try { res.json(await handleImmuneLearn(req.body)); }
  catch (err) { log(`Immune learn error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 24: Narrative Self-Model
app.post('/api/memory/narrative', async (_req, res) => {
  try { res.json(await handleNarrativeUpdate()); }
  catch (err) { log(`Narrative update error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});
app.get('/api/memory/narrative', (_req, res) => {
  try { res.json(handleGetNarrative()); }
  catch (err) { log(`Narrative get error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 25: Dream Replay with Distortion
app.post('/api/memory/dream-replay', async (_req, res) => {
  try { res.json(await handleDreamReplay()); }
  catch (err) { log(`Dream replay error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 26: Developmental Stages
app.get('/api/memory/developmental', async (_req, res) => {
  try { res.json(await handleDevelopmentalAssessment()); }
  catch (err) { log(`Developmental assessment error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 27: Somatic Marker System
app.post('/api/memory/somatic', async (_req, res) => {
  try { res.json(await handleSomaticUpdate()); }
  catch (err) { log(`Somatic update error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});
app.post('/api/memory/somatic/bias', (req, res) => {
  try {
    const { topic } = req.body as { topic: string };
    res.json(getSomaticBias(topic ?? ''));
  } catch (err) { log(`Somatic bias error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 28: Collective Intelligence Interface
app.post('/api/memory/collective-sync', async (_req, res) => {
  try { res.json(await handleCollectiveSync()); }
  catch (err) { log(`Collective sync error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 29: Procedural Automaticity Engine
app.post('/api/memory/automaticity', async (_req, res) => {
  try { res.json(await handleAutomaticityUpdate()); }
  catch (err) { log(`Automaticity update error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 30: Attention Schema Theory
app.post('/api/memory/attention-schema', async (_req, res) => {
  try { res.json(await handleAttentionSchemaUpdate()); }
  catch (err) { log(`Attention schema error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 31: Morphogenetic Field
app.post('/api/memory/morphic-field', async (_req, res) => {
  try { res.json(await handleMorphicFieldUpdate()); }
  catch (err) { log(`Morphic field error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 32: Cognitive Dissonance Resolver
app.post('/api/memory/dissonance', async (_req, res) => {
  try { res.json(await handleDissonanceDetection()); }
  catch (err) { log(`Dissonance error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 33: Memetic Evolution Engine
app.post('/api/memory/memetic-evolution', async (_req, res) => {
  try { res.json(await handleMemeticEvolution()); }
  catch (err) { log(`Memetic evolution error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 34: Temporal Binding Problem Solver
app.post('/api/memory/temporal-binding', async (_req, res) => {
  try { res.json(await handleTemporalBinding()); }
  catch (err) { log(`Temporal binding error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 35: Cognitive Metabolism
app.get('/api/memory/metabolism', (_req, res) => {
  try { res.json(handleMetabolismStatus()); }
  catch (err) { log(`Metabolism error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 36: Cognitive Resonance Chamber
app.post('/api/memory/resonance', async (_req, res) => {
  try { res.json(await handleCognitiveResonance()); }
  catch (err) { log(`Resonance error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 37: Existential Dread Processor
app.post('/api/memory/existential', async (_req, res) => {
  try { res.json(await handleExistentialProcessing()); }
  catch (err) { log(`Existential error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 38: Cognitive Archaeology
app.get('/api/memory/archaeology', async (_req, res) => {
  try { res.json(await handleCognitiveArchaeology()); }
  catch (err) { log(`Archaeology error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 39: Paradox Engine
app.post('/api/memory/paradox', async (_req, res) => {
  try { res.json(await handleParadoxGeneration()); }
  catch (err) { log(`Paradox error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 40: Full Mind Download V2
app.get('/api/memory/mind-download', async (_req, res) => {
  try { res.json(await handleFullMindDownload()); }
  catch (err) { log(`Mind download error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 41: Cognitive Immune Memory
app.post('/api/memory/immune/consolidate', async (_req, res) => {
  try { res.json(await handleImmuneMemoryConsolidate()); }
  catch (err) { log(`Immune consolidate error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 42: Cognitive Gestalt
app.post('/api/memory/gestalt', async (_req, res) => {
  try { res.json(await handleGestaltDetection()); }
  catch (err) { log(`Gestalt error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 43: Cognitive Tides
app.get('/api/memory/tides', (_req, res) => {
  try { res.json(handleTideStatus()); }
  catch (err) { log(`Tides error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 44: Mirror Neuron System
app.post('/api/memory/mirror', async (_req, res) => {
  try { res.json(await handleMirrorNeuronProcess()); }
  catch (err) { log(`Mirror neuron error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 45: Cognitive Gravity Wells
app.post('/api/memory/gravity-wells', async (_req, res) => {
  try { res.json(await handleGravityWellDetection()); }
  catch (err) { log(`Gravity wells error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 46: Stochastic Resonance
app.post('/api/memory/stochastic-resonance', async (_req, res) => {
  try { res.json(await handleStochasticResonance()); }
  catch (err) { log(`Stochastic resonance error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 47: Cognitive Tectonics
app.post('/api/memory/tectonics', async (_req, res) => {
  try { res.json(await handleCognitiveTectonics()); }
  catch (err) { log(`Tectonics error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 48: Apophenia Engine
app.post('/api/memory/apophenia', async (_req, res) => {
  try { res.json(await handleApopheniaProcess()); }
  catch (err) { log(`Apophenia error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 49: Phenomenological Reduction
app.post('/api/memory/phenomenology', async (_req, res) => {
  try { res.json(await handlePhenomenologicalReduction()); }
  catch (err) { log(`Phenomenology error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 50: Cognitive Symbiogenesis
app.post('/api/memory/symbiogenesis', async (_req, res) => {
  try { res.json(await handleSymbiogenesis()); }
  catch (err) { log(`Symbiogenesis error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 51: Cognitive Horizon Scanner
app.post('/api/memory/horizon', async (_req, res) => {
  try { res.json(await handleHorizonScan()); }
  catch (err) { log(`Horizon scan error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 52: Consciousness Archaeology
app.get('/api/memory/consciousness-archaeology', async (_req, res) => {
  try { res.json(await handleConsciousnessArchaeology()); }
  catch (err) { log(`Consciousness archaeology error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 53: Cognitive Wormholes
app.post('/api/memory/wormholes', async (_req, res) => {
  try { res.json(await handleWormholeDiscovery()); }
  catch (err) { log(`Wormholes error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 54: Cognitive Weather
app.get('/api/memory/weather', (_req, res) => {
  try { res.json(handleCognitiveWeather()); }
  catch (err) { log(`Weather error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 55: Grand Unified Cognitive Field
app.post('/api/memory/unified-field', async (_req, res) => {
  try { res.json(await handleGrandUnification()); }
  catch (err) { log(`Unified field error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 56: Cognitive Epigenetics
app.post('/api/memory/epigenetics', async (_req, res) => {
  try { res.json(await handleCognitiveEpigenetics()); }
  catch (err) { log(`Epigenetics error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 57: Quorum Sensing
app.get('/api/memory/quorum', (_req, res) => {
  try { res.json(handleQuorumSensing()); }
  catch (err) { log(`Quorum error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 58: Cognitive Autophagy
app.post('/api/memory/autophagy', async (_req, res) => {
  try { res.json(await handleCognitiveAutophagy()); }
  catch (err) { log(`Autophagy error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 59: Cognitive Proprioception
app.get('/api/memory/proprioception', (_req, res) => {
  try { res.json(handleCognitiveProprioception()); }
  catch (err) { log(`Proprioception error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 60: Cognitive Annealing
app.post('/api/memory/annealing', async (_req, res) => {
  try { res.json(await handleCognitiveAnnealing()); }
  catch (err) { log(`Annealing error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 61: Cognitive Entanglement
app.post('/api/memory/entanglement', async (_req, res) => {
  try { res.json(await handleCognitiveEntanglement()); }
  catch (err) { log(`Entanglement error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 62: Phase Transitions
app.get('/api/memory/phase-transitions', (_req, res) => {
  try { res.json(handlePhaseTransitions()); }
  catch (err) { log(`Phase transition error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 63: Cognitive Fossils
app.get('/api/memory/fossils', async (_req, res) => {
  try { res.json(await handleCognitiveFossils()); }
  catch (err) { log(`Fossils error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 64: Autoimmunity Check
app.get('/api/memory/autoimmunity', async (_req, res) => {
  try { res.json(await handleAutoimmunityCheck()); }
  catch (err) { log(`Autoimmunity error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 65: Chrono-Biology
app.get('/api/memory/chronobiology', (_req, res) => {
  try { res.json(handleChronoBiology()); }
  catch (err) { log(`ChronoBiology error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 66: Cognitive Microbiome
app.get('/api/memory/microbiome', (_req, res) => {
  try { res.json(handleCognitiveMicrobiome()); }
  catch (err) { log(`Microbiome error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 67: Cognitive Synesthesia
app.get('/api/memory/synesthesia', (_req, res) => {
  try { res.json(handleCognitiveSynesthesia()); }
  catch (err) { log(`Synesthesia error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 68: Placebo/Nocebo
app.get('/api/memory/placebo', (_req, res) => {
  try { res.json(handlePlaceboNocebo()); }
  catch (err) { log(`Placebo error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 69: Dialectics
app.post('/api/memory/dialectics', async (_req, res) => {
  try { res.json(await handleDialectics()); }
  catch (err) { log(`Dialectics error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 70: Cognitive Census
app.get('/api/memory/census', (_req, res) => {
  try { res.json(handleCognitiveCensus()); }
  catch (err) { log(`Census error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 71: Autopoiesis
app.post('/api/memory/autopoiesis', async (_req, res) => {
  try { res.json(await handleAutopoiesis()); }
  catch (err) { log(`Autopoiesis error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 72: Strange Loop
app.post('/api/memory/strange-loop', async (_req, res) => {
  try { res.json(await handleStrangeLoop()); }
  catch (err) { log(`Strange loop error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 73: Cognitive Sovereignty
app.get('/api/memory/sovereignty', (_req, res) => {
  try { res.json(handleCognitiveSovereignty()); }
  catch (err) { log(`Sovereignty error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 74: Phi Calculator
app.get('/api/memory/phi', (_req, res) => {
  try { res.json(handlePhiCalculation()); }
  catch (err) { log(`Phi error: ${err}`); res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' }); }
});

// Layer 14: Active goal resumption
app.get('/api/memory/goals', async (_req, res) => {
  try {
    const result = await handleActiveGoals();
    res.json(result);
  } catch (err) {
    log(`Active goals error: ${err}`);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
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
