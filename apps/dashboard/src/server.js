import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCookie from '@fastify/cookie';
import {
  getPrometheusMetrics,
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
} from '@substrate/observability';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import { initializePool, query, queryOne } from '@substrate/database';
import { initializeEmailFromEnv, sendWaitlistEmail, sendAdminNotification } from '@substrate/email';
import {
  validateSession,
  getUserById,
  listApiKeysByUser,
  createApiKey,
  revokeApiKey,
  getActiveSubscription,
  getSubscriptionWithPlan,
  getUsageSummary,
  changePassword,
  createUser,
} from '@substrate/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize database
const databaseUrl = process.env['DATABASE_URL'] ?? 'postgresql://substrate:substrate_dev@localhost:5432/substrate';
initializePool({ connectionString: databaseUrl });
initializeEmailFromEnv();

const fastify = Fastify({ logger: true });

// ===========================================
// RATE LIMITING
// ===========================================
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute

// Clean up expired entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of rateLimitStore.entries()) {
    if (data.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000);

// Rate limit middleware
fastify.addHook('preHandler', async (request, reply) => {
  // Skip rate limiting for health checks and static files
  if (request.url === '/health' || request.url.startsWith('/assets/')) {
    return;
  }

  const ip = request.ip || 'unknown';
  const key = `rate:${ip}`;
  const now = Date.now();

  let entry = rateLimitStore.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitStore.set(key, entry);
  } else {
    entry.count++;
  }

  reply.header('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  reply.header('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX_REQUESTS - entry.count));
  reply.header('X-RateLimit-Reset', Math.ceil(entry.resetAt / 1000));

  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    reply.status(429);
    return { error: 'Too Many Requests', retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
});

// ===========================================
// TENANT CONTEXT HELPER
// ===========================================
// Optional tenant filtering via X-Tenant-ID header
// No header = public view only (private data requires authentication)

/**
 * Build visibility filter for tenant-aware queries
 * @param {string|undefined} tenantId - Optional tenant ID from header
 * @param {string} tableAlias - Optional table alias for the query
 * @returns {{ clause: string, params: any[], paramOffset: number }}
 */
function buildVisibilityFilter(tenantId, tableAlias = '') {
  const prefix = tableAlias ? `${tableAlias}.` : '';

  if (!tenantId) {
    // No tenant = public view only (exclude system shards)
    return {
      clause: `(${prefix}visibility = 'public' OR (${prefix}owner_id IS NULL AND ${prefix}visibility != 'system'))`,
      params: [],
      paramOffset: 0,
    };
  }

  // Tenant sees: public + ALF shards (non-system) + own private + own org
  // Explicitly exclude 'system' visibility shards which are admin-only
  return {
    clause: `(
      ${prefix}visibility = 'public'
      OR (${prefix}owner_id IS NULL AND ${prefix}visibility != 'system')
      OR ${prefix}owner_id = $1
    )`,
    params: [tenantId],
    paramOffset: 1,
  };
}

/**
 * Get tenant ID from request headers
 * @param {object} request - Fastify request
 * @returns {string|undefined}
 */
function getTenantId(request) {
  return request.headers['x-tenant-id'];
}

// CORS configuration - restrict to known origins
const ALLOWED_ORIGINS = [
  'https://orcastr8r.com',
  'https://www.orcastr8r.com',
  'https://integration.tax',
  // Development origins
  ...(process.env['NODE_ENV'] !== 'production' ? [
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3001',
    'http://127.0.0.1:5173',
  ] : []),
];

await fastify.register(fastifyCors, {
  origin: (origin, cb) => {
    // Allow requests with no origin (same-origin, curl, etc.)
    if (!origin) {
      cb(null, true);
      return;
    }
    if (ALLOWED_ORIGINS.includes(origin)) {
      cb(null, true);
    } else {
      console.warn(`CORS blocked origin: ${origin}`);
      cb(new Error('CORS not allowed'), false);
    }
  },
  credentials: true,
});

// Cookie support for session auth with secure options
await fastify.register(fastifyCookie, {
  secret: process.env['SESSION_SECRET'] || 'dev-session-secret-not-for-production',
  hook: 'onRequest',
  parseOptions: {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax', // Same-site dashboard — 'lax' is correct (not 'none' which exposes to CSRF)
  }
});

// WebSocket support
await fastify.register(fastifyWebsocket);

// Security headers middleware
// NOTE: CSP is set by nginx (cloudflared.conf) — do NOT duplicate here
// to avoid double CSP headers which browsers resolve by taking the most restrictive.
fastify.addHook('onSend', async (request, reply) => {
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
});

// ===========================================
// SESSION AUTH HELPER
// ===========================================

async function getUserFromSession(request) {
  const sessionId = request.cookies?.['substrate_session'];
  if (!sessionId) return null;

  const session = await validateSession(sessionId);
  if (!session) return null;

  const user = await getUserById(session.user_id);
  return user;
}

// Metrics instrumentation
fastify.addHook('onRequest', async (request) => {
  httpRequestsInFlight.inc({ service: 'dashboard' });
  request._metricsStart = process.hrtime.bigint();
});

fastify.addHook('onResponse', async (request, reply) => {
  httpRequestsInFlight.dec({ service: 'dashboard' });
  httpRequestsTotal.inc({ service: 'dashboard', method: request.method, status: String(reply.statusCode) });
  if (request._metricsStart) {
    const durationMs = Number(process.hrtime.bigint() - request._metricsStart) / 1_000_000;
    httpRequestDuration.observe(durationMs, { service: 'dashboard', method: request.method });
  }
});

// Health check endpoint for container orchestration
fastify.get('/health', { logLevel: 'silent' }, async (_request, reply) => {
  // Validate database connectivity
  try {
    await queryOne('SELECT 1');
    return { status: 'healthy', service: 'dashboard', database: 'connected' };
  } catch (err) {
    return reply.code(503).send({ status: 'degraded', service: 'dashboard', database: 'disconnected', error: err.message });
  }
});

fastify.get('/metrics', { logLevel: 'silent' }, async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return getPrometheusMetrics();
});

// Serve React app static files
await fastify.register(fastifyStatic, {
  root: join(__dirname, '../public/app'),
  prefix: '/',
  cacheControl: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  },
});


// Admin-only docs page (SUBSTRATE/SIGIL technical documentation)
// Served from dashboard's own public folder, not website folder
fastify.get('/docs', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user || user.role !== 'admin') {
    // Redirect non-admins to login
    return reply.redirect('/login');
  }
  // Serve the docs page for admin users from dashboard public folder
  const fs = await import('fs/promises');
  try {
    const content = await fs.readFile(join(__dirname, '../public/docs.html'), 'utf-8');
    reply.header('Content-Type', 'text/html; charset=utf-8');
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    return reply.send(content);
  } catch {
    return reply.code(404).send({ error: 'Page not found' });
  }
});

// ===========================================
// WEBSOCKET - Real-time updates with heartbeat
// ===========================================

const WS_TIMEOUT_MS = 60000; // 1 minute timeout for dead connections
const wsClients = new Map(); // socket -> { lastPing: timestamp, pingInterval }

// Broadcast to all connected clients
function broadcast(type, data) {
  const message = JSON.stringify({ type, data, timestamp: Date.now() });
  for (const [socket] of wsClients) {
    if (socket.readyState === 1) { // OPEN
      socket.send(message);
    }
  }
}

