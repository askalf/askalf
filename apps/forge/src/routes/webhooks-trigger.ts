/**
 * Webhook Triggers — External events fire agent executions
 *
 * GitHub push → run Builder
 * GitHub issue → run GitHub Manager
 * Discord message → run Discord Manager
 * Custom webhook → run any agent
 * Cron expression → scheduled triggers
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { rateLimitHook as rateLimiter } from '../middleware/rate-limit.js';
import { createHmac } from 'crypto';

interface TriggerConfig {
  id: string;
  name: string;
  event_type: string;      // github_push, github_issue, discord_message, custom, cron
  agent_id: string | null;  // specific agent, or null = auto-route
  agent_name: string | null;
  filter: Record<string, unknown>;  // e.g. { branch: "main", repo: "askalf/askalf" }
  secret: string;
  is_enabled: boolean;
  execution_count: number;
  last_fired_at: string | null;
  created_at: string;
}

function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
  return signature === expected;
}

export async function webhookTriggerRoutes(app: FastifyInstance): Promise<void> {

  /**
   * POST /api/v1/forge/webhooks/trigger/:id — Fire a webhook trigger
   * No auth required — verified by secret/signature
   */
  app.post(
    '/api/v1/forge/webhooks/trigger/:id', { preHandler: [rateLimiter] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const rawBody = JSON.stringify(request.body);

      const trigger = await queryOne<TriggerConfig>(
        `SELECT * FROM webhook_triggers WHERE id = $1 AND is_enabled = true`,
        [id],
      );

      if (!trigger) return reply.status(404).send({ error: 'Trigger not found or disabled' });

      // Verify signature for GitHub webhooks
      if (trigger.event_type.startsWith('github_')) {
        const sig = request.headers['x-hub-signature-256'] as string;
        if (!sig || !verifyGitHubSignature(rawBody, sig, trigger.secret)) {
          return reply.status(401).send({ error: 'Invalid signature' });
        }
      }

      // Verify secret for custom webhooks
      if (trigger.event_type === 'custom') {
        const providedSecret = request.headers['x-webhook-secret'] as string || (request.body as Record<string, unknown>)?.['secret'] as string;
        if (providedSecret !== trigger.secret) {
          return reply.status(401).send({ error: 'Invalid secret' });
        }
      }

      // Parse the event
      const body = request.body as Record<string, unknown>;
      const eventInput = buildEventInput(trigger.event_type, body);

      // Find the agent to dispatch to
      let agentId = trigger.agent_id;
      if (!agentId && trigger.agent_name) {
        const agent = await queryOne<{ id: string }>(
          `SELECT id FROM forge_agents WHERE name = $1 AND status = 'active'`,
          [trigger.agent_name],
        );
        agentId = agent?.id || null;
      }
      if (!agentId) {
        agentId = await autoRouteEvent(trigger.event_type, body);
      }

      if (!agentId) return reply.status(400).send({ error: 'No agent found to handle this event' });

      // Create execution
      const execId = ulid();
      await query(
        `INSERT INTO forge_executions (id, agent_id, owner_id, tenant_id, input, status, metadata, started_at)
         VALUES ($1, $2, 'selfhosted-admin', 'selfhosted', $3, 'pending', $4, NOW())`,
        [
          execId, agentId, eventInput,
          JSON.stringify({ source: 'webhook_trigger', trigger_id: id, event_type: trigger.event_type }),
        ],
      );

      // Update trigger stats
      await query(
        `UPDATE webhook_triggers SET execution_count = execution_count + 1, last_fired_at = NOW() WHERE id = $1`,
        [id],
      );

      console.log(`[WebhookTrigger] Fired: ${trigger.name} (${trigger.event_type}) → agent ${agentId} exec ${execId}`);

      return reply.status(202).send({ execution_id: execId, agent_id: agentId, trigger: trigger.name });
    },
  );

  /**
   * CRUD for webhook triggers (auth required)
   */
  app.get('/api/v1/forge/webhook-triggers', { preHandler: [rateLimiter, authMiddleware] }, async () => {
    const triggers = await query<TriggerConfig>(`SELECT * FROM webhook_triggers ORDER BY created_at DESC`);
    return { triggers };
  });

  app.post('/api/v1/forge/webhook-triggers', { preHandler: [rateLimiter, authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as { name: string; event_type: string; agent_name?: string; filter?: Record<string, unknown> };
    if (!body.name || !body.event_type) return reply.status(400).send({ error: 'name and event_type required' });

    const id = ulid();
    const secret = ulid() + ulid(); // Long random secret

    const trigger = await queryOne(
      `INSERT INTO webhook_triggers (id, name, event_type, agent_name, filter, secret, is_enabled)
       VALUES ($1, $2, $3, $4, $5, $6, true) RETURNING *`,
      [id, body.name, body.event_type, body.agent_name || null, JSON.stringify(body.filter || {}), secret],
    );

    return reply.status(201).send({
      trigger,
      webhook_url: `/api/v1/forge/webhooks/trigger/${id}`,
      secret,
    });
  });

  app.delete('/api/v1/forge/webhook-triggers/:id', { preHandler: [rateLimiter, authMiddleware] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    await query(`DELETE FROM webhook_triggers WHERE id = $1`, [id]);
    return reply.status(204).send();
  });
}

function buildEventInput(eventType: string, body: Record<string, unknown>): string {
  switch (eventType) {
    case 'github_push': {
      const commits = (body['commits'] as Array<{ message: string }>) || [];
      const branch = String(body['ref'] || '').replace('refs/heads/', '');
      const repo = (body['repository'] as Record<string, unknown>)?.['full_name'] || 'unknown';
      return `GitHub push to ${repo}/${branch}: ${commits.length} commit(s).\n${commits.slice(0, 5).map(c => `- ${c.message}`).join('\n')}`;
    }
    case 'github_issue': {
      const action = body['action'] as string;
      const issue = body['issue'] as Record<string, unknown>;
      return `GitHub issue ${action}: #${issue?.['number']} "${issue?.['title']}"\n${String(issue?.['body'] || '').substring(0, 300)}`;
    }
    case 'github_pr': {
      const action = body['action'] as string;
      const pr = body['pull_request'] as Record<string, unknown>;
      return `GitHub PR ${action}: #${pr?.['number']} "${pr?.['title']}"\n${String(pr?.['body'] || '').substring(0, 300)}`;
    }
    case 'discord_message': {
      return `Discord message: ${JSON.stringify(body).substring(0, 500)}`;
    }
    default:
      return `Webhook event (${eventType}): ${JSON.stringify(body).substring(0, 500)}`;
  }
}

async function autoRouteEvent(eventType: string, body: Record<string, unknown>): Promise<string | null> {
  const routeMap: Record<string, string> = {
    'github_push': 'Builder',
    'github_issue': 'AskAlf GitHub Manager',
    'github_pr': 'Builder',
    'discord_message': 'AskAlf Discord Manager',
  };

  const agentName = routeMap[eventType];
  if (!agentName) return null;

  const agent = await queryOne<{ id: string }>(
    `SELECT id FROM forge_agents WHERE name = $1 AND status = 'active'`,
    [agentName],
  );
  return agent?.id || null;
}
