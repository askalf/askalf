/**
 * Agent Forge Runtime Engine
 * Core ReAct (Reason + Act) execution loop.
 *
 * Receives user input, loads agent configuration, builds context,
 * iterates through think -> tool_call -> observe cycles, tracks tokens
 * and cost, and persists the execution record to the database.
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import type { ForgeConfig } from '../config.js';
import type {
  IProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  ToolCall,
  ToolDefinition as ProviderToolDefinition,
} from '../providers/interface.js';
import {
  buildInitialContext,
  truncateContext,
  appendToolResults,
  estimateContextTokens,
  type Message,
  type SessionMessage,
} from './context-manager.js';
import { calculateCost, checkBudget } from './token-counter.js';
import { createStateMachine, AgentState, type StateMachine } from './state-machine.js';
import { ExecutionError } from './error-handler.js';

// ============================================
// Types
// ============================================

export interface ExecutionContext {
  agentId: string;
  sessionId?: string | undefined;
  input: string;
  ownerId: string;
  executionId?: string | undefined;
}

export interface ToolExecutorFn {
  (
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
    executionId: string,
  ): Promise<
    Array<{
      output: unknown;
      error?: string | undefined;
      durationMs: number;
    }>
  >;
}

export interface StreamCallbacks {
  onThinking?: (() => void) | undefined;
  onText?: ((text: string) => void) | undefined;
  onToolCall?: ((toolCall: ToolCall) => void) | undefined;
  onToolResult?: ((toolCallId: string, toolName: string, result: string) => void) | undefined;
  onIteration?: ((iteration: number, maxIterations: number) => void) | undefined;
  onUsage?: ((inputTokens: number, outputTokens: number, cost: number) => void) | undefined;
  onError?: ((error: string) => void) | undefined;
  onComplete?: ((output: string) => void) | undefined;
}

export interface ExecutionDeps {
  provider: IProviderAdapter;
  executeTool: ToolExecutorFn;
  config: ForgeConfig;
  /** Optional callbacks for streaming execution events. */
  callbacks?: StreamCallbacks | undefined;
}

export interface ExecutionResult {
  output: string;
  toolCalls: ToolCall[];
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  durationMs: number;
  messages: Message[];
}

/** Database row shape for forge_agents */
interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  system_prompt: string;
  model_id: string | null;
  provider_config: {
    temperature?: number;
    maxTokens?: number;
  };
  enabled_tools: string[];
  max_iterations: number;
  max_tokens_per_turn: number;
  max_cost_per_execution: string; // NUMERIC comes back as string
  status: string;
}

/** Database row shape for forge_models */
interface ModelRow {
  id: string;
  provider_id: string;
  model_id: string;
  context_window: number;
  max_output: number;
  cost_per_1k_input: string; // NUMERIC
  cost_per_1k_output: string; // NUMERIC
}

/** Database row shape for session messages */
interface SessionMessageRow {
  role: string;
  content: string;
  tool_call_id: string | null;
  name: string | null;
}

// ============================================
// Tool definitions for the provider
// ============================================

