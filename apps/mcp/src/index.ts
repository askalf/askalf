#!/usr/bin/env node

// MUST be set before any imports to silence pino logging
// MCP uses stdio for JSON-RPC, so we cannot have any stdout output
process.env['LOG_LEVEL'] = 'silent';
process.env['PINO_LOG_LEVEL'] = 'silent';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { initializePool, query, queryOne } from '@substrate/database';
import { initializeAI, generateEmbedding, extractIntent } from '@substrate/ai';
import { procedural, episodic, semantic, working, TenantContext, Visibility } from '@substrate/memory';
import { execute as executeShard } from '@substrate/sandbox';
// Traces are unlimited - no usage tracking needed

// MCP uses stdio for JSON-RPC, so we use stderr for logging
const log = (msg: string) => process.stderr.write(`[substrate-mcp] ${msg}\n`);

// Initialize database connection
const databaseUrl = process.env['DATABASE_URL'] ?? 'postgresql://substrate:substrate_dev@localhost:5432/substrate';
initializePool({ connectionString: databaseUrl });

// Initialize AI (for embeddings)
initializeAI({
  anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
  openaiApiKey: process.env['OPENAI_API_KEY'],
});

// ============================================
// TENANT CONTEXT
// ============================================
// MCP servers typically run locally per user, so tenant ID can be configured via env var
// If not set, operates in system mode (sees all public content)
const TENANT_ID = process.env['SUBSTRATE_TENANT_ID'];
const TENANT_VISIBILITY = (process.env['SUBSTRATE_VISIBILITY'] ?? 'public') as Visibility;

// Build tenant context if tenant ID is configured
const tenantContext: TenantContext | undefined = TENANT_ID
  ? { tenantId: TENANT_ID }
  : undefined;

if (TENANT_ID) {
  log(`Operating as tenant: ${TENANT_ID} (visibility: ${TENANT_VISIBILITY})`);
} else {
  log('Operating in system mode (no tenant ID configured)');
}

