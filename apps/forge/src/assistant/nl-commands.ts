/**
 * Natural Language Command Parser
 * Converts free-form user input into structured forge API actions.
 * Uses regex-based pattern matching for common agent/workflow/memory operations.
 * Returns null when no command pattern matches (input is general conversation).
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

// ── Types ───────────────────────────────────────────────────────────────────

export interface ParsedCommand {
  action: string;
  params: Record<string, unknown>;
}

export interface CommandResult {
  success: boolean;
  action: string;
  data: unknown;
  message: string;
}

// ── Row types for query results ─────────────────────────────────────────────

interface AgentListRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  description: string | null;
  created_at: Date;
}

interface AgentLookupRow {
  id: string;
  name: string;
  slug: string;
}

interface WorkflowRow {
  id: string;
  name: string;
  slug: string;
  status: string;
}

interface CostSummaryRow {
  total_cost: string;
  total_input_tokens: string;
  total_output_tokens: string;
  execution_count: string;
}

interface MemorySearchRow {
  id: string;
  content: string;
  source: string | null;
  importance: number;
  created_at: Date;
}

interface ExecutionInsertRow {
  id: string;
}

// ── Command patterns ────────────────────────────────────────────────────────

interface CommandPattern {
  regex: RegExp;
  action: string;
  extract: (match: RegExpMatchArray) => Record<string, unknown>;
}

const COMMAND_PATTERNS: CommandPattern[] = [
  // ── Agent creation ──
  {
    regex: /^(?:create|make|build|new)\s+(?:an?\s+)?agent\s+(?:named|called)\s+["']?(.+?)["']?\s*$/i,
    action: 'create_agent',
    extract: (m) => ({ name: m[1]?.trim() ?? '' }),
  },
  {
    regex: /^(?:create|make|build|new)\s+(?:an?\s+)?agent\s+["']?(.+?)["']?\s*$/i,
    action: 'create_agent',
    extract: (m) => ({ name: m[1]?.trim() ?? '' }),
  },

  // ── Run / execute agent ──
  {
    regex: /^(?:run|execute|start|invoke)\s+(?:agent\s+)?["']?(.+?)["']?\s+(?:with|using|on)\s+(?:input\s+)?["']?(.+?)["']?\s*$/i,
    action: 'run_agent',
    extract: (m) => ({ agent: m[1]?.trim() ?? '', input: m[2]?.trim() ?? '' }),
  },
  {
    regex: /^(?:run|execute|start|invoke)\s+(?:agent\s+)?["']?(.+?)["']?\s*$/i,
    action: 'run_agent',
    extract: (m) => ({ agent: m[1]?.trim() ?? '', input: '' }),
  },

  // ── List agents ──
  {
    regex: /^(?:list|show|get|display)\s+(?:my\s+)?agents?\s*$/i,
    action: 'list_agents',
    extract: () => ({}),
  },
  {
    regex: /^(?:what\s+agents?\s+do\s+I\s+have)\s*\??\s*$/i,
    action: 'list_agents',
    extract: () => ({}),
  },

  // ── Memory search ──
  {
    regex: /^(?:search|find|look\s*up|query)\s+(?:my\s+)?(?:memory|memories)\s+(?:for|about)\s+["']?(.+?)["']?\s*$/i,
    action: 'search_memory',
    extract: (m) => ({ query: m[1]?.trim() ?? '' }),
  },
  {
    regex: /^(?:remember|recall)\s+(?:anything\s+about\s+)?["']?(.+?)["']?\s*$/i,
    action: 'search_memory',
    extract: (m) => ({ query: m[1]?.trim() ?? '' }),
  },

  // ── Cost / spending ──
  {
    regex: /^(?:show|get|display|what(?:'s|\s+is|\s+are))\s+(?:my\s+)?(?:costs?|spending|usage|bill)\s*\??\s*$/i,
    action: 'get_costs',
    extract: () => ({}),
  },
  {
    regex: /^(?:how\s+much\s+have\s+I\s+spent)\s*\??\s*$/i,
    action: 'get_costs',
    extract: () => ({}),
  },

  // ── Workflow creation ──
  {
    regex: /^(?:create|make|build|new)\s+(?:a\s+)?workflow\s+(?:named|called)\s+["']?(.+?)["']?\s*$/i,
    action: 'create_workflow',
    extract: (m) => ({ name: m[1]?.trim() ?? '' }),
  },
  {
    regex: /^(?:create|make|build|new)\s+(?:a\s+)?workflow\s*$/i,
    action: 'create_workflow',
    extract: () => ({}),
  },

  // ── Delete agent ──
  {
    regex: /^(?:delete|remove|destroy)\s+(?:agent\s+)?["']?(.+?)["']?\s*$/i,
    action: 'delete_agent',
    extract: (m) => ({ agent: m[1]?.trim() ?? '' }),
  },

  // ── Describe / info agent ──
  {
    regex: /^(?:describe|info|details|about)\s+(?:agent\s+)?["']?(.+?)["']?\s*$/i,
    action: 'describe_agent',
    extract: (m) => ({ agent: m[1]?.trim() ?? '' }),
  },

  // ── List workflows ──
  {
    regex: /^(?:list|show|get|display)\s+(?:my\s+)?workflows?\s*$/i,
    action: 'list_workflows',
    extract: () => ({}),
  },
];

// ── Parser ──────────────────────────────────────────────────────────────────

/**
 * Attempt to parse a natural language input into a structured forge command.
 * Returns null if no command pattern matches -- the input should then be
 * treated as general conversation for the assistant.
 */
