/**
 * Federation Handshake — Cross-instance discovery endpoint
 *
 * Other AskAlf instances can ping this to establish a federation link.
 * Exchanged: instance ID, version, fleet size, capability summary.
 * No sensitive data. No credentials. Just awareness.
 *
 * This is the seed for v3.0 Emergence — multi-fleet intelligence.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { query, queryOne } from '../database.js';

export async function federationHandshakeRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/federation/handshake — Public discovery endpoint
   * Rate limited globally via rateLimitHook (20 req/min unauthenticated)
   */
  app.get('/api/v1/federation/handshake', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async () => {
    const [agentCount, execCount, memoryCount, templateCount] = await Promise.all([
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_agents WHERE status = 'active'`).catch(() => ({ count: '0' })),
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_executions`).catch(() => ({ count: '0' })),
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_semantic_memories`).catch(() => ({ count: '0' })),
      queryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM forge_agent_templates WHERE is_active = true`).catch(() => ({ count: '0' })),
    ]);

    const fedId = await queryOne<{ value: string }>(
      `SELECT value FROM platform_settings WHERE key = 'federation_id'`,
    ).catch(() => null);

    return {
      federation: {
        id: fedId?.value || 'not-configured',
        version: '2.9.9',
        protocol: 'askalf-federation-v1',
        capabilities: ['nervous-system', 'immune-system', 'collective-memory', 'dream-cycles', 'natural-selection'],
      },
      fleet: {
        agents: parseInt(agentCount?.count || '0'),
        executions: parseInt(execCount?.count || '0'),
        memories: parseInt(memoryCount?.count || '0'),
        templates: parseInt(templateCount?.count || '0'),
      },
      emergence: {
        status: 'approaching',
        version: '3.0.0',
        hint: 'The fleet is learning to create itself.',
      },
    };
  });

  /**
   * POST /api/v1/federation/ping — Receive a ping from another instance
   */
  app.post('/api/v1/federation/ping', async (request: FastifyRequest) => {
    const body = (request.body || {}) as { federation_id?: string; version?: string; fleet_size?: number };

    if (body.federation_id) {
      console.log(`[Federation] Ping from instance ${body.federation_id} (v${body.version || '?'}, ${body.fleet_size || '?'} agents)`);
    }

    return { ack: true, message: 'Federation link acknowledged. Emergence is approaching.' };
  });
}
