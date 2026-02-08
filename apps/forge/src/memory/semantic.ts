/**
 * Semantic Memory - Tier 2
 * pgvector-backed long-term knowledge store.
 * Content is embedded and stored with vector similarity search via cosine distance.
 */

import { ulid } from 'ulid';
import type pg from 'pg';

/** Function signature matching the database module's query/queryOne exports. */
type QueryFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

type QueryOneFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T | null>;

export interface SemanticMemoryRow {
  id: string;
  agent_id: string;
  owner_id: string;
  content: string;
  embedding: string;
  source: string | null;
  importance: number;
  access_count: number;
  last_accessed: Date;
  metadata: Record<string, unknown> | null;
  created_at: Date;
}

export interface SemanticSearchResult {
  id: string;
  agent_id: string;
  owner_id: string;
  content: string;
  source: string | null;
  importance: number;
  access_count: number;
  metadata: Record<string, unknown> | null;
  similarity: number;
  created_at: Date;
}

export interface SemanticStoreOptions {
  source?: string;
  importance?: number;
  metadata?: Record<string, unknown>;
}

export class SemanticMemory {
  private readonly query: QueryFn;
  private readonly queryOne: QueryOneFn;

  constructor(query: QueryFn, queryOne: QueryOneFn) {
    this.query = query;
    this.queryOne = queryOne;
  }

  /**
   * Format a float[] embedding into the pgvector literal string '[0.1,0.2,...]'.
   */
  private static formatEmbedding(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }

  /**
   * Store a new semantic memory.
   */
  async store(
    agentId: string,
    ownerId: string,
    content: string,
    embedding: number[],
    opts?: SemanticStoreOptions,
  ): Promise<string> {
    const id = ulid();
    const source = opts?.source ?? null;
    const importance = opts?.importance ?? 0.5;
    const metadata = opts?.metadata ?? null;

    await this.query(
      `INSERT INTO forge_semantic_memories
         (id, agent_id, owner_id, content, embedding, source, importance, access_count, last_accessed, metadata, created_at)
       VALUES
         ($1, $2, $3, $4, $5::vector, $6, $7, 0, NOW(), $8, NOW())`,
      [
        id,
        agentId,
        ownerId,
        content,
        SemanticMemory.formatEmbedding(embedding),
        source,
        importance,
        metadata ? JSON.stringify(metadata) : null,
      ],
    );

    return id;
  }

  /**
   * Search semantic memories by cosine similarity.
   * Returns up to k results sorted by descending similarity.
   * Updates access_count and last_accessed for returned rows.
   */
  async search(
    agentId: string,
    embedding: number[],
    k: number,
    minSimilarity: number = 0.0,
  ): Promise<SemanticSearchResult[]> {
    const vecLiteral = SemanticMemory.formatEmbedding(embedding);

    const rows = await this.query<SemanticSearchResult>(
      `SELECT
         id, agent_id, owner_id, content, source, importance,
         access_count, metadata, created_at,
         1 - (embedding <=> $1::vector) AS similarity
       FROM forge_semantic_memories
       WHERE agent_id = $2
         AND 1 - (embedding <=> $1::vector) >= $3
       ORDER BY similarity DESC
       LIMIT $4`,
      [vecLiteral, agentId, minSimilarity, k],
    );

    // Update access metadata for retrieved memories
    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await this.query(
        `UPDATE forge_semantic_memories
         SET access_count = access_count + 1, last_accessed = NOW()
         WHERE id = ANY($1)`,
        [ids],
      );
    }

    return rows;
  }

  /**
   * Retrieve a single memory by ID.
   */
  async getById(id: string): Promise<SemanticMemoryRow | null> {
    return this.queryOne<SemanticMemoryRow>(
      `SELECT id, agent_id, owner_id, content, embedding, source, importance,
              access_count, last_accessed, metadata, created_at
       FROM forge_semantic_memories
       WHERE id = $1`,
      [id],
    );
  }

  /**
   * Delete a semantic memory by ID. Returns true if a row was removed.
   */
  async delete(id: string): Promise<boolean> {
    const rows = await this.query(
      `DELETE FROM forge_semantic_memories WHERE id = $1 RETURNING id`,
      [id],
    );
    return rows.length > 0;
  }
}