// Cleanup dead connections
function cleanupDeadConnections() {
  const now = Date.now();
  for (const [socket, data] of wsClients.entries()) {
    if (now - data.lastPing > WS_TIMEOUT_MS) {
      console.log('Cleaning up dead WebSocket connection');
      clearInterval(data.pingInterval);
      wsClients.delete(socket);
      try { socket.close(); } catch { /* ignore */ }
    }
  }
}

// Run cleanup every 30 seconds
setInterval(cleanupDeadConnections, 30000);

// WebSocket endpoint with authentication
fastify.get('/ws', { websocket: true }, async (socket, req) => {
  // Authenticate WebSocket connection via session cookie
  const user = await getUserFromSession(req);

  // Reject unauthenticated connections — no anonymous access to live stats
  if (!user) {
    socket.close(4401, 'Authentication required');
    return;
  }

  // Track connection with heartbeat
  const pingInterval = setInterval(() => {
    if (socket.readyState === 1) {
      try { socket.ping(); } catch { /* ignore */ }
    }
  }, 30000);

  wsClients.set(socket, { lastPing: Date.now(), pingInterval, userId: user.id, isAuthenticated: true });
  console.log(`WebSocket client connected (${wsClients.size} total, user: ${user.id})`);

  socket.on('pong', () => {
    const data = wsClients.get(socket);
    if (data) data.lastPing = Date.now();
  });

  socket.on('close', () => {
    const data = wsClients.get(socket);
    if (data) clearInterval(data.pingInterval);
    wsClients.delete(socket);
    console.log(`WebSocket client disconnected (${wsClients.size} remaining)`);
  });

  socket.on('error', () => {
    const data = wsClients.get(socket);
    if (data) clearInterval(data.pingInterval);
    wsClients.delete(socket);
  });

  socket.on('message', async (msg) => {
    // Update last ping on any message
    const data = wsClients.get(socket);
    if (data) data.lastPing = Date.now();

    try {
      const { action } = JSON.parse(msg.toString());
      if (action === 'refresh') {
        const stats = await getStats();
        socket.send(JSON.stringify({ type: 'stats', data: stats, timestamp: Date.now() }));
      }
    } catch (e) {
      // Ignore invalid messages
    }
  });

  // Send initial stats
  getStats().then(stats => {
    socket.send(JSON.stringify({ type: 'stats', data: stats, timestamp: Date.now() }));
  });
});

// Periodic broadcast (every 30 seconds - reduced from 5s to prevent database overload)
// 6 queries per broadcast * 2 broadcasts/minute = 12 queries/minute (vs 72 before)
setInterval(async () => {
  if (wsClients.size > 0) {
    try {
      const stats = await getStats();
      broadcast('stats', stats);
    } catch (err) {
      console.error('Failed to broadcast stats:', err.message);
    }
  }
}, 30000);

// ===========================================
// API ENDPOINTS
// ===========================================

// Reusable stats function - only counts PUBLIC data (excludes system shards)
async function getStats() {
  const publicFilter = "(visibility = 'public' OR (owner_id IS NULL AND visibility != 'system'))";

  const [shards, traces, executions, episodes, facts, working] = await Promise.all([
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE lifecycle = 'promoted') as promoted,
        COUNT(*) FILTER (WHERE lifecycle = 'candidate') as candidate,
        COUNT(*) FILTER (WHERE lifecycle = 'deprecated') as deprecated,
        AVG(confidence) as avg_confidence
      FROM procedural_shards
      WHERE ${publicFilter}
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE synthesized = true) as synthesized,
        COUNT(*) FILTER (WHERE timestamp > NOW() - INTERVAL '24 hours') as last_24h
      FROM reasoning_traces
      WHERE ${publicFilter}
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE success = true) as successful,
        COALESCE(SUM(tokens_saved), 0) as tokens_saved,
        COALESCE(AVG(execution_ms), 0) as avg_ms
      FROM shard_executions
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE success = true) as successful,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h
      FROM episodes
      WHERE ${publicFilter}
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        AVG(confidence) as avg_confidence
      FROM knowledge_facts
      WHERE ${publicFilter}
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'raw') as raw,
        COUNT(*) FILTER (WHERE status = 'liquidated') as liquidated,
        COUNT(*) FILTER (WHERE status = 'promoted') as promoted,
        COALESCE(AVG(compression_ratio) FILTER (WHERE compression_ratio IS NOT NULL), 0) as avg_compression,
        COALESCE(AVG(importance), 0) as avg_importance
      FROM working_contexts
      WHERE (expires_at IS NULL OR expires_at > NOW()) AND ${publicFilter}
    `),
  ]);

  const successRate = executions?.total > 0
    ? (Number(executions.successful) / Number(executions.total) * 100).toFixed(1)
    : '0';

  return {
    shards: {
      total: Number(shards?.total ?? 0),
      promoted: Number(shards?.promoted ?? 0),
      candidate: Number(shards?.candidate ?? 0),
      deprecated: Number(shards?.deprecated ?? 0),
      avgConfidence: Number(shards?.avg_confidence ?? 0).toFixed(2),
    },
    traces: {
      total: Number(traces?.total ?? 0),
      synthesized: Number(traces?.synthesized ?? 0),
      last24h: Number(traces?.last_24h ?? 0),
    },
    executions: {
      total: Number(executions?.total ?? 0),
      successful: Number(executions?.successful ?? 0),
      successRate: successRate + '%',
      tokensSaved: Number(executions?.tokens_saved ?? 0),
      avgMs: Number(executions?.avg_ms ?? 0).toFixed(1),
    },
    episodes: {
      total: Number(episodes?.total ?? 0),
      successful: Number(episodes?.successful ?? 0),
      last24h: Number(episodes?.last_24h ?? 0),
    },
    facts: {
      total: Number(facts?.total ?? 0),
      avgConfidence: Number(facts?.avg_confidence ?? 0).toFixed(2),
    },
    working: {
      total: Number(working?.total ?? 0),
      raw: Number(working?.raw ?? 0),
      liquidated: Number(working?.liquidated ?? 0),
      promoted: Number(working?.promoted ?? 0),
      avgCompression: Number(working?.avg_compression ?? 0).toFixed(2),
      avgImportance: Number(working?.avg_importance ?? 0).toFixed(2),
    },
  };
}

// System stats endpoint (admin view)
fastify.get('/api/stats', async () => getStats());

// Tenant-scoped stats endpoint (requires authentication)
fastify.get('/api/tenant/stats', async (request, reply) => {
  // Require authentication for tenant stats
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Authentication required for tenant stats' };
  }

  // Use authenticated user's tenant, not header (prevents unauthorized access)
  const tenantId = user.tenant_id;

  if (!tenantId) {
    return { error: 'User has no associated tenant' };
  }

  const [shards, traces, episodes, facts, working] = await Promise.all([
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE lifecycle = 'promoted') as promoted,
        COUNT(*) FILTER (WHERE visibility = 'public') as public,
        COUNT(*) FILTER (WHERE visibility = 'private') as private
      FROM procedural_shards
      WHERE owner_id = $1 OR (visibility = 'public' AND owner_id IS NULL)
    `, [tenantId]),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE owner_id = $1) as owned,
        COUNT(*) FILTER (WHERE synthesized = true AND owner_id = $1) as synthesized
      FROM reasoning_traces
      WHERE owner_id = $1 OR (visibility = 'public' AND owner_id IS NULL)
    `, [tenantId]),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE success = true) as successful
      FROM episodes
      WHERE owner_id = $1 OR (visibility = 'public' AND owner_id IS NULL)
    `, [tenantId]),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE owner_id = $1) as owned,
        AVG(confidence) as avg_confidence
      FROM knowledge_facts
      WHERE owner_id = $1 OR (visibility = 'public' AND owner_id IS NULL)
    `, [tenantId]),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'raw') as raw,
        COUNT(*) FILTER (WHERE status = 'liquidated') as liquidated
      FROM working_contexts
      WHERE owner_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
    `, [tenantId]),
  ]);

  return {
    tenantId,
    shards: {
      total: Number(shards?.total ?? 0),
      promoted: Number(shards?.promoted ?? 0),
      public: Number(shards?.public ?? 0),
      private: Number(shards?.private ?? 0),
    },
    traces: {
      total: Number(traces?.total ?? 0),
      owned: Number(traces?.owned ?? 0),
      synthesized: Number(traces?.synthesized ?? 0),
    },
    episodes: {
      total: Number(episodes?.total ?? 0),
      successful: Number(episodes?.successful ?? 0),
    },
    facts: {
      total: Number(facts?.total ?? 0),
      owned: Number(facts?.owned ?? 0),
      avgConfidence: Number(facts?.avg_confidence ?? 0).toFixed(2),
    },
    working: {
      total: Number(working?.total ?? 0),
      raw: Number(working?.raw ?? 0),
      liquidated: Number(working?.liquidated ?? 0),
    },
  };
});

