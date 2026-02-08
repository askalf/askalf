/**
 * Anthropic Provider Adapter
 * Implements IProviderAdapter using the @anthropic-ai/sdk package.
 * Supports Claude models with tool use and streaming.
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  IProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolDefinition,
  ToolCall,
  ModelInfo,
  BatchRequest,
  BatchStatus,
  BatchResult,
} from '../interface.js';

/** Convert our generic ToolDefinition to Anthropic's tool format. */
function toAnthropicTool(tool: ToolDefinition): Anthropic.Tool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  };
}

/** Map Anthropic stop_reason to our finishReason union. */
function mapStopReason(
  reason: string | null | undefined,
): CompletionResponse['finishReason'] {
  switch (reason) {
    case 'end_turn':
      return 'stop';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    default:
      return 'stop';
  }
}

export class AnthropicAdapter implements IProviderAdapter {
  readonly name = 'anthropic';
  readonly type = 'anthropic';

  private client: Anthropic | null = null;
  private fallbackClient: Anthropic | null = null;
  private usingFallback = false;
  private defaultModel = 'claude-sonnet-4-20250514';

  async initialize(config: Record<string, unknown>): Promise<void> {
    const apiKey = config['apiKey'] as string | undefined;
    if (!apiKey) {
      throw new Error('Anthropic API key is required');
    }
    this.client = new Anthropic({ apiKey });

    // Initialize fallback client if a secondary key is provided
    const fallbackKey = config['apiKeyFallback'] as string | undefined;
    if (fallbackKey) {
      this.fallbackClient = new Anthropic({ apiKey: fallbackKey });
      console.log('[Anthropic] Fallback API key configured — will auto-switch on credit exhaustion');
    }

    if (typeof config['defaultModel'] === 'string') {
      this.defaultModel = config['defaultModel'];
    }
  }

  private getClient(): Anthropic {
    if (this.usingFallback && this.fallbackClient) {
      return this.fallbackClient;
    }
    if (!this.client) {
      throw new Error('AnthropicAdapter not initialized. Call initialize() first.');
    }
    return this.client;
  }

