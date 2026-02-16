import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getUserFromSession } from './auth.js';

const FORGE_URL = process.env['FORGE_URL'] || 'http://forge:3005';
const FORGE_API_KEY = process.env['FORGE_API_KEY'] || '';

async function callForge(path: string, options: { method?: string; body?: unknown } = {}) {
  const url = `${FORGE_URL}/api/v1/forge${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(FORGE_API_KEY ? { Authorization: `Bearer ${FORGE_API_KEY}` } : {}),
  };

  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: true, status: res.status, message: text || res.statusText };
    }

    return await res.json();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { error: true, status: 503, message: `Forge unreachable: ${message}` };
  }
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = await getUserFromSession(request);
  if (!user) {
    reply.status(401);
    reply.send({ error: 'Not authenticated' });
    return false;
  }
  if (user.role !== 'admin') {
    reply.status(403);
    reply.send({ error: 'Admin access required' });
    return false;
  }
  return true;
}

export function registerApiProxy(fastify: FastifyInstance) {
  // Branches
  fastify.get('/api/branches', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge('/git/branches');
  });

  // Diff
  fastify.get<{ Params: { branch: string } }>('/api/diff/:branch', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge(`/git/diff/${encodeURIComponent(request.params.branch)}`);
  });

  // Log
  fastify.get<{ Params: { branch: string } }>('/api/log/:branch', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge(`/git/log/${encodeURIComponent(request.params.branch)}`);
  });

  // Files
  fastify.get<{ Params: { branch: string } }>('/api/files/:branch', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge(`/git/files/${encodeURIComponent(request.params.branch)}`);
  });

  // Merge
  fastify.post('/api/merge', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge('/git/merge', { method: 'POST', body: request.body });
  });

  // Health check for a service
  fastify.get<{ Params: { service: string } }>('/api/health/:service', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge(`/git/health/${encodeURIComponent(request.params.service)}`);
  });

  // Deploy (restart)
  fastify.post('/api/deploy', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge('/git/deploy', { method: 'POST', body: request.body });
  });

  // Rebuild
  fastify.post('/api/rebuild', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge('/git/rebuild', { method: 'POST', body: request.body });
  });

  // Poll rebuild status
  fastify.get<{ Params: { id: string } }>('/api/rebuild/:id', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge(`/git/rebuild/${encodeURIComponent(request.params.id)}`);
  });

  // Cancel rebuild
  fastify.delete<{ Params: { id: string } }>('/api/rebuild/:id', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge(`/git/rebuild/${encodeURIComponent(request.params.id)}`, { method: 'DELETE' });
  });

  // Rebuild task history
  fastify.get('/api/rebuild/tasks', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge('/git/rebuild/tasks');
  });

  // AI Review
  fastify.post('/api/ai-review', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge('/git/ai-review', { method: 'POST', body: request.body });
  });

  // AI Review chat
  fastify.post('/api/ai-review/chat', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge('/git/ai-review/chat', { method: 'POST', body: request.body });
  });

  // AI Review result
  fastify.get<{ Params: { id: string } }>('/api/review-result/:id', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge(`/git/review-result/${encodeURIComponent(request.params.id)}`);
  });

  // Reject branch (intervention respond)
  fastify.post<{ Params: { id: string } }>('/api/interventions/:id/respond', async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;
    return callForge(`/interventions/${encodeURIComponent(request.params.id)}/respond`, { method: 'POST', body: request.body });
  });
}
