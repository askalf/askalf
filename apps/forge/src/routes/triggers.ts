/**
 * Trigger Routes — CRUD for agent triggers + webhook endpoint.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../database.js';
import { getTriggerEngine } from '../runtime/trigger-engine.js';
import { authMiddleware } from '../middleware/auth.js';
import { ulid } from 'ulid';

export async function triggerRoutes(app: FastifyInstance): Promise<void> {
  // ---- List triggers for an agent ----
  app.get(
    '/api/v1/forge/agents/:agentId/triggers',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      const triggers = await query<Record<string, unknown>>(
        `SELECT * FROM forge_agent_triggers WHERE agent_id = $1 ORDER BY priority ASC, created_at DESC`,
        [agentId],
      );

      return reply.send({ triggers });
    },
  );

  // ---- Create trigger ----
  app.post(
    '/api/v1/forge/agents/:agentId/triggers',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const body = request.body as {
        trigger_type: string;
        config?: Record<string, unknown>;
        prompt_template?: string;
        cooldown_minutes?: number;
        max_fires_per_hour?: number;
        priority?: number;
      };

      const validTypes = ['event', 'schedule', 'webhook', 'state_change', 'message', 'goal_progress'];
      if (!validTypes.includes(body.trigger_type)) {
        return reply.code(400).send({ error: `Invalid trigger_type. Must be one of: ${validTypes.join(', ')}` });
      }

      const id = ulid();
      await query(
        `INSERT INTO forge_agent_triggers (id, agent_id, trigger_type, config, prompt_template, cooldown_minutes, max_fires_per_hour, priority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id, agentId, body.trigger_type,
          JSON.stringify(body.config ?? {}),
          body.prompt_template ?? null,
          body.cooldown_minutes ?? 5,
          body.max_fires_per_hour ?? 10,
          body.priority ?? 5,
        ],
      );

      return reply.code(201).send({ trigger: { id, agent_id: agentId, ...body } });
    },
  );

  // ---- Update trigger ----
  app.put(
    '/api/v1/forge/triggers/:triggerId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { triggerId } = request.params as { triggerId: string };
      const body = request.body as {
        config?: Record<string, unknown>;
        prompt_template?: string;
        cooldown_minutes?: number;
        max_fires_per_hour?: number;
        priority?: number;
        enabled?: boolean;
      };

      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      if (body.config !== undefined) {
        sets.push(`config = $${idx++}`);
        params.push(JSON.stringify(body.config));
      }
      if (body.prompt_template !== undefined) {
        sets.push(`prompt_template = $${idx++}`);
        params.push(body.prompt_template);
      }
      if (body.cooldown_minutes !== undefined) {
        sets.push(`cooldown_minutes = $${idx++}`);
        params.push(body.cooldown_minutes);
      }
      if (body.max_fires_per_hour !== undefined) {
        sets.push(`max_fires_per_hour = $${idx++}`);
        params.push(body.max_fires_per_hour);
      }
      if (body.priority !== undefined) {
        sets.push(`priority = $${idx++}`);
        params.push(body.priority);
      }
      if (body.enabled !== undefined) {
        sets.push(`enabled = $${idx++}`);
        params.push(body.enabled);
      }

      if (sets.length === 0) {
        return reply.code(400).send({ error: 'No fields to update' });
      }

      params.push(triggerId);
      const result = await query(
        `UPDATE forge_agent_triggers SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        params,
      );

      if (result.length === 0) {
        return reply.code(404).send({ error: 'Trigger not found' });
      }

      return reply.send({ trigger: result[0] });
    },
  );

  // ---- Delete trigger ----
  app.delete(
    '/api/v1/forge/triggers/:triggerId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { triggerId } = request.params as { triggerId: string };

      const result = await query(
        `DELETE FROM forge_agent_triggers WHERE id = $1 RETURNING id`,
        [triggerId],
      );

      if (result.length === 0) {
        return reply.code(404).send({ error: 'Trigger not found' });
      }

      return reply.send({ deleted: true, triggerId });
    },
  );

  // ---- Webhook endpoint (public, verified by secret) ----
  app.post(
    '/api/v1/webhooks/agent/:triggerId',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { triggerId } = request.params as { triggerId: string };
      const engine = getTriggerEngine();
      if (!engine) {
        return reply.code(503).send({ error: 'Trigger engine not initialized' });
      }

      const fired = await engine.evaluateWebhookTrigger(triggerId, (request.body ?? {}) as Record<string, unknown>);
      if (!fired) {
        return reply.code(404).send({ error: 'Trigger not found, disabled, or rate-limited' });
      }

      return reply.send({ fired: true, triggerId });
    },
  );
}
