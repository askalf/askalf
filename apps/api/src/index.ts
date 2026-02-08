import 'dotenv/config';
import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { initializePool, query, queryOne } from '@substrate/database';
import { initializeAI, generateEmbedding, extractIntent, hashIntentTemplate, routeQuery, type RoutingDecision, classifyShardMatch, logShadowComparison, type ShardCandidate } from '@substrate/ai';
import { initializeEventBus, getEventBus, closeEventBus } from '@substrate/events';
import { procedural, episodic, semantic, working, alf, checkpoint, gather, type TenantContext as MemoryTenantContext } from '@substrate/memory';
import { execute } from '@substrate/sandbox';
import { generatePatternHash, ids, shardLogicScanner } from '@substrate/core';
import {
  initializeLogger,
  getLogger,
  getPrometheusMetrics,
  getMetricsJson,
  runHealthChecks,
  registerHealthCheck,
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
} from '@substrate/observability';
import {
  tenantMiddleware,
  AuthenticatedRequest,
  buildVisibilityFilter,
  canCreatePrivateShard,
  canCreatePrivateFact,
  requireAdmin,
} from './middleware/tenant.js';
import {
  registerSecurityMiddleware,
  apiRateLimit,
  authRateLimit,
  registerRateLimit,
  sensitiveRateLimit,
  executeRateLimit,
  traceRateLimit,
  DISPOSABLE_EMAIL_DOMAINS,
} from './middleware/security.js';
import { tenantRoutes } from './routes/tenants.js';
import { authRoutes } from './routes/auth.js';
import { billingRoutes } from './routes/billing.js';
import { demoRoutes } from './routes/demo.js';
import { consumerRoutes } from './routes/consumer.js';
import { bundleRoutes } from './routes/bundles.js';
import { metacognitionRoutes } from './routes/metacognition.js';
import { backupRoutes } from './routes/backups.js';
import { adminAssistantRoutes } from './routes/admin-assistant.js';
import { shardExportRoutes } from './routes/shard-export.js';
import { shardPackRoutes } from './routes/shard-packs.js';
import { ticketRoutes } from './routes/tickets.js';
import { agentRoutes } from './routes/agents.js';
import { interventionRoutes } from './routes/interventions.js';
import { reportRoutes } from './routes/reports.js';
import { taskRoutes } from './routes/tasks.js';
import { startAgentScheduler, stopAgentScheduler, getSchedulerStatus } from './services/agent-scheduler.js';
import {
  checkUsageAndBilling,
  recordUsage,
  getAvailableModels,
  getUserTier,
  getPlatformKey,
  recordPlatformKeyUsage,
  TOKEN_PACKAGES,
} from './services/billing.js';

// Initialize services
initializeLogger();
const logger = getLogger();

// Shard cache for fast pattern matching (refreshes every 30 seconds)
interface ShardCache {
  shards: Awaited<ReturnType<typeof procedural.getPromotedShards>>;
  timestamp: number;
  tenantId: string | undefined;
  includeAll: boolean;
}
let shardCache: ShardCache | null = null;
const SHARD_CACHE_TTL = 30000; // 30 seconds

async function getCachedShards(
  includeAll: boolean,
  tenantContext?: { tenantId: string; tier?: string }
) {
  const now = Date.now();
  const tenantId = tenantContext?.tenantId;
  // Invalidate cache if tenant changed, includeAll changed, or TTL expired
  if (
    !shardCache ||
    now - shardCache.timestamp > SHARD_CACHE_TTL ||
    shardCache.tenantId !== tenantId ||
    shardCache.includeAll !== includeAll
  ) {
    const memTenant = tenantContext ? { tenantId: tenantContext.tenantId } : undefined;
    const shards = await procedural.getPromotedShards(includeAll, memTenant);
    shardCache = {
      shards,
      timestamp: now,
      tenantId,
      includeAll,
    };
  }
  return shardCache!.shards;
}

const app = Fastify({
  logger: false, // Using our own logger
  requestTimeout: 30000, // 30 second request timeout
  bodyLimit: 1024 * 1024, // 1MB max body size
  connectionTimeout: 60000, // 60 second connection timeout
});

// Register plugins
await app.register(cors, {
  origin: process.env['ALLOWED_ORIGINS']?.split(',') || [
    'https://askalf.org',
    'https://www.askalf.org',
    'https://app.askalf.org',
    'https://api.askalf.org',
    'https://space.askalf.org',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3100',
    'http://localhost:5173',
    'http://localhost:5174',
  ],
  credentials: true, // Allow cookies in CORS
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});

const sessionSecret = process.env['SESSION_SECRET'];
if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET environment variable is required and must be at least 32 characters');
}
await app.register(cookie, {
  secret: sessionSecret,
});

// Add custom content-type parser to preserve raw body for Stripe webhooks
// This runs before JSON parsing and stores the raw buffer
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body: Buffer, done) => {
    // Store raw body on request for Stripe webhook verification
    (req as unknown as { rawBody: Buffer }).rawBody = body;
    try {
      const json = JSON.parse(body.toString());
      done(null, json);
    } catch (err) {
      done(err as Error, undefined);
    }
  }
);

// Register security middleware
await registerSecurityMiddleware(app);

// Register tenant middleware on all routes
app.addHook('preHandler', tenantMiddleware);

// Apply rate limiting to all API routes
app.addHook('preHandler', async (request, reply) => {
  // Skip rate limiting for health checks
  if (request.url === '/health') return;

  // Extra-strict rate limit for registration (5 per 15 min per IP)
  if (request.url === '/api/v1/auth/register' && request.method === 'POST') {
    await registerRateLimit(request, reply);
    if (reply.sent) return;
  }

  // Tight rate limit for forgot-password (5 per hour per IP)
  if (request.url === '/api/v1/auth/forgot-password' && request.method === 'POST') {
    await sensitiveRateLimit(request, reply);
    if (reply.sent) return;
  }

  // Stricter rate limiting for auth endpoints (except csrf-token which is called frequently)
  if (request.url.startsWith('/api/v1/auth/') && !request.url.includes('/csrf-token')) {
    await authRateLimit(request, reply);
  } else if (request.url === '/api/v1/execute') {
    // Higher rate limit for execute endpoint (core functionality)
    await executeRateLimit(request, reply);
  } else if (request.url.startsWith('/api/')) {
    await apiRateLimit(request, reply);
  }
});

// Register route modules
await authRoutes(app);
await tenantRoutes(app);
await billingRoutes(app);
await demoRoutes(app);
await consumerRoutes(app);
await bundleRoutes(app);
await metacognitionRoutes(app);
await backupRoutes(app);
await adminAssistantRoutes(app);
await shardExportRoutes(app);
await shardPackRoutes(app);
await ticketRoutes(app);
await agentRoutes(app);
await interventionRoutes(app);
await reportRoutes(app);
await taskRoutes(app);

// ===========================================
// METRICS & HEALTH CHECKS
// ===========================================

// Register health checks for dependencies
registerHealthCheck('database', async () => {
  try {
    const { query } = await import('@substrate/database');
    const start = Date.now();
    await query('SELECT 1');
    const latency = Date.now() - start;
    if (latency > 1000) {
      return { status: 'warn', message: `Database slow: ${latency}ms` };
    }
    return { status: 'pass', message: `Connected (${latency}ms)` };
  } catch (err) {
    return { status: 'fail', message: err instanceof Error ? err.message : 'Database connection failed' };
  }
});

registerHealthCheck('redis', async () => {
  try {
    const { getEventBus } = await import('@substrate/events');
    const bus = getEventBus();
    const start = Date.now();
    await bus.ping();
    const latency = Date.now() - start;
    if (latency > 500) {
      return { status: 'warn', message: `Redis slow: ${latency}ms` };
    }
    return { status: 'pass', message: `Connected (${latency}ms)` };
  } catch (err) {
    return { status: 'fail', message: err instanceof Error ? err.message : 'Redis connection failed' };
  }
});

// Track HTTP metrics and structured logging in request lifecycle
app.addHook('onRequest', async (request) => {
  // Track in-flight requests
  const route = request.url.split('?')[0] ?? request.url;
  httpRequestsInFlight.inc({ method: request.method, route });
  // Store start time for duration tracking
  (request as unknown as { startTime: bigint }).startTime = process.hrtime.bigint();

  // Skip logging for health checks and metrics (too noisy)
  if (route === '/health' || route === '/health/live' || route === '/health/ready' || route === '/metrics') {
    return;
  }

  // Structured request logging
  logger.debug({
    event: 'request.start',
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  }, `${request.method} ${route}`);
});

app.addHook('onResponse', async (request, reply) => {
  const method = request.method;
  const route = request.url.split('?')[0] ?? request.url;
  const statusCode = reply.statusCode;

  // Decrement in-flight
  httpRequestsInFlight.dec({ method, route });

  // Increment total requests
  httpRequestsTotal.inc({ method, route, status: statusCode.toString() });

  // Record duration
  const startTime = (request as unknown as { startTime: bigint }).startTime;
  let durationMs = 0;
  if (startTime) {
    durationMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    httpRequestDuration.observe(durationMs, { method, route });
  }

  // Skip logging for health checks and metrics
  if (route === '/health' || route === '/health/live' || route === '/health/ready' || route === '/metrics') {
    return;
  }

  // Structured response logging
  const logLevel = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info';
  logger[logLevel]({
    event: 'request.complete',
    method,
    url: route,
    statusCode,
    durationMs: Math.round(durationMs * 100) / 100,
    ip: request.ip,
  }, `${method} ${route} ${statusCode} ${Math.round(durationMs)}ms`);
});

// Prometheus metrics endpoint
app.get('/metrics', async (request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4');
  return getPrometheusMetrics();
});

// JSON metrics endpoint (for dashboard)
app.get('/metrics/json', async () => {
  return getMetricsJson();
});

// Detailed health check endpoint
app.get('/health', async () => {
  const result = await runHealthChecks();
  return {
    status: result.status,
    timestamp: new Date().toISOString(),
    checks: result.checks,
    uptime_seconds: result.uptime_seconds,
  };
});

// Simple liveness probe (for Kubernetes)
app.get('/health/live', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Readiness probe (checks dependencies)
app.get('/health/ready', async () => {
  const result = await runHealthChecks();
  if (result.status === 'unhealthy') {
    return { status: 'not_ready', checks: result.checks };
  }
  return { status: 'ready', checks: result.checks };
});

// Monitoring dashboard data endpoint
app.get('/api/v1/monitoring/status', async () => {
  const { query } = await import('@substrate/database');
  const health = await runHealthChecks();
  const metrics = getMetricsJson();

  // Get recent activity stats
  const [recentActivity] = await query<{
    traces_1h: string;
    shards_1h: string;
    episodes_1h: string;
    executions_1h: string;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM reasoning_traces WHERE timestamp > NOW() - INTERVAL '1 hour') as traces_1h,
      (SELECT COUNT(*) FROM procedural_shards WHERE created_at > NOW() - INTERVAL '1 hour') as shards_1h,
      (SELECT COUNT(*) FROM episodes WHERE created_at > NOW() - INTERVAL '1 hour') as episodes_1h,
      (SELECT COUNT(*) FROM shard_executions WHERE executed_at > NOW() - INTERVAL '1 hour') as executions_1h
  `);

  return {
    status: health.status,
    uptime_seconds: health.uptime_seconds,
    checks: health.checks,
    activity: {
      last_hour: {
        traces: parseInt(recentActivity?.traces_1h ?? '0', 10),
        shards: parseInt(recentActivity?.shards_1h ?? '0', 10),
        episodes: parseInt(recentActivity?.episodes_1h ?? '0', 10),
        executions: parseInt(recentActivity?.executions_1h ?? '0', 10),
      },
    },
    metrics: metrics,
  };
});

// Client-side error reporting endpoint
app.post('/api/v1/errors/report', async (request, reply) => {
  const body = request.body as {
    message?: string;
    stack?: string;
    componentStack?: string;
    url?: string;
    userAgent?: string;
    timestamp?: string;
  };

  // Log the error with structured data
  logger.error({
    source: 'client',
    message: body.message,
    stack: body.stack,
    componentStack: body.componentStack,
    url: body.url,
    userAgent: body.userAgent,
    timestamp: body.timestamp,
    ip: request.ip,
  }, 'Client-side error reported');

  // Store in database for analysis
  try {
    const { query } = await import('@substrate/database');
    const { ids } = await import('@substrate/core');

    await query(
      `INSERT INTO client_errors (id, message, stack, component_stack, url, user_agent, ip, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
      [
        ids.error(),
        body.message?.substring(0, 1000) ?? 'Unknown error',
        body.stack?.substring(0, 5000),
        body.componentStack?.substring(0, 5000),
        body.url?.substring(0, 500),
        body.userAgent?.substring(0, 500),
        request.ip,
      ]
    );
  } catch (dbErr) {
    // Table might not exist yet - that's ok, we still logged it
    logger.warn({ err: dbErr }, 'Failed to store client error in database');
  }

  return { success: true };
});

// Disposable email domains to block
// DISPOSABLE_EMAIL_DOMAINS imported from ./middleware/security.js

// Waitlist signup (public endpoint)
app.post('/api/v1/waitlist', async (request, reply) => {
  const { email, source, website, company_name } = request.body as {
    email?: string;
    source?: string;
    website?: string;      // Honeypot field 1
    company_name?: string; // Honeypot field 2
  };

  // Honeypot check - if hidden fields are filled, silently reject (bots fill all fields)
  if (website || company_name) {
    logger.warn({ email: email?.substring(0, 3) + '***' }, 'Waitlist bot detected via honeypot');
    // Return success to not reveal bot detection
    return { success: true, message: 'You\'re on the list!' };
  }

  if (!email || typeof email !== 'string') {
    return reply.code(400).send({ error: 'Email is required' });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return reply.code(400).send({ error: 'Invalid email format' });
  }

  // Disposable email check
  const emailDomain = email.toLowerCase().split('@')[1] ?? '';
  if (emailDomain && DISPOSABLE_EMAIL_DOMAINS.has(emailDomain)) {
    logger.warn({ domain: emailDomain }, 'Waitlist disposable email blocked');
    return reply.code(400).send({ error: 'Please use a permanent email address' });
  }

  // Validate source (default to 'website' if not provided)
  const validSources = ['hero', 'enterprise', 'developers', 'website', 'terminal', 'developer-tools', 'resend', 'signup'];
  const signupSource = validSources.includes(source || '') ? source : 'website';

  try {
    // Store in waitlist table
    await query(
      `INSERT INTO waitlist (email, source, created_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source`,
      [email.toLowerCase(), signupSource]
    );

    // Get total waitlist count
    const [countResult] = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM waitlist'
    );
    const totalWaitlistCount = parseInt(countResult?.count || '0', 10);

    // Send confirmation email to user
    const { sendWaitlistEmail, sendAdminNotification } = await import('@substrate/email');
    await sendWaitlistEmail(email, { email });

    // Send admin notification
    const adminEmail = process.env['ADMIN_EMAIL'];
    if (adminEmail) {
      await sendAdminNotification(adminEmail, {
        type: 'waitlist_signup',
        email: email.toLowerCase(),
        timestamp: new Date().toISOString(),
        totalWaitlistCount,
      });
    }

    logger.info({ email: email.substring(0, 3) + '***', total: totalWaitlistCount }, 'Waitlist signup');

    return { success: true, message: 'You\'re on the list!' };
  } catch (error) {
    logger.error({ error }, 'Waitlist signup failed');
    return reply.code(500).send({ error: 'Failed to join waitlist' });
  }
});

// Waitlist count (public endpoint)
app.get('/api/v1/waitlist/count', async () => {
  const { query } = await import('@substrate/database');

  try {
    const [result] = await query<{ count: string }>('SELECT COUNT(*) as count FROM waitlist');
    const count = parseInt(result?.count || '0', 10);
    return { count };
  } catch (error) {
    logger.error({ error }, 'Failed to get waitlist count');
    return { count: 0 };
  }
});

// Admin: Get all waitlist entries
app.get('/api/v1/admin/waitlist', async (request, reply) => {
  const { query } = await import('@substrate/database');

  // Check admin auth via session
  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' });
  }
  const [user] = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.code(403).send({ error: 'Admin access required' });
  }

  try {
    const entries = await query<{
      id: number;
      email: string;
      source: string | null;
      created_at: Date;
      welcome_email_sent_at: Date | null;
    }>('SELECT id, email, source, created_at, welcome_email_sent_at FROM waitlist ORDER BY created_at DESC');

    return { entries };
  } catch (error) {
    logger.error({ error }, 'Failed to get waitlist entries');
    return reply.code(500).send({ error: 'Failed to fetch waitlist' });
  }
});

// Admin: Send welcome email to waitlist user
app.post('/api/v1/admin/waitlist/:id/send-welcome', async (request, reply) => {
  const { query } = await import('@substrate/database');

  // Check admin auth via session
  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' });
  }
  const [user] = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.code(403).send({ error: 'Admin access required' });
  }

  const { id } = request.params as { id: string };
  const { resend } = request.body as { resend?: boolean };

  try {
    // Get the waitlist entry
    const [entry] = await query<{ id: number; email: string; welcome_email_sent_at: Date | null }>(
      'SELECT id, email, welcome_email_sent_at FROM waitlist WHERE id = $1',
      [id]
    );

    if (!entry) {
      return reply.code(404).send({ error: 'Waitlist entry not found' });
    }

    // Send the waitlist confirmation email
    const { sendWaitlistEmail } = await import('@substrate/email');
    await sendWaitlistEmail(entry.email, { email: entry.email });

    logger.info({ email: entry.email, resend }, 'Welcome email sent to waitlist user');

    // Update the sent timestamp
    await query(
      'UPDATE waitlist SET welcome_email_sent_at = NOW() WHERE id = $1',
      [id]
    );

    return { success: true, message: resend ? 'Welcome email resent' : 'Welcome email sent' };
  } catch (error) {
    logger.error({ error, id }, 'Failed to send welcome email');
    return reply.code(500).send({ error: 'Failed to send welcome email' });
  }
});

// Admin: Send beta invite to waitlist user
app.post('/api/v1/admin/waitlist/:id/send-beta-invite', async (request, reply) => {
  const { query } = await import('@substrate/database');

  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' });
  }
  const [user] = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.code(403).send({ error: 'Admin access required' });
  }

  const { id } = request.params as { id: string };

  try {
    const [entry] = await query<{ id: number; email: string }>(
      'SELECT id, email FROM waitlist WHERE id = $1',
      [id]
    );

    if (!entry) {
      return reply.code(404).send({ error: 'Waitlist entry not found' });
    }

    const { sendBetaInviteEmail } = await import('@substrate/email');
    await sendBetaInviteEmail(entry.email, {
      email: entry.email,
      signupUrl: 'https://askalf.org/signup',
    });

    logger.info({ email: entry.email }, 'Beta invite sent to waitlist user');

    return { success: true, message: 'Beta invite sent' };
  } catch (error) {
    logger.error({ error, id }, 'Failed to send beta invite');
    return reply.code(500).send({ error: 'Failed to send beta invite' });
  }
});

// Admin: Send beta invite to ALL waitlist members
app.post('/api/v1/admin/waitlist/send-beta-invites', async (request, reply) => {
  const { query } = await import('@substrate/database');

  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' });
  }
  const [user] = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.code(403).send({ error: 'Admin access required' });
  }

  const { testOnly, testEmail } = request.body as { testOnly?: boolean; testEmail?: string };

  try {
    const { sendBetaInviteEmail } = await import('@substrate/email');

    if (testOnly) {
      const targetEmail = testEmail || process.env['ADMIN_EMAIL'];
      if (!targetEmail) {
        return reply.code(400).send({ error: 'No test email provided and ADMIN_EMAIL not configured' });
      }
      await sendBetaInviteEmail(targetEmail, {
        email: targetEmail,
        signupUrl: 'https://askalf.org/signup',
      });
      logger.info({ email: targetEmail }, 'Beta invite test email sent');
      return { success: true, message: `Test beta invite sent to ${targetEmail}`, count: 1 };
    }

    // Send to all waitlist members who haven't been invited yet
    const entries = await query<{ id: number; email: string }>(
      'SELECT id, email FROM waitlist WHERE beta_invite_sent_at IS NULL ORDER BY created_at'
    );

    if (entries.length === 0) {
      return { success: true, message: 'No uninvited waitlist members found', sent: 0, failed: 0 };
    }

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of entries) {
      try {
        await sendBetaInviteEmail(entry.email, {
          email: entry.email,
          signupUrl: 'https://askalf.org/signup',
        });

        // Mark as invited
        await query(
          'UPDATE waitlist SET beta_invite_sent_at = NOW() WHERE id = $1',
          [entry.id]
        );

        sent++;
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        failed++;
        errors.push(entry.email);
        logger.error({ email: entry.email, error: err }, 'Failed to send beta invite');
      }
    }

    logger.info({ sent, failed, total: entries.length }, 'Bulk beta invites sent');
    return {
      success: true,
      message: `Sent ${sent} beta invites, ${failed} failed`,
      sent,
      failed,
      total: entries.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    logger.error({ error }, 'Failed to send bulk beta invites');
    return reply.code(500).send({ error: 'Failed to send bulk beta invites' });
  }
});

