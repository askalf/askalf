/**
 * Built-in Tool: Ticket Operations
 * Allows agents to create, update, assign, and list tickets autonomously.
 * Writes to agent_tickets in the substrate database.
 * All mutations are recorded in agent_audit_log (immutable trail).
 */

import crypto from 'crypto';
import { getPool as getSharedPool } from '../../database.js';
import type pg from 'pg';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface TicketOpsInput {
  action: 'create' | 'update' | 'assign' | 'list' | 'get' | 'audit_history' | 'add_note';
  // create fields
  title?: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  category?: string;
  assigned_to?: string;
  agent_id?: string;
  agent_name?: string;
  // update/assign/get fields
  ticket_id?: string;
  status?: 'open' | 'in_progress' | 'resolved' | 'closed';
  /** Resolution note — what was done to resolve this ticket */
  resolution?: string;
  /** Progress note — timestamped update on work in progress */
  note?: string;
  // list filters
  filter_status?: string;
  filter_assigned_to?: string;
  limit?: number;
}

// ============================================
// Connection Pool (shared forge pool — no separate pool)
// ============================================

function getPool(): pg.Pool {
  return getSharedPool();
}

function generateId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = crypto.randomBytes(10).toString('hex').slice(0, 16);
  return (timestamp + random).toUpperCase();
}

// ============================================
// Audit Trail (immutable, append-only)
// ============================================

