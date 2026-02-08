/**
 * OpenAI Provider Adapter
 * Implements IProviderAdapter using the openai SDK.
 * Supports GPT models, o-series reasoning models, embeddings, and tool use.
 */

import OpenAI from 'openai';
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionChunk,
} from 'openai/resources/chat/completions';
import type {
  IProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolDefinition,
  ToolCall,
  ModelInfo,
} from '../interface.js';

/** Models that do not support the temperature parameter. */
const REASONING_MODELS = new Set([
  'o1',
  'o1-mini',
  'o1-preview',
  'o3',
  'o3-mini',
  'o4-mini',
]);

/** Check whether a model ID matches a reasoning model prefix. */
function isReasoningModel(modelId: string): boolean {
  for (const prefix of REASONING_MODELS) {
    if (modelId === prefix || modelId.startsWith(`${prefix}-`)) {
      return true;
    }
  }
  return false;
}

/** Convert a generic ToolDefinition to OpenAI's ChatCompletionTool format. */
function toOpenAITool(tool: ToolDefinition): ChatCompletionTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}

/** Map OpenAI finish_reason to our finishReason union. */
function mapFinishReason(
  reason: string | null | undefined,
): CompletionResponse['finishReason'] {
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'tool_calls':
      return 'tool_use';
    case 'length':
      return 'max_tokens';
    default:
      return 'stop';
  }
}

export class OpenAIAdapter implements IProviderAdapter {
  readonly name = 'openai';
  readonly type = 'openai';

  private client: OpenAI | null = null;
  private defaultModel = 'gpt-4o';
  private defaultEmbeddingModel = 'text-embedding-3-large';

  async initialize(config: Record<string, unknown>): Promise<void> {
    const apiKey = config['apiKey'] as string | undefined;
    if (!apiKey) {
      throw new Error('OpenAI API key is required');
    }

    const baseURL = config['baseURL'] as string | undefined;

    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    if (typeof config['defaultModel'] === 'string') {
      this.defaultModel = config['defaultModel'];
    }
    if (typeof config['defaultEmbeddingModel'] === 'string') {
      this.defaultEmbeddingModel = config['defaultEmbeddingModel'];
    }
  }

