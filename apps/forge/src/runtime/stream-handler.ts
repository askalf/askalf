/**
 * SSE Stream Handler
 * Server-Sent Events streaming for real-time agent execution output.
 * Designed for Fastify and compatible with the forge execution engine.
 */

import type { FastifyReply } from 'fastify';
import type { ToolCall, StreamChunk } from '../providers/interface.js';

// ============================================
// Types
// ============================================

export interface SSEWriter {
  /**
   * Write a named event with a JSON-serialized data payload.
   */
  writeEvent(event: string, data: unknown): void;

  /**
   * Write a text delta chunk to the client.
   */
  writeText(text: string): void;

  /**
   * Write a tool call event to the client.
   */
  writeToolCall(toolCall: ToolCall): void;

  /**
   * Write a tool result event to the client.
   */
  writeToolResult(toolCallId: string, toolName: string, result: string): void;

  /**
   * Write an error event to the client.
   */
  writeError(error: string): void;

  /**
   * Write a status update event (e.g., state transitions).
   */
  writeStatus(status: string, metadata?: Record<string, unknown>): void;

  /**
   * Write token usage update.
   */
  writeUsage(inputTokens: number, outputTokens: number, cost: number): void;

  /**
   * Signal completion and close the stream.
   */
  close(finalOutput?: string): void;

  /**
   * Whether the stream has been closed.
   */
  readonly closed: boolean;
}

// ============================================
// SSE Stream Creation
// ============================================

/**
 * Sets up SSE headers on a Fastify reply and returns an SSEWriter
 * for streaming events to the client.
 *
 * The writer buffers nothing -- each call writes directly to the
 * underlying response stream.
 *
 * @param reply - The Fastify reply object to stream to
 * @returns An SSEWriter for sending events
 */
export function createSSEStream(reply: FastifyReply): SSEWriter {
  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // Disable Nginx buffering
  });

  let isClosed = false;

  function writeRaw(event: string, data: string): void {
    if (isClosed) return;
    try {
      reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
    } catch {
      // Client may have disconnected
      isClosed = true;
    }
  }

  // Detect client disconnect
  reply.raw.on('close', () => {
    isClosed = true;
  });

  return {
    get closed(): boolean {
      return isClosed;
    },

    writeEvent(event: string, data: unknown): void {
      writeRaw(event, JSON.stringify(data));
    },

    writeText(text: string): void {
      writeRaw('text', JSON.stringify({ content: text }));
    },

    writeToolCall(toolCall: ToolCall): void {
      writeRaw('tool_call', JSON.stringify({
        id: toolCall.id,
        name: toolCall.name,
        arguments: toolCall.arguments,
      }));
    },

    writeToolResult(toolCallId: string, toolName: string, result: string): void {
      writeRaw('tool_result', JSON.stringify({
        tool_call_id: toolCallId,
        name: toolName,
        result,
      }));
    },

    writeError(error: string): void {
      writeRaw('error', JSON.stringify({ error }));
    },

    writeStatus(status: string, metadata?: Record<string, unknown>): void {
      writeRaw('status', JSON.stringify({ status, ...metadata }));
    },

    writeUsage(inputTokens: number, outputTokens: number, cost: number): void {
      writeRaw('usage', JSON.stringify({ inputTokens, outputTokens, cost }));
    },

    close(finalOutput?: string): void {
      if (isClosed) return;
      if (finalOutput !== undefined) {
        writeRaw('done', JSON.stringify({ output: finalOutput }));
      } else {
        writeRaw('done', JSON.stringify({ finished: true }));
      }
      isClosed = true;
      try {
        reply.raw.end();
      } catch {
        // Already closed
      }
    },
  };
}

// ============================================
// Streamable Execution
// ============================================

/**
 * Options for a streamable execution.
 */
export interface StreamableExecutionOptions {
  /** The SSE writer to stream events to. */
  writer: SSEWriter;
  /** Whether to include token usage events. Defaults to true. */
  includeUsage?: boolean | undefined;
}

/**
 * Creates event handlers that forward execution events to an SSE stream.
 * Returns callbacks that the engine can call during execution.
 *
 * These handlers are designed to be passed into the engine's execute()
 * function via an onEvent callback pattern, or called manually from
 * the execution route.
 */
export function createStreamCallbacks(options: StreamableExecutionOptions): {
  onThinking: () => void;
  onText: (text: string) => void;
  onToolCall: (toolCall: ToolCall) => void;
  onToolResult: (toolCallId: string, toolName: string, result: string) => void;
  onChunk: (chunk: StreamChunk) => void;
  onIteration: (iteration: number, totalIterations: number) => void;
  onUsage: (inputTokens: number, outputTokens: number, cost: number) => void;
  onError: (error: string) => void;
  onComplete: (output: string) => void;
} {
  const { writer, includeUsage } = options;
  const shouldIncludeUsage = includeUsage !== false;

  return {
    onThinking(): void {
      writer.writeStatus('thinking');
    },

    onText(text: string): void {
      writer.writeText(text);
    },

    onToolCall(toolCall: ToolCall): void {
      writer.writeToolCall(toolCall);
    },

    onToolResult(toolCallId: string, toolName: string, result: string): void {
      writer.writeToolResult(toolCallId, toolName, result);
    },

    onChunk(chunk: StreamChunk): void {
      switch (chunk.type) {
        case 'text':
          if (chunk.content) {
            writer.writeText(chunk.content);
          }
          break;
        case 'tool_call_start':
        case 'tool_call_delta':
        case 'tool_call_end':
          writer.writeEvent(chunk.type, {
            toolCall: chunk.toolCall,
          });
          break;
        case 'done':
          if (shouldIncludeUsage && chunk.inputTokens !== undefined && chunk.outputTokens !== undefined) {
            writer.writeUsage(chunk.inputTokens, chunk.outputTokens, 0);
          }
          break;
        case 'error':
          if (chunk.error) {
            writer.writeError(chunk.error);
          }
          break;
      }
    },

    onIteration(iteration: number, totalIterations: number): void {
      writer.writeStatus('iteration', { iteration, totalIterations });
    },

    onUsage(inputTokens: number, outputTokens: number, cost: number): void {
      if (shouldIncludeUsage) {
        writer.writeUsage(inputTokens, outputTokens, cost);
      }
    },

    onError(error: string): void {
      writer.writeError(error);
    },

    onComplete(output: string): void {
      writer.close(output);
    },
  };
}