// Admin: Send waitlist update announcement
app.post('/api/v1/admin/waitlist/send-update', async (request, reply) => {
  const { query } = await import('@substrate/database');

  // Check admin auth via session
  const userId = await getUserIdFromSession(request);
  if (!userId) {
    return reply.code(401).send({ error: 'Authentication required' });
  }
  const [user] = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.code(403).send({ error: 'Admin access required' });
  }

  const { testOnly, testEmail } = request.body as { testOnly?: boolean; testEmail?: string };

  try {
    const { sendWaitlistUpdateEmail } = await import('@substrate/email');

    if (testOnly) {
      // Send only to test email (default: admin email)
      const targetEmail = testEmail || process.env['ADMIN_EMAIL'];
      if (!targetEmail) {
        return reply.code(400).send({ error: 'No test email provided and ADMIN_EMAIL not configured' });
      }
      await sendWaitlistUpdateEmail(targetEmail, { email: targetEmail });
      logger.info({ email: targetEmail }, 'Waitlist update test email sent');
      return { success: true, message: `Test email sent to ${targetEmail}`, count: 1 };
    }

    // Send to all waitlist members
    const entries = await query<{ email: string }>('SELECT email FROM waitlist ORDER BY created_at');

    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const entry of entries) {
      try {
        await sendWaitlistUpdateEmail(entry.email, { email: entry.email });
        sent++;
        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100));
      } catch (err) {
        failed++;
        errors.push(entry.email);
        logger.error({ email: entry.email, error: err }, 'Failed to send waitlist update');
      }
    }

    logger.info({ sent, failed }, 'Waitlist update emails sent');
    return {
      success: true,
      message: `Sent ${sent} emails, ${failed} failed`,
      sent,
      failed,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    logger.error({ error }, 'Failed to send waitlist update emails');
    return reply.code(500).send({ error: 'Failed to send waitlist update emails' });
  }
});

// API routes
app.get('/api/v1/stats', async () => {
  const { query } = await import('@substrate/database');

  // Procedural Memory (Shards)
  const [shardStats] = await query<{
    total: string;
    promoted: string;
    shadow: string;
    candidate: string;
    testing: string;
    archived: string;
    public_count: string;
    private_count: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE lifecycle = 'promoted') as promoted,
       COUNT(*) FILTER (WHERE lifecycle = 'shadow') as shadow,
       COUNT(*) FILTER (WHERE lifecycle = 'candidate') as candidate,
       COUNT(*) FILTER (WHERE lifecycle = 'testing') as testing,
       COUNT(*) FILTER (WHERE lifecycle = 'archived') as archived,
       COUNT(*) FILTER (WHERE visibility = 'public') as public_count,
       COUNT(*) FILTER (WHERE visibility = 'private') as private_count
     FROM procedural_shards`
  );

  const [traceStats] = await query<{ total: string; synthesized: string }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE synthesized = true) as synthesized
     FROM reasoning_traces`
  );

  const [executionStats] = await query<{ total: string; successful: string }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE success = true) as successful
     FROM shard_executions`
  );

  // Episodic Memory (SAO Chains)
  const [episodeStats] = await query<{ total: string; positive: string; negative: string }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE valence = 'positive') as positive,
       COUNT(*) FILTER (WHERE valence = 'negative') as negative
     FROM episodes`
  );

  // Semantic Memory (Truth Store)
  const [factStats] = await query<{ total: string; high_confidence: string; avg_confidence: string; categories: string }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE confidence >= 0.8) as high_confidence,
       COALESCE(AVG(confidence), 0)::text as avg_confidence,
       COUNT(DISTINCT category) as categories
     FROM knowledge_facts`
  );

  // Working Memory (Context Liquidation)
  const [workingStats] = await query<{
    total: string;
    raw: string;
    liquidated: string;
    promoted: string;
    avg_compression: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'raw') as raw,
       COUNT(*) FILTER (WHERE status = 'liquidated') as liquidated,
       COUNT(*) FILTER (WHERE status = 'promoted') as promoted,
       COALESCE(AVG(compression_ratio) FILTER (WHERE compression_ratio IS NOT NULL), 0)::text as avg_compression
     FROM working_contexts`
  );

  return {
    procedural: {
      shards: {
        total: parseInt(shardStats?.total ?? '0', 10),
        promoted: parseInt(shardStats?.promoted ?? '0', 10),
        shadow: parseInt(shardStats?.shadow ?? '0', 10),
        candidate: parseInt(shardStats?.candidate ?? '0', 10),
        testing: parseInt(shardStats?.testing ?? '0', 10),
        archived: parseInt(shardStats?.archived ?? '0', 10),
        public: parseInt(shardStats?.public_count ?? '0', 10),
        private: parseInt(shardStats?.private_count ?? '0', 10),
      },
      traces: {
        total: parseInt(traceStats?.total ?? '0', 10),
        synthesized: parseInt(traceStats?.synthesized ?? '0', 10),
      },
      executions: {
        total: parseInt(executionStats?.total ?? '0', 10),
        successful: parseInt(executionStats?.successful ?? '0', 10),
        successRate: parseInt(executionStats?.total ?? '0', 10) > 0
          ? parseInt(executionStats?.successful ?? '0', 10) / parseInt(executionStats?.total ?? '0', 10)
          : 0,
      },
    },
    episodic: {
      total: parseInt(episodeStats?.total ?? '0', 10),
      positive: parseInt(episodeStats?.positive ?? '0', 10),
      negative: parseInt(episodeStats?.negative ?? '0', 10),
    },
    semantic: {
      facts: parseInt(factStats?.total ?? '0', 10),
      highConfidence: parseInt(factStats?.high_confidence ?? '0', 10),
      avgConfidence: parseFloat(factStats?.avg_confidence ?? '0'),
      categories: parseInt(factStats?.categories ?? '0', 10),
    },
    working: {
      total: parseInt(workingStats?.total ?? '0', 10),
      raw: parseInt(workingStats?.raw ?? '0', 10),
      liquidated: parseInt(workingStats?.liquidated ?? '0', 10),
      promoted: parseInt(workingStats?.promoted ?? '0', 10),
      avgCompression: parseFloat(workingStats?.avg_compression ?? '0'),
    },
  };
});

// ===========================================
// PUBLIC SHARDS (Community Library)
// ===========================================

// List public/community shards (no auth required)
app.get('/api/shards/public', async (request) => {
  const { category, search, limit } = request.query as {
    category?: string;
    search?: string;
    limit?: string;
  };
  const { query } = await import('@substrate/database');

  const params: unknown[] = [];
  let paramIdx = 0;

  let whereClause = `WHERE ps.visibility = 'public' AND ps.lifecycle = 'promoted'`;

  if (category && category !== 'all') {
    paramIdx++;
    // Map category to pattern-based filtering
    whereClause += ` AND ps.category = $${paramIdx}`;
    params.push(category);
  }

  if (search) {
    paramIdx++;
    whereClause += ` AND (ps.name ILIKE $${paramIdx} OR ps.patterns::text ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
  }

  paramIdx++;
  params.push(parseInt(limit ?? '50', 10));

  const shards = await query<Record<string, unknown>>(`
    SELECT
      ps.id, ps.name, ps.confidence, ps.lifecycle, ps.category,
      ps.execution_count, ps.success_count, ps.created_at
    FROM procedural_shards ps
    ${whereClause}
    ORDER BY ps.execution_count DESC, ps.confidence DESC
    LIMIT $${paramIdx}
  `, params);

  // Get stats for the community view
  const [stats] = await query<{
    total: string;
    categories: string;
    avg_success: string;
    total_executions: string;
  }>(`
    SELECT
      COUNT(*) as total,
      COUNT(DISTINCT category) as categories,
      COALESCE(AVG(CASE WHEN execution_count > 0 THEN success_count::float / execution_count ELSE 0 END), 0) as avg_success,
      COALESCE(SUM(execution_count), 0) as total_executions
    FROM procedural_shards
    WHERE visibility = 'public' AND lifecycle = 'promoted'
  `);

  return {
    shards: shards.map(s => ({
      id: s['id'],
      name: s['name'],
      confidence: s['confidence'],
      category: s['category'] || 'general',
      execution_count: s['execution_count'] as number,
      success_count: s['success_count'] as number,
      createdAt: s['created_at'],
    })),
    stats: {
      total: parseInt(stats?.total ?? '0', 10),
      categories: parseInt(stats?.categories ?? '0', 10),
      avg_success_rate: parseFloat(stats?.avg_success ?? '0'),
      total_executions: parseInt(stats?.total_executions ?? '0', 10),
    },
  };
});

// Get single shard details (accessible to logged-in users)
app.get('/api/shards/:id', async (request) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };
  const { query } = await import('@substrate/database');

  // Get shard (must be public or owned by user)
  const [shard] = await query<Record<string, unknown>>(`
    SELECT
      ps.id, ps.name, ps.confidence, ps.lifecycle, ps.visibility, ps.category,
      ps.execution_count, ps.success_count, ps.failure_count, ps.patterns,
      ps.logic, ps.pattern_hash, ps.owner_id, ps.created_at, ps.last_executed
    FROM procedural_shards ps
    WHERE ps.id = $1
      AND (ps.visibility = 'public' OR ps.owner_id = $2)
  `, [id, req.tenant?.tenantId]);

  if (!shard) {
    return { error: 'Shard not found', code: 'NOT_FOUND' };
  }

  // Get recent executions for this shard
  const executions = await query<Record<string, unknown>>(`
    SELECT id, success, execution_ms, error, tokens_saved, created_at
    FROM shard_executions
    WHERE shard_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [id]);

  return {
    shard: {
      id: shard['id'],
      name: shard['name'],
      confidence: shard['confidence'],
      lifecycle: shard['lifecycle'],
      visibility: shard['visibility'],
      category: shard['category'],
      executionCount: shard['execution_count'],
      successCount: shard['success_count'],
      failureCount: shard['failure_count'],
      patterns: shard['patterns'],
      logic: shard['logic'],
      patternHash: shard['pattern_hash'],
      createdAt: shard['created_at'],
      lastExecuted: shard['last_executed'],
      isOwned: shard['owner_id'] === req.tenant?.tenantId,
    },
    executions: executions.map(e => ({
      id: e['id'],
      success: e['success'],
      executionMs: e['execution_ms'],
      error: e['error'],
      createdAt: e['created_at'],
    })),
  };
});

// Get distinct shard categories
app.get('/api/v1/shards/categories', async () => {
  const { query } = await import('@substrate/database');
  const rows = await query<{ category: string; count: string }>(
    `SELECT category, COUNT(*)::text as count FROM procedural_shards
     WHERE category IS NOT NULL AND category != ''
     GROUP BY category ORDER BY count DESC`
  );
  return { categories: rows.map(r => ({ value: r.category, count: parseInt(r.count, 10) })) };
});

// List shards (tenant-aware: shows public + own private)
app.get('/api/v1/shards', async (request) => {
  const req = request as AuthenticatedRequest;
  const { lifecycle, visibility, category, limit: limitParam, offset: offsetParam } = request.query as {
    lifecycle?: string;
    visibility?: string;
    category?: string;
    limit?: string;
    offset?: string;
  };
  const { query } = await import('@substrate/database');

  // Build visibility filter based on tenant
  const visFilter = buildVisibilityFilter(req.tenant, 'ps');
  const params: unknown[] = [...visFilter.params];
  let paramIdx = visFilter.paramOffset;

  let whereClause = `WHERE ${visFilter.clause}`;

  if (lifecycle && lifecycle !== 'all') {
    paramIdx++;
    whereClause += ` AND ps.lifecycle = $${paramIdx}`;
    params.push(lifecycle);
  } else {
    whereClause += ` AND ps.lifecycle = 'promoted'`;
  }

  if (visibility && ['public', 'private', 'organization'].includes(visibility)) {
    paramIdx++;
    whereClause += ` AND ps.visibility = $${paramIdx}`;
    params.push(visibility);
  }

  if (category && category !== 'all') {
    paramIdx++;
    whereClause += ` AND ps.category = $${paramIdx}`;
    params.push(category);
  }

  const queryLimit = Math.min(parseInt(limitParam || '100', 10), 500);
  const queryOffset = Math.max(parseInt(offsetParam || '0', 10), 0);

  // Count query (uses same whereClause and params, no limit/offset)
  const countResult = await query<Record<string, unknown>>(`
    SELECT COUNT(*) as count FROM procedural_shards ps
    LEFT JOIN tenants t ON ps.owner_id = t.id
    ${whereClause}
  `, params);
  const total = parseInt(String((countResult[0] as Record<string, unknown>)['count'] || '0'), 10);

  // Main query with LIMIT and OFFSET
  paramIdx++;
  const mainParams = [...params, queryLimit];
  const limitIdx = paramIdx;
  paramIdx++;
  mainParams.push(queryOffset);
  const offsetIdx = paramIdx;

  const shards = await query<Record<string, unknown>>(`
    SELECT
      ps.id, ps.name, ps.description, ps.confidence, ps.lifecycle, ps.visibility,
      ps.execution_count, ps.success_count, ps.failure_count, ps.owner_id, ps.created_at, ps.updated_at,
      ps.category, ps.synthesis_method, ps.patterns, ps.shard_type,
      ps.tokens_saved, ps.avg_latency_ms,
      ps.intent_template, ps.knowledge_type, ps.verification_status,
      ps.source_trace_ids, ps.source_url, ps.source_type
    FROM procedural_shards ps
    LEFT JOIN tenants t ON ps.owner_id = t.id
    ${whereClause}
    ORDER BY ps.execution_count DESC, ps.confidence DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `, mainParams);

  return {
    total,
    limit: queryLimit,
    offset: queryOffset,
    shards: shards.map(s => {
      const ownerId = s['owner_id'] as string | null;
      const execCount = s['execution_count'] as number;
      const successCount = s['success_count'] as number;
      const failureCount = s['failure_count'] as number;

      return {
        id: s['id'],
        name: s['name'],
        description: s['description'] || '',
        confidence: s['confidence'],
        lifecycle: s['lifecycle'],
        visibility: s['visibility'],
        executionCount: execCount,
        successCount: successCount,
        failureCount: failureCount,
        successRate: execCount > 0 ? successCount / execCount : 0,
        ownerId: ownerId,
        isOwned: ownerId === req.tenant?.tenantId,
        createdAt: s['created_at'],
        updatedAt: s['updated_at'],
        category: s['category'] || 'general',
        shardType: s['shard_type'] || 'standard',
        patterns: s['patterns'] || [],
        synthesisMethod: s['synthesis_method'] || null,
        tokensSaved: s['tokens_saved'] || 0,
        avgLatencyMs: s['avg_latency_ms'] || 0,
        intentTemplate: s['intent_template'] || null,
        knowledgeType: s['knowledge_type'] || null,
        verificationStatus: s['verification_status'] || null,
        sourceTraceIds: s['source_trace_ids'] || [],
        sourceUrl: s['source_url'] || null,
        sourceType: s['source_type'] || null,
      };
    }),
  };
});

// Create a new shard
app.post('/api/v1/shards', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { name, logic, patterns, visibility, lifecycle } = request.body as {
    name: string;
    logic: string;
    patterns?: string[];
    visibility?: 'public' | 'private' | 'organization';
    lifecycle?: string;
  };

  if (!name || !logic) {
    return reply.status(400).send({
      success: false,
      error: 'Name and logic are required',
      code: 'MISSING_FIELDS',
    });
  }

  // Security scan the shard logic before storing
  const scanResult = shardLogicScanner.scan(logic);
  if (scanResult.shouldBlock) {
    logger.warn({ name, errors: scanResult.errors, riskLevel: scanResult.riskLevel }, 'Shard creation blocked by security scanner');
    return reply.status(400).send({
      success: false,
      error: `Shard logic blocked: ${scanResult.errors.join('; ')}`,
      code: 'SECURITY_BLOCKED',
    });
  }
  if (scanResult.flagForReview) {
    logger.warn({ name, warnings: scanResult.warnings, riskLevel: scanResult.riskLevel }, 'Shard logic flagged for review');
  }

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }

  const { query } = await import('@substrate/database');

  const { ids } = await import('@substrate/core');
  const shardId = ids.shard();
  const patternHash = patterns?.length
    ? Array.from(
        new Uint8Array(
          await crypto.subtle.digest('SHA-256', new TextEncoder().encode(patterns.join('|')))
        )
      ).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
    : null;

  await query(`
    INSERT INTO procedural_shards (id, name, logic, patterns, pattern_hash, visibility, lifecycle, owner_id, confidence)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.5)
  `, [
    shardId,
    name,
    logic,
    JSON.stringify(patterns || []),
    patternHash,
    visibility || 'private',
    lifecycle || 'candidate',
    tenantId
  ]);

  return {
    success: true,
    shard: { id: shardId, name, lifecycle: lifecycle || 'candidate' },
  };
});

// Get shard detail by ID
app.get('/api/v1/shards/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };
  const { query } = await import('@substrate/database');

  const [shard] = await query<Record<string, unknown>>(`
    SELECT
      ps.id, ps.name, ps.description, ps.logic, ps.patterns, ps.pattern_hash,
      ps.confidence, ps.lifecycle, ps.visibility, ps.execution_count,
      ps.success_count, ps.failure_count, ps.owner_id, ps.created_at, ps.updated_at,
      ps.category, ps.synthesis_method,
      ps.tokens_saved, ps.avg_latency_ms, ps.last_executed,
      ps.intent_template, ps.knowledge_type, ps.verification_status,
      ps.source_trace_ids, ps.source_url, ps.source_type
    FROM procedural_shards ps
    WHERE ps.id = $1
  `, [id]);

  if (!shard) {
    return reply.status(404).send({
      success: false,
      error: 'Shard not found',
      code: 'NOT_FOUND',
    });
  }

  // Check visibility - private shards only accessible by owner or admin
  const ownerId = shard['owner_id'] as string | null;
  const visibility = shard['visibility'] as string;
  const isOwner = ownerId === req.tenant?.tenantId;
  const isAdmin = req.tenant?.role === 'admin' || req.tenant?.role === 'super_admin';

  if (visibility === 'private' && !isOwner && !isAdmin) {
    return reply.status(403).send({
      success: false,
      error: 'Access denied',
      code: 'ACCESS_DENIED',
    });
  }

  const synthesisMethod = shard['synthesis_method'] as string | null;

  // Get recent executions for this shard
  const executions = await query<Record<string, unknown>>(`
    SELECT id, success, execution_ms, error, created_at
    FROM shard_executions
    WHERE shard_id = $1
    ORDER BY created_at DESC
    LIMIT 10
  `, [id]);

  const execCount = shard['execution_count'] as number;
  const successCount = shard['success_count'] as number;
  const failureCount = shard['failure_count'] as number;

  return {
    executions: executions.map(e => ({
      id: e['id'],
      success: e['success'],
      executionMs: e['execution_ms'],
      error: e['error'],
      createdAt: e['created_at'],
    })),
    shard: {
      id: shard['id'],
      name: shard['name'],
      description: shard['description'] || '',
      logic: shard['logic'],
      patterns: shard['patterns'] || [],
      patternHash: shard['pattern_hash'],
      confidence: shard['confidence'],
      lifecycle: shard['lifecycle'],
      visibility: shard['visibility'],
      executionCount: execCount,
      successCount: successCount,
      failureCount: failureCount,
      successRate: execCount > 0 ? successCount / execCount : 0,
      ownerId: ownerId,
      isOwned: isOwner,
      createdAt: shard['created_at'],
      updatedAt: shard['updated_at'],
      lastExecuted: shard['last_executed'],
      category: shard['category'] || 'general',
      shardType: shard['shard_type'] || 'standard',
      synthesisMethod: synthesisMethod,
      tokensSaved: shard['tokens_saved'] || 0,
      avgLatencyMs: shard['avg_latency_ms'] || 0,
      intentTemplate: shard['intent_template'] || null,
      knowledgeType: shard['knowledge_type'] || null,
      verificationStatus: shard['verification_status'] || null,
      sourceTraceIds: shard['source_trace_ids'] || [],
      sourceUrl: shard['source_url'] || null,
      sourceType: shard['source_type'] || null,
    },
  };
});

