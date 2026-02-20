/**
 * Self AI Service
 * Independent conversation-first AI that becomes you.
 */

import 'dotenv/config';
import {
  getPrometheusMetrics,
  httpRequestsTotal,
  httpRequestDuration,
  httpRequestsInFlight,
} from '@substrate/observability';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { initializeSelfDatabase, initializeSubstrateDatabase, closeDatabase } from './database.js';
import { loadConfig } from './config.js';
import { conversationRoutes } from './routes/conversations.js';
import { connectionRoutes } from './routes/connections.js';
import { credentialRoutes } from './routes/credentials.js';
import { initializeSelfEngine } from './self/engine.js';

const app = Fastify({
  logger: true,
  requestTimeout: 300000, // 5 min for streaming conversations
  bodyLimit: 1024 * 1024, // 1MB
  connectionTimeout: 60000,
});

// Register CORS
await app.register(cors, {
  origin: process.env['ALLOWED_ORIGINS']?.split(',') || [
    'https://app.askalf.org',
    'https://askalf.org',
    'http://localhost:3006',
    'http://localhost:5173',
    'http://localhost:5174',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

// Register Cookie parser (for session auth)
await app.register(cookie);

// ============================================
// RATE LIMITING
// ============================================

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 60;
const RATE_WINDOW = 60000;

app.addHook('onRequest', async (request, reply) => {
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

// Security headers
app.addHook('onSend', async (_request, reply) => {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
});

// Clean up rate limit map
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 60000);

// ============================================
// METRICS INSTRUMENTATION
// ============================================

app.addHook('onRequest', async (request) => {
  httpRequestsInFlight.inc({ service: 'self' });
  (request as unknown as Record<string, unknown>)['_metricsStart'] = process.hrtime.bigint();
});

app.addHook('onResponse', async (request, reply) => {
  httpRequestsInFlight.dec({ service: 'self' });
  const start = (request as unknown as Record<string, unknown>)['_metricsStart'] as bigint | undefined;
  httpRequestsTotal.inc({ service: 'self', method: request.method, status: String(reply.statusCode) });
  if (start) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    httpRequestDuration.observe(durationMs, { service: 'self', method: request.method });
  }
});

// ============================================
// HEALTH CHECK & METRICS
// ============================================

app.get('/health', { logLevel: 'silent' }, async () => {
  return {
    status: 'healthy',
    service: 'self',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };
});

app.get('/metrics', { logLevel: 'silent' }, async (_request, reply) => {
  reply.header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
  return getPrometheusMetrics();
});

// ============================================
// REGISTER ROUTES
// ============================================

await conversationRoutes(app);
await connectionRoutes(app);
await credentialRoutes(app);

// ============================================
// START SERVER
// ============================================

async function start(): Promise<void> {
  const config = loadConfig();

  // Initialize databases
  initializeSelfDatabase(config.databaseUrl);
  console.log('[Self] Self database connection initialized');

  initializeSubstrateDatabase(config.substrateDatabaseUrl);
  console.log('[Self] Substrate database connection initialized');

  // Initialize CLI engine (setup OAuth credentials, MCP config, token refresh)
  await initializeSelfEngine();
  console.log('[Self] CLI engine initialized');

  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    console.log(`[Self] Self AI service started on port ${config.port}`);
  } catch (err) {
    console.error('[Self] Failed to start server:', err);
    process.exit(1);
  }
}

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

let isShuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`[Self] Received ${signal}, starting graceful shutdown...`);

  const shutdownTimeout = setTimeout(() => {
    console.error('[Self] Graceful shutdown timeout, forcing exit');
    process.exit(1);
  }, 30000);

  try {
    await app.close();
    await closeDatabase();
    clearTimeout(shutdownTimeout);
    console.log('[Self] Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    console.error('[Self] Error during shutdown:', err);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start();
