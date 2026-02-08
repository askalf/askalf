/**
 * Custom Provider Adapter
 * Implements IProviderAdapter for any OpenAI-compatible endpoint.
 * Uses the OpenAI SDK with a configurable baseURL and apiKey.
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

export class CustomAdapter implements IProviderAdapter {
  readonly type = 'custom';

  private _name: string;
  private client: OpenAI | null = null;
  private defaultModel = '';
  private baseUrl = '';
  private supportsEmbeddings = false;

  constructor(name?: string) {
    this._name = name ?? 'custom';
  }

  get name(): string {
    return this._name;
  }

  async initialize(config: Record<string, unknown>): Promise<void> {
    const apiKey = config['apiKey'] as string | undefined;
    const baseURL = config['baseUrl'] as string | undefined ?? config['baseURL'] as string | undefined;

    if (!baseURL) {
      throw new Error('Custom provider requires a baseUrl');
    }

    this.baseUrl = baseURL;

    this.client = new OpenAI({
      apiKey: apiKey ?? 'no-key',
      baseURL,
    });

    if (typeof config['name'] === 'string') {
      this._name = config['name'];
    }
    if (typeof config['defaultModel'] === 'string') {
      this.defaultModel = config['defaultModel'];
    }
    if (typeof config['supportsEmbeddings'] === 'boolean') {
      this.supportsEmbeddings = config['supportsEmbeddings'];
    }
  }

  private getClient(): OpenAI {
    if (!this.client) {
      throw new Error('CustomAdapter not initialized. Call initialize() first.');
    }
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const client = this.getClient();
    const modelId = request.model || this.defaultModel;

    if (!modelId) {
      throw new Error('No model specified and no default model configured for custom provider');
    }

    const messages: ChatCompletionMessageParam[] = request.messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.tool_call_id ?? '',
        };
      }
      if (m.role === 'system') {
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

    if (request.temperature !== undefined) {
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
        model: modelId,
        provider: this.name,
      };
    }

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

    if (!modelId) {
      throw new Error('No model specified and no default model configured for custom provider');
    }

    const messages: ChatCompletionMessageParam[] = request.messages.map((m) => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.tool_call_id ?? '',
        };
      }
      if (m.role === 'system') {
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
    };

    if (request.maxTokens !== undefined) {
      params.max_tokens = request.maxTokens;
    }

    if (request.temperature !== undefined) {
      params.temperature = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      params.tools = request.tools.map(toOpenAITool);
    }

    const stream = await client.chat.completions.create(params);

    const activeToolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
      const choice = chunk.choices[0];

      if (!choice) {
        continue;
      }

      const delta = choice.delta;

      if (delta.content) {
        yield {
          type: 'text',
          content: delta.content,
        };
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          const existing = activeToolCalls.get(idx);

          if (!existing) {
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

        yield {
          type: 'done',
        };
      }
    }
  }

  async embed(text: string, model?: string): Promise<number[]> {
    if (!this.supportsEmbeddings) {
      throw new Error(
        `Custom provider "${this.name}" does not support embeddings. ` +
        'Set supportsEmbeddings: true in config if the endpoint supports them.',
      );
    }

    const client = this.getClient();
    const embeddingModel = model ?? this.defaultModel;

    if (!embeddingModel) {
      throw new Error('No embedding model specified');
    }

    const response = await client.embeddings.create({
      model: embeddingModel,
      input: text,
    });

    const embedding = response.data[0];
    if (!embedding) {
      throw new Error('No embedding returned from custom provider');
    }
    return embedding.embedding;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const client = this.getClient();
      const models = await client.models.list();
      return models.data.length > 0;
    } catch {
      // If model listing fails, try a simple fetch to the base URL
      try {
        const response = await fetch(this.baseUrl);
        return response.ok;
      } catch {
        return false;
      }
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
      return [];
    }
  }
}
