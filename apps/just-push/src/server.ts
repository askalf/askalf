import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import fastifyCookie from '@fastify/cookie';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializePool, queryOne } from '@substrate/database';
import { getUserFromSession } from './auth.js';
import { registerApiProxy } from './api-proxy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize database
const databaseUrl = process.env['DATABASE_URL'] ?? 'postgresql://substrate:substrate_dev@localhost:5432/substrate';
initializePool({ connectionString: databaseUrl });

const fastify = Fastify({ logger: true });

// Plugins
await fastify.register(fastifyCors, {
  origin: true,
  credentials: true,
});

await fastify.register(fastifyCookie);

// Health endpoint
fastify.get('/health', { logLevel: 'silent' }, async () => {
  try {
    await queryOne('SELECT 1');
    return { status: 'healthy', service: 'just-push', database: 'connected' };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { status: 'degraded', service: 'just-push', database: 'disconnected', error: message };
  }
});

// User info endpoint (for frontend auth check)
fastify.get('/api/me', async (request, reply) => {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    return { error: 'Not authenticated' };
  }
  return { id: user.id, email: user.email, name: user.display_name, role: user.role };
});

// Register API proxy routes
registerApiProxy(fastify);

// Serve React static files
const publicPath = join(__dirname, '..', 'public', 'app');
await fastify.register(fastifyStatic, {
  root: publicPath,
  prefix: '/',
  decorateReply: true,
});

// SPA fallback — non-API GET routes serve index.html
fastify.setNotFoundHandler(async (request, reply) => {
  if (request.method === 'GET' && !request.url.startsWith('/api/')) {
    return reply.sendFile('index.html');
  }
  reply.status(404);
  return { error: 'Not found' };
});

// Start
const port = parseInt(process.env['PORT'] || '3008', 10);
const host = '0.0.0.0';

try {
  await fastify.listen({ port, host });
  console.log(`[JustPush] Server started on port ${port}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
