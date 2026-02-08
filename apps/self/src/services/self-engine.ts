/**
 * SELF Engine
 * Wraps the Forge ReAct engine per-user.
 * Creates forge agents, manages sessions, and executes conversations.
 */

import { ulid } from 'ulid';
import pg from 'pg';
import { SELF_SYSTEM_PROMPT, SELF_DEFAULT_NAME } from '@substrate/self-core';
import type { SelfConfig } from '../config.js';

// ============================================
// Forge Database Connection (separate from main)
// ============================================

let forgePool: pg.Pool | null = null;

export function initializeForgeDb(connectionString: string): void {
  forgePool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  forgePool.on('error', (err) => {
    console.error('[SELF Forge DB] Unexpected error:', err);
  });
}

async function forgeQuery<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  if (!forgePool) throw new Error('Forge database not initialized');
  const result = await forgePool.query<T>(text, params);
  return result.rows;
}

async function forgeQueryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await forgeQuery<T>(text, params);
  return rows[0] ?? null;
}

export async function closeForgeDb(): Promise<void> {
  if (forgePool) {
    await forgePool.end();
    forgePool = null;
  }
}

// ============================================
// Agent Row Types
// ============================================

interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  system_prompt: string;
  status: string;
}

interface SessionRow {
  id: string;
}

interface ExecutionRow {
  id: string;
  output: string;
  input_tokens: number;
  output_tokens: number;
  cost: string;
  messages: unknown;
}

// ============================================
// Agent Creation
// ============================================

/**
 * Create a forge agent for a SELF instance.
 * The agent stores the SELF system prompt and default model config.
 */
export async function createSelfAgent(params: {
  ownerId: string;
  selfName: string;
  persona?: Record<string, unknown>;
}): Promise<string> {
  const agentId = ulid();
  const { ownerId, selfName } = params;

  // Build personalized system prompt
  let systemPrompt = SELF_SYSTEM_PROMPT;
  if (selfName !== SELF_DEFAULT_NAME) {
    systemPrompt = systemPrompt.replace('You are SELF', `You are ${selfName}`);
  }

  const slug = `self-${selfName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')}-${agentId.slice(-6)}`;

  await forgeQuery(
    `INSERT INTO forge_agents
     (id, owner_id, name, slug, system_prompt, model_id, provider_config,
      enabled_tools, max_iterations, max_tokens_per_turn, max_cost_per_execution, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'active')`,
    [
      agentId,
      ownerId,
      `SELF-${selfName}`,
      slug,
      systemPrompt,
      null, // Use default model
      JSON.stringify({ temperature: 0.7, maxTokens: 4096 }),
      '{web_search,web_browse,memory_store,memory_recall}', // PostgreSQL text[] literal
      10, // max iterations per turn
      4096,
      '1.00', // max cost per execution
    ],
  );

  return agentId;
}

/**
 * Create a forge session for a SELF conversation.
 */
export async function createForgeSession(agentId: string, ownerId: string): Promise<string> {
  const sessionId = ulid();

  await forgeQuery(
    `INSERT INTO forge_sessions
     (id, agent_id, owner_id, is_active)
     VALUES ($1, $2, $3, true)`,
    [sessionId, agentId, ownerId],
  );

  return sessionId;
}

// ============================================
// Execution (Chat)
// ============================================

/**
 * Execute a chat turn through the forge engine.
 * This creates an execution record and runs the ReAct loop.
 *
 * For Phase 1, we do a direct LLM call rather than importing the full
 * forge engine (which would require fixing TS compilation).
 * The execution is still recorded in forge_executions for consistency.
 */
export async function executeChatTurn(params: {
  agentId: string;
  sessionId: string;
  ownerId: string;
  input: string;
  config: SelfConfig;
}): Promise<{
  output: string;
  executionId: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}> {
  const { agentId, sessionId, ownerId, input, config } = params;
  const executionId = ulid();
  const startTime = performance.now();

  // Load agent
  const agent = await forgeQueryOne<AgentRow>(
    `SELECT id, owner_id, name, system_prompt, status FROM forge_agents WHERE id = $1`,
    [agentId],
  );

  if (!agent) {
    throw new Error(`SELF agent not found: ${agentId}`);
  }

  // Load session history (last 20 messages for context)
  const historyRows = await forgeQuery<{ role: string; content: string }>(
    `SELECT m.role, m.content
     FROM forge_executions e,
     LATERAL (
       SELECT (elem->>'role') as role, (elem->>'content') as content
       FROM jsonb_array_elements(e.messages) as elem
       WHERE (elem->>'role') IN ('user', 'assistant')
     ) m
     WHERE e.session_id = $1 AND e.status = 'completed'
     ORDER BY e.created_at DESC
     LIMIT 20`,
    [sessionId],
  );

  // Build messages for LLM
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: agent.system_prompt },
  ];

  // Add history (reversed since we fetched DESC)
  const history = historyRows.reverse();
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current user message
  messages.push({ role: 'user', content: input });

  // Create execution record
  await forgeQuery(
    `INSERT INTO forge_executions
     (id, agent_id, session_id, owner_id, status, input, started_at)
     VALUES ($1, $2, $3, $4, 'running', $5, NOW())`,
    [executionId, agentId, sessionId, ownerId, input],
  );

  try {
    // Direct Anthropic API call for Phase 1
    const apiKey = config.anthropicApiKey;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is required');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 4096,
        system: agent.system_prompt,
        messages: messages
          .filter(m => m.role !== 'system')
          .map(m => ({
            role: m.role === 'self' ? 'assistant' : m.role,
            content: m.content,
          })),
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Anthropic API error: ${response.status} ${errText}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    const outputText = data.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('');

    const inputTokens = data.usage.input_tokens;
    const outputTokens = data.usage.output_tokens;
    // Sonnet 4.5 pricing: $3/$15 per million tokens
    const cost = (inputTokens * 3 + outputTokens * 15) / 1_000_000;
    const durationMs = Math.round(performance.now() - startTime);

    // Save execution with full message history
    const fullMessages = [
      ...messages,
      { role: 'assistant', content: outputText },
    ];

    await forgeQuery(
      `UPDATE forge_executions
       SET status = 'completed',
           output = $1,
           messages = $2,
           tool_calls = '[]'::jsonb,
           iterations = 1,
           input_tokens = $3,
           output_tokens = $4,
           total_tokens = $5,
           cost = $6,
           duration_ms = $7,
           completed_at = NOW()
       WHERE id = $8`,
      [
        outputText,
        JSON.stringify(fullMessages),
        inputTokens,
        outputTokens,
        inputTokens + outputTokens,
        cost,
        durationMs,
        executionId,
      ],
    );

    return {
      output: outputText,
      executionId,
      inputTokens,
      outputTokens,
      cost,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const durationMs = Math.round(performance.now() - startTime);

    await forgeQuery(
      `UPDATE forge_executions
       SET status = 'failed', error = $1, duration_ms = $2, completed_at = NOW()
       WHERE id = $3`,
      [errorMessage, durationMs, executionId],
    );

    throw error;
  }
}

/**
 * Update the SELF agent's system prompt (e.g., when persona changes)
 */
export async function updateAgentPrompt(agentId: string, systemPrompt: string): Promise<void> {
  await forgeQuery(
    `UPDATE forge_agents SET system_prompt = $1 WHERE id = $2`,
    [systemPrompt, agentId],
  );
}
