/**
 * Data tool handlers: db_query, substrate_db_query, memory_search, memory_store
 * Migrated from mcp-data server.
 */

import {
  getForgePool,
  getSubstratePool,
  getRedis,
  generateId,
} from '@askalf/db';
import OpenAI from 'openai';

const MAX_ROWS = 100;
const log = (msg: string) => console.log(`[mcp-tools:data] ${new Date().toISOString()} ${msg}`);

// ============================================
// OpenAI Embeddings (for vector memory search)
// ============================================

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY required for fleet memory embeddings');
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

async function embed(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  });
  return response.data[0]!.embedding;
}

// ============================================
// Tool Definitions
// ============================================

export const TOOLS = [
  {
    name: 'db_query',
    description: `Execute a read-only SQL query against the FORGE database. Only SELECT/WITH/EXPLAIN allowed. Max 100 rows. Do NOT end SQL with semicolons.

FORGE DB TABLES:
- forge_agents (id, name, status, system_prompt, model_id, enabled_tools[], autonomy_level, max_iterations, max_cost_per_execution, runtime_mode, created_at)
- forge_executions (id, agent_id, status[pending/running/completed/failed/cancelled/timeout], input, output, iterations, input_tokens, output_tokens, cost, duration_ms, error, started_at, completed_at, parent_execution_id, depth, runtime_mode)
- forge_sessions (id, agent_id, title, is_active, created_at)
- forge_cost_events (id, execution_id, agent_id, provider, model, input_tokens, output_tokens, cost, created_at)
- forge_semantic_memories (id, agent_id, content, importance, access_count, source, created_at)
- forge_episodic_memories (id, agent_id, situation, action, outcome, outcome_quality, execution_id, created_at)
- forge_procedural_memories (id, agent_id, trigger_pattern, tool_sequence, success_count, failure_count, confidence, created_at)
- forge_tools (id, name, display_name, description, type, risk_level, is_enabled)
- forge_audit_log, forge_api_keys, forge_workflows, forge_workflow_runs, forge_checkpoints, forge_models, forge_providers, forge_mcp_servers, forge_guardrails, forge_user_assistants, forge_tool_executions

NOTE: Agent schedules and tickets are in the SUBSTRATE database, not here.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'SQL query (SELECT/WITH/EXPLAIN only). Do NOT end with semicolons.' },
        params: { type: 'array', items: {}, description: 'Query parameters for $1, $2, etc.' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'substrate_db_query',
    description: `Execute a read-only SQL query against the SUBSTRATE database. Only SELECT/WITH/EXPLAIN allowed. Max 100 rows. Do NOT end SQL with semicolons.

SUBSTRATE DB KEY TABLES:
- agent_tickets (id, title, description, status[open/in_progress/resolved/closed], priority[low/medium/high/critical], agent_id, agent_name, assigned_to, resolution, created_at)
- agent_schedules (agent_id, schedule_type[manual/scheduled/continuous], schedule_interval_minutes, next_run_at, last_run_at, is_continuous, execution_mode[batch/individual])
- agent_interventions (id, agent_id, agent_name, type, title, description, proposed_action, status, human_response, created_at)
- agent_findings (id, agent_id, agent_name, finding, severity, category, execution_id, created_at)
- users (id, tenant_id, email, display_name, role, status, created_at)
- procedural_shards (id, name, logic, confidence, execution_count, success_count, lifecycle, intent_template, category, knowledge_type)
- knowledge_facts (id, subject, predicate, object, statement, confidence, category, created_at)
- episodes (id, situation, action, outcome, type, summary, success, importance, agent_id, created_at)
- reasoning_traces (id, input, reasoning, output, intent_category, tokens_used, model, session_id, agent_id)
- tenants, subscriptions, chat_sessions, chat_messages, alf_profiles, deploy_tasks

NOTE: Agent definitions (forge_agents) and executions are in the FORGE database, not here.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string', description: 'SQL query (SELECT/WITH/EXPLAIN only). Do NOT end with semicolons.' },
        params: { type: 'array', items: {}, description: 'Query parameters for $1, $2, etc.' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'memory_search',
    description: 'Search fleet cognitive memory (semantic, episodic, procedural tiers) for relevant knowledge.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        agent_id: { type: 'string', description: 'Agent ID to scope the search' },
        memory_type: { type: 'string', enum: ['semantic', 'episodic', 'procedural', 'all'], description: 'Memory tier to search (default: all)' },
        limit: { type: 'number', description: 'Maximum results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_store',
    description: 'Store knowledge, experiences, or procedures in fleet cognitive memory.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['semantic', 'episodic', 'procedural'], description: 'Memory tier to store in' },
        agent_id: { type: 'string', description: 'Agent ID storing the memory' },
        content: { type: 'string', description: 'Content to store. For episodic: the situation.' },
        action: { type: 'string', description: 'For episodic: the action taken' },
        outcome: { type: 'string', description: 'For episodic: the outcome' },
        quality: { type: 'number', description: 'For episodic: quality 0-1 (1=success, 0=failure)' },
        trigger_pattern: { type: 'string', description: 'For procedural: trigger pattern' },
        tool_sequence: { type: 'array', description: 'For procedural: tool sequence array' },
        importance: { type: 'number', description: 'For semantic: importance 0-1' },
        source: { type: 'string', description: 'Source label' },
        metadata: { type: 'object', description: 'Additional metadata' },
      },
      required: ['type', 'content'],
    },
  },
];

