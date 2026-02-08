/**
 * Episodic Memory - Tier 3
 * SAO (Situation-Action-Outcome) history for agent learning.
 * Each episode records what happened, what the agent did, and how it turned out.
 * Supports vector similarity search to find relevant past experiences.
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

export interface EpisodicMemoryRow {
  id: string;
  agent_id: string;
  owner_id: string;
  situation: string;
  action: string;
  outcome: string;
  outcome_quality: number;
  embedding: string | null;
  execution_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface EpisodicSearchResult {
  id: string;
  agent_id: string;
  owner_id: string;
  situation: string;
  action: string;
  outcome: string;
  outcome_quality: number;
  execution_id: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
  created_at: Date;
}

export class EpisodicMemory {
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
   * Store a new episodic memory (SAO record).
   * embedding and executionId are optional.
   */
  async store(
    agentId: string,
    ownerId: string,
    situation: string,
    action: string,
    outcome: string,
    quality: number,
    embedding?: number[],
    executionId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const id = ulid();

    const embeddingLiteral = embedding
      ? EpisodicMemory.formatEmbedding(embedding)
      : null;

    await this.query(
      `INSERT INTO forge_episodic_memories
         (id, agent_id, owner_id, situation, action, outcome, outcome_quality,
          embedding, execution_id, metadata, created_at)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10, NOW())`,
      [
        id,
        agentId,
        ownerId,
        situation,
        action,
        outcome,
        quality,
        embeddingLiteral,
        executionId ?? null,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );

    return id;
  }

  /**
   * Search episodic memories by vector similarity.
   * Only searches episodes that have embeddings.
   */
  async search(
    agentId: string,
    embedding: number[],
    k: number,
  ): Promise<EpisodicSearchResult[]> {
    const vecLiteral = EpisodicMemory.formatEmbedding(embedding);

    return this.query<EpisodicSearchResult>(
      `SELECT
         id, agent_id, owner_id, situation, action, outcome,
         outcome_quality, execution_id, metadata, created_at,
         1 - (embedding <=> $1::vector) AS similarity
       FROM forge_episodic_memories
       WHERE agent_id = $2
         AND embedding IS NOT NULL
       ORDER BY similarity DESC
       LIMIT $3`,
      [vecLiteral, agentId, k],
    );
  }

  /**
   * Get episodic memories for an agent, ordered by recency.
   * Optionally filter by minimum outcome quality.
   */
  async getByAgent(
    agentId: string,
    limit: number,
    minQuality?: number,
  ): Promise<EpisodicMemoryRow[]> {
    if (minQuality !== undefined) {
      return this.query<EpisodicMemoryRow>(
        `SELECT id, agent_id, owner_id, situation, action, outcome,
                outcome_quality, embedding, execution_id, metadata, created_at
         FROM forge_episodic_memories
         WHERE agent_id = $1
           AND outcome_quality >= $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [agentId, minQuality, limit],
      );
    }

    return this.query<EpisodicMemoryRow>(
      `SELECT id, agent_id, owner_id, situation, action, outcome,
              outcome_quality, embedding, execution_id, metadata, created_at
       FROM forge_episodic_memories
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [agentId, limit],
    );
  }

  /**
   * Retrieve a single episode by ID.
   */
  async getById(id: string): Promise<EpisodicMemoryRow | null> {
    return this.queryOne<EpisodicMemoryRow>(
      `SELECT id, agent_id, owner_id, situation, action, outcome,
              outcome_quality, embedding, execution_id, metadata, created_at
       FROM forge_episodic_memories
       WHERE id = $1`,
      [id],
    );
  }

  /**
   * Delete an episodic memory by ID. Returns true if a row was removed.
   */
  async delete(id: string): Promise<boolean> {
    const rows = await this.query(
      `DELETE FROM forge_episodic_memories WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }
}
