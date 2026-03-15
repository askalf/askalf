/**
 * Agent Forge API Server
 * Advanced AI Agent Creation Platform
 */

import 'dotenv/config';
import { initializeEmailFromEnv } from '@askalf/email';
import {
  getPrometheusMetrics,
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
  initializeLogger,
} from '@askalf/observability';

const logger = initializeLogger().child({ component: 'forge' });
import { forgeActiveAgents, forgeQueueDepth, forgeExecutionsFailed, forgeWorktreeCount, forgeWorktreeDiskBytes } from './metrics.js';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import Fastify, { type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { initializeDatabase, initializeSubstrateDatabase, closeDatabase, query as dbQuery, substrateQuery, getPool, runForgeMigrations } from './database.js';
import { loadConfig } from './config.js';
import { agentRoutes } from './routes/agents.js';
import { executionRoutes } from './routes/executions.js';
import { sessionRoutes } from './routes/sessions.js';
import { workflowRoutes } from './routes/workflows.js';
import { toolRoutes } from './routes/tools.js';
import { memoryRoutes } from './routes/memory.js';
import { providerRoutes } from './routes/providers.js';
import { userProviderRoutes } from './routes/user-providers.js';
import { assistantRoutes } from './routes/assistant.js';
import { adminRoutes } from './routes/admin.js';
import { proposalRoutes } from './routes/proposals.js';
import { webhookRoutes } from './routes/webhooks.js';
import { gitReviewRoutes } from './routes/git-review.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { integrationRoutes } from './routes/integrations.js';
import { platformAdminRoutes } from './routes/platform-admin/index.js';
import { cliRoutes } from './routes/cli.js';
import { templateRoutes } from './routes/templates.js';
import { intentRoutes } from './routes/intent.js';
import { conversationRoutes } from './routes/conversations.js';
import { channelRoutes } from './routes/channels.js';
import { userBudgetRoutes } from './routes/user-budget.js';
import { deviceRoutes } from './routes/devices.js';
import { daemonRoutes } from './routes/daemons.js';
import { terminalRoutes } from './routes/terminal.js';
import { triggerRoutes } from './routes/triggers.js';
import { economyRoutes } from './routes/economy.js';
import { errorRoutes } from './routes/errors.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { cspReportRoutes } from './routes/csp-report.js';
import { credentialsHealthRoutes } from './routes/credentials-health.js';
import { oauthFlowRoutes } from './routes/oauth-flow.js';
import { publicIntentRoutes } from './routes/public-intent.js';
import { dispatchRoutes } from './routes/dispatch.js';
import { fleetAnalyticsRoutes } from './routes/fleet-analytics.js';
import { registerMCPRoutes } from './tools/mcp-server.js';
import { initializeWorker, runDirectCliExecution, getRunningExecutionCount, waitForRunningExecutions } from './runtime/worker.js';
import { startTaskDispatcher, stopTaskDispatcher } from './runtime/task-dispatcher.js';
import { registerAgentBridge, stopAgentBridge } from './runtime/agent-bridge.js';
import { initMemoryManager } from './memory/singleton.js';
import { startMetabolicCycles } from './memory/metabolic.js';
import { detectAllCapabilities } from './orchestration/capability-registry.js';
import { initEventBus, getEventBus } from './orchestration/event-bus.js';
import { initSharedContext } from './orchestration/shared-context.js';
import { ForgeScheduler } from './orchestration/scheduler.js';
import { startMonitoring } from './orchestration/monitoring-agent.js';
import { startEventLogger } from './orchestration/event-log.js';
import { startReactiveTriggers } from './orchestration/reactive-triggers.js';
import { startAutonomyLoop } from './orchestration/autonomy-loop.js';
import { initAgentCommunication, closeAgentCommunication } from './orchestration/communication.js';
import { initDispatcher, getDispatcher } from './runtime/unified-dispatcher.js';
import { initTriggerEngine, getTriggerEngine } from './runtime/trigger-engine.js';
import { Redis } from 'ioredis';
import { ulid } from 'ulid';
import { initRateLimit, rateLimitHook, closeRateLimitRedis } from './middleware/rate-limit.js';
import { authMiddleware } from './middleware/auth.js';
import { runSelfHostedSetup } from './selfhosted/setup.js';
import { loadSkills } from './selfhosted/skills-loader.js';

const app = Fastify({
  logger: true,
  trustProxy: true, // Read X-Real-IP/X-Forwarded-For from nginx (needed for rate limiter)
  requestTimeout: 120000, // 2 min for long-running agent executions
  bodyLimit: 1024 * 1024 * 2, // 2MB for large prompts
  connectionTimeout: 60000,
});

// Register CORS
const nodeEnv = process.env['NODE_ENV'] ?? 'development';
const corsOrigins = process.env['ALLOWED_ORIGINS']?.split(',') || [
  'https://askalf.org',
  'https://www.askalf.org',
  ...(nodeEnv !== 'production' ? [
    'http://localhost:3001',
    'http://localhost:3002',
    'http://localhost:3005',
    'http://localhost:5173',
    'http://localhost:5174',
  ] : []),
];

await app.register(cors, {
  origin: corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});

// Register Cookie parser (for session auth)
await app.register(cookie);

// Register WebSocket support (for agent bridge)
await app.register(websocket);

// Register Swagger (OpenAPI documentation)
await app.register(swagger, {
  openapi: {
    info: {
      title: 'Agent Forge API',
      description: 'AI Agent Orchestration Platform API',
      version: '1.0.0',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'API Key' },
        cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' },
      },
    },
    security: [{ bearerAuth: [] }],
  },
});