// ============================================
// Handlers
// ============================================

function validateReadOnly(sql: string): string | null {
  const trimmed = sql.trim().toUpperCase();
  if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH') && !trimmed.startsWith('EXPLAIN')) {
    return 'Only SELECT, WITH (CTE), and EXPLAIN queries are allowed';
  }
  // Reject multi-statement queries (semicolons followed by more SQL)
  const stripped = trimmed.replace(/;[\s]*$/, ''); // trailing semicolons are OK to strip
  if (stripped.includes(';')) {
    return 'Multi-statement queries are not allowed. Send one query at a time.';
  }
  return null;
}

/**
 * Clean SQL: strip trailing semicolons/whitespace to prevent "LIMIT" append syntax errors.
 */
function cleanSql(sql: string): string {
  return sql.trim().replace(/;[\s]*$/, '').trim();
}

async function handleDbQuery(args: Record<string, unknown>): Promise<string> {
  const rawSql = args['sql'] as string;
  const params = (args['params'] as unknown[]) ?? [];

  const error = validateReadOnly(rawSql);
  if (error) return JSON.stringify({ error });

  try {
    const p = getForgePool();
    let sql = cleanSql(rawSql);
    if (!sql.toUpperCase().includes('LIMIT')) {
      sql = `${sql} LIMIT ${MAX_ROWS}`;
    }
    const result = await p.query(sql, params);
    return JSON.stringify({ rows: result.rows, rowCount: result.rows.length, truncated: result.rows.length >= MAX_ROWS, database: 'forge' });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err), hint: 'Check table/column names against the schema in this tool\'s description.' });
  }
}

async function handleSubstrateDbQuery(args: Record<string, unknown>): Promise<string> {
  const rawSql = args['sql'] as string;
  const params = (args['params'] as unknown[]) ?? [];

  const error = validateReadOnly(rawSql);
  if (error) return JSON.stringify({ error });

  try {
    const p = getSubstratePool();
    let sql = cleanSql(rawSql);
    if (!sql.toUpperCase().includes('LIMIT')) {
      sql = `${sql} LIMIT ${MAX_ROWS}`;
    }
    const result = await p.query(sql, params);
    return JSON.stringify({ rows: result.rows, rowCount: result.rows.length, truncated: result.rows.length >= MAX_ROWS, database: 'substrate' });
  } catch (err) {
    return JSON.stringify({ error: err instanceof Error ? err.message : String(err), hint: 'Check table/column names against the schema in this tool\'s description.' });
  }
}

