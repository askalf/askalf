// Pure proxy routes to Forge: memory, git, workflows, costs, guardrails, providers,
// coordination, orchestration, events, context, handoffs, chat, NL orchestration,
// cost optimization, knowledge graph, monitoring
import { callForge, callForgeAdmin, FORGE_URL, FORGE_API_KEY } from './utils.js';

export async function registerProxyRoutes(fastify, requireAdmin, query, queryOne) {

  // ============================================
  // METABOLIC STATUS
  // ============================================

  fastify.get('/api/v1/admin/metabolic/status', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/metabolic/status');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Metabolic status unavailable' });
    return res;
  });

  // ============================================
  // FLEET MEMORY
  // ============================================

  fastify.get('/api/v1/admin/memory/stats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/fleet/stats');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Fleet memory unavailable', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/memory/search', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { q, tier, agent_id, source_type, limit = '20', page = '1' } = request.query;
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (tier) params.set('tier', tier);
    if (agent_id) params.set('agent_id', agent_id);
    if (source_type) params.set('source_type', source_type);
    params.set('limit', limit);
    params.set('page', page);
    const res = await callForge(`/fleet/search?${params.toString()}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Fleet memory unavailable', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/memory/recent', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { limit = '30', page = '1', agent_id, source_type, tier, dateFrom, dateTo } = request.query;
    const params = new URLSearchParams();
    params.set('limit', limit);
    params.set('page', page);
    if (agent_id) params.set('agent_id', agent_id);
    if (source_type) params.set('source_type', source_type);
    if (tier) params.set('tier', tier);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const res = await callForge(`/fleet/recent?${params.toString()}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Fleet memory unavailable', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/memory/recalls', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { limit = '30', page = '1' } = request.query;
    const params = new URLSearchParams();
    params.set('limit', limit);
    params.set('page', page);
    const res = await callForge(`/fleet/recalls?${params.toString()}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Fleet memory unavailable', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/memory/store', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/memory/store', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Memory store failed' });
    return res;
  });

  // ============================================
  // GIT REVIEW
  // ============================================

  fastify.get('/api/v1/admin/git-space/branches', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/git/branches');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Git review unavailable', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/git-space/diff/:branch', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { branch } = request.params;
    const encoded = encodeURIComponent(branch);
    // Fetch diff, commits, and file list in parallel
    const [diffRes, logRes, filesRes] = await Promise.all([
      callForge(`/git/diff/${encoded}`),
      callForge(`/git/log/${encoded}`),
      callForge(`/git/files/${encoded}`),
    ]);
    if (diffRes.error) return reply.code(diffRes.status || 503).send({ error: 'Git review unavailable', message: diffRes.message });
    return {
      ...diffRes,
      commits: logRes.commits || [],
      files: filesRes.files || [],
    };
  });

  fastify.get('/api/v1/admin/git-space/health/:service', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { service } = request.params;
    const res = await callForge(`/git/health/${encodeURIComponent(service)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Health check failed', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/git-space/merge', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/git/merge', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Git merge failed', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/git-space/deploy', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/git/deploy', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Deploy failed', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/git-space/rebuild', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/git/rebuild', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Rebuild failed', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/git-space/rebuild/tasks', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/git/rebuild/tasks');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Rebuild tasks unavailable', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/git-space/rebuild/:builderId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { builderId } = request.params;
    const res = await callForge(`/git/rebuild/${encodeURIComponent(builderId)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Rebuild status unavailable', message: res.message });
    return res;
  });

  fastify.delete('/api/v1/admin/git-space/rebuild/:builderId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { builderId } = request.params;
    const res = await callForge(`/git/rebuild/${encodeURIComponent(builderId)}`, { method: 'DELETE' });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Rebuild cancel failed', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/git-space/ai-review', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/git-space/ai-review', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'AI review unavailable', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/git-space/review-result/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/git-space/review-result/${encodeURIComponent(id)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Review result unavailable', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/git-space/ai-review/chat', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/git-space/ai-review/chat', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'AI review chat unavailable', message: res.message });
    return reply.send(res);
  });

  // ============================================
  // WORKFLOWS
  // ============================================

  fastify.get('/api/v1/admin/workflows', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { status, limit, offset } = request.query;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (limit) params.set('limit', limit);
    if (offset) params.set('offset', offset);
    const res = await callForge(`/workflows?${params.toString()}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Workflows unavailable', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/workflows/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForge(`/workflows/${encodeURIComponent(id)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Workflow not found', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/workflows', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/workflows', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Workflow creation failed', message: res.message });
    return res;
  });

  fastify.put('/api/v1/admin/workflows/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForge(`/workflows/${encodeURIComponent(id)}`, { method: 'PUT', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Workflow update failed', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/workflows/:id/run', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForge(`/workflows/${encodeURIComponent(id)}/run`, { method: 'POST', body: request.body || {} });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Workflow run failed', message: res.message });
    return res;
  });

  // ============================================
  // COSTS
  // ============================================

  fastify.get('/api/v1/admin/costs', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { startDate, endDate, agentId, days } = request.query;
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (agentId) params.set('agentId', agentId);
    if (days) params.set('days', days);
    const res = await callForgeAdmin(`/costs?${params.toString()}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Cost data unavailable', message: res.message });
    return res;
  });

  // ============================================
  // GUARDRAILS
  // ============================================

  fastify.get('/api/v1/admin/guardrails', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/admin/guardrails');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Guardrails unavailable', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/guardrails', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/admin/guardrails', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Guardrail creation failed', message: res.message });
    return res;
  });

  fastify.patch('/api/v1/admin/guardrails/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForge(`/admin/guardrails/${encodeURIComponent(id)}`, { method: 'PATCH', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Guardrail update failed', message: res.message });
    return res;
  });

  fastify.delete('/api/v1/admin/guardrails/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForge(`/admin/guardrails/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Guardrail deletion failed', message: res.message });
    return res;
  });

  // ============================================
  // PROVIDERS
  // ============================================

  fastify.get('/api/v1/admin/providers', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/providers');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Providers unavailable', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/providers/health', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/providers/health');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Provider health unavailable', message: res.message });
    return res;
  });

  fastify.post('/api/v1/admin/providers/health-check', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForge('/providers/health-check', { method: 'POST', body: {} });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Health check failed', message: res.message });
    return res;
  });

  fastify.get('/api/v1/admin/providers/:id/models', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForge(`/providers/${encodeURIComponent(id)}/models`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Provider models unavailable', message: res.message });
    return res;
  });

  fastify.patch('/api/v1/admin/providers/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForge(`/providers/${encodeURIComponent(id)}`, { method: 'PATCH', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Provider update failed', message: res.message });
    return res;
  });

  // ============================================
  // COORDINATION
  // ============================================

  fastify.get('/api/v1/admin/coordination/sessions', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/coordination/sessions');
    if (res.error) return reply.code(res.status || 503).send({ sessions: [] });
    return res;
  });

  fastify.get('/api/v1/admin/coordination/sessions/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/coordination/sessions/${encodeURIComponent(id)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Session unavailable' });
    return res;
  });

  fastify.post('/api/v1/admin/coordination/sessions', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/coordination/sessions', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Session creation failed' });
    return res;
  });

  fastify.post('/api/v1/admin/coordination/sessions/:id/cancel', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/coordination/sessions/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Session cancel failed' });
    return res;
  });

  fastify.get('/api/v1/admin/coordination/plans', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/coordination/plans');
    if (res.error) return reply.code(res.status || 503).send({ plans: [] });
    return res;
  });

  fastify.get('/api/v1/admin/coordination/stats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/coordination/stats');
    if (res.error) return reply.code(res.status || 503).send({ totalSessions: 0, activeSessions: 0, completedSessions: 0, failedSessions: 0 });
    return res;
  });

  fastify.post('/api/v1/admin/coordination/orchestrate', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/coordination/orchestrate', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Orchestration failed', message: res.message });
    return res;
  });

  // ============================================
  // CHECKPOINTS (Human-in-the-loop)
  // ============================================

  fastify.get('/api/v1/admin/checkpoints', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { owner_id, status, limit } = request.query;
    const params = new URLSearchParams();
    if (owner_id) params.set('owner_id', owner_id);
    if (status) params.set('status', status);
    if (limit) params.set('limit', limit);
    const qs = params.toString();
    const res = await callForgeAdmin(`/checkpoints${qs ? `?${qs}` : ''}`);
    if (res.error) return reply.code(res.status || 503).send({ checkpoints: [] });
    return res;
  });

  fastify.get('/api/v1/admin/checkpoints/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/checkpoints/${encodeURIComponent(id)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Checkpoint unavailable' });
    return res;
  });

  fastify.post('/api/v1/admin/checkpoints/:id/respond', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/checkpoints/${encodeURIComponent(id)}/respond`, { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Checkpoint response failed' });
    return res;
  });

  // ============================================
  // REAL-TIME EVENTS & SHARED CONTEXT
  // ============================================

  // SSE event stream (proxy to Forge)
  fastify.get('/api/v1/admin/events/stream', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const url = `${FORGE_URL}/api/v1/admin/events/stream`;
    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'text/event-stream',
          ...(FORGE_API_KEY ? { 'Authorization': `Bearer ${FORGE_API_KEY}` } : {}),
          'x-user-id': admin.id || '',
          'x-user-role': admin.role || '',
        },
      });
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const reader = res.body?.getReader();
      if (!reader) {
        reply.raw.end();
        return;
      }
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          try { reply.raw.write(value); } catch { break; }
        }
        reply.raw.end();
      };
      void pump();
      request.raw.on('close', () => { reader.cancel(); });
      await reply;
    } catch (err) {
      reply.code(502).send({ error: 'Event stream unavailable' });
    }
  });

  // Shared context
  fastify.post('/api/v1/admin/context/:sessionId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { sessionId } = request.params;
    const res = await callForgeAdmin(`/context/${sessionId}`, { method: 'POST', body: request.body });
    return res;
  });

  fastify.get('/api/v1/admin/context/:sessionId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { sessionId } = request.params;
    const qs = new URLSearchParams(request.query).toString();
    const res = await callForgeAdmin(`/context/${sessionId}${qs ? `?${qs}` : ''}`);
    return res;
  });

  // Handoffs
  fastify.post('/api/v1/admin/handoff', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/handoff', { method: 'POST', body: request.body });
    return res;
  });

  fastify.get('/api/v1/admin/handoff/:sessionId/:handoffId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { sessionId, handoffId } = request.params;
    const res = await callForgeAdmin(`/handoff/${sessionId}/${handoffId}`);
    return res;
  });

  // Phase 7: Natural Language Orchestration
  fastify.post('/api/v1/admin/orchestrate-nl', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/orchestrate-nl', { method: 'POST', body: request.body });
  });
  fastify.get('/api/v1/admin/orchestration/:sessionId/status', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/orchestration/${request.params.sessionId}/status`);
  });

  // Phase 8: Multi-Agent Chat
  fastify.post('/api/v1/admin/chat/create', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/chat/create', { method: 'POST', body: request.body });
  });
  fastify.get('/api/v1/admin/chat/sessions', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/chat/sessions');
  });
  fastify.get('/api/v1/admin/chat/:sessionId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/chat/${request.params.sessionId}`);
  });
  fastify.post('/api/v1/admin/chat/:sessionId/message', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/chat/${request.params.sessionId}/message`, { method: 'POST', body: request.body });
  });
  fastify.post('/api/v1/admin/chat/:sessionId/respond/:agentId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/chat/${request.params.sessionId}/respond/${request.params.agentId}`, { method: 'POST', body: request.body || {} });
  });
  fastify.post('/api/v1/admin/chat/:sessionId/round', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/chat/${request.params.sessionId}/round`, { method: 'POST', body: request.body || {} });
  });
  fastify.post('/api/v1/admin/chat/:sessionId/end', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/chat/${request.params.sessionId}/end`, { method: 'POST', body: request.body || {} });
  });

  // Phase 10: Cost Optimization
  fastify.get('/api/v1/admin/cost/dashboard', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/cost/dashboard');
  });
  fastify.post('/api/v1/admin/cost/recommend', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/cost/recommend', { method: 'POST', body: request.body });
  });
  fastify.get('/api/v1/admin/cost/optimal-model', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const qs = new URLSearchParams(request.query).toString();
    return callForgeAdmin(`/cost/optimal-model?${qs}`);
  });

  // Phase 11: Knowledge Graph
  fastify.get('/api/v1/admin/knowledge/stats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/knowledge/stats');
  });
  fastify.get('/api/v1/admin/knowledge/search', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const qs = new URLSearchParams(request.query).toString();
    return callForgeAdmin(`/knowledge/search?${qs}`);
  });
  fastify.get('/api/v1/admin/knowledge/nodes/:nodeId/neighborhood', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/knowledge/nodes/${request.params.nodeId}/neighborhood`);
  });
  fastify.get('/api/v1/admin/knowledge/graph', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const qs = new URLSearchParams(request.query).toString();
    return callForgeAdmin(`/knowledge/graph?${qs}`);
  });
  fastify.get('/api/v1/admin/knowledge/entity-types', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/knowledge/entity-types');
  });
  fastify.get('/api/v1/admin/knowledge/agents', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/knowledge/agents');
  });
  fastify.get('/api/v1/admin/knowledge/top-connected', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const qs = new URLSearchParams(request.query).toString();
    return callForgeAdmin(`/knowledge/top-connected?${qs}`);
  });
  fastify.get('/api/v1/admin/knowledge/nodes/:nodeId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/knowledge/nodes/${request.params.nodeId}`);
  });

  // Phase 12: Monitoring
  fastify.get('/api/v1/admin/monitoring/health', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/monitoring/health');
  });

  // Phase 14: Event Log, Leaderboard, Replay
  fastify.get('/api/v1/admin/events/recent', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const qs = request.query.limit ? `?limit=${request.query.limit}` : '';
    return callForgeAdmin(`/events/recent${qs}`);
  });
  fastify.get('/api/v1/admin/events/execution/:executionId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/events/execution/${request.params.executionId}`);
  });
  fastify.get('/api/v1/admin/events/session/:sessionId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/events/session/${request.params.sessionId}`);
  });
  fastify.get('/api/v1/admin/events/stats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/events/stats');
  });
  fastify.get('/api/v1/admin/fleet/leaderboard', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/fleet/leaderboard');
  });

  // ============================================
  // TOOLS
  // ============================================

  fastify.get('/api/v1/admin/tools', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { type, enabled } = request.query;
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    if (enabled !== undefined) params.set('enabled', enabled);
    params.set('limit', '200');
    const qs = params.toString();
    const res = await callForge(`/tools?${qs}`);
    if (res.error) return reply.code(res.status || 503).send({ tools: [] });
    return res;
  });

  // ============================================
  // FLEET-WIDE GOALS & PROMPT REVISIONS
  // ============================================

  fastify.get('/api/v1/admin/goals', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { status, agent_id, limit } = request.query;
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (agent_id) params.set('agent_id', agent_id);
    if (limit) params.set('limit', limit);
    const qs = params.toString();
    return callForgeAdmin(`/goals${qs ? `?${qs}` : ''}`);
  });

  fastify.get('/api/v1/admin/goals/:goalId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/goals/${encodeURIComponent(request.params.goalId)}`);
  });

  fastify.get('/api/v1/admin/prompt-revisions', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { status } = request.query;
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return callForgeAdmin(`/prompt-revisions${qs}`);
  });

}
