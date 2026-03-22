/**
 * Forge Memory Routes
 * Semantic memory search and injection for agents
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne, retryQuery } from '../database.js';
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

        // Update access counts with retry on transient DB errors
        if (memories.length > 0) {
          const memoryIds = memories.map((m) => m.id);
          void retryQuery(
            `UPDATE forge_semantic_memories
             SET access_count = access_count + 1, last_accessed = NOW()
             WHERE id = ANY($1)`,
            [memoryIds],
          ).catch((err) => {
            console.warn('[Memory] Failed to update access counts after retries:', err instanceof Error ? err.message : err);
          });
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

  // ============================================================
  // FLEET MEMORY ENDPOINTS (admin - no per-agent ownership check)
  // ============================================================

  /**
   * GET /api/v1/forge/fleet/stats - Fleet memory statistics
   */
  app.get(
    '/api/v1/forge/fleet/stats',
    { preHandler: [authMiddleware] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const { getCached } = await import('../orchestration/event-bus.js');
      return getCached('fleet:stats', 30, async () => {
      const [semCount, epiCount, procCount, sem24, epi24, proc24] = await Promise.all([
        queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM forge_semantic_memories`),
        queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM forge_episodic_memories`),
        queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM forge_procedural_memories`),
        queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM forge_semantic_memories WHERE created_at > NOW() - INTERVAL '24 hours'`),
        queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM forge_episodic_memories WHERE created_at > NOW() - INTERVAL '24 hours'`),
        queryOne<{ count: string }>(`SELECT COUNT(*) as count FROM forge_procedural_memories WHERE created_at > NOW() - INTERVAL '24 hours'`),
      ]);

      const semantic = parseInt(semCount?.count ?? '0', 10);
      const episodic = parseInt(epiCount?.count ?? '0', 10);
      const procedural = parseInt(procCount?.count ?? '0', 10);

      // Per-agent budget usage
      const budgetAgents = await query<{
        id: string; name: string; cost_budget_daily: string; budget_paused_at: string | null; spent_today: string;
      }>(
        `SELECT a.id, a.name, a.cost_budget_daily::text, a.budget_paused_at::text,
                COALESCE((SELECT SUM(c.cost) FROM forge_cost_events c
                  WHERE c.agent_id = a.id AND c.created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')), 0)::text AS spent_today
         FROM forge_agents a
         WHERE a.cost_budget_daily IS NOT NULL AND a.status = 'active'
         ORDER BY a.name`,
      ).catch(() => [] as Array<{ id: string; name: string; cost_budget_daily: string; budget_paused_at: string | null; spent_today: string }>);

      const agentBudgets = budgetAgents.map(a => ({
        agentId: a.id,
        agentName: a.name,
        budgetDaily: parseFloat(a.cost_budget_daily),
        spentToday: parseFloat(a.spent_today) || 0,
        remainingToday: Math.max(0, parseFloat(a.cost_budget_daily) - (parseFloat(a.spent_today) || 0)),
        paused: a.budget_paused_at !== null,
        pausedAt: a.budget_paused_at,
      }));

      return {
        tiers: { semantic, episodic, procedural },
        total: semantic + episodic + procedural,
        recent24h: {
          semantic: parseInt(sem24?.count ?? '0', 10),
          episodic: parseInt(epi24?.count ?? '0', 10),
          procedural: parseInt(proc24?.count ?? '0', 10),
        },
        recalls24h: 0,
        agentBudgets,
      };
      });
    },
  );

  /**
   * GET /api/v1/forge/fleet/recent - Recent fleet memories across all tiers
   */
  app.get(
    '/api/v1/forge/fleet/recent',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as {
        limit?: string;
        page?: string;
        agent_id?: string;
        tier?: string;
        source_type?: string;
        dateFrom?: string;
        dateTo?: string;
      };

      const limit = Math.min(parseInt(qs.limit ?? '30', 10) || 30, 100);
      const page = parseInt(qs.page ?? '1', 10) || 1;
      const offset = (page - 1) * limit;

      const memories: Array<Record<string, unknown>> = [];

      // Build parameterized filters to prevent SQL injection
      const filterParams: unknown[] = [];
      let filterClause = '';
      let nextIdx = 1;
      if (qs.agent_id) {
        filterClause += ` AND agent_id = $${nextIdx++}`;
        filterParams.push(qs.agent_id);
      }
      if (qs.dateFrom) {
        filterClause += ` AND created_at >= $${nextIdx++}`;
        filterParams.push(qs.dateFrom);
      }
      if (qs.dateTo) {
        filterClause += ` AND created_at <= $${nextIdx++}`;
        filterParams.push(qs.dateTo);
      }
      const limitIdx = nextIdx;

      if (!qs.tier || qs.tier === 'semantic') {
        const rows = await query<SemanticMemoryRow>(
          `SELECT id, agent_id, content, importance as score, source, metadata, created_at
           FROM forge_semantic_memories
           WHERE 1=1${filterClause}
           ORDER BY created_at DESC LIMIT $${limitIdx}`,
          [...filterParams, limit],
        );
        for (const r of rows) {
          memories.push({
            id: r.id, tier: 'semantic', agent_id: r.agent_id,
            content: r.content, preview: r.content?.substring(0, 200),
            score: parseFloat(String(r.importance)) || 0.5,
            created_at: r.created_at, metadata: r.metadata,
          });
        }
      }

      if (!qs.tier || qs.tier === 'episodic') {
        const rows = await query<EpisodicMemoryRow>(
          `SELECT id, agent_id, situation, action, outcome, outcome_quality, metadata, created_at
           FROM forge_episodic_memories
           WHERE 1=1${filterClause}
           ORDER BY created_at DESC LIMIT $${limitIdx}`,
          [...filterParams, limit],
        );
        for (const r of rows) {
          memories.push({
            id: r.id, tier: 'episodic', agent_id: r.agent_id,
            content: r.situation, preview: r.situation?.substring(0, 200),
            situation: r.situation, action: r.action, outcome: r.outcome,
            outcome_quality: parseFloat(String(r.outcome_quality)) || 0.5,
            score: parseFloat(String(r.outcome_quality)) || 0.5,
            created_at: r.created_at, metadata: r.metadata,
          });
        }
      }

      if (!qs.tier || qs.tier === 'procedural') {
        const rows = await query<ProceduralMemoryRow>(
          `SELECT id, agent_id, trigger_pattern, tool_sequence, confidence, metadata, created_at
           FROM forge_procedural_memories
           WHERE 1=1${filterClause}
           ORDER BY created_at DESC LIMIT $${limitIdx}`,
          [...filterParams, limit],
        );
        for (const r of rows) {
          memories.push({
            id: r.id, tier: 'procedural', agent_id: r.agent_id,
            content: r.trigger_pattern, preview: r.trigger_pattern?.substring(0, 200),
            trigger_pattern: r.trigger_pattern, tool_sequence: r.tool_sequence,
            confidence: parseFloat(String(r.confidence)) || 0.5,
            score: parseFloat(String(r.confidence)) || 0.5,
            created_at: r.created_at, metadata: r.metadata,
          });
        }
      }

      // Sort combined by created_at desc and paginate
      memories.sort((a, b) => new Date(b['created_at'] as string).getTime() - new Date(a['created_at'] as string).getTime());
      const paged = memories.slice(offset, offset + limit);
      const total = memories.length;

      return reply.send({
        memories: paged,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      });
    },
  );

  /**
   * GET /api/v1/forge/fleet/search - Search fleet memories
   */
  app.get(
    '/api/v1/forge/fleet/search',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as {
        q: string;
        tier?: string;
        agent_id?: string;
        source_type?: string;
        limit?: string;
        page?: string;
      };

      if (!qs.q || qs.q.trim() === '') {
        return reply.status(400).send({ error: 'q parameter required' });
      }

      const limit = Math.min(parseInt(qs.limit ?? '20', 10) || 20, 100);
      const page = parseInt(qs.page ?? '1', 10) || 1;
      const offset = (page - 1) * limit;
      // Build parameterized search query to prevent SQL injection
      const searchTerm = `%${qs.q}%`;
      const searchParams: unknown[] = [searchTerm];
      let searchAgentClause = '';
      let sIdx = 2;
      if (qs.agent_id) {
        searchAgentClause = ` AND agent_id = $${sIdx++}`;
        searchParams.push(qs.agent_id);
      }
      const searchLimitIdx = sIdx;

      const memories: Array<Record<string, unknown>> = [];

      if (!qs.tier || qs.tier === 'semantic') {
        const rows = await query<SemanticMemoryRow>(
          `SELECT id, agent_id, content, importance as score, source, metadata, created_at
           FROM forge_semantic_memories
           WHERE content ILIKE $1${searchAgentClause}
           ORDER BY importance DESC, created_at DESC LIMIT $${searchLimitIdx}`,
          [...searchParams, limit],
        );
        for (const r of rows) {
          memories.push({
            id: r.id, tier: 'semantic', agent_id: r.agent_id,
            content: r.content, preview: r.content?.substring(0, 200),
            score: parseFloat(String(r.importance)) || 0.5,
            created_at: r.created_at, metadata: r.metadata,
          });
        }
      }

      if (!qs.tier || qs.tier === 'episodic') {
        const rows = await query<EpisodicMemoryRow>(
          `SELECT id, agent_id, situation, action, outcome, outcome_quality, metadata, created_at
           FROM forge_episodic_memories
           WHERE (situation ILIKE $1 OR action ILIKE $1 OR outcome ILIKE $1)${searchAgentClause}
           ORDER BY outcome_quality DESC, created_at DESC LIMIT $${searchLimitIdx}`,
          [...searchParams, limit],
        );
        for (const r of rows) {
          memories.push({
            id: r.id, tier: 'episodic', agent_id: r.agent_id,
            content: r.situation, preview: r.situation?.substring(0, 200),
            situation: r.situation, action: r.action, outcome: r.outcome,
            outcome_quality: parseFloat(String(r.outcome_quality)) || 0.5,
            score: parseFloat(String(r.outcome_quality)) || 0.5,
            created_at: r.created_at, metadata: r.metadata,
          });
        }
      }

      if (!qs.tier || qs.tier === 'procedural') {
        const rows = await query<ProceduralMemoryRow>(
          `SELECT id, agent_id, trigger_pattern, tool_sequence, confidence, metadata, created_at
           FROM forge_procedural_memories
           WHERE trigger_pattern ILIKE $1${searchAgentClause}
           ORDER BY confidence DESC, created_at DESC LIMIT $${searchLimitIdx}`,
          [...searchParams, limit],
        );
        for (const r of rows) {
          memories.push({
            id: r.id, tier: 'procedural', agent_id: r.agent_id,
            content: r.trigger_pattern, preview: r.trigger_pattern?.substring(0, 200),
            trigger_pattern: r.trigger_pattern, tool_sequence: r.tool_sequence,
            confidence: parseFloat(String(r.confidence)) || 0.5,
            score: parseFloat(String(r.confidence)) || 0.5,
            created_at: r.created_at, metadata: r.metadata,
          });
        }
      }

      memories.sort((a, b) => (b['score'] as number) - (a['score'] as number));
      const paged = memories.slice(offset, offset + limit);
      const total = memories.length;

      return reply.send({
        memories: paged,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
      });
    },
  );

  /**
   * GET /api/v1/forge/fleet/recalls - Recent recall events (from execution logs)
   */
  app.get(
    '/api/v1/forge/fleet/recalls',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const qs = request.query as { limit?: string; page?: string };
      const limit = Math.min(parseInt(qs.limit ?? '30', 10) || 30, 100);
      const page = parseInt(qs.page ?? '1', 10) || 1;
      const offset = (page - 1) * limit;

      // Recalls are logged in execution metadata — pull recent executions with memory context
      interface RecallExecRow {
        id: string;
        agent_id: string;
        metadata: Record<string, unknown>;
        created_at: string;
      }

      const rows = await query<RecallExecRow>(
        `SELECT e.id, e.agent_id, e.metadata, e.created_at
         FROM forge_executions e
         WHERE e.metadata IS NOT NULL
         ORDER BY e.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      );

      // Look up agent names
      interface AgentNameRow { id: string; name: string }
      const agentIds = [...new Set(rows.map(r => r.agent_id))];
      const agentNames: Record<string, string> = {};
      if (agentIds.length > 0) {
        const agents = await query<AgentNameRow>(
          `SELECT id, name FROM forge_agents WHERE id = ANY($1)`,
          [agentIds],
        );
        for (const a of agents) agentNames[a.id] = a.name;
      }

      const recalls = rows.map(r => ({
        executionId: r.id,
        agentId: r.agent_id,
        agentName: agentNames[r.agent_id] ?? 'Unknown',
        memoriesCount: (r.metadata as Record<string, unknown>)?.['memory_count'] as number ?? 0,
        runtimeMode: (r.metadata as Record<string, unknown>)?.['runtime_mode'] as string ?? 'cli',
        timestamp: r.created_at,
      }));

      return reply.send({
        recalls,
        total: recalls.length,
        page,
        limit,
        totalPages: 1,
      });
    },
  );

  /**
   * POST /api/v1/forge/fleet/store - Store a fleet memory (no ownership check)
   */
  app.post(
    '/api/v1/forge/fleet/store',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        type?: string;
        content: string;
        agent_id?: string;
        source?: string;
        importance?: number;
        metadata?: Record<string, unknown>;
        // Episodic fields
        action?: string;
        outcome?: string;
        quality?: number;
        execution_id?: string;
        // Procedural fields
        trigger_pattern?: string;
        tool_sequence?: unknown[];
      };

      const memoryType = body.type ?? 'semantic';

      if (!['semantic', 'episodic', 'procedural'].includes(memoryType)) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'type must be one of: semantic, episodic, procedural',
        });
      }

      if (!body.content && memoryType !== 'episodic') {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'content is required',
        });
      }

      // Validate agent_id exists if provided (FK constraint)
      let agentId = body.agent_id ?? null;
      if (agentId) {
        const agent = await queryOne<{ id: string }>(
          `SELECT id FROM forge_agents WHERE id = $1`,
          [agentId],
        );
        if (!agent) {
          return reply.status(400).send({
            error: 'Validation Error',
            message: `agent_id '${agentId}' does not exist in forge_agents. Memory tables have a FK constraint on agent_id.`,
          });
        }
      }

      // agent_id is required by the DB schema (NOT NULL + FK)
      if (!agentId) {
        return reply.status(400).send({
          error: 'Validation Error',
          message: 'agent_id is required. The memory tables require a valid agent_id that exists in forge_agents.',
        });
      }

      const id = ulid();
      const userId = request.userId!;

      try {
        if (memoryType === 'semantic') {
          const memory = await queryOne<SemanticMemoryRow>(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, source, importance, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [id, agentId, userId, body.content, body.source ?? null, body.importance ?? 0.5, JSON.stringify(body.metadata ?? {})],
          );
          return reply.status(201).send({ type: 'semantic', memory });
        } else if (memoryType === 'episodic') {
          if (!body.content) {
            return reply.status(400).send({
              error: 'Validation Error',
              message: 'content (situation) is required for episodic memories',
            });
          }
          const memory = await queryOne<EpisodicMemoryRow>(
            `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, execution_id, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [id, agentId, userId, body.content, body.action ?? '', body.outcome ?? '', body.quality ?? 0.5, body.execution_id ?? null, JSON.stringify(body.metadata ?? {})],
          );
          return reply.status(201).send({ type: 'episodic', memory });
        } else {
          // procedural
          const memory = await queryOne<ProceduralMemoryRow>(
            `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, metadata)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING *`,
            [id, agentId, userId, body.trigger_pattern ?? body.content, JSON.stringify(body.tool_sequence ?? []), JSON.stringify(body.metadata ?? {})],
          );
          return reply.status(201).send({ type: 'procedural', memory });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('violates foreign key constraint')) {
          return reply.status(400).send({
            error: 'FK Constraint',
            message: `agent_id '${agentId}' does not exist in forge_agents. Cannot store memory.`,
          });
        }
        throw err;
      }
    },
  );
}