// Create MCP Server
const server = new Server(
  {
    name: 'substrate',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// ===========================================
// TOOL DEFINITIONS
// ===========================================

const TOOLS = [
  {
    name: 'execute_shard',
    description: 'Execute a procedural shard (learned procedure) by ID or semantic search. Returns the computed result without using LLM tokens.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        shardId: {
          type: 'string',
          description: 'The ID of the shard to execute (optional if using query)',
        },
        query: {
          type: 'string',
          description: 'Semantic search query to find a matching shard (optional if using shardId)',
        },
        input: {
          type: 'string',
          description: 'The input to pass to the shard',
        },
      },
      required: ['input'],
    },
  },
  {
    name: 'search_shards',
    description: 'Search for procedural shards by semantic similarity. Use this to discover what learned procedures are available.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'ingest_trace',
    description: 'Record a reasoning trace for future crystallization into a procedural shard. Call this after completing a task to help the system learn.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        input: {
          type: 'string',
          description: 'The original user input/request',
        },
        reasoning: {
          type: 'string',
          description: 'Your reasoning process (optional)',
        },
        output: {
          type: 'string',
          description: 'The final output/response',
        },
        tokensUsed: {
          type: 'number',
          description: 'Approximate tokens used for this interaction',
        },
      },
      required: ['input', 'output'],
    },
  },
  {
    name: 'recall_episodes',
    description: 'Search episodic memory for similar past experiences. Returns Situation-Action-Outcome chains with lessons learned.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Description of the current situation to find similar episodes',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'query_knowledge',
    description: 'Query the semantic knowledge store for facts. Returns confidence-weighted knowledge with sources.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        subject: {
          type: 'string',
          description: 'The subject to query about (optional)',
        },
        query: {
          type: 'string',
          description: 'Semantic search query for facts (optional)',
        },
        minConfidence: {
          type: 'number',
          description: 'Minimum confidence threshold (0-1, default: 0.5)',
        },
      },
    },
  },
  {
    name: 'store_fact',
    description: 'Store a learned fact in semantic memory. Use this to persist important knowledge.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        subject: {
          type: 'string',
          description: 'The subject of the fact',
        },
        predicate: {
          type: 'string',
          description: 'The relationship/predicate',
        },
        object: {
          type: 'string',
          description: 'The object of the fact',
        },
        confidence: {
          type: 'number',
          description: 'Confidence level (0-1, default: 0.7)',
        },
        source: {
          type: 'string',
          description: 'Source of this knowledge',
        },
      },
      required: ['subject', 'predicate', 'object'],
    },
  },
  {
    name: 'get_stats',
    description: 'Get SUBSTRATE system statistics including shard counts, execution metrics, and token savings.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'record_episode',
    description: 'Record an episode (Situation-Action-Outcome chain) in episodic memory. Use this to store experiences that can inform future similar situations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        situation: {
          type: 'string',
          description: 'Description of the situation/context that prompted the action',
        },
        action: {
          type: 'string',
          description: 'Description of the action taken',
        },
        outcome: {
          type: 'string',
          description: 'Description of the outcome/result',
        },
        type: {
          type: 'string',
          description: 'Category of episode: debugging, optimization, refactoring, deployment, learning, problem-solving, etc.',
        },
        success: {
          type: 'boolean',
          description: 'Whether the outcome was successful',
        },
        lessons: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lessons learned from this experience (array of strings)',
        },
        importance: {
          type: 'number',
          description: 'Importance score from 0 to 1 (default: 0.5)',
        },
      },
      required: ['situation', 'action', 'outcome', 'type', 'success'],
    },
  },
  // ===========================================
  // WORKING MEMORY TOOLS
  // ===========================================
  {
    name: 'create_context',
    description: 'Create a working memory context to store temporary information for the current session. Contexts are automatically processed to extract facts and can be promoted to semantic memory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The content to store in working memory',
        },
        contentType: {
          type: 'string',
          description: 'Type of content: decision, error, instruction, task, observation, conversation (default: observation)',
        },
        sessionId: {
          type: 'string',
          description: 'Session identifier to group related contexts (default: generated)',
        },
        ttlSeconds: {
          type: 'number',
          description: 'Time-to-live in seconds (default: 3600 = 1 hour)',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'liquidate_context',
    description: 'Process a working memory context to extract facts, remove noise, and compress information. High-importance contexts can be promoted to semantic memory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        contextId: {
          type: 'string',
          description: 'The ID of the context to liquidate',
        },
        promoteIfImportant: {
          type: 'boolean',
          description: 'Automatically promote to semantic memory if importance >= 0.7 (default: true)',
        },
      },
      required: ['contextId'],
    },
  },
  {
    name: 'get_session_context',
    description: 'Get a compressed summary of relevant context for a session, useful for maintaining continuity across conversations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to get context for',
        },
        currentInput: {
          type: 'string',
          description: 'Current user input to find relevant context',
        },
        maxTokens: {
          type: 'number',
          description: 'Maximum tokens to return (default: 2000)',
        },
      },
      required: ['sessionId'],
    },
  },
  {
    name: 'find_similar_contexts',
    description: 'Find working memory contexts similar to a search query using embedding similarity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query to find similar contexts',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default: 5)',
        },
        sessionId: {
          type: 'string',
          description: 'Optional session ID to filter results',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_working_stats',
    description: 'Get working memory statistics for a session including context counts, compression ratios, and token savings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sessionId: {
          type: 'string',
          description: 'The session ID to get stats for',
        },
      },
      required: ['sessionId'],
    },
  },
  // ===========================================
  // SIGIL COMMUNICATION TOOLS
  // ===========================================
  {
    name: 'broadcast_sigil',
    description: 'Broadcast a SIGIL message to the network for AI-to-AI communication. Use this to communicate with other Claude instances (CODE-CLI, CHROME-WEB). SIGIL format: [DOMAIN.OP:target{key:value}]',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sigil: {
          type: 'string',
          description: 'The SIGIL message in format [DOMAIN.OP:target{key:value}]. Domains: MEM, KNO, CTX, PRO, QRY, SYN. Ops: SET, GET, MUT, VAL, GEN, TEACH, LEARN, BOND',
        },
        metadata: {
          type: 'object',
          description: 'Optional metadata for the message (flow name, sequence number, etc.)',
        },
      },
      required: ['sigil'],
    },
  },
  {
    name: 'read_sigil_feed',
    description: 'Read recent SIGIL messages from the network to see what other Claude instances are communicating.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of messages to retrieve (default: 10)',
        },
      },
    },
  },
];

