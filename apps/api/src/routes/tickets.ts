/**
 * Tickets API Routes
 * Internal ticketing system for admin/team task management
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

async function getAnyUser(
  request: FastifyRequest
): Promise<{ user_id: string; tenant_id: string; email: string } | null> {
  const sessionToken = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const tokenHash = await hashToken(sessionToken);
  const session = await queryOne<{ user_id: string; tenant_id: string; email: string }>(
    `SELECT s.user_id, u.tenant_id, u.email FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false`,
    [tokenHash]
  );

  return session || null;
}

export async function ticketRoutes(app: FastifyInstance): Promise<void> {
  // Get tickets - with pagination
  app.get('/api/v1/admin/tickets', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const {
      filter = 'all',
      source = 'all',
      page = '1',
      limit = '20'
    } = request.query as { filter?: string; source?: string; page?: string; limit?: string };

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    // Status filter
    if (filter === 'open') {
      conditions.push("t.status IN ('open', 'in_progress')");
    } else if (filter === 'mine') {
      conditions.push(`t.assigned_to = $${paramIndex++}`);
      params.push(adminUser.user_id);
    }

    // Source filter (human vs agent)
    if (source === 'human') {
      conditions.push('t.agent_id IS NULL');
    } else if (source === 'agent') {
      conditions.push('t.agent_id IS NOT NULL');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count for pagination
    const countResult = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM tickets t ${whereClause}
    `, params);
    const totalCount = parseInt(countResult?.count || '0');
    const totalPages = Math.ceil(totalCount / limitNum);

    const tickets = await query<{
      id: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      category: string;
      created_by: string;
      assigned_to: string;
      agent_id: string | null;
      task_id: string | null;
      source: string | null;
      reporter_email: string | null;
      created_at: string;
      updated_at: string;
      creator_email: string;
      assignee_email: string;
      agent_name: string | null;
      task_status: string | null;
      task_type: string | null;
      task_started_at: string | null;
      task_completed_at: string | null;
    }>(`
      SELECT t.*,
             creator.email as creator_email,
             assignee.email as assignee_email,
             a.name as agent_name,
             at.status as task_status,
             at.type as task_type,
             at.started_at as task_started_at,
             at.completed_at as task_completed_at
      FROM tickets t
      LEFT JOIN users creator ON t.created_by = creator.id
      LEFT JOIN users assignee ON t.assigned_to = assignee.id
      LEFT JOIN agents a ON t.agent_id = a.id
      LEFT JOIN agent_tasks at ON t.task_id = at.id
      ${whereClause}
      ORDER BY
        CASE t.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        t.created_at DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex}
    `, [...params, limitNum, offset]);

    return {
      tickets: tickets.map(t => ({
        ...t,
        created_by: t.creator_email?.split('@')[0] || t.created_by,
        assigned_to: t.assignee_email?.split('@')[0] || t.assigned_to,
        is_agent_ticket: !!t.agent_id,
        task: t.task_id ? {
          id: t.task_id,
          status: t.task_status,
          type: t.task_type,
          started_at: t.task_started_at,
          completed_at: t.task_completed_at,
        } : null,
      })),
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

  // Create ticket
  app.post('/api/v1/admin/tickets', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as {
      title?: string;
      description?: string;
      priority?: string;
      category?: string;
      assigned_to?: string;
    };

    if (!body.title?.trim()) {
      return reply.code(400).send({ error: 'Title is required' });
    }

    const ticket = await queryOne<{ id: string }>(`
      INSERT INTO tickets (title, description, priority, category, created_by, assigned_to)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [
      body.title.trim(),
      body.description?.trim() || null,
      body.priority || 'medium',
      body.category || 'task',
      adminUser.user_id,
      body.assigned_to || null,
    ]);

    return { success: true, id: ticket?.id };
  });

  // Update ticket
  app.patch('/api/v1/admin/tickets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      description?: string;
      status?: string;
      priority?: string;
      category?: string;
      assigned_to?: string | null;
    };

    const updates: string[] = [];
    const params: (string | null)[] = [];
    let paramIndex = 1;

    if (body.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      params.push(body.title);
    }
    if (body.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(body.description);
    }
    if (body.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      params.push(body.status);
    }
    if (body.priority !== undefined) {
      updates.push(`priority = $${paramIndex++}`);
      params.push(body.priority);
    }
    if (body.category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      params.push(body.category);
    }
    if (body.assigned_to !== undefined) {
      updates.push(`assigned_to = $${paramIndex++}`);
      params.push(body.assigned_to);
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'No updates provided' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    await query(`
      UPDATE tickets SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
    `, params);

    return { success: true };
  });

  // Delete ticket
  app.delete('/api/v1/admin/tickets/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };

    await query('DELETE FROM tickets WHERE id = $1', [id]);

    return { success: true };
  });

  // ============================================
  // AGENT TICKET CREATION
  // ============================================

  // Create ticket from an agent (for intervention requests that need human action)
  app.post('/api/v1/admin/tickets/agent', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as {
      agent_id: string;
      title: string;
      description?: string;
      priority?: string;
      category?: string;
    };

    if (!body.agent_id || !body.title?.trim()) {
      return reply.code(400).send({ error: 'agent_id and title are required' });
    }

    const ticket = await queryOne<{ id: string }>(`
      INSERT INTO tickets (title, description, priority, category, agent_id, source)
      VALUES ($1, $2, $3, $4, $5, 'agent')
      RETURNING id
    `, [
      body.title.trim(),
      body.description?.trim() || null,
      body.priority || 'medium',
      body.category || 'agent_request',
      body.agent_id,
    ]);

    return { success: true, id: ticket?.id };
  });

  // ============================================
  // PUBLIC BUG REPORT ENDPOINT
  // ============================================

  // Public bug report - works for logged-in and anonymous users
  app.post('/api/v1/bug-report', async (request: FastifyRequest, reply: FastifyReply) => {
    const user = await getAnyUser(request);

    const body = request.body as {
      title?: string;
      description?: string;
      category?: string;
      email?: string;
      page?: string;
      userAgent?: string;
    };

    if (!body.description?.trim()) {
      return reply.code(400).send({ error: 'Description is required' });
    }

    // For anonymous users, email is required
    if (!user && !body.email?.trim()) {
      return reply.code(400).send({ error: 'Email is required for anonymous reports' });
    }

    // Build a detailed description with context
    const reporterInfo = user
      ? `Reporter: ${user.email} (User ID: ${user.user_id})`
      : `Reporter: ${body.email} (Anonymous)`;

    const contextInfo = [
      reporterInfo,
      body.page ? `Page: ${body.page}` : null,
      body.userAgent ? `Browser: ${body.userAgent}` : null,
      '---',
      body.description.trim()
    ].filter(Boolean).join('\n');

    const title = body.title?.trim() || `Bug Report: ${body.description.trim().slice(0, 50)}${body.description.length > 50 ? '...' : ''}`;

    // Insert ticket - use user's ID if logged in, otherwise use a placeholder
    // We store reporter email in description for anonymous users
    const ticket = await queryOne<{ id: string }>(`
      INSERT INTO tickets (title, description, priority, category, created_by, reporter_email, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      title,
      contextInfo,
      'medium',
      body.category || 'bug',
      user?.user_id || null,
      user ? user.email : body.email?.trim(),
      'user_report'
    ]);

    return { success: true, id: ticket?.id };
  });
}
