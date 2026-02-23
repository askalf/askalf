/**
 * Platform Admin — Ticket CRUD + notes
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { queryOne } from '../../database.js';
import { substrateQuery, substrateQueryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';
import { paginationResponse } from './utils.js';

export async function registerTicketRoutes(app: FastifyInstance): Promise<void> {

  // List tickets
  app.get(
    '/api/v1/admin/tickets',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as {
        status?: string; source?: string; assigned_to?: string;
        filter?: string; page?: string; limit?: string;
      };
      const conditions: string[] = [];
      const params: unknown[] = [];
      const page = parseInt(qs.page ?? '1');
      const limit = parseInt(qs.limit ?? '20');
      const offset = (page - 1) * limit;

      if (qs.filter === 'open') {
        conditions.push(`status IN ('open', 'in_progress')`);
      } else if (qs.filter === 'resolved') {
        conditions.push(`status = 'resolved'`);
      } else if (qs.filter === 'critical') {
        conditions.push(`priority IN ('urgent', 'high')`);
      }
      if (qs.status) {
        params.push(qs.status);
        conditions.push(`status = $${params.length}`);
      }
      if (qs.source && qs.source !== 'all') {
        params.push(qs.source);
        conditions.push(`source = $${params.length}`);
      }
      if (qs.assigned_to) {
        params.push(qs.assigned_to);
        conditions.push(`assigned_to = $${params.length}`);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const [tickets, countResult] = await Promise.all([
        substrateQuery(
          `SELECT * FROM agent_tickets ${whereClause}
           ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END,
           created_at DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
          [...params, limit, offset],
        ),
        substrateQueryOne<{ count: string }>(
          `SELECT COUNT(*) as count FROM agent_tickets ${whereClause}`,
          params,
        ),
      ]);

      // Enrich tickets with linked execution info
      for (const ticket of tickets as Record<string, unknown>[]) {
        if (ticket['task_id']) {
          const exec = await queryOne<Record<string, unknown>>(
            `SELECT id, status, metadata, started_at, completed_at FROM forge_executions WHERE id = $1`,
            [ticket['task_id']],
          );
          if (exec) {
            ticket['task'] = {
              id: exec['id'],
              status: exec['status'],
              started_at: exec['started_at'],
              completed_at: exec['completed_at'],
            };
          }
        }
      }

      const total = parseInt(countResult?.count || '0');
      return { tickets, total, page, limit, pagination: paginationResponse(total, page, limit) };
    },
  );

  // Create ticket
  app.post(
    '/api/v1/admin/tickets',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as Record<string, unknown>;
      const id = ulid();
      const createdBy = (body['created_by'] as string) || request.userId || 'admin';

      const ticket = await substrateQueryOne(
        `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to,
          agent_id, agent_name, is_agent_ticket, source, task_id, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING *`,
        [
          id,
          body['title'] || 'Untitled Ticket',
          body['description'] || null,
          body['status'] || 'open',
          body['priority'] || 'medium',
          body['category'] || null,
          createdBy,
          body['assigned_to'] || null,
          body['agent_id'] || null,
          body['agent_name'] || null,
          body['is_agent_ticket'] || false,
          body['source'] || 'human',
          body['task_id'] || null,
          JSON.stringify(body['metadata'] || {}),
        ],
      );

      void substrateQuery(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value)
         VALUES ('ticket', $1, 'created', $2, $3, '{}', $4)`,
        [id, `human:${createdBy}`, createdBy, JSON.stringify({ title: body['title'], priority: body['priority'] })],
      ).catch(() => {});

      return reply.code(201).send({ ticket });
    },
  );

  // Update ticket
  app.patch(
    '/api/v1/admin/tickets/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as Record<string, unknown>;
      const fields: string[] = [];
      const params: unknown[] = [];

      const VALID_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
      const VALID_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

      if (body['status'] !== undefined && !VALID_STATUSES.includes(body['status'] as typeof VALID_STATUSES[number])) {
        return reply.code(400).send({ error: 'Validation Error', message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      if (body['priority'] !== undefined && !VALID_PRIORITIES.includes(body['priority'] as typeof VALID_PRIORITIES[number])) {
        return reply.code(400).send({ error: 'Validation Error', message: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}` });
      }

      for (const key of ['status', 'priority', 'assigned_to', 'title', 'description', 'category', 'resolution']) {
        if (body[key] !== undefined) {
          params.push(body[key]);
          fields.push(`${key} = $${params.length}`);
        }
      }

      if (fields.length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      const oldTicket = await substrateQueryOne<Record<string, unknown>>(
        `SELECT id, status, priority, assigned_to, title FROM agent_tickets WHERE id = $1`,
        [id],
      );

      fields.push('updated_at = NOW()');
      params.push(id);

      const ticket = await substrateQueryOne(
        `UPDATE agent_tickets SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params,
      );

      if (!ticket) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }

      void substrateQuery(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value)
         VALUES ('ticket', $1, $2, $3, $4, $5, $6)`,
        [
          id,
          body['status'] === 'resolved' ? 'resolved' : body['assigned_to'] ? 'assigned' : 'updated',
          `human:${request.userId || 'admin'}`,
          request.userId || null,
          JSON.stringify({ status: oldTicket?.['status'], priority: oldTicket?.['priority'] }),
          JSON.stringify(body),
        ],
      ).catch(() => {});

      return { ticket };
    },
  );

  // Delete ticket (soft-delete)
  app.delete(
    '/api/v1/admin/tickets/:id',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const old = await substrateQueryOne<Record<string, unknown>>(
        `SELECT id, title, status, priority, assigned_to FROM agent_tickets WHERE id = $1`,
        [id],
      );
      if (!old) {
        return reply.code(404).send({ error: 'Ticket not found' });
      }

      await substrateQuery(
        `UPDATE agent_tickets SET deleted_at = NOW(), status = 'closed', updated_at = NOW() WHERE id = $1`,
        [id],
      );

      void substrateQuery(
        `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
         VALUES ('ticket', $1, 'deleted', $2, $3, '{"soft_deleted": true}')`,
        [id, `human:${request.userId || 'admin'}`, JSON.stringify({ status: old['status'], title: old['title'] })],
      ).catch(() => {});

      return { success: true, id, soft_deleted: true };
    },
  );

  // Ticket notes — list
  app.get(
    '/api/v1/admin/tickets/:id/notes',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const { id } = request.params as { id: string };
      const notes = await substrateQuery<Record<string, unknown>>(
        `SELECT * FROM ticket_notes WHERE ticket_id = $1 ORDER BY created_at ASC`, [id],
      ).catch(() => [] as Record<string, unknown>[]);
      return { notes };
    },
  );

  // Ticket notes — create
  app.post(
    '/api/v1/admin/tickets/:id/notes',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const { content } = request.body as { content: string };
      if (!content || typeof content !== 'string' || !content.trim()) {
        return reply.code(400).send({ error: 'Validation Error', message: 'content is required' });
      }
      const noteId = ulid();
      try {
        const note = await substrateQueryOne<Record<string, unknown>>(
          `INSERT INTO ticket_notes (id, ticket_id, content, author, created_at)
           VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
          [noteId, id, content, request.userId || 'admin'],
        );
        return { note };
      } catch (err) {
        console.error(`[Tickets] Failed to add note to ${id}:`, err);
        return { note: null, error: 'Failed to save note' };
      }
    },
  );
}
