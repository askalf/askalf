/**
 * Built-in Tool: Agent Call
 * Invokes another agent (sub-agent) by delegating to the main execution engine.
 * Includes recursion depth protection to prevent infinite loops.
 */

import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface AgentCallInput {
  agentId: string;
  input: string;
}

/**
 * Interface for the execution engine dependency.
 * The actual execution engine lives in the orchestration/runtime module;
 * we define a minimal interface here to avoid tight coupling.
 */
export interface ExecuteAgentFn {
  (params: {
    agentId: string;
    input: string;
    ownerId: string;
    depth: number;
  }): Promise<AgentExecutionResult>;
}

export interface AgentExecutionResult {
  output: string;
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  iterations: number;
  durationMs: number;
  error?: string | undefined;
}

export interface AgentCallDeps {
  executeAgent: ExecuteAgentFn;
  /** The owner ID of the calling agent (for authorization) */
  ownerId: string;
  /** The current recursion depth (0 = top level) */
  currentDepth: number;
}

// ============================================
// Implementation
// ============================================

/**
 * Maximum allowed recursion depth for sub-agent calls.
 * Agent A -> Agent B -> Agent C is depth 2. Beyond MAX_DEPTH, calls are denied.
 */
const MAX_DEPTH = 5;

/**
 * Invoke another agent as a sub-agent.
 *
 * - Delegates to the main execution engine with a different agent ID
 * - Tracks recursion depth to prevent infinite loops
 * - The sub-agent runs under the same owner for authorization
 *
 * @param input - The agent ID to call and the input text
 * @param deps - Dependencies including executeAgent function, owner ID, and current depth
 */
export async function agentCall(
  input: AgentCallInput,
  deps: AgentCallDeps,
): Promise<ToolResult> {
  const startTime = performance.now();

  // Validate input
  if (!input.agentId.trim()) {
    return {
      output: null,
      error: 'Agent ID cannot be empty',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  if (!input.input.trim()) {
    return {
      output: null,
      error: 'Input text cannot be empty',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Recursion depth check
  const nextDepth = deps.currentDepth + 1;

  if (nextDepth > MAX_DEPTH) {
    return {
      output: null,
      error: `Maximum agent call depth exceeded (max: ${MAX_DEPTH}). Current depth: ${deps.currentDepth}. This prevents infinite recursive agent loops.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  try {
    console.log(
      `[AgentCall] Invoking sub-agent '${input.agentId}' at depth ${nextDepth}/${MAX_DEPTH}`,
    );

    const result = await deps.executeAgent({
      agentId: input.agentId,
      input: input.input,
      ownerId: deps.ownerId,
      depth: nextDepth,
    });

    const durationMs = Math.round(performance.now() - startTime);

    if (result.status === 'failed') {
      return {
        output: {
          agentId: input.agentId,
          status: result.status,
          iterations: result.iterations,
          subAgentDurationMs: result.durationMs,
        },
        error: result.error ?? 'Sub-agent execution failed',
        durationMs,
      };
    }

    return {
      output: {
        agentId: input.agentId,
        status: result.status,
        output: result.output,
        iterations: result.iterations,
        depth: nextDepth,
        subAgentDurationMs: result.durationMs,
      },
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);
    const errorMessage = err instanceof Error ? err.message : String(err);

    return {
      output: null,
      error: `Sub-agent invocation failed: ${errorMessage}`,
      durationMs,
    };
  }
}