await app.register(swaggerUi, {
  routePrefix: '/api/docs',
  uiConfig: { docExpansion: 'list', deepLinking: true },
});

// ============================================
// RATE LIMITING
// ============================================

// Redis sliding window rate limit (initialized in start() once Redis is ready)
// Registered here at module level so it applies to all routes before their preHandlers.
app.addHook('onRequest', rateLimitHook);


// Security headers + API versioning
app.addHook('onSend', async (_request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  reply.header('X-API-Version', '1.0.0');
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

// Catches any unhandled throws from route handlers.
// Ensures: consistent {error, message, statusCode} shape, no stack traces in production.
app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  const status = error.statusCode ?? 500;
  const isProd = process.env['NODE_ENV'] === 'production';

  request.log.error({ err: { message: error.message, name: error.name, code: (error as NodeJS.ErrnoException).code } }, 'Route error');

  // Handle Fastify validation errors (AJV schema validation failures) — return 400 with descriptive messages.
  const validationErrors = (error as unknown as Record<string, unknown>)['validation'] as Array<{ instancePath: string; message?: string }> | undefined;
  if (validationErrors?.length) {
    const details = validationErrors
      .map((e) => {
        const field = e.instancePath ? e.instancePath.replace(/^\//, '').replace(/\//g, '.') : 'request';
        return `${field}: ${e.message ?? 'invalid value'}`;
      })
      .join('; ');
    return reply.code(400).send({ error: 'Validation Error', message: details, statusCode: 400 });
  }

  // In production, never reveal internal error details for 5xx
  const message = (isProd && status >= 500)
    ? 'Internal Server Error'
    : (error.message || 'An unexpected error occurred');

  const errorName = status >= 500
    ? 'Internal Server Error'
    : (error.name === 'Error' ? 'Error' : error.name) || 'Error';

  return reply.code(status).send({ error: errorName, message, statusCode: status });
});

// Normalize all 4xx/5xx JSON responses to include statusCode field.
// This covers manually sent errors (reply.code(404).send({error: '...'}))
// without requiring changes to every individual route.
app.addHook('onSend', async (_request, reply, payload) => {
  if (reply.statusCode < 400) return payload;
  if (typeof payload !== 'string') return payload;

  const contentType = reply.getHeader('content-type') as string | undefined;
  if (!contentType?.includes('application/json')) return payload;

  try {
    const body = JSON.parse(payload) as Record<string, unknown>;
    // Add statusCode if missing
    if (body['statusCode'] === undefined) {
      body['statusCode'] = reply.statusCode;
    }
    // Strip stack traces (defence in depth — should never be present but ensure it)
    delete body['stack'];
    return JSON.stringify(body);
  } catch {
    return payload;
  }
});

// API key expiry warning — add headers when authenticated key expires within 7 days.
const EXPIRY_WARN_MS = 7 * 24 * 60 * 60 * 1000;
app.addHook('onSend', async (request, reply, payload) => {
  const expiresAt = (request as FastifyRequest & { apiKeyExpiresAt?: Date }).apiKeyExpiresAt;
  if (!expiresAt) return payload;
  const msRemaining = expiresAt.getTime() - Date.now();
  if (msRemaining > 0 && msRemaining <= EXPIRY_WARN_MS) {
    reply.header('X-Api-Key-Expires-At', expiresAt.toISOString());
    const daysRemaining = Math.ceil(msRemaining / (24 * 60 * 60 * 1000));
    reply.header('X-Api-Key-Expiry-Warning', `API key expires in ${daysRemaining} day(s). Rotate before ${expiresAt.toISOString()}.`);
  }
  return payload;
});

// ============================================
// PROMETHEUS METRICS
// ============================================

// HTTP request instrumentation
app.addHook('onRequest', async (request) => {
  httpRequestsInFlight.inc({ service: 'forge' });
  (request as unknown as Record<string, unknown>)['_metricsStart'] = process.hrtime.bigint();
});

app.addHook('onResponse', async (request, reply) => {
  httpRequestsInFlight.dec({ service: 'forge' });
  const start = (request as unknown as Record<string, unknown>)['_metricsStart'] as bigint | undefined;
  const method = request.method;
  const status = String(reply.statusCode);
  httpRequestsTotal.inc({ service: 'forge', method, status });
  if (start) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    httpRequestDuration.observe(durationMs, { service: 'forge', method });
  }
});

