/**
 * Intervention Requests API Routes
 * Human-in-the-loop system for agent oversight and autonomy progression
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

export async function interventionRoutes(app: FastifyInstance): Promise<void> {
  // ============================================
  // INTERVENTION REQUESTS
  // ============================================

  // List pending interventions (for human review) - with pagination
  app.get('/api/v1/admin/interventions', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const {
      status = 'pending',
      page = '1',
      limit = '20'
    } = request.query as { status?: string; page?: string; limit?: string };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    // Get total count for pagination
    const countResult = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count
      FROM intervention_requests ir
      WHERE ($1 = 'all' OR ir.status = $1)
    `, [status]);
    const totalCount = parseInt(countResult?.count || '0');
    const totalPages = Math.ceil(totalCount / limitNum);

    const interventions = await query<{
      id: string;
      agent_id: string;
      agent_name: string;
      agent_type: string;
      task_id: string | null;
      type: string;
      title: string;
      description: string;
      context: Record<string, unknown>;
      proposed_action: string;
      status: string;
      human_response: string | null;
      responded_by: string | null;
      responded_at: string | null;
      autonomy_delta: number;
      created_at: string;
    }>(`
      SELECT ir.*, a.name as agent_name, a.type as agent_type
      FROM intervention_requests ir
      JOIN agents a ON ir.agent_id = a.id
      WHERE ($1 = 'all' OR ir.status = $1)
      ORDER BY
        CASE WHEN ir.status = 'pending' THEN 0 ELSE 1 END,
        ir.created_at DESC
      LIMIT $2 OFFSET $3
    `, [status, limitNum, offset]);

    // Get counts by status
    const counts = await queryOne<{ pending: string; approved: string; denied: string; feedback_given: string }>(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'denied') as denied,
        COUNT(*) FILTER (WHERE status = 'feedback_given') as feedback_given
      FROM intervention_requests
    `);

    return {
      interventions,
      counts: {
        pending: parseInt(counts?.pending || '0'),
        approved: parseInt(counts?.approved || '0'),
        denied: parseInt(counts?.denied || '0'),
        feedback_given: parseInt(counts?.feedback_given || '0'),
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total: totalCount,
        totalPages,
        hasNext: pageNum < totalPages,
        hasPrev: pageNum > 1,
      }
    };
  });

  // Respond to an intervention (approve/deny/feedback)
  app.post('/api/v1/admin/interventions/:id/respond', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const body = request.body as {
      action: 'approve' | 'deny' | 'feedback';
      response?: string;
      autonomy_delta?: number; // -10 to +10 adjustment
    };

    if (!['approve', 'deny', 'feedback'].includes(body.action)) {
      return reply.code(400).send({ error: 'Invalid action' });
    }

    // Get the intervention
    const intervention = await queryOne<{ agent_id: string; task_id: string | null }>(`
      SELECT agent_id, task_id FROM intervention_requests WHERE id = $1 AND status = 'pending'
    `, [id]);

    if (!intervention) {
      return reply.code(404).send({ error: 'Intervention not found or already responded' });
    }

    const status = body.action === 'approve' ? 'approved'
                 : body.action === 'deny' ? 'denied'
                 : 'feedback_given';

    // Update intervention
    await query(`
      UPDATE intervention_requests
      SET status = $1, human_response = $2, responded_by = $3, responded_at = NOW(), autonomy_delta = $4
      WHERE id = $5
    `, [status, body.response || null, adminUser.user_id, body.autonomy_delta || 0, id]);

    // Update agent autonomy level
    if (body.autonomy_delta) {
      await query(`
        UPDATE agents
        SET autonomy_level = GREATEST(0, LEAST(100, autonomy_level + $1)),
            updated_at = NOW()
        WHERE id = $2
      `, [body.autonomy_delta, intervention.agent_id]);
    } else {
      // Default autonomy adjustments
      const defaultDelta = body.action === 'approve' ? 2 : body.action === 'deny' ? -5 : 0;
      if (defaultDelta !== 0) {
        await query(`
          UPDATE agents
          SET autonomy_level = GREATEST(0, LEAST(100, autonomy_level + $1)),
              updated_at = NOW()
          WHERE id = $2
        `, [defaultDelta, intervention.agent_id]);
      }
    }

    // Log the response
    await query(`
      INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
      VALUES ($1, $2, 'info', $3, $4)
    `, [
      intervention.agent_id,
      intervention.task_id,
      `Intervention ${status} by admin`,
      JSON.stringify({ action: body.action, response: body.response, by: adminUser.email })
    ]);

    // If approved, trigger agent continuation - create a follow-up task
    let continuationTaskId: string | null = null;
    if (body.action === 'approve') {
      // Get agent info for the continuation task
      const agent = await queryOne<{ name: string; type: string }>(`
        SELECT name, type FROM agents WHERE id = $1
      `, [intervention.agent_id]);

      if (agent) {
        // Create continuation task
        const continuationTask = await queryOne<{ id: string }>(`
          INSERT INTO agent_tasks (agent_id, type, status, input, parent_task_id, created_at)
          VALUES ($1, $2, 'pending', $3, $4, NOW())
          RETURNING id
        `, [
          intervention.agent_id,
          'intervention_continuation',
          JSON.stringify({
            triggered_by: 'intervention_approval',
            intervention_id: id,
            admin_response: body.response || 'Approved - proceed with proposed action',
            original_task_id: intervention.task_id
          }),
          intervention.task_id
        ]);

        continuationTaskId = continuationTask?.id || null;

        if (continuationTaskId) {
          // Set agent to idle so scheduler picks it up for continuation
          await query(`
            UPDATE agents
            SET status = 'idle',
                next_run_at = NOW(),
                updated_at = NOW()
            WHERE id = $1 AND status != 'running'
          `, [intervention.agent_id]);

          await query(`
            INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
            VALUES ($1, $2, 'info', 'Continuation task created after intervention approval', $3)
          `, [intervention.agent_id, continuationTaskId, JSON.stringify({
            intervention_id: id,
            approved_by: adminUser.email
          })]);
        }
      }
    }

    return {
      success: true,
      status,
      continuationTaskId
    };
  });

  // Create intervention (called by agents when they need human input)
  app.post('/api/v1/admin/interventions', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as {
      agent_id: string;
      task_id?: string;
      type?: string;
      title: string;
      description?: string;
      context?: Record<string, unknown>;
      proposed_action?: string;
    };

    if (!body.agent_id || !body.title?.trim()) {
      return reply.code(400).send({ error: 'agent_id and title are required' });
    }

    const intervention = await queryOne<{ id: string }>(`
      INSERT INTO intervention_requests (agent_id, task_id, type, title, description, context, proposed_action)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      body.agent_id,
      body.task_id || null,
      body.type || 'approval',
      body.title.trim(),
      body.description?.trim() || null,
      JSON.stringify(body.context || {}),
      body.proposed_action || null,
    ]);

    return { success: true, id: intervention?.id };
  });

  // ============================================
  // AGENT ORCHESTRATION
  // ============================================

  // Decommission an agent
  app.post('/api/v1/admin/agents/:id/decommission', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };

    // Stop any running tasks first
    await query(`
      UPDATE agent_tasks SET status = 'cancelled', completed_at = NOW()
      WHERE agent_id = $1 AND status = 'running'
    `, [id]);

    // Mark as decommissioned
    await query(`
      UPDATE agents
      SET is_decommissioned = TRUE,
          decommissioned_at = NOW(),
          status = 'idle',
          updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // Log
    await query(`
      INSERT INTO agent_logs (agent_id, level, message, metadata)
      VALUES ($1, 'warn', 'Agent decommissioned', $2)
    `, [id, JSON.stringify({ decommissioned_by: adminUser.email })]);

    return { success: true };
  });

  // Recommission an agent
  app.post('/api/v1/admin/agents/:id/recommission', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };

    await query(`
      UPDATE agents
      SET is_decommissioned = FALSE,
          decommissioned_at = NULL,
          updated_at = NOW()
      WHERE id = $1
    `, [id]);

    await query(`
      INSERT INTO agent_logs (agent_id, level, message, metadata)
      VALUES ($1, 'info', 'Agent recommissioned', $2)
    `, [id, JSON.stringify({ recommissioned_by: adminUser.email })]);

    return { success: true };
  });

  // Get orchestration overview
  app.get('/api/v1/admin/orchestration', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Agent stats
    const agentStats = await queryOne<{
      total: string;
      active: string;
      running: string;
      decommissioned: string;
      avg_autonomy: string;
    }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE NOT is_decommissioned) as active,
        COUNT(*) FILTER (WHERE status = 'running' AND NOT is_decommissioned) as running,
        COUNT(*) FILTER (WHERE is_decommissioned) as decommissioned,
        COALESCE(AVG(autonomy_level) FILTER (WHERE NOT is_decommissioned), 0) as avg_autonomy
      FROM agents
    `);

    // Pending interventions
    const pendingInterventions = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM intervention_requests WHERE status = 'pending'
    `);

    // Recent activity
    const recentTasks = await query<{
      agent_name: string;
      status: string;
      created_at: string;
    }>(`
      SELECT a.name as agent_name, at.status, at.created_at
      FROM agent_tasks at
      JOIN agents a ON at.agent_id = a.id
      ORDER BY at.created_at DESC
      LIMIT 10
    `);

    return {
      agents: {
        total: parseInt(agentStats?.total || '0'),
        active: parseInt(agentStats?.active || '0'),
        running: parseInt(agentStats?.running || '0'),
        decommissioned: parseInt(agentStats?.decommissioned || '0'),
        avgAutonomy: Math.round(parseFloat(agentStats?.avg_autonomy || '0')),
      },
      pendingInterventions: parseInt(pendingInterventions?.count || '0'),
      recentTasks,
    };
  });
}
