/**
 * Incident & Immune System Routes
 * View active incidents, antibodies, and incident history.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitHook as rateLimiter } from '../middleware/rate-limit.js';
import { getActiveIncidents, getIncidentStats, resolveIncident, recordAction } from '../orchestration/immune-system.js';
import { readSignalBoard } from '../orchestration/nervous-system.js';
import { getGraphStats } from '../orchestration/collective-memory.js';
import { query } from '../database.js';

export async function incidentRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/forge/incidents — Active incidents
   */
  app.get('/api/v1/forge/incidents', { preHandler: [rateLimiter, authMiddleware] }, async () => {
    const [incidents, stats] = await Promise.all([
      getActiveIncidents(),
      getIncidentStats(),
    ]);
    return { incidents, stats };
  });

  /**
   * GET /api/v1/forge/incidents/history — Resolved incidents
   */
  app.get('/api/v1/forge/incidents/history', { preHandler: [rateLimiter, authMiddleware] }, async (request: FastifyRequest) => {
    const qs = request.query as { limit?: string };
    const limit = Math.min(50, parseInt(qs.limit ?? '20'));
    const incidents = await query(
      `SELECT * FROM agent_incidents WHERE status IN ('resolved', 'immunized') ORDER BY resolved_at DESC LIMIT $1`,
      [limit],
    );
    return { incidents };
  });

  /**
   * POST /api/v1/forge/incidents/:id/resolve — Manually resolve an incident
   */
  app.post('/api/v1/forge/incidents/:id/resolve', { preHandler: [rateLimiter, authMiddleware] }, async (request: FastifyRequest) => {
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { resolution?: string };
    await resolveIncident(id, 'human', body.resolution || 'Manually resolved');
    return { resolved: true };
  });

  /**
   * GET /api/v1/forge/antibodies — List all antibodies (procedural memories)
   */
  app.get('/api/v1/forge/antibodies', { preHandler: [rateLimiter, authMiddleware] }, async () => {
    const antibodies = await query(
      `SELECT id, trigger_pattern, tool_sequence, success_count, confidence, created_at
       FROM forge_procedural_memories WHERE metadata->>'type' = 'antibody'
       ORDER BY confidence DESC, success_count DESC LIMIT 50`,
    );
    return { antibodies };
  });

  /**
   * GET /api/v1/forge/nervous-system — Fleet signal board + knowledge graph stats
   */
  app.get('/api/v1/forge/nervous-system', { preHandler: [rateLimiter, authMiddleware] }, async () => {
    const [signals, graphStats, incidentStats] = await Promise.all([
      Promise.resolve(readSignalBoard()),
      getGraphStats(),
      getIncidentStats(),
    ]);
    return { signals, knowledge_graph: graphStats, incidents: incidentStats };
  });
}