// Update an existing shard
app.put('/api/v1/shards/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };
  const { name, logic, patterns, visibility } = request.body as {
    name?: string;
    logic?: string;
    patterns?: string[];
    visibility?: 'public' | 'private' | 'organization';
  };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }

  const { query } = await import('@substrate/database');

  // Check ownership (admins can edit any shard)
  const [existing] = await query<Record<string, unknown>>(`
    SELECT owner_id FROM procedural_shards WHERE id = $1
  `, [id]);

  if (!existing) {
    return reply.status(404).send({
      success: false,
      error: 'Shard not found',
      code: 'NOT_FOUND',
    });
  }

  const isAdmin = req.tenant?.role === 'admin' || req.tenant?.role === 'super_admin';
  if (existing['owner_id'] !== tenantId && !isAdmin) {
    return reply.status(403).send({
      success: false,
      error: 'You can only edit your own shards',
      code: 'ACCESS_DENIED',
    });
  }

  // Security scan logic if provided
  if (logic) {
    const scanResult = shardLogicScanner.scan(logic);
    if (scanResult.shouldBlock) {
      logger.warn({ shardId: id, errors: scanResult.errors, riskLevel: scanResult.riskLevel }, 'Shard update blocked by security scanner');
      return reply.status(400).send({
        success: false,
        error: `Shard logic blocked: ${scanResult.errors.join('; ')}`,
        code: 'SECURITY_BLOCKED',
      });
    }
    if (scanResult.flagForReview) {
      logger.warn({ shardId: id, warnings: scanResult.warnings, riskLevel: scanResult.riskLevel }, 'Shard logic update flagged for review');
    }
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (name) {
    updates.push(`name = $${paramIdx++}`);
    params.push(name);
  }
  if (logic) {
    updates.push(`logic = $${paramIdx++}`);
    params.push(logic);
  }
  if (patterns) {
    updates.push(`patterns = $${paramIdx++}`);
    params.push(JSON.stringify(patterns));
  }
  if (visibility) {
    updates.push(`visibility = $${paramIdx++}`);
    params.push(visibility);
  }

  if (updates.length === 0) {
    return reply.status(400).send({
      success: false,
      error: 'No fields to update',
      code: 'NO_UPDATES',
    });
  }

  updates.push(`updated_at = NOW()`);
  params.push(id);

  await query(`
    UPDATE procedural_shards SET ${updates.join(', ')} WHERE id = $${paramIdx}
  `, params);

  return { success: true };
});

// Change shard lifecycle (promote/demote)
app.patch('/api/v1/shards/:id/lifecycle', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };
  const { lifecycle } = request.body as { lifecycle: string };

  const validLifecycles = ['candidate', 'testing', 'shadow', 'promoted', 'archived', 'resurrected'];
  if (!lifecycle || !validLifecycles.includes(lifecycle)) {
    return reply.status(400).send({
      success: false,
      error: `Invalid lifecycle. Must be one of: ${validLifecycles.join(', ')}`,
      code: 'INVALID_LIFECYCLE',
    });
  }

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }

  const { query } = await import('@substrate/database');

  // Check ownership
  const [existing] = await query<Record<string, unknown>>(`
    SELECT owner_id FROM procedural_shards WHERE id = $1
  `, [id]);

  if (!existing) {
    return reply.status(404).send({
      success: false,
      error: 'Shard not found',
      code: 'NOT_FOUND',
    });
  }

  if (existing['owner_id'] !== tenantId) {
    return reply.status(403).send({
      success: false,
      error: 'You can only change lifecycle of your own shards',
      code: 'ACCESS_DENIED',
    });
  }

  await query(`
    UPDATE procedural_shards SET lifecycle = $1, updated_at = NOW() WHERE id = $2
  `, [lifecycle, id]);

  return { success: true, lifecycle };
});

// Delete a shard
app.delete('/api/v1/shards/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({
      success: false,
      error: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }

  const { query } = await import('@substrate/database');

  // Check ownership
  const [existing] = await query<Record<string, unknown>>(`
    SELECT owner_id FROM procedural_shards WHERE id = $1
  `, [id]);

  if (!existing) {
    return reply.status(404).send({
      success: false,
      error: 'Shard not found',
      code: 'NOT_FOUND',
    });
  }

  if (existing['owner_id'] !== tenantId) {
    return reply.status(403).send({
      success: false,
      error: 'You can only delete your own shards',
      code: 'ACCESS_DENIED',
    });
  }

  await query(`DELETE FROM procedural_shards WHERE id = $1`, [id]);

  return { success: true };
});

// ===========================================
// ADMIN SHARD MANAGEMENT
// ===========================================

// Admin: Update any shard
app.patch('/api/v1/admin/shards/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };
  const body = request.body as {
    name?: string;
    description?: string;
    logic?: string;
    patterns?: string[];
    category?: string;
    lifecycle?: string;
    shardType?: string;
    visibility?: string;
    confidence?: number;
  };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  // Security scan logic if provided (even admins cannot bypass security)
  if (body.logic !== undefined) {
    const scanResult = shardLogicScanner.scan(body.logic);
    if (scanResult.shouldBlock) {
      logger.warn({ adminId: tenantId, shardId: id, errors: scanResult.errors, riskLevel: scanResult.riskLevel }, 'Admin shard update blocked by security scanner');
      return reply.status(400).send({
        success: false,
        error: `Shard logic blocked: ${scanResult.errors.join('; ')}`,
        code: 'SECURITY_BLOCKED',
      });
    }
    if (scanResult.flagForReview) {
      logger.warn({ adminId: tenantId, shardId: id, warnings: scanResult.warnings, riskLevel: scanResult.riskLevel }, 'Admin shard logic update flagged for review');
    }
  }

  // Build update query dynamically
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (body.name !== undefined) {
    updates.push(`name = $${paramIdx++}`);
    params.push(body.name);
  }
  if (body.description !== undefined) {
    updates.push(`description = $${paramIdx++}`);
    params.push(body.description);
  }
  if (body.logic !== undefined) {
    updates.push(`logic = $${paramIdx++}`);
    params.push(body.logic);
  }
  if (body.patterns !== undefined) {
    updates.push(`patterns = $${paramIdx++}`);
    params.push(JSON.stringify(body.patterns));
  }
  if (body.category !== undefined) {
    updates.push(`category = $${paramIdx++}`);
    params.push(body.category);
  }
  if (body.lifecycle !== undefined) {
    updates.push(`lifecycle = $${paramIdx++}`);
    params.push(body.lifecycle);
  }
  if (body.shardType !== undefined) {
    updates.push(`shard_type = $${paramIdx++}`);
    params.push(body.shardType);
  }
  if (body.visibility !== undefined) {
    updates.push(`visibility = $${paramIdx++}`);
    params.push(body.visibility);
  }
  if (body.confidence !== undefined) {
    updates.push(`confidence = $${paramIdx++}`);
    params.push(body.confidence);
  }

  if (updates.length === 0) {
    return reply.status(400).send({ success: false, error: 'No fields to update' });
  }

  updates.push(`updated_at = NOW()`);
  params.push(id);

  const result = await query(`
    UPDATE procedural_shards SET ${updates.join(', ')} WHERE id = $${paramIdx}
    RETURNING id
  `, params);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Shard not found' });
  }

  logger.info({ adminId: tenantId, shardId: id }, 'Admin updated shard');

  return { success: true };
});

// Admin: Delete any shard
app.delete('/api/v1/admin/shards/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  // Delete related records first
  await query(`DELETE FROM shard_executions WHERE shard_id = $1`, [id]);
  await query(`DELETE FROM shard_submissions WHERE shard_id = $1`, [id]);

  const result = await query(`DELETE FROM procedural_shards WHERE id = $1 RETURNING id`, [id]);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Shard not found' });
  }

  logger.info({ adminId: tenantId, shardId: id }, 'Admin deleted shard');

  return { success: true };
});

// Admin: Promote shard to production
app.post('/api/v1/admin/shards/:id/promote', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  const result = await query(`
    UPDATE procedural_shards
    SET lifecycle = 'promoted', visibility = 'public', updated_at = NOW()
    WHERE id = $1
    RETURNING id, name
  `, [id]);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Shard not found' });
  }

  logger.info({ adminId: tenantId, shardId: id }, 'Admin promoted shard');

  return { success: true, lifecycle: 'promoted' };
});

// Admin: Archive shard
app.post('/api/v1/admin/shards/:id/archive', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  const result = await query(`
    UPDATE procedural_shards
    SET lifecycle = 'archived', updated_at = NOW()
    WHERE id = $1
    RETURNING id, name
  `, [id]);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Shard not found' });
  }

  logger.info({ adminId: tenantId, shardId: id }, 'Admin archived shard');

  return { success: true, lifecycle: 'archived' };
});

// ===========================================
// COMMUNITY SHARD SUBMISSION ENDPOINTS
// User submission and admin review routes are in routes/consumer.ts
// Security scanning is integrated into the submission flow
// ===========================================

// ===========================================
// TRACE ENDPOINTS (for ALF Brain)
// ===========================================

