/**
 * Ollama Provider Adapter
 * Implements IProviderAdapter using the OpenAI SDK pointed at Ollama's
 * OpenAI-compatible endpoint, plus direct Ollama API calls for embeddings
 * and model listing.
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

/** Ollama /api/tags response shape. */
interface OllamaTagsResponse {
  models: Array<{
    name: string;
    modified_at: string;
    size: number;
    details?: {
      parameter_size?: string;
      quantization_level?: string;
    };
  }>;
}

/** Ollama /api/embeddings response shape. */
interface OllamaEmbeddingsResponse {
  embedding: number[];
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

export class OllamaAdapter implements IProviderAdapter {
  readonly name = 'ollama';
  readonly type = 'ollama';

  private client: OpenAI | null = null;
  private baseUrl = 'http://localhost:11434';
  private defaultModel = 'llama3.1';
  private defaultEmbeddingModel = 'nomic-embed-text';

  async initialize(config: Record<string, unknown>): Promise<void> {
    if (typeof config['baseUrl'] === 'string') {
      this.baseUrl = config['baseUrl'];
    }

    // Point OpenAI SDK at Ollama's OpenAI-compatible endpoint
    this.client = new OpenAI({
      baseURL: `${this.baseUrl}/v1`,
      apiKey: 'ollama', // Ollama doesn't require a real key
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
      throw new Error('OllamaAdapter not initialized. Call initialize() first.');
    }
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const client = this.getClient();
    const modelId = request.model || this.defaultModel;

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
      model: modelId,
      provider: this.name,
    };
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const client = this.getClient();
    const modelId = request.model || this.defaultModel;

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
    const embeddingModel = model ?? this.defaultEmbeddingModel;

    // Use the direct Ollama API for embeddings (not the OpenAI-compatible endpoint)
    const response = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: embeddingModel,
        prompt: text,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama embeddings request failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as OllamaEmbeddingsResponse;
    return data.embedding;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) {
        return [];
      }

      const data = (await response.json()) as OllamaTagsResponse;
      return data.models.map((m) => ({
        id: m.name,
        name: m.name,
      }));
    } catch {
      return [];
    }
  }
}
