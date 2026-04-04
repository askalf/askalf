/**
 * Google AI Provider Adapter
 * Implements IProviderAdapter using the @google/generative-ai SDK.
 * Supports Gemini models with tool use, streaming, and embeddings.
 */

import {
  GoogleGenerativeAI,
  type Content,
  type Part,
  type FunctionDeclaration,
  type GenerateContentResult,
  type GenerateContentStreamResult,
} from '@google/generative-ai';
import type {
  IProviderAdapter,
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
  ToolDefinition,
  ToolCall,
  ModelInfo,
} from '../interface.js';

/**
 * Convert a generic ToolDefinition to Google's FunctionDeclaration format.
 * Google expects a specific schema structure for function parameters.
 */
function toGoogleFunctionDeclaration(tool: ToolDefinition): FunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema as unknown as FunctionDeclaration['parameters'],
  };
}

/**
 * Convert our message format to Google's Content array.
 * Google uses 'user' and 'model' roles, and handles system instructions separately.
 */
function toGoogleMessages(
  messages: CompletionRequest['messages'],
): { systemInstruction: string | undefined; contents: Content[] } {
  const systemParts: string[] = [];
  const contents: Content[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
      continue;
    }

    if (msg.role === 'tool') {
      // Tool results go as function responses under the 'function' role
      contents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: msg.name ?? msg.tool_call_id ?? 'unknown',
              response: { result: msg.content },
            },
          },
        ],
      });
      continue;
    }

    if (msg.role === 'assistant') {
      contents.push({
        role: 'model',
        parts: [{ text: msg.content }],
      });
      continue;
    }

    // 'user' role
    contents.push({
      role: 'user',
      parts: [{ text: msg.content }],
    });
  }

  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    contents,
  };
}

/** Extract text content from Google response parts. */
function extractTextFromParts(parts: Part[]): string {
  const textParts: string[] = [];
  for (const part of parts) {
    if ('text' in part && typeof part.text === 'string') {
      textParts.push(part.text);
    }
  }
  return textParts.join('');
}

