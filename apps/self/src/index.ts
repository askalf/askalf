/**
 * SELF AI Server
 * Your AI That Lives and Breathes
 */

import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { loadConfig } from './config.js';
import { initializeDatabase, closeDatabase } from './database.js';
import { initializeForgeDb, closeForgeDb } from './services/self-engine.js';
import { initializeSSE, closeSSE } from './services/sse-stream.js';
import { selfAuthMiddleware } from './middleware/self-auth.js';
import { runMigrations } from './migrations.js';
import { authRoutes } from './routes/auth.js';
import { selfRoutes } from './routes/self.js';
import { chatRoutes } from './routes/chat.js';
import { activityRoutes } from './routes/activity.js';
import { integrationRoutes } from './routes/integrations.js';
import { approvalRoutes } from './routes/approvals.js';
import { settingsRoutes } from './routes/settings.js';
import { onboardingRoutes } from './routes/onboarding.js';
import { oauthRoutes } from './routes/oauth.js';
import { budgetRoutes } from './routes/budget.js';
import { notificationRoutes } from './routes/notifications.js';
import {
  createHeartbeatWorker,
  createScheduleWorker,
  createActionWorker,
  createBudgetResetWorker,
  scheduleSelfJobs,
} from './workers/self-workers.js';

// ============================================
// Configuration
// ============================================

const config = loadConfig();

// ============================================
// Database Init
// ============================================

initializeDatabase(config.databaseUrl);
initializeForgeDb(config.forgeDatabaseUrl);

// ============================================
// SSE / Redis Pub/Sub Init
// ============================================

initializeSSE(config.redisUrl);

// ============================================
// Fastify App
// ============================================

const app = Fastify({
  logger: true,
  requestTimeout: 120000, // 2 min for LLM calls
  bodyLimit: 1024 * 1024, // 1MB
  connectionTimeout: 60000,
});

// ============================================
// Plugins
// ============================================

await app.register(cors, {
  origin: process.env['ALLOWED_ORIGINS']?.split(',') || [
    'https://self.askalf.org',
    'https://askalf.org',
    'https://app.askalf.org',
    'http://localhost:3006',
    'http://localhost:5173',
    'http://localhost:5174',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});

await app.register(cookie, {
  secret: config.sessionSecret,
});

// ============================================
// Rate Limiting (IP-based)
// ============================================

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100;
const RATE_WINDOW = 60000;

app.addHook('onRequest', async (request, reply) => {
  if (request.url === '/health') return;

  const ip = request.ip || 'unknown';
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
});

// Clean up rate limit map periodically
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

// ============================================
// Security Headers
// ============================================

app.addHook('onSend', async (request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  // Only set no-cache on API routes; static assets use default caching
  if (request.url.startsWith('/api/') || request.url === '/health') {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
});

// ============================================
// Auth Middleware (on all /api routes, except OAuth callback)
// ============================================

app.addHook('preHandler', async (request, reply) => {
  if (request.url === '/health') return;
  if (request.url.startsWith('/api/v1/auth/')) return; // Auth routes are public
  if (request.url === '/api/v1/self/oauth/callback') return; // OAuth callback is unauthenticated
  if (request.url.startsWith('/api/')) {
    await selfAuthMiddleware(request, reply);
  }
});

// ============================================
// Health Check
// ============================================

app.get('/health', async () => {
  return {
    status: 'healthy',
    service: 'self',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };
});

// ============================================
// Register Routes
// ============================================

// Auth (public, no middleware)
await authRoutes(app, config);

// Phase 1: Core
await selfRoutes(app, config);
await chatRoutes(app, config);
await activityRoutes(app);
await integrationRoutes(app);
await approvalRoutes(app);
await settingsRoutes(app);
await onboardingRoutes(app);

// Phase 2: Proactive
await oauthRoutes(app);

// Phase 4: Polish
await budgetRoutes(app);
await notificationRoutes(app);

// ============================================
// Static File Serving (SELF UI SPA)
// ============================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '..', 'public', 'app');

if (existsSync(publicDir)) {
  await app.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  // SPA fallback: serve index.html for non-API, non-file routes
  app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      return reply.status(404).send({ error: 'Not found' });
    }
    return reply.sendFile('index.html', publicDir);
  });
} else {
  console.log('[SELF] No public/app directory found — skipping static file serving');
}

// ============================================
// Start
// ============================================

// Run SELF migrations before starting
await runMigrations();

const port = config.port;

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`[SELF] Server running on port ${port}`);
} catch (err) {
  console.error('[SELF] Failed to start:', err);
  process.exit(1);
}

// ============================================
// SELF Workers (in-process BullMQ)
// ============================================

function parseRedisUrl(url: string): { host: string; port: number; password?: string } {
  const parsed = new URL(url);
  return {
    host: parsed.hostname || 'localhost',
    port: parseInt(parsed.port || '6379', 10),
    ...(parsed.password ? { password: parsed.password } : {}),
  };
}

const redisConfig = parseRedisUrl(config.redisUrl);

const selfWorkers = [
  createHeartbeatWorker(redisConfig),
  createScheduleWorker(redisConfig),
  createActionWorker(redisConfig),
  createBudgetResetWorker(redisConfig),
];

// Schedule repeatable jobs (heartbeat scan, budget resets)
await scheduleSelfJobs(redisConfig);
console.log(`[SELF] Workers started (${selfWorkers.length} workers)`);

// ============================================
// Graceful Shutdown
// ============================================

async function shutdown(signal: string): Promise<void> {
  console.log(`[SELF] Received ${signal}, shutting down...`);
  await app.close();
  await Promise.all(selfWorkers.map(w => w.close()));
  await closeSSE();
  await closeDatabase();
  await closeForgeDb();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
