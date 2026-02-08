/**
 * Batch Execution Engine
 * Runs multiple agent executions through the Anthropic Batches API.
 * Each iteration of the ReAct loop is batched across all agents,
 * giving 50% cost reduction on all API calls.
 *
 * Flow:
 * 1. Collect all agents to run
 * 2. Build initial context for each
 * 3. Submit all as a single batch
 * 4. Poll until batch completes
 * 5. For each result: execute tools locally, build next context
 * 6. Submit next batch for agents that need more iterations
 * 7. Repeat until all agents done or max iterations hit
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
  BatchRequest,
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
import { ExecutionError } from './error-handler.js';

// ============================================
// Types
// ============================================

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
  max_cost_per_execution: string;
  status: string;
}

interface ModelRow {
  id: string;
  model_id: string;
  context_window: number;
  max_output: number;
  cost_per_1k_input: string;
  cost_per_1k_output: string;
}

interface ToolDefRow {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface BatchAgentExecution {
  agentId: string;
  input: string;
  ownerId: string;
  executionId?: string;
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

export interface BatchExecutionResult {
  executionId: string;
  agentId: string;
  agentName: string;
  status: 'completed' | 'failed';
  output: string;
  iterations: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  error?: string;
}

// ============================================
// Internal state for each agent in a batch
// ============================================

interface AgentState {
  executionId: string;
  agentId: string;
  agentName: string;
  ownerId: string;
  messages: Message[];
  toolDefs: ProviderToolDefinition[];
  modelId: string;
  maxOutput: number;
  contextWindow: number;
  maxIterations: number;
  maxCost: number;
  temperature: number;
  iterations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  allToolCalls: ToolCall[];
  done: boolean;
  output: string;
  error?: string;
}

// ============================================
// Helpers
// ============================================

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

async function createExecutionRecord(
  executionId: string,
  agentId: string,
  ownerId: string,
  input: string,
): Promise<void> {
  await query(
    `INSERT INTO forge_executions
     (id, agent_id, owner_id, status, input, started_at, metadata)
     VALUES ($1, $2, $3, 'running', $4, NOW(), '{"mode":"batch"}'::jsonb)
     ON CONFLICT (id) DO UPDATE SET status = 'running', started_at = NOW()`,
    [executionId, agentId, ownerId, input],
  );
}

// ============================================
// Batch Execution
// ============================================

/**
 * Execute multiple agents in batch mode.
 * Uses the Anthropic Batches API for 50% cost reduction.
 */
