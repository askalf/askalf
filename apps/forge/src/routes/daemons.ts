/**
 * Daemon Routes — REST API for managing agent dispatch.
 * Uses the unified dispatcher (replaces old DaemonManager).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../database.js';
import { getDispatcher } from '../runtime/unified-dispatcher.js';
import { authMiddleware } from '../middleware/auth.js';

export async function daemonRoutes(app: FastifyInstance): Promise<void> {
  // ---- Dispatcher status ----
  app.get(
    '/api/v1/forge/daemons',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const dispatcher = getDispatcher();
      if (!dispatcher) {
        return reply.code(503).send({ error: 'Dispatcher not initialized' });
      }

      const status = dispatcher.getStatus();

      // Return agent dispatch info from DB
      const agents = await query<Record<string, unknown>>(
        `SELECT a.id AS agent_id, a.name AS agent_name, a.status, a.dispatch_enabled,
                a.dispatch_mode, a.schedule_interval_minutes, a.next_run_at, a.last_run_at
         FROM forge_agents a
         WHERE a.is_internal = true
         ORDER BY a.name`,
      );

      return reply.send({
        daemons: agents,
        dispatcher_status: status,
        active_count: agents.filter(a => a['dispatch_enabled']).length,
        total: agents.length,
      });
    },
  );

  // ---- Get dispatch info for a specific agent ----
  app.get(
    '/api/v1/forge/daemons/:agentId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      const agents = await query<Record<string, unknown>>(
        `SELECT a.id AS agent_id, a.name AS agent_name, a.status, a.dispatch_enabled,
                a.dispatch_mode, a.schedule_interval_minutes, a.next_run_at, a.last_run_at
         FROM forge_agents a WHERE a.id = $1`,
        [agentId],
      );

      if (agents.length === 0) {
        return reply.code(404).send({ error: 'Agent not found' });
      }

      return reply.send({ daemon: agents[0] });
    },
  );

  // ---- Enable dispatch for agent ----
  app.post(
    '/api/v1/forge/daemons/:agentId/start',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      await query(
        `UPDATE forge_agents SET dispatch_enabled = true WHERE id = $1`,
        [agentId],
      );

      return reply.send({ status: 'enabled', agentId });
    },
  );

  // ---- Disable dispatch for agent ----
  app.post(
    '/api/v1/forge/daemons/:agentId/stop',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      await query(
        `UPDATE forge_agents SET dispatch_enabled = false WHERE id = $1`,
        [agentId],
      );

      return reply.send({ status: 'disabled', agentId });
    },
  );

  // ---- Pause dispatch (same as stop) ----
  app.post(
    '/api/v1/forge/daemons/:agentId/pause',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      await query(
        `UPDATE forge_agents SET dispatch_enabled = false WHERE id = $1`,
        [agentId],
      );

      return reply.send({ status: 'paused', agentId });
    },
  );

  // ---- Resume dispatch ----
  app.post(
    '/api/v1/forge/daemons/:agentId/resume',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };

      await query(
        `UPDATE forge_agents SET dispatch_enabled = true WHERE id = $1`,
        [agentId],
      );

      return reply.send({ status: 'resumed', agentId });
    },
  );

  // ---- Wake agent (queue reactive work via dispatcher) ----
  app.post(
    '/api/v1/forge/daemons/:agentId/wake',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const body = (request.body ?? {}) as { context?: Record<string, unknown> };
      const dispatcher = getDispatcher();
      if (!dispatcher) {
        return reply.code(503).send({ error: 'Dispatcher not initialized' });
      }

      dispatcher.queueWork(agentId, body.context ?? {});
      return reply.send({ status: 'queued', agentId });
    },
  );
}