// Procedural shards list (tenant-aware)
fastify.get('/api/shards', async (request) => {
  const { lifecycle = 'all', limit = 50 } = request.query;
  const tenantId = getTenantId(request);
  const visFilter = buildVisibilityFilter(tenantId);

  const params = [...visFilter.params];
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 1000);

  let whereClause = visFilter.clause !== '1=1' ? `WHERE ${visFilter.clause}` : '';

  if (lifecycle !== 'all' && ['promoted', 'candidate', 'deprecated'].includes(lifecycle)) {
    params.push(lifecycle);
    whereClause = whereClause
      ? `${whereClause} AND lifecycle = $${params.length}`
      : `WHERE lifecycle = $${params.length}`;
  }

  params.push(safeLimit);
  const shards = await query(`
    SELECT
      id, name, patterns, confidence, lifecycle,
      execution_count, success_count, failure_count,
      owner_id, visibility,
      created_at, last_executed
    FROM procedural_shards
    ${whereClause}
    ORDER BY
      CASE lifecycle
        WHEN 'promoted' THEN 1
        WHEN 'candidate' THEN 2
        ELSE 3
      END,
      confidence DESC
    LIMIT $${params.length}
  `, params);

  return { shards, tenantId: tenantId ?? 'system' };
});

// Recent traces (tenant-aware)
fastify.get('/api/traces', async (request) => {
  const { limit = 50, synthesized } = request.query;
  const tenantId = getTenantId(request);
  const visFilter = buildVisibilityFilter(tenantId);

  const params = [...visFilter.params];
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 1000);

  let whereClause = visFilter.clause !== '1=1' ? `WHERE ${visFilter.clause}` : '';

  if (synthesized === 'true') {
    params.push(true);
    whereClause = whereClause
      ? `${whereClause} AND synthesized = $${params.length}`
      : `WHERE synthesized = $${params.length}`;
  } else if (synthesized === 'false') {
    params.push(false);
    whereClause = whereClause
      ? `${whereClause} AND synthesized = $${params.length}`
      : `WHERE synthesized = $${params.length}`;
  }

  params.push(safeLimit);
  const traces = await query(`
    SELECT
      id, input, output, pattern_hash, tokens_used,
      execution_ms, synthesized, source, owner_id, visibility, timestamp
    FROM reasoning_traces
    ${whereClause}
    ORDER BY timestamp DESC
    LIMIT $${params.length}
  `, params);

  return { traces, tenantId: tenantId ?? 'system' };
});

// Episodes (tenant-aware)
fastify.get('/api/episodes', async (request) => {
  const { type, limit = 50 } = request.query;
  const tenantId = getTenantId(request);
  const visFilter = buildVisibilityFilter(tenantId);

  const params = [...visFilter.params];
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 1000);

  let whereClause = visFilter.clause !== '1=1' ? `WHERE ${visFilter.clause}` : '';

  if (type && typeof type === 'string' && type.length < 100) {
    params.push(type);
    whereClause = whereClause
      ? `${whereClause} AND type = $${params.length}`
      : `WHERE type = $${params.length}`;
  }

  params.push(safeLimit);
  const episodes = await query(`
    SELECT
      id, type, summary, success, valence, importance,
      lessons_learned, owner_id, visibility, created_at
    FROM episodes
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `, params);

  return { episodes, tenantId: tenantId ?? 'system' };
});

// Knowledge facts (tenant-aware)
fastify.get('/api/facts', async (request) => {
  const { subject, limit = 50 } = request.query;
  const tenantId = getTenantId(request);
  const visFilter = buildVisibilityFilter(tenantId);

  const params = [...visFilter.params];
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 1000);

  let whereClause = visFilter.clause !== '1=1' ? `WHERE ${visFilter.clause}` : '';

  if (subject && typeof subject === 'string' && subject.length < 200) {
    params.push(`%${subject}%`);
    whereClause = whereClause
      ? `${whereClause} AND subject ILIKE $${params.length}`
      : `WHERE subject ILIKE $${params.length}`;
  }

  params.push(safeLimit);
  const facts = await query(`
    SELECT
      id, subject, predicate, object, statement,
      confidence, sources, category, owner_id, visibility, created_at
    FROM knowledge_facts
    ${whereClause}
    ORDER BY confidence DESC, updated_at DESC
    LIMIT $${params.length}
  `, params);

  return { facts, tenantId: tenantId ?? 'system' };
});

// Shard detail
fastify.get('/api/shards/:id', async (request, reply) => {
  const { id } = request.params;

  const shard = await queryOne(`
    SELECT * FROM procedural_shards WHERE id = $1
  `, [id]);

  if (!shard) {
    reply.status(404);
    return { error: 'Shard not found' };
  }

  const executions = await query(`
    SELECT id, success, execution_ms, tokens_saved, error, created_at
    FROM shard_executions
    WHERE shard_id = $1
    ORDER BY created_at DESC
    LIMIT 20
  `, [id]);

  return { shard, executions };
});

// Working contexts (tenant-aware)
fastify.get('/api/contexts', async (request) => {
  const { status, limit = 50 } = request.query;
  const tenantId = getTenantId(request);
  const visFilter = buildVisibilityFilter(tenantId);

  const params = [...visFilter.params];
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 1000);

  let whereClause = "WHERE (expires_at IS NULL OR expires_at > NOW())";
  if (visFilter.clause !== '1=1') {
    whereClause += ` AND ${visFilter.clause}`;
  }

  if (status && status !== 'all' && ['raw', 'liquidated', 'promoted'].includes(status)) {
    params.push(status);
    whereClause += ` AND status = $${params.length}`;
  }

  params.push(safeLimit);
  const contexts = await query(`
    SELECT
      id, session_id, content_type, status, importance,
      original_tokens, liquidated_tokens, compression_ratio,
      owner_id, visibility, expires_at, created_at, updated_at
    FROM working_contexts
    ${whereClause}
    ORDER BY importance DESC, created_at DESC
    LIMIT $${params.length}
  `, params);

  return { contexts, tenantId: tenantId ?? 'system' };
});

