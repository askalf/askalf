/**
 * Built-in Tool: Intervention Operations
 * Allows agents to request human intervention when they encounter
 * decisions requiring approval, escalation, or human judgement.
 * Writes to agent_interventions in the substrate database.
 * All mutations are recorded in agent_audit_log (immutable trail).
 */

import pg from 'pg';
import crypto from 'crypto';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface InterventionOpsInput {
  action: 'create' | 'list' | 'get' | 'check';
  // create fields
  agent_id?: string;
  agent_name?: string;
  agent_type?: string;
  task_id?: string;
  type?: 'approval' | 'escalation' | 'feedback' | 'error' | 'resource';
  title?: string;
  description?: string;
  context?: string;
  proposed_action?: string;
  // get/check fields
  intervention_id?: string;
  // list filters
  filter_status?: string;
  filter_agent_id?: string;
  limit?: number;
}

// ============================================
// Connection Pool (reuse substrate pool)
// ============================================

let pool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['SUBSTRATE_DATABASE_URL'];
    if (!connectionString) {
      throw new Error('SUBSTRATE_DATABASE_URL not configured');
    }
    pool = new pg.Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return pool;
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

export async function interventionOps(input: InterventionOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    const p = getPool();

    switch (input.action) {
      case 'create': {
        if (!input.title) {
          return { output: null, error: 'title is required to create an intervention', durationMs: 0 };
        }
        if (!input.agent_name) {
          return { output: null, error: 'agent_name is required', durationMs: 0 };
        }

        const id = generateId();
        const interventionData = {
          id,
          agent_id: input.agent_id || 'unknown',
          agent_name: input.agent_name,
          agent_type: input.agent_type || 'custom',
          task_id: input.task_id || null,
          type: input.type || 'feedback',
          title: input.title,
          description: input.description || null,
          context: input.context || null,
          proposed_action: input.proposed_action || null,
          status: 'pending',
        };

        const result = await p.query(
          `INSERT INTO agent_interventions (id, agent_id, agent_name, agent_type, task_id, type, title, description, context, proposed_action, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending')
           RETURNING id, agent_name, type, title, status, created_at`,
          [
            interventionData.id,
            interventionData.agent_id,
            interventionData.agent_name,
            interventionData.agent_type,
            interventionData.task_id,
            interventionData.type,
            interventionData.title,
            interventionData.description,
            interventionData.context,
            interventionData.proposed_action,
          ],
        );

        await audit(p, 'intervention', id, 'created', input.agent_name, input.agent_id || null, {}, interventionData, input.task_id);

        return {
          output: { created: true, intervention: result.rows[0] },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'check': {
        // Check if a specific intervention has been responded to
        if (!input.intervention_id) {
          return { output: null, error: 'intervention_id is required for check', durationMs: 0 };
        }

        const result = await p.query(
          `SELECT id, status, human_response, responded_by, responded_at, autonomy_delta
           FROM agent_interventions WHERE id = $1`,
          [input.intervention_id],
        );

        if (result.rows.length === 0) {
          return { output: null, error: `Intervention not found: ${input.intervention_id}`, durationMs: Math.round(performance.now() - startTime) };
        }

        const row = result.rows[0];
        return {
          output: {
            id: row.id,
            status: row.status,
            resolved: row.status !== 'pending',
            human_response: row.human_response,
            responded_by: row.responded_by,
            responded_at: row.responded_at,
            autonomy_delta: row.autonomy_delta,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'list': {
        const conditions: string[] = [];
        const params: unknown[] = [];

        if (input.filter_status) {
          params.push(input.filter_status);
          conditions.push(`status = $${params.length}`);
        }
        if (input.filter_agent_id) {
          params.push(input.filter_agent_id);
          conditions.push(`agent_id = $${params.length}`);
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limit = Math.min(input.limit || 20, 50);

        const result = await p.query(
          `SELECT id, agent_id, agent_name, type, title, status, human_response, responded_at, created_at
           FROM agent_interventions ${where}
           ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'denied' THEN 2 WHEN 'resolved' THEN 3 END, created_at DESC
           LIMIT ${limit}`,
          params,
        );

        return {
          output: { interventions: result.rows, count: result.rows.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'get': {
        if (!input.intervention_id) {
          return { output: null, error: 'intervention_id is required for get', durationMs: 0 };
        }

        const result = await p.query(
          `SELECT * FROM agent_interventions WHERE id = $1`,
          [input.intervention_id],
        );

        if (result.rows.length === 0) {
          return { output: null, error: `Intervention not found: ${input.intervention_id}`, durationMs: Math.round(performance.now() - startTime) };
        }

        return {
          output: { intervention: result.rows[0] },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: create, list, get, check`,
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
