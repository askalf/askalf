/**
 * Tasks API Routes
 * Full audit trail of all agent tasks with pagination and handoffs
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';

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

export async function taskRoutes(app: FastifyInstance): Promise<void> {
  // Get all tasks with pagination
  app.get('/api/v1/admin/tasks', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const {
      page = '1',
      limit = '20',
      agent_id,
      status,
      type
    } = request.query as {
      page?: string;
      limit?: string;
      agent_id?: string;
      status?: string;
      type?: string;
    };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Build WHERE clause
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (agent_id) {
      conditions.push(`at.agent_id = $${paramIndex++}`);
      params.push(agent_id);
    }
    if (status) {
      conditions.push(`at.status = $${paramIndex++}`);
      params.push(status);
    }
    if (type) {
      conditions.push(`at.type = $${paramIndex++}`);
      params.push(type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM agent_tasks at ${whereClause}`,
      params
    );
    const totalCount = parseInt(countResult?.count || '0');
    const totalPages = Math.ceil(totalCount / limitNum);

    // Get tasks with agent info
    const tasks = await query<{
      id: string;
      agent_id: string;
      agent_name: string;
      agent_type: string;
      type: string;
      status: string;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      error: string | null;
      started_at: string | null;
      completed_at: string | null;
      created_at: string;
      parent_task_id: string | null;
      handoff_to_agent_id: string | null;
      handoff_to_agent_name: string | null;
    }>(
      `SELECT
        at.id,
        at.agent_id,
        a.name as agent_name,
        a.type as agent_type,
        at.type,
        at.status,
        at.input,
        at.output,
        at.error,
        at.started_at,
        at.completed_at,
        at.created_at,
        at.parent_task_id,
        at.handoff_to_agent_id,
        ha.name as handoff_to_agent_name
      FROM agent_tasks at
      JOIN agents a ON at.agent_id = a.id
      LEFT JOIN agents ha ON at.handoff_to_agent_id = ha.id
      ${whereClause}
      ORDER BY at.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      [...params, limitNum, offset]
    );

    return {
      tasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      },
    };
  });

  // Get single task with full details
  app.get('/api/v1/admin/tasks/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };

    const task = await queryOne<{
      id: string;
      agent_id: string;
      agent_name: string;
      agent_type: string;
      type: string;
      status: string;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      error: string | null;
      started_at: string | null;
      completed_at: string | null;
      created_at: string;
      parent_task_id: string | null;
      handoff_to_agent_id: string | null;
    }>(
      `SELECT
        at.*,
        a.name as agent_name,
        a.type as agent_type
      FROM agent_tasks at
      JOIN agents a ON at.agent_id = a.id
      WHERE at.id = $1`,
      [id]
    );

    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    // Get related logs
    const logs = await query<{
      id: string;
      level: string;
      message: string;
      metadata: Record<string, unknown>;
      created_at: string;
    }>(
      `SELECT id, level, message, metadata, created_at
       FROM agent_logs
       WHERE task_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    // Get child tasks (handoffs)
    const childTasks = await query<{
      id: string;
      agent_name: string;
      type: string;
      status: string;
      created_at: string;
    }>(
      `SELECT at.id, a.name as agent_name, at.type, at.status, at.created_at
       FROM agent_tasks at
       JOIN agents a ON at.agent_id = a.id
       WHERE at.parent_task_id = $1
       ORDER BY at.created_at ASC`,
      [id]
    );

    // Get linked interventions
    const interventions = await query<{
      id: string;
      type: string;
      title: string;
      status: string;
      created_at: string;
    }>(
      `SELECT id, type, title, status, created_at
       FROM intervention_requests
       WHERE task_id = $1
       ORDER BY created_at ASC`,
      [id]
    );

    return {
      task,
      logs,
      childTasks,
      interventions,
    };
  });

  // Create a handoff task (agent spawns task for another agent)
  app.post('/api/v1/admin/tasks/:id/handoff', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const { target_agent_id, task_type, input, reason } = request.body as {
      target_agent_id: string;
      task_type: string;
      input: Record<string, unknown>;
      reason: string;
    };

    // Verify parent task exists
    const parentTask = await queryOne<{ id: string; agent_id: string }>(
      'SELECT id, agent_id FROM agent_tasks WHERE id = $1',
      [id]
    );
    if (!parentTask) {
      return reply.code(404).send({ error: 'Parent task not found' });
    }

    // Verify target agent exists
    const targetAgent = await queryOne<{ id: string; name: string }>(
      'SELECT id, name FROM agents WHERE id = $1 AND is_decommissioned = FALSE',
      [target_agent_id]
    );
    if (!targetAgent) {
      return reply.code(404).send({ error: 'Target agent not found' });
    }

    // Create handoff task
    const newTask = await queryOne<{ id: string }>(
      `INSERT INTO agent_tasks (agent_id, type, status, input, parent_task_id, created_at)
       VALUES ($1, $2, 'pending', $3, $4, NOW())
       RETURNING id`,
      [target_agent_id, task_type, JSON.stringify({ ...input, handoff_reason: reason }), id]
    );

    // Update parent task with handoff reference
    await query(
      `UPDATE agent_tasks SET handoff_to_agent_id = $1 WHERE id = $2`,
      [target_agent_id, id]
    );

    // Log the handoff
    await query(
      `INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
       VALUES ($1, $2, 'info', 'Task handed off to another agent', $3)`,
      [parentTask.agent_id, id, JSON.stringify({
        target_agent_id,
        target_agent_name: targetAgent.name,
        new_task_id: newTask?.id,
        reason
      })]
    );

    return {
      success: true,
      task_id: newTask?.id,
      message: `Task handed off to ${targetAgent.name}`
    };
  });

  // Get task statistics
  app.get('/api/v1/admin/tasks/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const stats = await queryOne<{
      total: string;
      pending: string;
      in_progress: string;
      completed: string;
      failed: string;
      handoffs: string;
    }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE parent_task_id IS NOT NULL) as handoffs
      FROM agent_tasks
    `);

    const recentByAgent = await query<{
      agent_name: string;
      task_count: string;
      success_rate: string;
    }>(`
      SELECT
        a.name as agent_name,
        COUNT(*) as task_count,
        ROUND(COUNT(*) FILTER (WHERE at.status = 'completed') * 100.0 / NULLIF(COUNT(*), 0)) as success_rate
      FROM agent_tasks at
      JOIN agents a ON at.agent_id = a.id
      WHERE at.created_at > NOW() - INTERVAL '24 hours'
      GROUP BY a.name
      ORDER BY task_count DESC
      LIMIT 10
    `);

    return {
      totals: {
        total: parseInt(stats?.total || '0'),
        pending: parseInt(stats?.pending || '0'),
        in_progress: parseInt(stats?.in_progress || '0'),
        completed: parseInt(stats?.completed || '0'),
        failed: parseInt(stats?.failed || '0'),
        handoffs: parseInt(stats?.handoffs || '0'),
      },
      recentByAgent,
    };
  });
}
