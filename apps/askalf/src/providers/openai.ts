/**
 * OpenAI Provider — OpenAI SDK
 */

import OpenAI from 'openai';
import type { LLMProvider, StreamParams, StreamResult, ChatMessage } from './types.js';

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

export const openaiProvider: LLMProvider = {
  id: 'openai',
  name: 'OpenAI',
  defaultModel: 'gpt-4o',
  models: [
    'gpt-5.2',
    'gpt-5.2-codex',
    'gpt-5.1',
    'gpt-5.1-codex',
    'gpt-4.1',
    'gpt-4.5-preview',
    'gpt-4o',
    'gpt-4o-mini',
    'o4-mini',
    'o3',
    'o3-mini',
    'o1',
    'o1-mini',
  ],

  async streamChat(apiKey: string, params: StreamParams): Promise<StreamResult> {
    const client = new OpenAI({ apiKey });
    let totalTokens = 0;

    const stream = await client.chat.completions.create({
      model: params.model,
      messages: toOpenAIMessages(params.messages),
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      if (params.signal?.aborted) break;

      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        params.onToken(delta.content);
      }

      if (chunk.usage?.total_tokens) {
        totalTokens = chunk.usage.total_tokens;
      }
    }

    return { totalTokens };
  },
};
