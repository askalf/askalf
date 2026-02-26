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
} from '@askalf/observability';
import { forgeActiveAgents } from './metrics.js';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { initializeDatabase, initializeSubstrateDatabase, closeDatabase, query as dbQuery, substrateQuery } from './database.js';
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
import { authRoutes } from './routes/auth.js';
import { oauthRoutes } from './routes/oauth.js';
import { integrationRoutes } from './routes/integrations.js';
import { platformAdminRoutes } from './routes/platform-admin/index.js';
import { cliRoutes } from './routes/cli.js';
import { templateRoutes } from './routes/templates.js';
import { intentRoutes } from './routes/intent.js';
import { conversationRoutes } from './routes/conversations.js';
import { csrfProtectionMiddleware } from './middleware/csrf-protection.js';
import { registerMCPRoutes } from './tools/mcp-server.js';
import { initializeWorker, runDirectCliExecution } from './runtime/worker.js';
import { startTaskDispatcher, stopTaskDispatcher } from './runtime/task-dispatcher.js';
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
import { Redis } from 'ioredis';
import { ulid } from 'ulid';

const app = Fastify({
  logger: true,
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
  routePrefix: '/docs',
  uiConfig: { docExpansion: 'list', deepLinking: true },
});

// ============================================
// RATE LIMITING
// ============================================

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW = 60000;

// Auth endpoint dedicated rate limits (brute-force protection)
const authLoginRateLimitMap = new Map<string, { count: number; resetTime: number }>();
const AUTH_LOGIN_LIMIT = 5;              // 5 attempts per window
const AUTH_LOGIN_WINDOW = 5 * 60 * 1000; // 5 minutes

const authRegisterRateLimitMap = new Map<string, { count: number; resetTime: number }>();
const AUTH_REGISTER_LIMIT = 3;              // 3 attempts per window
const AUTH_REGISTER_WINDOW = 60 * 60 * 1000; // 1 hour

app.addHook('onRequest', async (request, reply) => {
  const ip = request.ip || 'unknown';
  // Skip rate limiting for internal Docker network IPs (service-to-service calls)
  if (ip.startsWith('172.') || ip.startsWith('10.') || ip === '127.0.0.1') {
    return;
  }
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
  } else {
    record.count++;
    if (record.count > RATE_LIMIT) {
      return reply.status(429).send({ error: 'Too many requests' });
    }
  }

  // Auth-specific rate limiting (stricter, with Retry-After header)
  const url = request.url.split('?')[0]; // strip query string
  if (url === '/api/v1/auth/login') {
    const loginRecord = authLoginRateLimitMap.get(ip);
    if (!loginRecord || now > loginRecord.resetTime) {
      authLoginRateLimitMap.set(ip, { count: 1, resetTime: now + AUTH_LOGIN_WINDOW });
    } else {
      loginRecord.count++;
      if (loginRecord.count > AUTH_LOGIN_LIMIT) {
        const retryAfter = Math.ceil((loginRecord.resetTime - now) / 1000);
        reply.header('Retry-After', String(retryAfter));
        return reply.status(429).send({ error: 'Too many login attempts. Please try again later.' });
      }
    }
  } else if (url === '/api/v1/auth/register') {
    const regRecord = authRegisterRateLimitMap.get(ip);
    if (!regRecord || now > regRecord.resetTime) {
      authRegisterRateLimitMap.set(ip, { count: 1, resetTime: now + AUTH_REGISTER_WINDOW });
    } else {
      regRecord.count++;
      if (regRecord.count > AUTH_REGISTER_LIMIT) {
        const retryAfter = Math.ceil((regRecord.resetTime - now) / 1000);
        reply.header('Retry-After', String(retryAfter));
        return reply.status(429).send({ error: 'Too many registration attempts. Please try again later.' });
      }
    }
  }
});

// ============================================
// CSRF PROTECTION
// ============================================

app.addHook('preHandler', csrfProtectionMiddleware);

// Security headers
app.addHook('onSend', async (_request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
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

  // In production, never reveal internal error details for 5xx
  const message = (isProd && status >= 500)
    ? 'Internal Server Error'
    : (error.message || 'An unexpected error occurred');

  const errorName = status >= 500
    ? 'Internal Server Error'
    : (error.name === 'Error' ? 'Error' : error.name) || 'Error';

  reply.code(status).send({ error: errorName, message, statusCode: status });
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

// Clean up rate limit maps periodically
const rateLimitCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) rateLimitMap.delete(ip);
  }
  for (const [ip, record] of authLoginRateLimitMap.entries()) {
    if (now > record.resetTime) authLoginRateLimitMap.delete(ip);
  }
  for (const [ip, record] of authRegisterRateLimitMap.entries()) {
    if (now > record.resetTime) authRegisterRateLimitMap.delete(ip);
  }
}, 60000);

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
    await dbQuery('SELECT 1');
    dbOk = true;
  } catch { /* db pool saturated under load — transient */ }

  try {
    const eventBus = getEventBus();
    redisOk = eventBus !== null;
  } catch { /* redis unreachable */ }

  return {
    status: 'healthy',
    service: 'forge',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk,
      redis: redisOk,
    },
    uptime: Math.round(process.uptime()),
  };
});