// Context detail
fastify.get('/api/contexts/:id', async (request, reply) => {
  const { id } = request.params;

  const context = await queryOne(`
    SELECT * FROM working_contexts WHERE id = $1
  `, [id]);

  if (!context) {
    reply.status(404);
    return { error: 'Context not found' };
  }

  return { context };
});

// Episode types breakdown
fastify.get('/api/episodes/types', async () => {
  const types = await query(`
    SELECT type, COUNT(*) as count,
           COUNT(*) FILTER (WHERE success = true) as successful
    FROM episodes
    GROUP BY type
    ORDER BY count DESC
  `);

  return { types };
});

// ===========================================
// USER API ENDPOINTS (Session-authenticated)
// ===========================================

// Get current user
fastify.get('/api/user/me', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const subscription = await getSubscriptionWithPlan(user.tenant_id);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.display_name,
      tenant_id: user.tenant_id,
      status: user.status,
      role: user.role,
      email_verified: user.email_verified,
    },
    subscription: subscription ? {
      status: subscription.status,
      plan: subscription.plan,
      current_period_end: subscription.current_period_end,
    } : null,
  };
});

// Get user usage summary
fastify.get('/api/user/usage', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const usage = await getUsageSummary(user.tenant_id);
  return usage;
});

// Get user subscription
fastify.get('/api/user/subscription', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const subscription = await getSubscriptionWithPlan(user.tenant_id);
  if (!subscription) {
    return { plan: { display_name: 'Free', description: 'Free tier', price_monthly_formatted: 'Free' }, status: 'active' };
  }

  return {
    status: subscription.status,
    plan: subscription.plan,
    current_period_start: subscription.current_period_start,
    current_period_end: subscription.current_period_end,
    cancel_at_period_end: subscription.cancel_at_period_end,
  };
});

// Get user stats
fastify.get('/api/user/stats', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const [shards, traces, executions] = await Promise.all([
    queryOne(`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE lifecycle = 'promoted') as promoted
      FROM procedural_shards WHERE owner_id = $1
    `, [user.tenant_id]),
    queryOne(`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE synthesized = true) as synthesized
      FROM reasoning_traces WHERE owner_id = $1
    `, [user.tenant_id]),
    queryOne(`
      SELECT COALESCE(SUM(tokens_saved), 0) as tokens_saved
      FROM shard_executions se
      JOIN procedural_shards ps ON se.shard_id = ps.id
      WHERE ps.owner_id = $1
    `, [user.tenant_id]),
  ]);

  return {
    shards: {
      total: Number(shards?.['total'] ?? 0),
      promoted: Number(shards?.['promoted'] ?? 0),
    },
    traces: {
      total: Number(traces?.['total'] ?? 0),
      synthesized: Number(traces?.['synthesized'] ?? 0),
    },
    tokens_saved: Number(executions?.['tokens_saved'] ?? 0),
  };
});

// Get user's shards
fastify.get('/api/user/shards', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { lifecycle = 'all', limit = 50 } = request.query;
  const params = [user.tenant_id];
  let whereClause = 'WHERE owner_id = $1';

  if (lifecycle !== 'all' && ['promoted', 'candidate', 'deprecated'].includes(lifecycle)) {
    params.push(lifecycle);
    whereClause += ` AND lifecycle = $${params.length}`;
  }

  params.push(Math.min(Number(limit) || 50, 100));
  const shards = await query(`
    SELECT id, name, patterns, confidence, lifecycle, execution_count, success_count,
           failure_count, visibility, created_at, last_executed
    FROM procedural_shards
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `, params);

  return { shards };
});

// Get user's traces
fastify.get('/api/user/traces', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { limit = 50 } = request.query;
  const traces = await query(`
    SELECT id, input, output, tokens_used, synthesized, source, timestamp
    FROM reasoning_traces
    WHERE owner_id = $1
    ORDER BY timestamp DESC
    LIMIT $2
  `, [user.tenant_id, Math.min(Number(limit) || 50, 100)]);

  return { traces };
});

// Get user's API keys
fastify.get('/api/user/api-keys', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const keys = await listApiKeysByUser(user.id);
  return { keys };
});

// Create API key with optional TTL
fastify.post('/api/user/api-keys', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { name, scopes = ['read', 'write', 'execute'], expiresIn } = request.body || {};
  if (!name) {
    reply.status(400);
    return { error: 'Name is required' };
  }

  // Calculate expiration date from TTL
  let expiresAt = null;
  if (expiresIn) {
    const ttlMap = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
      '30d': 30 * 24 * 60 * 60 * 1000,
    };
    const ttlMs = ttlMap[expiresIn];
    if (ttlMs) {
      expiresAt = new Date(Date.now() + ttlMs);
    }
  }

  const result = await createApiKey(user.tenant_id, name, {
    userId: user.id,
    scopes,
    expiresAt,
  });
  return { key: result.key, id: result.apiKey.id, expiresAt: result.apiKey.expires_at };
});

// Revoke API key
fastify.delete('/api/user/api-keys/:id', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { id } = request.params;
  await revokeApiKey(id, user.id);
  return { success: true };
});

// ===========================================
// TOKEN BUNDLES
// ===========================================

// Get user's token bundles and balance
fastify.get('/api/user/bundles', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  // Get user's tenant_id
  const tenant = await queryOne('SELECT id FROM tenants WHERE user_id = $1', [user.id]);
  if (!tenant) {
    return { balance: 0, bundles: [] };
  }

  // Get total balance
  const balanceResult = await queryOne(`
    SELECT COALESCE(SUM(tokens_remaining), 0) as total
    FROM token_bundles
    WHERE tenant_id = $1
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > NOW())
  `, [tenant.id]);

  // Get bundle history
  const bundles = await query(`
    SELECT id, tokens_purchased, tokens_remaining, bundle_type,
           purchased_at, expires_at, status
    FROM token_bundles
    WHERE tenant_id = $1
    ORDER BY
      CASE status WHEN 'active' THEN 0 ELSE 1 END,
      created_at DESC
    LIMIT 20
  `, [tenant.id]);

  return {
    balance: parseInt(balanceResult?.total || '0', 10),
    bundles: bundles.map(b => ({
      id: b.id,
      tokens_purchased: b.tokens_purchased,
      tokens_remaining: b.tokens_remaining,
      bundle_type: b.bundle_type,
      purchased_at: b.purchased_at,
      expires_at: b.expires_at,
      status: b.status,
    })),
  };
});

// Purchase a token bundle
fastify.post('/api/user/bundles/purchase', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { bundle_size, tokens, price_cents } = request.body || {};
  if (!bundle_size || !tokens) {
    reply.status(400);
    return { error: 'bundle_size and tokens are required' };
  }

  // Get or create tenant
  let tenant = await queryOne('SELECT id FROM tenants WHERE user_id = $1', [user.id]);
  if (!tenant) {
    // Create tenant for user
    const tenantId = crypto.randomUUID();
    await query(`
      INSERT INTO tenants (id, user_id, name, tier, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'free', 'active', NOW(), NOW())
    `, [tenantId, user.id, user.name || user.email]);
    tenant = { id: tenantId };
  }

  // For now, direct purchase without Stripe (admin/testing)
  // In production, this would create a Stripe checkout session
  const isAdmin = user.role === 'admin';

  if (isAdmin) {
    // Admin can add bundles directly for testing
    const bundleId = crypto.randomUUID();
    await query(`
      INSERT INTO token_bundles (
        id, tenant_id, tokens_purchased, tokens_remaining,
        bundle_type, purchased_at, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $3, $4, NOW(), 'active', NOW(), NOW())
    `, [bundleId, tenant.id, tokens, bundle_size]);

    return {
      success: true,
      bundleId,
      message: 'Bundle added (admin mode)',
    };
  }

  // For regular users, return info about payment (Stripe integration pending)
  return {
    error: 'Payment integration coming soon. Please contact support.',
    bundle_size,
    tokens,
    price_cents,
  };
});