export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();

  for (const pattern of COMMAND_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (match) {
      return {
        action: pattern.action,
        params: pattern.extract(match),
      };
    }
  }

  return null;
}

// ── Executor ────────────────────────────────────────────────────────────────

/**
 * Execute a parsed command against the forge database.
 * Each action maps to one or more database queries.
 */
export async function executeCommand(
  action: string,
  params: Record<string, unknown>,
  ownerId: string,
  queryFn: QueryFn,
  queryOneFn: QueryOneFn,
): Promise<CommandResult> {
  switch (action) {
    case 'create_agent':
      return createAgent(params, ownerId, queryFn);

    case 'run_agent':
      return runAgent(params, ownerId, queryFn, queryOneFn);

    case 'list_agents':
      return listAgents(ownerId, queryFn);

    case 'search_memory':
      return searchMemory(params, ownerId, queryFn);

    case 'get_costs':
      return getCosts(ownerId, queryOneFn);

    case 'create_workflow':
      return createWorkflow(params, ownerId, queryFn);

    case 'delete_agent':
      return deleteAgent(params, ownerId, queryFn, queryOneFn);

    case 'describe_agent':
      return describeAgent(params, ownerId, queryOneFn);

    case 'list_workflows':
      return listWorkflows(ownerId, queryFn);

    default:
      return {
        success: false,
        action,
        data: null,
        message: `Unknown action: ${action}`,
      };
  }
}

// ── Action handlers ─────────────────────────────────────────────────────────

async function createAgent(
  params: Record<string, unknown>,
  ownerId: string,
  queryFn: QueryFn,
): Promise<CommandResult> {
  const name = String(params['name'] ?? 'Untitled Agent');
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const id = ulid();

  await queryFn(
    `INSERT INTO forge_agents
       (id, owner_id, name, slug, description, system_prompt, status)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      ownerId,
      name,
      slug,
      `Agent created via natural language command`,
      'You are a helpful assistant.',
      'draft',
    ],
  );

  return {
    success: true,
    action: 'create_agent',
    data: { id, name, slug },
    message: `Agent "${name}" created successfully (id: ${id}).`,
  };
}

async function runAgent(
  params: Record<string, unknown>,
  ownerId: string,
  queryFn: QueryFn,
  queryOneFn: QueryOneFn,
): Promise<CommandResult> {
  const agentNameOrId = String(params['agent'] ?? '');
  const input = String(params['input'] ?? '');

  // Resolve agent by name, slug, or ID
  const agent = await queryOneFn<AgentLookupRow>(
    `SELECT id, name, slug
     FROM forge_agents
     WHERE owner_id = $1
       AND (id = $2 OR slug = $2 OR LOWER(name) = LOWER($2))
     LIMIT 1`,
    [ownerId, agentNameOrId],
  );

  if (!agent) {
    return {
      success: false,
      action: 'run_agent',
      data: null,
      message: `Agent "${agentNameOrId}" not found. Use "list my agents" to see available agents.`,
    };
  }

  // Create a pending execution
  const executionId = ulid();
  await queryFn(
    `INSERT INTO forge_executions
       (id, agent_id, owner_id, status, input, messages, tool_calls,
        iterations, input_tokens, output_tokens, total_tokens, cost, metadata)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      executionId,
      agent.id,
      ownerId,
      'pending',
      input,
      JSON.stringify([{ role: 'user', content: input }]),
      JSON.stringify([]),
      0,
      0,
      0,
      0,
      0,
      JSON.stringify({ source: 'nl_command' }),
    ],
  );

  return {
    success: true,
    action: 'run_agent',
    data: { executionId, agentId: agent.id, agentName: agent.name, input },
    message: `Execution ${executionId} created for agent "${agent.name}". Status: pending.`,
  };
}