// ============================================
// HEALTH CHECK & METRICS ENDPOINTS
// ============================================

app.get('/health', { logLevel: 'silent' }, async () => {
  // Always return healthy if the process is alive and responding.
  // DB pool exhaustion under heavy agent load is transient — NOT a reason
  // for autoheal to kill the process and destroy all running agents.
  let dbOk = false;
  let redisOk = false;

  try {
    await Promise.race([
      dbQuery('SELECT 1'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('db health check timeout')), 500)
      ),
    ]);
    dbOk = true;
  } catch { /* db pool saturated or timed out — transient */ }

  try {
    const eventBus = getEventBus();
    redisOk = eventBus !== null;
  } catch { /* redis unreachable */ }

  const status = dbOk ? 'healthy' : 'degraded';
  const reply = {
    status,
    service: 'forge',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk,
      redis: redisOk,
    },
    uptime: Math.round(process.uptime()),
  };

  // Return 503 if DB is completely down (not just slow)
  // but keep 200 for transient pool exhaustion (uptime > 60s = likely transient)
  if (!dbOk && process.uptime() > 60) {
    return reply;
  }
  return reply;
});

app.get('/api/v1/health/db', { logLevel: 'silent' }, async (_request, reply) => {
  const pool = getPool();
  const total = pool.totalCount;
  const idle = pool.idleCount;
  const waiting = pool.waitingCount;
  const max = 60; // matches initializeDatabase config

  const alert = waiting > 5;

  let dbOk = false;
  try {
    await Promise.race([
      dbQuery('SELECT 1'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 500)
      ),
    ]);
    dbOk = true;
  } catch { /* pool saturated or unreachable */ }

  if (alert) {
    reply.code(503);
  }

  return {
    status: alert ? 'degraded' : 'healthy',
    pool: { total, idle, waiting, max },
    reachable: dbOk,
    alert: alert ? `waiting connections (${waiting}) exceeds threshold (5)` : null,
    timestamp: new Date().toISOString(),
  };
});

app.get('/metrics', { logLevel: 'silent' }, async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return getPrometheusMetrics();
});

// ============================================
// API DOCS — auth-gated OpenAPI endpoints
// ============================================

// Protect /api/docs UI and spec behind auth
app.addHook('onRequest', async (request, reply) => {
  if (!request.url.startsWith('/api/docs')) return;
  await authMiddleware(request, reply);
});

// Explicit openapi.json export (canonical path for tooling/clients)
app.get('/api/docs/openapi.json', { preHandler: [authMiddleware] }, async (_request, reply) => {
  reply.header('Content-Type', 'application/json');
  return app.swagger();
});

// ============================================
// REGISTER ROUTES
// ============================================

await onboardingRoutes(app);
await integrationRoutes(app);
await agentRoutes(app);
await executionRoutes(app);
await sessionRoutes(app);
await workflowRoutes(app);
await toolRoutes(app);
await memoryRoutes(app);
await providerRoutes(app);
await userProviderRoutes(app);
await assistantRoutes(app);
await adminRoutes(app);
await proposalRoutes(app);
await webhookRoutes(app);
await gitReviewRoutes(app);
await platformAdminRoutes(app);
await cliRoutes(app);
await templateRoutes(app);
await intentRoutes(app);
await conversationRoutes(app);
await channelRoutes(app);
await userBudgetRoutes(app);
await deviceRoutes(app);
await daemonRoutes(app);
await terminalRoutes(app);
await triggerRoutes(app);
await economyRoutes(app);
await errorRoutes(app);
await apiKeyRoutes(app);
await cspReportRoutes(app);
await credentialsHealthRoutes(app);
await oauthFlowRoutes(app);
await publicIntentRoutes(app);
await dispatchRoutes(app);
await fleetAnalyticsRoutes(app);
await registerMCPRoutes(app);
await registerAgentBridge(app);

// ============================================
// START SERVER
// ============================================