async function handleMemorySearch(args: Record<string, unknown>): Promise<string> {
  const queryText = args['query'] as string;
  const agentId = (args['agent_id'] as string) ?? null;
  const memoryType = (args['memory_type'] as string) ?? 'all';
  const limit = (args['limit'] as number) ?? 5;

  if (!queryText.trim()) return JSON.stringify({ error: 'Search query cannot be empty' });

  try {
    const p = getForgePool();
    const memories: Array<Record<string, unknown>> = [];

    let queryEmbedding: number[];
    try {
      queryEmbedding = await embed(queryText);
    } catch (embErr) {
      log(`Embedding failed, falling back to text search: ${embErr}`);
      return handleMemorySearchFallback(args);
    }

    const vecLiteral = `[${queryEmbedding.join(',')}]`;

    if (memoryType === 'all' || memoryType === 'semantic') {
      try {
        const agentFilter = agentId ? 'AND agent_id = $2' : '';
        const params: unknown[] = [vecLiteral];
        if (agentId) params.push(agentId);

        const result = await p.query(
          `SELECT id, agent_id, content, source, importance, access_count,
                  1 - (embedding <=> $1::vector) AS similarity, created_at
           FROM forge_semantic_memories
           WHERE embedding IS NOT NULL ${agentFilter}
           ORDER BY embedding <=> $1::vector
           LIMIT ${limit}`,
          params,
        );
        for (const row of result.rows) {
          const r = row as Record<string, unknown>;
          memories.push({ id: r['id'], memoryType: 'semantic', content: r['content'], source: r['source'], importance: r['importance'], similarity: r['similarity'], agentId: r['agent_id'], createdAt: r['created_at'] });
        }
      } catch (err) { log(`Semantic search error: ${err}`); }
    }

    if (memoryType === 'all' || memoryType === 'episodic') {
      try {
        const agentFilter = agentId ? 'AND agent_id = $2' : '';
        const params: unknown[] = [vecLiteral];
        if (agentId) params.push(agentId);

        const result = await p.query(
          `SELECT id, agent_id, situation, action, outcome, outcome_quality,
                  execution_id, 1 - (embedding <=> $1::vector) AS similarity, created_at
           FROM forge_episodic_memories
           WHERE embedding IS NOT NULL ${agentFilter}
           ORDER BY embedding <=> $1::vector
           LIMIT ${limit}`,
          params,
        );
        for (const row of result.rows) {
          const r = row as Record<string, unknown>;
          memories.push({ id: r['id'], memoryType: 'episodic', situation: r['situation'], action: r['action'], outcome: r['outcome'], quality: r['outcome_quality'], similarity: r['similarity'], agentId: r['agent_id'], executionId: r['execution_id'], createdAt: r['created_at'] });
        }
      } catch (err) { log(`Episodic search error: ${err}`); }
    }

    if (memoryType === 'all' || memoryType === 'procedural') {
      try {
        const agentFilter = agentId ? 'AND agent_id = $2' : '';
        const params: unknown[] = [vecLiteral];
        if (agentId) params.push(agentId);

        const result = await p.query(
          `SELECT id, agent_id, trigger_pattern, tool_sequence, success_count,
                  failure_count, confidence, 1 - (embedding <=> $1::vector) AS similarity, created_at
           FROM forge_procedural_memories
           WHERE embedding IS NOT NULL ${agentFilter}
           ORDER BY embedding <=> $1::vector
           LIMIT ${limit}`,
          params,
        );
        for (const row of result.rows) {
          const r = row as Record<string, unknown>;
          memories.push({ id: r['id'], memoryType: 'procedural', triggerPattern: r['trigger_pattern'], toolSequence: r['tool_sequence'], confidence: r['confidence'], successCount: r['success_count'], failureCount: r['failure_count'], similarity: r['similarity'], agentId: r['agent_id'], createdAt: r['created_at'] });
        }
      } catch (err) { log(`Procedural search error: ${err}`); }
    }

    // Check Redis working memory if agent specified
    if (agentId && (memoryType === 'all' || memoryType === 'working')) {
      try {
        const redis = getRedis();
        let cursor = '0';
        const wmKeys: string[] = [];
        do {
          const [next, found] = await redis.scan(cursor, 'MATCH', `fleet:forge:wm:${agentId}:*`, 'COUNT', 50);
          cursor = next;
          wmKeys.push(...found);
        } while (cursor !== '0');

        for (const key of wmKeys.slice(0, 3)) {
          const data = await redis.hgetall(key);
          if (Object.keys(data).length > 0) {
            memories.push({ memoryType: 'working', key, fields: Object.keys(data), agentId });
          }
        }
      } catch { /* working memory scan failed, non-fatal */ }
    }

    return JSON.stringify({ query: queryText, memoryType, memories, total: memories.length });
  } catch (err) {
    return JSON.stringify({ error: `Memory search failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

async function handleMemorySearchFallback(args: Record<string, unknown>): Promise<string> {
  const queryText = args['query'] as string;
  const agentId = (args['agent_id'] as string) ?? null;
  const memoryType = (args['memory_type'] as string) ?? 'all';
  const limit = (args['limit'] as number) ?? 5;

  const p = getForgePool();
  const memories: Array<Record<string, unknown>> = [];
  const agentFilter = agentId ? 'AND agent_id = $2' : '';
  const baseParams: unknown[] = [`%${queryText}%`];
  if (agentId) baseParams.push(agentId);

  if (memoryType === 'all' || memoryType === 'semantic') {
    try {
      const result = await p.query(
        `SELECT id, agent_id, content, source, importance, created_at FROM forge_semantic_memories WHERE content ILIKE $1 ${agentFilter} ORDER BY importance DESC LIMIT ${limit}`,
        baseParams,
      );
      for (const r of result.rows as Array<Record<string, unknown>>) {
        memories.push({ id: r['id'], memoryType: 'semantic', content: r['content'], importance: r['importance'], agentId: r['agent_id'], createdAt: r['created_at'] });
      }
    } catch { /* */ }
  }

  if (memoryType === 'all' || memoryType === 'episodic') {
    try {
      const result = await p.query(
        `SELECT id, agent_id, situation, action, outcome, outcome_quality, created_at FROM forge_episodic_memories WHERE situation ILIKE $1 OR action ILIKE $1 OR outcome ILIKE $1 ${agentFilter} ORDER BY outcome_quality DESC LIMIT ${limit}`,
        baseParams,
      );
      for (const r of result.rows as Array<Record<string, unknown>>) {
        memories.push({ id: r['id'], memoryType: 'episodic', situation: r['situation'], action: r['action'], outcome: r['outcome'], quality: r['outcome_quality'], agentId: r['agent_id'], createdAt: r['created_at'] });
      }
    } catch { /* */ }
  }

  if (memoryType === 'all' || memoryType === 'procedural') {
    try {
      const result = await p.query(
        `SELECT id, agent_id, trigger_pattern, tool_sequence, confidence, created_at FROM forge_procedural_memories WHERE trigger_pattern ILIKE $1 ${agentFilter} ORDER BY confidence DESC LIMIT ${limit}`,
        baseParams,
      );
      for (const r of result.rows as Array<Record<string, unknown>>) {
        memories.push({ id: r['id'], memoryType: 'procedural', triggerPattern: r['trigger_pattern'], toolSequence: r['tool_sequence'], confidence: r['confidence'], agentId: r['agent_id'], createdAt: r['created_at'] });
      }
    } catch { /* */ }
  }

  return JSON.stringify({ query: queryText, memoryType, memories, total: memories.length, fallback: true });
}

async function handleMemoryStore(args: Record<string, unknown>): Promise<string> {
  const type = args['type'] as string;
  const content = args['content'] as string;
  const agentId = (args['agent_id'] as string) ?? 'fleet:system';

  if (!content?.trim() && type !== 'procedural') {
    return JSON.stringify({ error: 'content is required' });
  }

  try {
    const p = getForgePool();
    const memoryId = generateId();

    switch (type) {
      case 'semantic': {
        const importance = (args['importance'] as number) ?? 0.5;
        const source = (args['source'] as string) ?? 'agent';
        const metadata = (args['metadata'] as Record<string, unknown>) ?? {};

        let embedding: number[] | null = null;
        try { embedding = await embed(content); } catch (embErr) { log(`Embedding failed for semantic store: ${embErr}`); }

        await p.query(
          `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, embedding, source, importance, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [memoryId, agentId, agentId, content, embedding ? `[${embedding.join(',')}]` : null, source, importance, JSON.stringify(metadata)],
        );
        return JSON.stringify({ stored: true, memoryId, type: 'semantic', hasEmbedding: !!embedding });
      }

      case 'episodic': {
        const action = (args['action'] as string) ?? 'No action recorded';
        const outcome = (args['outcome'] as string) ?? 'No outcome recorded';
        const quality = (args['quality'] as number) ?? 0.5;
        const metadata = (args['metadata'] as Record<string, unknown>) ?? {};
        const executionId = (args['execution_id'] as string) ?? null;

        let embedding: number[] | null = null;
        try { embedding = await embed(`${content} ${action} ${outcome}`); } catch (embErr) { log(`Embedding failed for episodic store: ${embErr}`); }

        await p.query(
          `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, execution_id, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [memoryId, agentId, agentId, content, action, outcome, quality, embedding ? `[${embedding.join(',')}]` : null, executionId, JSON.stringify(metadata)],
        );
        return JSON.stringify({ stored: true, memoryId, type: 'episodic', hasEmbedding: !!embedding });
      }

      case 'procedural': {
        const triggerPattern = (args['trigger_pattern'] as string) ?? content;
        const toolSequence = (args['tool_sequence'] as unknown[]) ?? [];
        if (!triggerPattern) return JSON.stringify({ error: 'trigger_pattern is required for procedural memory' });
        if (!toolSequence?.length) return JSON.stringify({ error: 'tool_sequence is required for procedural memory' });
        const metadata = (args['metadata'] as Record<string, unknown>) ?? {};

        let embedding: number[] | null = null;
        try { embedding = await embed(triggerPattern); } catch (embErr) { log(`Embedding failed for procedural store: ${embErr}`); }

        await p.query(
          `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, embedding, metadata) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [memoryId, agentId, agentId, triggerPattern, JSON.stringify(toolSequence), embedding ? `[${embedding.join(',')}]` : null, JSON.stringify(metadata)],
        );
        return JSON.stringify({ stored: true, memoryId, type: 'procedural', hasEmbedding: !!embedding });
      }

      default:
        return JSON.stringify({ error: `Unknown memory type: ${type}. Supported: semantic, episodic, procedural` });
    }
  } catch (err) {
    return JSON.stringify({ error: `Memory store failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

// ============================================
// Tool Dispatcher
// ============================================

export async function handleTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'db_query': return handleDbQuery(args);
    case 'substrate_db_query': return handleSubstrateDbQuery(args);
    case 'memory_search': return handleMemorySearch(args);
    case 'memory_store': return handleMemoryStore(args);
    default: throw new Error(`Unknown data tool: ${name}`);
  }
}