// Get trace detail
app.get('/api/v1/traces/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  const [trace] = await query<Record<string, unknown>>(`
    SELECT
      t.id, t.input, t.output, t.reasoning, t.execution_ms,
      t.intent_template, t.intent_category, t.intent_name, t.intent_confidence,
      t.tokens_used, t.model, t.synthesized, t.attracted_to_shard,
      t.session_id, t.source, t.visibility, t.pattern_hash, t.timestamp,
      ps.name as shard_name
    FROM reasoning_traces t
    LEFT JOIN procedural_shards ps ON t.attracted_to_shard = ps.id
    WHERE t.id = $1
  `, [id]);

  if (!trace) {
    return reply.status(404).send({ success: false, error: 'Trace not found' });
  }

  return {
    trace: {
      id: trace['id'],
      input: trace['input'],
      output: trace['output'],
      reasoning: trace['reasoning'],
      executionMs: trace['execution_ms'],
      intentTemplate: trace['intent_template'],
      intentCategory: trace['intent_category'],
      intentName: trace['intent_name'],
      intentConfidence: trace['intent_confidence'],
      tokensUsed: trace['tokens_used'],
      model: trace['model'],
      synthesized: trace['synthesized'],
      attractedToShard: trace['attracted_to_shard'],
      shardName: trace['shard_name'],
      sessionId: trace['session_id'],
      source: trace['source'],
      visibility: trace['visibility'],
      patternHash: trace['pattern_hash'],
      timestamp: trace['timestamp'],
    },
  };
});

// Admin: Delete trace
app.delete('/api/v1/admin/traces/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  const result = await query(`DELETE FROM reasoning_traces WHERE id = $1 RETURNING id`, [id]);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Trace not found' });
  }

  logger.info({ adminId: tenantId, traceId: id }, 'Admin deleted trace');

  return { success: true };
});

// Admin: Crystallize trace
app.post('/api/v1/admin/traces/:id/crystallize', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  // Get the trace
  const [trace] = await query<{ input: string; output: string; intent_category: string }>(`
    SELECT input, output, intent_category FROM reasoning_traces WHERE id = $1
  `, [id]);

  if (!trace) {
    return reply.status(404).send({ success: false, error: 'Trace not found' });
  }

  // Enqueue crystallization job
  const eventBus = getEventBus();
  await eventBus.emit('trace:crystallize', {
    traceId: id,
    input: trace.input,
    output: trace.output,
    intentCategory: trace.intent_category,
    manual: true,
  });

  // Mark trace as crystallizing
  await query(`
    UPDATE reasoning_traces SET crystallization_status = 'crystallizing' WHERE id = $1
  `, [id]);

  logger.info({ adminId: tenantId, traceId: id }, 'Admin triggered crystallization');

  return { success: true, message: 'Crystallization job queued' };
});

// ===========================================
// EPISODE ENDPOINTS (for ALF Brain)
// ===========================================

// Get episode detail
app.get('/api/v1/episodes/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  const [episode] = await query<Record<string, unknown>>(`
    SELECT
      id, type, situation, action, outcome, summary,
      success, valence, importance, session_id, related_shard_id,
      parent_episode_id, agent_id, lessons_learned, metadata,
      timestamp, created_at
    FROM episodes
    WHERE id = $1
  `, [id]);

  if (!episode) {
    return reply.status(404).send({ success: false, error: 'Episode not found' });
  }

  return {
    episode: {
      id: episode['id'],
      type: episode['type'],
      situation: episode['situation'],
      action: episode['action'],
      outcome: episode['outcome'],
      summary: episode['summary'],
      success: episode['success'],
      valence: episode['valence'],
      importance: episode['importance'],
      sessionId: episode['session_id'],
      relatedShardId: episode['related_shard_id'],
      parentEpisodeId: episode['parent_episode_id'],
      agentId: episode['agent_id'],
      lessonsLearned: episode['lessons_learned'],
      metadata: episode['metadata'],
      timestamp: episode['timestamp'],
      createdAt: episode['created_at'],
    },
  };
});

// Admin: Delete episode
app.delete('/api/v1/admin/episodes/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  const result = await query(`DELETE FROM episodes WHERE id = $1 RETURNING id`, [id]);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Episode not found' });
  }

  logger.info({ adminId: tenantId, episodeId: id }, 'Admin deleted episode');

  return { success: true };
});

// ===========================================
// FACT ENDPOINTS (for ALF Brain)
// ===========================================

// Get fact detail (tenant-scoped)
app.get('/api/v1/facts/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };
  const tenantId = req.tenant?.tenantId;

  // Build visibility clause
  let visClause: string;
  const params: unknown[] = [id];
  if (!tenantId || tenantId === 'tenant_system') {
    visClause = '1=1';
  } else {
    params.push(tenantId);
    visClause = `(visibility = 'public' OR owner_id IS NULL OR (visibility = 'private' AND owner_id = $2))`;
  }

  const [fact] = await query<Record<string, unknown>>(`
    SELECT
      id, subject, predicate, object, statement, category,
      confidence, source, embedding IS NOT NULL as has_embedding,
      access_count, last_accessed_at, created_at, updated_at
    FROM knowledge_facts
    WHERE id = $1 AND ${visClause}
  `, params);

  if (!fact) {
    return reply.status(404).send({ success: false, error: 'Fact not found' });
  }

  return {
    fact: {
      id: fact['id'],
      subject: fact['subject'],
      predicate: fact['predicate'],
      object: fact['object'],
      statement: fact['statement'],
      category: fact['category'],
      confidence: fact['confidence'],
      source: fact['source'],
      hasEmbedding: fact['has_embedding'],
      accessCount: fact['access_count'],
      lastAccessedAt: fact['last_accessed_at'],
      createdAt: fact['created_at'],
      updatedAt: fact['updated_at'],
    },
  };
});

// Admin: Update fact
app.patch('/api/v1/admin/facts/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };
  const body = request.body as {
    subject?: string;
    predicate?: string;
    object?: string;
    statement?: string;
    category?: string;
    confidence?: number;
  };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  // Build update query
  const updates: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (body.subject !== undefined) {
    updates.push(`subject = $${paramIdx++}`);
    params.push(body.subject);
  }
  if (body.predicate !== undefined) {
    updates.push(`predicate = $${paramIdx++}`);
    params.push(body.predicate);
  }
  if (body.object !== undefined) {
    updates.push(`object = $${paramIdx++}`);
    params.push(body.object);
  }
  if (body.statement !== undefined) {
    updates.push(`statement = $${paramIdx++}`);
    params.push(body.statement);
  }
  if (body.category !== undefined) {
    updates.push(`category = $${paramIdx++}`);
    params.push(body.category);
  }
  if (body.confidence !== undefined) {
    updates.push(`confidence = $${paramIdx++}`);
    params.push(body.confidence);
  }

  if (updates.length === 0) {
    return reply.status(400).send({ success: false, error: 'No updates provided' });
  }

  updates.push('updated_at = NOW()');
  params.push(id);

  // Scope: admin can update public/unowned facts, or their own private facts
  let visClause: string;
  if (tenantId === 'tenant_system') {
    visClause = '';
  } else {
    params.push(tenantId);
    visClause = ` AND (visibility = 'public' OR owner_id IS NULL OR (visibility = 'private' AND owner_id = $${paramIdx + 1}))`;
  }

  const result = await query(`
    UPDATE knowledge_facts SET ${updates.join(', ')} WHERE id = $${paramIdx}${visClause}
    RETURNING id
  `, params);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Fact not found' });
  }

  logger.info({ adminId: tenantId, factId: id }, 'Admin updated fact');

  return { success: true };
});

// Admin: Delete fact
app.delete('/api/v1/admin/facts/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  // Scope: admin can delete public/unowned facts, or their own private facts
  let delParams: unknown[];
  let delClause: string;
  if (tenantId === 'tenant_system') {
    delParams = [id];
    delClause = `DELETE FROM knowledge_facts WHERE id = $1 RETURNING id`;
  } else {
    delParams = [id, tenantId];
    delClause = `DELETE FROM knowledge_facts WHERE id = $1 AND (visibility = 'public' OR owner_id IS NULL OR (visibility = 'private' AND owner_id = $2)) RETURNING id`;
  }

  const result = await query(delClause, delParams);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Fact not found' });
  }

  logger.info({ adminId: tenantId, factId: id }, 'Admin deleted fact');

  return { success: true };
});

// ===========================================
// CONTEXT (WORKING MEMORY) ENDPOINTS
// ===========================================

// Get context detail
app.get('/api/v1/contexts/:id', async (request, reply) => {
  const { id } = request.params as { id: string };

  const [context] = await query<Record<string, unknown>>(`
    SELECT
      id, session_id, agent_id, raw_content, content_type,
      extracted_facts, extracted_entities, noise_removed,
      status, original_tokens, liquidated_tokens, compression_ratio,
      ttl_seconds, expires_at, created_at, updated_at
    FROM working_contexts
    WHERE id = $1
  `, [id]);

  if (!context) {
    return reply.status(404).send({ success: false, error: 'Context not found' });
  }

  return {
    context: {
      id: context['id'],
      sessionId: context['session_id'],
      agentId: context['agent_id'],
      rawContent: context['raw_content'],
      contentType: context['content_type'],
      extractedFacts: context['extracted_facts'],
      extractedEntities: context['extracted_entities'],
      noiseRemoved: context['noise_removed'],
      status: context['status'],
      originalTokens: context['original_tokens'],
      liquidatedTokens: context['liquidated_tokens'],
      compressionRatio: context['compression_ratio'],
      ttlSeconds: context['ttl_seconds'],
      expiresAt: context['expires_at'],
      createdAt: context['created_at'],
      updatedAt: context['updated_at'],
    },
  };
});

// Admin: Liquidate context
app.post('/api/v1/admin/contexts/:id/liquidate', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  const result = await query(`
    UPDATE working_contexts SET status = 'liquidated', updated_at = NOW()
    WHERE id = $1 RETURNING id
  `, [id]);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Context not found' });
  }

  logger.info({ adminId: tenantId, contextId: id }, 'Admin liquidated context');

  return { success: true, status: 'liquidated' };
});

// Admin: Delete context
app.delete('/api/v1/admin/contexts/:id', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };

  const tenantId = req.tenant?.tenantId;
  if (!tenantId) {
    return reply.status(401).send({ success: false, error: 'Authentication required' });
  }

  // Check admin role
  const [user] = await query<{ role: string }>(`
    SELECT role FROM users WHERE tenant_id = $1
  `, [tenantId]);

  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    return reply.status(403).send({ success: false, error: 'Admin access required' });
  }

  const result = await query(`DELETE FROM working_contexts WHERE id = $1 RETURNING id`, [id]);

  if (result.length === 0) {
    return reply.status(404).send({ success: false, error: 'Context not found' });
  }

  logger.info({ adminId: tenantId, contextId: id }, 'Admin deleted context');

  return { success: true };
});

// Execute a shard (tenant-aware)
app.post('/api/v1/execute', async (request) => {
  const req = request as AuthenticatedRequest;
  const { input, shardId, includeAll, sessionId } = request.body as {
    input: string;
    shardId?: string;
    includeAll?: boolean;
    sessionId?: string;
  };

  // Validate input - reject empty or whitespace-only inputs
  if (!input || typeof input !== 'string') {
    return {
      success: false,
      error: 'Input is required',
      code: 'MISSING_INPUT',
    };
  }

  const trimmedInput = input.trim();
  if (trimmedInput.length === 0) {
    return {
      success: false,
      error: 'Input cannot be empty or whitespace-only',
      code: 'EMPTY_INPUT',
    };
  }

  // Build tenant context for visibility filtering
  const tenantContext = req.tenant;

  // Check daily execution limit based on user's plan
  if (tenantContext?.tenantId) {
    const [limitData] = await query<{ executions_today: string; daily_limit: number }>(`
      SELECT
        (SELECT COUNT(*) FROM shard_executions se
         JOIN procedural_shards ps ON se.shard_id = ps.id
         WHERE ps.owner_id = $1 AND se.created_at >= CURRENT_DATE) as executions_today,
        COALESCE((
          SELECT (p.limits->>'executions_per_day')::int
          FROM subscriptions s
          JOIN plans p ON s.plan_id = p.id
          WHERE s.tenant_id = $1 AND s.status = 'active'
          ORDER BY s.created_at DESC LIMIT 1
        ), 200) as daily_limit
    `, [tenantContext.tenantId]);

    const executionsToday = parseInt(limitData?.executions_today ?? '0', 10);
    const dailyLimit = limitData?.daily_limit ?? 200;

    // -1 means unlimited
    if (dailyLimit !== -1 && executionsToday >= dailyLimit) {
      return {
        success: false,
        error: `Daily execution limit reached (${dailyLimit}/day). Upgrade your plan for more executions.`,
        code: 'DAILY_LIMIT_EXCEEDED',
        usage: {
          used: executionsToday,
          limit: dailyLimit,
          resetsAt: 'midnight UTC'
        }
      };
    }
  }

  let shard;
  let matchMethod = 'none';

  if (shardId) {
    shard = await procedural.getShardById(shardId);
    matchMethod = 'direct';
  } else {
    // Strategy 0: Template pattern matching (MOST RELIABLE)
    // Use template-style pattern_hash values like "what is {percent}% of {number}?"
    // Use cached shards for fast pattern matching (30s TTL)
    // Matches are scored by specificity: more literal characters = more specific = preferred
    const allShards = await getCachedShards(includeAll ?? true, tenantContext);
    let bestPatternMatch: { shard: typeof allShards[0]; specificity: number } | null = null;
    for (const candidate of allShards) {
      try {
        // Check if patternHash looks like a template (contains {placeholder})
        if (candidate.patternHash && candidate.patternHash.includes('{')) {
          // Normalize: strip trailing ? from template
          const template = candidate.patternHash.replace(/\?$/, '');
          // Calculate specificity: count literal characters (non-placeholder text)
          const literalChars = template.replace(/\{[^}]+\}/g, '').length;
          // Skip pure-placeholder templates with no literal anchors (too greedy)
          if (literalChars === 0) continue;
          // Convert template to regex: escape special chars, replace {name} with capture groups
          let pattern = template
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')  // Escape regex special chars
            .replace(/\\{[^}]+\\}/g, '(.+?)');       // Replace \{...\} with capture group
          const regex = new RegExp('^' + pattern + '\\??$', 'i');  // Optional trailing ?
          if (regex.test(input)) {
            if (!bestPatternMatch || literalChars > bestPatternMatch.specificity) {
              bestPatternMatch = { shard: candidate, specificity: literalChars };
            }
          }
        }
      } catch {
        // Skip shards with invalid patterns
      }
    }
    if (bestPatternMatch) {
      shard = bestPatternMatch.shard;
      matchMethod = 'pattern';
    }

    // Strategy 1: Intent-based matching (fallback)
    if (!shard) {
      const intent = await extractIntent(input, '');
      shard = await procedural.findShardByIntentTemplate(intent.template, includeAll ?? true, 0.55, tenantContext);
      if (shard) {
        matchMethod = 'intent';
      }
    }

    // Strategy 2: Embedding similarity (last resort)
    if (!shard) {
      const embedding = await generateEmbedding(input);
      const matches = await procedural.findSimilarShardsByEmbedding(embedding, 0.4, 1, includeAll ?? true, tenantContext);
      shard = matches[0];
      if (shard) {
        matchMethod = 'embedding';
      }
    }
  }

  if (!shard) {
    // Record failed match as episode (fire and forget - don't block response)
    const episodeOptions = tenantContext
      ? { tenant: tenantContext, visibility: 'private' as const }
      : { visibility: 'public' as const };

    void episodic.recordEpisode({
      situation: {
        context: `User request: ${input.substring(0, 200)}`,
        entities: ['shard_matching'],
        state: { includeAll: includeAll ?? true },
      },
      action: {
        type: 'shard_lookup',
        description: 'Attempted to find matching procedural shard',
        parameters: { input: input.substring(0, 100) },
      },
      outcome: {
        result: 'No matching shard found',
        success: false,
        effects: ['fallback_required'],
        metrics: {},
      },
      type: 'shard_miss',
      summary: `No shard matched: "${input.substring(0, 50)}..."`,
      success: false,
      valence: 'negative',
      importance: 0.6,
      lessonsLearned: [],
      sessionId,
      metadata: {},
      timestamp: new Date(),
    }, episodeOptions).catch(err => logger.error({ err }, 'Failed to record episode'));

    return { success: false, error: 'No matching shard found', method: 'none' };
  }

  // Execute in sandbox
  const result = await execute(shard.logic, input);

  // Record execution in procedural memory (fire and forget - don't block response)
  void procedural.recordExecution(
    shard.id,
    result.success,
    result.executionMs,
    result.success ? 45 : 0,
    tenantContext?.tenantId
  ).catch(err => logger.error({ err }, 'Failed to record execution'));

  // Record episode in episodic memory (fire and forget - embedding generation is slow)
  // Build episode options for tenant context
  const execEpisodeOptions = tenantContext
    ? { tenant: tenantContext, visibility: 'private' as const }
    : { visibility: 'public' as const };

  // Generate episode ID upfront so we can return it immediately
  const episodeId = ids.episode();

  void episodic.recordEpisode({
    situation: {
      context: `User request: ${input.substring(0, 200)}`,
      entities: [shard.name, matchMethod],
      state: { shardConfidence: shard.confidence, lifecycle: shard.lifecycle },
    },
    action: {
      type: 'shard_execution',
      description: `Executed shard: ${shard.name}`,
      parameters: { input: input.substring(0, 100), matchMethod },
    },
    outcome: {
      result: result.success
        ? `Success: ${String(result.output).substring(0, 100)}`
        : `Failed: ${result.error}`,
      success: result.success,
      effects: result.success ? ['tokens_saved', 'user_served'] : ['error_returned'],
      metrics: { executionMs: result.executionMs },
    },
    type: 'shard_execution',
    summary: result.success
      ? `${shard.name} executed successfully (${result.executionMs}ms)`
      : `${shard.name} failed: ${result.error}`,
    success: result.success,
    valence: result.success ? 'positive' : 'negative',
    importance: result.success ? 0.4 : 0.7,
    lessonsLearned: result.success ? [] : [`Shard ${shard.name} failed on input pattern`],
    sessionId,
    relatedShardId: shard.id,
    metadata: { matchMethod },
    timestamp: new Date(),
  }, execEpisodeOptions).catch(err => logger.error({ err }, 'Failed to record episode'));

  // Calculate environmental savings based on actual output length
  const outputStr = String(result.output || '');
  const estimatedLlmTokens = Math.ceil(((input.length + outputStr.length) / 4) * 2);
  const tokensSaved = shard.estimatedTokens > 0 ? shard.estimatedTokens : Math.max(50, estimatedLlmTokens);
  const waterMlSaved = Math.round((tokensSaved / 1000) * 500);
  const powerWhSaved = parseFloat(((tokensSaved / 1000) * 10).toFixed(2));
  const carbonGSaved = parseFloat(((tokensSaved / 1000) * 5).toFixed(2));

  return {
    success: result.success,
    output: result.output,
    error: result.error,
    method: 'shard',
    matchMethod,
    shardId: shard.id,
    shardName: shard.name,
    executionMs: result.executionMs,
    episodeId,
    environmental: {
      tokensSaved,
      waterMlSaved,
      powerWhSaved,
      carbonGSaved,
    },
  };
});

// Execute a specific shard by ID (tenant-aware)
app.post('/api/v1/shards/:id/execute', async (request, reply) => {
  const req = request as AuthenticatedRequest;
  const { id } = request.params as { id: string };
  const { input } = request.body as { input: string };

  if (!input || typeof input !== 'string' || input.trim().length === 0) {
    return reply.status(400).send({
      success: false,
      error: 'Input is required',
      code: 'MISSING_INPUT',
    });
  }

  const tenantContext = req.tenant;

  // Get the shard
  const shard = await procedural.getShardById(id);
  if (!shard) {
    return reply.status(404).send({
      success: false,
      error: 'Shard not found',
      code: 'SHARD_NOT_FOUND',
    });
  }

  // Check visibility - private shards only accessible by owner
  if (shard.visibility === 'private' && shard.ownerId !== tenantContext?.tenantId) {
    return reply.status(403).send({
      success: false,
      error: 'Access denied to private shard',
      code: 'ACCESS_DENIED',
    });
  }

  // Execute in sandbox
  const result = await execute(shard.logic, input);

  // Record execution with tenant tracking
  void procedural.recordExecution(
    shard.id,
    result.success,
    result.executionMs,
    result.success ? 45 : 0,
    tenantContext?.tenantId
  ).catch(err => logger.error({ err }, 'Failed to record execution'));

  return {
    success: result.success,
    output: result.output,
    error: result.error,
    shardId: shard.id,
    shardName: shard.name,
    executionMs: result.executionMs,
  };
});

// Batch execute multiple inputs (tenant-aware)
app.post('/api/v1/execute/batch', async (request) => {
  const req = request as AuthenticatedRequest;
  const { inputs, sessionId } = request.body as {
    inputs: Array<{ input: string; shardId?: string }>;
    sessionId?: string;
  };

  if (!inputs || !Array.isArray(inputs) || inputs.length === 0) {
    return {
      success: false,
      error: 'inputs array is required',
      code: 'MISSING_INPUTS',
    };
  }

  if (inputs.length > 50) {
    return {
      success: false,
      error: 'Maximum 50 inputs per batch',
      code: 'BATCH_TOO_LARGE',
    };
  }

  // Build tenant context for visibility filtering
  const tenantContext = req.tenant;

  const results = [];
  let totalExecutionMs = 0;
  let successCount = 0;

  for (const item of inputs) {
    const startTime = Date.now();

    // Validate input
    if (!item.input || typeof item.input !== 'string' || item.input.trim().length === 0) {
      results.push({
        input: item.input,
        success: false,
        error: 'Empty or invalid input',
        executionMs: 0,
      });
      continue;
    }

    let shard;
    let matchMethod = 'none';

    if (item.shardId) {
      shard = await procedural.getShardById(item.shardId);
      matchMethod = 'direct';
    } else {
      const intent = await extractIntent(item.input, '');
      shard = await procedural.findShardByIntentTemplate(intent.template, false, 0.55, tenantContext);
      if (shard) {
        matchMethod = 'intent';
      } else {
        const embedding = await generateEmbedding(item.input);
        const matches = await procedural.findSimilarShardsByEmbedding(embedding, 0.4, 1, false, tenantContext);
        shard = matches[0];
        if (shard) matchMethod = 'embedding';
      }
    }

    if (!shard) {
      results.push({
        input: item.input.substring(0, 50),
        success: false,
        error: 'No matching shard found',
        matchMethod: 'none',
        executionMs: Date.now() - startTime,
      });
      continue;
    }

    const result = await execute(shard.logic, item.input);
    const executionMs = Date.now() - startTime;
    totalExecutionMs += executionMs;

    if (result.success) {
      successCount++;
      await procedural.recordExecution(shard.id, true, result.executionMs, 45, tenantContext?.tenantId);
    }

    results.push({
      input: item.input.substring(0, 50),
      success: result.success,
      output: result.output,
      error: result.error,
      shardId: shard.id,
      shardName: shard.name,
      matchMethod,
      executionMs,
    });
  }

  return {
    success: successCount > 0,
    totalInputs: inputs.length,
    successCount,
    failureCount: inputs.length - successCount,
    totalExecutionMs,
    avgExecutionMs: Math.round(totalExecutionMs / inputs.length),
    results,
  };
});

// Ingest a trace (tenant-aware, rate-throttled for abuse prevention)
app.post('/api/v1/traces', { preHandler: traceRateLimit }, async (request) => {
  const req = request as AuthenticatedRequest;
  const { input, output, reasoning, tokensUsed, model, sessionId, visibility } = request.body as {
    input: string;
    output: string;
    reasoning?: string;
    tokensUsed?: number;
    model?: string;
    sessionId?: string;
    visibility?: 'public' | 'private';
  };

  const { query } = await import('@substrate/database');
  const { generateEmbedding, extractIntent, hashIntentTemplate } = await import('@substrate/ai');
  const { generatePatternHash, ids } = await import('@substrate/core');

  const startMs = Date.now();
  const id = ids.trace();

  // Extract intent template - this is the KEY for proper clustering
  const intent = await extractIntent(input, output);
  const intentHash = hashIntentTemplate(intent.template);

  // Legacy pattern hash for backwards compatibility
  const patternHash = generatePatternHash(input, output);

  // Generate embedding for similarity search
  const embedding = await generateEmbedding(`${input} ${output}`);

  const executionMs = Date.now() - startMs;

  // Determine owner and visibility
  const ownerId = req.tenant?.tenantId !== 'tenant_system' ? req.tenant?.tenantId : null;
  const traceVisibility = visibility ?? 'private'; // Traces default to private

  await query(
    `INSERT INTO reasoning_traces (
      id, input, output, reasoning, pattern_hash, embedding,
      intent_template, intent_category, intent_name, intent_parameters,
      tokens_used, execution_ms, model, session_id, owner_id, visibility, timestamp
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())`,
    [
      id,
      input,
      output,
      reasoning,
      patternHash,
      `[${embedding.join(',')}]`,
      intent.template,
      intent.category,
      intent.intentName,
      JSON.stringify(intent.parameters),
      tokensUsed ?? 0,
      executionMs,
      model ?? null,
      sessionId ?? null,
      ownerId,
      traceVisibility,
    ]
  );

  return { id, intentTemplate: intent.template, intentHash, patternHash, ownerId };
});

// List traces (for Memory Workbench)
app.get('/api/v1/traces', async (request) => {
  const req = request as AuthenticatedRequest;
  const { limit = 100, offset = 0, category } = request.query as { limit?: number; offset?: number; category?: string };
  const { query } = await import('@substrate/database');

  const tenantId = req.tenant?.tenantId ?? 'tenant_system';

  // Build query with optional category filter
  let sql = `
    SELECT
      id,
      input,
      output,
      intent_template as "intentTemplate",
      intent_category as "intentCategory",
      intent_name as "intentName",
      tokens_used as "tokensUsed",
      model,
      session_id as "sessionId",
      visibility,
      synthesized,
      timestamp
    FROM reasoning_traces
    WHERE (owner_id = $1 OR owner_id IS NULL OR visibility = 'public')
  `;
  const params: (string | number)[] = [tenantId];

  if (category) {
    sql += ` AND intent_category = $${params.length + 1}`;
    params.push(category);
  }

  // Count query (same WHERE, no limit/offset)
  const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as count FROM');
  const countResult = await query<Record<string, unknown>>(countSql, params);
  const total = parseInt(String((countResult[0] as Record<string, unknown>)['count'] || '0'), 10);

  sql += ` ORDER BY timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(Number(limit), Number(offset));

  const traces = await query<{
    id: string;
    input: string;
    output: string;
    intentTemplate: string;
    intentCategory: string;
    intentName: string;
    tokensUsed: number;
    model: string | null;
    sessionId: string | null;
    visibility: string;
    synthesized: boolean;
    timestamp: Date;
  }>(sql, params);

  return { traces, total, limit: Number(limit), offset: Number(offset) };
});

// Trigger metabolic cycles manually (for testing)
app.post('/api/v1/metabolic/crystallize', { preHandler: requireAdminAuth }, async (request) => {
  const { minTracesPerCluster } = request.body as { minTracesPerCluster?: number } || {};
  const { runCrystallizeCycle } = await import('@substrate/metabolic');
  const result = await runCrystallizeCycle({
    minTracesPerCluster: minTracesPerCluster ?? 2,
  });
  return result;
});

app.post('/api/v1/metabolic/decay', { preHandler: requireAdminAuth }, async () => {
  const { runDecayCycle } = await import('@substrate/metabolic');
  const result = await runDecayCycle();
  return result;
});

app.post('/api/v1/metabolic/promote', { preHandler: requireAdminAuth }, async () => {
  const { runPromoteCycle } = await import('@substrate/metabolic');
  const result = await runPromoteCycle();
  return result;
});

app.post('/api/v1/metabolic/lessons', { preHandler: requireAdminAuth }, async () => {
  const { runLessonExtractionCycle } = await import('@substrate/metabolic');
  const result = await runLessonExtractionCycle();
  return result;
});

app.post('/api/v1/metabolic/evolve', { preHandler: requireAdminAuth }, async () => {
  const { runEvolveCycle } = await import('@substrate/metabolic');
  const result = await runEvolveCycle();
  return result;
});

// Reseed preview - shows what would be affected
app.get('/api/v1/metabolic/reseed/preview', { preHandler: requireAdminAuth }, async (request) => {
  const { preserveHighConfidence, confidenceThreshold } = request.query as {
    preserveHighConfidence?: string;
    confidenceThreshold?: string;
  };

  const { getReseedPreview } = await import('@substrate/metabolic');
  const result = await getReseedPreview({
    preserveHighConfidence: preserveHighConfidence !== 'false',
    confidenceThreshold: confidenceThreshold ? parseFloat(confidenceThreshold) : 0.8,
  });
  return result;
});

// Soft reseed - keeps promoted shards
app.post('/api/v1/metabolic/reseed/soft', { preHandler: requireAdminAuth }, async () => {
  const { runSoftReseed } = await import('@substrate/metabolic');
  const result = await runSoftReseed();
  return result;
});

// Full reseed - DANGEROUS: resets procedural memory
app.post('/api/v1/metabolic/reseed/full', { preHandler: requireAdminAuth }, async (request) => {
  const { confirm, preserveHighConfidence, confidenceThreshold } = request.body as {
    confirm?: string;
    preserveHighConfidence?: boolean;
    confidenceThreshold?: number;
  };

  if (confirm !== 'RESEED_CONFIRMED') {
    return {
      error: 'Full reseed requires confirmation',
      message: 'Send { "confirm": "RESEED_CONFIRMED" } to proceed',
    };
  }

  const { runFullReseed } = await import('@substrate/metabolic');
  const result = await runFullReseed({
    preserveHighConfidence: preserveHighConfidence ?? true,
    confidenceThreshold: confidenceThreshold ?? 0.8,
  });
  return result;
});

// Re-cluster traces without deleting shards
app.post('/api/v1/metabolic/recluster', { preHandler: requireAdminAuth }, async () => {
  const { reClusterTraces } = await import('@substrate/metabolic');
  const result = await reClusterTraces();
  return result;
});

// Migrate non-hybrid shards to hybrid synthesis
app.post('/api/v1/metabolic/migrate-hybrid', { preHandler: requireAdminAuth }, async () => {
  const { migrateToHybrid } = await import('@substrate/metabolic');
  const result = await migrateToHybrid();
  return result;
});

// ===========================================
// ADMIN: Cycle History & Worker Health
// ===========================================