// ===========================================
// AI CONNECTORS (BYOK)
// ===========================================

// Simple encryption for API keys
const ENCRYPTION_KEY = (() => {
  const key = process.env['ENCRYPTION_KEY'] || process.env['JWT_SECRET'];
  if (!key && process.env['NODE_ENV'] === 'production') {
    throw new Error('ENCRYPTION_KEY or JWT_SECRET must be set in production');
  }
  return key || 'dev-only-key-not-for-production';
})();

function encryptApiKey(apiKey) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
  let encrypted = cipher.update(apiKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decryptApiKey(encryptedKey) {
  const [ivHex, encrypted] = encryptedKey.split(':');
  if (!ivHex || !encrypted) throw new Error('Invalid encrypted key format');
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY.padEnd(32).slice(0, 32)), iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// Get user's AI connectors
fastify.get('/api/user/connectors', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  // Get user's tenant_id
  const tenant = await queryOne('SELECT id FROM tenants WHERE user_id = $1', [user.id]);
  if (!tenant) {
    return { connectors: [] };
  }

  const connectors = await query(`
    SELECT provider, api_key_last4, base_url, default_model,
           is_enabled, validation_status, last_validated_at
    FROM user_ai_connectors
    WHERE tenant_id = $1
    ORDER BY provider
  `, [tenant.id]);

  return {
    connectors: connectors.map(c => ({
      provider: c.provider,
      hasKey: !!c.api_key_last4,
      apiKeyLast4: c.api_key_last4,
      baseUrl: c.base_url,
      defaultModel: c.default_model,
      isEnabled: c.is_enabled,
      validationStatus: c.validation_status,
      lastValidatedAt: c.last_validated_at,
    })),
  };
});

// Save AI connector
fastify.post('/api/user/connectors/:provider', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { provider } = request.params;
  const { api_key, base_url, default_model } = request.body || {};

  const validProviders = ['openai', 'anthropic', 'google', 'xai', 'ollama'];
  if (!validProviders.includes(provider)) {
    reply.status(400);
    return { error: 'Invalid provider' };
  }

  // Get or create tenant
  let tenant = await queryOne('SELECT id FROM tenants WHERE user_id = $1', [user.id]);
  if (!tenant) {
    const tenantId = crypto.randomUUID();
    await query(`
      INSERT INTO tenants (id, user_id, name, tier, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'free', 'active', NOW(), NOW())
    `, [tenantId, user.id, user.name || user.email]);
    tenant = { id: tenantId };
  }

  // Check if connector exists
  const existing = await queryOne('SELECT id FROM user_ai_connectors WHERE tenant_id = $1 AND provider = $2', [tenant.id, provider]);

  const encryptedKey = api_key ? encryptApiKey(api_key) : null;
  const keyLast4 = api_key ? api_key.slice(-4) : null;

  if (existing) {
    // Update existing
    await query(`
      UPDATE user_ai_connectors SET
        api_key_encrypted = COALESCE($1, api_key_encrypted),
        api_key_last4 = COALESCE($2, api_key_last4),
        base_url = COALESCE($3, base_url),
        default_model = COALESCE($4, default_model),
        validation_status = CASE WHEN $1 IS NOT NULL THEN 'unknown' ELSE validation_status END,
        updated_at = NOW()
      WHERE tenant_id = $5 AND provider = $6
    `, [encryptedKey, keyLast4, base_url, default_model, tenant.id, provider]);
  } else {
    // Create new
    await query(`
      INSERT INTO user_ai_connectors (
        id, tenant_id, provider, api_key_encrypted, api_key_last4,
        base_url, default_model, is_enabled, validation_status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, 'unknown', NOW(), NOW())
    `, [crypto.randomUUID(), tenant.id, provider, encryptedKey, keyLast4, base_url, default_model]);
  }

  return { success: true };
});

// Test AI connector
fastify.post('/api/user/connectors/test', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { provider, api_key, base_url } = request.body || {};

  if (!provider) {
    reply.status(400);
    return { error: 'Provider is required' };
  }

  // Get tenant
  const tenant = await queryOne('SELECT id FROM tenants WHERE user_id = $1', [user.id]);

  // Use provided key or get from database
  let testKey = api_key;
  let testBaseUrl = base_url;

  if (!testKey && tenant) {
    const connector = await queryOne('SELECT api_key_encrypted, base_url FROM user_ai_connectors WHERE tenant_id = $1 AND provider = $2', [tenant.id, provider]);
    if (connector?.api_key_encrypted) {
      testKey = decryptApiKey(connector.api_key_encrypted);
    }
    if (connector?.base_url) {
      testBaseUrl = connector.base_url;
    }
  }

  let isValid = false;
  let error = null;

  try {
    switch (provider) {
      case 'openai': {
        if (!testKey) {
          error = 'No API key configured';
          break;
        }
        const response = await fetch('https://api.openai.com/v1/models', {
          headers: { 'Authorization': `Bearer ${testKey}` },
        });
        isValid = response.ok;
        if (!isValid) error = `HTTP ${response.status}`;
        break;
      }
      case 'anthropic': {
        if (!testKey) {
          error = 'No API key configured';
          break;
        }
        isValid = testKey.startsWith('sk-ant-');
        if (!isValid) error = 'Invalid key format (should start with sk-ant-)';
        break;
      }
      case 'google': {
        if (!testKey) {
          error = 'No API key configured';
          break;
        }
        const googleBaseUrl = testBaseUrl || 'https://generativelanguage.googleapis.com/v1beta';
        const response = await fetch(`${googleBaseUrl}/models?key=${testKey}`);
        isValid = response.ok;
        if (!isValid) error = `HTTP ${response.status}`;
        break;
      }
      case 'xai': {
        if (!testKey) {
          error = 'No API key configured';
          break;
        }
        const response = await fetch('https://api.x.ai/v1/models', {
          headers: { 'Authorization': `Bearer ${testKey}` },
        });
        isValid = response.ok;
        if (!isValid) error = `HTTP ${response.status}`;
        break;
      }
      case 'ollama': {
        const ollamaUrl = testBaseUrl || 'http://localhost:11434';
        const response = await fetch(`${ollamaUrl}/api/tags`);
        isValid = response.ok;
        if (!isValid) error = `HTTP ${response.status}`;
        break;
      }
      default:
        error = 'Unknown provider';
    }
  } catch (e) {
    error = e instanceof Error ? e.message : 'Connection failed';
  }

  // Update validation status if we have a tenant and connector
  if (tenant) {
    await query(`
      UPDATE user_ai_connectors SET
        last_validated_at = NOW(),
        validation_status = $1,
        validation_error = $2,
        updated_at = NOW()
      WHERE tenant_id = $3 AND provider = $4
    `, [isValid ? 'valid' : 'invalid', error, tenant.id, provider]);
  }

  return { success: isValid, error };
});

// Delete AI connector
fastify.delete('/api/user/connectors/:provider', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { provider } = request.params;
  const tenant = await queryOne('SELECT id FROM tenants WHERE user_id = $1', [user.id]);

  if (tenant) {
    await query('DELETE FROM user_ai_connectors WHERE tenant_id = $1 AND provider = $2', [tenant.id, provider]);
  }

  return { success: true };
});

