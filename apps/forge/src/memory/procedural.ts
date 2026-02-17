/**
 * Procedural Memory - Tier 4
 * Learned workflow patterns and tool-use sequences.
 * Tracks trigger patterns, tool sequences, success/failure rates, and confidence.
 * Vector similarity search finds relevant procedures for new situations.
 */

import { ulid } from 'ulid';
import type pg from 'pg';

type QueryFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

type QueryOneFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T | null>;

export interface ToolStep {
  tool: string;
  params: Record<string, unknown>;
  description?: string;
}

export interface ProceduralMemoryRow {
  id: string;
  agent_id: string;
  owner_id: string;
  trigger_pattern: string;
  tool_sequence: ToolStep[];
  success_count: number;
  failure_count: number;
  confidence: number;
  embedding: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface ProceduralSearchResult {
  id: string;
  agent_id: string;
  owner_id: string;
  trigger_pattern: string;
  tool_sequence: ToolStep[];
  success_count: number;
  failure_count: number;
  confidence: number;
  metadata: Record<string, unknown> | null;
  similarity: number;
  created_at: Date;
}

export class ProceduralMemory {
  private readonly query: QueryFn;
  private readonly queryOne: QueryOneFn;

  constructor(query: QueryFn, queryOne: QueryOneFn) {
    this.query = query;
    this.queryOne = queryOne;
  }

  private static formatEmbedding(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  /**
   * Store a new procedural memory (learned workflow pattern).
   */
  async store(
    agentId: string,
    ownerId: string,
    triggerPattern: string,
    toolSequence: ToolStep[],
    embedding?: number[],
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const id = ulid();

    const embeddingLiteral = embedding
      ? ProceduralMemory.formatEmbedding(embedding)
      : null;

    await this.query(
      `INSERT INTO forge_procedural_memories
         (id, agent_id, owner_id, trigger_pattern, tool_sequence,
          success_count, failure_count, confidence, embedding, metadata, created_at)
       VALUES
         ($1, $2, $3, $4, $5::jsonb, 0, 0, 0.5, $6::vector, $7, NOW())`,
      [
        id,
        agentId,
        ownerId,
        triggerPattern,
        JSON.stringify(toolSequence),
        embeddingLiteral,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );

    return id;
  }

  /**
   * Search procedural memories by vector similarity.
   * Only searches procedures that have embeddings.
   */
  async search(
    agentId: string,
    embedding: number[],
    k: number,
  ): Promise<ProceduralSearchResult[]> {
    const vecLiteral = ProceduralMemory.formatEmbedding(embedding);

    return this.query<ProceduralSearchResult>(
      `SELECT
         id, agent_id, owner_id, trigger_pattern, tool_sequence,
         success_count, failure_count, confidence, metadata, created_at,
         1 - (embedding <=> $1::vector) AS similarity
       FROM forge_procedural_memories
       WHERE agent_id = $2
         AND embedding IS NOT NULL
       ORDER BY similarity DESC
       LIMIT $3`,
      [vecLiteral, agentId, k],
    );
  }

  /**
   * Search procedural memories across ALL agents (fleet-wide).
   * Same as search() but without agent_id filter.
   */
  async searchFleet(
    embedding: number[],
    k: number,
  ): Promise<ProceduralSearchResult[]> {
    const vecLiteral = ProceduralMemory.formatEmbedding(embedding);

    return this.query<ProceduralSearchResult>(
      `SELECT
         id, agent_id, owner_id, trigger_pattern, tool_sequence,
         success_count, failure_count, confidence, metadata, created_at,
         1 - (embedding <=> $1::vector) AS similarity
       FROM forge_procedural_memories
       WHERE embedding IS NOT NULL
       ORDER BY similarity DESC
       LIMIT $2`,
      [vecLiteral, k],
    );
  }

  /**
   * Record the outcome of a procedure execution.
   * Increments success_count or failure_count and recalculates confidence
   * using a simple Bayesian: confidence = success / (success + failure).
   */
  async recordOutcome(id: string, success: boolean): Promise<void> {
    if (success) {
      await this.query(
        `UPDATE forge_procedural_memories
         SET success_count = success_count + 1,
             confidence = (success_count + 1)::float / (success_count + 1 + failure_count)::float
         WHERE id = $1`,
        [id],
      );
    } else {
      await this.query(
        `UPDATE forge_procedural_memories
         SET failure_count = failure_count + 1,
             confidence = success_count::float / (success_count + failure_count + 1)::float
         WHERE id = $1`,
        [id],
      );
    }
  }

  /**
   * Get the highest-confidence procedural patterns for an agent.
   */
  async getTopPatterns(
    agentId: string,
    limit: number,
  ): Promise<ProceduralMemoryRow[]> {
    return this.query<ProceduralMemoryRow>(
      `SELECT id, agent_id, owner_id, trigger_pattern, tool_sequence,
              success_count, failure_count, confidence, embedding, metadata, created_at
       FROM forge_procedural_memories
       WHERE agent_id = $1
       ORDER BY confidence DESC, success_count DESC
       LIMIT $2`,
      [agentId, limit],
    );
  }

  /**
   * Retrieve a single procedure by ID.
   */
  async getById(id: string): Promise<ProceduralMemoryRow | null> {
    return this.queryOne<ProceduralMemoryRow>(
      `SELECT id, agent_id, owner_id, trigger_pattern, tool_sequence,
              success_count, failure_count, confidence, embedding, metadata, created_at
       FROM forge_procedural_memories
       WHERE id = $1`,
      [id],
    );
  }

  /**
   * Delete a procedural memory by ID. Returns true if a row was removed.
   */
  async delete(id: string): Promise<boolean> {
    const rows = await this.query(
      `DELETE FROM forge_procedural_memories WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }
}