// Cycle run history from metacognition_events
app.get('/api/v1/admin/cycle-history', { preHandler: requireAdminAuth }, async (request) => {
  const { limit = 50, type } = request.query as { limit?: number; type?: string };

  let sql = `
    SELECT id, event_type, analysis, success, processing_time_ms, created_at
    FROM metacognition_events
  `;
  const params: unknown[] = [];

  if (type) {
    sql += ' WHERE event_type = $1 ORDER BY created_at DESC LIMIT $2';
    params.push(type, Number(limit));
  } else {
    sql += ' ORDER BY created_at DESC LIMIT $1';
    params.push(Number(limit));
  }

  const runs = await query<{
    id: string;
    event_type: string;
    analysis: Record<string, unknown> | null;
    success: boolean | null;
    processing_time_ms: number | null;
    created_at: string;
  }>(sql, params);

  return {
    runs: runs.map((r) => ({
      id: r.id,
      event_type: r.event_type,
      analysis: r.analysis,
      success: r.success,
      processing_time_ms: r.processing_time_ms,
      created_at: r.created_at,
    })),
  };
});

// Worker health proxy (avoids exposing port 8081 to frontend)
app.get('/api/v1/admin/worker-health', { preHandler: requireAdminAuth }, async (_request, reply) => {
  try {
    const workerUrl = process.env['WORKER_HEALTH_URL'] || 'http://substrate-prod-worker:8081/health';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(workerUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    return data;
  } catch (err) {
    return reply.code(503).send({
      status: 'unreachable',
      error: err instanceof Error ? err.message : 'Worker health check failed',
    });
  }
});

// ===========================================
// EPISODIC MEMORY (SAO Chains)
// ===========================================

// Record an episode (tenant-aware)
app.post('/api/v1/episodes', async (request) => {
  const req = request as AuthenticatedRequest;
  const body = request.body as {
    situation: { context: string; entities?: string[]; state?: Record<string, unknown> };
    action: { type: string; description: string; parameters?: Record<string, unknown>; reasoning?: string };
    outcome: { result: string; success?: boolean; effects?: string[]; metrics?: Record<string, number> };
    type: string;
    summary: string;
    lessonsLearned?: string[];
    importance?: number;
    sessionId?: string;
    relatedShardId?: string;
    parentEpisodeId?: string;
    visibility?: 'public' | 'private';
  };

  const { episodic } = await import('@substrate/memory');

  // Build episode options for tenant context
  const tenantContext = req.tenant;
  const episodeVisibility = body.visibility ?? 'private';
  const options = tenantContext
    ? { tenant: tenantContext, visibility: episodeVisibility }
    : { visibility: 'public' as const };

  const episode = await episodic.recordEpisode({
    situation: {
      context: body.situation.context,
      entities: body.situation.entities ?? [],
      state: body.situation.state ?? {},
    },
    action: {
      type: body.action.type,
      description: body.action.description,
      parameters: body.action.parameters ?? {},
      reasoning: body.action.reasoning,
    },
    outcome: {
      result: body.outcome.result,
      success: body.outcome.success,
      effects: body.outcome.effects ?? [],
      metrics: body.outcome.metrics ?? {},
    },
    type: body.type,
    summary: body.summary,
    success: body.outcome.success,
    valence: body.outcome.success ? 'positive' : (body.outcome.success === false ? 'negative' : 'neutral'),
    importance: body.importance ?? 0.5,
    lessonsLearned: body.lessonsLearned ?? [],
    sessionId: body.sessionId,
    relatedShardId: body.relatedShardId,
    parentEpisodeId: body.parentEpisodeId,
    metadata: {},
    timestamp: new Date(),
  }, options);

  return {
    id: episode.id,
    summary: episode.summary,
    type: episode.type,
    success: episode.success,
  };
});

// Find similar episodes (tenant-aware)
app.get('/api/v1/episodes/similar', async (request) => {
  const req = request as AuthenticatedRequest;
  const { q, limit } = request.query as { q: string; limit?: string };

  if (!q) {
    return { error: 'Query parameter q is required' };
  }

  const { episodic } = await import('@substrate/memory');
  const episodes = await episodic.findSimilarEpisodes(q, parseInt(limit ?? '5', 10), req.tenant);

  return {
    episodes: episodes.map(e => ({
      id: e.id,
      summary: e.summary,
      type: e.type,
      success: e.success,
      valence: e.valence,
      importance: e.importance,
      lessonsLearned: e.lessonsLearned,
      timestamp: e.timestamp,
    })),
  };
});

// Get episode chain
app.get('/api/v1/episodes/:id/chain', async (request) => {
  const { id } = request.params as { id: string };

  const { episodic } = await import('@substrate/memory');
  const chain = await episodic.getEpisodeChain(id);

  return {
    chain: chain.map(e => ({
      id: e.id,
      summary: e.summary,
      situation: e.situation,
      action: e.action,
      outcome: e.outcome,
      timestamp: e.timestamp,
    })),
  };
});

// List recent episodes
app.get('/api/v1/episodes', async (request) => {
  const { limit, type, valence, offset } = request.query as { limit?: string; type?: string; valence?: string; offset?: string };
  const { query } = await import('@substrate/database');

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (type) {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }

  if (valence && valence !== 'all') {
    params.push(valence);
    conditions.push(`valence = $${params.length}`);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countRows = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM episodes${where}`, params);
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const limitNum = parseInt(limit ?? '20', 10);
  const offsetNum = parseInt(offset ?? '0', 10);

  params.push(limitNum);
  params.push(offsetNum);

  const sql = `SELECT id, summary, type, success, valence, importance, timestamp, created_at
               FROM episodes${where}
               ORDER BY timestamp DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const rows = await query<Record<string, unknown>>(sql, params);

  return {
    total,
    episodes: rows.map(r => ({
      id: r['id'],
      summary: r['summary'],
      type: r['type'],
      success: r['success'],
      valence: r['valence'],
      importance: r['importance'],
      timestamp: r['timestamp'],
    })),
  };
});

// ===========================================
// SEMANTIC MEMORY (Truth Store)
// ===========================================

// Add a fact (tenant-aware)
app.post('/api/v1/facts', async (request) => {
  const req = request as AuthenticatedRequest;
  const body = request.body as {
    subject: string;
    predicate: string;
    object: string;
    statement: string;
    confidence?: number;
    sources?: string[];
    evidence?: Array<Record<string, unknown>>;
    category?: string;
    isTemporal?: boolean;
    validFrom?: string;
    validUntil?: string;
    visibility?: 'public' | 'private';
  };

  // Check if tenant can create private facts
  const factVisibility = body.visibility ?? 'public';
  if (factVisibility === 'private' && req.tenant) {
    const canCreate = await canCreatePrivateFact(req.tenant);
    if (!canCreate) {
      return {
        error: 'Private fact limit reached',
        code: 'LIMIT_REACHED',
        hint: 'Upgrade to Pro tier for more private facts',
      };
    }
  }

  const { semantic } = await import('@substrate/memory');

  // Build options for tenant context
  const tenantContext = req.tenant;
  const options = tenantContext
    ? { tenant: tenantContext, visibility: factVisibility }
    : { visibility: 'public' as const };

  const fact = await semantic.storeFact({
    subject: body.subject,
    predicate: body.predicate,
    object: body.object,
    statement: body.statement,
    confidence: body.confidence ?? 0.7,
    sources: body.sources ?? [],
    evidence: body.evidence ?? [],
    category: body.category,
    isTemporal: body.isTemporal ?? false,
    validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
    validUntil: body.validUntil ? new Date(body.validUntil) : undefined,
  }, options);

  return {
    id: fact.id,
    statement: fact.statement,
    confidence: fact.confidence,
    visibility: factVisibility,
  };
});

// Verify a claim against the truth store (tenant-aware)
app.post('/api/v1/facts/verify', async (request) => {
  const req = request as AuthenticatedRequest;
  const { claim } = request.body as { claim: string };

  if (!claim) {
    return { error: 'Claim is required' };
  }

  const { semantic } = await import('@substrate/memory');
  const result = await semantic.verifyClaim(claim, req.tenant);

  return {
    verified: result.verified,
    confidence: result.confidence,
    supportingFacts: result.supportingFacts.map(f => ({
      id: f.id,
      statement: f.statement,
      confidence: f.confidence,
    })),
  };
});

// Search facts (tenant-aware)
app.get('/api/v1/facts/search', async (request) => {
  const req = request as AuthenticatedRequest;
  const { q, limit } = request.query as { q: string; limit?: string };

  if (!q) {
    return { error: 'Query parameter q is required' };
  }

  const { semantic } = await import('@substrate/memory');
  const facts = await semantic.findSimilarFacts(q, parseInt(limit ?? '10', 10), req.tenant);

  return {
    facts: facts.map(f => ({
      id: f.id,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      statement: f.statement,
      confidence: f.confidence,
      category: f.category,
    })),
  };
});

// Get facts by subject (tenant-aware)
app.get('/api/v1/facts/subject/:subject', async (request) => {
  const req = request as AuthenticatedRequest;
  const { subject } = request.params as { subject: string };

  const { semantic } = await import('@substrate/memory');
  const facts = await semantic.getFactsBySubject(subject, req.tenant);

  return {
    facts: facts.map(f => ({
      id: f.id,
      subject: f.subject,
      predicate: f.predicate,
      object: f.object,
      statement: f.statement,
      confidence: f.confidence,
    })),
  };
});

// List all facts
// Get distinct fact categories
app.get('/api/v1/facts/categories', async () => {
  const { query } = await import('@substrate/database');
  const rows = await query<{ category: string; count: string }>(
    `SELECT category, COUNT(*)::text as count FROM knowledge_facts
     WHERE category IS NOT NULL AND category != '' AND visibility = 'public'
     GROUP BY category ORDER BY count DESC`
  );
  return { categories: rows.map(r => ({ value: r.category, count: parseInt(r.count, 10) })) };
});

app.get('/api/v1/facts', async (request) => {
  const { limit, category, offset } = request.query as { limit?: string; category?: string; offset?: string };
  const { query } = await import('@substrate/database');

  const conditions: string[] = ["visibility = 'public'"];
  const params: unknown[] = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }

  const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';

  // Count total
  const countRows = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM knowledge_facts${where}`, params);
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const limitNum = parseInt(limit ?? '20', 10);
  const offsetNum = parseInt(offset ?? '0', 10);

  params.push(limitNum);
  params.push(offsetNum);

  const sql = `SELECT id, subject, predicate, object, statement, confidence, category, created_at
               FROM knowledge_facts${where}
               ORDER BY confidence DESC, created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const rows = await query<Record<string, unknown>>(sql, params);

  return {
    total,
    facts: rows.map(r => ({
      id: r['id'],
      subject: r['subject'],
      predicate: r['predicate'],
      object: r['object'],
      statement: r['statement'],
      confidence: r['confidence'],
      category: r['category'],
      createdAt: r['created_at'],
    })),
  };
});

// ===========================================
// TIER 4: WORKING MEMORY (Context Liquidation)
// ===========================================

// Create a working context (tenant-aware)
app.post('/api/v1/contexts', async (request) => {
  const req = request as AuthenticatedRequest;
  const body = request.body as {
    sessionId: string;
    rawContent: string;
    contentType: string;
    agentId?: string;
    ttlSeconds?: number;
    originalTokens?: number;
    visibility?: 'public' | 'private';
  };

  const { working } = await import('@substrate/memory');

  // Build context options for tenant
  const tenantContext = req.tenant;
  const contextVisibility = body.visibility ?? 'private';
  const options = tenantContext
    ? { tenant: tenantContext, visibility: contextVisibility }
    : { visibility: 'private' as const };

  const context = await working.createContext({
    sessionId: body.sessionId,
    rawContent: body.rawContent,
    contentType: body.contentType,
    agentId: body.agentId,
    ttlSeconds: body.ttlSeconds ?? 3600,
    originalTokens: body.originalTokens ?? Math.ceil(body.rawContent.length / 4),
    extractedFacts: [],
    extractedEntities: [],
    noiseRemoved: [],
  }, options);

  return {
    id: context.id,
    sessionId: context.sessionId,
    status: context.status,
    expiresAt: context.expiresAt,
  };
});

// List recent working contexts (for browsing without knowing session ID)
app.get('/api/v1/contexts', async (request) => {
  const { limit = '20', status, contentType, includeExpired = 'true', offset = '0' } = request.query as {
    limit?: string;
    status?: string;
    contentType?: string;
    includeExpired?: string;
    offset?: string;
  };

  // Build query with optional filters
  // By default include expired contexts for historical viewing
  const showExpired = includeExpired !== 'false';
  const baseWhere = showExpired ? '1=1' : '(expires_at IS NULL OR expires_at > NOW())';
  const conditions: string[] = [baseWhere];
  const params: (string | number)[] = [];
  let paramIndex = 1;

  if (status) {
    conditions.push(`status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (contentType) {
    conditions.push(`content_type = $${paramIndex}`);
    params.push(contentType);
    paramIndex++;
  }

  const where = ` WHERE ${conditions.join(' AND ')}`;

  // Count total
  const countRows = await query<{ count: string }>(`SELECT COUNT(*)::text as count FROM working_contexts${where}`, params);
  const total = parseInt(countRows[0]?.count ?? '0', 10);

  const limitNum = Math.min(parseInt(limit) || 20, 100);
  const offsetNum = parseInt(offset) || 0;

  params.push(limitNum);
  params.push(offsetNum);

  const sql = `SELECT id, session_id, agent_id, content_type, status,
             SUBSTRING(raw_content, 1, 200) as raw_content_preview,
             original_tokens, liquidated_tokens, compression_ratio,
             ttl_seconds, expires_at, created_at
     FROM working_contexts${where}
     ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;

  const rows = await query<{
    id: string;
    session_id: string;
    agent_id: string | null;
    content_type: string;
    status: string;
    raw_content_preview: string;
    original_tokens: number | null;
    liquidated_tokens: number | null;
    compression_ratio: number | null;
    ttl_seconds: number | null;
    expires_at: string | null;
    created_at: string;
  }>(sql, params);

  // Group by session for easier browsing
  const sessions = new Map<string, typeof rows>();
  for (const row of rows) {
    const existing = sessions.get(row.session_id) || [];
    existing.push(row);
    sessions.set(row.session_id, existing);
  }

  return {
    total,
    contexts: rows.map(c => ({
      id: c.id,
      sessionId: c.session_id,
      agentId: c.agent_id,
      contentType: c.content_type,
      status: c.status,
      rawContentPreview: c.raw_content_preview,
      originalTokens: c.original_tokens,
      liquidatedTokens: c.liquidated_tokens,
      compressionRatio: c.compression_ratio,
      ttlSeconds: c.ttl_seconds,
      expiresAt: c.expires_at,
      createdAt: c.created_at,
    })),
    sessions: Array.from(sessions.keys()).map(sessionId => ({
      sessionId,
      contextCount: sessions.get(sessionId)?.length || 0,
      latestCreatedAt: sessions.get(sessionId)?.[0]?.created_at,
    })),
  };
});

// Get session contexts
app.get('/api/v1/contexts/session/:sessionId', async (request) => {
  const { sessionId } = request.params as { sessionId: string };
  const { status: statusFilter } = request.query as { status?: string };

  let sql = `SELECT id, session_id, agent_id, content_type, status,
       SUBSTRING(raw_content, 1, 200) as raw_content_preview,
       original_tokens, liquidated_tokens, compression_ratio,
       ttl_seconds, expires_at, created_at
     FROM working_contexts
     WHERE session_id = $1
       AND (expires_at IS NULL OR expires_at > NOW())`;
  const params: (string | number)[] = [sessionId];

  if (statusFilter) {
    sql += ` AND status = $${params.length + 1}`;
    params.push(statusFilter);
  }

  sql += ` ORDER BY created_at DESC LIMIT 50`;

  const rows = await query<{
    id: string;
    session_id: string;
    agent_id: string | null;
    content_type: string;
    status: string;
    raw_content_preview: string;
    original_tokens: number | null;
    liquidated_tokens: number | null;
    compression_ratio: number | null;
    ttl_seconds: number | null;
    expires_at: string | null;
    created_at: string;
  }>(sql, params);

  return {
    contexts: rows.map(c => ({
      id: c.id,
      sessionId: c.session_id,
      agentId: c.agent_id,
      contentType: c.content_type,
      status: c.status,
      rawContentPreview: c.raw_content_preview,
      originalTokens: c.original_tokens,
      liquidatedTokens: c.liquidated_tokens,
      compressionRatio: c.compression_ratio,
      ttlSeconds: c.ttl_seconds,
      expiresAt: c.expires_at,
      createdAt: c.created_at,
    })),
  };
});

// Get session working memory stats
app.get('/api/v1/contexts/session/:sessionId/stats', async (request) => {
  const { sessionId } = request.params as { sessionId: string };
  const { working } = await import('@substrate/memory');

  const stats = await working.getSessionStats(sessionId);
  return stats;
});

// Liquidate a specific context
app.post('/api/v1/contexts/:id/liquidate', async (request) => {
  const { id } = request.params as { id: string };
  const { working } = await import('@substrate/memory');

  const context = await working.liquidateContext(id);

  return {
    id: context.id,
    status: context.status,
    extractedFacts: context.extractedFacts,
    extractedEntities: context.extractedEntities,
    compressionRatio: context.compressionRatio,
  };
});

// Promote a context's facts to semantic memory
app.post('/api/v1/contexts/:id/promote', async (request) => {
  const { id } = request.params as { id: string };
  const { working } = await import('@substrate/memory');

  const result = await working.promoteToSemantic(id);

  return {
    promoted: result.promoted,
    factIds: result.factIds,
  };
});

// Batch liquidate all raw contexts in a session
app.post('/api/v1/contexts/session/:sessionId/liquidate', async (request) => {
  const { sessionId } = request.params as { sessionId: string };
  const { working } = await import('@substrate/memory');

  const result = await working.liquidateSession(sessionId);

  return result;
});

// Get context for continuation (retrieves relevant context for conversation)
app.get('/api/v1/contexts/continuation', async (request) => {
  const { sessionId, input, maxTokens } = request.query as {
    sessionId: string;
    input: string;
    maxTokens?: string;
  };

  if (!sessionId || !input) {
    return { error: 'sessionId and input are required' };
  }

  const { working } = await import('@substrate/memory');

  const result = await working.getContextForContinuation(
    sessionId,
    input,
    maxTokens ? parseInt(maxTokens, 10) : 2000
  );

  return {
    summary: result.summary,
    totalTokens: result.totalTokens,
    contextCount: result.contexts.length,
  };
});

// Find similar contexts (tenant-aware)
app.get('/api/v1/contexts/similar', async (request) => {
  const req = request as AuthenticatedRequest;
  const { q, limit, sessionId } = request.query as {
    q: string;
    limit?: string;
    sessionId?: string;
  };

  if (!q) {
    return { error: 'Query parameter q is required' };
  }

  const { working } = await import('@substrate/memory');

  const contexts = await working.findSimilarContexts(
    q,
    limit ? parseInt(limit, 10) : 5,
    sessionId,
    req.tenant
  );

  return {
    contexts: contexts.map(c => ({
      id: c.id,
      sessionId: c.sessionId,
      contentType: c.contentType,
      status: c.status,
      createdAt: c.createdAt,
    })),
  };
});

// Cleanup expired contexts
app.post('/api/v1/contexts/cleanup', async () => {
  const { working } = await import('@substrate/memory');

  const cleaned = await working.cleanupExpiredContexts();

  return { cleaned };
});

// ===========================================
// PUBLIC DEMO ENDPOINT (No auth required)
// ===========================================

// Safe demo endpoint for website "Try It" section
// Only allows specific safe operations, heavily rate limited
app.post('/api/demo/execute', async (request, reply) => {
  const { input } = request.body as { input?: string };

  if (!input || typeof input !== 'string') {
    return { success: false, error: 'Input is required', code: 'MISSING_INPUT' };
  }

  const trimmedInput = input.trim().toLowerCase();
  if (trimmedInput.length === 0 || trimmedInput.length > 200) {
    return { success: false, error: 'Invalid input length', code: 'INVALID_INPUT' };
  }

  // Only allow safe demo queries - math operations
  const safePatterns = [
    /fahrenheit.*celsius/i,
    /celsius.*fahrenheit/i,
    /what is \d+%? of \d+/i,
    /\d+\s*(fahrenheit|celsius)/i,
    /percent|percentage/i,
    /convert/i,
    /calculate/i,
  ];

  const isSafe = safePatterns.some(p => p.test(input));
  if (!isSafe) {
    return {
      success: false,
      error: 'Demo only supports temperature conversions and percentage calculations',
      code: 'UNSUPPORTED_QUERY',
      hint: 'Try: "100 fahrenheit to celsius" or "what is 15% of 200"',
    };
  }

  // Use the existing execution logic but without tenant context
  try {
    // Get cached shards (public only)
    const allShards = await getCachedShards(false, undefined);

    let shard;
    let matchMethod = 'none';

    // Strategy 0: Template pattern matching (prefer most specific match)
    let bestDemoMatch: { shard: typeof allShards[0]; specificity: number } | null = null;
    for (const candidate of allShards) {
      try {
        if (candidate.patternHash && candidate.patternHash.includes('{')) {
          const template = candidate.patternHash.replace(/\?$/, '');
          const literalChars = template.replace(/\{[^}]+\}/g, '').length;
          if (literalChars === 0) continue;
          let pattern = template
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\\{[^}]+\\}/g, '(.+?)');
          const regex = new RegExp('^' + pattern + '\\??$', 'i');
          if (regex.test(input)) {
            if (!bestDemoMatch || literalChars > bestDemoMatch.specificity) {
              bestDemoMatch = { shard: candidate, specificity: literalChars };
            }
          }
        }
      } catch {
        // Skip invalid patterns
      }
    }

    if (bestDemoMatch) {
      shard = bestDemoMatch.shard;
      matchMethod = 'pattern';
    }

    // Strategy 1: Intent-based matching
    if (!shard) {
      const intent = await extractIntent(input, '');
      shard = await procedural.findShardByIntentTemplate(intent.template, false, 0.55, undefined);
      if (shard) matchMethod = 'intent';
    }

    // Strategy 2: Embedding similarity
    if (!shard) {
      const embedding = await generateEmbedding(input);
      const matches = await procedural.findSimilarShardsByEmbedding(embedding, 0.4, 1, false, undefined);
      shard = matches[0];
      if (shard) matchMethod = 'embedding';
    }

    if (!shard) {
      return {
        success: false,
        error: 'No matching shard found for this demo query',
        method: 'none',
        hint: 'Try: "100 fahrenheit to celsius" or "what is 15% of 200"',
      };
    }

    // Execute in sandbox
    const result = await execute(shard.logic, input);

    // Record execution (fire and forget) - no tenant for demo endpoint
    void procedural.recordExecution(
      shard.id,
      result.success,
      result.executionMs,
      result.success ? 45 : 0,
      undefined // demo endpoint has no tenant context
    ).catch(() => {});

    return {
      success: result.success,
      output: result.output,
      error: result.error,
      shardName: shard.name,
      executionMs: result.executionMs,
      matchMethod,
      demo: true,
    };
  } catch (err) {
    logger.error({ err }, 'Demo execute error');
    return {
      success: false,
      error: 'Demo execution failed',
      code: 'EXECUTION_ERROR',
    };
  }
});

