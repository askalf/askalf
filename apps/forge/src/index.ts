/**
 * Agent Forge API Server
 * Advanced AI Agent Creation Platform
 */

import 'dotenv/config';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import { initializeDatabase, initializeSubstrateDatabase, closeDatabase } from './database.js';
import { loadConfig } from './config.js';
import { agentRoutes } from './routes/agents.js';
import { executionRoutes } from './routes/executions.js';
import { sessionRoutes } from './routes/sessions.js';
import { workflowRoutes } from './routes/workflows.js';
import { toolRoutes } from './routes/tools.js';
import { memoryRoutes } from './routes/memory.js';
import { providerRoutes } from './routes/providers.js';
import { assistantRoutes } from './routes/assistant.js';
import { adminRoutes } from './routes/admin.js';
import { webhookRoutes } from './routes/webhooks.js';
import { gitReviewRoutes } from './routes/git-review.js';
import { authRoutes } from './routes/auth.js';
import { platformAdminRoutes } from './routes/platform-admin.js';
import { cliRoutes } from './routes/cli.js';
import { initializeWorker } from './runtime/worker.js';

const app = Fastify({
  logger: true,
  requestTimeout: 120000, // 2 min for long-running agent executions
  bodyLimit: 1024 * 1024 * 2, // 2MB for large prompts
  connectionTimeout: 60000,
});

// Register CORS
await app.register(cors, {
  origin: process.env['ALLOWED_ORIGINS']?.split(',') || [
    'https://forge.askalf.org',
    'https://askalf.org',
    'https://app.askalf.org',
    'http://localhost:3005',
    'http://localhost:5173',
    'http://localhost:5174',
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});

// Register Cookie parser (for session auth)
await app.register(cookie);

// ============================================
// RATE LIMITING
// ============================================

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 100;
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
// HEALTH CHECK
// ============================================

app.get('/health', { logLevel: 'silent' }, async () => {
  return {
    status: 'healthy',
    service: 'forge',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  };
});

// ============================================
// REGISTER ROUTES
// ============================================

await authRoutes(app);
await agentRoutes(app);
await executionRoutes(app);
await sessionRoutes(app);
await workflowRoutes(app);
await toolRoutes(app);
await memoryRoutes(app);
await providerRoutes(app);
await assistantRoutes(app);
await adminRoutes(app);
await webhookRoutes(app);
await gitReviewRoutes(app);
await platformAdminRoutes(app);
await cliRoutes(app);

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

  try {
    // Initialize execution worker (provider + tools)
    await initializeWorker();
    console.log('[Forge] Execution worker initialized');

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
    await app.close();
    console.log('[Forge] Server closed');

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

start();
