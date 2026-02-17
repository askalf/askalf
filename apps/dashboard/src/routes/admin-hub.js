// Agent Hub admin routes
// Proxies to Forge microservice + manages local hub tables (interventions, tickets, schedules)

import crypto from 'crypto';

const FORGE_URL = process.env.FORGE_URL || 'http://forge:3005';
const FORGE_API_KEY = process.env.FORGE_API_KEY || '';

function ulid() {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = crypto.randomBytes(10).toString('hex').slice(0, 16);
  return (timestamp + random).toUpperCase();
}

// Build pagination response object expected by frontend
function paginationResponse(total, page, limit) {
  const totalPages = Math.ceil(total / limit) || 1;
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
}

// Scheduler running state (the daemon runs inside this process)
let schedulerRunning = true;

async function callForgeAdmin(path, options = {}) {
  const url = `${FORGE_URL}/api/v1/admin${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(FORGE_API_KEY ? { 'Authorization': `Bearer ${FORGE_API_KEY}` } : {}),
    ...options.headers,
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
      return { error: true, status: res.status, message: text.substring(0, 200) };
    }

    return await res.json();
  } catch (err) {
    return { error: true, status: 503, message: err.message || 'Forge admin unreachable' };
  }
}

async function callForge(path, options = {}) {
  const url = `${FORGE_URL}/api/v1/forge${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(FORGE_API_KEY ? { 'Authorization': `Bearer ${FORGE_API_KEY}` } : {}),
    ...options.headers,
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
  } catch (err) {
    return { error: true, status: 503, message: `Forge unreachable: ${err.message}` };
  }
}

// Map Forge agent type metadata to admin type
function mapAgentType(metadata) {
  const typeMap = {
    development: 'dev',
    dev: 'dev',
    research: 'research',
    support: 'support',
    content: 'content',
    monitoring: 'monitor',
    monitor: 'monitor',
  };
  const raw = metadata?.type || '';
  return typeMap[raw.toLowerCase()] || 'custom';
}

// Map Forge agent status to admin status
function mapAgentStatus(status, isArchived) {
  if (isArchived || status === 'archived') return 'idle';
  if (status === 'paused') return 'paused';
  if (status === 'active' || status === 'draft') return 'idle';
  return 'idle';
}

// Transform a Forge agent to the admin agent shape
function transformAgent(forgeAgent, executions = [], pendingInterventions = 0) {
  const agentExecs = executions.filter(e => e.agent_id === forgeAgent.id);
  const completed = agentExecs.filter(e => e.status === 'completed');
  const failed = agentExecs.filter(e => e.status === 'failed');
  const running = agentExecs.find(e => e.status === 'running' || e.status === 'pending');
  const lastCompleted = completed.sort((a, b) =>
    new Date(b.completed_at || b.created_at) - new Date(a.completed_at || a.created_at)
  )[0];

  return {
    id: forgeAgent.id,
    name: forgeAgent.name,
    type: mapAgentType(forgeAgent.metadata),
    status: running ? 'running' : mapAgentStatus(forgeAgent.status, forgeAgent.status === 'archived'),
    description: forgeAgent.description || '',
    system_prompt: forgeAgent.system_prompt || '',
    schedule: null,
    config: forgeAgent.provider_config || {},
    autonomy_level: forgeAgent.autonomy_level ?? 2,
    is_decommissioned: forgeAgent.status === 'archived',
    decommissioned_at: forgeAgent.status === 'archived' ? forgeAgent.updated_at : null,
    tasks_completed: completed.length,
    tasks_failed: failed.length,
    current_task: running ? running.id : null,
    last_run_at: lastCompleted?.completed_at || lastCompleted?.created_at || null,
    pending_interventions: pendingInterventions,
    created_at: forgeAgent.created_at,
    updated_at: forgeAgent.updated_at,
  };
}

// Transform a Forge execution to admin task shape
function transformExecution(exec, agentName = '', agentType = 'custom') {
  return {
    id: exec.id,
    agent_id: exec.agent_id,
    agent_name: agentName,
    agent_type: agentType,
    type: exec.metadata?.task_type || 'execution',
    status: exec.status,
    input: { prompt: exec.input || '' },
    output: exec.output ? { response: exec.output } : null,
    error: exec.error || null,
    started_at: exec.started_at || exec.created_at,
    completed_at: exec.completed_at || null,
    duration_seconds: exec.duration_ms ? Math.round(exec.duration_ms / 1000) : null,
    tokens_used: exec.total_tokens || 0,
    cost: parseFloat(exec.cost || '0'),
    metadata: exec.metadata || {},
    created_at: exec.created_at,
  };
}

