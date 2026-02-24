// Chat proxy routes — Layer 1 (any authenticated user)
// Proxies conversation and intent routes to forge

import { callForge } from './utils.js';

export async function registerChatRoutes(fastify, requireAuth, query, queryOne) {
  // Intent parsing
  fastify.post('/api/v1/admin/chat/intent', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForge('/intent/parse', {
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
    const res = await callForge(path, { timeout: 8000 });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  // Create conversation
  fastify.post('/api/v1/admin/chat/conversations', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForge('/conversations', {
      method: 'POST',
      body: request.body,
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return reply.code(201).send(res);
  });

  // Get conversation with messages
  fastify.get('/api/v1/admin/chat/conversations/:id', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForge(`/conversations/${request.params.id}`);
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return res;
  });

  // Send message
  fastify.post('/api/v1/admin/chat/conversations/:id/messages', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForge(`/conversations/${request.params.id}/messages`, {
      method: 'POST',
      body: request.body,
      timeout: 120000,
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return reply.code(201).send(res);
  });

  // Archive conversation
  fastify.delete('/api/v1/admin/chat/conversations/:id', async (request, reply) => {
    const auth = await requireAuth(request, reply); if (!auth) return;
    const res = await callForge(`/conversations/${request.params.id}`, {
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
    const res = await callForge(`/templates/${request.params.id}/instantiate`, {
      method: 'POST',
      body: request.body,
      timeout: 15000,
    });
    if (res.error) return reply.code(res.status || 503).send({ error: res.message });
    return reply.code(201).send(res);
  });
}
