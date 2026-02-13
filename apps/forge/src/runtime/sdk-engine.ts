/**
 * SDK Execution Engine (v2)
 *
 * Alternative runtime that uses the Anthropic SDK directly (not the hand-built
 * ReAct loop). Agents with runtime_mode='sdk' use this path.
 *
 * Architecture:
 * - Uses @anthropic-ai/sdk Messages API for the LLM agentic loop
 * - Executes tools via the existing ToolRegistry (same implementations as legacy engine)
 * - Optionally connects to MCP servers for tools not in the registry
 * - Built-in cost budget enforcement
 * - Clean SSE streaming callbacks
 * - Shared persistence module for execution records
 */

import Anthropic from '@anthropic-ai/sdk';
import { ulid } from 'ulid';
import { queryOne } from '../database.js';
import {
  createExecutionRecord,
  completeExecutionRecord,
  failExecutionRecord,
  recordCostEvent,
} from './persistence.js';
import type { StreamCallbacks } from './engine.js';
import type { MemoryManager } from '../memory/manager.js';
import type { ToolRegistry, ToolDefinition } from '../tools/registry.js';

// ============================================
// Types
// ============================================

interface AgentRow {
  id: string;
  owner_id: string;
  name: string;
  system_prompt: string;
  model_id: string | null;
  provider_config: { temperature?: number; maxTokens?: number };
  enabled_tools: string[];
  max_iterations: number;
  max_tokens_per_turn: number;
  max_cost_per_execution: string;
  status: string;
  autonomy_level: number;
  runtime_mode: string;
}

export interface SdkExecutionContext {
  agentId: string;
  sessionId?: string;
  input: string;
  ownerId: string;
  executionId?: string;
  parentExecutionId?: string;
  depth?: number;
  callbacks?: StreamCallbacks;
  memoryManager?: MemoryManager;
  toolRegistry?: ToolRegistry;
}

// ============================================
// Cost table (per 1M tokens)
// ============================================

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
};

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const costs = MODEL_COSTS[model] ?? { input: 3.0, output: 15.0 };
  return (inputTokens * costs.input + outputTokens * costs.output) / 1_000_000;
}

// ============================================
// Fleet Memory Helpers
// ============================================

const FLEET_OWNER_ID = 'fleet:system';

export async function buildFleetMemoryContext(
  memoryManager: MemoryManager | undefined,
  agentId: string,
  input: string,
): Promise<string> {
  if (!memoryManager) return '';

  try {
    const recall = await memoryManager.recall(agentId, input, { k: 5 });
    const lines: string[] = [];

    for (const s of recall.semantic) {
      const sim = s.similarity ? ` (${(s.similarity * 100).toFixed(0)}%)` : '';
      lines.push(`- [semantic]${sim}: ${s.content}`);
    }
    for (const e of recall.episodic) {
      lines.push(`- [episodic]: ${e.action} → ${e.outcome}`);
    }
    for (const p of recall.procedural) {
      lines.push(`- [procedural]: ${p.trigger_pattern} (confidence: ${(p.confidence * 100).toFixed(0)}%)`);
    }

    if (lines.length === 0) return '';
    return ['[FLEET MEMORY — Relevant Knowledge]', ...lines].join('\n');
  } catch {
    return '';
  }
}

// ============================================
// Tool Definition Conversion
// ============================================