  private getClient(): OpenAI {
    if (!this.client) {
      throw new Error('OpenAIAdapter not initialized. Call initialize() first.');
    }
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const client = this.getClient();
    const modelId = request.model || this.defaultModel;
    const reasoning = isReasoningModel(modelId);

    // Build OpenAI messages
    const messages: ChatCompletionMessageParam[] = request.messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.tool_call_id ?? '',
        };
      }
      if (m.role === 'system') {
        // Reasoning models use 'developer' role instead of 'system'
        if (reasoning) {
          return {
            role: 'developer' as const,
            content: m.content,
          };
        }
        return {
          role: 'system' as const,
          content: m.content,
        };
      }
      if (m.role === 'assistant') {
        return {
          role: 'assistant' as const,
          content: m.content,
        };
      }
      return {
        role: 'user' as const,
        content: m.content,
      };
    });

    const params: OpenAI.ChatCompletionCreateParams = {
      model: modelId,
      messages,
    };

    if (request.maxTokens !== undefined) {
      params.max_tokens = request.maxTokens;
    }

    // Reasoning models don't support temperature
    if (!reasoning && request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools.map(toOpenAITool);
    }

    const response = await client.chat.completions.create(params);

    const choice = response.choices[0];
    if (!choice) {
      return {
        content: '',
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        finishReason: 'error',
        model: response.model,
        provider: this.name,
      };
    }

    // Extract tool calls
    const toolCalls: ToolCall[] = [];
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(tc.function.arguments) as Record<string, unknown>;
        } catch {
          // If JSON parsing fails, use empty object
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: parsedArgs,
        });
      }
    }

    return {
      content: choice.message.content ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      finishReason: mapFinishReason(choice.finish_reason),
      model: response.model,
      provider: this.name,
    };
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const client = this.getClient();
    const modelId = request.model || this.defaultModel;
    const reasoning = isReasoningModel(modelId);

    const messages: ChatCompletionMessageParam[] = request.messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.tool_call_id ?? '',
        };
      }
      if (m.role === 'system') {
        if (reasoning) {
          return {
            role: 'developer' as const,
            content: m.content,
          };
        }
        return {
          role: 'system' as const,
          content: m.content,
        };
      }
      if (m.role === 'assistant') {
        return {
          role: 'assistant' as const,
          content: m.content,
        };
      }
      return {
        role: 'user' as const,
        content: m.content,
      };
    });

    const params: OpenAI.ChatCompletionCreateParams = {
      model: modelId,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (request.maxTokens !== undefined) {
      params.max_tokens = request.maxTokens;
    }

    if (!reasoning && request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools.map(toOpenAITool);
    }

    const stream = await client.chat.completions.create(params);

    // Track active tool calls by index
    const activeToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
      const choice = chunk.choices[0];

      if (!choice) {
        // Final chunk often has no choices but includes usage
        if (chunk.usage) {
          yield {
            type: 'done',
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
          };
        }
        continue;
      }

      const delta = choice.delta;

      // Text content
      if (delta.content) {
        yield {
          type: 'text',
          content: delta.content,
        };
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          const existing = activeToolCalls.get(idx);

          if (!existing) {
            // New tool call starting
            const entry = {
              id: tc.id ?? '',
              name: tc.function?.name ?? '',
              arguments: tc.function?.arguments ?? '',
            };
            activeToolCalls.set(idx, entry);
            yield {
              type: 'tool_call_start',
              toolCall: {
                id: entry.id,
                name: entry.name,
              },
            };
          } else {
            // Continuing an existing tool call
            if (tc.function?.arguments) {
              existing.arguments += tc.function.arguments;
              yield {
                type: 'tool_call_delta',
                content: tc.function.arguments,
                toolCall: {
                  id: existing.id,
                  name: existing.name,
                },
              };
            }
          }
        }
      }

      // Check for finish reason indicating tool calls are complete
      if (choice.finish_reason === 'tool_calls' || choice.finish_reason === 'stop') {
        for (const [, tc] of activeToolCalls) {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = JSON.parse(tc.arguments || '{}') as Record<string, unknown>;
          } catch {
            // If JSON parsing fails, use empty object
          }
          yield {
            type: 'tool_call_end',
            toolCall: {
              id: tc.id,
              name: tc.name,
              arguments: parsedArgs,
            },
          };
        }
        activeToolCalls.clear();
      }
    }
  }

  async embed(text: string, model?: string): Promise<number[]> {
    const client = this.getClient();
    const embeddingModel = model ?? this.defaultEmbeddingModel;

    const response = await client.embeddings.create({
      model: embeddingModel,
      input: text,
    });

    const embedding = response.data[0];
    if (!embedding) {
      throw new Error('No embedding returned from OpenAI');
    }
    return embedding.embedding;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const client = this.getClient();
      const models = await client.models.list();
      // If we can list models, the API is healthy
      return models.data.length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const client = this.getClient();
      const response = await client.models.list();
      const models: ModelInfo[] = [];

      for await (const model of response) {
        models.push({
          id: model.id,
          name: model.id,
        });
      }

      return models;
    } catch {
      // Return known models as fallback
      return [
        { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, maxOutput: 16384 },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, maxOutput: 16384 },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, maxOutput: 4096 },
        { id: 'o1', name: 'O1', contextWindow: 200000, maxOutput: 100000 },
        { id: 'o3-mini', name: 'O3 Mini', contextWindow: 200000, maxOutput: 100000 },
        { id: 'o4-mini', name: 'O4 Mini', contextWindow: 200000, maxOutput: 100000 },
      ];
    }
  }
}