// Save model preferences
fastify.post('/api/user/connectors/preferences', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { primary_model, embedding_model } = request.body || {};

  // Get or create tenant
  let tenant = await queryOne('SELECT id FROM tenants WHERE user_id = $1', [user.id]);
  if (!tenant) {
    const tenantId = crypto.randomUUID();
    await query(`
      INSERT INTO tenants (id, user_id, name, tier, status, created_at, updated_at)
      VALUES ($1, $2, $3, 'free', 'active', NOW(), NOW())
    `, [tenantId, user.id, user.name || user.email]);
    tenant = { id: tenantId };
  }

  // Update tenant preferences
  await query(`
    UPDATE tenants SET
      primary_model = COALESCE($1, primary_model),
      embedding_model = COALESCE($2, embedding_model),
      updated_at = NOW()
    WHERE id = $3
  `, [primary_model, embedding_model, tenant.id]);

  return { success: true };
});

// Update profile
fastify.patch('/api/user/profile', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { name, preferredName } = request.body || {};
  if (name !== undefined) {
    await query('UPDATE users SET name = $1, updated_at = NOW() WHERE id = $2', [name, user.id]);
  }
  if (preferredName !== undefined) {
    await query('UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2', [preferredName, user.id]);
  }

  return { success: true };
});

// Update password
fastify.post('/api/user/password', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { currentPassword, newPassword } = request.body || {};
  if (!currentPassword || !newPassword) {
    reply.status(400);
    return { error: 'Current and new passwords are required' };
  }

  try {
    await changePassword(user.id, currentPassword, newPassword);
    return { success: true };
  } catch (e) {
    reply.status(400);
    return { error: e instanceof Error ? e.message : 'Failed to update password' };
  }
});

// Get user's recent activity feed
fastify.get('/api/user/activity', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { limit = 20 } = request.query;
  const safeLimit = Math.min(Number(limit) || 20, 50);

  // Get recent events from multiple sources
  const [executions, traces, shards] = await Promise.all([
    // Recent shard executions
    query(`
      SELECT
        'execution' as type,
        se.id,
        ps.name as shard_name,
        se.success,
        se.tokens_saved,
        se.execution_ms,
        se.created_at as timestamp
      FROM shard_executions se
      JOIN procedural_shards ps ON se.shard_id = ps.id
      WHERE ps.owner_id = $1
      ORDER BY se.created_at DESC
      LIMIT $2
    `, [user.tenant_id, safeLimit]),

    // Recent trace ingestions
    query(`
      SELECT
        'trace' as type,
        id,
        SUBSTRING(input, 1, 100) as preview,
        tokens_used,
        synthesized,
        source,
        timestamp
      FROM reasoning_traces
      WHERE owner_id = $1
      ORDER BY timestamp DESC
      LIMIT $2
    `, [user.tenant_id, safeLimit]),

    // Recent shard promotions/creations
    query(`
      SELECT
        'shard' as type,
        id,
        name,
        lifecycle,
        confidence,
        created_at as timestamp
      FROM procedural_shards
      WHERE owner_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `, [user.tenant_id, safeLimit]),
  ]);

  // Merge and sort by timestamp
  const activities = [
    ...executions.map(e => ({ ...e, type: 'execution' })),
    ...traces.map(t => ({ ...t, type: 'trace' })),
    ...shards.map(s => ({ ...s, type: 'shard' })),
  ]
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, safeLimit);

  return { activities };
});

// Get user's usage history (for charts)
fastify.get('/api/user/usage-history', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { days = 7 } = request.query;
  const safeDays = Math.min(Math.max(1, Number(days) || 7), 30);

  // Get daily usage for the past N days
  const history = await query(`
    SELECT
      date,
      COALESCE(executions, 0) as executions,
      COALESCE(traces, 0) as traces,
      COALESCE(api_requests, 0) as api_requests
    FROM usage_records
    WHERE tenant_id = $1
      AND date >= CURRENT_DATE - INTERVAL '1 day' * $2
    ORDER BY date ASC
  `, [user.tenant_id, safeDays]);

  // Fill in missing days with zeros
  const filledHistory = [];
  const today = new Date();
  for (let i = safeDays - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];

    const existing = history.find(h => h.date?.toISOString?.()?.split('T')[0] === dateStr || h.date === dateStr);
    filledHistory.push({
      date: dateStr,
      executions: Number(existing?.executions ?? 0),
      traces: Number(existing?.traces ?? 0),
      api_requests: Number(existing?.api_requests ?? 0),
    });
  }

  return { history: filledHistory };
});

// ===========================================
// ADMIN API ENDPOINTS (Admin-only)
// ===========================================

async function requireAdmin(request, reply) {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return null;
  }
  if (user.role !== 'admin' && user.role !== 'super_admin') {
    reply.status(403);
    return null;
  }
  return user;
}

// Check if current user is admin
fastify.get('/api/v1/admin/me', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  return {
    isAdmin: user.role === 'admin',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
    },
  };
});