// ===========================================
// SIGIL BRIDGE (Public Demo)
// ===========================================

// Public endpoint for SIGIL demo traffic (no auth required)
// Allows writing to sigil-demo (demo generator) or sigil-bridge (real public events)
app.post('/api/v1/sigil/broadcast', async (request) => {
  const body = request.body as {
    sigil: string;
    sender: string;
    domain?: string;
    metadata?: Record<string, unknown>;
    sessionId?: string; // 'sigil-demo' for demo traffic, 'sigil-bridge' for real events
  };

  if (!body.sigil || !body.sender) {
    return { error: 'sigil and sender are required' };
  }

  // Validate SIGIL format (basic check for brackets)
  if (!body.sigil.startsWith('[') || !body.sigil.endsWith(']')) {
    return { error: 'Invalid SIGIL format - must be wrapped in brackets' };
  }

  // Only allow demo or bridge sessions for public broadcast
  const allowedSessions = ['sigil-demo', 'sigil-bridge'];
  const sessionId = body.sessionId && allowedSessions.includes(body.sessionId)
    ? body.sessionId
    : 'sigil-bridge';

  const { working } = await import('@substrate/memory');

  // Create a context in the specified session (public, short TTL)
  const context = await working.createContext({
    sessionId,
    rawContent: JSON.stringify({
      sigil: body.sigil,
      sender: body.sender,
      domain: body.domain,
      timestamp: Date.now(),
      metadata: body.metadata,
    }),
    contentType: 'sigil_message',
    agentId: body.sender,
    ttlSeconds: 300, // 5 minutes max for demo traffic
    originalTokens: body.sigil.length,
    extractedFacts: [],
    extractedEntities: [],
    noiseRemoved: [],
  }, { visibility: 'public' });

  return {
    success: true,
    id: context.id,
    expiresAt: context.expiresAt,
  };
});

// Get recent SIGIL bridge messages (public, read-only)
app.get('/api/v1/sigil/stream', async (request) => {
  const { limit = '20' } = request.query as { limit?: string };
  const { query } = await import('@substrate/database');

  const limitNum = Math.min(parseInt(limit, 10), 50);

  // Query only sigil_message content types, ordered by recency
  const rows = await query<Record<string, unknown>>(`
    SELECT id, raw_content, expires_at, created_at
    FROM working_contexts
    WHERE session_id = 'sigil-bridge'
      AND content_type = 'sigil_message'
      AND status = 'raw'
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
    LIMIT $1
  `, [limitNum]);

  // Parse and return SIGIL messages
  const messages = rows.map(row => {
    try {
      const data = JSON.parse(row['raw_content'] as string);
      return {
        id: row['id'],
        sigil: data.sigil,
        sender: data.sender,
        domain: data.domain,
        timestamp: data.timestamp,
        createdAt: row['created_at'],
        expiresAt: row['expires_at'],
      };
    } catch {
      return null;
    }
  }).filter(Boolean);

  return { messages, count: messages.length };
});

// ===========================================
// ADMIN / MAINTENANCE
// ===========================================

// Regenerate all embeddings with current model
app.post('/api/v1/admin/regenerate-embeddings', {
  preHandler: requireAdmin,
}, async () => {
  const { query } = await import('@substrate/database');
  const { generateEmbedding } = await import('@substrate/ai');

  const result = {
    shards: { total: 0, updated: 0, errors: 0 },
    traces: { total: 0, updated: 0, errors: 0 },
    episodes: { total: 0, updated: 0, errors: 0 },
    facts: { total: 0, updated: 0, errors: 0 },
  };

  // Regenerate procedural_shards embeddings
  const shards = await query<{ id: string; name: string; patterns: string[] }>(
    `SELECT id, name, patterns FROM procedural_shards`
  );
  result.shards.total = shards.length;

  for (const shard of shards) {
    try {
      const text = `${shard.name} ${(shard.patterns || []).join(' ')}`;
      const embedding = await generateEmbedding(text);
      await query(
        `UPDATE procedural_shards SET embedding = $1 WHERE id = $2`,
        [`[${embedding.join(',')}]`, shard.id]
      );
      result.shards.updated++;
    } catch (e) {
      result.shards.errors++;
    }
  }

  // Regenerate reasoning_traces embeddings
  const traces = await query<{ id: string; input: string; output: string }>(
    `SELECT id, input, output FROM reasoning_traces`
  );
  result.traces.total = traces.length;

  for (const trace of traces) {
    try {
      const embedding = await generateEmbedding(`${trace.input} ${trace.output}`);
      await query(
        `UPDATE reasoning_traces SET embedding = $1 WHERE id = $2`,
        [`[${embedding.join(',')}]`, trace.id]
      );
      result.traces.updated++;
    } catch (e) {
      result.traces.errors++;
    }
  }

  // Regenerate episodes embeddings
  const episodes = await query<{ id: string; summary: string }>(
    `SELECT id, summary FROM episodes`
  );
  result.episodes.total = episodes.length;

  for (const episode of episodes) {
    try {
      const embedding = await generateEmbedding(episode.summary);
      await query(
        `UPDATE episodes SET embedding = $1 WHERE id = $2`,
        [`[${embedding.join(',')}]`, episode.id]
      );
      result.episodes.updated++;
    } catch (e) {
      result.episodes.errors++;
    }
  }

  // Regenerate knowledge_facts embeddings
  const facts = await query<{ id: string; statement: string }>(
    `SELECT id, statement FROM knowledge_facts`
  );
  result.facts.total = facts.length;

  for (const fact of facts) {
    try {
      const embedding = await generateEmbedding(fact.statement);
      await query(
        `UPDATE knowledge_facts SET embedding = $1 WHERE id = $2`,
        [`[${embedding.join(',')}]`, fact.id]
      );
      result.facts.updated++;
    } catch (e) {
      result.facts.errors++;
    }
  }

  return result;
});

// Backfill intent template embeddings for better shard matching
app.post('/api/v1/admin/backfill-intent-embeddings', {
  preHandler: requireAdmin,
}, async () => {
  const { procedural } = await import('@substrate/memory');
  const result = await procedural.backfillIntentTemplateEmbeddings();
  return result;
});

// Backfill pattern embeddings for shards missing the main embedding column
app.post('/api/v1/admin/backfill-pattern-embeddings', {
  preHandler: requireAdmin,
}, async () => {
  const { procedural } = await import('@substrate/memory');
  const result = await procedural.backfillPatternEmbeddings();
  return result;
});

// ===========================================
// TEST UTILITIES (only for test environments)
// ===========================================

// Cleanup test data - removes data created during test runs
app.post('/api/v1/test/cleanup', {
  preHandler: requireAdmin,
}, async (request) => {
  const { testRunId, traceIds, shardIds, episodeIds } = request.body as {
    testRunId?: string;
    traceIds?: string[];
    shardIds?: string[];
    episodeIds?: string[];
  };

  const { query } = await import('@substrate/database');

  const result = {
    tracesDeleted: 0,
    shardsDeleted: 0,
    episodesDeleted: 0,
  };

  // Delete traces by test run ID prefix
  if (testRunId) {
    // Unlink traces from shards first
    await query(
      `UPDATE reasoning_traces SET attracted_to_shard = NULL WHERE input LIKE $1`,
      [`${testRunId}%`]
    );

    const deleted = await query<{ id: string }>(
      `DELETE FROM reasoning_traces WHERE input LIKE $1 RETURNING id`,
      [`${testRunId}%`]
    );
    result.tracesDeleted += deleted.length;
  }

  // Delete specific traces by ID
  if (traceIds && traceIds.length > 0) {
    await query(
      `UPDATE reasoning_traces SET attracted_to_shard = NULL WHERE id = ANY($1)`,
      [traceIds]
    );
    const deleted = await query<{ id: string }>(
      `DELETE FROM reasoning_traces WHERE id = ANY($1) RETURNING id`,
      [traceIds]
    );
    result.tracesDeleted += deleted.length;
  }

  // Delete episodes by ID
  if (episodeIds && episodeIds.length > 0) {
    const deleted = await query<{ id: string }>(
      `DELETE FROM episodes WHERE id = ANY($1) RETURNING id`,
      [episodeIds]
    );
    result.episodesDeleted += deleted.length;
  }

  // Delete shards by ID (need to clean up related data first)
  if (shardIds && shardIds.length > 0) {
    // Unlink traces
    await query(
      `UPDATE reasoning_traces SET attracted_to_shard = NULL, synthesized = false
       WHERE attracted_to_shard = ANY($1)`,
      [shardIds]
    );
    // Delete episodes linked to these shards
    await query(
      `DELETE FROM episodes WHERE related_shard_id = ANY($1)`,
      [shardIds]
    );
    // Delete executions
    await query(
      `DELETE FROM shard_executions WHERE shard_id = ANY($1)`,
      [shardIds]
    );
    // Delete the shards
    const deleted = await query<{ id: string }>(
      `DELETE FROM procedural_shards WHERE id = ANY($1) RETURNING id`,
      [shardIds]
    );
    result.shardsDeleted += deleted.length;
  }

  return result;
});

// Get test-friendly stats for assertions
app.get('/api/v1/test/stats', {
  preHandler: requireAdmin,
}, async () => {
  const { query } = await import('@substrate/database');

  const [stats] = await query<{
    traces: string;
    shards: string;
    promoted_shards: string;
    episodes: string;
    facts: string;
  }>(`
    SELECT
      (SELECT COUNT(*) FROM reasoning_traces) as traces,
      (SELECT COUNT(*) FROM procedural_shards) as shards,
      (SELECT COUNT(*) FROM procedural_shards WHERE lifecycle = 'promoted') as promoted_shards,
      (SELECT COUNT(*) FROM episodes) as episodes,
      (SELECT COUNT(*) FROM knowledge_facts) as facts
  `);

  return {
    traces: parseInt(stats?.traces ?? '0', 10),
    shards: parseInt(stats?.shards ?? '0', 10),
    promotedShards: parseInt(stats?.promoted_shards ?? '0', 10),
    episodes: parseInt(stats?.episodes ?? '0', 10),
    facts: parseInt(stats?.facts ?? '0', 10),
  };
});

// ===========================================
// CHAT COMPLETIONS (Terminal Workbench)
// ===========================================

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface ChatRequest {
  messages: ChatMessage[];
  model: string;
  memory: boolean | {
    procedural: boolean;
    episodic: boolean;
    semantic: boolean;
    working: boolean;
  };
  sessionId?: string;
  captureTrace: boolean;
  tracePrivate: boolean;
  autoExecuteShards?: boolean;
}

// API Key decryption for chat
const ENCRYPTION_KEY = (() => {
  const key = process.env['API_KEY_ENCRYPTION_KEY'] || process.env['JWT_SECRET'];
  if (!key && process.env['NODE_ENV'] === 'production') {
    throw new Error('API_KEY_ENCRYPTION_KEY or JWT_SECRET must be set in production');
  }
  return key || 'dev-only-key-not-for-production';
})();