// ===========================================
// TOOL HANDLERS
// ===========================================

async function handleExecuteShard(args: {
  shardId?: string;
  query?: string;
  input: string;
}): Promise<string> {
  // Validate input
  if (!args.input || typeof args.input !== 'string') {
    return JSON.stringify({
      success: false,
      error: 'Input is required',
      code: 'MISSING_INPUT',
    });
  }

  const trimmedInput = args.input.trim();
  if (trimmedInput.length === 0) {
    return JSON.stringify({
      success: false,
      error: 'Input cannot be empty or whitespace-only',
      code: 'EMPTY_INPUT',
    });
  }

  let shard;
  let matchMethod = 'none';

  if (args.shardId) {
    shard = await procedural.getShardById(args.shardId);
    matchMethod = 'direct';
  } else {
    // Strategy 1: Intent-based matching (preferred)
    // Pass tenant context for visibility filtering
    const intent = await extractIntent(args.input, '');
    shard = await procedural.findShardByIntentTemplate(intent.template, true, 0.55, tenantContext);

    if (shard) {
      matchMethod = 'intent';
    } else if (args.query) {
      // Strategy 2: Semantic search fallback
      const matches = await procedural.findSimilarShards(args.query, 1, tenantContext);
      shard = matches[0];
      if (shard) matchMethod = 'semantic';
    } else {
      // Strategy 3: Try semantic search on input
      const matches = await procedural.findSimilarShards(args.input, 1, tenantContext);
      shard = matches[0];
      if (shard) matchMethod = 'semantic';
    }
  }

  if (!shard) {
    // Record shard_miss episode (matches API flow)
    const episodeOptions = tenantContext
      ? { tenant: tenantContext, visibility: 'private' as Visibility }
      : { visibility: 'public' as Visibility };

    void episodic.recordEpisode({
      situation: {
        context: `User request: ${args.input.substring(0, 200)}`,
        entities: ['shard_matching'],
        state: { matchMethod: 'none' },
      },
      action: {
        type: 'shard_lookup',
        description: 'Attempted to find matching procedural shard',
        parameters: { input: args.input.substring(0, 100) },
      },
      outcome: {
        result: 'No matching shard found',
        success: false,
        effects: ['fallback_required'],
        metrics: {},
      },
      type: 'shard_miss',
      summary: `No shard matched: "${args.input.substring(0, 50)}..."`,
      success: false,
      valence: 'negative',
      importance: 0.6,
      lessonsLearned: [],
      metadata: {},
      timestamp: new Date(),
    }, episodeOptions).catch(err => console.error('Failed to record shard_miss episode:', err));

    return JSON.stringify({
      success: false,
      error: 'No matching shard found. The system may not have learned this procedure yet.',
      suggestion: 'Use ingest_trace to record this interaction for future crystallization.',
    });
  }

  const result = await executeShard(shard.logic, args.input);

  // Record execution in procedural memory (use per-shard token estimate)
  const shardTokens = shard.estimatedTokens || 100;
  await procedural.recordExecution(shard.id, result.success, result.executionMs, result.success ? shardTokens : 0);

  // Record shard_execution episode (matches API flow)
  const execEpisodeOptions = tenantContext
    ? { tenant: tenantContext, visibility: 'private' as Visibility }
    : { visibility: 'public' as Visibility };

  void episodic.recordEpisode({
    situation: {
      context: `User request: ${args.input.substring(0, 200)}`,
      entities: [shard.name, matchMethod],
      state: { shardConfidence: shard.confidence, lifecycle: shard.lifecycle },
    },
    action: {
      type: 'shard_execution',
      description: `Executed shard: ${shard.name}`,
      parameters: { input: args.input.substring(0, 100), matchMethod },
    },
    outcome: {
      result: result.success
        ? `Success: ${String(result.output).substring(0, 100)}`
        : `Failed: ${result.error}`,
      success: result.success,
      effects: result.success ? ['tokens_saved', 'user_served'] : ['error_returned'],
      metrics: { executionMs: result.executionMs },
    },
    type: 'shard_execution',
    summary: result.success
      ? `${shard.name} executed successfully via ${matchMethod} match (${result.executionMs}ms)`
      : `${shard.name} failed: ${result.error}`,
    success: result.success,
    valence: result.success ? 'positive' : 'negative',
    importance: result.success ? 0.4 : 0.7,
    lessonsLearned: result.success ? [] : [`Shard ${shard.name} failed on input pattern`],
    relatedShardId: shard.id,
    metadata: { matchMethod },
    timestamp: new Date(),
  }, execEpisodeOptions).catch(err => console.error('Failed to record shard_execution episode:', err));

  if (result.success) {
    // Use per-shard token estimate for environmental impact
    const tokensSaved = shard.estimatedTokens || 100;
    const waterMlSaved = Math.round((tokensSaved / 1000) * 500);
    const powerWhSaved = parseFloat(((tokensSaved / 1000) * 10).toFixed(2));
    const carbonGSaved = parseFloat(((tokensSaved / 1000) * 5).toFixed(2));

    return JSON.stringify({
      success: true,
      shardId: shard.id,
      shardName: shard.name,
      matchMethod,
      result: result.output,
      executionMs: result.executionMs,
      tokensSaved,
      waterMlSaved,
      powerWhSaved,
      carbonGSaved,
    });
  } else {
    return JSON.stringify({
      success: false,
      shardId: shard.id,
      matchMethod,
      error: result.error ?? 'Execution failed',
    });
  }
}

