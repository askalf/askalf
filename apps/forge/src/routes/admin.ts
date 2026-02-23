/**
 * Forge Admin Routes
 * Cost tracking, audit logs, and guardrail management
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { getCostSummary, getDailyCosts } from '../observability/cost-tracker.js';
import { getAuditLog, logAudit } from '../observability/audit.js';

interface GuardrailRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  type: string;
  config: Record<string, unknown>;
  is_enabled: boolean;
  is_global: boolean;
  agent_ids: string[];
  priority: number;
  created_at: string;
  updated_at: string;
}

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/admin/costs - Cost tracking summary
   */
  app.get(
    '/api/v1/forge/admin/costs',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as {
        startDate?: string;
        endDate?: string;
        agentId?: string;
        days?: string;
      };

      const [summary, dailyCosts] = await Promise.all([
        getCostSummary(userId, {
          startDate: qs.startDate,
          endDate: qs.endDate,
          agentId: qs.agentId,
        }),
        getDailyCosts(userId, parseInt(qs.days ?? '30', 10) || 30),
      ]);

      return reply.send({ summary, dailyCosts });
    },
  );

  /**
   * GET /api/v1/forge/admin/audit - Audit log
   */
  app.get(
    '/api/v1/forge/admin/audit',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as {
        action?: string;
        resourceType?: string;
        limit?: string;
        offset?: string;
      };

      const result = await getAuditLog(userId, {
        action: qs.action,
        resourceType: qs.resourceType,
        limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
        offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
      });

      return reply.send({
        entries: result.entries,
        total: result.total,
        limit: qs.limit ? parseInt(qs.limit, 10) : 50,
        offset: qs.offset ? parseInt(qs.offset, 10) : 0,
      });
    },
  );

  /**
   * POST /api/v1/forge/admin/guardrails - Create or update a guardrail
   */
  app.post(
    '/api/v1/forge/admin/guardrails',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        id?: string;
        name: string;
        description?: string;
        type: string;
        config: Record<string, unknown>;
        isEnabled?: boolean;
        isGlobal?: boolean;
        agentIds?: string[];
        priority?: number;
      };

      if (!body.name || !body.type || !body.config) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'name, type, and config are required',
        });
      }

      const validTypes = ['content_filter', 'cost_limit', 'rate_limit', 'tool_restriction', 'output_filter', 'custom'];
      if (!validTypes.includes(body.type)) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: `type must be one of: ${validTypes.join(', ')}`,
        });
      }

      if (body.id) {
        // Update existing guardrail
        const existing = await queryOne<GuardrailRow>(
          `SELECT id FROM forge_guardrails WHERE id = $1 AND owner_id = $2`,
          [body.id, userId],
        );

        if (!existing) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Guardrail not found or not owned by you',
          });
        }

        const guardrail = await queryOne<GuardrailRow>(
          `UPDATE forge_guardrails
           SET name = $1, description = $2, type = $3, config = $4,
               is_enabled = $5, is_global = $6, agent_ids = $7, priority = $8
           WHERE id = $9
           RETURNING *`,
          [
            body.name,
            body.description ?? null,
            body.type,
            JSON.stringify(body.config),
            body.isEnabled ?? true,
            body.isGlobal ?? false,
            body.agentIds ?? [],
            body.priority ?? 100,
            body.id,
          ],
        );

        void logAudit({
          ownerId: userId,
          action: 'guardrail.update',
          resourceType: 'guardrail',
          resourceId: body.id,
          details: { name: body.name, type: body.type },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.send({ guardrail });
      } else {
        // Create new guardrail
        const id = ulid();

        const guardrail = await queryOne<GuardrailRow>(
          `INSERT INTO forge_guardrails (id, owner_id, name, description, type, config, is_enabled, is_global, agent_ids, priority)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            id,
            userId,
            body.name,
            body.description ?? null,
            body.type,
            JSON.stringify(body.config),
            body.isEnabled ?? true,
            body.isGlobal ?? false,
            body.agentIds ?? [],
            body.priority ?? 100,
          ],
        );

        void logAudit({
          ownerId: userId,
          action: 'guardrail.create',
          resourceType: 'guardrail',
          resourceId: id,
          details: { name: body.name, type: body.type },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.status(201).send({ guardrail });
      }
    },
  );

  /**
   * GET /api/v1/forge/admin/guardrails - List guardrails for the owner
   */
  app.get(
    '/api/v1/forge/admin/guardrails',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const guardrails = await query<GuardrailRow>(
        `SELECT * FROM forge_guardrails
         WHERE owner_id = $1 OR is_global = true
         ORDER BY priority ASC, created_at DESC`,
        [userId],
      );

      return reply.send({ guardrails });
    },
  );

  /**
   * PATCH /api/v1/forge/admin/guardrails/:id - Toggle or update a guardrail
   */
  app.patch(
    '/api/v1/forge/admin/guardrails/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };
      const body = request.body as { is_enabled?: boolean; config?: Record<string, unknown>; priority?: number } | undefined;

      if (!body) {
        return reply.status(400).send({ error: 'Request body required' });
      }

      const setClauses: string[] = ['updated_at = NOW()'];
      const params: unknown[] = [];

      if (body.is_enabled !== undefined) {
        params.push(body.is_enabled);
        setClauses.push(`is_enabled = $${params.length}`);
      }
      if (body.config !== undefined) {
        params.push(JSON.stringify(body.config));
        setClauses.push(`config = $${params.length}`);
      }
      if (body.priority !== undefined) {
        params.push(body.priority);
        setClauses.push(`priority = $${params.length}`);
      }

      if (params.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }

      params.push(id, userId);
      const result = await query<GuardrailRow>(
        `UPDATE forge_guardrails SET ${setClauses.join(', ')} WHERE id = $${params.length - 1} AND owner_id = $${params.length} RETURNING *`,
        params,
      );

      if (result.length === 0) {
        return reply.status(404).send({ error: 'Guardrail not found' });
      }

      return reply.send({ guardrail: result[0] });
    },
  );

  /**
   * DELETE /api/v1/forge/admin/guardrails/:id - Delete a guardrail
   */
  app.delete(
    '/api/v1/forge/admin/guardrails/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const deleted = await query(
        `DELETE FROM forge_guardrails WHERE id = $1 AND owner_id = $2 AND is_global = false RETURNING id`,
        [id, userId],
      );

      if (deleted.length === 0) {
        return reply.status(404).send({ error: 'Guardrail not found or cannot delete global guardrails' });
      }

      return reply.send({ success: true, deleted: id });
    },
  );

  /**
   * GET /api/v1/forge/user/export - GDPR user data export
   * Returns all user data as a downloadable JSON file.
   */
  app.get(
    '/api/v1/forge/user/export',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;

      const [profile, apiKeys, usageHistory, activityLog] = await Promise.all([
        queryOne<Record<string, unknown>>(
          `SELECT id, email, display_name, role, status, timezone, created_at, last_login_at
           FROM users WHERE id = $1`,
          [userId],
        ),
        query<{
          id: string; name: string; key_prefix: string;
          permissions: string[]; last_used_at: string | null;
          expires_at: string | null; is_active: boolean; created_at: string;
        }>(
          `SELECT id, name, key_prefix, permissions, last_used_at, expires_at, is_active, created_at
           FROM forge_api_keys WHERE owner_id = $1 ORDER BY created_at DESC`,
          [userId],
        ),
        query<{ id: string; agent_id: string; input: string; status: string; cost: string | null; started_at: string }>(
          `SELECT id, agent_id, input, status, cost, started_at
           FROM forge_executions WHERE owner_id = $1
           ORDER BY started_at DESC LIMIT 200`,
          [userId],
        ),
        query<{ id: string; action: string; resource_type: string | null; ip_address: string | null; created_at: string }>(
          `SELECT id, action, resource_type, ip_address, created_at
           FROM audit_logs WHERE user_id = $1
           ORDER BY created_at DESC LIMIT 500`,
          [userId],
        ),
      ]);

      const exportData = {
        exported_at: new Date().toISOString(),
        user_id: userId,
        profile,
        api_keys: apiKeys.map((k) => ({ ...k, key_prefix: `${k.key_prefix}...` })),
        usage_history: usageHistory,
        activity_log: activityLog,
      };

      void reply.header('Content-Type', 'application/json');
      void reply.header('Content-Disposition', `attachment; filename="user-export-${userId}-${Date.now()}.json"`);
      return reply.send(exportData);
    },
  );

  /**
   * GET /api/v1/forge/admin/deployment-logs - Last 50 deployment log entries
   */
  app.get(
    '/api/v1/forge/admin/deployment-logs',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const rows = await query<{
        id: string;
        service: string;
        action: string;
        status: string;
        health_result: Record<string, unknown> | null;
        latency_ms: number | null;
        agent_name: string | null;
        created_at: string;
      }>(
        `SELECT id, service, action, status, health_result, latency_ms, agent_name, created_at
         FROM deployment_logs
         ORDER BY created_at DESC
         LIMIT 50`,
      );

      return reply.send({ logs: rows, count: rows.length });
    },
  );
}
