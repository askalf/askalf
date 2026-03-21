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
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const qs = request.query as { limit?: string; offset?: string };
      const limit = Math.max(1, Math.min(parseInt(qs.limit ?? '200', 10) || 200, 500));
      const offset = Math.max(0, parseInt(qs.offset ?? '0', 10) || 0);

      const [templates, countResult] = await Promise.all([
        query<TemplateRow>(
          `SELECT * FROM forge_agent_templates
           WHERE is_active = true
           ORDER BY sort_order ASC, name ASC
           LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM forge_agent_templates WHERE is_active = true`,
        ),
      ]);

      const total = parseInt(countResult[0]?.count ?? '0', 10);

      // Group by category
      const grouped: Record<string, TemplateRow[]> = {};
      for (const t of templates) {
        if (!grouped[t.category]) grouped[t.category] = [];
        grouped[t.category]!.push(t);
      }

      return {
        templates,
        categories: grouped,
        total,
        limit,
        offset,
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
      ).catch((e) => { if (e) console.debug("[catch]", String(e)); });

      // Audit log
      void logAudit({
        ownerId: userId,
        action: 'template.instantiate',
        resourceType: 'agent',
        resourceId: agentId,
        details: { templateId: id, templateName: template.name },
      }).catch((e) => { if (e) console.debug("[catch]", String(e)); });

      return reply.status(201).send({
        agent,
        templateId: id,
        message: `Agent "${agentName}" created from template "${template.name}"`,
      });
    },
  );

  /**
   * POST /api/v1/forge/templates/import - Bulk import templates from JSON
   */
  app.post(
    '/api/v1/forge/templates/import',
    {
      schema: {
        tags: ['Templates'],
        summary: 'Import templates from JSON',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { templates?: Record<string, unknown>[] };
      if (!body.templates?.length) {
        return reply.status(400).send({ error: 'No templates provided' });
      }

      let imported = 0;
      for (const t of body.templates) {
        const name = t['name'] as string;
        const slug = t['slug'] as string || name?.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (!name || !slug) continue;

        const id = `tpl_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        try {
          await query(
            `INSERT INTO forge_agent_templates (id, name, slug, category, description, icon, required_tools, agent_config, schedule_config, estimated_cost_per_run, is_active, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
             ON CONFLICT DO NOTHING`,
            [
              id,
              name,
              slug,
              (t['category'] as string) || 'custom',
              (t['description'] as string) || '',
              (t['icon'] as string) || null,
              (t['required_tools'] as string[]) || [],
              JSON.stringify(t['agent_config'] || {}),
              t['schedule_config'] ? JSON.stringify(t['schedule_config']) : null,
              (t['estimated_cost_per_run'] as string) || null,
              (t['sort_order'] as number) || 100,
            ],
          );
          imported++;
        } catch (err) {
          app.log.warn(`Failed to import template "${name}": ${err instanceof Error ? err.message : 'unknown'}`);
        }
      }

      return { imported, total: body.templates.length };
    },
  );
}