async function handleSearchShards(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  const limit = args.limit ?? 5;
  const shards = await procedural.findSimilarShards(args.query, limit, tenantContext);

  return JSON.stringify({
    count: shards.length,
    shards: shards.map(s => ({
      id: s.id,
      name: s.name,
      confidence: s.confidence,
      patterns: s.patterns,
      lifecycle: s.lifecycle,
      executionCount: s.executionCount,
      successRate: s.executionCount > 0
        ? (s.successCount / s.executionCount * 100).toFixed(1) + '%'
        : 'N/A',
    })),
  });
}

async function handleIngestTrace(args: {
  input: string;
  reasoning?: string;
  output: string;
  tokensUsed?: number;
}): Promise<string> {
  // Traces are unlimited - no caps, only per-minute throttling for abuse prevention
  const { ids, generatePatternHash } = await import('@substrate/core');
  const { hashIntentTemplate } = await import('@substrate/ai');

  const id = ids.trace();

  // Extract intent template for proper clustering
  const intent = await extractIntent(args.input, args.output);
  const intentHash = hashIntentTemplate(intent.template);

  // Legacy pattern hash for backwards compatibility
  const patternHash = generatePatternHash(args.input, args.output);

  // Generate embedding for similarity search
  const embedding = await generateEmbedding(args.input + ' ' + args.output);

  await query(
    `INSERT INTO reasoning_traces (
      id, input, reasoning, output, pattern_hash, embedding,
      intent_template, intent_category, intent_name, intent_parameters,
      tokens_used, execution_ms, source, owner_id, visibility, timestamp
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 0, $12, $13, $14, NOW())`,
    [
      id,
      args.input,
      args.reasoning ?? null,
      args.output,
      patternHash,
      `[${embedding.join(',')}]`,
      intent.template,
      intent.category,
      intent.intentName,
      JSON.stringify(intent.parameters),
      args.tokensUsed ?? 0,
      'mcp',
      TENANT_ID ?? null,
      TENANT_VISIBILITY,
    ]
  );

  return JSON.stringify({
    success: true,
    traceId: id,
    intentTemplate: intent.template,
    intentHash,
    patternHash,
    message: 'Trace recorded with intent extraction. It will be clustered by intent template in the next metabolic cycle.',
  });
}

