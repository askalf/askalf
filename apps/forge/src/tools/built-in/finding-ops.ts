/**
 * Built-in Tool: Finding Operations
 * Allows agents to report findings, insights, and observations autonomously.
 * Writes to agent_findings in the substrate database.
 * All mutations are recorded in agent_audit_log (immutable trail).
 */

import crypto from 'crypto';
import { getPool as getSharedPool } from '../../database.js';
import type pg from 'pg';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface FindingOpsInput {
  action: 'create' | 'list' | 'get';
  // create fields
  finding?: string;
  severity?: 'info' | 'warning' | 'critical';
  category?: string;
  agent_id?: string;
  agent_name?: string;
  execution_id?: string;
  metadata?: Record<string, unknown>;
  // get fields
  finding_id?: string;
  // list filters
  filter_severity?: string;
  filter_agent_id?: string;
  filter_category?: string;
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

export async function findingOps(input: FindingOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    const p = getPool();

    switch (input.action) {
      case 'create': {
        if (!input.finding) {
          return { output: null, error: 'finding text is required', durationMs: 0 };
        }
        if (!input.agent_name) {
          return { output: null, error: 'agent_name is required', durationMs: 0 };
        }

        const id = generateId();
        const severity = input.severity || 'info';
        const category = input.category || 'general';

        const findingData = {
          id,
          agent_id: input.agent_id || 'unknown',
          agent_name: input.agent_name,
          finding: input.finding,
          severity,
          category,
          execution_id: input.execution_id || null,
          metadata: input.metadata || {},
        };

        const result = await p.query(
          `INSERT INTO agent_findings (id, agent_id, agent_name, finding, severity, category, execution_id, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, agent_name, finding, severity, category, created_at`,
          [
            findingData.id,
            findingData.agent_id,
            findingData.agent_name,
            findingData.finding,
            findingData.severity,
            findingData.category,
            findingData.execution_id,
            JSON.stringify(findingData.metadata),
          ],
        );

        // Audit the finding creation
        await audit(p, 'finding', id, 'created', input.agent_name, input.agent_id || null, {}, findingData, input.execution_id);

        // Auto-create ticket only for critical findings (warnings are logged but don't create tickets)
        let ticketId: string | null = null;
        if (severity === 'critical') {
          // Dedup: skip if an open/in_progress ticket already exists with identical/similar title
          // This prevents batch double-fires and concurrent dispatch issues
          const ticketTitle = `[CRITICAL] ${input.finding.substring(0, 100)}`;
          const existing = await p.query(
            `SELECT id FROM agent_tickets
             WHERE deleted_at IS NULL
               AND status IN ('open', 'in_progress')
               AND title = $1
             LIMIT 1`,
            [ticketTitle],
          );

          if (existing.rows.length === 0) {
            const tId = generateId();
            const priority = 'urgent';

            // Determine who should work on it based on category
            let assignTo: string | null = null;
            if (category === 'security') assignTo = 'Security';
            else if (category === 'performance' || category === 'optimization') assignTo = 'Backend Dev';
            else if (category === 'infrastructure' || category === 'infrastructure_status') assignTo = 'Infra';
            else if (category === 'bug') assignTo = 'Backend Dev';
            else if (category === 'service_outage') assignTo = 'Infra';
            // Default: assign to Backend Dev to triage
            if (!assignTo) assignTo = 'Backend Dev';

            try {
              await p.query(
                `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, agent_id, agent_name, is_agent_ticket, source, metadata)
                 VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8, $9, true, 'agent', $10)`,
                [
                  tId,
                  `[CRITICAL] ${input.finding.substring(0, 100)}`,
                  input.finding,
                  priority,
                  category,
                  input.agent_name,
                  assignTo,
                  input.agent_id || null,
                  input.agent_name,
                  JSON.stringify({ finding_id: id, auto_created: true }),
                ],
              );
              ticketId = tId;

              // Audit the auto-created ticket
              await audit(p, 'ticket', tId, 'created', input.agent_name, input.agent_id || null, {}, {
                title: `[CRITICAL] ${input.finding.substring(0, 100)}`,
                priority,
                category,
                assigned_to: assignTo,
                source: 'auto_from_finding',
                finding_id: id,
              }, input.execution_id);

              // Audit the cross-reference on the finding
              await audit(p, 'finding', id, 'ticket_created', input.agent_name, input.agent_id || null, {}, {
                ticket_id: tId,
                assigned_to: assignTo,
              }, input.execution_id);
            } catch {
              // Non-fatal — finding was still created
            }
          }
        }

        return {
          output: {
            created: true,
            finding: result.rows[0],
            ticket_created: ticketId !== null,
            ticket_id: ticketId,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'list': {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (input.filter_severity) {
          params.push(input.filter_severity);
          conditions.push(`severity = $${params.length}`);
        }
        if (input.filter_agent_id) {
          params.push(input.filter_agent_id);
          conditions.push(`agent_id = $${params.length}`);
        }
        if (input.filter_category) {
          params.push(input.filter_category);
          conditions.push(`category = $${params.length}`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(input.limit || 20, 50);

        const result = await p.query(
          `SELECT id, agent_id, agent_name, finding, severity, category, execution_id, created_at
           FROM agent_findings ${where}
           ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 END, created_at DESC
           LIMIT ${limit}`,
          params,
        );

        return {
          output: { findings: result.rows, count: result.rows.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'get': {
        if (!input.finding_id) {
          return { output: null, error: 'finding_id is required for get', durationMs: 0 };
        }

        const result = await p.query(
          `SELECT * FROM agent_findings WHERE id = $1`,
          [input.finding_id],
        );

        if (result.rows.length === 0) {
          return { output: null, error: `Finding not found: ${input.finding_id}`, durationMs: Math.round(performance.now() - startTime) };
        }

        return {
          output: { finding: result.rows[0] },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: create, list, get`,
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
