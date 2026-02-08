/**
 * Forge Memory Routes
 * Semantic memory search and injection for agents
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface SemanticMemoryRow {
  id: string;
  agent_id: string;
  owner_id: string;
  content: string;
  source: string | null;
  importance: string;
  access_count: number;
  last_accessed: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface EpisodicMemoryRow {
  id: string;
  agent_id: string;
  owner_id: string;
  situation: string;
  action: string;
  outcome: string;
  outcome_quality: string;
  execution_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface ProceduralMemoryRow {
  id: string;
  agent_id: string;
  owner_id: string;
  trigger_pattern: string;
  tool_sequence: unknown[];
  success_count: number;
  failure_count: number;
  confidence: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface AgentCheckRow {
  id: string;
  owner_id: string;
}

export async function memoryRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/forge/memory/:agentId/search - Search agent memory
   */
  app.get(
    '/api/v1/forge/memory/:agentId/search',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { agentId } = request.params as { agentId: string };
      const qs = request.query as {
        q?: string;
        type?: string;
        limit?: string;
      };

      if (!qs.q || qs.q.trim() === '') {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'Query parameter q is required',
        });
      }

      // Verify agent ownership
      const agent = await queryOne<AgentCheckRow>(
        `SELECT id, owner_id FROM forge_agents WHERE id = $1 AND owner_id = $2`,
        [agentId, userId],
      );

      if (!agent) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Agent not found or not owned by you',
        });
      }

      const limit = Math.min(parseInt(qs.limit ?? '5', 10) || 5, 50);
      const searchType = qs.type ?? 'semantic';

      if (searchType === 'semantic') {
        // Text-based search on semantic memories (full vector search requires embedding generation)
        // For now, use ILIKE text search as a fallback when no embedding is provided
        const memories = await query<SemanticMemoryRow>(
          `SELECT id, agent_id, owner_id, content, source, importance, access_count, last_accessed, metadata, created_at, updated_at
           FROM forge_semantic_memories
           WHERE agent_id = $1 AND owner_id = $2 AND content ILIKE $3
           ORDER BY importance DESC, created_at DESC
           LIMIT $4`,
          [agentId, userId, `%${qs.q}%`, limit],
        );

        // Update access counts
        if (memories.length > 0) {
          const memoryIds = memories.map((m) => m.id);
          void query(
            `UPDATE forge_semantic_memories
             SET access_count = access_count + 1, last_accessed = NOW()
             WHERE id = ANY($1)`,
            [memoryIds],
          ).catch(() => {});
        }

        return reply.send({ type: 'semantic', memories, total: memories.length });
      } else if (searchType === 'episodic') {
        const memories = await query<EpisodicMemoryRow>(
          `SELECT id, agent_id, owner_id, situation, action, outcome, outcome_quality, execution_id, metadata, created_at
           FROM forge_episodic_memories
           WHERE agent_id = $1 AND owner_id = $2
             AND (situation ILIKE $3 OR action ILIKE $3 OR outcome ILIKE $3)
           ORDER BY outcome_quality DESC, created_at DESC
           LIMIT $4`,
          [agentId, userId, `%${qs.q}%`, limit],
        );

        return reply.send({ type: 'episodic', memories, total: memories.length });
      } else if (searchType === 'procedural') {
        const memories = await query<ProceduralMemoryRow>(
          `SELECT id, agent_id, owner_id, trigger_pattern, tool_sequence, success_count, failure_count, confidence, metadata, created_at, updated_at
           FROM forge_procedural_memories
           WHERE agent_id = $1 AND owner_id = $2
             AND trigger_pattern ILIKE $3
           ORDER BY confidence DESC, created_at DESC
           LIMIT $4`,
          [agentId, userId, `%${qs.q}%`, limit],
        );

        return reply.send({ type: 'procedural', memories, total: memories.length });
      } else {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'type must be one of: semantic, episodic, procedural',
        });
      }
    },
  );

  /**
   * POST /api/v1/forge/memory/:agentId/inject - Inject a memory
   */
  app.post(
    '/api/v1/forge/memory/:agentId/inject',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const { agentId } = request.params as { agentId: string };
      const body = request.body as {
        type?: string;
        content: string;
        source?: string;
        importance?: number;
        metadata?: Record<string, unknown>;
        // Episodic-specific fields
        situation?: string;
        action?: string;
        outcome?: string;
        outcomeQuality?: number;
        // Procedural-specific fields
        triggerPattern?: string;
        toolSequence?: unknown[];
      };

      if (!body.content && !body.situation) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'content is required for semantic/procedural memories, situation for episodic',
        });
      }

      // Verify agent ownership
      const agent = await queryOne<AgentCheckRow>(
        `SELECT id, owner_id FROM forge_agents WHERE id = $1 AND owner_id = $2`,
        [agentId, userId],
      );

      if (!agent) {
        return reply.status(404).send({
          error: 'Not Found',
          message: 'Agent not found or not owned by you',
        });
      }

      const memoryType = body.type ?? 'semantic';
      const id = ulid();

      if (memoryType === 'semantic') {
        if (!body.content) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: 'content is required for semantic memories',
          });
        }

        const memory = await queryOne<SemanticMemoryRow>(
          `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, source, importance, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            id,
            agentId,
            userId,
            body.content,
            body.source ?? null,
            body.importance ?? 0.5,
            JSON.stringify(body.metadata ?? {}),
          ],
        );

        return reply.status(201).send({ type: 'semantic', memory });
      } else if (memoryType === 'episodic') {
        if (!body.situation || !body.action || !body.outcome) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: 'situation, action, and outcome are required for episodic memories',
          });
        }

        const memory = await queryOne<EpisodicMemoryRow>(
          `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING *`,
          [
            id,
            agentId,
            userId,
            body.situation,
            body.action,
            body.outcome,
            body.outcomeQuality ?? 0.5,
            JSON.stringify(body.metadata ?? {}),
          ],
        );

        return reply.status(201).send({ type: 'episodic', memory });
      } else if (memoryType === 'procedural') {
        if (!body.triggerPattern) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: 'triggerPattern is required for procedural memories',
          });
        }

        const memory = await queryOne<ProceduralMemoryRow>(
          `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, metadata)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [
            id,
            agentId,
            userId,
            body.triggerPattern,
            JSON.stringify(body.toolSequence ?? []),
            JSON.stringify(body.metadata ?? {}),
          ],
        );

        return reply.status(201).send({ type: 'procedural', memory });
      } else {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'type must be one of: semantic, episodic, procedural',
        });
      }
    },
  );
}
