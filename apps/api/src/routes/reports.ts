/**
 * Reports & Monitoring API Routes
 * Real-time system metrics, agent activity, and scheduling
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';
import { getSchedulerStatus, startAgentScheduler, stopAgentScheduler } from '../services/agent-scheduler.js';

const SESSION_COOKIE_NAME = 'substrate_session';

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getAdminUser(
  request: FastifyRequest
): Promise<{ user_id: string; tenant_id: string; email: string } | null> {
  const sessionToken = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const tokenHash = await hashToken(sessionToken);
  const session = await queryOne<{ user_id: string; tenant_id: string; email: string }>(
    `SELECT s.user_id, u.tenant_id, u.email FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.role IN ('admin', 'super_admin')`,
    [tokenHash]
  );

  return session || null;
}

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  // Get system metrics
  app.get('/api/v1/admin/reports/metrics', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // User metrics
    const userStats = await queryOne<{ total: string; active_24h: string; new_7d: string }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '24 hours') as active_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_7d
      FROM users
    `);

    // Shard metrics
    const shardStats = await queryOne<{ total: string; high_confidence: string; success_rate: string }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE confidence >= 0.7) as high_confidence,
        COALESCE(ROUND(SUM(success_count) * 100.0 / NULLIF(SUM(execution_count), 0)), 0) as success_rate
      FROM procedural_shards
    `);

    // Chat metrics
    const chatStats = await queryOne<{ sessions: string; messages: string; avg_per_session: string }>(`
      SELECT
        COUNT(DISTINCT cs.id) as sessions,
        COUNT(cm.id) as messages,
        COALESCE(ROUND(COUNT(cm.id)::numeric / NULLIF(COUNT(DISTINCT cs.id), 0)), 0) as avg_per_session
      FROM chat_sessions cs
      LEFT JOIN chat_messages cm ON cs.id = cm.session_id
    `);

    // Agent metrics
    const agentStats = await queryOne<{ total: string; running: string; tasks_today: string; interventions_pending: string }>(`
      SELECT
        (SELECT COUNT(*) FROM agents WHERE is_decommissioned = FALSE) as total,
        (SELECT COUNT(*) FROM agents WHERE status = 'running') as running,
        (SELECT COUNT(*) FROM agent_tasks WHERE created_at > NOW() - INTERVAL '24 hours') as tasks_today,
        (SELECT COUNT(*) FROM intervention_requests WHERE status = 'pending') as interventions_pending
    `);

    // Ticket metrics
    const ticketStats = await queryOne<{ total: string; open: string; agent_created: string }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status IN ('open', 'in_progress')) as open,
        COUNT(*) FILTER (WHERE source = 'agent') as agent_created
      FROM tickets
    `);

    // Database metrics
    const dbStats = await queryOne<{ tables: string; size: string }>(`
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as tables,
        pg_size_pretty(pg_database_size(current_database())) as size
    `);

    return {
      users: {
        total: parseInt(userStats?.total || '0'),
        active_24h: parseInt(userStats?.active_24h || '0'),
        new_7d: parseInt(userStats?.new_7d || '0'),
      },
      shards: {
        total: parseInt(shardStats?.total || '0'),
        high_confidence: parseInt(shardStats?.high_confidence || '0'),
        success_rate: parseInt(shardStats?.success_rate || '0'),
      },
      chat: {
        sessions: parseInt(chatStats?.sessions || '0'),
        messages: parseInt(chatStats?.messages || '0'),
        avg_per_session: parseInt(chatStats?.avg_per_session || '0'),
      },
      agents: {
        total: parseInt(agentStats?.total || '0'),
        running: parseInt(agentStats?.running || '0'),
        tasks_today: parseInt(agentStats?.tasks_today || '0'),
        interventions_pending: parseInt(agentStats?.interventions_pending || '0'),
      },
      tickets: {
        total: parseInt(ticketStats?.total || '0'),
        open: parseInt(ticketStats?.open || '0'),
        agent_created: parseInt(ticketStats?.agent_created || '0'),
      },
      database: {
        tables: parseInt(dbStats?.tables || '0'),
        size: dbStats?.size || 'unknown',
      },
    };
  });

  // Get agent activity
  app.get('/api/v1/admin/reports/activity', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const activity = await query<{
      id: string;
      agent_name: string;
      agent_type: string;
      task_type: string;
      status: string;
      started_at: string;
      completed_at: string | null;
      duration_seconds: number | null;
      has_interventions: boolean;
    }>(`
      SELECT
        at.id,
        a.name as agent_name,
        a.type as agent_type,
        at.type as task_type,
        at.status,
        at.started_at,
        at.completed_at,
        EXTRACT(EPOCH FROM (at.completed_at - at.started_at))::integer as duration_seconds,
        EXISTS(SELECT 1 FROM intervention_requests ir WHERE ir.task_id = at.id) as has_interventions
      FROM agent_tasks at
      JOIN agents a ON at.agent_id = a.id
      WHERE at.created_at > NOW() - INTERVAL '7 days'
      ORDER BY at.created_at DESC
      LIMIT 100
    `);

    return { activity };
  });

  // Get agent schedules
  app.get('/api/v1/admin/reports/schedules', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const schedules = await query<{
      id: string;
      name: string;
      type: string;
      schedule_type: string;
      schedule_interval_minutes: number | null;
      next_run_at: string | null;
      is_continuous: boolean;
      status: string;
      last_run_at: string | null;
    }>(`
      SELECT
        id, name, type,
        COALESCE(schedule_type, 'manual') as schedule_type,
        schedule_interval_minutes,
        next_run_at,
        COALESCE(is_continuous, FALSE) as is_continuous,
        status,
        last_run_at
      FROM agents
      WHERE is_decommissioned = FALSE
      ORDER BY name
    `);

    return { schedules };
  });

  // Get findings (extracted from recent agent outputs)
  app.get('/api/v1/admin/reports/findings', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Get recent intervention requests as findings
    const interventions = await query<{
      agent_name: string;
      finding: string;
      created_at: string;
    }>(`
      SELECT
        a.name as agent_name,
        ir.description as finding,
        ir.created_at
      FROM intervention_requests ir
      JOIN agents a ON ir.agent_id = a.id
      WHERE ir.created_at > NOW() - INTERVAL '7 days'
      ORDER BY ir.created_at DESC
      LIMIT 50
    `);

    // Classify severity based on keywords
    const findings = interventions.map(i => ({
      agent_name: i.agent_name,
      finding: i.finding,
      severity: i.finding.toLowerCase().includes('critical') || i.finding.toLowerCase().includes('urgent')
        ? 'critical' as const
        : i.finding.toLowerCase().includes('warning') || i.finding.toLowerCase().includes('issue')
        ? 'warning' as const
        : 'info' as const,
      created_at: i.created_at,
    }));

    return { findings };
  });

  // Update agent schedule
  app.post('/api/v1/admin/agents/:id/schedule', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const body = request.body as {
      schedule_type: 'manual' | 'scheduled' | 'continuous';
      interval_minutes?: number;
    };

    const nextRunAt = body.schedule_type === 'scheduled' && body.interval_minutes
      ? new Date(Date.now() + body.interval_minutes * 60 * 1000).toISOString()
      : null;

    await query(`
      UPDATE agents
      SET schedule_type = $1,
          schedule_interval_minutes = $2,
          next_run_at = $3,
          is_continuous = $4,
          updated_at = NOW()
      WHERE id = $5
    `, [
      body.schedule_type,
      body.schedule_type === 'scheduled' ? body.interval_minutes : null,
      nextRunAt,
      body.schedule_type === 'continuous',
      id,
    ]);

    // Log schedule change
    await query(`
      INSERT INTO agent_logs (agent_id, level, message, metadata)
      VALUES ($1, 'info', 'Schedule updated', $2)
    `, [id, JSON.stringify({ schedule_type: body.schedule_type, interval_minutes: body.interval_minutes, updated_by: adminUser.email })]);

    return { success: true };
  });

  // Get scheduler status
  app.get('/api/v1/admin/reports/scheduler', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const status = await getSchedulerStatus();
    return status;
  });

  // Start/stop scheduler
  app.post('/api/v1/admin/reports/scheduler', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { action, intervalMs } = request.body as { action: 'start' | 'stop'; intervalMs?: number };

    if (action === 'start') {
      startAgentScheduler(intervalMs || 60000);
      await query(`
        INSERT INTO agent_logs (agent_id, level, message, metadata)
        VALUES (NULL, 'info', 'Scheduler started manually', $1)
      `, [JSON.stringify({ started_by: adminUser.email, interval_ms: intervalMs || 60000 })]);
      return { success: true, message: 'Scheduler started' };
    } else if (action === 'stop') {
      stopAgentScheduler();
      await query(`
        INSERT INTO agent_logs (agent_id, level, message, metadata)
        VALUES (NULL, 'info', 'Scheduler stopped manually', $1)
      `, [JSON.stringify({ stopped_by: adminUser.email })]);
      return { success: true, message: 'Scheduler stopped' };
    }

    return reply.code(400).send({ error: 'Invalid action' });
  });
}