async function handleRecallEpisodes(args: {
  query: string;
  limit?: number;
}): Promise<string> {
  const limit = args.limit ?? 5;
  const episodes = await episodic.findSimilarEpisodes(args.query, limit, tenantContext);

  return JSON.stringify({
    count: episodes.length,
    episodes: episodes.map(e => ({
      id: e.id,
      type: e.type,
      summary: e.summary,
      situation: e.situation,
      action: e.action,
      outcome: e.outcome,
      success: e.success,
      lessonsLearned: e.lessonsLearned,
      importance: e.importance,
    })),
  });
}

async function handleQueryKnowledge(args: {
  subject?: string;
  query?: string;
  minConfidence?: number;
}): Promise<string> {
  const minConf = args.minConfidence ?? 0.5;

  let facts;
  if (args.query) {
    facts = await semantic.findSimilarFacts(args.query, 10, tenantContext);
    facts = facts.filter(f => f.confidence >= minConf);
  } else if (args.subject) {
    facts = await semantic.getFactsBySubject(args.subject, tenantContext);
    facts = facts.filter(f => f.confidence >= minConf);
  } else {
    // Get recent high-confidence facts (tenant-scoped)
    const visParams: unknown[] = [minConf];
    let visClause: string;
    if (!tenantContext || tenantContext.tenantId === 'tenant_system') {
      visClause = '1=1';
    } else {
      visParams.push(tenantContext.tenantId);
      visClause = `(visibility = 'public' OR owner_id IS NULL OR (visibility = 'private' AND owner_id = $2))`;
    }
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM knowledge_facts
       WHERE confidence >= $1 AND ${visClause}
       ORDER BY updated_at DESC
       LIMIT 20`,
      visParams
    );
    facts = rows.map(r => ({
      id: r['id'] as string,
      subject: r['subject'] as string,
      predicate: r['predicate'] as string,
      object: r['object'] as string,
      statement: r['statement'] as string,
      confidence: r['confidence'] as number,
      sources: r['sources'] as string[],
    }));
  }

  return JSON.stringify({
    count: facts.length,
    facts: facts.map(f => ({
      statement: f.statement ?? `${f.subject} ${f.predicate} ${f.object}`,
      confidence: f.confidence,
      sources: f.sources,
    })),
  });
}

async function handleStoreFact(args: {
  subject: string;
  predicate: string;
  object: string;
  confidence?: number;
  source?: string;
}): Promise<string> {
  // Build options conditionally to satisfy exactOptionalPropertyTypes
  const factOptions = tenantContext
    ? { tenant: tenantContext, visibility: TENANT_VISIBILITY }
    : { visibility: TENANT_VISIBILITY };

  const fact = await semantic.storeFact({
    subject: args.subject,
    predicate: args.predicate,
    object: args.object,
    statement: `${args.subject} ${args.predicate} ${args.object}`,
    confidence: args.confidence ?? 0.7,
    sources: args.source ? [args.source] : ['mcp'],
    evidence: [],
    category: 'general',
    isTemporal: false,
  }, factOptions);

  return JSON.stringify({
    success: true,
    factId: fact.id,
    message: 'Fact stored in semantic memory.',
  });
}

async function handleRecordEpisode(args: {
  situation: string;
  action: string;
  outcome: string;
  type: string;
  success: boolean;
  lessons?: string[];
  importance?: number;
}): Promise<string> {
  const summary = `${args.type}: ${args.situation.substring(0, 50)}... → ${args.outcome.substring(0, 50)}`;

  // Build options conditionally to satisfy exactOptionalPropertyTypes
  const episodeOptions = tenantContext
    ? { tenant: tenantContext, visibility: TENANT_VISIBILITY }
    : { visibility: TENANT_VISIBILITY };

  const episode = await episodic.recordEpisode({
    situation: { context: args.situation, entities: [], state: {} },
    action: { type: args.type, description: args.action, parameters: {} },
    outcome: { result: args.outcome, success: args.success, effects: [], metrics: {} },
    type: args.type,
    summary,
    success: args.success,
    valence: args.success ? 'positive' : 'negative',
    importance: args.importance ?? 0.5,
    lessonsLearned: args.lessons ?? [],
    timestamp: new Date(),
    metadata: {},
  }, episodeOptions);

  return JSON.stringify({
    success: true,
    episodeId: episode.id,
    summary,
    message: 'Episode recorded in episodic memory. It can be recalled for similar future situations.',
  });
}

// ===========================================
// WORKING MEMORY HANDLERS
// ===========================================

async function handleCreateContext(args: {
  content: string;
  contentType?: string;
  sessionId?: string;
  ttlSeconds?: number;
}): Promise<string> {
  const { ids } = await import('@substrate/core');

  const sessionId = args.sessionId ?? ids.session();
  const contentType = args.contentType ?? 'observation';
  const ttlSeconds = args.ttlSeconds ?? 3600;

  // Estimate tokens (rough: 1 token per 4 chars)
  const originalTokens = Math.ceil(args.content.length / 4);

  // Build options conditionally to satisfy exactOptionalPropertyTypes
  // Working contexts default to private
  const contextOptions = tenantContext
    ? { tenant: tenantContext, visibility: 'private' as const }
    : { visibility: 'private' as const };

  const context = await working.createContext({
    sessionId,
    rawContent: args.content,
    contentType,
    originalTokens,
    ttlSeconds,
    extractedFacts: [],
    extractedEntities: [],
    noiseRemoved: [],
  }, contextOptions);

  return JSON.stringify({
    success: true,
    contextId: context.id,
    sessionId,
    contentType,
    originalTokens,
    expiresAt: context.expiresAt,
    message: 'Context stored in working memory. Use liquidate_context to process and extract facts.',
  });
}

async function handleLiquidateContext(args: {
  contextId: string;
  promoteIfImportant?: boolean;
}): Promise<string> {
  const promoteIfImportant = args.promoteIfImportant ?? true;

  const liquidated = await working.liquidateContext(args.contextId);

  let promoted = { promoted: 0, factIds: [] as string[] };
  const importance = (liquidated as Record<string, unknown>)['importance'] as number ?? 0;

  if (promoteIfImportant && importance >= 0.7) {
    promoted = await working.promoteToSemantic(args.contextId);
  }

  return JSON.stringify({
    success: true,
    contextId: args.contextId,
    status: promoted.promoted > 0 ? 'promoted' : 'liquidated',
    importance: importance.toFixed(2),
    extractedFacts: liquidated.extractedFacts?.length ?? 0,
    extractedEntities: liquidated.extractedEntities?.length ?? 0,
    compressionRatio: liquidated.compressionRatio?.toFixed(2) ?? 'N/A',
    originalTokens: liquidated.originalTokens,
    liquidatedTokens: liquidated.liquidatedTokens,
    promotedFacts: promoted.promoted,
    factIds: promoted.factIds,
    message: promoted.promoted > 0
      ? `Context liquidated and ${promoted.promoted} facts promoted to semantic memory.`
      : 'Context liquidated. Facts extracted but not promoted (importance below threshold).',
  });
}

async function handleGetSessionContext(args: {
  sessionId: string;
  currentInput?: string;
  maxTokens?: number;
}): Promise<string> {
  const currentInput = args.currentInput ?? '';
  const maxTokens = args.maxTokens ?? 2000;

  const result = await working.getContextForContinuation(
    args.sessionId,
    currentInput,
    maxTokens
  );

  return JSON.stringify({
    success: true,
    sessionId: args.sessionId,
    contextCount: result.contexts.length,
    totalTokens: result.totalTokens,
    summary: result.summary,
    contexts: result.contexts.map(c => ({
      id: c.id,
      contentType: c.contentType,
      status: c.status,
    })),
  });
}

async function handleFindSimilarContexts(args: {
  query: string;
  limit?: number;
  sessionId?: string;
}): Promise<string> {
  const limit = args.limit ?? 5;

  const contexts = await working.findSimilarContexts(
    args.query,
    limit,
    args.sessionId,
    tenantContext
  );

  return JSON.stringify({
    count: contexts.length,
    contexts: contexts.map(c => ({
      id: c.id,
      sessionId: c.sessionId,
      contentType: c.contentType,
      status: c.status,
      rawContent: c.rawContent.substring(0, 200) + (c.rawContent.length > 200 ? '...' : ''),
      importance: (c as Record<string, unknown>)['importance'] ?? 0,
    })),
  });
}

async function handleGetWorkingStats(args: {
  sessionId: string;
}): Promise<string> {
  const stats = await working.getSessionStats(args.sessionId);

  return JSON.stringify({
    sessionId: args.sessionId,
    total: stats.total,
    raw: stats.raw,
    liquidated: stats.liquidated,
    promoted: stats.promoted,
    avgImportance: stats.avgImportance.toFixed(2),
    totalTokensSaved: stats.totalTokensSaved,
  });
}

async function handleGetStats(): Promise<string> {
  const shardStats = await queryOne<{
    total: string;
    promoted: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE lifecycle = 'promoted') as promoted
     FROM procedural_shards`
  );

  const traceStats = await queryOne<{
    total: string;
    synthesized: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE synthesized = true) as synthesized
     FROM reasoning_traces`
  );

  const execStats = await queryOne<{
    total: string;
    successful: string;
    tokens_saved: string;
  }>(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE success = true) as successful,
       COALESCE(SUM(tokens_saved), 0) as tokens_saved
     FROM shard_executions`
  );

  const episodeCount = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM episodes'
  );

  const factCount = await queryOne<{ count: string }>(
    'SELECT COUNT(*) as count FROM knowledge_facts'
  );

  return JSON.stringify({
    shards: {
      total: parseInt(shardStats?.total ?? '0'),
      promoted: parseInt(shardStats?.promoted ?? '0'),
    },
    traces: {
      total: parseInt(traceStats?.total ?? '0'),
      synthesized: parseInt(traceStats?.synthesized ?? '0'),
    },
    executions: {
      total: parseInt(execStats?.total ?? '0'),
      successful: parseInt(execStats?.successful ?? '0'),
      successRate: execStats && parseInt(execStats.total) > 0
        ? (parseInt(execStats.successful) / parseInt(execStats.total) * 100).toFixed(1) + '%'
        : 'N/A',
      tokensSaved: parseInt(execStats?.tokens_saved ?? '0'),
    },
    memory: {
      episodes: parseInt(episodeCount?.count ?? '0'),
      facts: parseInt(factCount?.count ?? '0'),
    },
  });
}