  /** Check if an error is a credit exhaustion (402) and switch to fallback key. */
  private switchToFallbackIfCreditError(err: unknown): boolean {
    if (this.usingFallback || !this.fallbackClient) return false;
    const status = (err as { status?: number })?.status;
    const message = err instanceof Error ? err.message : String(err);
    if (status === 402 || message.includes('credit balance is too low')) {
      console.warn('[Anthropic] Primary key credit exhausted — switching to fallback key');
      this.usingFallback = true;
      return true;
    }
    return false;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const client = this.getClient();

    // Separate system messages from conversation messages
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const conversationMessages = request.messages.filter((m) => m.role !== 'system');

    const systemText = systemMessages.map((m) => m.content).join('\n\n');

    // Build Anthropic messages
    // Consecutive tool messages get merged into a single user message with
    // multiple tool_result blocks (Anthropic requires this)
    const messages: Anthropic.MessageParam[] = [];
    let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

    const flushToolResults = () => {
      if (pendingToolResults.length > 0) {
        messages.push({ role: 'user' as const, content: pendingToolResults });
        pendingToolResults = [];
      }
    };

    for (const m of conversationMessages) {
      if (m.role === 'tool') {
        pendingToolResults.push({
          type: 'tool_result' as const,
          tool_use_id: m.tool_call_id ?? '',
          content: m.content,
        });
        continue;
      }

      // Flush any pending tool results before a non-tool message
      flushToolResults();

      if (m.role === 'assistant') {
        // If the assistant message has tool_calls, build content blocks
        if (m.tool_calls && m.tool_calls.length > 0) {
          const contentBlocks: Anthropic.ContentBlockParam[] = [];
          if (m.content) {
            contentBlocks.push({ type: 'text' as const, text: m.content });
          }
          for (const tc of m.tool_calls) {
            contentBlocks.push({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          messages.push({ role: 'assistant' as const, content: contentBlocks });
        } else {
          messages.push({ role: 'assistant' as const, content: m.content });
        }
        continue;
      }

      // user message
      messages.push({ role: 'user' as const, content: m.content });
    }

    // Flush any trailing tool results
    flushToolResults();

    const params: Anthropic.MessageCreateParams = {
      model: request.model || this.defaultModel,
      max_tokens: request.maxTokens ?? 4096,
      messages,
    };

    if (systemText.length > 0) {
      // Enable prompt caching on system prompt — saves ~90% on cached input tokens
      params.system = [
        {
          type: 'text' as const,
          text: systemText,
          cache_control: { type: 'ephemeral' as const },
        },
      ];
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      const tools = request.tools.map(toAnthropicTool);
      // Cache tool definitions too — they're the same across iterations
      if (tools.length > 0) {
        const lastTool = tools[tools.length - 1]!;
        (lastTool as unknown as Record<string, unknown>)['cache_control'] = { type: 'ephemeral' };
      }
      params.tools = tools;
    }

    let response: Anthropic.Message;
    try {
      response = await client.messages.create(params);
    } catch (err) {
      // If credit exhausted and fallback available, retry with fallback
      if (this.switchToFallbackIfCreditError(err)) {
        response = await this.getClient().messages.create(params);
      } else {
        throw err;
      }
    }

    // Extract text content and tool calls
    let textContent = '';
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      finishReason: mapStopReason(response.stop_reason),
      model: response.model,
      provider: this.name,
    };
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const client = this.getClient();

    // Separate system messages from conversation messages
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const conversationMessages = request.messages.filter((m) => m.role !== 'system');

    const systemText = systemMessages.map((m) => m.content).join('\n\n');

    // Build Anthropic messages (same logic as complete())
    const streamMessages: Anthropic.MessageParam[] = [];
    let streamPendingToolResults: Anthropic.ToolResultBlockParam[] = [];

    const flushStreamToolResults = () => {
      if (streamPendingToolResults.length > 0) {
        streamMessages.push({ role: 'user' as const, content: streamPendingToolResults });
        streamPendingToolResults = [];
      }
    };

    for (const m of conversationMessages) {
      if (m.role === 'tool') {
        streamPendingToolResults.push({
          type: 'tool_result' as const,
          tool_use_id: m.tool_call_id ?? '',
          content: m.content,
        });
        continue;
      }
      flushStreamToolResults();

      if (m.role === 'assistant') {
        if (m.tool_calls && m.tool_calls.length > 0) {
          const contentBlocks: Anthropic.ContentBlockParam[] = [];
          if (m.content) {
            contentBlocks.push({ type: 'text' as const, text: m.content });
          }
          for (const tc of m.tool_calls) {
            contentBlocks.push({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          streamMessages.push({ role: 'assistant' as const, content: contentBlocks });
        } else {
          streamMessages.push({ role: 'assistant' as const, content: m.content });
        }
        continue;
      }

      streamMessages.push({ role: 'user' as const, content: m.content });
    }
    flushStreamToolResults();

    const params: Anthropic.MessageCreateParams = {
      model: request.model || this.defaultModel,
      max_tokens: request.maxTokens ?? 4096,
      messages: streamMessages,
      stream: true,
    };

    if (systemText.length > 0) {
      params.system = [
        {
          type: 'text' as const,
          text: systemText,
          cache_control: { type: 'ephemeral' as const },
        },
      ];
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      const tools = request.tools.map(toAnthropicTool);
      if (tools.length > 0) {
        const lastTool = tools[tools.length - 1]!;
        (lastTool as unknown as Record<string, unknown>)['cache_control'] = { type: 'ephemeral' };
      }
      params.tools = tools;
    }

    const stream = client.messages.stream(params);

    let currentToolCallId = '';
    let currentToolCallName = '';
    let toolCallArgumentsJson = '';

    for await (const event of stream) {
      if (event.type === 'message_start') {
        // message_start contains usage info
        const msg = event.message;
        yield {
          type: 'text',
          inputTokens: msg.usage.input_tokens,
        };
      } else if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'tool_use') {
          currentToolCallId = block.id;
          currentToolCallName = block.name;
          toolCallArgumentsJson = '';
          yield {
            type: 'tool_call_start',
            toolCall: {
              id: block.id,
              name: block.name,
            },
          };
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield {
            type: 'text',
            content: delta.text,
          };
        } else if (delta.type === 'input_json_delta') {
          toolCallArgumentsJson += delta.partial_json;
          yield {
            type: 'tool_call_delta',
            content: delta.partial_json,
            toolCall: {
              id: currentToolCallId,
              name: currentToolCallName,
            },
          };
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolCallId) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(toolCallArgumentsJson || '{}') as Record<string, unknown>;
          } catch {
            // If JSON parsing fails, use empty object
          }
          yield {
            type: 'tool_call_end',
            toolCall: {
              id: currentToolCallId,
              name: currentToolCallName,
              arguments: parsedArgs,
            },
          };
          currentToolCallId = '';
          currentToolCallName = '';
          toolCallArgumentsJson = '';
        }
      } else if (event.type === 'message_delta') {
        yield {
          type: 'done',
          outputTokens: event.usage.output_tokens,
        };
      }
    }
  }

  // ============================================
  // Batches API — 50% cost reduction
  // ============================================

  /**
   * Build Anthropic MessageCreateParams from a CompletionRequest.
   * Shared by complete(), stream(), and submitBatch().
   */
  private buildParams(request: CompletionRequest): Anthropic.MessageCreateParams {
    const systemMessages = request.messages.filter((m) => m.role === 'system');
    const conversationMessages = request.messages.filter((m) => m.role !== 'system');
    const systemText = systemMessages.map((m) => m.content).join('\n\n');

    const messages: Anthropic.MessageParam[] = [];
    let pendingToolResults: Anthropic.ToolResultBlockParam[] = [];

    const flushToolResults = () => {
      if (pendingToolResults.length > 0) {
        messages.push({ role: 'user' as const, content: pendingToolResults });
        pendingToolResults = [];
      }
    };

    for (const m of conversationMessages) {
      if (m.role === 'tool') {
        pendingToolResults.push({
          type: 'tool_result' as const,
          tool_use_id: m.tool_call_id ?? '',
          content: m.content,
        });
        continue;
      }
      flushToolResults();
      if (m.role === 'assistant') {
        if (m.tool_calls && m.tool_calls.length > 0) {
          const contentBlocks: Anthropic.ContentBlockParam[] = [];
          if (m.content) {
            contentBlocks.push({ type: 'text' as const, text: m.content });
          }
          for (const tc of m.tool_calls) {
            contentBlocks.push({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: tc.arguments,
            });
          }
          messages.push({ role: 'assistant' as const, content: contentBlocks });
        } else {
          messages.push({ role: 'assistant' as const, content: m.content });
        }
        continue;
      }
      messages.push({ role: 'user' as const, content: m.content });
    }
    flushToolResults();

    const params: Anthropic.MessageCreateParams = {
      model: request.model || this.defaultModel,
      max_tokens: request.maxTokens ?? 4096,
      messages,
    };

    if (systemText.length > 0) {
      params.system = [
        {
          type: 'text' as const,
          text: systemText,
          cache_control: { type: 'ephemeral' as const },
        },
      ];
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      const tools = request.tools.map(toAnthropicTool);
      if (tools.length > 0) {
        const lastTool = tools[tools.length - 1]!;
        (lastTool as unknown as Record<string, unknown>)['cache_control'] = { type: 'ephemeral' };
      }
      params.tools = tools;
    }

    return params;
  }

  /**
   * Submit a batch of requests to the Anthropic Batches API.
   * Returns the batch ID for polling.
   * 50% cost reduction — results available within 24h (usually minutes).
   */
  async submitBatch(requests: BatchRequest[]): Promise<string> {
    const client = this.getClient();

    const batchRequests = requests.map((req) => {
      const params = this.buildParams(req.request);
      // Batch API requires non-streaming params — remove stream if present
      const { stream: _stream, ...nonStreamingParams } = params as Anthropic.MessageCreateParams & { stream?: boolean };
      return {
        custom_id: req.customId,
        params: nonStreamingParams as Anthropic.MessageCreateParamsNonStreaming,
      };
    });

    const batch = await client.messages.batches.create({
      requests: batchRequests,
    });

    return batch.id;
  }

  /**
   * Check the status of a batch and retrieve results when complete.
   */
  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    const client = this.getClient();

    const batch = await client.messages.batches.retrieve(batchId);

    const status: BatchStatus = {
      batchId: batch.id,
      status: batch.processing_status === 'in_progress' ? 'in_progress' : 'ended',
      totalRequests: batch.request_counts.processing + batch.request_counts.succeeded + batch.request_counts.errored + batch.request_counts.canceled + batch.request_counts.expired,
      completedRequests: batch.request_counts.succeeded + batch.request_counts.errored,
    };

    // If batch is complete, fetch results
    if (batch.processing_status === 'ended') {
      const results: BatchResult[] = [];

      const resultsStream = await client.messages.batches.results(batchId);
      for await (const result of resultsStream) {
        if (result.result.type === 'succeeded') {
          const message = result.result.message;
          let textContent = '';
          const toolCalls: ToolCall[] = [];

          for (const block of message.content) {
            if (block.type === 'text') {
              textContent += block.text;
            } else if (block.type === 'tool_use') {
              toolCalls.push({
                id: block.id,
                name: block.name,
                arguments: block.input as Record<string, unknown>,
              });
            }
          }

          results.push({
            customId: result.custom_id,
            response: {
              content: textContent,
              toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
              finishReason: mapStopReason(message.stop_reason),
              model: message.model,
              provider: this.name,
            },
          });
        } else {
          const errorObj = result.result.type === 'errored' ? result.result.error : null;
          const errorMsg = errorObj ? (errorObj as unknown as Record<string, string>)['message'] ?? 'Batch request errored' : `Batch request ${result.result.type}`;
          results.push({
            customId: result.custom_id,
            error: errorMsg,
          });
        }
      }

      status.results = results;
    }

    return status;
  }

  async embed(_text: string, _model?: string): Promise<number[]> {
    throw new Error('Anthropic does not support embedding models. Use OpenAI or Google instead.');
  }

  async isHealthy(): Promise<boolean> {
    try {
      const client = this.getClient();
      // Send a minimal request to verify connectivity
      const response = await client.messages.create({
        model: this.defaultModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return response.id.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Anthropic doesn't have a list models API; return known models.
    return [
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000, maxOutput: 32000 },
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000, maxOutput: 16000 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000, maxOutput: 8192 },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000, maxOutput: 8192 },
    ];
  }
}
