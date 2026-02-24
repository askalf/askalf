/**
 * Forge Template Routes (Public)
 * Browse and instantiate curated agent templates
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../observability/audit.js';

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  icon: string | null;
  agent_config: Record<string, unknown>;
  schedule_config: Record<string, unknown> | null;
  estimated_cost_per_run: string | null;
  required_tools: string[];
  is_active: boolean;
  usage_count: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  status: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/templates - List active templates (grouped by category)
   */
  app.get(
    '/api/v1/forge/templates',
    {
      schema: {
        tags: ['Templates'],
        summary: 'List active templates grouped by category',
      },
      preHandler: [authMiddleware],
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      const templates = await query<TemplateRow>(
        `SELECT * FROM forge_agent_templates
         WHERE is_active = true
         ORDER BY sort_order ASC, name ASC`,
      );

      // Group by category
      const grouped: Record<string, TemplateRow[]> = {};
      for (const t of templates) {
        if (!grouped[t.category]) grouped[t.category] = [];
        grouped[t.category]!.push(t);
      }

      return {
        templates,
        categories: grouped,
        total: templates.length,
      };
    },
  );

  /**
   * GET /api/v1/forge/templates/:id - Template detail
   */
  app.get(
    '/api/v1/forge/templates/:id',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Get template detail',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      const template = await queryOne<TemplateRow>(
        `SELECT * FROM forge_agent_templates WHERE id = $1 AND is_active = true`,
        [id],
      );

      if (!template) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Template not found',
        });
      }

      return template;
    },
  );

  /**
   * POST /api/v1/forge/templates/:id/instantiate - Fork template into user's agent
   */
  app.post(
    '/api/v1/forge/templates/:id/instantiate',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Create an agent from a template',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        name?: string;
        description?: string;
        overrides?: Record<string, unknown>;
      };

      const template = await queryOne<TemplateRow>(
        `SELECT * FROM forge_agent_templates WHERE id = $1 AND is_active = true`,
        [id],
      );

      if (!template) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Template not found',
        });
      }

      const config = template.agent_config;
      const overrides = body.overrides ?? {};
      const agentName = body.name ?? template.name;
      const agentId = ulid();
      const slug = slugify(agentName);

      // Check for slug collision
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM forge_agents WHERE owner_id = $1 AND slug = $2`,
        [userId, slug],
      );
      const finalSlug = existing ? `${slug}-${agentId.slice(-6).toLowerCase()}` : slug;

      const agent = await queryOne<AgentRow>(
        `INSERT INTO forge_agents (
          id, owner_id, name, slug, description, system_prompt, model_id,
          autonomy_level, enabled_tools, max_iterations, max_cost_per_execution,
          is_public, is_template, metadata, status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, false, $12, 'draft'
        ) RETURNING id, owner_id, name, slug, status`,
        [
          agentId,
          userId,
          agentName,
          finalSlug,
          body.description ?? template.description,
          (overrides['systemPrompt'] as string) ?? (config['systemPrompt'] as string) ?? '',
          (overrides['model'] as string) ?? (config['model'] as string) ?? 'claude-sonnet-4-6',
          (overrides['autonomyLevel'] as number) ?? (config['autonomyLevel'] as number) ?? 2,
          template.required_tools,
          (overrides['maxIterations'] as number) ?? (config['maxIterations'] as number) ?? 15,
          (overrides['maxCostPerExecution'] as number) ?? (config['maxCostPerExecution'] as number) ?? 1.0,
          JSON.stringify({ fromTemplate: id, templateName: template.name, source_layer: 'builder' }),
        ],
      );

      // Increment usage count (fire-and-forget)
      void query(
        `UPDATE forge_agent_templates SET usage_count = usage_count + 1, updated_at = NOW() WHERE id = $1`,
        [id],
      ).catch(() => {});

      // Audit log
      void logAudit({
        ownerId: userId,
        action: 'template.instantiate',
        resourceType: 'agent',
        resourceId: agentId,
        details: { templateId: id, templateName: template.name },
      }).catch(() => {});

      return reply.status(201).send({
        agent,
        templateId: id,
        message: `Agent "${agentName}" created from template "${template.name}"`,
      });
    },
  );
}