async function audit(
  p: pg.Pool,
  entityType: string,
  entityId: string,
  action: string,
  actor: string,
  actorId: string | null,
  oldValue: Record<string, unknown>,
  newValue: Record<string, unknown>,
  executionId?: string | null,
): Promise<void> {
  try {
    await p.query(
      `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, actor_id, old_value, new_value, execution_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [entityType, entityId, action, actor, actorId || null, JSON.stringify(oldValue), JSON.stringify(newValue), executionId || null],
    );
  } catch {
    // Audit failure is non-fatal — never block operations
  }
}

// ============================================
// Implementation
// ============================================

export async function ticketOps(input: TicketOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    const p = getPool();

    switch (input.action) {
      case 'create': {
        if (!input.title) {
          return { output: null, error: 'title is required to create a ticket', durationMs: 0 };
        }

        const id = generateId();
        const ticketData = {
          id,
          title: input.title,
          description: input.description || null,
          status: input.status || 'open',
          priority: input.priority || 'medium',
          category: input.category || 'task',
          created_by: input.agent_name || 'system',
          assigned_to: input.assigned_to || null,
          agent_id: input.agent_id || null,
          agent_name: input.agent_name || null,
        };

        const result = await p.query(
          `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, 'agent', '{}')
           RETURNING id, title, status, priority, assigned_to, agent_name, created_at`,
          [
            ticketData.id,
            ticketData.title,
            ticketData.description,
            ticketData.status,
            ticketData.priority,
            ticketData.category,
            ticketData.created_by,
            ticketData.assigned_to,
            ticketData.agent_id,
            ticketData.agent_name,
          ],
        );

        await audit(p, 'ticket', id, 'created', input.agent_name || 'system', input.agent_id || null, {}, ticketData);

        return {
          output: { created: true, ticket: result.rows[0] },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'update': {
        if (!input.ticket_id) {
          return { output: null, error: 'ticket_id is required for update', durationMs: 0 };
        }

        // Snapshot the old state first
        const oldResult = await p.query(
          `SELECT id, title, status, priority, category, description, assigned_to, agent_name, metadata FROM agent_tickets WHERE id = $1`,
          [input.ticket_id],
        );
        if (oldResult.rows.length === 0) {
          return { output: null, error: `Ticket not found: ${input.ticket_id}`, durationMs: Math.round(performance.now() - startTime) };
        }
        const oldTicket = oldResult.rows[0];

        const setClauses: string[] = [];
        const params: unknown[] = [];
        const changes: Record<string, unknown> = {};

        // Enforce: cannot resolve/close without resolution notes
        if ((input.status === 'resolved' || input.status === 'closed') && !input.resolution) {
          return {
            output: null,
            error: `Cannot ${input.status} a ticket without a resolution. Provide a detailed resolution note describing what was done, what changed, and the outcome.`,
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        // Enforce: must have at least 1 progress note before resolving/closing
        if (input.status === 'resolved' || input.status === 'closed') {
          const noteCount = await p.query(
            `SELECT count(*)::int as cnt FROM ticket_notes WHERE ticket_id = $1`,
            [input.ticket_id],
          );
          if ((noteCount.rows[0]?.cnt ?? 0) === 0) {
            return {
              output: null,
              error: `Cannot ${input.status} ticket ${input.ticket_id} — zero progress notes found. You MUST use add_note to log at least one progress update BEFORE resolving. Describe what you investigated, what you changed, and what you found.`,
              durationMs: Math.round(performance.now() - startTime),
            };
          }
        }

        if (input.status) {
          params.push(input.status);
          setClauses.push(`status = $${params.length}`);
          changes['status'] = input.status;
        }
        if (input.priority) {
          params.push(input.priority);
          setClauses.push(`priority = $${params.length}`);
          changes['priority'] = input.priority;
        }
        if (input.title) {
          params.push(input.title);
          setClauses.push(`title = $${params.length}`);
          changes['title'] = input.title;
        }
        if (input.description) {
          params.push(input.description);
          setClauses.push(`description = $${params.length}`);
          changes['description'] = input.description;
        }
        if (input.category) {
          params.push(input.category);
          setClauses.push(`category = $${params.length}`);
          changes['category'] = input.category;
        }
        if (input.resolution) {
          params.push(input.resolution);
          setClauses.push(`metadata = metadata || jsonb_build_object('resolution', $${params.length}, 'resolved_at', NOW()::text, 'resolved_by', COALESCE(assigned_to, 'unknown'))`);
          changes['resolution'] = input.resolution;
        }

        if (setClauses.length === 0) {
          return { output: null, error: 'No fields to update', durationMs: 0 };
        }

        setClauses.push('updated_at = NOW()');
        params.push(input.ticket_id);

        const result = await p.query(
          `UPDATE agent_tickets SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING id, title, status, priority, assigned_to, agent_name, metadata`,
          params,
        );

        // Determine audit action from changes
        let auditAction = 'updated';
        if (changes['status'] === 'resolved') auditAction = 'resolved';
        else if (changes['status'] === 'closed') auditAction = 'closed';
        else if (changes['status'] === 'in_progress') auditAction = 'started';
        else if (changes['status']) auditAction = 'status_changed';

        await audit(
          p, 'ticket', input.ticket_id, auditAction,
          input.agent_name || oldTicket.assigned_to || 'unknown',
          input.agent_id || null,
          { status: oldTicket.status, priority: oldTicket.priority, title: oldTicket.title },
          changes,
        );

        return {
          output: { updated: true, ticket: result.rows[0] },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'assign': {
        if (!input.ticket_id) {
          return { output: null, error: 'ticket_id is required for assign', durationMs: 0 };
        }
        if (!input.assigned_to) {
          return { output: null, error: 'assigned_to (agent name) is required for assign', durationMs: 0 };
        }

        // Snapshot old state
        const oldResult = await p.query(
          `SELECT assigned_to, status FROM agent_tickets WHERE id = $1`,
          [input.ticket_id],
        );
        const oldAssigned = oldResult.rows.length > 0 ? oldResult.rows[0] : {};

        const result = await p.query(
          `UPDATE agent_tickets SET assigned_to = $1, agent_name = $1, status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = NOW()
           WHERE id = $2 RETURNING id, title, status, assigned_to`,
          [input.assigned_to, input.ticket_id],
        );

        if (result.rows.length === 0) {
          return { output: null, error: `Ticket not found: ${input.ticket_id}`, durationMs: Math.round(performance.now() - startTime) };
        }

        await audit(
          p, 'ticket', input.ticket_id, 'assigned',
          input.agent_name || input.assigned_to,
          input.agent_id || null,
          { assigned_to: oldAssigned.assigned_to || null, status: oldAssigned.status },
          { assigned_to: input.assigned_to, status: result.rows[0].status },
        );

        return {
          output: { assigned: true, ticket: result.rows[0] },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'list': {
        const conditions: string[] = ['deleted_at IS NULL'];
        const params: unknown[] = [];

        if (input.filter_status) {
          params.push(input.filter_status);
          conditions.push(`status = $${params.length}`);
        }
        if (input.filter_assigned_to) {
          params.push(input.filter_assigned_to);
          conditions.push(`assigned_to = $${params.length}`);
        }

        const where = `WHERE ${conditions.join(' AND ')}`;
        const limit = Math.min(input.limit || 20, 50);

        const result = await p.query(
          `SELECT id, title, status, priority, category, assigned_to, agent_name, source, created_at, updated_at
           FROM agent_tickets ${where}
           ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 END, created_at DESC
           LIMIT ${limit}`,
          params,
        );

        return {
          output: { tickets: result.rows, count: result.rows.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'get': {
        if (!input.ticket_id) {
          return { output: null, error: 'ticket_id is required for get', durationMs: 0 };
        }

        const result = await p.query(
          `SELECT * FROM agent_tickets WHERE id = $1`,
          [input.ticket_id],
        );

        if (result.rows.length === 0) {
          return { output: null, error: `Ticket not found: ${input.ticket_id}`, durationMs: Math.round(performance.now() - startTime) };
        }

        return {
          output: { ticket: result.rows[0] },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'audit_history': {
        if (!input.ticket_id) {
          return { output: null, error: 'ticket_id is required for audit_history', durationMs: 0 };
        }

        const limit = Math.min(input.limit || 50, 100);
        const result = await p.query(
          `SELECT id, action, actor, actor_id, old_value, new_value, execution_id, created_at
           FROM agent_audit_log
           WHERE entity_type = 'ticket' AND entity_id = $1
           ORDER BY created_at ASC
           LIMIT $2`,
          [input.ticket_id, limit],
        );

        return {
          output: { ticket_id: input.ticket_id, audit_trail: result.rows, count: result.rows.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'add_note': {
        if (!input.ticket_id) {
          return { output: null, error: 'ticket_id is required for add_note', durationMs: 0 };
        }
        if (!input.note) {
          return { output: null, error: 'note is required for add_note — describe what you did, what you found, or what blocked you', durationMs: 0 };
        }

        const noteId = generateId();
        const timestamp = new Date().toISOString();
        const author = input.agent_name || 'unknown';

        await p.query(
          `INSERT INTO ticket_notes (id, ticket_id, author, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [noteId, input.ticket_id, author, input.note, timestamp],
        );

        // Also touch updated_at on the ticket so it doesn't look stale
        await p.query(
          `UPDATE agent_tickets SET updated_at = NOW() WHERE id = $1`,
          [input.ticket_id],
        );

        await audit(
          p, 'ticket', input.ticket_id, 'note_added',
          author, input.agent_id || null,
          {}, { note: input.note, timestamp },
        );

        return {
          output: { note_added: true, note_id: noteId, ticket_id: input.ticket_id, timestamp },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: create, update, assign, list, get, add_note, audit_history`,
          durationMs: Math.round(performance.now() - startTime),
        };
    }
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}