export async function executeBatch(
  agents: BatchAgentExecution[],
  provider: IProviderAdapter,
  executeTool: ToolExecutorFn,
  config: ForgeConfig,
): Promise<BatchExecutionResult[]> {
  if (!provider.submitBatch || !provider.getBatchStatus) {
    throw new Error('Provider does not support batch execution');
  }

  const startTime = performance.now();

  // ---- Initialize state for each agent ----
  const states: AgentState[] = [];

  for (const exec of agents) {
    const agent = await queryOne<AgentRow>(
      `SELECT id, owner_id, name, system_prompt, model_id, provider_config,
              enabled_tools, max_iterations, max_tokens_per_turn, max_cost_per_execution, status
       FROM forge_agents WHERE id = $1`,
      [exec.agentId],
    );

    if (!agent || (agent.status !== 'active' && agent.status !== 'draft')) {
      continue;
    }

    let modelId = agent.model_id ?? 'claude-sonnet-4-20250514';
    let contextWindow = 128_000;
    let maxOutput = agent.provider_config.maxTokens ?? config.maxTokensPerTurn;

    if (agent.model_id) {
      const model = await queryOne<ModelRow>(
        `SELECT id, model_id, context_window, max_output, cost_per_1k_input, cost_per_1k_output
         FROM forge_models WHERE id = $1`,
        [agent.model_id],
      );
      if (model) {
        modelId = model.model_id;
        contextWindow = model.context_window;
        maxOutput = Math.min(model.max_output, maxOutput);
      }
    }

    const toolDefs = await loadToolDefinitions(agent.enabled_tools);
    const executionId = exec.executionId ?? ulid();

    let messages = buildInitialContext(
      { systemPrompt: agent.system_prompt, maxTokensPerTurn: maxOutput },
      exec.input,
    );
    const tokenBudget = contextWindow - maxOutput;
    messages = truncateContext(messages, tokenBudget);

    await createExecutionRecord(executionId, exec.agentId, exec.ownerId, exec.input);

    states.push({
      executionId,
      agentId: exec.agentId,
      agentName: agent.name,
      ownerId: exec.ownerId,
      messages,
      toolDefs,
      modelId,
      maxOutput,
      contextWindow,
      maxIterations: Math.min(agent.max_iterations, config.maxExecutionIterations),
      maxCost: parseFloat(agent.max_cost_per_execution) || config.defaultMaxCostPerExecution,
      temperature: agent.provider_config.temperature ?? 0.7,
      iterations: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      allToolCalls: [],
      done: false,
      output: '',
    });
  }

  if (states.length === 0) {
    return [];
  }

  console.log(`[BatchEngine] Starting batch execution for ${states.length} agents`);

  // ---- ReAct loop using batches ----
  const MAX_BATCH_ITERATIONS = 20;

  for (let round = 0; round < MAX_BATCH_ITERATIONS; round++) {
    const activeStates = states.filter((s) => !s.done);
    if (activeStates.length === 0) break;

    console.log(`[BatchEngine] Round ${round + 1}: ${activeStates.length} active agents`);

    // Build batch requests
    const batchRequests: BatchRequest[] = [];
    for (const state of activeStates) {
      state.iterations++;

      // Budget check
      const budget = checkBudget(state.totalCost, state.maxCost);
      if (!budget.allowed) {
        state.done = true;
        state.error = `Budget exceeded: $${state.totalCost.toFixed(4)}`;
        continue;
      }

      // Iteration check
      if (state.iterations > state.maxIterations) {
        state.done = true;
        state.output = state.output || 'Max iterations reached';
        continue;
      }

      // Context truncation
      const tokenBudget = state.contextWindow - state.maxOutput;
      const contextEstimate = estimateContextTokens(state.messages);
      if (contextEstimate > tokenBudget) {
        state.messages = truncateContext(state.messages, tokenBudget);
      }

      const completionRequest: CompletionRequest = {
        messages: state.messages.map((m) => {
          const msg: CompletionRequest['messages'][number] = {
            role: m.role,
            content: m.content,
          };
          if (m.tool_call_id !== undefined) msg.tool_call_id = m.tool_call_id;
          if (m.name !== undefined) msg.name = m.name;
          if (m.tool_calls !== undefined) msg.tool_calls = m.tool_calls;
          return msg;
        }),
        model: state.modelId,
        maxTokens: state.maxOutput,
        temperature: state.temperature,
      };

      if (state.toolDefs.length > 0) {
        completionRequest.tools = state.toolDefs;
      }

      batchRequests.push({
        customId: state.executionId,
        request: completionRequest,
      });
    }

    if (batchRequests.length === 0) break;

    // Submit batch
    let batchId: string;
    try {
      batchId = await provider.submitBatch!(batchRequests);
      console.log(`[BatchEngine] Batch submitted: ${batchId} (${batchRequests.length} requests)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[BatchEngine] Batch submission failed: ${msg}`);
      // Fall back: mark all active agents as failed
      for (const state of activeStates) {
        state.done = true;
        state.error = `Batch submission failed: ${msg}`;
      }
      break;
    }

    // Poll for batch completion
    let batchStatus = await provider.getBatchStatus!(batchId);
    let pollCount = 0;
    const MAX_POLLS = 120; // 10 minutes at 5s intervals
    while (batchStatus.status === 'in_progress' && pollCount < MAX_POLLS) {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      batchStatus = await provider.getBatchStatus!(batchId);
      pollCount++;
      if (pollCount % 12 === 0) {
        console.log(`[BatchEngine] Polling batch ${batchId}: ${batchStatus.completedRequests}/${batchStatus.totalRequests} complete`);
      }
    }

    if (batchStatus.status !== 'ended' || !batchStatus.results) {
      console.error(`[BatchEngine] Batch ${batchId} did not complete (status: ${batchStatus.status})`);
      for (const state of activeStates) {
        state.done = true;
        state.error = `Batch timed out (status: ${batchStatus.status})`;
      }
      break;
    }

    console.log(`[BatchEngine] Batch ${batchId} complete: ${batchStatus.results.length} results`);

    // Process batch results
    const resultMap = new Map(batchStatus.results.map((r) => [r.customId, r]));

    for (const state of activeStates) {
      if (state.done) continue;

      const batchResult = resultMap.get(state.executionId);
      if (!batchResult) {
        state.done = true;
        state.error = 'No batch result returned';
        continue;
      }

      if (batchResult.error) {
        state.done = true;
        state.error = batchResult.error;
        continue;
      }

      const response = batchResult.response!;

      // Track tokens & cost
      state.totalInputTokens += response.inputTokens;
      state.totalOutputTokens += response.outputTokens;
      const iterationCost = calculateCost(response.inputTokens, response.outputTokens, response.model);
      state.totalCost += iterationCost;

      // Record cost event
      await query(
        `INSERT INTO forge_cost_events
         (id, execution_id, agent_id, owner_id, provider, model, input_tokens, output_tokens, cost)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [ulid(), state.executionId, state.agentId, state.ownerId, response.provider, response.model, response.inputTokens, response.outputTokens, iterationCost],
      );

      // Handle tool calls
      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          state.allToolCalls.push(tc);
        }

        // Execute tools locally (fast, no API cost)
        const toolInputs = response.toolCalls.map((tc) => ({
          name: tc.name,
          input: tc.arguments,
        }));

        try {
          const toolResults = await executeTool(toolInputs, state.executionId);

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

            const resultStr = tr.error
              ? `Error: ${tr.error}`
              : typeof tr.output === 'string'
                ? tr.output
                : JSON.stringify(tr.output);

            toolResultMessages.push({
              toolCallId: tc.id,
              toolName: tc.name,
              toolArguments: tc.arguments,
              result: resultStr,
            });
          }

          appendToolResults(state.messages, response.content, toolResultMessages);
        } catch (err) {
          state.done = true;
          state.error = `Tool execution failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      } else {
        // No tool calls — agent is done
        state.done = true;
        state.output = response.content;
      }
    }
  }

  // ---- Persist results ----
  const results: BatchExecutionResult[] = [];

  for (const state of states) {
    const durationMs = Math.round(performance.now() - startTime);

    if (state.error) {
      await query(
        `UPDATE forge_executions
         SET status = 'failed', error = $1, output = $2,
             messages = $3, tool_calls = $4,
             iterations = $5, input_tokens = $6, output_tokens = $7,
             total_tokens = $8, cost = $9, duration_ms = $10, completed_at = NOW()
         WHERE id = $11`,
        [
          state.error, state.output || null,
          JSON.stringify(state.messages), JSON.stringify(state.allToolCalls),
          state.iterations, state.totalInputTokens, state.totalOutputTokens,
          state.totalInputTokens + state.totalOutputTokens, state.totalCost,
          durationMs, state.executionId,
        ],
      );
    } else {
      await query(
        `UPDATE forge_executions
         SET status = 'completed', output = $1,
             messages = $2, tool_calls = $3,
             iterations = $4, input_tokens = $5, output_tokens = $6,
             total_tokens = $7, cost = $8, duration_ms = $9, completed_at = NOW()
         WHERE id = $10`,
        [
          state.output,
          JSON.stringify(state.messages), JSON.stringify(state.allToolCalls),
          state.iterations, state.totalInputTokens, state.totalOutputTokens,
          state.totalInputTokens + state.totalOutputTokens, state.totalCost,
          durationMs, state.executionId,
        ],
      );
    }

    results.push({
      executionId: state.executionId,
      agentId: state.agentId,
      agentName: state.agentName,
      status: state.error ? 'failed' : 'completed',
      output: state.output,
      iterations: state.iterations,
      inputTokens: state.totalInputTokens,
      outputTokens: state.totalOutputTokens,
      cost: state.totalCost,
      error: state.error,
    });
  }

  const totalCost = results.reduce((s, r) => s + r.cost, 0);
  console.log(`[BatchEngine] Batch execution complete: ${results.length} agents, $${totalCost.toFixed(4)} total cost`);

  return results;
}