// Get admin stats
fastify.get('/api/v1/admin/stats', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const tenantScope = admin.role !== 'super_admin';
  const tenantParams = tenantScope ? [admin.tenant_id] : [];
  const tenantWhere = tenantScope ? `WHERE tenant_id = $1` : '';

  const [users, shards, traces, executions] = await Promise.all([
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'suspended') as suspended,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today
      FROM users ${tenantWhere}
    `, tenantParams),
    queryOne(`
      SELECT COUNT(*) as total
      FROM procedural_shards
    `),
    queryOne(`
      SELECT COUNT(*) as total
      FROM reasoning_traces
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as today
      FROM shard_executions
    `),
  ]);

  return {
    users: {
      total: Number(users?.['total'] ?? 0),
      active: Number(users?.['active'] ?? 0),
      suspended: Number(users?.['suspended'] ?? 0),
      today: Number(users?.['today'] ?? 0),
    },
    content: {
      shards: Number(shards?.['total'] ?? 0),
      traces: Number(traces?.['total'] ?? 0),
      executions: Number(executions?.['total'] ?? 0),
      executionsToday: Number(executions?.['today'] ?? 0),
    },
  };
});

// List users (admin)
fastify.get('/api/v1/admin/users', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const { limit = 50, offset = 0, status, search, role, plan, sort = 'created_at:desc' } = request.query;
  const filterParams = [];
  let whereClause = 'WHERE 1=1';

  // Tenant scoping: admin sees only their tenant, super_admin sees all
  if (admin.role !== 'super_admin') {
    filterParams.push(admin.tenant_id);
    whereClause += ` AND u.tenant_id = $${filterParams.length}`;
  }

  if (status) {
    filterParams.push(status);
    whereClause += ` AND u.status = $${filterParams.length}`;
  }

  if (role) {
    filterParams.push(role);
    whereClause += ` AND u.role = $${filterParams.length}`;
  }

  if (plan) {
    filterParams.push(plan);
    whereClause += ` AND t.tier = $${filterParams.length}`;
  }

  if (search) {
    filterParams.push(`%${search}%`);
    whereClause += ` AND (u.email ILIKE $${filterParams.length} OR u.name ILIKE $${filterParams.length})`;
  }

  const [sortField, sortDir] = sort.split(':');
  const validSortFields = ['created_at', 'email', 'name', 'status'];
  const orderBy = validSortFields.includes(sortField) ? sortField : 'created_at';
  const orderDir = sortDir === 'asc' ? 'ASC' : 'DESC';

  const limitVal = Math.min(Number(limit) || 50, 200);
  const offsetVal = Math.max(Number(offset) || 0, 0);

  // Get count first
  const countResult = await queryOne(`
    SELECT COUNT(*) as total
    FROM users u
    LEFT JOIN tenants t ON u.tenant_id = t.id
    ${whereClause}
  `, filterParams);

  const queryParams = [...filterParams, limitVal, offsetVal];

  const users = await query(`
    SELECT u.id, u.email, u.name, u.tenant_id, u.role, u.status, u.created_at,
           u.email_verified, u.last_login_at,
           t.tier as plan,
           p.display_name as plan_display_name
    FROM users u
    LEFT JOIN tenants t ON u.tenant_id = t.id
    LEFT JOIN plans p ON p.name = t.tier AND p.is_active = true
    ${whereClause}
    ORDER BY u.${orderBy} ${orderDir}
    LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}
  `, queryParams);

  // Map to expected format
  const mappedUsers = users.map(u => ({
    id: u.id,
    email: u.email,
    name: u.name,
    tenantId: u.tenant_id,
    role: u.role,
    status: u.status,
    emailVerified: u.email_verified,
    createdAt: u.created_at,
    lastLoginAt: u.last_login_at,
    plan: u.plan || 'free',
    planDisplayName: u.plan_display_name || 'Free',
  }));

  return { users: mappedUsers, total: parseInt(countResult?.total || '0', 10) };
});

// Get single user (admin)
fastify.get('/api/v1/admin/users/:id', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;
  const user = await queryOne(`
    SELECT u.id, u.email, u.name, u.tenant_id, u.role, u.status, u.email_verified,
           u.created_at, u.updated_at, u.failed_login_attempts, u.locked_until, u.last_login_at
    FROM users u WHERE u.id = $1
  `, [id]);

  if (!user) {
    reply.status(404);
    return { error: 'User not found' };
  }

  // Get tier info from tenant + plans
  const subscription = await queryOne(`
    SELECT t.tier as plan_name, p.display_name as plan_display_name,
           t.tier_expires_at as current_period_end
    FROM tenants t
    LEFT JOIN plans p ON p.name = t.tier AND p.is_active = true
    WHERE t.id = $1
  `, [user.tenant_id]);

  // Get user stats
  const stats = await queryOne(`
    SELECT
      (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = $1) as shards,
      (SELECT COUNT(*) FROM reasoning_traces WHERE owner_id = $1) as traces,
      (SELECT COUNT(*) FROM shard_executions WHERE executor_tenant_id = $1) as executions
  `, [user.tenant_id]);

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      tenantId: user.tenant_id,
      role: user.role,
      status: user.status,
      emailVerified: user.email_verified,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      failedLoginAttempts: user.failed_login_attempts || 0,
      lockedUntil: user.locked_until,
    },
    subscription: subscription ? {
      planName: subscription.plan_name || 'free',
      planDisplayName: subscription.plan_display_name || 'Free',
      status: 'active',
      currentPeriodEnd: subscription.current_period_end,
    } : null,
    stats: {
      shards: parseInt(stats?.shards || '0', 10),
      traces: parseInt(stats?.traces || '0', 10),
      executions: parseInt(stats?.executions || '0', 10),
    },
  };
});

// Create user (admin)
fastify.post('/api/v1/admin/users', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const { email, password, display_name, role } = request.body || {};
  if (!email || !password) {
    reply.status(400);
    return { error: 'Email and password are required' };
  }

  try {
    const tenantId = `tenant_${crypto.randomUUID().replace(/-/g, '').slice(0, 26)}`;
    const slug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 100);
    await query(
      `INSERT INTO tenants (id, name, slug, type, tier) VALUES ($1, $2, $3, 'user', 'free')`,
      [tenantId, display_name || email.split('@')[0], slug]
    );
    const result = await createUser(tenantId, { email, password, display_name });

    // Set role if specified (default is 'user')
    if (role && role !== 'user') {
      await query(`UPDATE users SET role = $1 WHERE id = $2`, [role, result.user.id]);
    }

    // Auto-verify email for admin-created users
    await query(`UPDATE users SET email_verified = true, email_verification_token = NULL WHERE id = $1`, [result.user.id]);

    return { user: { ...result.user, role: role || 'user', emailVerified: true } };
  } catch (err) {
    reply.status(400);
    return { error: err.message || 'Failed to create user' };
  }
});

// Suspend user (admin)
fastify.post('/api/v1/admin/users/:id/suspend', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;
  await query(`UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1`, [id]);
  return { success: true };
});

// Unsuspend user (admin)
fastify.post('/api/v1/admin/users/:id/unsuspend', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;
  await query(`UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1`, [id]);
  return { success: true };
});

// Update user role (admin)
fastify.patch('/api/v1/admin/users/:id/role', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;
  const { role } = request.body || {};

  if (!role || !['user', 'admin'].includes(role)) {
    reply.status(400);
    return { error: 'Invalid role' };
  }

  await query(`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`, [role, id]);
  return { success: true };
});

// Update user (admin) - combined update for name, role, status, plan
fastify.patch('/api/v1/admin/users/:id', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;
  const { display_name, role, status, plan } = request.body || {};

  // Prevent self-demotion from admin
  if (id === admin.id && role && role !== 'admin') {
    reply.status(400);
    return { error: 'Cannot demote yourself from admin' };
  }

  // Update user fields
  if (display_name !== undefined || role || status) {
    const updates = [];
    const values = [];
    let paramCount = 0;

    if (display_name !== undefined) {
      paramCount++;
      updates.push(`name = $${paramCount}`);
      values.push(display_name);
    }
    if (role && ['user', 'admin'].includes(role)) {
      paramCount++;
      updates.push(`role = $${paramCount}`);
      values.push(role);
    }
    if (status && ['active', 'suspended', 'deleted'].includes(status)) {
      paramCount++;
      updates.push(`status = $${paramCount}`);
      values.push(status);
    }

    if (updates.length > 0) {
      paramCount++;
      updates.push(`updated_at = NOW()`);
      values.push(id);
      await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${paramCount}`, values);
    }
  }

  // Update plan/tier if specified
  if (plan) {
    // Validate plan name exists
    const validPlan = await queryOne('SELECT name FROM plans WHERE name = $1 AND is_active = true', [plan]);
    if (validPlan) {
      await query('UPDATE tenants SET tier = $1, updated_at = NOW() WHERE id = (SELECT tenant_id FROM users WHERE id = $2)', [plan, id]);
    }
  }

  return { success: true };
});

// Delete user (admin)
fastify.delete('/api/v1/admin/users/:id', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;

  // Prevent self-deletion
  if (id === admin.id) {
    reply.status(400);
    return { error: 'Cannot delete yourself' };
  }

  // Check if user exists
  const user = await queryOne('SELECT id, email, role FROM users WHERE id = $1', [id]);
  if (!user) {
    reply.status(404);
    return { error: 'User not found' };
  }

  // Prevent deleting other admins (optional protection)
  if (user.role === 'admin') {
    reply.status(400);
    return { error: 'Cannot delete admin users. Demote to user first.' };
  }

  // Soft delete - set status to deleted
  await query('UPDATE users SET status = $1, updated_at = NOW() WHERE id = $2', ['deleted', id]);

  return { success: true, message: `User ${user.email} has been deleted` };
});