async function listAgents(
  ownerId: string,
  queryFn: QueryFn,
): Promise<CommandResult> {
  const agents = await queryFn<AgentListRow>(
    `SELECT id, name, slug, status, description, created_at
     FROM forge_agents
     WHERE owner_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [ownerId],
  );

  if (agents.length === 0) {
    return {
      success: true,
      action: 'list_agents',
      data: [],
      message: 'You have no agents yet. Use "create an agent named ..." to get started.',
    };
  }

  const summary = agents
    .map((a) => `  - ${a.name} (${a.slug}) [${a.status}]`)
    .join('\n');

  return {
    success: true,
    action: 'list_agents',
    data: agents,
    message: `You have ${agents.length} agent(s):\n${summary}`,
  };
}

async function searchMemory(
  params: Record<string, unknown>,
  ownerId: string,
  queryFn: QueryFn,
): Promise<CommandResult> {
  const searchQuery = String(params['query'] ?? '');

  // Do a simple text search across semantic memories
  // (Full vector search requires an embedding; here we use ilike as a fallback)
  const results = await queryFn<MemorySearchRow>(
    `SELECT id, content, source, importance, created_at
     FROM forge_semantic_memories
     WHERE owner_id = $1
       AND content ILIKE '%' || $2 || '%'
     ORDER BY importance DESC, created_at DESC
     LIMIT 10`,
    [ownerId, searchQuery],
  );

  if (results.length === 0) {
    return {
      success: true,
      action: 'search_memory',
      data: [],
      message: `No memories found matching "${searchQuery}".`,
    };
  }

  const summary = results
    .map((r) => `  - [${r.importance.toFixed(2)}] ${r.content.substring(0, 120)}`)
    .join('\n');

  return {
    success: true,
    action: 'search_memory',
    data: results,
    message: `Found ${results.length} memory match(es) for "${searchQuery}":\n${summary}`,
  };
}

async function getCosts(
  ownerId: string,
  queryOneFn: QueryOneFn,
): Promise<CommandResult> {
  // Aggregate cost events for this owner
  const summary = await queryOneFn<CostSummaryRow>(
    `SELECT
       COALESCE(SUM(cost), 0)::text AS total_cost,
       COALESCE(SUM(input_tokens), 0)::text AS total_input_tokens,
       COALESCE(SUM(output_tokens), 0)::text AS total_output_tokens,
       COUNT(*)::text AS execution_count
     FROM forge_cost_events
     WHERE owner_id = $1
       AND created_at >= NOW() - INTERVAL '30 days'`,
    [ownerId],
  );

  if (!summary) {
    return {
      success: true,
      action: 'get_costs',
      data: { totalCost: 0, totalInputTokens: 0, totalOutputTokens: 0, executionCount: 0 },
      message: 'No cost data available.',
    };
  }

  const totalCost = parseFloat(summary.total_cost);
  const inputTokens = parseInt(summary.total_input_tokens, 10);
  const outputTokens = parseInt(summary.total_output_tokens, 10);
  const execCount = parseInt(summary.execution_count, 10);

  return {
    success: true,
    action: 'get_costs',
    data: {
      totalCost,
      totalInputTokens: inputTokens,
      totalOutputTokens: outputTokens,
      executionCount: execCount,
      period: '30 days',
    },
    message:
      `Cost summary (last 30 days):\n` +
      `  Total cost: $${totalCost.toFixed(4)}\n` +
      `  Executions: ${execCount}\n` +
      `  Input tokens: ${inputTokens.toLocaleString()}\n` +
      `  Output tokens: ${outputTokens.toLocaleString()}`,
  };
}

async function createWorkflow(
  params: Record<string, unknown>,
  ownerId: string,
  queryFn: QueryFn,
): Promise<CommandResult> {
  const name = String(params['name'] ?? 'Untitled Workflow');
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const id = ulid();

  await queryFn(
    `INSERT INTO forge_workflows
       (id, owner_id, name, slug, description, definition, status)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      ownerId,
      name,
      slug,
      'Workflow created via natural language command',
      JSON.stringify({ nodes: [], edges: [] }),
      'draft',
    ],
  );

  return {
    success: true,
    action: 'create_workflow',
    data: { id, name, slug },
    message: `Workflow "${name}" created successfully (id: ${id}). Add nodes to define the pipeline.`,
  };
}

