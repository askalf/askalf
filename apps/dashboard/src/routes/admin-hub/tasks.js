// Task (execution) endpoints
import { callForgeAdmin, transformExecution, mapAgentType, paginationResponse } from './utils.js';

export async function registerTaskRoutes(fastify, requireAdmin, query, queryOne) {

  // GET /api/v1/admin/tasks - List tasks (executions)
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
      callForgeAdmin(`/executions?${queryParams.toString()}`),
      callForgeAdmin('/agents'),
    ]);

    if (execsRes.error) {
      return reply.code(503).send({ error: 'Failed to fetch tasks', message: execsRes.message });
    }

    const agentMap = {};
    for (const a of (agentsRes.agents || [])) {
      agentMap[a.id] = { name: a.name, type: a.type || mapAgentType(a.metadata) };
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

  // GET /api/v1/admin/tasks/stats - Task statistics
  fastify.get('/api/v1/admin/tasks/stats', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const execsRes = await callForgeAdmin('/executions?limit=100');
    const executions = execsRes.error ? [] : (execsRes.executions || []);

    const agentsRes = await callForgeAdmin('/agents');
    const agentMap = {};
    for (const a of (agentsRes.agents || [])) {
      agentMap[a.id] = { name: a.name, type: a.type || mapAgentType(a.metadata) };
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

  // GET /api/v1/admin/tasks/:id - Task detail
  fastify.get('/api/v1/admin/tasks/:id', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const execRes = await callForgeAdmin(`/executions/${id}`);

    if (execRes.error) {
      return reply.code(execRes.status || 404).send({ error: 'Task not found' });
    }

    const exec = execRes.execution;
    const agentRes = await callForgeAdmin(`/agents/${exec.agent_id}`);
    const agentName = agentRes.agent?.name || 'Unknown';
    const agentType = agentRes.agent?.type || mapAgentType(agentRes.agent?.metadata);

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
    const childExecsRes = await callForgeAdmin(`/executions?limit=20`);
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

  // GET /api/v1/admin/executions/timeline?hours=24
  fastify.get('/api/v1/admin/executions/timeline', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const hours = Math.min(parseInt(request.query.hours || '24'), 72);
    const limit = 300;

    const [execsRes, agentsRes] = await Promise.all([
      callForgeAdmin(`/executions?limit=${limit}&offset=0`),
      callForgeAdmin('/agents'),
    ]);

    if (execsRes.error) {
      return reply.code(503).send({ error: 'Failed to fetch executions', message: execsRes.message });
    }

    const agentMap = {};
    for (const a of (agentsRes.agents || [])) {
      agentMap[a.id] = { name: a.name };
    }

    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

    const executions = (execsRes.executions || [])
      .filter(e => {
        const ts = e.started_at || e.created_at;
        return ts && new Date(ts) >= cutoff;
      })
      .map(e => {
        const modelId = e.model_id || '';
        let model_tier = 'unknown';
        if (modelId.includes('opus')) model_tier = 'opus';
        else if (modelId.includes('sonnet')) model_tier = 'sonnet';
        else if (modelId.includes('haiku')) model_tier = 'haiku';

        return {
          id: e.id,
          agent_id: e.agent_id,
          agent_name: agentMap[e.agent_id]?.name || 'Unknown',
          status: e.status,
          model_tier,
          started_at: e.started_at || e.created_at,
          completed_at: e.completed_at || null,
          created_at: e.created_at,
          duration_ms: e.duration_ms || null,
          cost: parseFloat(e.cost || '0'),
          tokens: e.total_tokens || 0,
        };
      });

    return { executions, hours };
  });
}
