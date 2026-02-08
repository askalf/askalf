/**
 * Memory Manager - Unified 4-Tier Memory Interface
 * Coordinates working, semantic, episodic, and procedural memory tiers.
 * Provides a single recall() that searches across enabled tiers and
 * a store() that routes data to the appropriate tier.
 */

import type { Redis } from 'ioredis';
import type pg from 'pg';
import { WorkingMemory } from './working.js';
import { SemanticMemory } from './semantic.js';
import type { SemanticSearchResult, SemanticStoreOptions } from './semantic.js';
import { EpisodicMemory } from './episodic.js';
import type { EpisodicSearchResult } from './episodic.js';
import { ProceduralMemory } from './procedural.js';
import type { ProceduralSearchResult, ToolStep } from './procedural.js';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

type QueryFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T[]>;

type QueryOneFn = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
) => Promise<T | null>;

/** Signature for an external embedding function (e.g. OpenAI ada-002). */
export type EmbedFn = (text: string) => Promise<number[]>;

/**
 * Per-agent memory configuration (maps to agent.memory_config JSONB).
 * Each tier can be individually enabled/disabled with optional settings.
 */
export interface MemoryConfig {
  working: {
    enabled: boolean;
    ttlSeconds?: number;
  };
  semantic: {
    enabled: boolean;
    k?: number;
    minSimilarity?: number;
  };
  episodic: {
    enabled: boolean;
    k?: number;
    minQuality?: number;
  };
  procedural: {
    enabled: boolean;
    k?: number;
  };
}

/** Options passed to recall() to control search behaviour. */
export interface RecallOptions {
  /** Override which tiers to search (defaults to all enabled tiers). */
  tiers?: Array<'working' | 'semantic' | 'episodic' | 'procedural'>;
  /** Session ID for working memory lookup. Required if working tier is enabled. */
  sessionId?: string;
  /** Max results per vector tier. Overrides per-tier config. */
  k?: number;
  /** Minimum cosine similarity for semantic search. */
  minSimilarity?: number;
}

/** Combined results from a multi-tier recall. */
export interface RecallResult {
  working: Record<string, string> | null;
  semantic: SemanticSearchResult[];
  episodic: EpisodicSearchResult[];
  procedural: ProceduralSearchResult[];
}

/** Discriminated union for store() input. */
export type StoreInput =
  | {
      type: 'semantic';
      ownerId: string;
      content: string;
      options?: SemanticStoreOptions;
    }
  | {
      type: 'episodic';
      ownerId: string;
      situation: string;
      action: string;
      outcome: string;
      quality: number;
      executionId?: string;
      metadata?: Record<string, unknown>;
    }
  | {
      type: 'procedural';
      ownerId: string;
      triggerPattern: string;
      toolSequence: ToolStep[];
      metadata?: Record<string, unknown>;
    };

// --------------------------------------------------------------------------
// Default configuration
// --------------------------------------------------------------------------

const DEFAULT_CONFIG: MemoryConfig = {
  working: { enabled: true, ttlSeconds: 3600 },
  semantic: { enabled: true, k: 5, minSimilarity: 0.3 },
  episodic: { enabled: true, k: 3 },
  procedural: { enabled: true, k: 3 },
};

// --------------------------------------------------------------------------
// Manager
// --------------------------------------------------------------------------

export class MemoryManager {
  public readonly working: WorkingMemory;
  public readonly semantic: SemanticMemory;
  public readonly episodic: EpisodicMemory;
  public readonly procedural: ProceduralMemory;

  private readonly embed: EmbedFn;
  private readonly config: MemoryConfig;

  constructor(
    query: QueryFn,
    queryOne: QueryOneFn,
    redis: Redis,
    embed: EmbedFn,
    config?: Partial<MemoryConfig>,
  ) {
    this.embed = embed;

    // Merge provided config with defaults (shallow per-tier merge).
    this.config = {
      working: { ...DEFAULT_CONFIG.working, ...config?.working },
      semantic: { ...DEFAULT_CONFIG.semantic, ...config?.semantic },
      episodic: { ...DEFAULT_CONFIG.episodic, ...config?.episodic },
      procedural: { ...DEFAULT_CONFIG.procedural, ...config?.procedural },
    };

    const ttl = this.config.working.ttlSeconds ?? DEFAULT_CONFIG.working.ttlSeconds ?? 3600;
    this.working = new WorkingMemory(redis, ttl);
    this.semantic = new SemanticMemory(query, queryOne);
    this.episodic = new EpisodicMemory(query, queryOne);
    this.procedural = new ProceduralMemory(query, queryOne);
  }