/** Extract tool calls from Google response parts. */
function extractToolCallsFromParts(parts: Part[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  let callIndex = 0;

  for (const part of parts) {
    if ('functionCall' in part && part.functionCall) {
      toolCalls.push({
        id: `google-tc-${callIndex++}`,
        name: part.functionCall.name,
        arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
      });
    }
  }

  return toolCalls;
}

export class GoogleAdapter implements IProviderAdapter {
  readonly name = 'google';
  readonly type = 'google';

  private genAI: GoogleGenerativeAI | null = null;
  private defaultModel = 'gemini-2.0-flash';
  private defaultEmbeddingModel = 'text-embedding-004';

  async initialize(config: Record<string, unknown>): Promise<void> {
    const apiKey = config['apiKey'] as string | undefined;
    if (!apiKey) {
      throw new Error('Google AI API key is required');
    }
    this.genAI = new GoogleGenerativeAI(apiKey);

    if (typeof config['defaultModel'] === 'string') {
      this.defaultModel = config['defaultModel'];
    }
    if (typeof config['defaultEmbeddingModel'] === 'string') {
      this.defaultEmbeddingModel = config['defaultEmbeddingModel'];
    }
  }

  private getGenAI(): GoogleGenerativeAI {
    if (!this.genAI) {
      throw new Error('GoogleAdapter not initialized. Call initialize() first.');
    }
    return this.genAI;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const genAI = this.getGenAI();
    const modelId = request.model || this.defaultModel;
    const { systemInstruction, contents } = toGoogleMessages(request.messages);

    const generationConfig: Record<string, unknown> = {};
    if (request.maxTokens !== undefined) {
      generationConfig['maxOutputTokens'] = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      generationConfig['temperature'] = request.temperature;
    }

    const modelConfig: Record<string, unknown> = {
      model: modelId,
    };

    if (systemInstruction) {
      modelConfig['systemInstruction'] = systemInstruction;
    }
    if (Object.keys(generationConfig).length > 0) {
      modelConfig['generationConfig'] = generationConfig;
    }

    if (request.tools && request.tools.length > 0) {
      modelConfig['tools'] = [
        {
          functionDeclarations: request.tools.map(toGoogleFunctionDeclaration),
        },
      ];
    }

    const model = genAI.getGenerativeModel(modelConfig as unknown as Parameters<GoogleGenerativeAI['getGenerativeModel']>[0]);

    const result: GenerateContentResult = await model.generateContent({
      contents,
    });

    const response = result.response;
    const candidate = response.candidates?.[0];

    if (!candidate) {
      return {
        content: '',
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        finishReason: 'error',
        model: modelId,
        provider: this.name,
      };
    }

    const parts = candidate.content?.parts ?? [];
    const textContent = extractTextFromParts(parts);
    const toolCalls = extractToolCallsFromParts(parts);

    let finishReason: CompletionResponse['finishReason'] = 'stop';
    if (toolCalls.length > 0) {
      finishReason = 'tool_use';
    } else if (candidate.finishReason === 'MAX_TOKENS') {
      finishReason = 'max_tokens';
    }

    return {
      content: textContent,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      finishReason,
      model: modelId,
      provider: this.name,
    };
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const genAI = this.getGenAI();
    const modelId = request.model || this.defaultModel;
    const { systemInstruction, contents } = toGoogleMessages(request.messages);

    const generationConfig: Record<string, unknown> = {};
    if (request.maxTokens !== undefined) {
      generationConfig['maxOutputTokens'] = request.maxTokens;
    }
    if (request.temperature !== undefined) {
      generationConfig['temperature'] = request.temperature;
    }

    const modelConfig: Record<string, unknown> = {
      model: modelId,
    };

    if (systemInstruction) {
      modelConfig['systemInstruction'] = systemInstruction;
    }
    if (Object.keys(generationConfig).length > 0) {
      modelConfig['generationConfig'] = generationConfig;
    }

    if (request.tools && request.tools.length > 0) {
      modelConfig['tools'] = [
        {
          functionDeclarations: request.tools.map(toGoogleFunctionDeclaration),
        },
      ];
    }

    const model = genAI.getGenerativeModel(modelConfig as unknown as Parameters<GoogleGenerativeAI['getGenerativeModel']>[0]);

    const result: GenerateContentStreamResult = await model.generateContentStream({
      contents,
    });

    let toolCallIndex = 0;

    for await (const chunk of result.stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate) {
        continue;
      }

      const parts = candidate.content?.parts ?? [];

      for (const part of parts) {
        if ('text' in part && typeof part.text === 'string') {
          yield {
            type: 'text',
            content: part.text,
          };
        }

        if ('functionCall' in part && part.functionCall) {
          const callId = `google-tc-${toolCallIndex++}`;
          yield {
            type: 'tool_call_start',
            toolCall: {
              id: callId,
              name: part.functionCall.name,
            },
          };
          yield {
            type: 'tool_call_end',
            toolCall: {
              id: callId,
              name: part.functionCall.name,
              arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
            },
          };
        }
      }

      // Emit usage on the final chunk
      if (chunk.usageMetadata) {
        yield {
          type: 'done',
          inputTokens: chunk.usageMetadata.promptTokenCount,
          outputTokens: chunk.usageMetadata.candidatesTokenCount,
        };
      }
    }
  }

  async embed(text: string, model?: string): Promise<number[]> {
    const genAI = this.getGenAI();
    const embeddingModel = model ?? this.defaultEmbeddingModel;

    const embModel = genAI.getGenerativeModel({ model: embeddingModel });
    const result = await embModel.embedContent(text);
    return result.embedding.values;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const genAI = this.getGenAI();
      const model = genAI.getGenerativeModel({ model: this.defaultModel });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      });
      return result.response.text().length > 0;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    // Google doesn't provide a straightforward list models SDK method in @google/generative-ai;
    // return known models.
    return [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1048576, maxOutput: 8192 },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', contextWindow: 1048576, maxOutput: 8192 },
      { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', contextWindow: 1048576, maxOutput: 65536 },
      { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', contextWindow: 1048576, maxOutput: 65536 },
      { id: 'text-embedding-004', name: 'Text Embedding 004', contextWindow: 2048 },
    ];
  }
}