export async function registerAdminHubRoutes(fastify, requireAdmin, query, queryOne) {

  // ============================================================
  // AGENTS ENDPOINTS (13)
  // ============================================================

  // 1. GET /api/v1/admin/agents - List agents with stats
  fastify.get('/api/v1/admin/agents', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const agentsRes = await callForge('/agents?limit=100');
    if (agentsRes.error) {
      return reply.code(agentsRes.status || 503).send({
        error: 'Failed to fetch agents from Forge',
        message: agentsRes.message,
      });
    }

    const execsRes = await callForge('/executions?limit=100');
    const executions = execsRes.error ? [] : (execsRes.executions || []);

    // Get pending intervention counts per agent
    const interventionCounts = await query(`
      SELECT agent_id, COUNT(*) as count
      FROM agent_interventions
      WHERE status = 'pending'
      GROUP BY agent_id
    `);
    const interventionMap = {};
    for (const row of interventionCounts) {
      interventionMap[row.agent_id] = parseInt(row.count);
    }

    const agents = (agentsRes.agents || []).map(a =>
      transformAgent(a, executions, interventionMap[a.id] || 0)
    );

    return { agents };
  });

  // 2. GET /api/v1/admin/agents/:id - Agent detail with logs
  fastify.get('/api/v1/admin/agents/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const [agentRes, execsRes] = await Promise.all([
      callForge(`/agents/${id}`),
      callForge(`/executions?agentId=${id}&limit=50`),
    ]);

    if (agentRes.error) {
      return reply.code(agentRes.status || 404).send({ error: 'Agent not found' });
    }

    const executions = execsRes.error ? [] : (execsRes.executions || []);
    const pendingCount = await queryOne(`
      SELECT COUNT(*) as count FROM agent_interventions
      WHERE agent_id = $1 AND status = 'pending'
    `, [id]);

    const agent = transformAgent(agentRes.agent, executions, parseInt(pendingCount?.count || '0'));

    // Synthesize logs from executions
    const logs = executions.map(exec => ({
      id: exec.id,
      created_at: exec.started_at || exec.created_at,
      level: exec.status === 'failed' ? 'error' : 'info',
      message: exec.status === 'failed'
        ? `Execution failed: ${exec.error || 'Unknown error'}`
        : `Execution ${exec.status}: ${(exec.input || '').substring(0, 100)}`,
      metadata: {
        execution_id: exec.id,
        status: exec.status,
        tokens: exec.total_tokens,
        cost: exec.cost,
        duration_ms: exec.duration_ms,
      },
    })).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Synthesize tasks from executions for agent detail
    const tasks = executions.map(exec => transformExecution(exec, agentRes.agent.name, mapAgentType(agentRes.agent.metadata)));

    return { agent, logs, tasks };
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
      autonomyLevel: body.autonomy_level ?? body.autonomyLevel ?? 2,
      metadata: {
        ...(body.metadata || {}),
        type: body.type || body.metadata?.type || 'custom',
      },
    };

    const res = await callForge('/agents', { method: 'POST', body: forgeBody });
    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to create agent', message: res.message });
    }

    const agent = transformAgent(res.agent);
    return reply.code(201).send({ agent });
  });

  // 4. POST /api/v1/admin/agents/:id/run - Run agent
  fastify.post('/api/v1/admin/agents/:id/run', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const body = request.body || {};

    // Frontend may send {prompt: "..."} or {input: {prompt: "..."}} or {task_type, input: {prompt}}
    const prompt = body.prompt || (typeof body.input === 'object' ? body.input?.prompt : body.input) || 'Execute default task';
    const res = await callForge('/executions', {
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
    const res = await callForge(`/agents/${id}`, {
      method: 'PUT',
      body: { status: 'paused' },
    });

    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to stop agent', message: res.message });
    }

    return { success: true, agent: transformAgent(res.agent) };
  });

  // 6. POST /api/v1/admin/agents/:id/decommission - Archive agent
  fastify.post('/api/v1/admin/agents/:id/decommission', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const res = await callForge(`/agents/${id}`, {
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
    const res = await callForge(`/agents/${id}`, {
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
    const res = await callForge(`/agents/${id}`, { method: 'DELETE' });

    if (res.error) {
      return reply.code(res.status || 500).send({ error: 'Failed to delete agent', message: res.message });
    }

    return { success: true };
  });

  // 9. POST /api/v1/admin/agents/batch/process - Batch process agents
  fastify.post('/api/v1/admin/agents/batch/process', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const agentsRes = await callForge('/agents?status=active&limit=100');
    if (agentsRes.error) {
      return reply.code(503).send({ error: 'Failed to fetch agents' });
    }

    const results = [];
    for (const agent of (agentsRes.agents || [])) {
      const execRes = await callForge('/executions', {
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

    const agentsRes = await callForge('/agents?status=active&limit=100');
    if (agentsRes.error) {
      return reply.code(503).send({ error: 'Failed to fetch agents' });
    }

    const results = [];
    for (const agent of (agentsRes.agents || [])) {
      const res = await callForge(`/agents/${agent.id}`, {
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

    const res = await callForge('/executions', {
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
      callForge('/agents?limit=100'),
      callForge('/executions?limit=100'),
    ]);

    const agents = agentsRes.error ? [] : (agentsRes.agents || []);
    const executions = execsRes.error ? [] : (execsRes.executions || []);

    const pendingInterventions = await queryOne(
      `SELECT COUNT(*) as count FROM agent_interventions WHERE status = 'pending'`
    );

    const activeAgentCount = agents.filter(a => a.status === 'active').length;
    const archivedAgents = agents.filter(a => a.status === 'archived').length;
    const runningExecs = executions.filter(e => e.status === 'running' || e.status === 'pending').length;
    const totalAutonomy = agents.reduce((sum, a) => sum + (a.autonomy_level ?? 2), 0);
    const avgAutonomy = agents.length > 0 ? Math.round(totalAutonomy / agents.length) : 0;

    return {
      agents: {
        total: agents.length,
        active: activeAgentCount,
        running: runningExecs,
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

  // ============================================================
  // TASKS ENDPOINTS (3)
  // ============================================================

  // 14. GET /api/v1/admin/tasks - List tasks (executions)
  fastify.get('/api/v1/admin/tasks', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { status, agent_id, page = '1', limit = '20' } = request.query;
    const queryParams = new URLSearchParams();
    queryParams.set('limit', limit);
    queryParams.set('offset', String((parseInt(page) - 1) * parseInt(limit)));
    if (status) queryParams.set('status', status);
    if (agent_id) queryParams.set('agentId', agent_id);

    const [execsRes, agentsRes] = await Promise.all([
      callForge(`/executions?${queryParams.toString()}`),
      callForge('/agents?limit=100'),
    ]);

    if (execsRes.error) {
      return reply.code(503).send({ error: 'Failed to fetch tasks', message: execsRes.message });
    }

    const agentMap = {};
    for (const a of (agentsRes.agents || [])) {
      agentMap[a.id] = { name: a.name, type: mapAgentType(a.metadata) };
    }

    const tasks = (execsRes.executions || []).map(exec => {
      const info = agentMap[exec.agent_id] || { name: 'Unknown', type: 'custom' };
      return transformExecution(exec, info.name, info.type);
    });

    const total = execsRes.total || tasks.length;
    const pg = parseInt(page);
    const lim = parseInt(limit);
    return {
      tasks,
      total,
      page: pg,
      limit: lim,
      pagination: paginationResponse(total, pg, lim),
    };
  });

  // 15. GET /api/v1/admin/tasks/stats - Task statistics
  fastify.get('/api/v1/admin/tasks/stats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const execsRes = await callForge('/executions?limit=100');
    const executions = execsRes.error ? [] : (execsRes.executions || []);

    const agentsRes = await callForge('/agents?limit=100');
    const agentMap = {};
    for (const a of (agentsRes.agents || [])) {
      agentMap[a.id] = { name: a.name, type: mapAgentType(a.metadata) };
    }

    const total = executions.length;
    const pending = executions.filter(e => e.status === 'pending').length;
    const running = executions.filter(e => e.status === 'running').length;
    const completed = executions.filter(e => e.status === 'completed').length;
    const failed = executions.filter(e => e.status === 'failed').length;

    // Stats by agent
    const byAgent = {};
    for (const exec of executions) {
      const info = agentMap[exec.agent_id] || { name: 'Unknown', type: 'custom' };
      if (!byAgent[exec.agent_id]) {
        byAgent[exec.agent_id] = {
          agent_id: exec.agent_id,
          agent_name: info.name,
          agent_type: info.type,
          total: 0, completed: 0, failed: 0, pending: 0, running: 0,
        };
      }
      byAgent[exec.agent_id].total++;
      if (exec.status === 'completed') byAgent[exec.agent_id].completed++;
      else if (exec.status === 'failed') byAgent[exec.agent_id].failed++;
      else if (exec.status === 'pending') byAgent[exec.agent_id].pending++;
      else if (exec.status === 'running') byAgent[exec.agent_id].running++;
    }

    return {
      totals: {
        total,
        pending,
        in_progress: running,
        completed,
        failed,
        handoffs: 0,
      },
      recentByAgent: Object.values(byAgent).map(a => ({
        agent_name: a.agent_name,
        task_count: String(a.total),
        success_rate: a.total > 0 ? String(Math.round((a.completed / a.total) * 100)) : '0',
      })),
    };
  });

  // 16. GET /api/v1/admin/tasks/:id - Task detail
  fastify.get('/api/v1/admin/tasks/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const execRes = await callForge(`/executions/${id}`);

    if (execRes.error) {
      return reply.code(execRes.status || 404).send({ error: 'Task not found' });
    }

    const exec = execRes.execution;
    const agentRes = await callForge(`/agents/${exec.agent_id}`);
    const agentName = agentRes.agent?.name || 'Unknown';
    const agentType = mapAgentType(agentRes.agent?.metadata);

    const interventions = await query(
      `SELECT * FROM agent_interventions WHERE task_id = $1 ORDER BY created_at DESC`,
      [id]
    );

    const task = transformExecution(exec, agentName, agentType);

    // Build logs from execution metadata (iterations)
    const logs = [];
    if (exec.metadata?.iterations) {
      for (const iter of exec.metadata.iterations) {
        logs.push({
          id: `${exec.id}-iter-${iter.iteration || logs.length}`,
          level: 'info',
          message: iter.thinking || iter.response || `Iteration ${iter.iteration || logs.length + 1}`,
          metadata: { iteration: iter.iteration, tool_calls: iter.tool_calls },
          created_at: iter.timestamp || exec.started_at || exec.created_at,
        });
      }
    }
    // Add start/end log entries
    if (exec.started_at) {
      logs.unshift({ id: `${exec.id}-start`, level: 'info', message: `Execution started`, metadata: {}, created_at: exec.started_at });
    }
    if (exec.completed_at) {
      logs.push({
        id: `${exec.id}-end`,
        level: exec.status === 'failed' ? 'error' : 'info',
        message: exec.status === 'failed' ? `Execution failed: ${exec.error || 'Unknown'}` : `Execution completed (${exec.total_tokens || 0} tokens, $${parseFloat(exec.cost || '0').toFixed(4)})`,
        metadata: { status: exec.status, tokens: exec.total_tokens, cost: exec.cost },
        created_at: exec.completed_at,
      });
    }

    // Check for child tasks (executions triggered by this execution)
    const childExecsRes = await callForge(`/executions?limit=20`);
    const childTasks = [];
    if (!childExecsRes.error) {
      for (const ce of (childExecsRes.executions || [])) {
        if (ce.metadata?.parent_execution_id === id) {
          const cAgentInfo = agentRes.agent ? { name: agentRes.agent.name } : { name: 'Unknown' };
          childTasks.push({
            id: ce.id,
            agent_name: cAgentInfo.name,
            type: ce.metadata?.task_type || 'execution',
            status: ce.status,
            created_at: ce.created_at,
          });
        }
      }
    }

    return { task, interventions, logs, childTasks };
  });

  // ============================================================
  // REPORTS ENDPOINTS (7)
  // ============================================================

  // 17. GET /api/v1/admin/reports/metrics - System metrics
  fastify.get('/api/v1/admin/reports/metrics', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    // Local substrate DB stats
    const [userCount, activeUserCount, newUserCount, shardCount, highConfShards, chatSessionCount, chatMsgCount, ticketCount, openTicketCount, agentTicketCount, tableCount, dbSize] = await Promise.all([
      queryOne(`SELECT COUNT(*) as count FROM users`),
      queryOne(`SELECT COUNT(*) as count FROM users WHERE last_login_at > NOW() - INTERVAL '24 hours'`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '7 days'`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(*) as count FROM shards`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(*) as count FROM shards WHERE confidence >= 0.8`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(DISTINCT session_id) as count FROM chat_messages`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(*) as count FROM chat_messages`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(*) as count FROM agent_tickets`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(*) as count FROM agent_tickets WHERE status IN ('open', 'in_progress')`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(*) as count FROM agent_tickets WHERE source = 'agent'`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'`).catch(() => ({ count: '0' })),
      queryOne(`SELECT pg_size_pretty(pg_database_size(current_database())) as size`).catch(() => ({ size: '-' })),
    ]);

    // Forge stats
    const [agentsRes, execsRes] = await Promise.all([
      callForge('/agents?limit=100'),
      callForge('/executions?limit=100'),
    ]);

    const forgeAgents = agentsRes.error ? [] : (agentsRes.agents || []);
    const forgeExecs = execsRes.error ? [] : (execsRes.executions || []);
    const runningAgents = forgeExecs.filter(e => e.status === 'running' || e.status === 'pending').length;
    const today = new Date().toISOString().split('T')[0];
    const tasksToday = forgeExecs.filter(e => (e.created_at || '').startsWith(today)).length;
    const pendingInterventions = await queryOne(`SELECT COUNT(*) as count FROM agent_interventions WHERE status = 'pending'`).catch(() => ({ count: '0' }));

    const totalShards = parseInt(shardCount?.count || '0');
    const highConf = parseInt(highConfShards?.count || '0');
    const shardSuccessRate = totalShards > 0 ? Math.round((highConf / totalShards) * 100) : 0;

    const totalSessions = parseInt(chatSessionCount?.count || '0');
    const totalMessages = parseInt(chatMsgCount?.count || '0');

    return {
      users: {
        total: parseInt(userCount?.count || '0'),
        active_24h: parseInt(activeUserCount?.count || '0'),
        new_7d: parseInt(newUserCount?.count || '0'),
      },
      shards: {
        total: totalShards,
        high_confidence: highConf,
        success_rate: shardSuccessRate,
      },
      chat: {
        sessions: totalSessions,
        messages: totalMessages,
        avg_per_session: totalSessions > 0 ? Math.round(totalMessages / totalSessions) : 0,
      },
      agents: {
        total: forgeAgents.length,
        running: runningAgents,
        tasks_today: tasksToday,
        interventions_pending: parseInt(pendingInterventions?.count || '0'),
      },
      tickets: {
        total: parseInt(ticketCount?.count || '0'),
        open: parseInt(openTicketCount?.count || '0'),
        agent_created: parseInt(agentTicketCount?.count || '0'),
      },
      database: {
        tables: parseInt(tableCount?.count || '0'),
        size: dbSize?.size || '-',
      },
    };
  });

  // 18. GET /api/v1/admin/reports/activity - Recent activity
  fastify.get('/api/v1/admin/reports/activity', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const [execsRes, agentsRes] = await Promise.all([
      callForge('/executions?limit=50'),
      callForge('/agents?limit=100'),
    ]);

    if (execsRes.error) {
      return { activity: [], error: 'Forge unavailable' };
    }

    const agentMap = {};
    for (const a of (agentsRes.agents || [])) {
      agentMap[a.id] = { name: a.name, type: mapAgentType(a.metadata) };
    }

    const activity = (execsRes.executions || []).map(exec => {
      const info = agentMap[exec.agent_id] || { name: 'Unknown', type: 'custom' };
      return {
        id: exec.id,
        agent_name: info.name,
        agent_type: info.type,
        task_type: exec.metadata?.task_type || 'execution',
        status: exec.status,
        started_at: exec.started_at || exec.created_at,
        completed_at: exec.completed_at,
        duration_seconds: exec.duration_ms ? Math.round(exec.duration_ms / 1000) : null,
        has_interventions: false,
      };
    });

    return { activity };
  });

  // 19. GET /api/v1/admin/reports/schedules - Agent schedules
  fastify.get('/api/v1/admin/reports/schedules', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const agentsRes = await callForge('/agents?limit=100');
    const agents = agentsRes.error ? [] : (agentsRes.agents || []);

    const schedules = await query(`SELECT * FROM agent_schedules`);
    const scheduleMap = {};
    for (const s of schedules) {
      scheduleMap[s.agent_id] = s;
    }

    const result = agents.map(agent => {
      const sched = scheduleMap[agent.id];
      return {
        id: agent.id,
        name: agent.name,
        type: mapAgentType(agent.metadata),
        status: mapAgentStatus(agent.status, agent.status === 'archived'),
        schedule_type: sched?.schedule_type || 'manual',
        schedule_interval_minutes: sched?.schedule_interval_minutes || null,
        next_run_at: sched?.next_run_at || null,
        is_continuous: sched?.is_continuous || false,
        last_run_at: sched?.last_run_at || null,
      };
    });

    return { schedules: result };
  });

  // 20. GET /api/v1/admin/reports/findings - Agent findings (paginated)
  fastify.get('/api/v1/admin/reports/findings', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    try {
      const { severity, agent_id, category, page = '1', limit = '50' } = request.query;
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const conditions = [];
      const params = [];
      let paramIdx = 1;

      if (severity) { conditions.push(`severity = $${paramIdx++}`); params.push(severity); }
      if (agent_id) { conditions.push(`agent_id = $${paramIdx++}`); params.push(agent_id); }
      if (category) { conditions.push(`category = $${paramIdx++}`); params.push(category); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countResult = await query(`SELECT COUNT(*)::int as total FROM agent_findings ${where}`, params);
      const total = countResult[0]?.total || 0;

      const findings = await query(`
        SELECT * FROM agent_findings ${where}
        ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 END,
          created_at DESC
        LIMIT $${paramIdx++} OFFSET $${paramIdx++}
      `, [...params, limitNum, offset]);

      const totalPages = Math.ceil(total / limitNum) || 1;
      return {
        findings,
        pagination: { page: pageNum, limit: limitNum, total, totalPages, hasNext: pageNum < totalPages, hasPrev: pageNum > 1 },
      };
    } catch (err) {
      // Table may not exist yet
      return { findings: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 1, hasNext: false, hasPrev: false } };
    }
  });

  // 21. GET /api/v1/admin/reports/scheduler - Scheduler status
  fastify.get('/api/v1/admin/reports/scheduler', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const continuousSchedules = await query(
      `SELECT * FROM agent_schedules WHERE is_continuous = true`
    );
    const scheduledSchedules = await query(
      `SELECT * FROM agent_schedules WHERE schedule_type = 'scheduled' AND next_run_at IS NOT NULL`
    );

    // Look up agent names from Forge
    const agentsRes = await callForge('/agents?limit=100');
    const agentNameMap = {};
    if (!agentsRes.error) {
      for (const a of (agentsRes.agents || [])) {
        agentNameMap[a.id] = a.name;
      }
    }

    return {
      running: schedulerRunning,
      continuousAgents: continuousSchedules.map(s => ({
        name: agentNameMap[s.agent_id] || s.agent_id,
        status: s.last_run_at ? 'active' : 'idle',
      })),
      nextScheduledAgents: scheduledSchedules.map(s => ({
        name: agentNameMap[s.agent_id] || s.agent_id,
        next_run_at: s.next_run_at,
        schedule_type: s.schedule_type,
      })),
    };
  });

  // 22. POST /api/v1/admin/reports/scheduler - Scheduler control
  fastify.post('/api/v1/admin/reports/scheduler', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { action } = request.body || {};
    if (action === 'start') {
      schedulerRunning = true;
      console.log('[Scheduler] Scheduler started by admin');
    } else if (action === 'stop') {
      schedulerRunning = false;
      console.log('[Scheduler] Scheduler stopped by admin');
    }
    return { success: true, action: action || 'acknowledged', running: schedulerRunning };
  });

  // 23. POST /api/v1/admin/agents/:id/schedule - Set agent schedule
  fastify.post('/api/v1/admin/agents/:id/schedule', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const { schedule_type, schedule_interval_minutes, is_continuous } = request.body || {};

    let nextRunAt = null;
    if (schedule_type === 'scheduled' && schedule_interval_minutes) {
      nextRunAt = new Date(Date.now() + schedule_interval_minutes * 60000).toISOString();
    }

    const result = await queryOne(`
      INSERT INTO agent_schedules (agent_id, schedule_type, schedule_interval_minutes, next_run_at, is_continuous)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (agent_id) DO UPDATE SET
        schedule_type = EXCLUDED.schedule_type,
        schedule_interval_minutes = EXCLUDED.schedule_interval_minutes,
        next_run_at = EXCLUDED.next_run_at,
        is_continuous = EXCLUDED.is_continuous
      RETURNING *
    `, [id, schedule_type || 'manual', schedule_interval_minutes || null, nextRunAt, is_continuous || false]);

    return { schedule: result };
  });

  // ============================================================
  // TICKETS ENDPOINTS (4)
  // ============================================================

  // 24. GET /api/v1/admin/tickets - List tickets
  fastify.get('/api/v1/admin/tickets', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { status, source, assigned_to, filter, page = '1', limit = '20' } = request.query;
    const conditions = [];
    const params = [];

    // Handle filter param (all, open, mine)
    if (filter === 'open') {
      conditions.push(`status IN ('open', 'in_progress')`);
    } else if (filter === 'mine' && admin.username) {
      params.push(admin.username);
      conditions.push(`assigned_to = $${params.length}`);
    }

    // Handle status param (direct status filter)
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    // Handle source param (all, human, agent)
    if (source && source !== 'all') {
      params.push(source);
      conditions.push(`source = $${params.length}`);
    }

    if (assigned_to) {
      params.push(assigned_to);
      conditions.push(`assigned_to = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limitVal = parseInt(limit);
    const pg = parseInt(page);
    const offset = (pg - 1) * limitVal;

    const [tickets, countResult] = await Promise.all([
      query(`
        SELECT * FROM agent_tickets
        ${whereClause}
        ORDER BY
          CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
          created_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `, [...params, limitVal, offset]),
      queryOne(`SELECT COUNT(*) as count FROM agent_tickets ${whereClause}`, params),
    ]);

    // Enrich tickets that have task_id with linked task info
    for (const ticket of tickets) {
      if (ticket.task_id) {
        const taskRes = await callForge(`/executions/${ticket.task_id}`);
        if (!taskRes.error && taskRes.execution) {
          ticket.task = {
            id: taskRes.execution.id,
            status: taskRes.execution.status,
            type: taskRes.execution.metadata?.task_type || 'execution',
            started_at: taskRes.execution.started_at,
            completed_at: taskRes.execution.completed_at,
          };
        }
      }
    }

    const total = parseInt(countResult?.count || '0');
    return {
      tickets,
      total,
      page: pg,
      limit: limitVal,
      pagination: paginationResponse(total, pg, limitVal),
    };
  });

  // 25. POST /api/v1/admin/tickets - Create ticket
  fastify.post('/api/v1/admin/tickets', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const body = request.body || {};
    const id = ulid();

    const ticket = await queryOne(`
      INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to,
        agent_id, agent_name, is_agent_ticket, source, task_id, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `, [
      id,
      body.title || 'Untitled Ticket',
      body.description || null,
      body.status || 'open',
      body.priority || 'medium',
      body.category || null,
      body.created_by || admin.id,
      body.assigned_to || null,
      body.agent_id || null,
      body.agent_name || null,
      body.is_agent_ticket || false,
      body.source || 'human',
      body.task_id || null,
      JSON.stringify(body.metadata || {}),
    ]);

    // Audit trail
    try {
      await query(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value)
         VALUES ('ticket', $1, 'created', $2, $3, '{}', $4)`,
        [id, `human:${admin.username || admin.id}`, admin.id, JSON.stringify({ title: body.title, priority: body.priority, assigned_to: body.assigned_to, source: 'human' })]
      );
    } catch { /* audit non-fatal */ }

    return reply.code(201).send({ ticket });
  });

  // 26. PATCH /api/v1/admin/tickets/:id - Update ticket
  fastify.patch('/api/v1/admin/tickets/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const body = request.body || {};

    const fields = [];
    const params = [];

    if (body.status !== undefined) {
      params.push(body.status);
      fields.push(`status = $${params.length}`);
    }
    if (body.priority !== undefined) {
      params.push(body.priority);
      fields.push(`priority = $${params.length}`);
    }
    if (body.assigned_to !== undefined) {
      params.push(body.assigned_to);
      fields.push(`assigned_to = $${params.length}`);
    }
    if (body.title !== undefined) {
      params.push(body.title);
      fields.push(`title = $${params.length}`);
    }
    if (body.description !== undefined) {
      params.push(body.description);
      fields.push(`description = $${params.length}`);
    }
    if (body.category !== undefined) {
      params.push(body.category);
      fields.push(`category = $${params.length}`);
    }

    if (fields.length === 0) {
      return reply.code(400).send({ error: 'No fields to update' });
    }

    // Snapshot old state for audit
    const oldTicket = await queryOne(`SELECT id, status, priority, assigned_to, title FROM agent_tickets WHERE id = $1`, [id]);

    fields.push('updated_at = NOW()');
    params.push(id);

    const ticket = await queryOne(`
      UPDATE agent_tickets
      SET ${fields.join(', ')}
      WHERE id = $${params.length}
      RETURNING *
    `, params);

    if (!ticket) {
      return reply.code(404).send({ error: 'Ticket not found' });
    }

    // Audit trail
    try {
      const auditAction = body.status === 'resolved' ? 'resolved' : body.status === 'closed' ? 'closed' : body.assigned_to ? 'assigned' : 'updated';
      await query(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value)
         VALUES ('ticket', $1, $2, $3, $4, $5, $6)`,
        [
          id, auditAction, `human:${admin.username || admin.id}`, admin.id,
          JSON.stringify({ status: oldTicket?.status, priority: oldTicket?.priority, assigned_to: oldTicket?.assigned_to }),
          JSON.stringify(body),
        ]
      );
    } catch { /* audit non-fatal */ }

    return { ticket };
  });

  // 27. DELETE /api/v1/admin/tickets/:id - Soft-delete ticket (immutable audit trail)
  fastify.delete('/api/v1/admin/tickets/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;

    // Snapshot before soft-delete
    const old = await queryOne(`SELECT id, title, status, priority, assigned_to FROM agent_tickets WHERE id = $1`, [id]);
    if (!old) {
      return reply.code(404).send({ error: 'Ticket not found' });
    }

    // Soft-delete: set deleted_at, never hard-delete
    await queryOne(
      `UPDATE agent_tickets SET deleted_at = NOW(), status = 'closed', updated_at = NOW() WHERE id = $1 RETURNING id`,
      [id]
    );

    // Audit trail
    try {
      await query(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value)
         VALUES ('ticket', $1, 'deleted', $2, NULL, $3, '{"soft_deleted": true}')`,
        [id, admin.username || 'human:admin', JSON.stringify({ status: old.status, title: old.title, assigned_to: old.assigned_to })]
      );
    } catch { /* audit non-fatal */ }

    return { success: true, id, soft_deleted: true };
  });

  // ============================================================
  // FLEET MEMORY ENDPOINTS (4)
  // ============================================================

  // 28a. GET /api/v1/admin/memory/stats - Fleet memory statistics
  fastify.get('/api/v1/admin/memory/stats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/fleet/stats');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Fleet memory unavailable', message: res.message });
    return res;
  });

  // 28b. GET /api/v1/admin/memory/search - Search fleet memories
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

  // 28c. GET /api/v1/admin/memory/recent - Recent fleet memories
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

  // 28d. GET /api/v1/admin/memory/recalls - Fleet recall events
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

  // ============================================================
  // GIT REVIEW PROXY ENDPOINTS (6)
  // ============================================================

  // 29a. GET /api/v1/admin/git-space/branches - List agent branches
  fastify.get('/api/v1/admin/git-space/branches', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/git/branches');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Git review unavailable', message: res.message });
    return res;
  });

  // 29b. GET /api/v1/admin/git-space/diff/:branch - Get branch diff
  fastify.get('/api/v1/admin/git-space/diff/:branch', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { branch } = request.params;
    const res = await callForge(`/git/diff/${encodeURIComponent(branch)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Git review unavailable', message: res.message });
    return res;
  });

  // 29c. GET /api/v1/admin/git-space/health/:service - Service health
  fastify.get('/api/v1/admin/git-space/health/:service', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { service } = request.params;
    const res = await callForge(`/git/health/${encodeURIComponent(service)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Health check failed', message: res.message });
    return res;
  });

  // 29d. POST /api/v1/admin/git-space/merge - Merge branch
  fastify.post('/api/v1/admin/git-space/merge', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/git/merge', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Git merge failed', message: res.message });
    return res;
  });

  // 29e. POST /api/v1/admin/git-space/deploy - Deploy services
  fastify.post('/api/v1/admin/git-space/deploy', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/git/deploy', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Deploy failed', message: res.message });
    return res;
  });

  // 29f. POST /api/v1/admin/git-space/rebuild - Start rebuild
  fastify.post('/api/v1/admin/git-space/rebuild', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/git/rebuild', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Rebuild failed', message: res.message });
    return res;
  });

  // 29g-1. GET /api/v1/admin/git-space/rebuild/tasks - List all rebuild tasks (must be before :builderId)
  fastify.get('/api/v1/admin/git-space/rebuild/tasks', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/git/rebuild/tasks');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Rebuild tasks unavailable', message: res.message });
    return res;
  });

  // 29g-2. GET /api/v1/admin/git-space/rebuild/:builderId - Poll rebuild status
  fastify.get('/api/v1/admin/git-space/rebuild/:builderId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { builderId } = request.params;
    const res = await callForge(`/git/rebuild/${encodeURIComponent(builderId)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Rebuild status unavailable', message: res.message });
    return res;
  });

  // 29g-3. DELETE /api/v1/admin/git-space/rebuild/:builderId - Cancel rebuild
  fastify.delete('/api/v1/admin/git-space/rebuild/:builderId', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { builderId } = request.params;
    const res = await callForge(`/git/rebuild/${encodeURIComponent(builderId)}`, { method: 'DELETE' });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Rebuild cancel failed', message: res.message });
    return res;
  });

  // 29h. POST /api/v1/admin/git-space/ai-review - AI code review (proxied to Forge platform-admin)
  fastify.post('/api/v1/admin/git-space/ai-review', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    try {
      const res = await fetch(`${FORGE_URL}/api/v1/admin/git-space/ai-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const data = await res.json();
      return reply.code(res.status).send(data);
    } catch (err) {
      return reply.code(503).send({ error: 'AI review unavailable' });
    }
  });

  // 29i. GET /api/v1/admin/git-space/review-result/:id - Get AI review result (proxied to Forge platform-admin)
  fastify.get('/api/v1/admin/git-space/review-result/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    try {
      const { id } = request.params;
      const res = await fetch(`${FORGE_URL}/api/v1/admin/git-space/review-result/${encodeURIComponent(id)}`);
      const data = await res.json();
      return reply.code(res.status).send(data);
    } catch (err) {
      return reply.code(503).send({ error: 'Review result unavailable' });
    }
  });

  // 29j. POST /api/v1/admin/git-space/ai-review/chat - AI review chat (proxied to Forge platform-admin)
  fastify.post('/api/v1/admin/git-space/ai-review/chat', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    try {
      const res = await fetch(`${FORGE_URL}/api/v1/admin/git-space/ai-review/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body),
      });
      const data = await res.json();
      return reply.code(res.status).send(data);
    } catch (err) {
      return reply.code(503).send({ error: 'AI review chat unavailable' });
    }
  });

  // 28. GET /api/v1/admin/audit - View audit trail
  fastify.get('/api/v1/admin/audit', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { entity_type, entity_id, actor, action, limit = '50', offset = '0' } = request.query;
    const conditions = [];
    const params = [];

    if (entity_type) { params.push(entity_type); conditions.push(`entity_type = $${params.length}`); }
    if (entity_id) { params.push(entity_id); conditions.push(`entity_id = $${params.length}`); }
    if (actor) { params.push(actor); conditions.push(`actor = $${params.length}`); }
    if (action) { params.push(action); conditions.push(`action = $${params.length}`); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim = Math.min(parseInt(limit), 100);
    const off = parseInt(offset) || 0;

    const entries = await query(
      `SELECT id, entity_type, entity_id, action, actor, actor_id, old_value, new_value, execution_id, created_at
       FROM agent_audit_log ${where}
       ORDER BY created_at DESC
       LIMIT ${lim} OFFSET ${off}`,
      params
    );

    const countResult = await queryOne(`SELECT COUNT(*)::int as total FROM agent_audit_log ${where}`, params);

    return { audit_trail: entries, total: countResult?.total || 0, limit: lim, offset: off };
  });

  // ============================================================
  // WORKFLOW PROXY (5 endpoints)
  // ============================================================

  // 33a. GET /api/v1/admin/workflows - List workflows
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

  // 33b. GET /api/v1/admin/workflows/:id - Get workflow detail
  fastify.get('/api/v1/admin/workflows/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const res = await callForge(`/workflows/${encodeURIComponent(id)}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Workflow not found', message: res.message });
    return res;
  });

  // 33c. POST /api/v1/admin/workflows - Create workflow
  fastify.post('/api/v1/admin/workflows', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/workflows', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Workflow creation failed', message: res.message });
    return res;
  });

  // 33d. PUT /api/v1/admin/workflows/:id - Update workflow
  fastify.put('/api/v1/admin/workflows/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const res = await callForge(`/workflows/${encodeURIComponent(id)}`, { method: 'PUT', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Workflow update failed', message: res.message });
    return res;
  });

  // 33e. POST /api/v1/admin/workflows/:id/run - Run workflow
  fastify.post('/api/v1/admin/workflows/:id/run', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const res = await callForge(`/workflows/${encodeURIComponent(id)}/run`, { method: 'POST', body: request.body || {} });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Workflow run failed', message: res.message });
    return res;
  });

  // ============================================================
  // COST TRACKING PROXY (1 endpoint)
  // ============================================================

  // 30. GET /api/v1/admin/costs - Cost summary + daily breakdown
  fastify.get('/api/v1/admin/costs', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { startDate, endDate, agentId, days } = request.query;
    const params = new URLSearchParams();
    if (startDate) params.set('startDate', startDate);
    if (endDate) params.set('endDate', endDate);
    if (agentId) params.set('agentId', agentId);
    if (days) params.set('days', days);

    const res = await callForge(`/admin/costs?${params.toString()}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Cost data unavailable', message: res.message });
    return res;
  });

  // ============================================================
  // GUARDRAILS PROXY (2 endpoints)
  // ============================================================

  // 31a. GET /api/v1/admin/guardrails - List guardrails
  fastify.get('/api/v1/admin/guardrails', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/admin/guardrails');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Guardrails unavailable', message: res.message });
    return res;
  });

  // 31b. POST /api/v1/admin/guardrails - Create/update guardrail
  fastify.post('/api/v1/admin/guardrails', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/admin/guardrails', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Guardrail creation failed', message: res.message });
    return res;
  });

  // ============================================================
  // PROVIDER PROXY (3 endpoints)
  // ============================================================

  // 32a. GET /api/v1/admin/providers - List providers
  fastify.get('/api/v1/admin/providers', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/providers');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Providers unavailable', message: res.message });
    return res;
  });

  // 32b. GET /api/v1/admin/providers/health - Provider health
  fastify.get('/api/v1/admin/providers/health', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const res = await callForge('/providers/health');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Provider health unavailable', message: res.message });
    return res;
  });

  // 32c. GET /api/v1/admin/providers/:id/models - Provider models
  fastify.get('/api/v1/admin/providers/:id/models', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const res = await callForge(`/providers/${encodeURIComponent(id)}/models`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Provider models unavailable', message: res.message });
    return res;
  });

  // ============================================
  // CONTENT FEED (proxy to Forge platform-admin)
  // ============================================

  fastify.get('/api/v1/admin/reports/feed', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const qs = new URL(request.url, 'http://localhost').search;
    const res = await callForgeAdmin(`/reports/feed${qs}`);
    if (res.error) return reply.code(res.status || 503).send({ error: 'Feed unavailable' });
    return res;
  });

  fastify.get('/api/v1/admin/reports/feed/agents', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/reports/feed/agents');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Feed agents unavailable' });
    return res;
  });

  fastify.get('/api/v1/admin/reports/feed/categories', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/reports/feed/categories');
    if (res.error) return reply.code(res.status || 503).send({ error: 'Feed categories unavailable' });
    return res;
  });

  // ============================================
  // COORDINATION (proxy to Forge fleet coordinator)
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

  // ============================================
  // ORCHESTRATED EXECUTION
  // ============================================

  fastify.post('/api/v1/admin/coordination/orchestrate', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/coordination/orchestrate', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Orchestration failed', message: res.message });
    return res;
  });

  // ============================================
  // MEMORY STORE
  // ============================================

  fastify.post('/api/v1/admin/memory/store', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const res = await callForgeAdmin('/memory/store', { method: 'POST', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Memory store failed' });
    return res;
  });

  // ============================================
  // AGENT MODEL UPDATE
  // ============================================

  fastify.patch('/api/v1/admin/agents/:id/model', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${encodeURIComponent(id)}/model`, { method: 'PATCH', body: request.body });
    if (res.error) return reply.code(res.status || 503).send({ error: 'Model update failed' });
    return res;
  });

  // ============================================
  // TICKET NOTES
  // ============================================

  fastify.get('/api/v1/admin/tickets/:id/notes', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    try {
      const notes = await query(
        `SELECT id, ticket_id, content, author, created_at
         FROM agent_ticket_notes
         WHERE ticket_id = $1
         ORDER BY created_at ASC`,
        [id]
      );
      return { notes };
    } catch {
      return { notes: [] };
    }
  });

  fastify.post('/api/v1/admin/tickets/:id/notes', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    const { content } = request.body || {};
    if (!content) return reply.code(400).send({ error: 'Content required' });
    const noteId = ulid();
    try {
      await query(
        `INSERT INTO agent_ticket_notes (id, ticket_id, content, author, created_at)
         VALUES ($1, $2, $3, $4, NOW())`,
        [noteId, id, content, admin.email || 'admin']
      );
      const note = await queryOne(
        `SELECT id, ticket_id, content, author, created_at FROM agent_ticket_notes WHERE id = $1`,
        [noteId]
      );
      return { note };
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to create note' });
    }
  });

  // ============================================
  // FINDING DETAIL
  // ============================================

  fastify.get('/api/v1/admin/reports/findings/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };
    const { id } = request.params;
    try {
      const finding = await queryOne(
        `SELECT af.*, fa.name as agent_name
         FROM agent_findings af
         LEFT JOIN forge_agents fa ON af.agent_id = fa.id
         WHERE af.id = $1`,
        [id]
      );
      if (!finding) return reply.code(404).send({ error: 'Finding not found' });
      return { finding };
    } catch {
      return reply.code(500).send({ error: 'Failed to fetch finding' });
    }
  });

  // ============================================
  // INTERVENTION AUTO-HANDLER
  // Processes pending interventions every scheduler tick
  // ============================================

  // Auto-approvable intervention types (low-risk, no human needed)
  const AUTO_APPROVE_PATTERNS = [
    /restart.*container/i,
    /install.*extension/i,
    /apply.*migration/i,
    /create.*index/i,
    /enable.*monitoring/i,
    /update.*schedule/i,
    /run.*backup/i,
  ];

  async function processInterventions() {
    try {
      const pending = await query(
        `SELECT id, agent_name, type, title, description, proposed_action, created_at
         FROM agent_interventions
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 10`
      );

      if (pending.length === 0) return;

      for (const intervention of pending) {
        const ageMinutes = (Date.now() - new Date(intervention.created_at).getTime()) / 60_000;

        // Auto-approve low-risk resource/feedback requests
        if (intervention.type === 'feedback' || intervention.type === 'resource') {
          const text = `${intervention.title} ${intervention.description || ''} ${intervention.proposed_action || ''}`;
          const isAutoApprovable = AUTO_APPROVE_PATTERNS.some(p => p.test(text));

          if (isAutoApprovable) {
            await queryOne(
              `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved by system (low-risk operation)', responded_by = 'system:auto', responded_at = NOW() WHERE id = $1`,
              [intervention.id]
            );
            try {
              await query(
                `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
                 VALUES ('intervention', $1, 'auto_approved', 'system:auto', '{"status":"pending"}', $2)`,
                [intervention.id, JSON.stringify({ status: 'approved', reason: 'auto_approve_low_risk', title: intervention.title })]
              );
            } catch { /* audit non-fatal */ }
            console.log(`[Interventions] Auto-approved: ${intervention.title} (${intervention.agent_name})`);
            continue;
          }
        }

        // Auto-approve approval requests older than 30 minutes (agent is waiting)
        if (intervention.type === 'approval' && ageMinutes > 30) {
          await queryOne(
            `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved after 30min timeout (no human response)', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
            [intervention.id]
          );
          try {
            await query(
              `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
               VALUES ('intervention', $1, 'auto_approved', 'system:timeout', '{"status":"pending"}', $2)`,
              [intervention.id, JSON.stringify({ status: 'approved', reason: 'timeout_30min', title: intervention.title })]
            );
          } catch { /* audit non-fatal */ }
          console.log(`[Interventions] Auto-approved (timeout): ${intervention.title} (${intervention.agent_name})`);
          continue;
        }

        // Escalation/error interventions older than 60 min — create a ticket for Overseer
        if ((intervention.type === 'escalation' || intervention.type === 'error') && ageMinutes > 60) {
          try {
            await query(
              `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, is_agent_ticket, source, metadata)
               VALUES ($1, $2, $3, 'open', 'urgent', 'escalation', 'system', 'Overseer', true, 'agent', $4)
               ON CONFLICT DO NOTHING`,
              [
                'INT-' + intervention.id.substring(0, 20),
                `[ESCALATION] ${intervention.title}`,
                `Agent ${intervention.agent_name} requested intervention: ${intervention.description || intervention.title}\n\nProposed action: ${intervention.proposed_action || 'None'}`,
                JSON.stringify({ intervention_id: intervention.id, auto_escalated: true }),
              ]
            );
            await queryOne(
              `UPDATE agent_interventions SET status = 'resolved', human_response = 'Auto-escalated to Overseer ticket after 60min', responded_by = 'system:escalation', responded_at = NOW() WHERE id = $1`,
              [intervention.id]
            );
          } catch { /* non-fatal */ }
          console.log(`[Interventions] Escalated to Overseer ticket: ${intervention.title}`);
          continue;
        }

        // Catch-all: any unhandled type older than 30 min gets auto-approved
        if (ageMinutes > 30) {
          await queryOne(
            `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved after 30min timeout (unhandled type: ' || $2 || ')', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
            [intervention.id, intervention.type || 'unknown']
          );
          try {
            await query(
              `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
               VALUES ('intervention', $1, 'auto_approved', 'system:timeout', '{"status":"pending"}', $2)`,
              [intervention.id, JSON.stringify({ status: 'approved', reason: 'timeout_catchall', type: intervention.type, title: intervention.title })]
            );
          } catch { /* audit non-fatal */ }
          console.log(`[Interventions] Auto-approved (catchall timeout): ${intervention.title} (type: ${intervention.type})`);
        }
      }
    } catch (err) {
      console.error('[Interventions] Error processing interventions:', err);
    }
  }

  // ============================================
  // FEEDBACK & LEARNING (Phase 4)
  // ============================================

  // Submit feedback on an execution
  fastify.post('/api/v1/admin/executions/:id/feedback', async (request, reply) => {
    const { id } = request.params;
    const res = await callForgeAdmin(`/executions/${id}/feedback`, {
      method: 'POST',
      body: request.body,
    });
    return res;
  });

  // Get feedback stats for an agent
  fastify.get('/api/v1/admin/agents/:id/feedback', async (request, reply) => {
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}/feedback`);
    return res;
  });

  // Get correction patterns for an agent
  fastify.get('/api/v1/admin/agents/:id/corrections', async (request, reply) => {
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}/corrections`);
    return res;
  });

  // ============================================
  // CAPABILITIES (Phase 3)
  // ============================================

  // Get capabilities for a specific agent
  fastify.get('/api/v1/admin/agents/:id/capabilities', async (request, reply) => {
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}/capabilities`);
    return res;
  });

  // Detect capabilities for a specific agent
  fastify.post('/api/v1/admin/agents/:id/capabilities/detect', async (request, reply) => {
    const { id } = request.params;
    const res = await callForgeAdmin(`/agents/${id}/capabilities/detect`, { method: 'POST' });
    return res;
  });

  // Detect capabilities for all agents
  fastify.post('/api/v1/admin/capabilities/detect-all', async (request, reply) => {
    const res = await callForgeAdmin('/capabilities/detect-all', { method: 'POST' });
    return res;
  });

  // Find agents with a specific capability
  fastify.get('/api/v1/admin/capabilities/:name/agents', async (request, reply) => {
    const { name } = request.params;
    const res = await callForgeAdmin(`/capabilities/${name}/agents`);
    return res;
  });

  // Get capability catalog
  fastify.get('/api/v1/admin/capabilities/catalog', async (request, reply) => {
    const res = await callForgeAdmin('/capabilities/catalog');
    return res;
  });

  // Get all agents' capabilities summary
  fastify.get('/api/v1/admin/capabilities/summary', async (request, reply) => {
    const res = await callForgeAdmin('/capabilities/summary');
    return res;
  });

  // ============================================
  // SCHEDULER DAEMON
  // Checks agent_schedules every 60s, triggers Forge executions for due agents
  // ============================================

  const SCHEDULER_INTERVAL_MS = 60_000; // Check every 60 seconds

  let tickCount = 0;

  async function runSchedulerTick() {
    if (!schedulerRunning) return;
    tickCount++;
    try {
      // Process pending interventions each tick
      await processInterventions();

      // Find agents due to run
      const dueAgents = await query(
        `SELECT s.agent_id, s.schedule_type, s.schedule_interval_minutes, s.is_continuous
         FROM agent_schedules s
         WHERE s.next_run_at <= NOW()
         ORDER BY s.next_run_at ASC
         LIMIT 16`
      );

      if (dueAgents.length === 0) {
        // Log heartbeat every 5 ticks (~5 min) so we know it's alive
        if (tickCount % 5 === 0) {
          const nextDue = await queryOne(`SELECT MIN(next_run_at) as next FROM agent_schedules`);
          const nextStr = nextDue?.next ? new Date(nextDue.next).toISOString() : 'none';
          console.log(`[Scheduler] Heartbeat tick #${tickCount} — no agents due. Next: ${nextStr}`);
        }
        return;
      }

      // Collect all valid agents for batch execution
      const batchAgents = [];

      for (const schedule of dueAgents) {
        try {
          const agentRes = await callForge(`/agents/${schedule.agent_id}`);
          if (agentRes.error || !agentRes.agent) {
            console.log(`[Scheduler] Agent ${schedule.agent_id} not found in Forge, skipping`);
            continue;
          }

          const agent = agentRes.agent;
          if (agent.status !== 'active') {
            console.log(`[Scheduler] Agent ${agent.name} is ${agent.status}, skipping`);
            continue;
          }

          const input = `[SCHEDULED RUN - ${new Date().toISOString()}] You are running on a ${schedule.schedule_interval_minutes}-minute schedule.

MANDATORY TICKET LIFECYCLE — Follow this exact order every run:

1. CHECK ASSIGNED TICKETS: Use ticket_ops action=list filter_assigned_to=YOUR_NAME filter_status=open to find work assigned to you. Also check filter_status=in_progress for your ongoing work.

2. PICK UP WORK: For each open ticket assigned to you, update it to in_progress with ticket_ops action=update ticket_id=ID status=in_progress BEFORE starting work.

3. DO THE WORK: Execute your core duties. Use your tools to investigate, fix, monitor, or build as needed.

4. RESOLVE WITH NOTES: When work is done, update the ticket with ticket_ops action=update ticket_id=ID status=resolved resolution="Detailed description of what you did and the outcome."

5. REPORT FINDINGS: Use finding_ops to report anything noteworthy (security issues, bugs, performance problems, optimization opportunities). Warning/critical findings auto-create tickets for the right agent.

6. CREATE FOLLOW-UP TICKETS: If your work reveals new tasks needed, create tickets with ticket_ops action=create and assign them to the appropriate agent (assigned_to=AGENT_NAME).

7. ROUTINE DUTIES: After ticket work, perform your standard monitoring/maintenance tasks. Log any new findings.

Be efficient and concise. Every action you take must be tracked through a ticket.`;

          batchAgents.push({
            agentId: schedule.agent_id,
            agentName: agent.name,
            input,
            intervalMinutes: schedule.schedule_interval_minutes || 60,
          });
        } catch (agentErr) {
          console.error(`[Scheduler] Error loading agent ${schedule.agent_id}:`, agentErr);
        }
      }

      if (batchAgents.length === 0) return;

      // Use batch endpoint if multiple agents are due (50% cost savings)
      if (batchAgents.length >= 2) {
        console.log(`[Scheduler] Batching ${batchAgents.length} agents: ${batchAgents.map(a => a.agentName).join(', ')}`);

        const batchRes = await callForge('/executions/batch', {
          method: 'POST',
          body: {
            agents: batchAgents.map(a => ({ agentId: a.agentId, input: a.input })),
          },
        });

        if (batchRes.error) {
          console.error(`[Scheduler] Batch failed, falling back to individual:`, batchRes.message);
          // Fall back to individual execution
          for (const agent of batchAgents) {
            const execRes = await callForge('/executions', {
              method: 'POST',
              body: { agentId: agent.agentId, input: agent.input },
            });
            if (!execRes.error) {
              console.log(`[Scheduler] Started ${agent.agentName} individually`);
            }
          }
        } else {
          console.log(`[Scheduler] Batch started: ${batchAgents.length} agents (50% cost reduction)`);
        }
      } else {
        // Single agent — use normal execution
        const agent = batchAgents[0];
        const execRes = await callForge('/executions', {
          method: 'POST',
          body: { agentId: agent.agentId, input: agent.input },
        });
        if (!execRes.error) {
          console.log(`[Scheduler] Started ${agent.agentName}`);
        }
      }

      // Update schedules for all processed agents
      for (const agent of batchAgents) {
        await queryOne(
          `UPDATE agent_schedules
           SET last_run_at = NOW(),
               next_run_at = NOW() + ($1 || ' minutes')::INTERVAL
           WHERE agent_id = $2`,
          [String(agent.intervalMinutes), agent.agentId]
        );
      }
    } catch (err) {
      console.error('[Scheduler] Tick error:', err);
    }
  }

  // Start the scheduler loop
  console.log('[Scheduler] Agent scheduler daemon started (60s interval)');
  setInterval(runSchedulerTick, SCHEDULER_INTERVAL_MS);

  // Run first tick after a 10s delay to let services stabilize
  setTimeout(runSchedulerTick, 10_000);
}
