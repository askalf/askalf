// Chat proxy routes — Layer 1 (any authenticated user)
// Proxies conversation and intent routes to forge
// Forwards real user ID via X-User-Id header so forge creates per-user conversations

import { callForge } from './utils.js';

// Helper: call forge with user identity forwarded
function callForgeAsUser(path, userId, options = {}) {
  return callForge(path, {
    ...options,
    headers: { ...options.headers, 'X-User-Id': userId },
  });
}

export async function registerChatRoutes(fastify, requireAuth, query, queryOne) {
  // Intent parsing
  fastify.post('/api/v1/admin/chat/intent', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForgeAsUser('/intent/parse', auth.id, {
      method: 'POST',
      body: request.body,
      timeout: 30000,
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  // List conversations
  fastify.get('/api/v1/admin/chat/conversations', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const qs = new URLSearchParams(request.query).toString();
    const path = qs ? `/conversations?${qs}` : '/conversations';
    const res = await callForgeAsUser(path, auth.id, { timeout: 8000 });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  // Create conversation
  fastify.post('/api/v1/admin/chat/conversations', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForgeAsUser('/conversations', auth.id, {
      method: 'POST',
      body: request.body,
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return reply.code(201).send(res);
  });

  // Get conversation with messages
  fastify.get('/api/v1/admin/chat/conversations/:id', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForgeAsUser(`/conversations/${request.params.id}`, auth.id);
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  // Send message
  fastify.post('/api/v1/admin/chat/conversations/:id/messages', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForgeAsUser(`/conversations/${request.params.id}/messages`, auth.id, {
      method: 'POST',
      body: request.body,
      timeout: 120000,
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return reply.code(201).send(res);
  });

  // Rename conversation
  fastify.patch('/api/v1/admin/chat/conversations/:id', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForgeAsUser(`/conversations/${request.params.id}`, auth.id, {
      method: 'PATCH',
      body: request.body,
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  // Archive conversation
  fastify.delete('/api/v1/admin/chat/conversations/:id', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForgeAsUser(`/conversations/${request.params.id}`, auth.id, {
      method: 'DELETE',
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  // Templates (public read access)
  fastify.get('/api/v1/admin/chat/templates', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForge('/templates');
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/chat/templates/:id', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForge(`/templates/${request.params.id}`);
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  // Instantiate template
  fastify.post('/api/v1/admin/chat/templates/:id/instantiate', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForgeAsUser(`/templates/${request.params.id}/instantiate`, auth.id, {
      method: 'POST',
      body: request.body,
      timeout: 15000,
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return reply.code(201).send(res);
  });

  // Dispatch multi-agent orchestration plan
  fastify.post('/api/v1/admin/chat/dispatch-orchestration', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForgeAsUser('/intent/dispatch-orchestration', auth.id, {
      method: 'POST',
      body: request.body,
      timeout: 30000,
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  // Get orchestration session status
  fastify.get('/api/v1/admin/chat/orchestration/:sessionId/status', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForge(`/orchestration/${request.params.sessionId}/status`);
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });
}
