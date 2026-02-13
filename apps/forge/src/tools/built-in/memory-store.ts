/**
 * Built-in Tool: Memory Store
 * Allows agents to explicitly store knowledge, experiences, and patterns
 * into the fleet's 4-tier cognitive memory system.
 */

import type { ToolResult } from '../registry.js';
import type { MemoryManager, StoreInput } from '../../memory/manager.js';

// ============================================
// Types
// ============================================

export interface MemoryStoreInput {
  /** Memory tier to store in. */
  type: 'semantic' | 'episodic' | 'procedural';
  /** The content to store. For episodic: the situation description. */
  content: string;
  /** For episodic: the action taken. */
  action?: string;
  /** For episodic: the outcome observed. */
  outcome?: string;
  /** For episodic: outcome quality 0-1 (1 = success, 0 = failure). */
  quality?: number;
  /** For procedural: the trigger pattern that initiates this workflow. */
  trigger_pattern?: string;
  /** For procedural: the tool sequence as JSON array [{tool, params, description}]. */
  tool_sequence?: Array<{ tool: string; params: Record<string, unknown>; description?: string }>;
  /** Optional metadata to attach. */
  metadata?: Record<string, unknown>;
  /** For semantic: importance level 0-1. */
  importance?: number;
  /** For semantic: source label. */
  source?: string;
}

export interface MemoryStoreDeps {
  memoryManager: MemoryManager;
  agentId: string;
  ownerId: string;
}

// ============================================
// Implementation
// ============================================

export async function memoryStore(
  input: MemoryStoreInput,
  deps: MemoryStoreDeps,
): Promise<ToolResult> {
  const startTime = performance.now();

  if (!input.content?.trim() && input.type !== 'procedural') {
    return {
      output: null,
      error: 'content is required',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  try {
    let storeInput: StoreInput;

    switch (input.type) {
      case 'semantic':
        storeInput = {
          type: 'semantic',
          ownerId: deps.ownerId,
          content: input.content,
          options: {
            source: input.source || 'agent',
            importance: input.importance ?? 0.5,
            metadata: input.metadata,
          },
        };
        break;

      case 'episodic':
        storeInput = {
          type: 'episodic',
          ownerId: deps.ownerId,
          situation: input.content,
          action: input.action || 'No action recorded',
          outcome: input.outcome || 'No outcome recorded',
          quality: input.quality ?? 0.5,
          metadata: input.metadata,
        };
        break;

      case 'procedural':
        if (!input.trigger_pattern) {
          return {
            output: null,
            error: 'trigger_pattern is required for procedural memory',
            durationMs: Math.round(performance.now() - startTime),
          };
        }
        if (!input.tool_sequence || input.tool_sequence.length === 0) {
          return {
            output: null,
            error: 'tool_sequence is required for procedural memory',
            durationMs: Math.round(performance.now() - startTime),
          };
        }
        storeInput = {
          type: 'procedural',
          ownerId: deps.ownerId,
          triggerPattern: input.trigger_pattern,
          toolSequence: input.tool_sequence,
          metadata: input.metadata,
        };
        break;

      default:
        return {
          output: null,
          error: `Unknown memory type: ${input.type}. Supported: semantic, episodic, procedural`,
          durationMs: Math.round(performance.now() - startTime),
        };
    }

    const memoryId = await deps.memoryManager.store(deps.agentId, storeInput);

    return {
      output: {
        stored: true,
        memoryId,
        type: input.type,
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  } catch (err) {
    return {
      output: null,
      error: `Memory store failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}
