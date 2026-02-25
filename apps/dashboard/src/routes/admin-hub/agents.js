// Agent CRUD, actions, batch operations, interventions, feedback, capabilities, model update
import { callForge, callForgeAdmin, transformAgent, transformExecution, mapAgentType, paginationResponse } from './utils.js';

export async function registerAgentRoutes(fastify, requireAdmin, query, queryOne) {

  // 1. GET /api/v1/admin/agents - List agents with stats
  fastify.get('/api/v1/admin/agents', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const agentsRes = await callForgeAdmin('/agents');
    if (agentsRes.error) {
      return reply.code(agentsRes.status || 503).send({
        error: 'Failed to fetch agents from Forge',
        message: agentsRes.message,
      });
    }

    // Forge admin route returns fully-transformed agents with stats
    return { agents: agentsRes.agents || [] };
  });

  // 2. GET /api/v1/admin/agents/:id - Agent detail with logs
  fastify.get('/api/v1/admin/agents/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const agentRes = await callForgeAdmin(`/agents/${id}`);

    if (agentRes.error) {
      return reply.code(agentRes.status || 404).send({ error: 'Agent not found' });
    }

    // Forge admin route returns fully-transformed { agent, logs, tasks }
    return { agent: agentRes.agent, logs: agentRes.logs || [], tasks: agentRes.tasks || [] };
  });

  // 3. POST /api/v1/admin/agents - Create agent
  fastify.post('/api/v1/admin/agents', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const body = request.body || {};
    const forgeBody = {
      name: body.name,
      description: body.description,
      systemPrompt: body.system_prompt || body.systemPrompt,
      modelId: body.modelId || body.model_id,
      autonomyLevel: body.autonomy_level ?? body.autonomyLevel ?? 2,
      enabledTools: body.enabledTools || body.enabled_tools,
      maxIterations: body.maxIterations || body.max_iterations,
      maxCostPerExecution: body.maxCostPerExecution || body.max_cost_per_execution,
      metadata: {
        ...(body.metadata || {}),
        type: body.type || body.metadata?.type || 'custom',
      },
    };

    const res = await callForgeAdmin('/agents', { method: 'POST', body: forgeBody });
    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to create agent', message: res.message });
    }

    return reply.code(201).send({ agent: res.agent });
  });

  // 3b. POST /api/v1/admin/agents/optimize-prompt - Optimize system prompt with AI
  fastify.post('/api/v1/admin/agents/optimize-prompt', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const body = request.body || {};
    const res = await callForge('/agents/optimize-prompt', { method: 'POST', body });
    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to optimize prompt', message: res.message });
    }
    return reply.send(res);
  });

  // 4. POST /api/v1/admin/agents/:id/run - Run agent
  fastify.post('/api/v1/admin/agents/:id/run', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const body = request.body || {};

    // Frontend may send {prompt: "..."} or {input: {prompt: "..."}} or {task_type, input: {prompt}}
    const prompt = body.prompt || (typeof body.input === 'object' ? body.input?.prompt : body.input) || 'Execute default task';
    const res = await callForgeAdmin('/executions', {
      method: 'POST',
      body: {
        agentId: id,
        input: prompt,
        metadata: { ...(body.metadata || {}), task_type: body.task_type || 'manual' },
      },
    });

    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to run agent', message: res.message });
    }

    return { execution: res.execution };
  });

  // 5. POST /api/v1/admin/agents/:id/stop - Stop (pause) agent
  fastify.post('/api/v1/admin/agents/:id/stop', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}`, {
      method: 'PUT',
      body: { status: 'paused' },
    });

    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to stop agent', message: res.message });
    }

    return { success: true, agent: res.agent };
  });

  // 6. POST /api/v1/admin/agents/:id/decommission - Archive agent
  fastify.post('/api/v1/admin/agents/:id/decommission', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}`, {
      method: 'PUT',
      body: { status: 'archived' },
    });

    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to decommission agent', message: res.message });
    }

    return { success: true };
  });

  // 7. POST /api/v1/admin/agents/:id/recommission - Reactivate agent
  fastify.post('/api/v1/admin/agents/:id/recommission', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}`, {
      method: 'PUT',
      body: { status: 'active' },
    });

    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to recommission agent', message: res.message });
    }

    return { success: true };
  });

  // 8. DELETE /api/v1/admin/agents/:id - Delete (archive) agent
  fastify.delete('/api/v1/admin/agents/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}`, { method: 'DELETE' });

    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to delete agent', message: res.message });
    }

    return { success: true };
  });

  // 9. POST /api/v1/admin/agents/batch/process - Batch process agents
  fastify.post('/api/v1/admin/agents/batch/process', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const agentsRes = await callForgeAdmin('/agents?status=active');
    if (agentsRes.error) {
      return reply.code(503).send({ error: 'Failed to fetch agents' });
    }

    const results = [];
    for (const agent of (agentsRes.agents || [])) {
      const execRes = await callForgeAdmin('/executions', {
        method: 'POST',
        body: {
          agentId: agent.id,
          input: 'Scheduled batch execution',
          metadata: { batch: true },
        },
      });
      results.push({
        agent_id: agent.id,
        agent_name: agent.name,
        success: !execRes.error,
        execution_id: execRes.execution?.id || null,
        error: execRes.error ? execRes.message : null,
      });
    }

    const succeeded = results.filter(r => r.success);
    return {
      results,
      processed: results.length,
      started: succeeded.length,
      agents: succeeded.map(r => r.agent_name),
    };
  });

  // 9b. POST /api/v1/admin/agents/batch/pause - Pause all active agents
  fastify.post('/api/v1/admin/agents/batch/pause', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const agentsRes = await callForgeAdmin('/agents?status=active');
    if (agentsRes.error) {
      return reply.code(503).send({ error: 'Failed to fetch agents' });
    }

    const results = [];
    for (const agent of (agentsRes.agents || [])) {
      const res = await callForgeAdmin(`/agents/${agent.id}`, {
        method: 'PUT',
        body: { status: 'paused' },
      });
      results.push({
        agent_id: agent.id,
        agent_name: agent.name,
        success: !res.error,
      });
    }

    const succeeded = results.filter(r => r.success);
    return {
      results,
      paused: succeeded.length,
      agents: succeeded.map(r => r.agent_name),
    };
  });

  // 10. POST /api/v1/admin/agents/:id/process - Process single agent
  fastify.post('/api/v1/admin/agents/:id/process', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const body = request.body || {};

    const res = await callForgeAdmin('/executions', {
      method: 'POST',
      body: {
        agentId: id,
        input: body.input || 'Process task',
        metadata: body.metadata || {},
      },
    });

    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to process agent', message: res.message });
    }

    return { success: true, execution: res.execution };
  });

  // 11. GET /api/v1/admin/orchestration - Orchestration overview
  fastify.get('/api/v1/admin/orchestration', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const [agentsRes, execsRes] = await Promise.all([
      callForgeAdmin('/agents'),
      callForgeAdmin('/executions?limit=100'),
    ]);

    // Forge admin returns pre-transformed agents (status: idle/running/paused, not 'active')
    const agents = agentsRes.error ? [] : (agentsRes.agents || []);
    const executions = execsRes.error ? [] : (execsRes.executions || []);

    const pendingInterventions = await queryOne(
      `SELECT COUNT(*) as count FROM agent_interventions WHERE status = 'pending'`
    );

    const activeAgents = agents.filter(a => !a.is_decommissioned);
    const runningAgents = agents.filter(a => a.status === 'running').length;
    const archivedAgents = agents.filter(a => a.is_decommissioned).length;
    const runningExecs = executions.filter(e => e.status === 'running' || e.status === 'pending').length;
    const totalAutonomy = activeAgents.reduce((sum, a) => sum + (a.autonomy_level ?? 2), 0);
    const avgAutonomy = activeAgents.length > 0 ? Math.round(totalAutonomy / activeAgents.length) : 0;

    return {
      agents: {
        total: agents.length,
        active: activeAgents.length,
        running: Math.max(runningAgents, runningExecs),
        decommissioned: archivedAgents,
        avgAutonomy,
      },
      pendingInterventions: parseInt(pendingInterventions?.count || '0'),
    };
  });

  // 12. GET /api/v1/admin/interventions - List interventions
  fastify.get('/api/v1/admin/interventions', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { status, page = '1', limit = '20' } = request.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    let whereClause = '';
    const params = [];
    if (status) {
      params.push(status);
      whereClause = `WHERE status = $${params.length}`;
    }

    const [interventions, countResult] = await Promise.all([
      query(`
        SELECT * FROM agent_interventions
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, parseInt(limit), offset]),
      queryOne(`SELECT COUNT(*) as count FROM agent_interventions ${whereClause}`, params),
    ]);

    const total = parseInt(countResult?.count || '0');
    const pg = parseInt(page);
    const lim = parseInt(limit);
    return {
      interventions,
      total,
      page: pg,
      limit: lim,
      pagination: paginationResponse(total, pg, lim),
    };
  });

  // 13. POST /api/v1/admin/interventions/:id/respond - Respond to intervention
  fastify.post('/api/v1/admin/interventions/:id/respond', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const { action, feedback, autonomy_delta } = request.body || {};

    if (!action || !['approve', 'deny', 'feedback'].includes(action)) {
      return reply.code(400).send({ error: 'Invalid action. Must be approve, deny, or feedback' });
    }

    const statusMap = { approve: 'approved', deny: 'denied', feedback: 'resolved' };

    // Snapshot old state
    const oldIntervention = await queryOne(`SELECT id, status, agent_name FROM agent_interventions WHERE id = $1`, [id]);

    const updated = await queryOne(`
      UPDATE agent_interventions
      SET status = $1, human_response = $2, responded_by = $3,
          responded_at = NOW(), autonomy_delta = COALESCE($4, autonomy_delta)
      WHERE id = $5
      RETURNING *
    `, [statusMap[action], feedback || action, admin.id, autonomy_delta ?? 0, id]);

    if (!updated) {
      return reply.code(404).send({ error: 'Intervention not found' });
    }

    // Audit trail
    try {
      await query(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value)
         VALUES ('intervention', $1, 'responded', $2, $3, $4, $5)`,
        [
          id,
          `human:${admin.username || admin.id}`,
          admin.id,
          JSON.stringify({ status: oldIntervention?.status || 'pending' }),
          JSON.stringify({ status: statusMap[action], action, feedback: feedback || null, autonomy_delta: autonomy_delta ?? 0 }),
        ]
      );
    } catch { /* audit non-fatal */ }

    return { intervention: updated };
  });

  // PATCH /api/v1/admin/agents/:id/model - Update agent model
  fastify.patch('/api/v1/admin/agents/:id/model', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${encodeURIComponent(id)}/model`, { method: 'PATCH', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Model update failed' });
    return res;
  });

  // Get execution detail
  fastify.get('/api/v1/admin/executions/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/executions/${id}`);
    if (res.error) return reply.code(res.status || 404).send({ error: 'Execution not found' });
    return res;
  });

  // Submit feedback on an execution
  fastify.post('/api/v1/admin/executions/:id/feedback', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/executions/${id}/feedback`, {
      method: 'POST',
      body: request.body,
    });
    return res;
  });

  // Get feedback stats for an agent
  fastify.get('/api/v1/admin/agents/:id/feedback', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}/feedback`);
    return res;
  });

  // Get correction patterns for an agent
  fastify.get('/api/v1/admin/agents/:id/corrections', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}/corrections`);
    return res;
  });

  // Get capabilities for a specific agent
  fastify.get('/api/v1/admin/agents/:id/capabilities', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}/capabilities`);
    return res;
  });

  // Detect capabilities for a specific agent
  fastify.post('/api/v1/admin/agents/:id/capabilities/detect', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}/capabilities/detect`, { method: 'POST' });
    return res;
  });

  // Detect capabilities for all agents
  fastify.post('/api/v1/admin/capabilities/detect-all', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/capabilities/detect-all', { method: 'POST' });
    return res;
  });

  // Find agents with a specific capability
  fastify.get('/api/v1/admin/capabilities/:name/agents', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { name } = request.params;
    const res = await callForgeAdmin(`/capabilities/${name}/agents`);
    return res;
  });

  // Get capability catalog
  fastify.get('/api/v1/admin/capabilities/catalog', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/capabilities/catalog');
    return res;
  });

  // Get all agents' capabilities summary
  fastify.get('/api/v1/admin/capabilities/summary', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/capabilities/summary');
    return res;
  });

  // Phase 6: Self-Rewriting Prompts
  fastify.post('/api/v1/admin/agents/:id/propose-revision', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/agents/${request.params.id}/propose-revision`, { method: 'POST', body: request.body || {} });
  });
  fastify.get('/api/v1/admin/agents/:id/prompt-revisions', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/agents/${request.params.id}/prompt-revisions`);
  });
  fastify.post('/api/v1/admin/prompt-revisions/:revisionId/apply', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/prompt-revisions/${request.params.revisionId}/apply`, { method: 'POST', body: request.body || {} });
  });
  fastify.post('/api/v1/admin/prompt-revisions/:revisionId/reject', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/prompt-revisions/${request.params.revisionId}/reject`, { method: 'POST', body: request.body || {} });
  });

  // Phase 9: Autonomous Goals
  fastify.post('/api/v1/admin/agents/:id/propose-goals', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/agents/${request.params.id}/propose-goals`, { method: 'POST', body: request.body || {} });
  });
  fastify.get('/api/v1/admin/agents/:id/goals', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const qs = request.query.status ? `?status=${request.query.status}` : '';
    return callForgeAdmin(`/agents/${request.params.id}/goals${qs}`);
  });
  fastify.post('/api/v1/admin/goals/:goalId/approve', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/goals/${request.params.goalId}/approve`, { method: 'POST', body: request.body || {} });
  });
  fastify.post('/api/v1/admin/goals/:goalId/reject', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/goals/${request.params.goalId}/reject`, { method: 'POST', body: request.body || {} });
  });

  // Phase 13: Evolution
  fastify.post('/api/v1/admin/agents/:id/clone', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/agents/${request.params.id}/clone`, { method: 'POST', body: request.body });
  });
  fastify.post('/api/v1/admin/evolution/experiment', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin('/evolution/experiment', { method: 'POST', body: request.body });
  });
  fastify.get('/api/v1/admin/agents/:id/experiments', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/agents/${request.params.id}/experiments`);
  });
  fastify.post('/api/v1/admin/evolution/:experimentId/promote', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    return callForgeAdmin(`/evolution/${request.params.experimentId}/promote`, { method: 'POST', body: request.body || {} });
  });

  // Agent performance report (aggregated execution metrics)
  fastify.get('/api/v1/admin/agents/performance', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const days = parseInt(request.query.days || '7', 10);
    try {
      const agents = await query(`
        SELECT a.id, a.name,
          COUNT(e.id)::int AS total_executions,
          COUNT(CASE WHEN e.status = 'completed' THEN 1 END)::int AS completed,
          COUNT(CASE WHEN e.status = 'failed' THEN 1 END)::int AS failed,
          COUNT(CASE WHEN e.status = 'cancelled' THEN 1 END)::int AS cancelled,
          COALESCE(ROUND(100.0 * COUNT(CASE WHEN e.status = 'completed' THEN 1 END) / NULLIF(COUNT(e.id), 0), 1), 0) AS success_rate,
          COALESCE(ROUND(100.0 * COUNT(CASE WHEN e.status = 'failed' THEN 1 END) / NULLIF(COUNT(e.id), 0), 1), 0) AS failure_rate,
          COALESCE(ROUND(AVG(e.duration_ms)), 0) AS avg_duration_ms,
          COALESCE(SUM(e.cost), 0) AS total_cost
        FROM forge_agents a
        LEFT JOIN forge_executions e ON e.agent_id = a.id AND e.started_at > NOW() - INTERVAL '1 day' * $1
        WHERE a.is_decommissioned = false
        GROUP BY a.id, a.name
        ORDER BY total_executions DESC
      `, [days]);

      const fleet = agents.reduce((acc, a) => ({
        totalExecutions: acc.totalExecutions + (a.total_executions || 0),
        successRate: 0,
        failureRate: 0,
        totalCost: acc.totalCost + parseFloat(a.total_cost || 0),
      }), { totalExecutions: 0, successRate: 0, failureRate: 0, totalCost: 0 });

      if (fleet.totalExecutions > 0) {
        const totalCompleted = agents.reduce((s, a) => s + (a.completed || 0), 0);
        const totalFailed = agents.reduce((s, a) => s + (a.failed || 0), 0);
        fleet.successRate = Math.round(1000 * totalCompleted / fleet.totalExecutions) / 10;
        fleet.failureRate = Math.round(1000 * totalFailed / fleet.totalExecutions) / 10;
      }

      return {
        days,
        fleet,
        agents: agents.map(a => ({
          agentId: a.id,
          agentName: a.name,
          totalExecutions: a.total_executions || 0,
          completed: a.completed || 0,
          failed: a.failed || 0,
          cancelled: a.cancelled || 0,
          successRate: parseFloat(a.success_rate) || 0,
          failureRate: parseFloat(a.failure_rate) || 0,
          avgDurationMs: parseInt(a.avg_duration_ms) || 0,
          totalCost: parseFloat(a.total_cost) || 0,
        })),
      };
    } catch (err) {
      console.error('[Performance] Query failed:', err.message);
      return reply.code(503).send({
        error: 'Performance data unavailable',
        days,
        fleet: { totalExecutions: 0, successRate: 0, failureRate: 0, totalCost: 0 },
        agents: [],
      });
    }
  });
}