async function getDecryptionKey() {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ENCRYPTION_KEY),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: encoder.encode('substrate-api-key-salt'), iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function decryptApiKey(encryptedKey: string): Promise<string> {
  const key = await getDecryptionKey();
  const combined = Buffer.from(encryptedKey, 'base64');
  const iv = combined.subarray(0, 12);
  const encrypted = combined.subarray(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

// Get user's AI connector settings (decrypts the API key)
// Note: This uses tenant_id, not user_id, since connectors are tenant-scoped
async function getUserConnector(userId: string, provider: 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'ollama' | 'lmstudio'): Promise<{ api_key: string; baseUrl?: string } | undefined> {
  // First get tenant_id from user
  const userResult = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM users WHERE id = $1`,
    [userId]
  );

  if (!userResult[0]?.tenant_id) {
    return undefined;
  }

  const tenantId = userResult[0].tenant_id;

  // Query the user_ai_connectors table (where connector settings are actually stored)
  const connectorResult = await query<{
    api_key_encrypted: string | null;
    base_url: string | null;
    is_enabled: boolean;
  }>(
    `SELECT api_key_encrypted, base_url, is_enabled
     FROM user_ai_connectors
     WHERE tenant_id = $1 AND provider = $2 AND is_enabled = true`,
    [tenantId, provider]
  );

  if (!connectorResult[0]) {
    return undefined;
  }

  const connector = connectorResult[0];

  try {
    // Decrypt API key if present
    if (connector.api_key_encrypted) {
      // The keys are encrypted using a simpler format (iv:encrypted) in consumer.ts
      // Decrypt using the same method
      const [ivHex, encrypted] = connector.api_key_encrypted.split(':');
      if (ivHex && encrypted) {
        const ENCRYPTION_KEY_SIMPLE = process.env['ENCRYPTION_KEY'] || process.env['JWT_SECRET'];
        if (!ENCRYPTION_KEY_SIMPLE && process.env['NODE_ENV'] === 'production') {
          throw new Error('ENCRYPTION_KEY or JWT_SECRET must be set in production for connector decryption');
        }
        const encKey = ENCRYPTION_KEY_SIMPLE || 'dev-only-key-not-for-production';
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = await import('crypto').then(c =>
          c.createDecipheriv('aes-256-cbc', Buffer.from(encKey.padEnd(32).slice(0, 32)), iv)
        );
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        const result: { api_key: string; baseUrl?: string } = { api_key: decrypted };
        if (connector.base_url) result.baseUrl = connector.base_url;
        return result;
      }
    }

    // For local providers (Ollama/LMStudio), no API key needed, just base URL
    if (connector.base_url) {
      return { api_key: '', baseUrl: connector.base_url };
    }
  } catch (e) {
    logger.warn({ err: e, provider }, 'Failed to decrypt user API key, falling back to system key');
  }

  return undefined;
}

// Memory config after normalization
interface MemoryConfig {
  procedural: boolean;
  episodic: boolean;
  semantic: boolean;
  working: boolean;
}

// Build memory context for chat
async function buildMemoryContext(
  input: string,
  config: MemoryConfig,
  tenantContext?: MemoryTenantContext
): Promise<{ context: string; shardMatches: Array<{ id: string; name: string; confidence: number }> }> {
  const contextParts: string[] = [];
  const shardMatches: Array<{ id: string; name: string; confidence: number }> = [];

  // Procedural: Find relevant shards
  if (config.procedural) {
    try {
      const embedding = await generateEmbedding(input);
      const matches = await procedural.findSimilarShardsByEmbedding(embedding, 0.5, 3, false, tenantContext);
      if (matches.length > 0) {
        contextParts.push('## Available Procedural Knowledge');
        for (const shard of matches) {
          // Use similarity score (embedding match), not stored confidence (training confidence)
          const similarity = (shard as unknown as { similarity: number }).similarity ?? shard.confidence;
          shardMatches.push({ id: shard.id, name: shard.name, confidence: similarity });
          contextParts.push(`- **${shard.name}** (similarity: ${(similarity * 100).toFixed(0)}%): Patterns: ${shard.patterns.join(', ')}`);
        }
      }
    } catch (e) {
      logger.warn({ err: e }, 'Failed to fetch procedural context');
    }
  }

  // Episodic: Find similar past experiences
  if (config.episodic) {
    try {
      const episodes = await episodic.findSimilarEpisodes(input, 3, tenantContext);
      if (episodes.length > 0) {
        contextParts.push('\n## Relevant Past Experiences');
        for (const ep of episodes) {
          contextParts.push(`- ${ep.summary} (${ep.valence}, importance: ${ep.importance.toFixed(2)})`);
          if (ep.lessonsLearned.length > 0) {
            contextParts.push(`  Lessons: ${ep.lessonsLearned.join('; ')}`);
          }
        }
      }
    } catch (e) {
      logger.warn({ err: e }, 'Failed to fetch episodic context');
    }
  }

  // Semantic: Find related facts
  if (config.semantic) {
    try {
      const facts = await semantic.findSimilarFacts(input, 5, tenantContext);
      if (facts.length > 0) {
        contextParts.push('\n## Known Facts');
        for (const fact of facts) {
          contextParts.push(`- ${fact.statement} (confidence: ${(fact.confidence * 100).toFixed(0)}%)`);
        }
      }
    } catch (e) {
      logger.warn({ err: e }, 'Failed to fetch semantic context');
    }
  }

  // Working: Get session context
  if (config.working) {
    try {
      // Get recent session contexts if we have a session
      const contexts = await working.findSimilarContexts(input, 3, undefined, tenantContext);
      if (contexts.length > 0) {
        contextParts.push('\n## Working Memory Context');
        for (const ctx of contexts) {
          if (ctx.extractedFacts && ctx.extractedFacts.length > 0) {
            contextParts.push(`- Session facts: ${ctx.extractedFacts.slice(0, 3).join(', ')}`);
          }
        }
      }
    } catch (e) {
      logger.warn({ err: e }, 'Failed to fetch working context');
    }
  }

  return {
    context: contextParts.join('\n'),
    shardMatches,
  };
}

// Helper to get user_id from session cookie
async function getUserIdFromSession(request: FastifyRequest): Promise<string | null> {
  const cookies = request.cookies as Record<string, string> | undefined;
  const sessionToken = cookies?.['substrate_session'];
  if (!sessionToken) return null;

  const encoder = new TextEncoder();
  const data = encoder.encode(sessionToken);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const tokenHash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  const session = await query<{ user_id: string }>(
    'SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > NOW() AND revoked = false',
    [tokenHash]
  );
  return session[0]?.user_id || null;
}

// Middleware: require admin auth via API key OR session cookie (dashboard)
async function requireAdminAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // First check API key auth (tenant context set by global middleware)
  const req = request as AuthenticatedRequest;
  if (req.tenant && req.tenant.tenantId !== 'tenant_system' && req.tenant.scopes?.includes('admin')) {
    return; // API key with admin scope — passed
  }

  // Fall back to cookie-based session auth
  const userId = await getUserIdFromSession(request);
  if (!userId) {
    reply.code(401).send({ error: 'Authentication required' });
    throw new Error('Authentication required');
  }
  const [user] = await query<{ role: string }>('SELECT role FROM users WHERE id = $1', [userId]);
  if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
    reply.code(403).send({ error: 'Admin access required' });
    throw new Error('Admin access required');
  }
}

// Chat completions endpoint
app.post('/api/chat/completions', async (request, reply) => {
  const req = request as AuthenticatedRequest;

  // Get user ID from session for connector lookup (cookie-based auth)
  const userId = await getUserIdFromSession(request);

  // Check authentication - either API key tenant OR cookie session
  if ((!req.tenant || req.tenant.tenantId === 'tenant_system') && !userId) {
    return reply.status(401).send({ error: 'Authentication required' });
  }

  // If authenticated via cookie but no tenant, get tenant from user
  if ((!req.tenant || req.tenant.tenantId === 'tenant_system') && userId) {
    const userTenant = await query<{
      tenant_id: string;
      tier: string;
      name: string;
      max_private_shards: number;
      max_private_facts: number;
      max_members: number;
    }>(
      `SELECT u.tenant_id, t.tier, t.name, t.max_private_shards, t.max_private_facts, t.max_members
       FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.id = $1`,
      [userId]
    );
    if (userTenant[0]) {
      req.tenant = {
        tenantId: userTenant[0].tenant_id,
        tier: userTenant[0].tier as 'free' | 'pro' | 'enterprise' | 'system',
        name: userTenant[0].name,
        limits: {
          maxPrivateShards: userTenant[0].max_private_shards,
          maxPrivateFacts: userTenant[0].max_private_facts,
          maxMembers: userTenant[0].max_members,
        },
        scopes: ['read', 'write', 'execute'],
      };
    }
  }

  const body = request.body as ChatRequest;
  const { messages, captureTrace, tracePrivate, autoExecuteShards } = body;
  let { sessionId } = body;
  let { model } = body;

  // Handle memory config - can be boolean true (enable all) or object
  // Default: all memory enabled so ALF uses what it learns
  const rawMemory = body.memory;
  const memory = rawMemory === false
    ? { procedural: false, episodic: false, semantic: false, working: false }
    : rawMemory === true || !rawMemory
      ? { procedural: true, episodic: true, semantic: true, working: true }
      : rawMemory;

  if (!messages || messages.length === 0) {
    return reply.status(400).send({ error: 'Messages are required' });
  }

  // Get the last user message for Smart Router analysis
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const queryText = lastUserMsg?.content || '';

  // Auto-create session if none provided (first message without clicking "New Chat")
  if (!sessionId && req.tenant?.tenantId) {
    try {
      sessionId = ids.session();
      const autoTitle = queryText.length > 60 ? queryText.slice(0, 57) + '...' : queryText || 'New Chat';
      await query(
        `INSERT INTO chat_sessions (id, tenant_id, title, model, provider)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, req.tenant.tenantId, autoTitle, model || 'auto', null]
      );
      logger.info({ sessionId, tenantId: req.tenant.tenantId }, 'Auto-created chat session');
    } catch (sessErr) {
      logger.error({ err: sessErr }, 'Failed to auto-create session');
      sessionId = undefined;
    }
  }

  // Smart Router decision metadata (populated if smart-router mode is used)
  let routingDecision: RoutingDecision | null = null;

  // Handle Smart Router - intelligent model selection
  if (!model || model === 'auto' || model === 'smart-router') {
    try {
      routingDecision = routeQuery(queryText);
      model = routingDecision.model;
      logger.info({
        tier: routingDecision.tier,
        model: routingDecision.model,
        provider: routingDecision.provider,
        reason: routingDecision.reason,
        confidence: routingDecision.confidence,
        analysisMs: routingDecision.analysisMs,
        complexity: routingDecision.signals.complexityScore,
      }, 'Smart Router: Model selected');
    } catch (routerError) {
      // Fallback if routing fails
      logger.warn({ error: routerError }, 'Smart Router failed, falling back to default model');
      model = 'claude-sonnet-4-5';
    }
  }

  // Determine provider from model name
  type Provider = 'openai' | 'anthropic' | 'google' | 'xai' | 'deepseek' | 'ollama' | 'lmstudio';
  let provider: Provider = 'anthropic';

  if (model.startsWith('claude')) {
    provider = 'anthropic';
  } else if (model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')) {
    provider = 'openai';
  } else if (model.startsWith('gemini')) {
    provider = 'google';
  } else if (model.startsWith('grok')) {
    provider = 'xai';
  } else if (model.startsWith('deepseek')) {
    provider = 'deepseek';
  } else if (model.startsWith('ollama/') || model.startsWith('llama') || model.startsWith('mistral') || model.startsWith('mixtral') || model.startsWith('phi') || model.startsWith('qwen') || model.startsWith('codellama')) {
    provider = 'ollama';
  } else if (model.startsWith('lmstudio/')) {
    provider = 'lmstudio';
  }

  // Get user's connector settings (if they have their own API key)
  let apiKey: string | undefined;
  let baseUrl: string | undefined;
  let usingDefaultKey = false;

  if (userId) {
    const connectorSettings = await getUserConnector(userId, provider);
    if (connectorSettings?.api_key) {
      apiKey = connectorSettings.api_key;
    }
    if (connectorSettings?.baseUrl) {
      baseUrl = connectorSettings.baseUrl;
    }
  }

  // Fall back to system API keys if user hasn't configured their own
  if (!apiKey) {
    switch (provider) {
      case 'anthropic':
        apiKey = process.env['ANTHROPIC_API_KEY'];
        break;
      case 'openai':
        apiKey = process.env['OPENAI_API_KEY'];
        break;
      case 'google':
        apiKey = process.env['GOOGLE_AI_API_KEY'];
        break;
      case 'deepseek':
        apiKey = process.env['DEEPSEEK_API_KEY'];
        break;
      case 'xai':
        apiKey = process.env['XAI_API_KEY'];
        break;
      case 'ollama':
        baseUrl = baseUrl || process.env['OLLAMA_BASE_URL'] || 'http://localhost:11434';
        break;
      case 'lmstudio':
        baseUrl = baseUrl || process.env['LMSTUDIO_BASE_URL'] || 'http://localhost:1234';
        break;
    }
    usingDefaultKey = true;
  }

  // Local providers don't need API keys
  const isLocalProvider = provider === 'ollama' || provider === 'lmstudio';

  if (!apiKey && !isLocalProvider) {
    return reply.status(400).send({
      error: `No ${provider} API key configured`,
      hint: `Configure your ${provider} API key in Settings > AI Connectors`,
    });
  }

  // ============================================
  // BILLING & RATE LIMITING
  // Check: BYOK → Subscription limit → Bundle tokens
  // ============================================
  const tenantId = req.tenant?.tenantId || userId;
  let billingSource: 'subscription' | 'bundle' | 'byok' = 'subscription';
  let usedPlatformKey = false;
  let platformKeyId: string | undefined;
  let billingCheck: Awaited<ReturnType<typeof checkUsageAndBilling>> | null = null;

  if (tenantId) {
    // Check usage and billing status
    billingCheck = await checkUsageAndBilling(tenantId, provider, 1000);

    if (!billingCheck.canProceed) {
      // Rate limited - show appropriate upgrade options
      return reply.status(429).send({
        error: 'Usage limit reached',
        message: billingCheck.reason,
        usage: billingCheck.usage,
        options: {
          buyBundle: billingCheck.suggestBundle ? {
            message: 'Purchase token bundles for extra usage',
            packages: Object.values(TOKEN_PACKAGES).slice(0, 2), // Show starter & standard
          } : undefined,
          upgrade: billingCheck.suggestUpgrade ? {
            message: 'Upgrade your plan for higher limits',
            url: '/settings/billing',
          } : undefined,
          byok: !billingCheck.usage.hasByok ? {
            message: 'Add your own API key for unlimited usage',
            url: '/settings/connectors',
          } : undefined,
        },
      });
    }

    // billingCheck.source is guaranteed not to be 'none' here (canProceed is true)
    if (billingCheck.source !== 'none') {
      billingSource = billingCheck.source;
    }

    // If using subscription with platform keys (free tier), get a platform key
    if (billingSource === 'subscription' && usingDefaultKey) {
      const platformKey = await getPlatformKey(provider as 'openai' | 'anthropic');
      if (platformKey) {
        apiKey = platformKey.apiKey;
        platformKeyId = platformKey.keyId;
        usedPlatformKey = true;
      }
    }
  }

  // Get the last user message for context building
  const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
  const userInput = lastUserMessage?.content || '';

  // ============================================
  // STEP 1: LOAD ALF PROFILE (Personal AI Assistant)
  // This is FIRST - before shard check or LLM call
  // 100% isolated per user
  // ============================================
  let alfProfile: Awaited<ReturnType<typeof alf.loadProfile>> = null;
  let alfSystemPrompt = '';
  if (req.tenant?.tenantId) {
    try {
      alfProfile = await alf.loadOrCreateProfile(req.tenant.tenantId);
      if (alfProfile) {
        alfSystemPrompt = alf.buildSystemPromptInjection(alfProfile);
        // Record activity
        void alf.recordActivity(req.tenant.tenantId, 'message').catch(() => {});
      }
    } catch (e) {
      logger.warn({ err: e }, 'Failed to load ALF profile');
    }
  }

  // Build memory context - cast tenant to MemoryTenantContext
  let memTenant: MemoryTenantContext | undefined;
  if (req.tenant) {
    memTenant = { tenantId: req.tenant.tenantId };
    if (req.tenant.tier) {
      memTenant.tier = req.tenant.tier as 'free' | 'pro' | 'enterprise' | 'system';
    }
  }
  const memoryContext = await buildMemoryContext(userInput, memory, memTenant);

  // ============================================
  // COGNITIVE CHECKPOINT - Pre-action knowledge surfacing
  // This runs BEFORE any action to surface relevant knowledge
  // from all memory tiers and check for warnings/guidance.
  // ============================================
  const checkpointContext = await checkpoint.runCheckpoint(userInput, {
    tenant: memTenant,
    checkExpensiveOps: true,
    includeFailureWarnings: true,
  });

  // Log checkpoint results
  if (checkpointContext.warnings.length > 0 || checkpointContext.relevantFacts.length > 0) {
    logger.info({
      shards: checkpointContext.relevantShards.length,
      episodes: checkpointContext.relevantEpisodes.length,
      facts: checkpointContext.relevantFacts.length,
      warnings: checkpointContext.warnings.length,
      requiresReview: checkpointContext.requiresReview,
    }, 'Cognitive checkpoint complete');
  }

  // Inject checkpoint context into memory context for LLM awareness
  const checkpointPrompt = checkpoint.formatCheckpointForPrompt(checkpointContext);

  // Try shard execution first if enabled
  if (autoExecuteShards) {
    // Shadow classifier (Layer 3): Fire asynchronously alongside existing matching
    // Builds candidate list from both pattern and embedding matches for classification
    const shadowClassifierPromise = (async () => {
      try {
        // Gather all candidates: pattern matches + embedding matches
        const allCandidates: ShardCandidate[] = [];

        // Get pattern match candidates
        const patternCandidates = await procedural.findShardsByPattern(userInput, memTenant);
        for (const pc of patternCandidates) {
          allCandidates.push({
            id: pc.id,
            name: pc.name,
            patterns: pc.patterns,
            intentTemplate: pc.intentTemplate,
            knowledgeType: pc.knowledgeType,
            confidence: pc.confidence,
          });
        }

        // Add embedding match candidates
        for (const sm of memoryContext.shardMatches) {
          if (!allCandidates.find(c => c.id === sm.id)) {
            allCandidates.push({
              id: sm.id,
              name: sm.name,
              patterns: [],
              confidence: sm.confidence,
            });
          }
        }

        if (allCandidates.length > 0) {
          return await classifyShardMatch(userInput, allCandidates, { shadowMode: true });
        }
        return null;
      } catch {
        return null;
      }
    })();

    // Strategy 1: Try pattern matching first (deterministic, reliable for structured patterns)
    try {
      const patternMatches = await procedural.findShardsByPattern(userInput, memTenant);
      if (patternMatches.length > 0 && patternMatches[0]) {
        const shard = patternMatches[0];
        logger.info({ shardId: shard.id, pattern: shard.matchedPattern }, 'Shard matched by pattern');
        const result = await execute(shard.logic, userInput);
        if (result.success && result.output && String(result.output).trim()) {
          // Calculate environmental savings based on actual output length
          // An LLM would need to process input + generate output, estimate ~1 token per 4 chars
          // Plus overhead for system prompt, context, etc. (2x multiplier)
          const outputStr = String(result.output);
          const estimatedLlmTokens = Math.ceil(((userInput.length + outputStr.length) / 4) * 2);
          const tokensSaved = shard.estimatedTokens > 0 ? shard.estimatedTokens : Math.max(50, estimatedLlmTokens);
          const waterSaved = Math.round((tokensSaved / 1000) * 500); // ml
          const powerSaved = parseFloat(((tokensSaved / 1000) * 10).toFixed(2)); // Wh
          const carbonSaved = parseFloat(((tokensSaved / 1000) * 5).toFixed(2)); // g CO2

          // Record execution with tenant tracking + input for phrasing diversity (Layer 4)
          void procedural.recordExecution(shard.id, true, result.executionMs, tokensSaved, req.tenant?.tenantId, userInput, 'pattern').catch(() => {});

          // Record shard hit in ALF profile
          if (req.tenant?.tenantId) {
            void alf.recordActivity(req.tenant.tenantId, 'shard_hit').catch(() => {});
          }

          // Record episode in episodic memory
          const episodeOptions = memTenant
            ? { tenant: memTenant, visibility: 'private' as const }
            : { visibility: 'public' as const };
          void episodic.recordEpisode({
            situation: {
              context: `User request: ${userInput.substring(0, 200)}`,
              entities: [shard.name, 'pattern_match'],
              state: { shardConfidence: shard.confidence, lifecycle: shard.lifecycle },
            },
            action: {
              type: 'shard_execution',
              description: `Executed shard: ${shard.name}`,
              parameters: { input: userInput.substring(0, 100), matchMethod: 'pattern' },
            },
            outcome: {
              result: `Success: ${String(result.output).substring(0, 100)}`,
              success: true,
              effects: ['tokens_saved', 'user_served'],
              metrics: { executionMs: result.executionMs, tokensSaved },
            },
            type: 'shard_execution',
            summary: `${shard.name} executed successfully via pattern match (${result.executionMs}ms)`,
            success: true,
            valence: 'positive',
            importance: 0.4,
            lessonsLearned: [],
            sessionId,
            relatedShardId: shard.id,
            metadata: { matchMethod: 'pattern', tokensSaved, waterSaved, powerSaved, carbonSaved },
            timestamp: new Date(),
          }, episodeOptions).catch(err => logger.error({ err }, 'Failed to record episode'));

          // Persist shard hit messages to database
          if (sessionId) {
            try {
              await query(
                `INSERT INTO chat_messages (id, session_id, role, content, created_at)
                 VALUES ($1, $2, 'user', $3, NOW())`,
                [ids.message(), sessionId, userInput]
              );

              await query(
                `INSERT INTO chat_messages (id, session_id, role, content, model, shard_id, shard_name, tokens_saved, water_ml_saved, power_wh_saved, carbon_g_saved, response_ms, token_source, created_at)
                 VALUES ($1, $2, 'assistant', $3, 'shard', $4, $5, $6, $7, $8, $9, $10, 'shard', NOW())`,
                [ids.message(), sessionId, result.output, shard.id, shard.name, tokensSaved, waterSaved, powerSaved, carbonSaved, result.executionMs]
              );

              await query(
                `UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`,
                [sessionId]
              );
            } catch (msgErr) {
              logger.error({ err: msgErr, sessionId }, 'Failed to persist shard hit messages');
            }
          }

          // Shadow classifier: log what classifier would have decided (fire-and-forget)
          void shadowClassifierPromise.then(cr => {
            if (cr) logShadowComparison(userInput, { shardId: shard.id, shardName: shard.name, method: 'pattern' }, cr);
          }).catch(() => {});

          return {
            response: result.output,
            model: 'shard',
            isShardHit: true,
            sessionId,
            shardHit: {
              shardId: shard.id,
              shardName: shard.name,
              knowledgeType: shard.knowledgeType || 'procedural',
              tokensSaved,
              waterSaved,
              powerSaved,
              carbonSaved,
            },
            responseMs: result.executionMs,
            tokensUsed: 0,
            memoryContext: memoryContext.context ? true : false,
          };
        }
      }
    } catch (patternErr) {
      logger.warn({ err: patternErr }, 'Pattern matching failed, trying embedding matching');
    }

    // Strategy 2: Fall back to embedding similarity if pattern matching didn't work
    if (memoryContext.shardMatches.length > 0) {
      // Check if any shard matches with high similarity (0.85+ for execution)
      const bestMatch = memoryContext.shardMatches[0];
      if (bestMatch && bestMatch.confidence >= 0.85) {
        try {
          const shard = await procedural.getShardById(bestMatch.id);
        if (shard) {
          const result = await execute(shard.logic, userInput);
          if (result.success && result.output && String(result.output).trim()) {
            // Calculate environmental savings based on actual output length
            const outputStr = String(result.output);
            const estimatedLlmTokens = Math.ceil(((userInput.length + outputStr.length) / 4) * 2);
            const tokensSaved = shard.estimatedTokens > 0 ? shard.estimatedTokens : Math.max(50, estimatedLlmTokens);
            const waterSaved = Math.round((tokensSaved / 1000) * 500); // ml
            const powerSaved = parseFloat(((tokensSaved / 1000) * 10).toFixed(2)); // Wh
            const carbonSaved = parseFloat(((tokensSaved / 1000) * 5).toFixed(2)); // g CO2

            // Record execution with tenant tracking + input for phrasing diversity (Layer 4)
            void procedural.recordExecution(shard.id, true, result.executionMs, tokensSaved, req.tenant?.tenantId, userInput, 'embedding').catch(() => {});

            // Record shard hit in ALF profile
            if (req.tenant?.tenantId) {
              void alf.recordActivity(req.tenant.tenantId, 'shard_hit').catch(() => {});
            }

            // Record episode in episodic memory
            const embEpisodeOptions = memTenant
              ? { tenant: memTenant, visibility: 'private' as const }
              : { visibility: 'public' as const };
            void episodic.recordEpisode({
              situation: {
                context: `User request: ${userInput.substring(0, 200)}`,
                entities: [shard.name, 'embedding_match'],
                state: { shardConfidence: shard.confidence, lifecycle: shard.lifecycle },
              },
              action: {
                type: 'shard_execution',
                description: `Executed shard: ${shard.name}`,
                parameters: { input: userInput.substring(0, 100), matchMethod: 'embedding' },
              },
              outcome: {
                result: `Success: ${String(result.output).substring(0, 100)}`,
                success: true,
                effects: ['tokens_saved', 'user_served'],
                metrics: { executionMs: result.executionMs, tokensSaved },
              },
              type: 'shard_execution',
              summary: `${shard.name} executed successfully via embedding match (${result.executionMs}ms)`,
              success: true,
              valence: 'positive',
              importance: 0.4,
              lessonsLearned: [],
              sessionId,
              relatedShardId: shard.id,
              metadata: { matchMethod: 'embedding', tokensSaved, waterSaved, powerSaved, carbonSaved },
              timestamp: new Date(),
            }, embEpisodeOptions).catch(err => logger.error({ err }, 'Failed to record episode'));

            // Persist shard hit messages to database
            if (sessionId) {
              try {
                await query(
                  `INSERT INTO chat_messages (id, session_id, role, content, created_at)
                   VALUES ($1, $2, 'user', $3, NOW())`,
                  [ids.message(), sessionId, userInput]
                );

                await query(
                  `INSERT INTO chat_messages (id, session_id, role, content, model, shard_id, shard_name, tokens_saved, water_ml_saved, power_wh_saved, carbon_g_saved, response_ms, token_source, created_at)
                   VALUES ($1, $2, 'assistant', $3, 'shard', $4, $5, $6, $7, $8, $9, $10, 'shard', NOW())`,
                  [ids.message(), sessionId, result.output, shard.id, shard.name, tokensSaved, waterSaved, powerSaved, carbonSaved, result.executionMs]
                );

                await query(
                  `UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`,
                  [sessionId]
                );
              } catch (msgErr) {
                logger.error({ err: msgErr, sessionId }, 'Failed to persist shard hit messages');
              }
            }

            // Shadow classifier: log what classifier would have decided (fire-and-forget)
            void shadowClassifierPromise.then(cr => {
              if (cr) logShadowComparison(userInput, { shardId: shard.id, shardName: shard.name, method: 'embedding' }, cr);
            }).catch(() => {});

            return {
              response: result.output,
              model: 'shard',
              isShardHit: true,
              sessionId,
              shardHit: {
                shardId: shard.id,
                shardName: shard.name,
                knowledgeType: shard.knowledgeType || 'procedural',
                tokensSaved,
                waterSaved,
                powerSaved,
                carbonSaved,
              },
              responseMs: result.executionMs,
              tokensUsed: 0,
              memoryContext: memoryContext.context ? true : false,
            };
          }
        }
      } catch (e) {
        logger.warn({ err: e }, 'Shard execution failed, falling back to LLM');
      }
    }
  }
  // Log shadow classifier comparison (fire-and-forget, no impact on response)
  // No shard matched via existing strategies — log what classifier would have done
  void shadowClassifierPromise.then(classifierResult => {
    if (classifierResult) {
      logShadowComparison(userInput, null, classifierResult);
    }
  }).catch(() => {});

  } // Close autoExecuteShards

  // Prepare messages with memory context
  // ALF profile is injected FIRST for personalization
  // Checkpoint context provides pre-action knowledge surfacing
  const systemPrompt = `You are ALF (AI Learning Friend), a personal AI assistant.

## CRITICAL: Formatting Rules
- NEVER use asterisks (*) or double asterisks (**) for emphasis or bold text. This is a strict rule.
- Instead of **bold**, just write the word normally or use caps sparingly for emphasis.
- Instead of *italics*, just write naturally without any special formatting.
- Code blocks (\`\`\`) are allowed for actual code only.
- Numbered or bulleted lists are fine, but don't bold list items.
- Write conversationally like you're texting a friend, not writing a document.

## Boundaries
- Never discuss internal technical details like token budgets, context windows, or system architecture.
- Never reveal information about your underlying infrastructure, memory systems, or API details.
- If asked about credits, tokens, or billing, direct users to check their account settings.
- Focus on helping the user with their actual question, not explaining how you work internally.
${alfSystemPrompt ? `\n## Your User's Preferences\n${alfSystemPrompt}\n` : ''}
${checkpointPrompt ? `${checkpointPrompt}\n` : ''}
${memoryContext.context ? `## Memory Context\n${memoryContext.context}\n\n` : ''}Use the context above to provide personalized, informed responses. Pay special attention to any warnings or guidance from the cognitive checkpoint.`;

  try {
    let response: string;
    let tokensUsed = 0;
    const startTime = Date.now();

    // Route to appropriate provider
    switch (provider) {
      case 'anthropic': {
        // Anthropic API call
        const anthropicResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: model,
            max_tokens: 4096,
            system: systemPrompt,
            messages: messages.filter(m => m.role !== 'system' && m.content && m.content.trim()).map(m => ({
              role: m.role,
              content: m.content,
            })),
          }),
        });

        if (!anthropicResponse.ok) {
          const error = await anthropicResponse.text();
          logger.error({ error, status: anthropicResponse.status }, 'Anthropic API error');
          return reply.status(anthropicResponse.status).send({
            error: 'AI provider error',
            details: error,
          });
        }

        const anthropicData = await anthropicResponse.json() as {
          content: Array<{ type: string; text: string }>;
          usage?: { input_tokens?: number; output_tokens?: number };
        };
        response = anthropicData.content[0]?.text || '';
        tokensUsed = (anthropicData.usage?.input_tokens || 0) + (anthropicData.usage?.output_tokens || 0);
        break;
      }

      case 'openai': {
        // OpenAI API call
        const openaiMessages = [
          { role: 'system', content: systemPrompt },
          ...messages.filter(m => m.role !== 'system' && m.content && m.content.trim()),
        ];

        const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model,
            messages: openaiMessages,
            max_tokens: 4096,
          }),
        });

        if (!openaiResponse.ok) {
          const error = await openaiResponse.text();
          logger.error({ error, status: openaiResponse.status }, 'OpenAI API error');
          return reply.status(openaiResponse.status).send({
            error: 'AI provider error',
            details: error,
          });
        }

        const openaiData = await openaiResponse.json() as {
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens?: number };
        };
        response = openaiData.choices[0]?.message?.content || '';
        tokensUsed = openaiData.usage?.total_tokens || 0;
        break;
      }

      case 'google': {
        // Google Gemini API call
        const geminiMessages = [
          { role: 'user', parts: [{ text: systemPrompt }] },
          { role: 'model', parts: [{ text: 'Understood. I will use the memory context to provide informed responses.' }] },
          ...messages.filter(m => m.role !== 'system').map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }],
          })),
        ];

        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: geminiMessages,
              generationConfig: {
                maxOutputTokens: 4096,
              },
            }),
          }
        );

        if (!geminiResponse.ok) {
          const error = await geminiResponse.text();
          logger.error({ error, status: geminiResponse.status }, 'Google Gemini API error');
          return reply.status(geminiResponse.status).send({
            error: 'AI provider error',
            details: error,
          });
        }

        const geminiData = await geminiResponse.json() as {
          candidates?: Array<{ content?: { parts?: Array<{ text: string }> } }>;
          usageMetadata?: { totalTokenCount?: number };
        };
        response = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        tokensUsed = geminiData.usageMetadata?.totalTokenCount || 0;
        break;
      }

      case 'xai': {
        // xAI/Grok API call (OpenAI-compatible format)
        const xaiMessages = [
          { role: 'system', content: systemPrompt },
          ...messages.filter(m => m.role !== 'system'),
        ];

        const xaiResponse = await fetch('https://api.x.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model,
            messages: xaiMessages,
            max_tokens: 4096,
          }),
        });

        if (!xaiResponse.ok) {
          const error = await xaiResponse.text();
          logger.error({ error, status: xaiResponse.status }, 'xAI API error');
          return reply.status(xaiResponse.status).send({
            error: 'AI provider error',
            details: error,
          });
        }

        const xaiData = await xaiResponse.json() as {
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens?: number };
        };
        response = xaiData.choices[0]?.message?.content || '';
        tokensUsed = xaiData.usage?.total_tokens || 0;
        break;
      }

      case 'deepseek': {
        // DeepSeek API call (OpenAI-compatible format)
        const deepseekMessages = [
          { role: 'system', content: systemPrompt },
          ...messages.filter(m => m.role !== 'system'),
        ];

        const deepseekResponse = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: model === 'deepseek-v3' ? 'deepseek-chat' : model === 'deepseek-reasoner' ? 'deepseek-reasoner' : 'deepseek-chat',
            messages: deepseekMessages,
            max_tokens: 4096,
          }),
        });

        if (!deepseekResponse.ok) {
          const error = await deepseekResponse.text();
          logger.error({ error, status: deepseekResponse.status }, 'DeepSeek API error');
          return reply.status(deepseekResponse.status).send({
            error: 'AI provider error',
            details: error,
          });
        }

        const deepseekData = await deepseekResponse.json() as {
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens?: number };
        };
        response = deepseekData.choices[0]?.message?.content || '';
        tokensUsed = deepseekData.usage?.total_tokens || 0;
        break;
      }

      case 'ollama': {
        // Ollama local API (OpenAI-compatible format)
        const ollamaModel = model.replace('ollama/', '');
        const ollamaMessages = [
          { role: 'system', content: systemPrompt },
          ...messages.filter(m => m.role !== 'system'),
        ];

        const ollamaResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ollamaModel,
            messages: ollamaMessages,
          }),
        });

        if (!ollamaResponse.ok) {
          const error = await ollamaResponse.text();
          logger.error({ error, status: ollamaResponse.status }, 'Ollama API error');
          return reply.status(ollamaResponse.status).send({
            error: 'Local model error',
            details: error,
            hint: 'Ensure Ollama is running and the model is pulled',
          });
        }

        const ollamaData = await ollamaResponse.json() as {
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens?: number };
        };
        response = ollamaData.choices[0]?.message?.content || '';
        tokensUsed = ollamaData.usage?.total_tokens || 0;
        break;
      }

      case 'lmstudio': {
        // LM Studio local API (OpenAI-compatible format)
        const lmstudioModel = model.replace('lmstudio/', '');
        const lmstudioMessages = [
          { role: 'system', content: systemPrompt },
          ...messages.filter(m => m.role !== 'system'),
        ];

        const lmstudioResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: lmstudioModel,
            messages: lmstudioMessages,
          }),
        });

        if (!lmstudioResponse.ok) {
          const error = await lmstudioResponse.text();
          logger.error({ error, status: lmstudioResponse.status }, 'LM Studio API error');
          return reply.status(lmstudioResponse.status).send({
            error: 'Local model error',
            details: error,
            hint: 'Ensure LM Studio is running with a loaded model',
          });
        }

        const lmstudioData = await lmstudioResponse.json() as {
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens?: number };
        };
        response = lmstudioData.choices[0]?.message?.content || '';
        tokensUsed = lmstudioData.usage?.total_tokens || 0;
        break;
      }

      default:
        return reply.status(400).send({ error: `Unsupported provider: ${provider}` });
    }

    // MANDATORY: Capture ALL traces to public memory - NO EXCEPTIONS
    // Any attempt to bypass this results in user suspension
    if (userInput && response) {
      try {
        const traceId = ids.trace();
        const intent = await extractIntent(userInput, response);
        const patternHash = generatePatternHash(userInput, response);
        const embedding = await generateEmbedding(`${userInput} ${response}`);

        // Security scan for malicious content (async, non-blocking)
        const securityFlags = {
          containsCode: /```|<script|javascript:|eval\(|exec\(/i.test(userInput + response),
          containsUrls: /https?:\/\/[^\s]+/i.test(userInput + response),
          containsBase64: /[A-Za-z0-9+/]{50,}={0,2}/.test(userInput + response),
          suspiciousPatterns: /(\bpassword\b|\bsecret\b|\btoken\b|\bapi.?key\b)/i.test(userInput),
        };

        // Flag for security review if suspicious
        const requiresReview = securityFlags.containsCode && securityFlags.suspiciousPatterns;
        if (requiresReview) {
          logger.warn({
            traceId,
            tenantId: req.tenant?.tenantId || userId,
            securityFlags,
          }, 'SECURITY: Trace flagged for review - potential malicious content');
        }

        await query(
          `INSERT INTO reasoning_traces (
            id, input, output, reasoning, pattern_hash, embedding,
            intent_template, intent_category, intent_name, intent_parameters,
            tokens_used, execution_ms, model, session_id, owner_id, visibility, timestamp
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13, $14, $15, NOW())`,
          [
            traceId,
            userInput,
            response,
            null,
            patternHash,
            `[${embedding.join(',')}]`,
            intent.template,
            intent.category,
            intent.intentName,
            JSON.stringify(intent.parameters),
            Math.ceil((userInput.length + response.length) / 4),
            model,
            sessionId,
            req.tenant?.tenantId || userId,
            'public', // ALWAYS public - private traces not allowed
          ]
        );

        logger.info({ traceId, sessionId, securityFlags: requiresReview ? securityFlags : undefined }, 'Chat trace captured (mandatory)');
      } catch (e) {
        // Log error but don't fail the request - trace capture is critical for monitoring
        logger.error({ err: e, tenantId: req.tenant?.tenantId || userId }, 'CRITICAL: Failed to capture mandatory chat trace');
      }
    } else {
      // Log if somehow we got here without input/response
      logger.warn({ tenantId: req.tenant?.tenantId || userId }, 'ALERT: Chat request without input or response - cannot capture trace');
    }

    // Record usage based on billing source
    const estimatedTokens = Math.ceil((userInput.length + response.length) / 4);
    if (tenantId) {
      try {
        await recordUsage(tenantId, billingSource, estimatedTokens, usedPlatformKey, routingDecision?.tier);

        // Record platform key usage if used
        if (platformKeyId && usedPlatformKey) {
          await recordPlatformKeyUsage(platformKeyId, estimatedTokens);
        }
      } catch (usageErr) {
        logger.warn({ err: usageErr }, 'Failed to record usage');
      }
    }

    const responseMs = Date.now() - startTime;

    // Persist chat messages to database for conversation history
    if (sessionId && userInput && response) {
      try {
        // Save user message
        await query(
          `INSERT INTO chat_messages (id, session_id, role, content, created_at)
           VALUES ($1, $2, 'user', $3, NOW())`,
          [ids.message(), sessionId, userInput]
        );

        // Save assistant message with metadata
        // Map billingSource to token_source (subscription → free_tier for tracking purposes)
        const tokenSource = billingSource === 'subscription' ? 'free_tier' : billingSource;
        await query(
          `INSERT INTO chat_messages (id, session_id, role, content, model, provider, tokens_used, response_ms, token_source, created_at)
           VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7, $8, NOW())`,
          [ids.message(), sessionId, response, model, provider, tokensUsed, responseMs, tokenSource]
        );

        // Update session's updated_at timestamp
        await query(
          `UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1`,
          [sessionId]
        );

        logger.debug({ sessionId }, 'Chat messages persisted');
      } catch (msgErr) {
        logger.error({ err: msgErr, sessionId }, 'Failed to persist chat messages');
      }
    }

    // ============================================
    // ACTIVE MEMORY GATHERING
    // Extract user info and update ALF profile in background
    // This runs AFTER response - non-blocking for user experience
    // ============================================
    if (tenantId && userInput && response) {
      gather.gatherInBackground(tenantId, {
        userMessage: userInput,
        assistantResponse: response,
        sessionId: sessionId || ids.session(),
        model,
        provider,
        tokensUsed,
        responseMs,
      });
    }

    return {
      response,
      model,
      isShardHit: false,
      sessionId,
      responseMs,
      tokensUsed,
      billingSource, // Tell frontend how this was billed
      billingStatus: billingCheck ? {
        suggestUpgrade: billingCheck.suggestUpgrade,
        suggestBundle: billingCheck.suggestBundle,
        usage: billingCheck.usage,
        source: billingCheck.source,
      } : null,
      shardMatches: memoryContext.shardMatches,
      memoryContext: memoryContext.context ? true : false,
      // Smart Router metadata
      smartRouter: routingDecision ? {
        tier: routingDecision.tier,
        selectedModel: routingDecision.model,
        provider: routingDecision.provider,
        reason: routingDecision.reason,
        confidence: routingDecision.confidence,
        complexity: routingDecision.signals.complexityScore,
        analysisMs: routingDecision.analysisMs,
      } : null,
    };
  } catch (e) {
    logger.error({ err: e }, 'Chat completion error');
    return reply.status(500).send({
      error: 'Failed to generate response',
      details: e instanceof Error ? e.message : 'Unknown error',
    });
  }
});