app.get('/metrics', { logLevel: 'silent' }, async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return getPrometheusMetrics();
});

// ============================================
// REGISTER ROUTES
// ============================================

await authRoutes(app);
await oauthRoutes(app);
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
await registerMCPRoutes(app);

// ============================================
// START SERVER
// ============================================

async function start(): Promise<void> {
  const config = loadConfig();

  // Initialize databases
  initializeDatabase(config.databaseUrl);
  console.log('[Forge] Forge database connection initialized');

  if (config.substrateDatabaseUrl) {
    initializeSubstrateDatabase(config.substrateDatabaseUrl);
    console.log('[Forge] Substrate database connection initialized');
  }

  // Initialize email service (falls back to console if EMAIL_PROVIDER not set)
  initializeEmailFromEnv();
  console.log('[Forge] Email service initialized');

  try {
    // Initialize execution worker (provider + tools)
    await initializeWorker();
    console.log('[Forge] Execution worker initialized');

    // Initialize universal memory system
    await initMemoryManager(config.redisUrl);
    startMetabolicCycles();
    console.log('[Forge] Universal memory + metabolic cycles activated');

    // Initialize event bus and shared context
    await initEventBus(config.redisUrl);
    const sharedRedis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
    initSharedContext(sharedRedis);
    // Initialize agent-to-agent communication
    initAgentCommunication(config.redisUrl);

    console.log('[Forge] Event bus + shared context + agent communication initialized');

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
    console.log('[Forge] Workflow scheduler initialized (BullMQ DAG engine)');

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
      console.log(`[Forge] Recovered ${orphaned.length} orphaned executions (${resumableCount} with checkpoint data): ${orphaned.map(o => o.iterations > 0 ? `${o.id}@iter${o.iterations}` : o.id).join(', ')}`);
      // Emit failure events so SSE clients and parent executions are notified
      const eventBus = getEventBus();
      for (const row of orphaned) {
        void eventBus?.emitExecution('failed', row.id, row.agent_id, row.agent_id, {
          error: 'Orphaned: forge restarted mid-execution',
        }).catch(() => {});
      }
      // Mark parent executions as failed if all their children are now failed
      const parentIds = [...new Set(orphaned.filter(o => o.parent_execution_id).map(o => o.parent_execution_id!))];
      for (const parentId of parentIds) {
        void dbQuery(
          `UPDATE forge_executions SET status = 'failed', error = 'Child execution orphaned during forge restart', completed_at = NOW()
           WHERE id = $1 AND status = 'running'
             AND NOT EXISTS (SELECT 1 FROM forge_executions WHERE parent_execution_id = $1 AND status NOT IN ('failed', 'completed'))`,
          [parentId],
        ).catch(() => {});
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
          ).catch(() => {});

          // Spawn retry execution asynchronously
          void runDirectCliExecution(retryId, row.agent_id, retryInput, row.owner_id, {
            modelId: agent.model_id ?? undefined,
            systemPrompt: agent.system_prompt ?? undefined,
            maxBudgetUsd: agent.max_cost_per_execution ?? undefined,
            maxTurns: agent.max_iterations ?? undefined,
            scheduleIntervalMinutes: intervalMinutes,
          }).catch((err) => {
            console.error(`[Recovery] Retry execution ${retryId} failed to start:`, err);
          });

          retried++;
          console.log(`[Recovery] Auto-retrying orphaned execution ${row.id} → ${retryId} for agent ${agent.name}`);
        } catch (err) {
          console.warn(`[Recovery] Failed to create retry for ${row.id}:`, err instanceof Error ? err.message : err);
        }
      }
      if (retried > 0) {
        console.log(`[Recovery] Auto-retried ${retried}/${orphaned.length} orphaned executions`);
      }
    }

    // Auto-detect agent capabilities on startup (non-blocking)
    void detectAllCapabilities().catch((err) => {
      console.warn('[Capabilities] Initial detection failed:', err instanceof Error ? err.message : err);
    });

    // Start fleet task dispatcher (bridges FleetCoordinator → CLI execution)
    void startTaskDispatcher(config.redisUrl).catch((err) => {
      console.warn('[TaskDispatcher] Failed to start:', err instanceof Error ? err.message : err);
    });

    // Periodic active agents gauge update (every 60s) — stored for cleanup in shutdown()
    agentGaugeInterval = setInterval(async () => {
      try {
        const rows = await dbQuery<{ count: string }>(`SELECT COUNT(*) AS count FROM forge_agents WHERE status = 'active'`);
        forgeActiveAgents.set(parseInt(rows[0]?.count ?? '0', 10));
      } catch { /* ignore metric update failures */ }
    }, 60_000);

    // Stale execution cleanup (every 5 min) — stored for cleanup in shutdown()
    staleCleanupInterval = setInterval(async () => {
      try {
        // Mark pending executions older than 20 min as failed (allows 10 min queue wait + margin)
        const stalePending = await dbQuery<{ id: string; agent_id: string }>(
          `UPDATE forge_executions SET status = 'failed', error = 'Timed out in pending state', completed_at = NOW()
           WHERE status = 'pending' AND created_at < NOW() - INTERVAL '20 minutes'
           RETURNING id, agent_id`,
        );
        // Mark running executions older than 20 min as failed
        const staleRunning = await dbQuery<{ id: string; agent_id: string }>(
          `UPDATE forge_executions SET status = 'failed', error = 'Exceeded maximum runtime', completed_at = NOW()
           WHERE status = 'running' AND started_at < NOW() - INTERVAL '20 minutes'
           RETURNING id, agent_id`,
        );
        const cleaned = [...stalePending, ...staleRunning];
        if (cleaned.length > 0) {
          console.log(`[Forge] Cleaned up ${cleaned.length} stale executions`);
          const eventBus = getEventBus();
          for (const row of cleaned) {
            void eventBus?.emitExecution('failed', row.id, row.agent_id, row.agent_id, {
              error: 'Stale execution cleanup',
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('[Forge] Stale execution cleanup error:', err instanceof Error ? err.message : err);
      }
    }, 300_000);

    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[Forge] Agent Forge API server started on port ${config.port}`);
    console.log(`[Forge] Environment: ${config.nodeEnv}`);
  } catch (err) {
    console.error('[Forge] Failed to start server:', err);
    process.exit(1);
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

let isShuttingDown = false;
let agentGaugeInterval: ReturnType<typeof setInterval> | undefined;
let staleCleanupInterval: ReturnType<typeof setInterval> | undefined;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Forge] Received ${signal}, starting graceful shutdown...`);

  const shutdownTimeout = parseInt(process.env['SHUTDOWN_TIMEOUT'] ?? '30000', 10);

  const forceShutdown = setTimeout(() => {
    console.error('[Forge] Graceful shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, shutdownTimeout);

  try {
    // Mark in-flight executions as failed before closing (prevents orphaning on planned shutdowns)
    const shutdownError = `Forge shutting down (${signal})`;
    const inflight = await dbQuery<{ id: string; agent_id: string }>(
      `UPDATE forge_executions SET status = 'failed', error = $1, completed_at = NOW()
       WHERE status IN ('running', 'pending')
       RETURNING id, agent_id`,
      [shutdownError],
    ).catch(() => [] as { id: string; agent_id: string }[]);
    if (inflight.length > 0) {
      console.log(`[Forge] Marked ${inflight.length} in-flight executions as failed before shutdown`);
      const eventBus = getEventBus();
      for (const row of inflight) {
        void eventBus?.emitExecution('failed', row.id, row.agent_id, row.agent_id, {
          error: `Forge shutting down (${signal})`,
        }).catch(() => {});
      }
    }

    // Clear periodic timers
    clearInterval(rateLimitCleanupInterval);
    clearInterval(agentGaugeInterval);
    clearInterval(staleCleanupInterval);

    // Close workflow scheduler (BullMQ worker + queue)
    const scheduler = (app as unknown as { workflowScheduler?: ForgeScheduler }).workflowScheduler;
    if (scheduler) {
      await scheduler.close().catch((err: unknown) => console.warn('[Forge] Scheduler close error:', err));
      console.log('[Forge] Workflow scheduler closed');
    }

    await app.close();
    console.log('[Forge] Server closed');

    await stopTaskDispatcher().catch(() => {});
    await closeAgentCommunication().catch(() => {});
    await closeDatabase();
    console.log('[Forge] Database connection closed');

    clearTimeout(forceShutdown);
    console.log('[Forge] Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[Forge] Error during graceful shutdown:', err);
    clearTimeout(forceShutdown);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  console.error('[Forge] FATAL uncaught exception:', err);
  shutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Forge] Unhandled rejection at:', promise, 'reason:', reason);
  // Log but don't crash — many fire-and-forget patterns exist.
  // TODO: After transaction adoption reduces fire-and-forget patterns,
  // escalate this to shutdown.
});

start();
