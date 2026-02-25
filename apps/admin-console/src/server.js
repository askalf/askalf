/**
 * Admin Console — Standalone Super-Admin Terminal
 *
 * Minimal Fastify server providing a Claude Code PTY terminal
 * accessible via integration.tax. Independent from the dashboard
 * container so it survives dashboard crashes.
 *
 * Auth: session cookie (super_admin) OR static ADMIN_CONSOLE_TOKEN
 */

import { readFile } from 'fs/promises';
import { createHash, timingSafeEqual } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Fastify from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyCookie from '@fastify/cookie';
import pg from 'pg';
import { getMasterSession } from './master-session.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---- Database pool (minimal — just for session validation) ----
const pool = new pg.Pool({
  connectionString: process.env['DATABASE_URL'] || 'postgresql://substrate:substrate_dev@localhost:5432/orcastr8r',
  max: 3,
  idleTimeoutMillis: 60000,
});

async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

// ---- Auth ----
const ADMIN_TOKEN = process.env['ADMIN_CONSOLE_TOKEN'] || '';
// Pre-hash the token at startup for constant-time comparison
const ADMIN_TOKEN_HASH = ADMIN_TOKEN
  ? createHash('sha256').update(ADMIN_TOKEN).digest()
  : null;

/** Constant-time token comparison (prevents timing attacks) */
function verifyToken(input) {
  if (!input || !ADMIN_TOKEN_HASH) return false;
  const inputHash = createHash('sha256').update(input).digest();
  return timingSafeEqual(inputHash, ADMIN_TOKEN_HASH);
}

// ---- Rate limiting for login ----
const loginAttempts = new Map(); // IP → { count, firstAttempt, lockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 15 * 60 * 1000;      // 15 minute lockout after max attempts

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);

  if (!record) return { allowed: true };

  // Locked out
  if (record.lockedUntil && now < record.lockedUntil) {
    const remainingSec = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, retryAfter: remainingSec };
  }

  // Window expired — reset
  if (now - record.firstAttempt > LOGIN_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }

  // Under limit
  if (record.count < MAX_LOGIN_ATTEMPTS) return { allowed: true };

  // Hit limit — lock out
  record.lockedUntil = now + LOCKOUT_MS;
  const remainingSec = Math.ceil(LOCKOUT_MS / 1000);
  return { allowed: false, retryAfter: remainingSec };
}

function recordLoginFailure(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip) || { count: 0, firstAttempt: now, lockedUntil: null };
  record.count++;
  loginAttempts.set(ip, record);
}

function clearLoginFailures(ip) {
  loginAttempts.delete(ip);
}

// Cleanup stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts) {
    if (now - record.firstAttempt > LOGIN_WINDOW_MS && (!record.lockedUntil || now > record.lockedUntil)) {
      loginAttempts.delete(ip);
    }
  }
}, 30 * 60 * 1000);

async function authenticate(request) {
  // Method 1: Session cookie (same as dashboard — super_admin only)
  const sessionId = request.cookies?.['substrate_session'];
  if (sessionId) {
    try {
      const rows = await query(
        `SELECT u.role FROM sessions s JOIN users u ON s.user_id = u.id
         WHERE s.id = $1 AND s.expires_at > NOW()`,
        [sessionId]
      );
      if (rows[0]?.role === 'super_admin') return true;
    } catch (err) {
      console.warn('[Auth] Session check failed:', err.message);
    }
  }

  // Method 2: Admin console token cookie (set via /login form)
  const tokenCookie = request.cookies?.['admin_console_token'];
  if (tokenCookie && verifyToken(tokenCookie)) return true;

  // Method 3: Static token via header or query param
  const headerToken = request.headers['x-admin-token'];
  const queryToken = request.query?.token;
  const token = headerToken || queryToken;
  if (token && verifyToken(token)) return true;

  return false;
}

// ---- Fastify setup ----
const fastify = Fastify({ logger: true });

await fastify.register(fastifyCookie, {
  secret: process.env['SESSION_SECRET'] || 'admin-console-dev-secret',
  parseOptions: {
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
  },
});

await fastify.register(fastifyWebsocket);