function registryToolToAnthropic(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

// ============================================
// SDK Execution
// ============================================

export async function runSdkExecution(ctx: SdkExecutionContext): Promise<void> {
  const startTime = Date.now();
  const executionId = ctx.executionId ?? ulid();

  // Load agent
  const agent = await queryOne<AgentRow>(
    `SELECT * FROM forge_agents WHERE id = $1 AND status = 'active'`,
    [ctx.agentId],
  );

  if (!agent) {
    throw new Error(`Agent not found or inactive: ${ctx.agentId}`);
  }

  const modelId = agent.model_id ?? 'claude-sonnet-4-5-20250929';

  // Create execution record
  await createExecutionRecord(
    executionId,
    ctx.agentId,
    ctx.sessionId,
    ctx.ownerId,
    ctx.input,
    'sdk',
    ctx.parentExecutionId,
    ctx.depth,
  );

  ctx.callbacks?.onThinking?.();

  try {
    // ── Step 1: Build tool definitions from registry ──
    const anthropicTools: Anthropic.Tool[] = [];
    const toolDefinitions = new Map<string, ToolDefinition>();

    if (ctx.toolRegistry) {
      const agentTools = ctx.toolRegistry.getForAgent(agent.enabled_tools);
      for (const tool of agentTools) {
        anthropicTools.push(registryToolToAnthropic(tool));
        toolDefinitions.set(tool.name, tool);
      }
      console.log(`[SDK Engine] ${agent.name}: ${anthropicTools.length} tools from registry`);
    }

    // ── Step 2: Build system prompt with fleet memory ──
    const memoryContext = await buildFleetMemoryContext(ctx.memoryManager, ctx.agentId, ctx.input);
    let systemPrompt = agent.system_prompt;
    if (memoryContext) {
      systemPrompt = `${systemPrompt}\n\n${memoryContext}`;
    }

    // ── Step 3: Initialize Anthropic client ──
    const anthropic = new Anthropic();
    const maxTokens = agent.max_tokens_per_turn || 4096;
    const temperature = agent.provider_config?.temperature;

    // ── Step 4: Agentic loop ──
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: ctx.input }];
    const allToolCalls: Array<{ id?: string; name: string; input: Record<string, unknown> }> = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterations = 0;
    let finalOutput = '';
    const maxIterations = agent.max_iterations || 10;
    const maxCost = parseFloat(agent.max_cost_per_execution) || 0.50;

    for (let i = 0; i < maxIterations; i++) {
      iterations++;
      ctx.callbacks?.onIteration?.(i + 1, maxIterations);

      // Check cost budget
      const currentCost = calculateCost(modelId, totalInputTokens, totalOutputTokens);
      if (currentCost > maxCost) {
        console.warn(`[SDK Engine] ${agent.name}: cost budget exceeded $${currentCost.toFixed(4)} > $${maxCost}`);
        finalOutput = `[Execution stopped: cost budget of $${maxCost} exceeded at $${currentCost.toFixed(4)}]`;
        break;
      }

      // Call Anthropic API
      const createParams: Anthropic.MessageCreateParamsNonStreaming = {
        model: modelId,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages,
      };
      if (anthropicTools.length > 0) {
        createParams.tools = anthropicTools;
      }
      if (temperature !== undefined) {
        createParams.temperature = temperature;
      }

      const response = await anthropic.messages.create(createParams);
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;

      // Extract text from response
      const textBlocks = response.content.filter(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      const responseText = textBlocks.map((b) => b.text).join('');

      if (responseText) {
        ctx.callbacks?.onText?.(responseText);
      }

      // ── Handle stop reason ──

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        finalOutput = responseText || finalOutput;
        messages.push({ role: 'assistant', content: response.content });
        break;
      }

      if (response.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: response.content });

        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const block of toolUseBlocks) {
          const toolInput = block.input as Record<string, unknown>;
          allToolCalls.push({ id: block.id, name: block.name, input: toolInput });

          ctx.callbacks?.onToolCall?.({ id: block.id, name: block.name, arguments: toolInput });

          // Execute via ToolRegistry
          const toolDef = toolDefinitions.get(block.name);
          if (!toolDef) {
            const errMsg = `Tool "${block.name}" not found in registry`;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: errMsg,
              is_error: true,
            });
            ctx.callbacks?.onToolResult?.(block.id, block.name, errMsg);
            continue;
          }

          try {
            const result = await toolDef.execute(toolInput);
            let resultText: string;

            if (result.error) {
              resultText = `Error: ${result.error}`;
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: resultText,
                is_error: true,
              });
            } else {
              resultText = typeof result.output === 'string'
                ? result.output
                : JSON.stringify(result.output, null, 2);

              // Truncate very long results to stay within context
              if (resultText.length > 15000) {
                resultText = resultText.substring(0, 15000) + '\n[...truncated]';
              }

              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: resultText,
              });
            }

            ctx.callbacks?.onToolResult?.(block.id, block.name, resultText.substring(0, 500));
          } catch (err) {
            const errMsg = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: errMsg,
              is_error: true,
            });
            ctx.callbacks?.onToolResult?.(block.id, block.name, errMsg);
          }
        }

        messages.push({ role: 'user', content: toolResults });

        if (responseText) {
          finalOutput = responseText;
        }
        continue;
      }

      // Other stop reasons
      finalOutput = responseText || `[Stopped: ${response.stop_reason}]`;
      messages.push({ role: 'assistant', content: response.content });
      break;
    }

    // ── Step 5: Record results ──
    const durationMs = Date.now() - startTime;
    const totalCost = calculateCost(modelId, totalInputTokens, totalOutputTokens);

    ctx.callbacks?.onUsage?.(totalInputTokens, totalOutputTokens, totalCost);
    ctx.callbacks?.onComplete?.(finalOutput);

    // Build simplified message log for persistence
    const messageLog = messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: Array.isArray(m.content)
          ? m.content.map((b) => {
              if ('text' in b) return (b as { text: string }).text;
              if ('name' in b) return `[tool_use: ${(b as { name: string }).name}]`;
              if ('tool_use_id' in b) return `[tool_result]`;
              return '[block]';
            }).join(' ')
          : String(m.content),
      };
    });

    await completeExecutionRecord(executionId, {
      output: finalOutput,
      toolCalls: allToolCalls,
      iterations,
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      cost: totalCost,
      durationMs,
      messages: messageLog,
    });

    if (totalCost > 0) {
      await recordCostEvent(
        executionId,
        ctx.agentId,
        ctx.ownerId,
        'anthropic',
        modelId,
        totalInputTokens,
        totalOutputTokens,
        totalCost,
      );
    }

    // Store episodic memory (success)
    if (ctx.memoryManager) {
      try {
        await ctx.memoryManager.store(ctx.agentId, {
          type: 'episodic',
          ownerId: FLEET_OWNER_ID,
          situation: ctx.input,
          action: `SDK execution: ${iterations} turns, ${allToolCalls.length} tool calls`,
          outcome: finalOutput.substring(0, 500),
          quality: 1.0,
          metadata: { executionId, runtime: 'sdk', cost: totalCost, model: modelId },
        });
      } catch {
        // Non-fatal
      }
    }

    console.log(
      `[SDK Engine] ${agent.name} execution ${executionId} completed: ` +
      `${iterations} turns, ${allToolCalls.length} tool calls, ` +
      `$${totalCost.toFixed(4)} cost, ${durationMs}ms`,
    );
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMessage = err instanceof Error ? err.message : String(err);

    ctx.callbacks?.onError?.(errorMessage);

    await failExecutionRecord(executionId, errorMessage, {
      output: '',
      toolCalls: [],
      iterations: 0,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      durationMs,
      messages: [{ role: 'user', content: ctx.input }],
    });

    // Store episodic memory (failure)
    if (ctx.memoryManager) {
      try {
        await ctx.memoryManager.store(ctx.agentId, {
          type: 'episodic',
          ownerId: FLEET_OWNER_ID,
          situation: ctx.input,
          action: 'SDK execution attempted',
          outcome: `Failed: ${errorMessage}`,
          quality: 0.0,
          metadata: { executionId, runtime: 'sdk', error: errorMessage },
        });
      } catch {
        // Non-fatal
      }
    }

    console.error(`[SDK Engine] Execution ${executionId} failed:`, errorMessage);
  }
}
