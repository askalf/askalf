/**
 * Forge Workflow Routes
 * Multi-agent DAG workflow management and execution
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { logAudit } from '../observability/audit.js';
import type { ForgeScheduler } from '../orchestration/scheduler.js';

interface WorkflowRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  definition: { nodes: unknown[]; edges: unknown[] };
  version: number;
  status: string;
  is_public: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  owner_id: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  node_states: Record<string, unknown>;
  shared_context: Record<string, unknown>;
  current_node: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface CountRow {
  total: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export async function workflowRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/workflows - Create a workflow
   */
  app.post(
    '/api/v1/forge/workflows',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = request.body as {
        name: string;
        description?: string;
        definition?: { nodes: unknown[]; edges: unknown[] };
        isPublic?: boolean;
        metadata?: Record<string, unknown>;
      };

      if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Workflow name is required',
        });
      }

      const id = ulid();
      const slug = slugify(body.name);

      // Check for slug collision
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM forge_workflows WHERE owner_id = $1 AND slug = $2`,
        [userId, slug],
      );

      const finalSlug = existing ? `${slug}-${id.slice(-6).toLowerCase()}` : slug;

      const workflow = await queryOne<WorkflowRow>(
        `INSERT INTO forge_workflows (id, owner_id, name, slug, description, definition, is_public, metadata, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')
         RETURNING *`,
        [
          id,
          userId,
          body.name.trim(),
          finalSlug,
          body.description ?? null,
          JSON.stringify(body.definition ?? { nodes: [], edges: [] }),
          body.isPublic ?? false,
          JSON.stringify(body.metadata ?? {}),
        ],
      );

      void logAudit({
        ownerId: userId,
        action: 'workflow.create',
        resourceType: 'workflow',
        resourceId: id,
        details: { name: body.name },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch(() => {});

      return reply.status(201).send({ workflow });
    },
  );

  /**
   * GET /api/v1/forge/workflows - List workflows
   */
  app.get(
    '/api/v1/forge/workflows',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const qs = request.query as {
        status?: string;
        limit?: string;
        offset?: string;
      };

      const conditions: string[] = ['owner_id = $1', "status != 'archived'"];
      const params: unknown[] = [userId];
      let paramIndex = 2;

      if (qs.status) {
        conditions.push(`status = $${paramIndex}`);
        params.push(qs.status);
        paramIndex++;
      }

      const limit = Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100);
      const offset = parseInt(qs.offset ?? '0', 10) || 0;
      const whereClause = conditions.join(' AND ');

      const [workflows, countResult] = await Promise.all([
        query<WorkflowRow>(
          `SELECT * FROM forge_workflows
           WHERE ${whereClause}
           ORDER BY updated_at DESC
           LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
          [...params, limit, offset],
        ),
        queryOne<CountRow>(
          `SELECT COUNT(*) AS total FROM forge_workflows WHERE ${whereClause}`,
          params,
        ),
      ]);

      return reply.send({
        workflows,
        total: countResult ? parseInt(countResult.total, 10) : 0,
        limit,
        offset,
      });
    },
  );

  /**
   * GET /api/v1/forge/workflows/:id - Get a workflow
   */
  app.get(
    '/api/v1/forge/workflows/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const workflow = await queryOne<WorkflowRow>(
        `SELECT * FROM forge_workflows WHERE id = $1 AND (owner_id = $2 OR is_public = true)`,
        [id, userId],
      );

      if (!workflow) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Workflow not found',
        });
      }

      return reply.send({ workflow });
    },
  );

  /**
   * PUT /api/v1/forge/workflows/:id - Update a workflow
   */
  app.put(
    '/api/v1/forge/workflows/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      // Verify ownership
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM forge_workflows WHERE id = $1 AND owner_id = $2`,
        [id, userId],
      );

      if (!existing) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Workflow not found or not owned by you',
        });
      }

      const body = request.body as {
        name?: string;
        description?: string;
        definition?: { nodes: unknown[]; edges: unknown[] };
        status?: string;
        isPublic?: boolean;
        metadata?: Record<string, unknown>;
      };

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
      if (body.definition !== undefined) addParam('definition', JSON.stringify(body.definition));
      if (body.status !== undefined) addParam('status', body.status);
      if (body.isPublic !== undefined) addParam('is_public', body.isPublic);
      if (body.metadata !== undefined) addParam('metadata', JSON.stringify(body.metadata));

      if (sets.length === 0) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'No fields to update',
        });
      }

      sets.push('version = version + 1');

      const workflow = await queryOne<WorkflowRow>(
        `UPDATE forge_workflows SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        [...params, id],
      );

      void logAudit({
        ownerId: userId,
        action: 'workflow.update',
        resourceType: 'workflow',
        resourceId: id,
        details: { fields: Object.keys(body) },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch(() => {});

      return reply.send({ workflow });
    },
  );

  /**
   * POST /api/v1/forge/workflows/:id/run - Start a workflow run
   */
  app.post(
    '/api/v1/forge/workflows/:id/run',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id: workflowId } = request.params as { id: string };
      const body = request.body as {
        input?: Record<string, unknown>;
        metadata?: Record<string, unknown>;
      } | undefined;

      // Verify workflow exists and is accessible
      const workflow = await queryOne<WorkflowRow>(
        `SELECT * FROM forge_workflows WHERE id = $1 AND (owner_id = $2 OR is_public = true)`,
        [workflowId, userId],
      );

      if (!workflow) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Workflow not found',
        });
      }

      if (workflow.status === 'archived') {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Cannot run an archived workflow',
        });
      }

      // Use the ForgeScheduler to create and enqueue the workflow run
      const scheduler = (app as unknown as { workflowScheduler?: ForgeScheduler }).workflowScheduler;
      if (!scheduler) {
        // Fallback: create record but don't execute (scheduler not initialized)
        const runId = ulid();
        const nodes = workflow.definition.nodes as Array<{ id: string }>;
        const firstNode = nodes.length > 0 ? (nodes[0]?.id ?? null) : null;
        const run = await queryOne<WorkflowRunRow>(
          `INSERT INTO forge_workflow_runs (id, workflow_id, owner_id, input, status, current_node, started_at)
           VALUES ($1, $2, $3, $4, 'pending', $5, NOW()) RETURNING *`,
          [runId, workflowId, userId, JSON.stringify(body?.input ?? {}), firstNode],
        );
        return reply.status(201).send({ run, warning: 'Workflow scheduler not available — run created but not executing' });
      }

      const { runId } = await scheduler.scheduleWorkflowRun(
        workflowId,
        body?.input ?? {},
        userId,
      );

      const run = await queryOne<WorkflowRunRow>(
        `SELECT * FROM forge_workflow_runs WHERE id = $1`,
        [runId],
      );

      void logAudit({
        ownerId: userId,
        action: 'workflow.run',
        resourceType: 'workflow_run',
        resourceId: runId,
        details: { workflowId },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      }).catch(() => {});

      return reply.status(201).send({ run });
    },
  );

  /**
   * GET /api/v1/forge/workflow-runs/:id - Get workflow run status
   */
  app.get(
    '/api/v1/forge/workflow-runs/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { id } = request.params as { id: string };

      const run = await queryOne<WorkflowRunRow>(
        `SELECT * FROM forge_workflow_runs WHERE id = $1 AND owner_id = $2`,
        [id, userId],
      );

      if (!run) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Workflow run not found',
        });
      }

      return reply.send({ run });
    },
  );
}
