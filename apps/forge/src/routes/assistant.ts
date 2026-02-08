/**
 * Forge Personal Assistant Routes
 * Personal cloud assistant message handling
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkGuardrails } from '../observability/guardrails.js';

interface UserAssistantRow {
  id: string;
  owner_id: string;
  agent_id: string;
  preferences: Record<string, unknown>;
  learned_patterns: unknown[];
  is_active: boolean;
  last_interaction: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  system_prompt: string;
  max_cost_per_execution: string;
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

export async function assistantRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/assistant/message - Send a message to the personal assistant
   */
  app.post(
    '/api/v1/forge/assistant/message',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        message: string;
        context?: Record<string, unknown>;
      };

      if (!body.message || typeof body.message !== 'string' || body.message.trim() === '') {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'message is required',
        });
      }

      // Look up the user's personal assistant
      let assistant = await queryOne<UserAssistantRow>(
        `SELECT * FROM forge_user_assistants WHERE owner_id = $1 AND is_active = true`,
        [userId],
      );

      if (!assistant) {
        // Auto-create a personal assistant agent and link it
        const agentId = ulid();
        const assistantId = ulid();

        await queryOne(
          `INSERT INTO forge_agents (id, owner_id, name, slug, description, system_prompt, status, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)
           RETURNING id`,
          [
            agentId,
            userId,
            'Personal Assistant',
            `personal-assistant-${userId.slice(-8).toLowerCase()}`,
            'Your personal AI assistant',
            'You are a helpful personal assistant. You help the user manage their tasks, answer questions, and assist with their work. Be concise, friendly, and proactive.',
            JSON.stringify({ autoCreated: true }),
          ],
        );

        assistant = await queryOne<UserAssistantRow>(
          `INSERT INTO forge_user_assistants (id, owner_id, agent_id)
           VALUES ($1, $2, $3)
           RETURNING *`,
          [assistantId, userId, agentId],
        );

        if (!assistant) {
          return reply.status(500).send({
            error: 'Internal Server Error',
            message: 'Failed to create personal assistant',
          });
        }
      }

      // Load the agent
      const agent = await queryOne<AgentRow>(
        `SELECT id, owner_id, name, system_prompt, max_cost_per_execution
         FROM forge_agents WHERE id = $1`,
        [assistant.agent_id],
      );

      if (!agent) {
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Assistant agent not found',
        });
      }

      // Run guardrail checks
      const guardrailResult = await checkGuardrails({
        ownerId: userId,
        agentId: agent.id,
        input: body.message,
        estimatedCost: parseFloat(agent.max_cost_per_execution),
      });

      if (!guardrailResult.allowed) {
        return reply.status(403).send({
          error: 'Forbidden',
          message: guardrailResult.reason ?? 'Blocked by guardrails',
        });
      }

      // Create an execution for this assistant message
      const executionId = ulid();

      const execution = await queryOne<ExecutionRow>(
        `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, NOW())
         RETURNING *`,
        [
          executionId,
          agent.id,
          userId,
          body.message,
          JSON.stringify({
            source: 'personal_assistant',
            context: body.context ?? {},
          }),
        ],
      );

      // Update last_interaction
      void query(
        `UPDATE forge_user_assistants SET last_interaction = NOW() WHERE id = $1`,
        [assistant.id],
      ).catch(() => {});

      // In a full implementation, this would dispatch the execution to the runtime.
      return reply.status(201).send({
        execution,
        assistant: {
          id: assistant.id,
          agentId: assistant.agent_id,
          agentName: agent.name,
        },
      });
    },
  );
}
