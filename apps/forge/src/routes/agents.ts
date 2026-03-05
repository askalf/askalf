/**
 * Forge Agent Routes
 * CRUD operations for AI agents
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { Static } from '@sinclair/typebox';
import { ulid } from 'ulid';
import Anthropic from '@anthropic-ai/sdk';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../observability/audit.js';
import {
  CreateAgentBody, UpdateAgentBody, ListAgentsQuery,
  ForkAgentBody, OptimizePromptBody,
  IdParam, ErrorResponse,
} from './schemas.js';

interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  system_prompt: string;
  model_id: string | null;
  provider_config: Record<string, unknown>;
  autonomy_level: number;
  enabled_tools: string[];
  mcp_servers: unknown[];
  memory_config: Record<string, unknown>;
  max_iterations: number;
  max_tokens_per_turn: number;
  max_cost_per_execution: string;
  is_public: boolean;
  is_template: boolean;
  forked_from: string | null;
  version: number;
  status: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface AgentCountRow {
  total: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/agents - Create a new agent
   */
  app.post(
    '/api/v1/forge/agents',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Create a new agent',
        body: CreateAgentBody,
        response: { 400: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as Static<typeof CreateAgentBody>;

      try {
        const id = ulid();
        const slug = slugify(body.name);

        // Check for slug collision
        const existing = await queryOne<{ id: string }>(
          `SELECT id FROM forge_agents WHERE owner_id = $1 AND slug = $2 AND deleted_at IS NULL`,
          [userId, slug],
        );

        const finalSlug = existing ? `${slug}-${id.slice(-6).toLowerCase()}` : slug;

        const agent = await queryOne<AgentRow>(
          `INSERT INTO forge_agents (
            id, owner_id, name, slug, description, system_prompt, model_id,
            provider_config, autonomy_level, enabled_tools, mcp_servers,
            memory_config, max_iterations, max_tokens_per_turn,
            max_cost_per_execution, is_public, is_template, metadata, status
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'draft'
          ) RETURNING *`,
          [
            id,
            userId,
            body.name.trim(),
            finalSlug,
            body.description ?? null,
            body.systemPrompt ?? 'You are a helpful assistant.',
            body.modelId ?? null,
            JSON.stringify(body.providerConfig ?? { temperature: 0.7, maxTokens: 4096 }),
            body.autonomyLevel ?? 2,
            body.enabledTools ?? [],
            JSON.stringify(body.mcpServers ?? []),
            JSON.stringify(body.memoryConfig ?? { enableWorking: true, enableSemantic: false, enableEpisodic: false, enableProcedural: false, semanticSearchK: 5 }),
            body.maxIterations ?? 10,
            body.maxTokensPerTurn ?? 8192,
            body.maxCostPerExecution ?? 1.0,
            body.isPublic ?? false,
            body.isTemplate ?? false,
            JSON.stringify(body.metadata ?? {}),
          ],
        );

        void logAudit({
          ownerId: userId,
          action: 'agent.create',
          resourceType: 'agent',
          resourceId: id,
          details: { name: body.name },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.status(201).send({ agent });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to create agent');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/agents - List agents for the authenticated owner
   */
  app.get(
    '/api/v1/forge/agents',
    {
      schema: {
        tags: ['Agents'],
        summary: 'List agents for the authenticated owner',
        querystring: ListAgentsQuery,
        response: { 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as Static<typeof ListAgentsQuery>;

      try {
        const conditions: string[] = ['owner_id = $1', "status != 'archived'", 'deleted_at IS NULL'];
        const params: unknown[] = [userId];
        let paramIndex = 2;

        if (qs.status) {
          conditions.push(`status = $${paramIndex}`);
          params.push(qs.status);
          paramIndex++;
        }

        if (qs.search) {
          conditions.push(`(name ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`);
          params.push(`%${qs.search}%`);
          paramIndex++;
        }

        const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100));
        const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);

        const whereClause = conditions.join(' AND ');

        const [agents, countResult] = await Promise.all([
          query<AgentRow>(
            `SELECT * FROM forge_agents
             WHERE ${whereClause}
             ORDER BY updated_at DESC
             LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            [...params, limit, offset],
          ),
          queryOne<AgentCountRow>(
            `SELECT COUNT(*) AS total FROM forge_agents WHERE ${whereClause}`,
            params,
          ),
        ]);

        return reply.send({
          agents,
          total: countResult ? parseInt(countResult.total, 10) : 0,
          limit,
          offset,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to list agents');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * GET /api/v1/forge/agents/:id - Get a single agent
   */
  app.get(
    '/api/v1/forge/agents/:id',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Get a single agent',
        params: IdParam,
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as Static<typeof IdParam>;

      try {
        const agent = await queryOne<AgentRow>(
          `SELECT * FROM forge_agents WHERE id = $1 AND (owner_id = $2 OR is_public = true) AND deleted_at IS NULL`,
          [id, userId],
        );

        if (!agent) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Agent not found',
          });
        }

        return reply.send({ agent });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to get agent');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * PUT /api/v1/forge/agents/:id - Update an agent
   */
  app.put(
    '/api/v1/forge/agents/:id',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Update an agent',
        params: IdParam,
        body: UpdateAgentBody,
        response: { 400: ErrorResponse, 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      try {
        // Verify ownership
        const existing = await queryOne<AgentRow>(
          `SELECT id FROM forge_agents WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL`,
          [id, userId],
        );

        if (!existing) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Agent not found or not owned by you',
          });
        }

        const body = request.body as {
          name?: string;
          description?: string;
          systemPrompt?: string;
          modelId?: string;
          providerConfig?: Record<string, unknown>;
          autonomyLevel?: number;
          enabledTools?: string[];
          mcpServers?: unknown[];
          memoryConfig?: Record<string, unknown>;
          maxIterations?: number;
          maxTokensPerTurn?: number;
          maxCostPerExecution?: number;
          isPublic?: boolean;
          isTemplate?: boolean;
          status?: string;
          metadata?: Record<string, unknown>;
        };

        // Build dynamic SET clause
        const sets: string[] = [];
        const params: unknown[] = [];
        let paramIndex = 1;

        const addParam = (column: string, value: unknown): void => {
          sets.push(`${column} = $${paramIndex}`);
          params.push(value);
          paramIndex++;
        };

        if (body.name !== undefined) addParam('name', body.name);
        if (body.description !== undefined) addParam('description', body.description);
        if (body.systemPrompt !== undefined) addParam('system_prompt', body.systemPrompt);
        if (body.modelId !== undefined) addParam('model_id', body.modelId);
        if (body.providerConfig !== undefined) addParam('provider_config', JSON.stringify(body.providerConfig));
        if (body.autonomyLevel !== undefined) addParam('autonomy_level', body.autonomyLevel);
        if (body.enabledTools !== undefined) addParam('enabled_tools', body.enabledTools);
        if (body.mcpServers !== undefined) addParam('mcp_servers', JSON.stringify(body.mcpServers));
        if (body.memoryConfig !== undefined) addParam('memory_config', JSON.stringify(body.memoryConfig));
        if (body.maxIterations !== undefined) addParam('max_iterations', body.maxIterations);
        if (body.maxTokensPerTurn !== undefined) addParam('max_tokens_per_turn', body.maxTokensPerTurn);
        if (body.maxCostPerExecution !== undefined) addParam('max_cost_per_execution', body.maxCostPerExecution);
        if (body.isPublic !== undefined) addParam('is_public', body.isPublic);
        if (body.isTemplate !== undefined) addParam('is_template', body.isTemplate);
        if (body.status !== undefined) addParam('status', body.status);
        if (body.metadata !== undefined) addParam('metadata', JSON.stringify(body.metadata));

        if (sets.length === 0) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: 'No fields to update',
          });
        }

        // Bump version
        sets.push(`version = version + 1`);

        const agent = await queryOne<AgentRow>(
          `UPDATE forge_agents SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
          [...params, id],
        );

        void logAudit({
          ownerId: userId,
          action: 'agent.update',
          resourceType: 'agent',
          resourceId: id,
          details: { fields: Object.keys(body) },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.send({ agent });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to update agent');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * DELETE /api/v1/forge/agents/:id - Soft delete an agent (sets deleted_at, preserves execution history)
   */
  app.delete(
    '/api/v1/forge/agents/:id',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Soft delete an agent (preserves execution history)',
        params: IdParam,
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      try {
        const agent = await queryOne<AgentRow>(
          `UPDATE forge_agents
           SET status = 'archived', deleted_at = NOW()
           WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL
           RETURNING id, name, status, deleted_at`,
          [id, userId],
        );

        if (!agent) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Agent not found or not owned by you',
          });
        }

        void logAudit({
          ownerId: userId,
          action: 'agent.delete',
          resourceType: 'agent',
          resourceId: id,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.status(204).send();
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to delete agent');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * POST /api/v1/forge/agents/:id/restore - Restore a soft-deleted agent
   */
  app.post(
    '/api/v1/forge/agents/:id/restore',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Restore a soft-deleted agent',
        params: IdParam,
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      try {
        const agent = await queryOne<AgentRow>(
          `UPDATE forge_agents
           SET deleted_at = NULL, status = 'draft'
           WHERE id = $1 AND owner_id = $2 AND deleted_at IS NOT NULL
           RETURNING id, name, status`,
          [id, userId],
        );

        if (!agent) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Deleted agent not found or not owned by you',
          });
        }

        void logAudit({
          ownerId: userId,
          action: 'agent.restore',
          resourceType: 'agent',
          resourceId: id,
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.send({ agent });
      } catch (err: unknown) {
        request.log.error({ err }, 'Failed to restore agent');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  /**
   * POST /api/v1/forge/agents/:id/fork - Fork an agent
   */
  app.post(
    '/api/v1/forge/agents/:id/fork',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Fork an agent',
        params: IdParam,
        body: ForkAgentBody,
        response: { 404: ErrorResponse, 500: ErrorResponse },
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      try {
        // Load the source agent (must be owned by user or public, not deleted)
        const source = await queryOne<AgentRow>(
          `SELECT * FROM forge_agents WHERE id = $1 AND (owner_id = $2 OR is_public = true) AND deleted_at IS NULL`,
          [id, userId],
        );

        if (!source) {
          return reply.status(404).send({
            error: 'Not Found',
            message: 'Agent not found or not accessible',
          });
        }

        const body = request.body as { name?: string } | undefined;
        const newId = ulid();
        const newName = body?.name ?? `${source.name} (fork)`;
        const newSlug = `${slugify(newName)}-${newId.slice(-6).toLowerCase()}`;

        const forked = await queryOne<AgentRow>(
          `INSERT INTO forge_agents (
            id, owner_id, name, slug, description, system_prompt, model_id,
            provider_config, autonomy_level, enabled_tools, mcp_servers,
            memory_config, max_iterations, max_tokens_per_turn,
            max_cost_per_execution, is_public, is_template, forked_from,
            metadata, status
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, false, false, $16, $17, 'draft'
          ) RETURNING *`,
          [
            newId,
            userId,
            newName,
            newSlug,
            source.description,
            source.system_prompt,
            source.model_id,
            JSON.stringify(source.provider_config),
            source.autonomy_level,
            source.enabled_tools,
            JSON.stringify(source.mcp_servers),
            JSON.stringify(source.memory_config),
            source.max_iterations,
            source.max_tokens_per_turn,
            source.max_cost_per_execution,
            id,
            JSON.stringify({ forkedFrom: id, originalName: source.name }),
          ],
        );

        void logAudit({
          ownerId: userId,
          action: 'agent.fork',
          resourceType: 'agent',
          resourceId: newId,
          details: { forkedFrom: id, sourceName: source.name },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        }).catch(() => {});

        return reply.status(201).send({ agent: forked });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Failed to fork agent');
        return reply.status(500).send({
          error: 'Internal Server Error',
          message: 'Internal Server Error',
        });
      }
    },
  );

  // POST /api/v1/forge/agents/optimize-prompt — Optimize a system prompt using LLM
  app.post(
    '/api/v1/forge/agents/optimize-prompt',
    {
      schema: {
        tags: ['Agents'],
        summary: 'Optimize a system prompt using LLM',
        body: OptimizePromptBody,
        response: { 400: ErrorResponse, 500: ErrorResponse, 503: ErrorResponse },
      },
      preHandler: authMiddleware,
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        prompt?: string;
        name?: string;
        type?: string;
        description?: string;
      };

      const rawPrompt = (body.prompt || '').trim();
      if (!rawPrompt) {
        return reply.status(400).send({ error: 'Bad Request', message: 'prompt is required' });
      }

      const apiKey = process.env['ANTHROPIC_INTENT_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY_FALLBACK'];
      if (!apiKey) {
        return reply.status(503).send({ error: 'Service Unavailable', message: 'AI provider not configured' });
      }

      const client = new Anthropic({ apiKey });

      const context = [
        body.name ? `Agent name: ${body.name}` : '',
        body.type ? `Agent type: ${body.type}` : '',
        body.description ? `Description: ${body.description}` : '',
      ].filter(Boolean).join('\n');

      try {
        const response = await client.messages.create({
          model: 'claude-haiku-4-5',
          max_tokens: 2048,
          messages: [
            {
              role: 'user',
              content: `You are an expert AI prompt engineer. Optimize the following system prompt to be clearer, more effective, and well-structured. Keep the same intent and purpose but improve clarity, add useful constraints, and structure it for better AI agent performance.

${context ? `AGENT CONTEXT:\n${context}\n\n` : ''}USER'S DRAFT PROMPT:
${rawPrompt}

Return ONLY the optimized system prompt text — no explanations, no markdown fences, no preamble. Just the improved prompt ready to use.`,
            },
          ],
        });

        const optimized = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('');

        return reply.send({
          optimized,
          tokens: {
            input: response.usage.input_tokens,
            output: response.usage.output_tokens,
          },
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        request.log.error({ err }, 'Prompt optimization failed');
        return reply.status(500).send({ error: 'Internal Server Error', message: 'Internal Server Error' });
      }
    },
  );
}