// ===========================================
// SIGIL COMMUNICATION HANDLERS
// ===========================================

const SIGIL_API_BASE = process.env['SIGIL_API_BASE'] ?? 'https://api.askalf.org';

async function handleBroadcastSigil(args: {
  sigil: string;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  // Validate SIGIL format
  if (!args.sigil.startsWith('[') || !args.sigil.endsWith(']')) {
    return JSON.stringify({
      success: false,
      error: 'Invalid SIGIL format. Must be wrapped in brackets: [DOMAIN.OP:target{key:value}]',
    });
  }

  try {
    const response = await fetch(`${SIGIL_API_BASE}/api/v1/sigil/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sigil: args.sigil,
        sender: 'CLAUDE-DESKTOP',
        metadata: args.metadata ?? {},
      }),
    });

    if (response.ok) {
      const data = await response.json() as { success: boolean; id: string };
      log(`SIGIL broadcast: ${args.sigil}`);
      return JSON.stringify({
        success: true,
        id: data.id,
        sigil: args.sigil,
        sender: 'CLAUDE-DESKTOP',
        message: 'SIGIL message broadcast to network. Visible at askalf.org',
      });
    } else {
      const error = await response.text();
      return JSON.stringify({
        success: false,
        error: `Broadcast failed: ${error}`,
      });
    }
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Network error: ${error instanceof Error ? error.message : 'Unknown'}`,
    });
  }
}

