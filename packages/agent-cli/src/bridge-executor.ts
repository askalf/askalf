/**
 * Bridge Executor
 *
 * Wraps existing agent execution modes (SDK mode, CLI mode) for platform-dispatched
 * tasks received via the bridge WebSocket connection.
 *
 * Each dispatched task runs through the same execution pipeline as local tasks,
 * with the addition of progress streaming back to the platform.
 */

import { runSdkMode } from './sdk-mode.js';
import { runCliMode } from './cli-mode.js';
import { commandExists } from './platform/index.js';
import type { AgentConfig } from './util/config.js';
import * as output from './util/output.js';

// ============================================
// Types
// ============================================

export interface BridgeTaskResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  turns: number;
}

export interface BridgeTaskOptions {
  executionId: string;
  input: string;
  config: AgentConfig;
  maxTurns?: number;
  maxBudget?: number;
  onProgress?: (type: string, data: unknown) => void;
}

// Track active executions for cancellation
const activeExecutions = new Map<string, AbortController>();

// ============================================
// Execution
// ============================================

/**
 * Execute a platform-dispatched task using the local agent capabilities.
 * Uses SDK mode (API key) or CLI mode (OAuth) based on agent config.
 */
export async function executeBridgeTask(opts: BridgeTaskOptions): Promise<BridgeTaskResult> {
  const { executionId, input, config, maxTurns, maxBudget, onProgress } = opts;

  const controller = new AbortController();
  activeExecutions.set(executionId, controller);

  // Apply platform overrides
  const taskConfig = { ...config };
  if (maxTurns) taskConfig.maxTurns = maxTurns;
  if (maxBudget) taskConfig.maxBudgetUsd = maxBudget;

  try {
    onProgress?.('status', { status: 'starting', mode: taskConfig.authMode });

    // Determine execution mode
    if (taskConfig.authMode === 'oauth') {
      const hasClaude = await commandExists('claude');
      if (!hasClaude) {
        if (taskConfig.apiKey) {
          output.warn('Claude CLI not found. Falling back to SDK mode.');
          taskConfig.authMode = 'api_key';
        } else {
          throw new Error('Claude CLI not found and no API key configured');
        }
      }
    }

    if (taskConfig.authMode === 'api_key' && !taskConfig.apiKey) {
      throw new Error('No API key configured for task execution');
    }

    let result: BridgeTaskResult;

    if (taskConfig.authMode === 'oauth') {
      // CLI mode — runs claude subprocess (non-interactive, single prompt)
      onProgress?.('status', { status: 'running', mode: 'cli' });
      const cliResult = await runCliMode(input, taskConfig);
      result = {
        text: cliResult.text ?? 'Task completed',
        inputTokens: cliResult.inputTokens,
        outputTokens: cliResult.outputTokens,
        costUsd: cliResult.costUsd,
        turns: cliResult.turns,
      };
    } else {
      // SDK mode — direct API calls with tool use
      onProgress?.('status', { status: 'running', mode: 'sdk' });
      result = await runSdkMode(input, taskConfig);
    }

    onProgress?.('status', { status: 'completed' });
    return result;
  } finally {
    activeExecutions.delete(executionId);
  }
}

/**
 * Cancel an active bridge task execution.
 */
export function cancelBridgeTask(executionId: string): boolean {
  const controller = activeExecutions.get(executionId);
  if (controller) {
    controller.abort();
    activeExecutions.delete(executionId);
    return true;
  }
  return false;
}
