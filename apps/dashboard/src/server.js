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
} from '@askalf/observability';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import { initializePool, query, queryOne } from '@askalf/database';
import { initializeEmailFromEnv } from '@askalf/email';
import {
  getUserById,
  listApiKeysByUser,
  createApiKey,
  revokeApiKey,
} from '@askalf/auth';
import { getMasterSession } from './master-session.js';
import { getCodexSession } from './codex-session.js';
import { createEventBridge } from './event-bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize database
const databaseUrl = process.env['DATABASE_URL'] ?? 'postgresql://substrate:substrate_dev@localhost:5432/askalf';
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
  'https://askalf.org',
  'https://www.askalf.org',
  // Localhost origins (dashboard serves on 3001, always allow its own origin)
  'http://localhost:3001',
  'http://localhost:3005',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
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
  secret: (() => {
    const s = process.env['SESSION_SECRET'];
    if (!s && process.env['NODE_ENV'] === 'production') throw new Error('SESSION_SECRET must be set in production');
    return s || 'dev-session-secret-not-for-production';
  })(),
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

let _cachedAdminUser = null;
async function getAdminUser() {
  if (_cachedAdminUser) return _cachedAdminUser;
  // Self-hosted: query stub users table for persisted preferences
  try {
    const row = await queryOne('SELECT * FROM users WHERE id = $1', ['selfhosted-admin']);
    if (row) {
      _cachedAdminUser = row;
      return _cachedAdminUser;
    }
  } catch { /* table may not exist yet */ }
  _cachedAdminUser = {
    id: 'selfhosted-admin',
    email: process.env.SELFHOSTED_ADMIN_EMAIL || 'admin@localhost',
    name: 'Admin',
    display_name: 'Admin',
    role: 'super_admin',
    status: 'active',
    onboarding_completed_at: new Date(),
    theme_preference: 'dark',
  };
  return _cachedAdminUser;
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
    return reply.code(503).send({ status: 'degraded', service: 'dashboard', database: 'disconnected' });
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


// CLI package tarball — serve for install scripts
fastify.get('/releases/cli-latest.tar.gz', async (_request, reply) => {
  const fs = await import('fs/promises');
  const tarballPath = join(__dirname, '../public/app/releases/cli-latest.tar.gz');
  try {
    const content = await fs.readFile(tarballPath);
    reply.header('Content-Type', 'application/gzip');
    reply.header('Content-Disposition', 'attachment; filename="cli-latest.tar.gz"');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(content);
  } catch {
    return reply.code(404).send('CLI package not found. Run scripts/build-cli.sh to generate it.');
  }
});

fastify.get('/api/v1/cli/package', async (_request, reply) => {
  const fs = await import('fs/promises');
  const tarballPath = join(__dirname, '../public/app/releases/cli-latest.tar.gz');
  try {
    const content = await fs.readFile(tarballPath);
    reply.header('Content-Type', 'application/gzip');
    reply.header('Content-Disposition', 'attachment; filename="cli-latest.tar.gz"');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(content);
  } catch {
    return reply.code(404).send('CLI package not found. Run scripts/build-cli.sh to generate it.');
  }
});

// CLI installer scripts — serve as plain text for curl/irm piping
fastify.get('/install.sh', async (_request, reply) => {
  const fs = await import('fs/promises');
  try {
    const content = await fs.readFile(join(__dirname, '../public/app/install.sh'), 'utf-8');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(content);
  } catch {
    return reply.code(404).send('# Installer not found');
  }
});

fastify.get('/install.ps1', async (_request, reply) => {
  const fs = await import('fs/promises');
  try {
    const content = await fs.readFile(join(__dirname, '../public/app/install.ps1'), 'utf-8');
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Cache-Control', 'public, max-age=300');
    return reply.send(content);
  } catch {
    return reply.code(404).send('# Installer not found');
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
  const user = await getAdminUser();

  // Track connection with heartbeat
  const pingInterval = setInterval(() => {
    if (socket.readyState === 1) {
      try { socket.ping(); } catch { /* ignore */ }
    }
  }, 30000);

  wsClients.set(socket, { lastPing: Date.now(), pingInterval, userId: user?.id, isAuthenticated: true });
  console.log(`WebSocket client connected (${wsClients.size} total, user: ${user?.id})`);

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

// ===========================================
// WEBSOCKET - Master Session (Claude Code PTY)
// ===========================================

const masterSession = getMasterSession();

fastify.get('/ws/master', { websocket: true }, async (socket, req) => {
  const user = await getAdminUser();

  // Register this WebSocket as a subscriber
  masterSession.addSubscriber(socket);
  console.log(`[MasterSession] WS client connected (user: ${user?.id})`);

  // Heartbeat ping/pong — keep connection alive through proxies
  let lastPong = Date.now();
  const pingInterval = setInterval(() => {
    if (socket.readyState === 1) {
      if (Date.now() - lastPong > 90_000) {
        console.log('[MasterSession] WS client timed out (no pong)');
        socket.close();
        return;
      }
      try { socket.ping(); } catch { /* ignore */ }
    }
  }, 30_000);

  socket.on('pong', () => { lastPong = Date.now(); });

  // Send history buffer for reconnection
  const history = masterSession.getHistory();
  if (history.length > 0) {
    socket.send(JSON.stringify({ type: 'history', data: history }));
  }

  // Send current status
  socket.send(JSON.stringify({ type: 'status', data: masterSession.getStatus() }));

  socket.on('message', (msg) => {
    lastPong = Date.now(); // Any message counts as alive
    try {
      const parsed = JSON.parse(msg.toString());
      switch (parsed.type) {
        case 'input':
          masterSession.sendInput(parsed.data || '');
          break;
        case 'signal':
          masterSession.sendSignal(parsed.signal || 'SIGINT');
          break;
        case 'resize':
          if (typeof parsed.cols === 'number' && typeof parsed.rows === 'number' &&
              parsed.cols > 0 && parsed.rows > 0) {
            masterSession.resize(parsed.cols, parsed.rows);
          }
          break;
        case 'restart':
          masterSession.restart();
          break;
        case 'setCwd':
          if (parsed.cwd && typeof parsed.cwd === 'string') {
            masterSession.setCwd(parsed.cwd);
          }
          break;
        case 'ping':
          if (socket.readyState === 1) {
            try { socket.send(JSON.stringify({ type: 'pong' })); } catch { /* ignore */ }
          }
          break;
        default:
          break;
      }
    } catch (err) {
      console.warn('[MasterSession] Invalid WS message:', err.message);
    }
  });

  socket.on('close', () => {
    clearInterval(pingInterval);
    masterSession.removeSubscriber(socket);
    console.log(`[MasterSession] WS client disconnected`);
  });

  socket.on('error', () => {
    clearInterval(pingInterval);
    masterSession.removeSubscriber(socket);
  });
});

// Master session status endpoint (REST)
fastify.get('/api/v1/admin/master-session/status', async (request, reply) => {
  return masterSession.getStatus();
});

// ===========================================
// WEBSOCKET - Codex Session (OpenAI Codex PTY)
// ===========================================

const codexSession = getCodexSession();

fastify.get('/ws/codex', { websocket: true }, async (socket, req) => {
  const user = await getAdminUser();

  codexSession.addSubscriber(socket);
  console.log(`[CodexSession] WS client connected (user: ${user?.id})`);

  // Heartbeat ping/pong
  let lastPong = Date.now();
  const pingInterval = setInterval(() => {
    if (socket.readyState === 1) {
      if (Date.now() - lastPong > 90_000) {
        console.log('[CodexSession] WS client timed out (no pong)');
        socket.close();
        return;
      }
      try { socket.ping(); } catch { /* ignore */ }
    }
  }, 30_000);

  socket.on('pong', () => { lastPong = Date.now(); });

  const history = codexSession.getHistory();
  if (history.length > 0) {
    socket.send(JSON.stringify({ type: 'history', data: history }));
  }

  socket.send(JSON.stringify({ type: 'status', data: codexSession.getStatus() }));

  socket.on('message', (msg) => {
    lastPong = Date.now();
    try {
      const parsed = JSON.parse(msg.toString());
      switch (parsed.type) {
        case 'input':
          codexSession.sendInput(parsed.data || '');
          break;
        case 'signal':
          codexSession.sendSignal(parsed.signal || 'SIGINT');
          break;
        case 'resize':
          if (typeof parsed.cols === 'number' && typeof parsed.rows === 'number' &&
              parsed.cols > 0 && parsed.rows > 0) {
            codexSession.resize(parsed.cols, parsed.rows);
          }
          break;
        case 'restart':
          codexSession.restart();
          break;
        case 'setCwd':
          if (parsed.cwd && typeof parsed.cwd === 'string') {
            codexSession.setCwd(parsed.cwd);
          }
          break;
        case 'ping':
          if (socket.readyState === 1) {
            try { socket.send(JSON.stringify({ type: 'pong' })); } catch { /* ignore */ }
          }
          break;
        default:
          break;
      }
    } catch (err) {
      console.warn('[CodexSession] Invalid WS message:', err.message);
    }
  });

  socket.on('close', () => {
    clearInterval(pingInterval);
    codexSession.removeSubscriber(socket);
    console.log(`[CodexSession] WS client disconnected`);
  });

  socket.on('error', () => {
    clearInterval(pingInterval);
    codexSession.removeSubscriber(socket);
  });
});

fastify.get('/api/v1/admin/codex-session/status', async (request, reply) => {
  return codexSession.getStatus();
});

// ===========================================
// PROJECTS - List directories and worktrees in workspace
// ===========================================

import { readdir, stat } from 'fs/promises';
import { execSync } from 'child_process';

fastify.get('/api/v1/admin/projects', async (request, reply) => {
  const workspaceDir = process.env['WORKSPACE_DIR'] || '/workspace';
  const projects = [];

  // Add workspace root
  projects.push({ path: workspaceDir, name: 'workspace (root)', type: 'root' });

  // List top-level subdirectories that look like projects (have package.json, go.mod, Cargo.toml, etc.)
  try {
    const entries = await readdir(workspaceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = `${workspaceDir}/${entry.name}`;
      // Check for project markers
      const markers = ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'pom.xml', 'Makefile', 'Dockerfile'];
      for (const marker of markers) {
        try {
          await stat(`${fullPath}/${marker}`);
          projects.push({ path: fullPath, name: entry.name, type: 'directory' });
          break;
        } catch { /* not a project dir */ }
      }
    }

    // Also check apps/ subdirectory (monorepo pattern)
    try {
      const appsEntries = await readdir(`${workspaceDir}/apps`, { withFileTypes: true });
      for (const entry of appsEntries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const fullPath = `${workspaceDir}/apps/${entry.name}`;
        projects.push({ path: fullPath, name: `apps/${entry.name}`, type: 'app' });
      }
    } catch { /* no apps/ dir */ }

    // Also check packages/ subdirectory
    try {
      const pkgEntries = await readdir(`${workspaceDir}/packages`, { withFileTypes: true });
      for (const entry of pkgEntries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const fullPath = `${workspaceDir}/packages/${entry.name}`;
        projects.push({ path: fullPath, name: `packages/${entry.name}`, type: 'package' });
      }
    } catch { /* no packages/ dir */ }
  } catch (err) {
    console.warn('[Projects] Failed to list workspace:', err.message);
  }

  // List git worktrees
  try {
    const output = execSync('git worktree list --porcelain', { cwd: workspaceDir, timeout: 5000 }).toString();
    const worktrees = output.split('\n\n').filter(Boolean);
    for (const wt of worktrees) {
      const lines = wt.trim().split('\n');
      const pathLine = lines.find(l => l.startsWith('worktree '));
      const branchLine = lines.find(l => l.startsWith('branch '));
      if (pathLine && branchLine) {
        const wtPath = pathLine.replace('worktree ', '');
        const branch = branchLine.replace('branch refs/heads/', '');
        // Skip the main worktree (already listed as root)
        if (wtPath === workspaceDir) continue;
        projects.push({ path: wtPath, name: `worktree: ${branch}`, type: 'worktree', branch });
      }
    }
  } catch { /* git worktree not available */ }

  return { projects };
});

// Clone a remote repo into the workspace
const _cloneInFlight = new Set();
fastify.post('/api/v1/admin/projects/clone', async (request, reply) => {
  const { url, name } = request.body || {};
  if (!url || !name) return reply.code(400).send({ error: 'url and name required' });

  // Validate URL — only allow https git URLs (no shell metacharacters)
  if (!/^https:\/\/[a-zA-Z0-9._\-/]+\.git$/.test(url) && !/^https:\/\/github\.com\/[a-zA-Z0-9._\-]+\/[a-zA-Z0-9._\-]+$/.test(url)) {
    return reply.code(400).send({ error: 'Invalid URL — must be an HTTPS git URL' });
  }

  // Rate limit — one clone at a time
  if (_cloneInFlight.size >= 2) {
    return reply.code(429).send({ error: 'Clone already in progress, try again shortly' });
  }

  const safeName = name.replace(/[^a-zA-Z0-9_.-]/g, '-').slice(0, 100);
  const { resolve } = await import('path');
  const reposDir = resolve(workspaceDir, 'repos');
  const targetPath = resolve(reposDir, safeName);

  // Path traversal check
  if (!targetPath.startsWith(reposDir)) {
    return reply.code(400).send({ error: 'Invalid project name' });
  }

  try {
    const { existsSync, mkdirSync } = await import('fs');
    const { execFileSync } = await import('child_process');

    if (!existsSync(reposDir)) mkdirSync(reposDir, { recursive: true });

    if (existsSync(targetPath)) {
      return { path: targetPath, status: 'exists' };
    }

    _cloneInFlight.add(safeName);
    try {
      // execFileSync prevents shell injection — args passed as array, not string
      execFileSync('git', ['clone', '--depth', '1', url, targetPath], {
        timeout: 120000,
        stdio: 'pipe',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      });
    } finally {
      _cloneInFlight.delete(safeName);
    }

    return { path: targetPath, status: 'cloned' };
  } catch (err) {
    return reply.code(500).send({ error: `Clone failed: ${err.message}` });
  }
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

// Reusable stats function - uses forge tables (legacy SUBSTRATE tables removed)
async function getStats() {
  const [agents, executions, tickets, costs] = await Promise.all([
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'idle') as idle,
        COUNT(*) FILTER (WHERE status = 'paused') as paused,
        COUNT(*) FILTER (WHERE status = 'error') as errored
      FROM agents
      WHERE is_decommissioned = false
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') as last_24h
      FROM forge_executions
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress
      FROM tickets
    `),
    queryOne(`
      SELECT
        COUNT(*) as total,
        COALESCE(SUM(cost), 0) as total_cost,
        COALESCE(SUM(cost) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours'), 0) as today_cost
      FROM forge_cost_events
    `),
  ]);

  return {
    agents: {
      total: Number(agents?.total ?? 0),
      running: Number(agents?.running ?? 0),
      idle: Number(agents?.idle ?? 0),
      paused: Number(agents?.paused ?? 0),
      errored: Number(agents?.errored ?? 0),
    },
    executions: {
      total: Number(executions?.total ?? 0),
      completed: Number(executions?.completed ?? 0),
      failed: Number(executions?.failed ?? 0),
      last24h: Number(executions?.last_24h ?? 0),
    },
    tickets: {
      total: Number(tickets?.total ?? 0),
      open: Number(tickets?.open ?? 0),
      inProgress: Number(tickets?.in_progress ?? 0),
    },
    costs: {
      total: Number(costs?.total_cost ?? 0),
      today: Number(costs?.today_cost ?? 0),
    },
  };
}

// System stats endpoint (admin view)
fastify.get('/api/stats', async () => getStats());

// Tenant-scoped stats endpoint (requires authentication)
fastify.get('/api/tenant/stats', async (request, reply) => {
  // Require authentication for tenant stats
  const user = await getAdminUser();
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
  const user = await getAdminUser();
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

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
  };
});


// Get user stats
fastify.get('/api/user/stats', async (request, reply) => {
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const keys = await listApiKeysByUser(user.id);
  return { keys };
});

// Create API key with optional TTL
fastify.post('/api/user/api-keys', async (request, reply) => {
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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
  const user = await getAdminUser();
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }

  const { name, displayName } = request.body || {};
  const updates = [];
  const values = [];
  let idx = 1;
  if (name !== undefined) {
    updates.push(`name = $${idx++}`);
    values.push(name);
  }
  if (displayName !== undefined) {
    updates.push(`display_name = $${idx++}`);
    values.push(displayName);
  }
  if (updates.length > 0) {
    updates.push('updated_at = NOW()');
    values.push(user.id);
    await query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
  }

  return { success: true };
});

// Change password
fastify.post('/api/user/password', async (request, reply) => {
  const user = await getAdminUser();
  if (!user) return reply.status(401).send({ error: 'Not authenticated' });

  const { currentPassword, newPassword } = request.body || {};
  if (!currentPassword || !newPassword) {
    return reply.status(400).send({ error: 'Current password and new password are required' });
  }
  if (newPassword.length < 12) {
    return reply.status(400).send({ error: 'New password must be at least 12 characters' });
  }

  // Get current password hash
  const row = await queryOne('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  if (!row || !row.password_hash) {
    return reply.status(400).send({ error: 'Password not set for this account' });
  }

  // Verify current password
  const bcryptMod = await import('bcryptjs');
  const bcrypt = bcryptMod.default || bcryptMod;
  const valid = await bcrypt.compare(currentPassword, row.password_hash);
  if (!valid) {
    return reply.status(403).send({ error: 'Current password is incorrect' });
  }

  // Hash and update
  const newHash = await bcrypt.hash(newPassword, 12);
  await query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, user.id]);

  return { success: true };
});

// Get user's recent activity feed
fastify.get('/api/user/activity', async (request, reply) => {
  const user = await getAdminUser();
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
  const user = await getAdminUser();
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


// Check if current user is admin
fastify.get('/api/v1/admin/me', async (request, reply) => {
  const user = await getAdminUser();
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
  const admin = await getAdminUser();
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
  const admin = await getAdminUser();
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
  const admin = await getAdminUser();
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
  const admin = await getAdminUser();
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
    const userId = crypto.randomUUID();
    const userRole = role || 'user';
    await query(
      `INSERT INTO users (id, tenant_id, email, name, display_name, role, status, email_verified, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $4, $5, 'active', true, NOW(), NOW())`,
      [userId, tenantId, email, display_name || email.split('@')[0], userRole]
    );

    return { user: { id: userId, email, name: display_name, role: userRole, emailVerified: true } };
  } catch (err) {
    reply.status(400);
    return { error: err.message || 'Failed to create user' };
  }
});

// Suspend user (admin)
fastify.post('/api/v1/admin/users/:id/suspend', async (request, reply) => {
  const admin = await getAdminUser();
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;
  await query(`UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1`, [id]);
  return { success: true };
});

// Unsuspend user (admin)
fastify.post('/api/v1/admin/users/:id/unsuspend', async (request, reply) => {
  const admin = await getAdminUser();
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;
  await query(`UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1`, [id]);
  return { success: true };
});

// Update user role (admin)
fastify.patch('/api/v1/admin/users/:id/role', async (request, reply) => {
  const admin = await getAdminUser();
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;
  const { role } = request.body || {};

  const validRoles = admin.role === 'super_admin' ? ['user', 'admin', 'super_admin'] : ['user', 'admin'];
  if (!role || !validRoles.includes(role)) {
    reply.status(400);
    return { error: admin.role === 'super_admin' ? 'Invalid role' : 'Only super admins can assign elevated roles' };
  }

  await query(`UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2`, [role, id]);
  return { success: true };
});

// Update user (admin) - combined update for name, role, status, plan
fastify.patch('/api/v1/admin/users/:id', async (request, reply) => {
  const admin = await getAdminUser();
  if (!admin) return { error: 'Admin access required' };

  const { id } = request.params;
  const { display_name, role, status, plan } = request.body || {};

  // Prevent self-demotion
  if (id === admin.id && role && role !== admin.role) {
    reply.status(400);
    return { error: 'Cannot change your own role' };
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
    const allowedRoles = admin.role === 'super_admin' ? ['user', 'admin', 'super_admin'] : ['user', 'admin'];
    if (role && allowedRoles.includes(role)) {
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
  const admin = await getAdminUser();
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
  const admin = await getAdminUser();
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
  const admin = await getAdminUser();
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
await registerAdminHubRoutes(fastify, getAdminUser, getAdminUser, query, queryOne);

// User Provider Keys (user-facing, not admin-only)
import { callForge } from './routes/admin-hub/utils.js';

fastify.get('/api/v1/user-providers', async (request, reply) => {
  const user = await getAdminUser();
  if (!user) return reply.status(401).send({ error: 'Not authenticated' });
  const res = await callForge('/user-providers', { headers: { 'x-user-id': user.id } });
  if (res.error) return reply.code(res.status || 503).send({ error: 'User providers unavailable', message: res.message });
  return res;
});

fastify.put('/api/v1/user-providers/:providerType', async (request, reply) => {
  const user = await getAdminUser();
  if (!user) return reply.status(401).send({ error: 'Not authenticated' });
  const { providerType } = request.params;
  const res = await callForge(`/user-providers/${encodeURIComponent(providerType)}`, {
    method: 'PUT', body: request.body, headers: { 'x-user-id': user.id },
  });
  if (res.error) return reply.code(res.status || 503).send({ error: 'Failed to save key', message: res.message });
  return res;
});

fastify.delete('/api/v1/user-providers/:providerType', async (request, reply) => {
  const user = await getAdminUser();
  if (!user) return reply.status(401).send({ error: 'Not authenticated' });
  const { providerType } = request.params;
  const res = await callForge(`/user-providers/${encodeURIComponent(providerType)}`, {
    method: 'DELETE', headers: { 'x-user-id': user.id },
  });
  if (res.error) return reply.code(res.status || 503).send({ error: 'Failed to remove key', message: res.message });
  return res;
});

fastify.post('/api/v1/user-providers/:providerType/verify', async (request, reply) => {
  const user = await getAdminUser();
  if (!user) return reply.status(401).send({ error: 'Not authenticated' });
  const { providerType } = request.params;
  const res = await callForge(`/user-providers/${encodeURIComponent(providerType)}/verify`, {
    method: 'POST', body: {}, headers: { 'x-user-id': user.id }, timeout: 15000,
  });
  if (res.error) return reply.code(res.status || 503).send({ error: 'Verification failed', message: res.message });
  return res;
});

// User preferences (theme, etc.) — direct DB, no forge proxy needed
fastify.put('/api/v1/auth/preferences', async (request, reply) => {
  const user = await getAdminUser();
  if (!user) return reply.status(401).send({ error: 'Not authenticated' });
  const body = request.body || {};
  const validThemes = ['dark', 'light', 'system'];
  if (body.theme && validThemes.includes(body.theme)) {
    await query('UPDATE users SET theme_preference = $1, updated_at = NOW() WHERE id = $2', [body.theme, user.id]);
  }
  return { success: true };
});


// System Assistant (agentic AI for fleet management)
import { registerAssistantRoutes } from './routes/admin-assistant.js';
await registerAssistantRoutes(fastify, getAdminUser, query, queryOne);



// ===========================================
// AUTH PROXY — forward auth routes to Forge
// ===========================================

const FORGE_AUTH_URL = process.env.FORGE_URL || 'http://forge:3005';

async function proxyToForge(request, reply, path) {
  try {
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD' && request.body != null;
    const headers = {
      'x-forwarded-host': request.headers.host || '',
      'x-forwarded-for': request.ip || '',
      'user-agent': request.headers['user-agent'] || '',
    };
    if (request.headers.cookie) headers.cookie = request.headers.cookie;
    if (hasBody) headers['Content-Type'] = request.headers['content-type'] || 'application/json';

    const res = await fetch(`${FORGE_AUTH_URL}${path}`, {
      method: request.method,
      headers,
      body: hasBody ? JSON.stringify(request.body) : undefined,
      redirect: 'manual',
    });

    // Handle redirects (OAuth connect flows)
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (location) return reply.redirect(res.status, location);
    }

    // Forward set-cookie headers from Forge
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) reply.header('set-cookie', setCookie);

    // Forward content type
    const contentType = res.headers.get('content-type') || '';
    if (contentType) reply.header('content-type', contentType);

    // Parse response based on content type
    if (contentType.includes('application/json')) {
      const data = await res.json();
      return reply.code(res.status).send(data);
    }

    // Non-JSON response (text, html, etc.)
    const text = await res.text();
    return reply.code(res.status).send(text);
  } catch (err) {
    console.error(`[Proxy] Error forwarding to ${path}:`, err.message);
    return reply.code(502).send({ error: 'Service unavailable' });
  }
}

// Get current authenticated user
fastify.get('/api/v1/auth/me', async (request, reply) => {
  const user = await getAdminUser();
  if (!user) return reply.status(500).send({ error: 'No admin user found' });
  // Include tenant name and onboarding status
  const tenant = await queryOne('SELECT name FROM tenants WHERE id = $1', [user.tenant_id]);
  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      displayName: user.display_name,
      role: user.role,
      tenantName: tenant?.name || null,
      themePreference: user.theme_preference || null,
      onboardingCompleted: !!user.onboarding_completed_at,
    },
  };
});


// ===========================================
// FORGE API PROXY — forward forge routes
// In production, nginx handles this. In self-hosted
// mode (no nginx), dashboard must proxy these.
// ===========================================
for (const prefix of ['/api/v1/forge/', '/api/v1/integrations/', '/api/v1/terminal/']) {
  for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
    fastify[method](`${prefix}*`, (req, reply) => {
      const path = req.url.split('?')[0];
      const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
      return proxyToForge(req, reply, path + qs);
    });
  }
}


// ===========================================
// SPA FALLBACK - Serve index.html for client routes
// ===========================================

// Catch-all for React Router (must be after all API routes)
fastify.setNotFoundHandler((request, reply) => {
  // Proxy unhandled /api/v1/admin/ routes to forge (agents, tools, providers, costs, etc.)
  if (request.url.startsWith('/api/v1/admin/')) {
    return proxyToForge(request, reply, request.url);
  }
  // Other unhandled API routes → 404
  if (request.url.startsWith('/api/') || request.url.startsWith('/ws')) {
    return reply.code(404).send({ error: 'Not found' });
  }
  // For all other routes, serve React app
  return reply.sendFile('index.html');
});

// ===========================================
// SANDBOX DEMO CHAT — unauthenticated, rate-limited
// ===========================================

const demoRateLimit = new Map(); // sessionToken -> { count, resetAt }
const DEMO_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const DEMO_MAX_MESSAGES = 3; // 3 messages per session

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of demoRateLimit.entries()) {
    if (v.resetAt < now) demoRateLimit.delete(k);
  }
}, 60000);

const DEMO_SYSTEM_PROMPT = `You are Alf, a friendly demo agent for AskAlf — an AI agent platform where agents actually use computers (mouse, keyboard, browser, terminal).

Keep responses concise (2-4 sentences). You're showing visitors what AskAlf agents can do.

Key things to mention naturally if relevant:
- Agents control real computers, not just answer questions
- Fleet orchestration: deploy and coordinate multiple agents
- Multi-provider: works with Anthropic, OpenAI, xAI, DeepSeek
- 24 built-in tools (web search, code analysis, database queries, Docker, etc.)
- Cost controls, guardrails, and human-in-the-loop checkpoints
- Full observability and audit trails

Be helpful, direct, and show personality. You're the first impression of the product.
This is a demo with a 3-message limit, so make each response count.`;

fastify.post('/api/v1/demo/chat', async (request, reply) => {
  const { message, sessionToken, history } = request.body || {};

  if (!message || typeof message !== 'string' || !message.trim()) {
    return reply.code(400).send({ error: 'Message is required' });
  }

  if (message.trim().length > 500) {
    return reply.code(400).send({ error: 'Message too long (500 char max)' });
  }

  // Rate limit by session token (generated client-side)
  const token = sessionToken || 'anonymous';
  let entry = demoRateLimit.get(token);
  if (!entry) {
    entry = { count: 0, resetAt: Date.now() + DEMO_WINDOW_MS };
    demoRateLimit.set(token, entry);
  }
  if (entry.count >= DEMO_MAX_MESSAGES) {
    return reply.code(429).send({
      error: 'Demo limit reached',
      detail: 'Sign up for full access — 3-message demo limit reached.',
      remaining: 0,
    });
  }
  entry.count++;

  // Also rate limit by IP as fallback
  const ip = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.ip;
  const ipKey = `ip:${ip}`;
  let ipEntry = demoRateLimit.get(ipKey);
  if (!ipEntry) {
    ipEntry = { count: 0, resetAt: Date.now() + DEMO_WINDOW_MS };
    demoRateLimit.set(ipKey, ipEntry);
  }
  if (ipEntry.count >= 15) { // 15 messages per IP per 30min (5 sessions)
    return reply.code(429).send({
      error: 'Too many demo requests',
      remaining: 0,
    });
  }
  ipEntry.count++;

  const apiKey = process.env['DEMO_ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY'];
  if (!apiKey) {
    return reply.code(503).send({ error: 'Demo unavailable' });
  }

  // Build messages array from history
  const messages = [];
  if (Array.isArray(history)) {
    for (const h of history.slice(-4)) { // Max 4 history messages (2 exchanges)
      if (h.role === 'user' || h.role === 'assistant') {
        messages.push({ role: h.role, content: String(h.content).slice(0, 500) });
      }
    }
  }
  messages.push({ role: 'user', content: message.trim().slice(0, 500) });

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: DEMO_SYSTEM_PROMPT,
        messages,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[Demo] Anthropic API error: ${res.status} ${errText.slice(0, 200)}`);
      return reply.code(502).send({ error: 'AI service error' });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || 'Sorry, I couldn\'t generate a response.';

    return reply.send({
      response: text,
      remaining: DEMO_MAX_MESSAGES - entry.count,
    });
  } catch (err) {
    console.error('[Demo] Chat error:', err.message);
    return reply.code(500).send({ error: 'Demo chat failed' });
  }
});

// ===========================================
// OPENCLAW MIGRATION
// ===========================================

// Read an openclaw.json from a server-side path
fastify.post('/api/v1/admin/migrate/openclaw/read-config', async (request, reply) => {
  const user = await getAdminUser();
  if (!user) return reply.code(401).send({ error: 'Not authenticated' });

  const { path: configPath } = request.body || {};
  if (!configPath || typeof configPath !== 'string') {
    return reply.code(400).send({ error: 'path is required' });
  }

  // Resolve ~ to home dir
  const { readFile } = await import('fs/promises');
  const { homedir } = await import('os');
  const { resolve } = await import('path');
  const resolvedPath = configPath.startsWith('~')
    ? resolve(homedir(), configPath.slice(2))
    : resolve(configPath);

  // Basic path safety: must end with .json
  if (!resolvedPath.endsWith('.json')) {
    return reply.code(400).send({ error: 'Path must point to a .json file' });
  }

  try {
    const content = await readFile(resolvedPath, 'utf-8');
    // Validate it's parseable JSON
    JSON.parse(content);
    return { content };
  } catch (err) {
    if (err.code === 'ENOENT') {
      return reply.code(404).send({ error: `File not found: ${resolvedPath}` });
    }
    return reply.code(400).send({ error: `Failed to read config: ${err.message}` });
  }
});

// Import openclaw.json configuration
fastify.post('/api/v1/admin/migrate/openclaw', async (request, reply) => {
  const user = await getAdminUser();
  if (!user) return reply.code(401).send({ error: 'Not authenticated' });

  const { config } = request.body || {};
  if (!config || typeof config !== 'object') {
    return reply.code(400).send({ error: 'config object is required in the POST body' });
  }

  const errors = [];
  let agentsImported = 0;
  let channelsImported = 0;
  let skillsMatched = 0;
  let gatewayStored = false;

  try {
    // Get or create tenant
    let tenant = await queryOne('SELECT id FROM tenants WHERE user_id = $1', [user.id]);
    if (!tenant) {
      tenant = await queryOne(
        'INSERT INTO tenants (id, user_id, name) VALUES ($1, $2, $3) RETURNING id',
        [crypto.randomUUID(), user.id, user.email || 'default']
      );
    }
    const tenantId = tenant.id;

    // 1) Import agents
    const agents = Array.isArray(config.agents) ? config.agents : [];
    for (const agent of agents) {
      try {
        const agentId = agent.id || crypto.randomUUID();
        const name = agent.name || agent.id || 'openclaw-agent';
        const model = agent.model || 'unknown';
        const provider = agent.provider || 'unknown';
        const skills = Array.isArray(agent.skills) ? agent.skills : [];
        const workspace = agent.workspace || null;

        await query(`
          INSERT INTO agents (id, name, model, provider, status, config, tenant_id, is_decommissioned)
          VALUES ($1, $2, $3, $4, 'idle', $5, $6, false)
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            model = EXCLUDED.model,
            provider = EXCLUDED.provider,
            config = EXCLUDED.config
        `, [
          agentId, name, model, provider,
          JSON.stringify({ skills, workspace, source: 'openclaw-migration' }),
          tenantId,
        ]);
        agentsImported++;
      } catch (err) {
        errors.push(`Agent "${agent.name || agent.id}": ${err.message}`);
      }
    }

    // 2) Import channel configs
    const channels = config.channels && typeof config.channels === 'object' ? config.channels : {};
    for (const [channelType, creds] of Object.entries(channels)) {
      if (!creds || typeof creds !== 'object' || Object.keys(creds).length === 0) continue;
      try {
        // Encrypt sensitive fields
        const encryptedConfig = {};
        for (const [key, value] of Object.entries(creds)) {
          const isSensitive = /token|secret|key|password|api_key/i.test(key);
          if (isSensitive && typeof value === 'string' && value.length > 0) {
            encryptedConfig[key] = encryptApiKey(value);
          } else {
            encryptedConfig[key] = value;
          }
        }

        const configId = crypto.randomUUID();
        await query(`
          INSERT INTO channel_configs (id, channel_type, name, config, is_active, tenant_id, created_at, updated_at)
          VALUES ($1, $2, $3, $4, true, $5, NOW(), NOW())
          ON CONFLICT (tenant_id, channel_type) DO UPDATE SET
            config = EXCLUDED.config,
            is_active = true,
            updated_at = NOW()
        `, [
          configId, channelType, channelType, JSON.stringify(encryptedConfig), tenantId,
        ]);
        channelsImported++;
      } catch (err) {
        errors.push(`Channel "${channelType}": ${err.message}`);
      }
    }

    // 3) Match skills against marketplace packages
    const skillsList = Array.isArray(config.skills) ? config.skills : [];
    for (const skillName of skillsList) {
      try {
        const match = await queryOne(
          `SELECT id FROM marketplace_packages WHERE name ILIKE $1 OR name ILIKE $2 LIMIT 1`,
          [skillName, `%${skillName}%`]
        );
        if (match) {
          skillsMatched++;
        } else {
          errors.push(`Skill "${skillName}": no matching marketplace package found`);
        }
      } catch {
        // marketplace_packages table may not exist — not critical
        errors.push(`Skill "${skillName}": could not query marketplace`);
      }
    }

    // 4) Store gateway URL/token in platform_settings
    if (config.gateway) {
      try {
        const gw = config.gateway;
        const gwBind = gw.bind || 'localhost';
        const gwPort = gw.port;
        const gwUrl = gwPort ? `http://${gwBind}:${gwPort}` : null;
        const gwToken = gw.auth?.token || null;

        const settings = {
          openclaw_gateway_url: gwUrl,
          openclaw_gateway_token: gwToken ? encryptApiKey(gwToken) : null,
          openclaw_imported_at: new Date().toISOString(),
        };

        // Upsert each setting
        for (const [key, value] of Object.entries(settings)) {
          if (value === null) continue;
          await query(`
            INSERT INTO platform_settings (id, key, value, tenant_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            ON CONFLICT (tenant_id, key) DO UPDATE SET
              value = EXCLUDED.value,
              updated_at = NOW()
          `, [crypto.randomUUID(), key, value, tenantId]);
        }
        gatewayStored = true;
      } catch (err) {
        errors.push(`Gateway settings: ${err.message}`);
      }
    }

    return {
      success: true,
      summary: {
        agents_imported: agentsImported,
        channels_imported: channelsImported,
        skills_matched: skillsMatched,
        gateway_stored: gatewayStored,
      },
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (err) {
    console.error('[Migration] OpenClaw import error:', err);
    return reply.code(500).send({
      success: false,
      summary: {
        agents_imported: agentsImported,
        channels_imported: channelsImported,
        skills_matched: skillsMatched,
        gateway_stored: gatewayStored,
      },
      errors: [...errors, err.message],
    });
  }
});

// ===========================================
// EVENT BRIDGE - Redis subscriber for forge events
// ===========================================

let eventBridge = null;
try {
  eventBridge = await createEventBridge(broadcast);
  console.log('[EventBridge] Initialized');
} catch (err) {
  console.warn('[EventBridge] Failed to initialize (dashboard will work without live forge events):', err.message);
}

// ===========================================
// START SERVER
// ===========================================

// Start server
const port = process.env['PORT'] ?? 3001;
const host = process.env['HOST'] ?? '0.0.0.0';

fastify.listen({ port: Number(port), host }, async (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`SUBSTRATE Dashboard running at ${address}`);

  // Start master session once at boot — not lazily on WS connect
  try {
    await masterSession.start();
    console.log('[MasterSession] Started at boot');
  } catch (startErr) {
    console.error('[MasterSession] Failed to start at boot:', startErr.message);
  }

  // Start codex session if OPENAI_API_KEY is set
  if (process.env['OPENAI_API_KEY']) {
    try {
      await codexSession.start();
      console.log('[CodexSession] Started at boot');
    } catch (startErr) {
      console.error('[CodexSession] Failed to start at boot:', startErr.message);
    }
  } else {
    console.log('[CodexSession] Skipped — no OPENAI_API_KEY configured');
  }
});