async function deleteAgent(
  params: Record<string, unknown>,
  ownerId: string,
  queryFn: QueryFn,
  queryOneFn: QueryOneFn,
): Promise<CommandResult> {
  const agentNameOrId = String(params['agent'] ?? '');

  // Resolve the agent first
  const agent = await queryOneFn<AgentLookupRow>(
    `SELECT id, name, slug
     FROM forge_agents
     WHERE owner_id = $1
       AND (id = $2 OR slug = $2 OR LOWER(name) = LOWER($2))
     LIMIT 1`,
    [ownerId, agentNameOrId],
  );

  if (!agent) {
    return {
      success: false,
      action: 'delete_agent',
      data: null,
      message: `Agent "${agentNameOrId}" not found.`,
    };
  }

  // Soft-delete by archiving instead of hard delete
  await queryFn(
    `UPDATE forge_agents SET status = 'archived' WHERE id = $1 AND owner_id = $2`,
    [agent.id, ownerId],
  );

  return {
    success: true,
    action: 'delete_agent',
    data: { id: agent.id, name: agent.name },
    message: `Agent "${agent.name}" has been archived.`,
  };
}

async function describeAgent(
  params: Record<string, unknown>,
  ownerId: string,
  queryOneFn: QueryOneFn,
): Promise<CommandResult> {
  const agentNameOrId = String(params['agent'] ?? '');

  const agent = await queryOneFn<AgentListRow>(
    `SELECT id, name, slug, status, description, created_at
     FROM forge_agents
     WHERE owner_id = $1
       AND (id = $2 OR slug = $2 OR LOWER(name) = LOWER($2))
     LIMIT 1`,
    [ownerId, agentNameOrId],
  );

  if (!agent) {
    return {
      success: false,
      action: 'describe_agent',
      data: null,
      message: `Agent "${agentNameOrId}" not found.`,
    };
  }

  return {
    success: true,
    action: 'describe_agent',
    data: agent,
    message:
      `Agent: ${agent.name}\n` +
      `  Slug: ${agent.slug}\n` +
      `  Status: ${agent.status}\n` +
      `  Description: ${agent.description ?? '(none)'}\n` +
      `  Created: ${agent.created_at.toISOString()}`,
  };
}

async function listWorkflows(
  ownerId: string,
  queryFn: QueryFn,
): Promise<CommandResult> {
  const workflows = await queryFn<WorkflowRow>(
    `SELECT id, name, slug, status
     FROM forge_workflows
     WHERE owner_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [ownerId],
  );

  if (workflows.length === 0) {
    return {
      success: true,
      action: 'list_workflows',
      data: [],
      message: 'You have no workflows yet. Use "create a workflow named ..." to get started.',
    };
  }

  const summary = workflows
    .map((w) => `  - ${w.name} (${w.slug}) [${w.status}]`)
    .join('\n');

  return {
    success: true,
    action: 'list_workflows',
    data: workflows,
    message: `You have ${workflows.length} workflow(s):\n${summary}`,
  };
}
