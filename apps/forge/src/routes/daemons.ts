/**
 * Daemon Routes — REST API for managing agent daemons.
 * GET/POST daemons, start/stop/pause/resume per agent.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../database.js';
import { getDaemonManager } from '../runtime/daemon-manager.js';
import { authMiddleware } from '../middleware/auth.js';

export async function daemonRoutes(app: FastifyInstance): Promise<void> {
  // ---- List all daemons ----
  app.get(
    '/api/v1/forge/daemons',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const manager = getDaemonManager();
      if (!manager) {
        return reply.code(503).send({ error: 'Daemon manager not initialized' });
      }

      const qs = request.query as { limit?: string; offset?: string };
      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '50', 10) || 50, 200));
      const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);

      const [dbDaemons, countResult] = await Promise.all([
        query<Record<string, unknown>>(
          `SELECT d.*, a.name AS agent_name FROM forge_agent_daemons d
           JOIN forge_agents a ON a.id = d.agent_id
           ORDER BY d.updated_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM forge_agent_daemons`,
        ),
      ]);

      const total = parseInt(countResult[0]?.count ?? '0', 10);

      return reply.send({
        daemons: dbDaemons.map((d) => {
          const inMemory = manager.getDaemon(d['agent_id'] as string);
          return {
            ...d,
            live_status: inMemory?.getStatus() ?? d['status'],
            tick_number: inMemory?.getTickNumber() ?? 0,
          };
        }),
        active_count: manager.getActiveDaemonCount(),
        total,
        limit,
        offset,
      });
    },
  );

  // ---- Get daemon for a specific agent ----
  app.get(
    '/api/v1/forge/daemons/:agentId',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const manager = getDaemonManager();
      if (!manager) {
        return reply.code(503).send({ error: 'Daemon manager not initialized' });
      }

      const daemon = manager.getDaemon(agentId);
      if (daemon) {
        return reply.send({ daemon: daemon.getInfo() });
      }

      const dbDaemon = await query<Record<string, unknown>>(
        `SELECT d.*, a.name AS agent_name FROM forge_agent_daemons d
         JOIN forge_agents a ON a.id = d.agent_id
         WHERE d.agent_id = $1`,
        [agentId],
      );
      if (dbDaemon.length === 0) {
        return reply.code(404).send({ error: 'No daemon found for agent' });
      }

      return reply.send({ daemon: dbDaemon[0] });
    },
  );

  // ---- Start daemon ----
  app.post(
    '/api/v1/forge/daemons/:agentId/start',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const manager = getDaemonManager();
      if (!manager) {
        return reply.code(503).send({ error: 'Daemon manager not initialized' });
      }

      try {
        const daemon = await manager.startDaemon(agentId);
        return reply.send({ status: 'started', daemon: daemon.getInfo() });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ---- Stop daemon ----
  app.post(
    '/api/v1/forge/daemons/:agentId/stop',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const manager = getDaemonManager();
      if (!manager) {
        return reply.code(503).send({ error: 'Daemon manager not initialized' });
      }

      await manager.stopDaemon(agentId);
      return reply.send({ status: 'stopped', agentId });
    },
  );

  // ---- Pause daemon ----
  app.post(
    '/api/v1/forge/daemons/:agentId/pause',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const manager = getDaemonManager();
      if (!manager) {
        return reply.code(503).send({ error: 'Daemon manager not initialized' });
      }

      try {
        await manager.pauseDaemon(agentId);
        return reply.send({ status: 'paused', agentId });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ---- Resume daemon ----
  app.post(
    '/api/v1/forge/daemons/:agentId/resume',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const manager = getDaemonManager();
      if (!manager) {
        return reply.code(503).send({ error: 'Daemon manager not initialized' });
      }

      try {
        await manager.resumeDaemon(agentId);
        return reply.send({ status: 'resumed', agentId });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );

  // ---- Wake daemon (used by triggers) ----
  app.post(
    '/api/v1/forge/daemons/:agentId/wake',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const body = (request.body ?? {}) as { context?: Record<string, unknown> };
      const manager = getDaemonManager();
      if (!manager) {
        return reply.code(503).send({ error: 'Daemon manager not initialized' });
      }

      try {
        await manager.wakeDaemon(agentId, body.context);
        const daemon = manager.getDaemon(agentId);
        return reply.send({ status: 'awake', daemon: daemon?.getInfo() ?? { agentId, status: 'unknown' } });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    },
  );
}
