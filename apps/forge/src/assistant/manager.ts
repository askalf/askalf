/**
 * Assistant Manager
 * Per-user personal assistant lifecycle management.
 * Each user gets a dedicated forge agent that serves as their personal assistant,
 * capable of managing other agents, creating workflows, searching memory, etc.
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

// ── Row types ───────────────────────────────────────────────────────────────

export interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  description: string | null;
  system_prompt: string;
  model_id: string | null;
  provider_config: Record<string, unknown>;
  autonomy_level: number;
  enabled_tools: string[];
  mcp_servers: unknown[];
  memory_config: Record<string, unknown>;
  max_iterations: number;
  max_tokens_per_turn: number;
  max_cost_per_execution: string;
  is_public: boolean;
  is_template: boolean;
  forked_from: string | null;
  version: number;
  status: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface UserAssistantRow {
  id: string;
  owner_id: string;
  agent_id: string;
  preferences: Record<string, unknown>;
  learned_patterns: unknown[];
  is_active: boolean;
  last_interaction: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AssistantInfo {
  assistantId: string;
  agentId: string;
  ownerId: string;
  preferences: Record<string, unknown>;
  isActive: boolean;
  lastInteraction: Date | null;
  createdAt: Date;
}

export interface ExecutionRow {
  id: string;
  agent_id: string;
  session_id: string | null;
  owner_id: string;
  status: string;
  input: string;
  output: string | null;
  messages: unknown[];
  tool_calls: unknown[];
  iterations: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost: string;
  duration_ms: number | null;
  error: string | null;
  metadata: Record<string, unknown>;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface SendMessageResult {
  executionId: string;
  status: string;
  output: string | null;
}

// ── System prompt ───────────────────────────────────────────────────────────

const PERSONAL_ASSISTANT_SYSTEM_PROMPT = `You are the user's personal AI assistant within Agent Forge, a platform for building, running, and orchestrating AI agents.

You have the following capabilities:
- **Agent Management**: Create, list, update, configure, and run agents on behalf of the user.
- **Workflow Orchestration**: Create and manage multi-step workflows that chain agents together.
- **Memory Search**: Search the user's semantic, episodic, and procedural memory stores for relevant context.
- **Cost Tracking**: Report on token usage, costs per agent, and overall spending.
- **Tool Management**: Help configure tools and MCP servers for agents.

When the user gives you natural language instructions, interpret them as forge operations when applicable. For example:
- "Create an agent named CodeReviewer" -> create a new agent with that name
- "Run my summarizer on this text" -> execute the named agent with the given input
- "What have I spent this week?" -> query cost events for recent usage

Always be concise, helpful, and proactive. If you need clarification, ask. If a request could be interpreted multiple ways, explain the options. Respect the user's preferences for communication style, language, and model choices stored in your configuration.

You operate within the user's permission scope and cannot access other users' resources.`;

// ── Manager class ───────────────────────────────────────────────────────────

export class AssistantManager {
  private readonly query: QueryFn;
  private readonly queryOne: QueryOneFn;

  constructor(query: QueryFn, queryOne: QueryOneFn) {
    this.query = query;
    this.queryOne = queryOne;
  }

  /**
   * Get an existing personal assistant for the owner, or create one if none exists.
   * Returns the full assistant info including the linked agent.
   */
  async getOrCreate(ownerId: string): Promise<AssistantInfo> {
    // Check for an existing assistant first
    const existing = await this.getAssistant(ownerId);
    if (existing) {
      return existing;
    }

    // Create a new forge agent for this user's personal assistant
    const agentId = ulid();
    const slug = `personal-assistant-${ownerId}`;

    await this.query(
      `INSERT INTO forge_agents
         (id, owner_id, name, slug, description, system_prompt,
          autonomy_level, enabled_tools, memory_config,
          max_iterations, max_tokens_per_turn, status, metadata)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        agentId,
        ownerId,
        'Personal Assistant',
        slug,
        'Your personal AI assistant for managing agents, workflows, and memory within Agent Forge.',
        PERSONAL_ASSISTANT_SYSTEM_PROMPT,
        3, // moderate autonomy
        ['memory_search', 'memory_store', 'agent_call', 'web_search', 'web_browse'],
        JSON.stringify({
          enableWorking: true,
          enableSemantic: true,
          enableEpisodic: true,
          enableProcedural: false,
          semanticSearchK: 5,
        }),
        25, // max iterations
        8192, // max tokens per turn
        'active',
        JSON.stringify({ type: 'personal_assistant', version: 1 }),
      ],
    );

    // Create the user assistant link
    const assistantId = ulid();

    await this.query(
      `INSERT INTO forge_user_assistants
         (id, owner_id, agent_id, preferences, learned_patterns, is_active, last_interaction)
       VALUES
         ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        assistantId,
        ownerId,
        agentId,
        JSON.stringify({}),
        JSON.stringify([]),
        true,
      ],
    );

    return {
      assistantId,
      agentId,
      ownerId,
      preferences: {},
      isActive: true,
      lastInteraction: new Date(),
      createdAt: new Date(),
    };
  }

  /**
   * Look up the personal assistant record for a given owner.
   * Returns null if no assistant has been created yet.
   */
  async getAssistant(ownerId: string): Promise<AssistantInfo | null> {
    const row = await this.queryOne<UserAssistantRow>(
      `SELECT id, owner_id, agent_id, preferences, learned_patterns,
              is_active, last_interaction, created_at, updated_at
       FROM forge_user_assistants
       WHERE owner_id = $1`,
      [ownerId],
    );

    if (!row) {
      return null;
    }

    return {
      assistantId: row.id,
      agentId: row.agent_id,
      ownerId: row.owner_id,
      preferences: row.preferences,
      isActive: row.is_active,
      lastInteraction: row.last_interaction,
      createdAt: row.created_at,
    };
  }

  /**
   * Send a message to the user's personal assistant agent.
   * This creates an execution record and delegates to the execution engine.
   * The caller is responsible for actually running the execution through the
   * runtime/engine -- this method stages the execution and returns its ID.
   */
  async sendMessage(ownerId: string, message: string): Promise<SendMessageResult> {
    const assistant = await this.getOrCreate(ownerId);

    const executionId = ulid();

    await this.query(
      `INSERT INTO forge_executions
         (id, agent_id, owner_id, status, input, messages, tool_calls,
          iterations, input_tokens, output_tokens, total_tokens, cost, metadata)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        executionId,
        assistant.agentId,
        ownerId,
        'pending',
        message,
        JSON.stringify([{ role: 'user', content: message }]),
        JSON.stringify([]),
        0,
        0,
        0,
        0,
        0,
        JSON.stringify({ source: 'personal_assistant' }),
      ],
    );

    // Update the last_interaction timestamp on the assistant record
    await this.query(
      `UPDATE forge_user_assistants
       SET last_interaction = NOW()
       WHERE owner_id = $1`,
      [ownerId],
    );

    return {
      executionId,
      status: 'pending',
      output: null,
    };
  }

  /**
   * Update the preferences JSONB on the user's assistant record.
   * Performs a shallow merge with existing preferences.
   */
  async updatePreferences(
    ownerId: string,
    preferences: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const row = await this.queryOne<UserAssistantRow>(
      `UPDATE forge_user_assistants
       SET preferences = preferences || $1::jsonb
       WHERE owner_id = $2
       RETURNING id, owner_id, agent_id, preferences, learned_patterns,
                 is_active, last_interaction, created_at, updated_at`,
      [JSON.stringify(preferences), ownerId],
    );

    if (!row) {
      throw new Error(`No assistant found for owner ${ownerId}`);
    }

    return row.preferences;
  }
}
