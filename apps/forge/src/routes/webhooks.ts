/**
 * Forge Webhook Routes
 * Incoming webhook triggers for agent execution
 */

import { timingSafeEqual } from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { logAudit } from '../observability/audit.js';
import { checkGuardrails } from '../observability/guardrails.js';
import { runDirectCliExecution } from '../runtime/worker.js';

interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  status: string;
  max_cost_per_execution: string;
  metadata: Record<string, unknown>;
}

interface ExecutionRow {
  id: string;
  agent_id: string;
  session_id: string | null;
  owner_id: string;
  status: string;
  input: string;
  output: string | null;
  messages: unknown[];
  tool_calls: unknown[];
  iterations: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: string;
  duration_ms: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/webhooks/:agentId/trigger - Trigger an agent via webhook
   *
   * This endpoint can be called without standard auth if the agent has a webhook secret
   * configured in its metadata. Otherwise, it requires standard auth.
   */
  app.post(
    '/api/v1/forge/webhooks/:agentId/trigger',
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { agentId } = request.params as { agentId: string };
      const body = request.body as {
        input?: string;
        payload?: Record<string, unknown>;
        secret?: string;
      } | undefined;

      // Load the agent
      const agent = await queryOne<AgentRow>(
        `SELECT id, owner_id, name, status, max_cost_per_execution, metadata
         FROM forge_agents WHERE id = $1`,
        [agentId],
      );

      if (!agent) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Agent not found',
        });
      }

      if (agent.status === 'archived') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Cannot trigger an archived agent',
        });
      }

      // Verify webhook secret if configured
      const webhookSecret = agent.metadata['webhookSecret'] as string | undefined;
      if (webhookSecret) {
        const providedSecret = String(body?.secret ?? request.headers['x-webhook-secret'] ?? '');
        const expected = Buffer.from(webhookSecret);
        const provided = Buffer.from(providedSecret);
        if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
          return reply.status(401).send({
            error: 'Unauthorized',
            message: 'Invalid webhook secret',
          });
        }
      } else {
        // If no webhook secret is configured, require that the agent allows public webhooks
        const allowWebhooks = agent.metadata['allowWebhooks'] as boolean | undefined;
        if (!allowWebhooks) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'This agent does not accept webhook triggers. Configure webhookSecret or set allowWebhooks in agent metadata.',
          });
        }
      }

      // Build the input text from the request
      const inputText = body?.input ?? JSON.stringify(body?.payload ?? {});

      if (!inputText || inputText === '{}') {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'input or payload is required',
        });
      }

      // Run guardrail checks
      const guardrailResult = await checkGuardrails({
        ownerId: agent.owner_id,
        agentId: agent.id,
        input: inputText,
        estimatedCost: parseFloat(agent.max_cost_per_execution),
      });

      if (!guardrailResult.allowed) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: guardrailResult.reason ?? 'Blocked by guardrails',
        });
      }

      const executionId = ulid();

      const execution = await queryOne<ExecutionRow>(
        `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, NOW())
         RETURNING *`,
        [
          executionId,
          agent.id,
          agent.owner_id,
          inputText,
          JSON.stringify({
            source: 'webhook',
            triggeredAt: new Date().toISOString(),
            remoteIp: request.ip,
          }),
        ],
      );

      void logAudit({
        ownerId: agent.owner_id,
        action: 'webhook.trigger',
        resourceType: 'execution',
        resourceId: executionId,
        details: { agentId: agent.id, agentName: agent.name, source: 'webhook' },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch(() => {});

      // Dispatch the execution to the CLI runtime asynchronously
      void runDirectCliExecution(executionId, agent.id, inputText, agent.owner_id, {
        maxBudgetUsd: agent.max_cost_per_execution,
      }).catch((err) => {
        console.error(`[Webhook] Execution ${executionId} failed:`, err instanceof Error ? err.message : err);
      });

      return reply.status(201).send({
        executionId: execution?.id,
        agentId: agent.id,
        status: 'running',
        message: 'Webhook trigger accepted. Execution has been dispatched.',
      });
    },
  );
}