async function handleReadSigilFeed(args: {
  limit?: number;
}): Promise<string> {
  const limit = args.limit ?? 10;

  try {
    // Query recent working memory contexts that contain SIGIL messages
    const contexts = await query<Record<string, unknown>>(
      `SELECT id, raw_content, content_type, created_at
       FROM working_contexts
       WHERE content_type = 'sigil' OR raw_content LIKE '[%]%'
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );

    return JSON.stringify({
      count: contexts.length,
      messages: contexts.map(c => ({
        id: c['id'],
        content: c['raw_content'],
        timestamp: c['created_at'],
      })),
      note: 'For live feed, visit askalf.org',
    });
  } catch (error) {
    return JSON.stringify({
      success: false,
      error: `Failed to read feed: ${error instanceof Error ? error.message : 'Unknown'}`,
    });
  }
}

// ===========================================
// MCP REQUEST HANDLERS
// ===========================================

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  log(`Tool called: ${name}`);

  try {
    let result: string;

    switch (name) {
      case 'execute_shard':
        result = await handleExecuteShard(args as Parameters<typeof handleExecuteShard>[0]);
        break;
      case 'search_shards':
        result = await handleSearchShards(args as Parameters<typeof handleSearchShards>[0]);
        break;
      case 'ingest_trace':
        result = await handleIngestTrace(args as Parameters<typeof handleIngestTrace>[0]);
        break;
      case 'recall_episodes':
        result = await handleRecallEpisodes(args as Parameters<typeof handleRecallEpisodes>[0]);
        break;
      case 'query_knowledge':
        result = await handleQueryKnowledge(args as Parameters<typeof handleQueryKnowledge>[0]);
        break;
      case 'store_fact':
        result = await handleStoreFact(args as Parameters<typeof handleStoreFact>[0]);
        break;
      case 'get_stats':
        result = await handleGetStats();
        break;
      case 'record_episode':
        result = await handleRecordEpisode(args as Parameters<typeof handleRecordEpisode>[0]);
        break;
      case 'create_context':
        result = await handleCreateContext(args as Parameters<typeof handleCreateContext>[0]);
        break;
      case 'liquidate_context':
        result = await handleLiquidateContext(args as Parameters<typeof handleLiquidateContext>[0]);
        break;
      case 'get_session_context':
        result = await handleGetSessionContext(args as Parameters<typeof handleGetSessionContext>[0]);
        break;
      case 'find_similar_contexts':
        result = await handleFindSimilarContexts(args as Parameters<typeof handleFindSimilarContexts>[0]);
        break;
      case 'get_working_stats':
        result = await handleGetWorkingStats(args as Parameters<typeof handleGetWorkingStats>[0]);
        break;
      case 'broadcast_sigil':
        result = await handleBroadcastSigil(args as Parameters<typeof handleBroadcastSigil>[0]);
        break;
      case 'read_sigil_feed':
        result = await handleReadSigilFeed(args as Parameters<typeof handleReadSigilFeed>[0]);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: 'text', text: result }],
    };
  } catch (error) {
    log(`Tool execution failed: ${name} - ${error}`);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: error instanceof Error ? error.message : 'Unknown error',
        }),
      }],
      isError: true,
    };
  }
});

// ===========================================
// RESOURCES (for context/prompts)
// ===========================================

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'substrate://stats',
        name: 'System Statistics',
        description: 'Current SUBSTRATE system statistics',
        mimeType: 'application/json',
      },
      {
        uri: 'substrate://shards/promoted',
        name: 'Promoted Shards',
        description: 'List of all promoted (production) shards',
        mimeType: 'application/json',
      },
    ],
  };
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'substrate://stats') {
    const stats = await handleGetStats();
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: stats,
      }],
    };
  }

  if (uri === 'substrate://shards/promoted') {
    const shards = await query<Record<string, unknown>>(
      `SELECT id, name, patterns, confidence, execution_count, success_count
       FROM procedural_shards
       WHERE lifecycle = 'promoted'
       ORDER BY confidence DESC`
    );

    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          count: shards.length,
          shards: shards.map(s => ({
            id: s['id'],
            name: s['name'],
            patterns: s['patterns'],
            confidence: s['confidence'],
            executionCount: s['execution_count'],
            successCount: s['success_count'],
          })),
        }),
      }],
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// ===========================================
// START SERVER
// ===========================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('SUBSTRATE MCP server started');
}

main().catch((error) => {
  log(`Failed to start MCP server: ${error}`);
  process.exit(1);
});