interface ToolDefRow {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

async function loadToolDefinitions(enabledTools: string[]): Promise<ProviderToolDefinition[]> {
  if (enabledTools.length === 0) return [];

  const placeholders = enabledTools.map((_, i) => `$${i + 1}`).join(', ');
  const rows = await query<ToolDefRow>(
    `SELECT name, description, input_schema
     FROM forge_tools
     WHERE name IN (${placeholders}) AND is_enabled = true`,
    enabledTools,
  );

  return rows.map((row) => ({
    name: row.name,
    description: row.description,
    inputSchema: row.input_schema,
  }));
}

// ============================================
// Session History
// ============================================

async function loadSessionHistory(sessionId: string): Promise<SessionMessage[]> {
  const rows = await query<SessionMessageRow>(
    `SELECT m.role, m.content, m.tool_call_id, m.name
     FROM forge_executions e
     CROSS JOIN LATERAL jsonb_array_elements(e.messages) AS m_raw
     CROSS JOIN LATERAL jsonb_to_record(m_raw) AS m(role text, content text, tool_call_id text, name text)
     WHERE e.session_id = $1 AND e.status = 'completed'
     ORDER BY e.created_at ASC`,
    [sessionId],
  );

  return rows.map((row) => {
    const msg: SessionMessage = {
      role: row.role as SessionMessage['role'],
      content: row.content,
    };
    if (row.tool_call_id) {
      msg.tool_call_id = row.tool_call_id;
    }
    if (row.name) {
      msg.name = row.name;
    }
    return msg;
  });
}

// ============================================
// Execution Record Persistence
// ============================================

async function createExecutionRecord(
  executionId: string,
  agentId: string,
  sessionId: string | undefined,
  ownerId: string,
  input: string,
): Promise<void> {
  await query(
    `INSERT INTO forge_executions
     (id, agent_id, session_id, owner_id, status, input, started_at)
     VALUES ($1, $2, $3, $4, 'running', $5, NOW())
     ON CONFLICT (id) DO UPDATE SET status = 'running', started_at = NOW()`,
    [executionId, agentId, sessionId ?? null, ownerId, input],
  );
}

async function completeExecutionRecord(
  executionId: string,
  result: ExecutionResult,
): Promise<void> {
  await query(
    `UPDATE forge_executions
     SET status = 'completed',
         output = $1,
         messages = $2,
         tool_calls = $3,
         iterations = $4,
         input_tokens = $5,
         output_tokens = $6,
         total_tokens = $7,
         cost = $8,
         duration_ms = $9,
         completed_at = NOW()
     WHERE id = $10`,
    [
      result.output,
      JSON.stringify(result.messages),
      JSON.stringify(result.toolCalls),
      result.iterations,
      result.inputTokens,
      result.outputTokens,
      result.inputTokens + result.outputTokens,
      result.cost,
      result.durationMs,
      executionId,
    ],
  );
}

async function failExecutionRecord(
  executionId: string,
  error: string,
  partialResult: Partial<ExecutionResult>,
): Promise<void> {
  await query(
    `UPDATE forge_executions
     SET status = 'failed',
         error = $1,
         output = $2,
         messages = $3,
         tool_calls = $4,
         iterations = $5,
         input_tokens = $6,
         output_tokens = $7,
         total_tokens = $8,
         cost = $9,
         duration_ms = $10,
         completed_at = NOW()
     WHERE id = $11`,
    [
      error,
      partialResult.output ?? null,
      JSON.stringify(partialResult.messages ?? []),
      JSON.stringify(partialResult.toolCalls ?? []),
      partialResult.iterations ?? 0,
      partialResult.inputTokens ?? 0,
      partialResult.outputTokens ?? 0,
      (partialResult.inputTokens ?? 0) + (partialResult.outputTokens ?? 0),
      partialResult.cost ?? 0,
      partialResult.durationMs ?? 0,
      executionId,
    ],
  );
}

async function recordCostEvent(
  executionId: string,
  agentId: string,
  ownerId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cost: number,
): Promise<void> {
  await query(
    `INSERT INTO forge_cost_events
     (id, execution_id, agent_id, owner_id, provider, model, input_tokens, output_tokens, cost)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [ulid(), executionId, agentId, ownerId, provider, model, inputTokens, outputTokens, cost],
  );
}

// ============================================
// Core ReAct Engine
// ============================================

/**
 * Execute an agent with the ReAct (Reason + Act) loop.
 *
 * 1. Load agent configuration from the database
 * 2. Build initial context (system prompt + session history + user input)
 * 3. Loop up to max_iterations:
 *    a. Call the provider adapter's complete()
 *    b. If tool_calls in response: execute tools, append results, continue
 *    c. If final text (no tool_calls): break
 * 4. Persist execution record to forge_executions
 * 5. Return the result
 *
 * @param ctx - Execution context (agent ID, input, session, owner)
 * @param deps - Dependencies (provider adapter, tool executor, config)
 * @returns Execution result with output, token usage, cost, and messages
 */
export async function execute(
  ctx: ExecutionContext,
  deps: ExecutionDeps,
): Promise<ExecutionResult> {
  const startTime = performance.now();
  const executionId = ctx.executionId ?? ulid();
  const { provider, executeTool, config, callbacks } = deps;

  // ---- Tracking accumulators ----
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let iterations = 0;
  const allToolCalls: ToolCall[] = [];

  // ---- State machine ----
  const stateMachine: StateMachine = createStateMachine(executionId);

  // ---- Partial result for error reporting ----
  const buildPartialResult = (): Partial<ExecutionResult> => ({
    output: '',
    toolCalls: allToolCalls,
    iterations,
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    cost: totalCost,
    durationMs: Math.round(performance.now() - startTime),
    messages: [],
  });

  // ============================================
  // Step 1: Load agent configuration
  // ============================================

  const agent = await queryOne<AgentRow>(
    `SELECT id, owner_id, name, system_prompt, model_id, provider_config,
            enabled_tools, max_iterations, max_tokens_per_turn, max_cost_per_execution, status
     FROM forge_agents
     WHERE id = $1`,
    [ctx.agentId],
  );

  if (!agent) {
    throw new ExecutionError(
      `Agent not found: ${ctx.agentId}`,
      'INVALID_AGENT',
      false,
    );
  }

  if (agent.status !== 'active' && agent.status !== 'draft') {
    throw new ExecutionError(
      `Agent '${agent.name}' is not active (status: ${agent.status})`,
      'INVALID_AGENT',
      false,
      { agentStatus: agent.status },
    );
  }

  // ---- Load model info (optional, for context window limits) ----
  let modelId = agent.model_id ?? 'claude-sonnet-4-5-20250929';
  let contextWindow = 128_000;
  let maxOutput = agent.provider_config.maxTokens ?? config.maxTokensPerTurn;

  if (agent.model_id) {
    const model = await queryOne<ModelRow>(
      `SELECT id, provider_id, model_id, context_window, max_output,
              cost_per_1k_input, cost_per_1k_output
       FROM forge_models WHERE id = $1`,
      [agent.model_id],
    );
    if (model) {
      modelId = model.model_id;
      contextWindow = model.context_window;
      maxOutput = Math.min(model.max_output, maxOutput);
    }
  }

  const maxIterations = Math.min(agent.max_iterations, config.maxExecutionIterations);
  const maxCostPerExecution = parseFloat(agent.max_cost_per_execution) || config.defaultMaxCostPerExecution;

  // ---- Load tool definitions ----
  const toolDefs = await loadToolDefinitions(agent.enabled_tools);

  // ============================================
  // Step 2: Build initial context
  // ============================================

  let sessionHistory: SessionMessage[] = [];
  if (ctx.sessionId) {
    sessionHistory = await loadSessionHistory(ctx.sessionId);
  }

  let messages: Message[] = buildInitialContext(
    {
      systemPrompt: agent.system_prompt,
      maxTokensPerTurn: maxOutput,
    },
    ctx.input,
    sessionHistory.length > 0 ? sessionHistory : undefined,
  );

  // Truncate context if it's already too large
  const tokenBudget = contextWindow - maxOutput; // Leave room for the response
  messages = truncateContext(messages, tokenBudget);

  // ============================================
  // Step 3: Create execution record
  // ============================================

  await createExecutionRecord(executionId, ctx.agentId, ctx.sessionId, ctx.ownerId, ctx.input);

  // Transition: IDLE -> THINKING
  stateMachine.transition(AgentState.THINKING);

  // ============================================
  // Step 4: ReAct Loop
  // ============================================

  let finalOutput = '';

  try {
    for (let i = 0; i < maxIterations; i++) {
      iterations = i + 1;

      callbacks?.onIteration?.(iterations, maxIterations);

      // ---- Budget check ----
      const budget = checkBudget(totalCost, maxCostPerExecution);
      if (!budget.allowed) {
        throw new ExecutionError(
          `Execution budget exceeded: $${totalCost.toFixed(4)} of $${maxCostPerExecution.toFixed(4)} limit`,
          'BUDGET_EXCEEDED',
          false,
          {
            currentCost: totalCost,
            maxCost: maxCostPerExecution,
            usagePercent: budget.usagePercent,
          },
        );
      }

      // ---- Context window check ----
      const contextEstimate = estimateContextTokens(messages);
      if (contextEstimate > tokenBudget) {
        messages = truncateContext(messages, tokenBudget);
      }

      // ---- Build completion request ----
      callbacks?.onThinking?.();

      const completionRequest: CompletionRequest = {
        messages: messages.map((m) => {
          const msg: CompletionRequest['messages'][number] = {
            role: m.role,
            content: m.content,
          };
          if (m.tool_call_id !== undefined) {
            msg.tool_call_id = m.tool_call_id;
          }
          if (m.name !== undefined) {
            msg.name = m.name;
          }
          if (m.tool_calls !== undefined) {
            msg.tool_calls = m.tool_calls;
          }
          return msg;
        }),
        model: modelId,
        maxTokens: maxOutput,
        temperature: agent.provider_config.temperature ?? 0.7,
      };

      // Only set tools if there are any (exactOptionalPropertyTypes)
      if (toolDefs.length > 0) {
        completionRequest.tools = toolDefs;
      }

      // ---- Call provider ----
      let response: CompletionResponse;
      try {
        response = await provider.complete(completionRequest);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new ExecutionError(
          `Provider error: ${message}`,
          'PROVIDER_ERROR',
          true,
          { provider: provider.name, model: modelId },
        );
      }

      // ---- Track tokens & cost ----
      totalInputTokens += response.inputTokens;
      totalOutputTokens += response.outputTokens;
      const iterationCost = calculateCost(response.inputTokens, response.outputTokens, response.model);
      totalCost += iterationCost;

      callbacks?.onUsage?.(totalInputTokens, totalOutputTokens, totalCost);

      // ---- Record cost event ----
      await recordCostEvent(
        executionId,
        ctx.agentId,
        ctx.ownerId,
        response.provider,
        response.model,
        response.inputTokens,
        response.outputTokens,
        iterationCost,
      );

      // ---- Handle response ----
      if (response.toolCalls && response.toolCalls.length > 0) {
        // Transition: THINKING -> TOOL_CALLING
        if (stateMachine.canTransition(AgentState.TOOL_CALLING)) {
          stateMachine.transition(AgentState.TOOL_CALLING, {
            toolCount: response.toolCalls.length,
            tools: response.toolCalls.map((tc) => tc.name),
          });
        }

        // Track all tool calls
        for (const tc of response.toolCalls) {
          allToolCalls.push(tc);
          callbacks?.onToolCall?.(tc);
        }

        // Execute tools
        const toolInputs = response.toolCalls.map((tc) => ({
          name: tc.name,
          input: tc.arguments,
        }));

        let toolResults: Array<{ output: unknown; error?: string | undefined; durationMs: number }>;
        try {
          toolResults = await executeTool(toolInputs, executionId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new ExecutionError(
            `Tool execution failed: ${message}`,
            'TOOL_EXECUTION_FAILED',
            false,
          );
        }

        // Build tool result messages and append to context
        const toolResultMessages: Array<{
          toolCallId: string;
          toolName: string;
          toolArguments?: Record<string, unknown>;
          result: string;
        }> = [];

        for (let j = 0; j < response.toolCalls.length; j++) {
          const tc = response.toolCalls[j];
          const tr = toolResults[j];
          if (!tc || !tr) continue;

          let resultStr = tr.error
            ? `Error: ${tr.error}`
            : typeof tr.output === 'string'
              ? tr.output
              : JSON.stringify(tr.output);

          // Truncate large tool results to prevent context snowball
          const MAX_TOOL_RESULT_CHARS = 4000;
          if (resultStr.length > MAX_TOOL_RESULT_CHARS) {
            resultStr = resultStr.substring(0, MAX_TOOL_RESULT_CHARS) + '\n... [truncated, ' + resultStr.length + ' chars total]';
          }

          toolResultMessages.push({
            toolCallId: tc.id,
            toolName: tc.name,
            toolArguments: tc.arguments,
            result: resultStr,
          });

          callbacks?.onToolResult?.(tc.id, tc.name, resultStr);
        }

        appendToolResults(messages, response.content, toolResultMessages);

        // Transition: TOOL_CALLING -> THINKING (for next iteration)
        if (stateMachine.canTransition(AgentState.THINKING)) {
          stateMachine.transition(AgentState.THINKING, { iteration: iterations });
        }

        continue;
      }

      // ---- Final text response (no tool calls) ----
      finalOutput = response.content;
      callbacks?.onText?.(finalOutput);

      // Append the final assistant message to context
      messages.push({
        role: 'assistant',
        content: finalOutput,
      });

      break;
    }

    // If we exhausted all iterations without a final answer, use the last response
    if (finalOutput === '' && iterations >= maxIterations) {
      const lastAssistant = [...messages]
        .reverse()
        .find((m) => m.role === 'assistant');
      finalOutput = lastAssistant?.content ?? '[Max iterations reached without final response]';
    }

    // ---- Transition to COMPLETED ----
    if (stateMachine.canTransition(AgentState.COMPLETED)) {
      stateMachine.transition(AgentState.COMPLETED, {
        iterations,
        totalCost,
        totalTokens: totalInputTokens + totalOutputTokens,
      });
    }

    // ============================================
    // Step 5: Persist execution result
    // ============================================

    const durationMs = Math.round(performance.now() - startTime);

    const result: ExecutionResult = {
      output: finalOutput,
      toolCalls: allToolCalls,
      iterations,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cost: totalCost,
      durationMs,
      messages,
    };

    await completeExecutionRecord(executionId, result);

    callbacks?.onComplete?.(finalOutput);

    return result;
  } catch (error) {
    // ---- Transition to FAILED ----
    if (stateMachine.canTransition(AgentState.FAILED)) {
      stateMachine.transition(AgentState.FAILED, {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const durationMs = Math.round(performance.now() - startTime);
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Persist the failed execution
    await failExecutionRecord(executionId, errorMessage, {
      ...buildPartialResult(),
      durationMs,
      messages,
    });

    callbacks?.onError?.(errorMessage);

    // Re-throw ExecutionErrors as-is, wrap others
    if (error instanceof ExecutionError) {
      throw error;
    }

    throw new ExecutionError(
      errorMessage,
      'UNKNOWN',
      false,
      { originalError: error instanceof Error ? error.name : typeof error },
    );
  }
}