// Security headers
fastify.addHook('onSend', async (_request, reply) => {
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
});

// ---- Routes ----

// Health check (no auth)
fastify.get('/health', { logLevel: 'silent' }, async (_request, _reply) => {
  try {
    await query('SELECT 1');
    return { status: 'healthy', service: 'admin-console', database: 'connected' };
  } catch (err) {
    return { status: 'degraded', service: 'admin-console', database: 'disconnected', error: err.message };
  }
});

// Login page
fastify.get('/login', async (_request, reply) => {
  const html = await readFile(join(__dirname, 'login.html'), 'utf-8');
  reply.header('Content-Type', 'text/html; charset=utf-8');
  return reply.send(html);
});

// Login handler (rate limited)
fastify.post('/login', async (request, reply) => {
  const ip = request.headers['x-real-ip'] || request.headers['x-forwarded-for'] || request.ip;

  // Check rate limit
  const rateCheck = checkLoginRateLimit(ip);
  if (!rateCheck.allowed) {
    reply.header('Retry-After', String(rateCheck.retryAfter));
    return reply.code(429).send({
      ok: false,
      error: `Too many login attempts. Try again in ${Math.ceil(rateCheck.retryAfter / 60)} minutes.`,
    });
  }

  const { token } = request.body || {};
  if (!token || !verifyToken(token)) {
    recordLoginFailure(ip);
    // Constant delay to prevent timing-based enumeration
    await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    return reply.code(401).send({ ok: false, error: 'Invalid token' });
  }

  clearLoginFailures(ip);
  reply.setCookie('admin_console_token', token, {
    path: '/',
    httpOnly: true,
    secure: process.env['NODE_ENV'] === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });
  return { ok: true };
});

// Logout
fastify.get('/logout', async (_request, reply) => {
  reply.clearCookie('admin_console_token', { path: '/' });
  return reply.redirect('/login');
});

// Main terminal page (auth required)
fastify.get('/', async (request, reply) => {
  const authed = await authenticate(request);
  if (!authed) {
    return reply.redirect('/login');
  }
  const html = await readFile(join(__dirname, 'terminal.html'), 'utf-8');
  reply.header('Content-Type', 'text/html; charset=utf-8');
  return reply.send(html);
});

// Session status API
fastify.get('/api/status', async (request, reply) => {
  const authed = await authenticate(request);
  if (!authed) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
  const session = getMasterSession();
  return session.getStatus();
});

// ---- WebSocket: Terminal PTY ----
const masterSession = getMasterSession();

fastify.get('/ws/terminal', { websocket: true }, async (socket, req) => {
  const authed = await authenticate(req);
  if (!authed) {
    socket.close(4401, 'Authentication required');
    return;
  }

  masterSession.addSubscriber(socket);
  console.log('[AdminConsole] WebSocket client connected');

  // Send history buffer for reconnection
  const history = masterSession.getHistory();
  if (history.length > 0) {
    socket.send(JSON.stringify({ type: 'history', data: history }));
  }

  // Send current status
  socket.send(JSON.stringify({ type: 'status', data: masterSession.getStatus() }));

  socket.on('message', (msg) => {
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
          if (parsed.cols && parsed.rows) {
            masterSession.resize(parsed.cols, parsed.rows);
          }
          break;
        case 'restart':
          masterSession.restart();
          break;
      }
    } catch { /* ignore parse errors */ }
  });

  socket.on('close', () => {
    masterSession.removeSubscriber(socket);
    console.log('[AdminConsole] WebSocket client disconnected');
  });
});

// ---- Startup ----
const port = process.env['PORT'] ?? 3002;
const host = process.env['HOST'] ?? '0.0.0.0';

fastify.listen({ port: Number(port), host }, async (err, address) => {
  if (err) {
    fastify.log.error(err);
    process.exit(1);
  }
  console.log(`Admin Console running at ${address}`);

  // Start master session at boot
  try {
    await masterSession.start();
    console.log('[AdminSession] Started at boot');
  } catch (startErr) {
    console.error('[AdminSession] Failed to start at boot:', startErr.message);
  }
});
