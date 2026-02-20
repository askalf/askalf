// Ticket CRUD, ticket notes, audit trail
import { callForge, callForgeAdmin, ulid, paginationResponse } from './utils.js';

export async function registerTicketRoutes(fastify, requireAdmin, query, queryOne) {

  // GET /api/v1/admin/tickets - List tickets
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
        const taskRes = await callForgeAdmin(`/executions/${ticket.task_id}`);
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

  // POST /api/v1/admin/tickets - Create ticket
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

  // PATCH /api/v1/admin/tickets/:id - Update ticket
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

  // DELETE /api/v1/admin/tickets/:id - Soft-delete ticket (immutable audit trail)
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

  // GET /api/v1/admin/tickets/:id/notes - Ticket notes
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

  // POST /api/v1/admin/tickets/:id/notes - Create ticket note
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

  // GET /api/v1/admin/audit - View audit trail
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
}