// List tenants (admin)
fastify.get('/api/v1/admin/tenants', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const tenants = await query(`
    SELECT
      u.tenant_id as id,
      COUNT(DISTINCT u.id) as user_count,
      MIN(u.created_at) as created_at,
      p.name as plan_name,
      s.status as subscription_status,
      (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = u.tenant_id) as shard_count,
      (SELECT COUNT(*) FROM usage_records WHERE tenant_id = u.tenant_id AND date = CURRENT_DATE) as executions_today
    FROM users u
    LEFT JOIN subscriptions s ON u.tenant_id = s.tenant_id AND s.status IN ('active', 'trialing')
    LEFT JOIN plans p ON s.plan_id = p.id
    GROUP BY u.tenant_id, p.name, s.status
    ORDER BY MIN(u.created_at) DESC
    LIMIT 100
  `);

  return { tenants };
});

// List plans (admin)
fastify.get('/api/v1/admin/plans', async (request, reply) => {
  const admin = await requireAdmin(request, reply);
  if (!admin) return { error: 'Admin access required' };

  const plans = await query(`
    SELECT p.*,
           (SELECT COUNT(*) FROM subscriptions WHERE plan_id = p.id AND status = 'active') as subscriber_count
    FROM plans p
    WHERE p.is_active = true
    ORDER BY p.price_monthly ASC
  `);

  return { plans };
});

// Agent Hub admin routes
import { registerAdminHubRoutes } from './routes/admin-hub/index.js';
await registerAdminHubRoutes(fastify, requireAdmin, query, queryOne);

// System Assistant (agentic AI for fleet management)
import { registerAssistantRoutes } from './routes/admin-assistant.js';
await registerAssistantRoutes(fastify, requireAdmin, query, queryOne);

// ===========================================
// WAITLIST
// ===========================================

const waitlistRateLimit = new Map(); // ip -> { count, resetAt }
const WAITLIST_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const WAITLIST_MAX = 5; // 5 submissions per 15 min per IP

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of waitlistRateLimit.entries()) {
    if (v.resetAt < now) waitlistRateLimit.delete(k);
  }
}, 60000);

fastify.post('/api/v1/auth/waitlist', async (request, reply) => {
  const { name, email, website, source } = request.body || {};

  // Honeypot — bots fill hidden fields
  if (website) {
    return reply.send({ ok: true }); // silent success to fool bots
  }

  // Per-IP rate limit (tighter than global)
  const ip = request.ip || 'unknown';
  const now = Date.now();
  let entry = waitlistRateLimit.get(ip);
  if (!entry || entry.resetAt < now) {
    entry = { count: 1, resetAt: now + WAITLIST_WINDOW_MS };
    waitlistRateLimit.set(ip, entry);
  } else {
    entry.count++;
  }
  if (entry.count > WAITLIST_MAX) {
    return reply.code(429).send({ error: 'Too many requests. Please try again later.' });
  }

  // Required fields
  if (!name || !email) {
    return reply.code(400).send({ error: 'Name and email are required' });
  }

  // Input validation
  const trimmedName = String(name).trim().slice(0, 100);
  const trimmedEmail = String(email).trim().toLowerCase().slice(0, 254);

  if (trimmedName.length < 1) {
    return reply.code(400).send({ error: 'Name is required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
    return reply.code(400).send({ error: 'Invalid email address' });
  }

  // Block disposable email domains
  const disposable = ['mailinator.com', 'guerrillamail.com', 'tempmail.com', 'throwaway.email', 'yopmail.com', 'sharklasers.com', 'guerrillamailblock.com', 'grr.la', 'dispostable.com', 'trashmail.com'];
  const domain = trimmedEmail.split('@')[1];
  if (disposable.includes(domain)) {
    return reply.code(400).send({ error: 'Please use a valid email address' });
  }

  // Sanitize source
  const VALID_SOURCES = ['orcastr8r', 'claw-replay', 'askalf'];
  const trimmedSource = VALID_SOURCES.includes(String(source || '').trim()) ? String(source).trim() : 'orcastr8r';

  try {
    await queryOne(
      `INSERT INTO waitlist (id, name, email, source) VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = $2, source = $4, created_at = NOW()
       RETURNING id`,
      [crypto.randomUUID(), trimmedName, trimmedEmail, trimmedSource],
    );

    // Fire-and-forget: send welcome + admin notification
    sendWaitlistEmail(trimmedEmail, { name: trimmedName, email: trimmedEmail }, trimmedSource).catch(err =>
      console.error('[Waitlist] Email send failed:', err)
    );
    sendAdminNotification(process.env['ADMIN_EMAIL'] || 'support@orcastr8r.com', {
      type: 'waitlist_signup',
      email: trimmedEmail,
      source: trimmedSource,
      timestamp: new Date().toISOString(),
    }).catch(err =>
      console.error('[Waitlist] Admin notification failed:', err)
    );

    return reply.send({ ok: true });
  } catch (err) {
    console.error('[Waitlist] Error:', err);
    return reply.code(500).send({ error: 'Failed to join waitlist' });
  }
});

// ===========================================
// AUTH PROXY — forward auth routes to Forge
// ===========================================

const FORGE_AUTH_URL = process.env.FORGE_URL || 'http://forge:3005';

async function proxyToForge(request, reply, path) {
  try {
    const res = await fetch(`${FORGE_AUTH_URL}${path}`, {
      method: request.method,
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-host': request.headers.host || '',
        ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
        'x-forwarded-for': request.ip || '',
        'user-agent': request.headers['user-agent'] || '',
      },
      body: request.method !== 'GET' ? JSON.stringify(request.body || {}) : undefined,
    });
    const data = await res.json();

    // Forward set-cookie headers from Forge
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) reply.header('set-cookie', setCookie);

    return reply.code(res.status).send(data);
  } catch (err) {
    console.error(`[Auth Proxy] Error forwarding to ${path}:`, err.message);
    return reply.code(502).send({ error: 'Service unavailable' });
  }
}

// Get current authenticated user (called by frontend after login)
fastify.get('/api/v1/auth/me', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const subscription = await getSubscriptionWithPlan(user.tenant_id);

  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.email_verified,
      displayName: user.display_name,
      role: user.role,
    },
    subscription: subscription ? {
      status: subscription.status,
      plan: subscription.plan,
      current_period_end: subscription.current_period_end,
    } : null,
  };
});

const authProxyRoutes = [
  'login', 'register', 'logout', 'check',
  'forgot-password', 'reset-password',
  'verify-email', 'resend-verification',
];

for (const route of authProxyRoutes) {
  fastify.post(`/api/v1/auth/${route}`, (req, reply) =>
    proxyToForge(req, reply, `/api/v1/auth/${route}`));
}

// GET for auth check (session validation)
fastify.get('/api/v1/auth/check', (req, reply) =>
  proxyToForge(req, reply, '/api/v1/auth/check'));

// ===========================================
// SPA FALLBACK - Serve index.html for client routes
// ===========================================

// Catch-all for React Router (must be after all API routes)
fastify.setNotFoundHandler((request, reply) => {
  // If it's an API route, return 404
  if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
    return reply.code(404).send({ error: 'Not found' });
  }
  // For all other routes, serve React app
  return reply.sendFile('index.html');
});

// ===========================================
// START SERVER
// ===========================================

// Start server
const port = process.env['PORT'] ?? 3001;
const host = process.env['HOST'] ?? '0.0.0.0';

fastify.listen({ port: Number(port), host }, (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`SUBSTRATE Dashboard running at ${address}`);
});