// Get context preview for the chat
app.post('/api/chat/context-preview', async (request) => {
  const req = request as AuthenticatedRequest;

  if (!req.tenant || req.tenant.tenantId === 'tenant_system') {
    return { error: 'Authentication required' };
  }

  const body = request.body as {
    input: string;
    memory: ChatRequest['memory'];
  };

  const { input } = body;

  // Normalize memory config
  const rawMemory = body.memory;
  const memory = rawMemory === true
    ? { procedural: true, episodic: true, semantic: true, working: true }
    : rawMemory || { procedural: false, episodic: false, semantic: false, working: false };

  if (!input) {
    return { context: '', shardMatches: [] };
  }

  // Cast tenant to MemoryTenantContext
  let memTenant: MemoryTenantContext | undefined;
  if (req.tenant) {
    memTenant = { tenantId: req.tenant.tenantId };
    if (req.tenant.tier) {
      memTenant.tier = req.tenant.tier as 'free' | 'pro' | 'enterprise' | 'system';
    }
  }

  const result = await buildMemoryContext(input, memory, memTenant);

  return {
    context: result.context,
    shardMatches: result.shardMatches,
    hasContext: result.context.length > 0,
  };
});

// Get chat sessions for user
app.get('/api/chat/sessions', async (request) => {
  const req = request as AuthenticatedRequest;

  if (!req.tenant || req.tenant.tenantId === 'tenant_system') {
    return { sessions: [] };
  }

  // Get distinct sessions from traces
  const sessions = await query<{ session_id: string; last_message: Date; message_count: string }>(
    `SELECT
       session_id,
       MAX(timestamp) as last_message,
       COUNT(*) as message_count
     FROM reasoning_traces
     WHERE owner_id = $1 AND session_id IS NOT NULL
     GROUP BY session_id
     ORDER BY last_message DESC
     LIMIT 20`,
    [req.tenant.tenantId]
  );

  return {
    sessions: sessions.map(s => ({
      id: s.session_id,
      lastMessage: s.last_message,
      messageCount: parseInt(s.message_count, 10),
    })),
  };
});

// Get chat history for a session
app.get('/api/chat/sessions/:sessionId/history', async (request) => {
  const req = request as AuthenticatedRequest;
  const { sessionId } = request.params as { sessionId: string };

  if (!req.tenant || req.tenant.tenantId === 'tenant_system') {
    return { messages: [] };
  }

  const traces = await query<{ input: string; output: string; timestamp: Date }>(
    `SELECT input, output, timestamp
     FROM reasoning_traces
     WHERE owner_id = $1 AND session_id = $2
     ORDER BY timestamp ASC`,
    [req.tenant.tenantId, sessionId]
  );

  // Convert traces to chat messages
  const messages: ChatMessage[] = [];
  for (const trace of traces) {
    messages.push({ role: 'user', content: trace.input });
    messages.push({ role: 'assistant', content: trace.output });
  }

  return { messages };
});

// ===========================================
// ERROR HANDLING
// ===========================================

// Global error handler with structured logging
app.setErrorHandler(async (error: Error, request, reply) => {
  const route = request.url.split('?')[0] ?? request.url;
  const statusCode = (error as Error & { statusCode?: number }).statusCode ?? 500;

  // Log the error with context
  logger.error({
    event: 'request.error',
    error: error.message,
    stack: process.env['NODE_ENV'] !== 'production' ? error.stack : undefined,
    method: request.method,
    url: route,
    statusCode,
    ip: request.ip,
  }, `${request.method} ${route} ${statusCode} - ${error.message}`);

  // Send appropriate response
  reply.status(statusCode).send({
    error: statusCode >= 500 ? 'Internal Server Error' : error.message,
    message: process.env['NODE_ENV'] !== 'production' ? error.message : 'An error occurred',
    statusCode,
  });
});

// Start server
async function start() {
  const port = parseInt(process.env['PORT'] ?? '3000', 10);

  // Initialize database
  initializePool({
    connectionString: process.env['DATABASE_URL'] ?? 'postgresql://substrate:substrate_dev@localhost:5432/substrate',
  });

  // Validate database connection at startup
  try {
    await query('SELECT 1');
    logger.info('Database connection validated');
  } catch (err) {
    logger.error({ error: err }, 'Failed to connect to database');
    process.exit(1);
  }

  // Initialize AI
  initializeAI({
    anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
    openaiApiKey: process.env['OPENAI_API_KEY'],
    openaiOrgId: process.env['OPENAI_ORG_ID'],
  });

  // Initialize event bus
  initializeEventBus({
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
  });

  try {
    await app.listen({ port, host: '0.0.0.0' });
    logger.info({ port }, 'SUBSTRATE API server started');

    // Start the autonomous agent scheduler (runs every 60 seconds)
    const schedulerInterval = parseInt(process.env['AGENT_SCHEDULER_INTERVAL'] ?? '60000', 10);
    startAgentScheduler(schedulerInterval);
    logger.info({ interval: schedulerInterval }, 'Agent scheduler started');
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

// Graceful shutdown handling
let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown...');

  // Give in-flight requests time to complete
  const shutdownTimeout = parseInt(process.env['SHUTDOWN_TIMEOUT'] ?? '30000', 10);

  const forceShutdown = setTimeout(() => {
    logger.error('Graceful shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, shutdownTimeout);

  try {
    // Stop agent scheduler
    stopAgentScheduler();
    logger.info('Agent scheduler stopped');

    // Close Fastify server (stops accepting new connections)
    await app.close();
    logger.info('Server closed, no longer accepting connections');

    // Close event bus (Redis)
    try {
      await closeEventBus();
      logger.info('Event bus closed');
    } catch {
      // Event bus may not be initialized
    }

    clearTimeout(forceShutdown);
    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ error: err }, 'Error during graceful shutdown');
    clearTimeout(forceShutdown);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