async function start(): Promise<void> {
  const config = loadConfig();

  // Initialize databases
  initializeDatabase(config.databaseUrl);
  logger.info('[Forge] Forge database connection initialized');

  if (config.substrateDatabaseUrl) {
    initializeSubstrateDatabase(config.substrateDatabaseUrl);
    logger.info('[Forge] Substrate database connection initialized');
  }

  // Run forge database migrations
  const { join } = await import('path');
  const migrationsDir = join(process.env['REPO_ROOT'] || '/workspace', 'apps/forge/migrations');
  await runForgeMigrations(migrationsDir).catch((err) => {
    logger.error(`[Forge] Migration error: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Self-hosted: seed admin user on first boot
  await runSelfHostedSetup().catch((err) => {
    logger.warn(`[SelfHosted] Setup error: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Load platform settings (API keys set through onboarding/UI) into process.env
  try {
    const { query: settingsQuery } = await import('./database.js');
    const settings = await settingsQuery<{ key: string; value: string }>(
      `SELECT key, value FROM platform_settings WHERE encrypted = false`,
    );
    for (const s of settings) {
      if (!process.env[s.key]) {
        process.env[s.key] = s.value;
        logger.info(`[PlatformSettings] Loaded ${s.key} from database`);
      }
    }
  } catch {
    // Table may not exist yet on first boot
  }

  // Load skills from markdown files (skills/ directory)
  await loadSkills().catch((err) => {
    logger.warn(`[Skills] Load error: ${err instanceof Error ? err.message : String(err)}`);
  });

  // Initialize email service (falls back to console if EMAIL_PROVIDER not set)
  initializeEmailFromEnv();
  logger.info('[Forge] Email service initialized');

  try {
    // Initialize execution worker (provider + tools)
    await initializeWorker();
    logger.info('[Forge] Execution worker initialized');

    // Initialize universal memory system
    await initMemoryManager(config.redisUrl);
    startMetabolicCycles();
    logger.info('[Forge] Universal memory + metabolic cycles activated');

    // Initialize event bus and shared context
    await initEventBus(config.redisUrl);
    const sharedRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
    initSharedContext(sharedRedis);
    // Initialize agent-to-agent communication
    initAgentCommunication(config.redisUrl);

    logger.info('[Forge] Event bus + shared context + agent communication initialized');

    // Initialize Redis sliding window rate limiter
    // Load internal API key prefixes so those callers bypass rate limiting
    const internalKeys = await dbQuery<{ key_prefix: string }>(
      `SELECT key_prefix FROM forge_api_keys WHERE id LIKE 'internal-%' AND is_active = true`,
    ).catch(() => [] as { key_prefix: string }[]);
    initRateLimit(config.redisUrl, internalKeys.map((k) => k.key_prefix));
    logger.info(`[Forge] Redis rate limiter initialized (${internalKeys.length} internal key(s) bypassed)`);

    // Initialize unified dispatcher (replaces daemon manager + scheduler daemon)
    const dispatcher = initDispatcher();
    await dispatcher.initialize().catch((err) => {
      logger.warn(`[Dispatcher] Initialization error: ${err instanceof Error ? err.message : String(err)}`);
    });
    logger.info('[Forge] Unified dispatcher initialized');

    // Initialize trigger engine (event-driven agent activation)
    const triggerEngine = initTriggerEngine();
    await triggerEngine.start().catch((err) => {
      logger.warn(`[TriggerEngine] Start error: ${err instanceof Error ? err.message : String(err)}`);
    });
    logger.info('[Forge] Trigger engine started');

    // Start channel integration handlers
    const { startChannelResultHandler } = await import('./channels/result-handler.js');
    const { startWebhookRetryWorker } = await import('./channels/webhook-delivery.js');
    startChannelResultHandler();
    startWebhookRetryWorker();
    logger.info('[Forge] Channel result handler + webhook delivery worker started');

    // Start persistent event logger (logs all events to postgres)
    startEventLogger();

    // Start production monitoring (health checks + auto-heal)
    startMonitoring();

    // Start reactive coordination triggers (cross-domain signal detection)
    startReactiveTriggers();

    // Start autonomy loop (auto-review → merge → deploy pipeline)
    startAutonomyLoop();

    // Initialize workflow scheduler (BullMQ DAG engine)
    const workflowScheduler = new ForgeScheduler(config.redisUrl, async (node, context, runId) => {
      // Agent nodes: dispatch via CLI execution
      const agentId = (node.config['agentId'] as string) ?? null;
      if (!agentId) return { error: 'No agentId configured for agent node' };
      const agent = await dbQuery<{ id: string; name: string; model_id: string; system_prompt: string; max_cost_per_execution: string; max_iterations: number }>(
        `SELECT id, name, model_id, system_prompt, max_cost_per_execution, max_iterations FROM forge_agents WHERE id = $1`, [agentId],
      );
      if (agent.length === 0) return { error: `Agent not found: ${agentId}` };
      const a = agent[0]!;
      const input = `[WORKFLOW NODE: ${(node.config['label'] as string) ?? node.id}]\n\n${(node.config['prompt'] as string) ?? 'Execute this workflow step.'}\n\nContext: ${JSON.stringify(context).substring(0, 2000)}`;
      const execId = ulid();
      await dbQuery(
        `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at) VALUES ($1, $2, 'system:workflow', $3, 'pending', $4, NOW())`,
        [execId, agentId, input, JSON.stringify({ workflow_run_id: runId, workflow_node_id: node.id })],
      );
      // Run synchronously and return output
      const { runDirectCliExecution: runCli } = await import('./runtime/worker.js');
      await runCli(execId, agentId, input, 'system:workflow', {
        modelId: a.model_id, systemPrompt: a.system_prompt,
        maxBudgetUsd: a.max_cost_per_execution, maxTurns: a.max_iterations,
        scheduleIntervalMinutes: 60,
      });
      const result = await dbQuery<{ output: string }>(`SELECT output FROM forge_executions WHERE id = $1`, [execId]);
      return result[0]?.output ?? 'Execution completed';
    });
    workflowScheduler.processWorkflowJobs(config.redisUrl, 2);
    // Expose scheduler for workflow routes
    app.decorate('workflowScheduler', workflowScheduler);
    logger.info('[Forge] Workflow scheduler initialized (BullMQ DAG engine)');

    // Clean up orphaned executions from previous process (restart recovery)
    // Two-phase: first tag resumable orphans (have checkpoint data), then mark rest as failed.
    // All get marked failed, but resumable ones carry metadata.resumable=true for smarter retries.
    const orphaned = await dbQuery<{
      id: string; agent_id: string; parent_execution_id: string | null;
      input: string; owner_id: string; metadata: Record<string, unknown> | null;
      iterations: number; messages: unknown;
    }>(
      `UPDATE forge_executions
       SET status = 'failed',
           error = CASE
             WHEN iterations > 0 AND messages != '[]'::jsonb
               THEN 'Orphaned: forge restarted mid-execution (resumable, ' || iterations || ' iterations completed)'
               ELSE 'Orphaned: forge restarted mid-execution'
           END,
           completed_at = NOW(),
           metadata = CASE
             WHEN iterations > 0 AND messages != '[]'::jsonb
               THEN jsonb_set(
                 jsonb_set(COALESCE(metadata, '{}'), '{resumable}', 'true'),
                 '{orphaned_at}', to_jsonb(NOW()::text)
               )
               ELSE COALESCE(metadata, '{}')
           END
       WHERE status IN ('running', 'pending') AND started_at < NOW() - INTERVAL '5 minutes'
       RETURNING id, agent_id, parent_execution_id, input, owner_id, metadata, iterations, messages`,
    ).catch(() => [] as {
      id: string; agent_id: string; parent_execution_id: string | null;
      input: string; owner_id: string; metadata: Record<string, unknown> | null;
      iterations: number; messages: unknown;
    }[]);
    if (orphaned.length > 0) {
      const resumableCount = orphaned.filter(o => o.iterations > 0).length;
      logger.info(`[Forge] Recovered ${orphaned.length} orphaned executions (${resumableCount} with checkpoint data): ${orphaned.map(o => o.iterations > 0 ? `${o.id}@iter${o.iterations}` : o.id).join(', ')}`);
      // Emit failure events so SSE clients and parent executions are notified
      const eventBus = getEventBus();
      for (const row of orphaned) {
        void eventBus?.emitExecution('failed', row.id, row.agent_id, row.agent_id, {
          error: 'Orphaned: forge restarted mid-execution',
        }).catch((e) => { if (e) console.debug("[catch]", String(e)); });
      }
      // Mark parent executions as failed if all their children are now failed
      const parentIds = [...new Set(orphaned.filter(o => o.parent_execution_id).map(o => o.parent_execution_id!))];
      for (const parentId of parentIds) {
        void dbQuery(
          `UPDATE forge_executions SET status = 'failed', error = 'Child execution orphaned during forge restart', completed_at = NOW()
           WHERE id = $1 AND status = 'running'
             AND NOT EXISTS (SELECT 1 FROM forge_executions WHERE parent_execution_id = $1 AND status NOT IN ('failed', 'completed'))`,
          [parentId],
        ).catch((e) => { if (e) console.debug("[catch]", String(e)); });
      }

      // Auto-retry eligible orphaned executions (scheduled agents only, max 1 retry)
      let retried = 0;
      for (const row of orphaned) {
        // Only retry scheduler-dispatched executions (not manual, sub-agent, or already-retried)
        if (row.owner_id !== 'system:scheduler') continue;
        if (row.parent_execution_id) continue;
        const meta = row.metadata ?? {};
        if (meta['retry_of']) continue; // Already a retry — don't chain retries

        try {
          // Look up agent config (only retry active agents)
          const agents = await dbQuery<{
            name: string; model_id: string | null; system_prompt: string | null;
            max_cost_per_execution: string | null; max_iterations: number | null;
          }>(
            `SELECT name, model_id, system_prompt, max_cost_per_execution, max_iterations
             FROM forge_agents WHERE id = $1 AND status = 'active'`,
            [row.agent_id],
          );
          if (agents.length === 0) continue;
          const agent = agents[0]!;

          // Get schedule interval for runtime budget
          const schedules = await substrateQuery<{ schedule_interval_minutes: number }>(
            `SELECT schedule_interval_minutes FROM agent_schedules WHERE agent_id = $1`,
            [row.agent_id],
          ).catch(() => [] as { schedule_interval_minutes: number }[]);
          const intervalMinutes = schedules[0]?.schedule_interval_minutes ?? 60;

          // Create retry execution with continuation context (include checkpoint progress if available)
          const retryId = ulid();
          const hasCheckpoint = row.iterations > 0;
          const retryMeta = JSON.stringify({
            retry_of: row.id,
            retry_reason: 'forge_restart',
            ...(hasCheckpoint ? { resumed_from_iteration: row.iterations, has_checkpoint: true } : {}),
          });
          const checkpointInfo = hasCheckpoint
            ? ` You completed ${row.iterations} iteration(s) before the restart. Your progress (messages & tool calls) was checkpointed — the scheduler preserved your state.`
            : '';
          const retryInput = `[RESTART RECOVERY — ${new Date().toISOString()}] Your previous execution (${row.id}) was interrupted by a forge restart.${checkpointInfo} Check ticket status and continue where you left off.\n\n${row.input}`;

          await dbQuery(
            `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata)
             VALUES ($1, $2, $3, $4, 'pending', $5)`,
            [retryId, row.agent_id, row.owner_id, retryInput, retryMeta],
          );

          // Push forward next_run_at so the scheduler doesn't double-dispatch this agent
          await substrateQuery(
            `UPDATE agent_schedules
             SET next_run_at = NOW() + (schedule_interval_minutes || ' minutes')::INTERVAL
             WHERE agent_id = $1`,
            [row.agent_id],
          ).catch((e) => { if (e) console.debug("[catch]", String(e)); });

          // Spawn retry execution asynchronously
          void runDirectCliExecution(retryId, row.agent_id, retryInput, row.owner_id, {
            modelId: agent.model_id ?? undefined,
            systemPrompt: agent.system_prompt ?? undefined,
            maxBudgetUsd: agent.max_cost_per_execution ?? undefined,
            maxTurns: agent.max_iterations ?? undefined,
            scheduleIntervalMinutes: intervalMinutes,
          }).catch((err) => {
            logger.error(`[Recovery] Retry execution ${retryId} failed to start:`, err);
          });

          retried++;
          logger.info(`[Recovery] Auto-retrying orphaned execution ${row.id} → ${retryId} for agent ${agent.name}`);
        } catch (err) {
          logger.warn(`[Recovery] Failed to create retry for ${row.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (retried > 0) {
        logger.info(`[Recovery] Auto-retried ${retried}/${orphaned.length} orphaned executions`);
      }
    }

    // Worktree cleanup (every 30 min) — removes stale agent worktrees older than 2 hours
    const worktreesDir = `${process.env['WORKSPACE_ROOT'] ?? '/workspace'}/.worktrees`;
    worktreeCleanupInterval = setInterval(async () => {
      try {
        const scriptPath = `${process.env['WORKSPACE_ROOT'] ?? '/workspace'}/scripts/cleanup-worktrees.sh`;
        const { stdout } = await execAsync(`bash "${scriptPath}" 2`, { timeout: 60_000 });
        // Parse the JSON summary line (last line of output)
        const jsonLine = stdout.trim().split('\n').pop() ?? '';
        const summary = JSON.parse(jsonLine) as { remaining: number; disk_bytes: number; removed: number };
        forgeWorktreeCount.set(summary.remaining);
        forgeWorktreeDiskBytes.set(summary.disk_bytes);
        if (summary.removed > 0) {
          logger.info(`[Forge] Worktree cleanup: removed ${summary.removed} stale worktree(s), ${summary.remaining} remaining (${Math.round(summary.disk_bytes / 1024 / 1024)}MB)`);
        }
      } catch (err) {
        // Fallback: just count worktrees for the metric
        try {
          const { stdout } = await execAsync(`ls -1 "${worktreesDir}" 2>/dev/null | wc -l`, { timeout: 5_000 });
          forgeWorktreeCount.set(parseInt(stdout.trim(), 10));
          const { stdout: du } = await execAsync(`du -sb "${worktreesDir}" 2>/dev/null | cut -f1`, { timeout: 5_000 });
          forgeWorktreeDiskBytes.set(parseInt(du.trim(), 10) || 0);
        } catch { /* ignore */ }
        logger.warn(`[Forge] Worktree cleanup error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 30 * 60_000);

    // Auto-detect agent capabilities on startup (non-blocking)
    void detectAllCapabilities().catch((err) => {
      logger.warn(`[Capabilities] Initial detection failed: ${err instanceof Error ? err.message : String(err)}`);
    });

    // Start fleet task dispatcher (bridges FleetCoordinator → CLI execution)
    void startTaskDispatcher(config.redisUrl).catch((err) => {
      logger.warn(`[TaskDispatcher] Failed to start: ${err instanceof Error ? err.message : String(err)}`);
    });

    // Periodic active agents + queue depth gauge update (every 60s)
    agentGaugeInterval = setInterval(async () => {
      try {
        const [agentRows, queueRows] = await Promise.all([
          dbQuery<{ count: string }>(`SELECT COUNT(*) AS count FROM forge_agents WHERE status = 'active'`),
          dbQuery<{ count: string }>(`SELECT COUNT(*) AS count FROM forge_executions WHERE status = 'pending'`),
        ]);
        forgeActiveAgents.set(parseInt(agentRows[0]?.count ?? '0', 10));
        forgeQueueDepth.set(parseInt(queueRows[0]?.count ?? '0', 10));
      } catch { /* ignore metric update failures */ }
    }, 60_000);

    // Execution timeout sweeper (every 60s) — marks executions running > 20 min as timed out
    // and reopens any in_progress tickets that were being worked by the timed-out agent
    staleCleanupInterval = setInterval(async () => {
      try {
        // Mark pending executions older than 20 min as failed (stuck in queue)
        const stalePending = await dbQuery<{ id: string; agent_id: string }>(
          `UPDATE forge_executions
           SET status = 'failed', error = 'Execution timeout: stuck in pending state for over 20 minutes', completed_at = NOW()
           WHERE status = 'pending' AND created_at < NOW() - INTERVAL '20 minutes'
           RETURNING id, agent_id`,
        );
        // Mark running executions older than 20 min as timed out
        const staleRunning = await dbQuery<{ id: string; agent_id: string }>(
          `UPDATE forge_executions
           SET status = 'timeout', error = 'Execution timeout: exceeded 20-minute maximum runtime', completed_at = NOW()
           WHERE status = 'running' AND started_at < NOW() - INTERVAL '20 minutes'
           RETURNING id, agent_id`,
        );
        const allTimedOut = [...stalePending, ...staleRunning];
        if (allTimedOut.length > 0) {
          forgeExecutionsFailed.inc({}, allTimedOut.length);
          logger.info(`[Forge] Timeout sweeper: marked ${allTimedOut.length} execution(s) as timed out (${stalePending.length} pending, ${staleRunning.length} running)`);
          const eventBus = getEventBus();
          for (const row of allTimedOut) {
            void eventBus?.emitExecution('failed', row.id, row.agent_id, row.agent_id, {
              error: 'Execution timeout',
            }).catch((e) => { if (e) console.debug("[catch]", String(e)); });
          }
        }

        // Reopen in_progress tickets for agents whose running executions timed out
        if (staleRunning.length > 0) {
          const agentIds = [...new Set(staleRunning.map((e) => e.agent_id))];
          const agents = await dbQuery<{ id: string; name: string }>(
            `SELECT id, name FROM forge_agents WHERE id = ANY($1)`,
            [agentIds],
          );
          const agentNameMap = new Map(agents.map((a) => [a.id, a.name]));

          for (const agentId of agentIds) {
            const agentName = agentNameMap.get(agentId);
            if (!agentName) continue;

            const reopened = await substrateQuery<{ id: string; title: string }>(
              `UPDATE agent_tickets
               SET status = 'open', updated_at = NOW()
               WHERE status = 'in_progress' AND assigned_to = $1
               RETURNING id, title`,
              [agentName],
            ).catch(() => [] as { id: string; title: string }[]);

            for (const ticket of reopened) {
              await substrateQuery(
                `INSERT INTO ticket_notes (id, ticket_id, author, content, created_at)
                 VALUES ($1, $2, 'system', $3, NOW())`,
                [
                  ulid(),
                  ticket.id,
                  `Execution timeout: agent ${agentName} exceeded the 20-minute runtime limit. Ticket reopened automatically for the next agent cycle.`,
                ],
              ).catch((e) => { if (e) console.debug("[catch]", String(e)); });
              logger.info(`[Forge] Timeout sweeper: reopened ticket ${ticket.id} for agent ${agentName}`);
            }
          }
        }
      } catch (err) {
        logger.warn(`[Forge] Execution timeout sweeper error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, 60_000);

    await app.listen({ port: config.port, host: '0.0.0.0' });
    logger.info(`[Forge] Agent Forge API server started on port ${config.port}`);
    logger.info(`[Forge] Environment: ${config.nodeEnv}`);
  } catch (err) {
    logger.error(`[Forge] Failed to start server: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

const execAsync = promisify(exec);

let isShuttingDown = false;
let agentGaugeInterval: ReturnType<typeof setInterval> | undefined;
let staleCleanupInterval: ReturnType<typeof setInterval> | undefined;
let worktreeCleanupInterval: ReturnType<typeof setInterval> | undefined;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`[Forge] Received ${signal}, starting graceful shutdown...`);

  // Execution wait: up to 90s. Force-kill after execution wait + 10s headroom for cleanup.
  const executionWaitMs = parseInt(process.env['EXECUTION_WAIT_TIMEOUT'] ?? '90000', 10);
  const forceKillMs = executionWaitMs + 5000;

  const forceShutdown = setTimeout(() => {
    logger.error('[Forge] Graceful shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, forceKillMs);

  try {
    // 1. Stop accepting new requests immediately.
    await app.close();
    logger.info('[Forge] HTTP server closed — no longer accepting new requests');

    // Clear periodic timers (they'd fire against a closing DB otherwise).
    clearInterval(agentGaugeInterval);
    clearInterval(staleCleanupInterval);
    clearInterval(worktreeCleanupInterval);

    // 2. Wait for in-flight CLI executions to finish naturally.
    const initialCount = getRunningExecutionCount();
    if (initialCount > 0) {
      logger.info(`[Forge] Waiting for ${initialCount} in-flight execution(s) to complete (up to ${executionWaitMs}ms)...`);
      const remaining = await waitForRunningExecutions(executionWaitMs);
      if (remaining > 0) {
        logger.warn(`[Forge] ${remaining} execution(s) did not finish within timeout — marking as failed`);
      } else {
        logger.info('[Forge] All in-flight executions completed cleanly');
      }
    }

    // 3. Mark any still-running/pending executions as failed in the DB.
    const shutdownError = `Forge shutting down (${signal})`;
    const inflight = await dbQuery<{ id: string; agent_id: string }>(
      `UPDATE forge_executions SET status = 'failed', error = $1, completed_at = NOW()
       WHERE status IN ('running', 'pending')
       RETURNING id, agent_id`,
      [shutdownError],
    ).catch(() => [] as { id: string; agent_id: string }[]);
    if (inflight.length > 0) {
      logger.info(`[Forge] Marked ${inflight.length} remaining in-flight execution(s) as failed`);
      const eventBus = getEventBus();
      for (const row of inflight) {
        void eventBus?.emitExecution('failed', row.id, row.agent_id, row.agent_id, {
          error: `Forge shutting down (${signal})`,
        }).catch((e) => { if (e) console.debug("[catch]", String(e)); });
      }
    }

    // 4. Close subsystems: workflow scheduler, channel workers, daemon/trigger engine, comms, DB.
    const scheduler = (app as unknown as { workflowScheduler?: ForgeScheduler }).workflowScheduler;
    if (scheduler) {
      await scheduler.close().catch((err: unknown) => logger.warn(`[Forge] Scheduler close error: ${err}`));
      logger.info('[Forge] Workflow scheduler closed');
    }

    const { stopWebhookRetryWorker } = await import('./channels/webhook-delivery.js');
    stopWebhookRetryWorker();
    logger.info('[Forge] Channel workers stopped');

    const triggerEng = getTriggerEngine();
    if (triggerEng) {
      await triggerEng.stop().catch((err: unknown) => logger.warn(`[Forge] TriggerEngine stop error: ${err}`));
    }
    const disp = getDispatcher();
    if (disp) {
      await disp.shutdown().catch((err: unknown) => logger.warn(`[Forge] Dispatcher shutdown error: ${err}`));
    }
    logger.info('[Forge] Dispatcher and trigger engine stopped');

    stopAgentBridge();
    await stopTaskDispatcher().catch((e) => { if (e) console.debug("[catch]", String(e)); });
    await closeAgentCommunication().catch((e) => { if (e) console.debug("[catch]", String(e)); });
    await closeRateLimitRedis().catch((e) => { if (e) console.debug("[catch]", String(e)); });
    logger.info('[Forge] Redis connections closed');

    await closeDatabase();
    logger.info('[Forge] Database pool closed');

    clearTimeout(forceShutdown);
    logger.info('[Forge] Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error(`[Forge] Error during graceful shutdown: ${err instanceof Error ? err.message : String(err)}`);
    clearTimeout(forceShutdown);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error(`[Forge] FATAL uncaught exception: ${err.message}`);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason) => {
  logger.error(`[Forge] Unhandled rejection: ${reason instanceof Error ? reason.stack || reason.message : String(reason)}`);
});

start();
