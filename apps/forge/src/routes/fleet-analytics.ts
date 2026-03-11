/**
 * Fleet Analytics Routes
 * Provides execution heatmap data for the fleet dashboard.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface HeatmapCell {
  agent: string;
  day: string;
  hour: number;
  count: number;
  failures: number;
}

interface HeatmapRow {
  agent_name: string;
  day: string;
  hour: number;
  total: string;
  failed: string;
}

export async function fleetAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/fleet/analytics — execution heatmap data
   */
  app.get(
    '/api/v1/forge/fleet/analytics',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const { days } = request.query as { days?: string };
        const lookbackDays = Math.min(Math.max(parseInt(days ?? '14', 10) || 14, 1), 90);

        const rows = await query<HeatmapRow>(
          `SELECT
             a.name AS agent_name,
             TO_CHAR(e.started_at::date, 'YYYY-MM-DD') AS day,
             EXTRACT(HOUR FROM e.started_at)::int AS hour,
             COUNT(*)::text AS total,
             COUNT(*) FILTER (WHERE e.status IN ('failed', 'timeout'))::text AS failed
           FROM forge_executions e
           JOIN forge_agents a ON a.id = e.agent_id
           WHERE e.started_at >= NOW() - ($1 || ' days')::INTERVAL
           GROUP BY a.name, e.started_at::date, EXTRACT(HOUR FROM e.started_at)
           ORDER BY day, hour`,
          [String(lookbackDays)],
        );

        const heatmap: HeatmapCell[] = rows.map((r) => ({
          agent: r.agent_name,
          day: r.day,
          hour: r.hour,
          count: parseInt(r.total, 10),
          failures: parseInt(r.failed, 10),
        }));

        const agents = [...new Set(rows.map((r) => r.agent_name))].sort();

        return reply.send({ heatmap, agents });
      } catch (err) {
        request.log.error(err, 'Failed to fetch fleet analytics');
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}
