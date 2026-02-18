// Reports, metrics, activity, schedules, findings, feed
import { callForge, callForgeAdmin, mapAgentType, mapAgentStatus, paginationResponse } from './utils.js';

export async function registerReportRoutes(fastify, requireAdmin, query, queryOne) {

  // GET /api/v1/admin/reports/metrics - System metrics
  fastify.get('/api/v1/admin/reports/metrics', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    // Local substrate DB stats
    const [userCount, activeUserCount, newUserCount, shardCount, highConfShards, chatSessionCount, chatMsgCount, ticketCount, openTicketCount, agentTicketCount, tableCount, dbSize] = await Promise.all([
      queryOne(`SELECT COUNT(*) as count FROM users`),
      queryOne(`SELECT COUNT(*) as count FROM users WHERE last_login_at > NOW() - INTERVAL '24 hours'`).catch(() => ({ count: '0' })),
      queryOne(`SELECT COUNT(*) as count FROM users WHERE created_at > NOW() - INTERVAL '7 days'`).catch(() => ({ count: '0' })),
      Promise.resolve({ count: '0' }), // shards table decommissioned
      Promise.resolve({ count: '0' }), // shards table decommissioned
      Promise.resolve({ count: '0' }), // chat_messages table decommissioned
      Promise.resolve({ count: '0' }), // chat_messages table decommissioned
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

  // GET /api/v1/admin/reports/activity - Recent activity
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

  // GET /api/v1/admin/reports/schedules - Agent schedules
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
        execution_mode: sched?.execution_mode || 'batch',
        model_id: agent.model_id || null,
        last_run_at: sched?.last_run_at || null,
      };
    });

    return { schedules: result };
  });

  // GET /api/v1/admin/reports/findings - Agent findings (paginated)
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

  // GET /api/v1/admin/reports/findings/:id - Finding detail
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

  // Content feed (proxy to Forge platform-admin)
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
}