  /**
   * Search across all enabled memory tiers and return combined results.
   * The query text is embedded once and reused for every vector-backed tier.
   */
  async recall(
    agentId: string,
    queryText: string,
    options?: RecallOptions,
  ): Promise<RecallResult> {
    const activeTiers = options?.tiers ?? this.enabledTiers();
    const k = options?.k;

    // We lazily compute the embedding only if a vector tier is needed.
    let embedding: number[] | undefined;

    const needsEmbedding =
      activeTiers.includes('semantic') ||
      activeTiers.includes('episodic') ||
      activeTiers.includes('procedural');

    if (needsEmbedding) {
      embedding = await this.embed(queryText);
    }

    // Fire all tier searches concurrently.
    const [workingResult, semanticResult, episodicResult, proceduralResult] =
      await Promise.all([
        // Working memory
        activeTiers.includes('working') && options?.sessionId
          ? this.working.getAll(agentId, options.sessionId)
          : Promise.resolve(null),

        // Semantic memory
        activeTiers.includes('semantic') && embedding
          ? this.semantic.search(
              agentId,
              embedding,
              k ?? this.config.semantic.k ?? 5,
              options?.minSimilarity ?? this.config.semantic.minSimilarity ?? 0.0,
            )
          : Promise.resolve([] as SemanticSearchResult[]),

        // Episodic memory
        activeTiers.includes('episodic') && embedding
          ? this.episodic.search(
              agentId,
              embedding,
              k ?? this.config.episodic.k ?? 3,
            )
          : Promise.resolve([] as EpisodicSearchResult[]),

        // Procedural memory
        activeTiers.includes('procedural') && embedding
          ? this.procedural.search(
              agentId,
              embedding,
              k ?? this.config.procedural.k ?? 3,
            )
          : Promise.resolve([] as ProceduralSearchResult[]),
      ]);

    return {
      working: workingResult,
      semantic: semanticResult,
      episodic: episodicResult,
      procedural: proceduralResult,
    };
  }

  /**
   * Store a memory into the appropriate tier.
   * Automatically generates embeddings for vector-backed tiers.
   * Returns the ID of the stored memory.
   */
  async store(agentId: string, input: StoreInput): Promise<string> {
    switch (input.type) {
      case 'semantic': {
        const embedding = await this.embed(input.content);
        return this.semantic.store(
          agentId,
          input.ownerId,
          input.content,
          embedding,
          input.options,
        );
      }

      case 'episodic': {
        // Embed the situation for future similarity search.
        const text = `${input.situation}\n${input.action}\n${input.outcome}`;
        const embedding = await this.embed(text);
        return this.episodic.store(
          agentId,
          input.ownerId,
          input.situation,
          input.action,
          input.outcome,
          input.quality,
          embedding,
          input.executionId,
          input.metadata,
        );
      }

      case 'procedural': {
        const embedding = await this.embed(input.triggerPattern);
        return this.procedural.store(
          agentId,
          input.ownerId,
          input.triggerPattern,
          input.toolSequence,
          embedding,
          input.metadata,
        );
      }
    }
  }

  /**
   * Return the list of tier names that are enabled in the current config.
   */
  private enabledTiers(): Array<'working' | 'semantic' | 'episodic' | 'procedural'> {
    const tiers: Array<'working' | 'semantic' | 'episodic' | 'procedural'> = [];
    if (this.config.working.enabled) tiers.push('working');
    if (this.config.semantic.enabled) tiers.push('semantic');
    if (this.config.episodic.enabled) tiers.push('episodic');
    if (this.config.procedural.enabled) tiers.push('procedural');
    return tiers;
  }
}
