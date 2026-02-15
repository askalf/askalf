/**
 * Claude Provider — Anthropic SDK
 */

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, StreamParams, StreamResult, ChatMessage } from './types.js';

function toAnthropicMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

export const claudeProvider: LLMProvider = {
  id: 'claude',
  name: 'Claude',
  defaultModel: 'claude-sonnet-4-5',
  models: [
    'claude-opus-4-6',
    'claude-sonnet-4-5',
    'claude-haiku-4-5',
  ],

  async streamChat(apiKey: string, params: StreamParams): Promise<StreamResult> {
    const client = new Anthropic({ apiKey });
    let totalTokens = 0;

    const stream = client.messages.stream({
      model: params.model,
      max_tokens: 4096,
      messages: toAnthropicMessages(params.messages),
    });

    for await (const event of stream) {
      if (params.signal?.aborted) {
        stream.abort();
        break;
      }

      if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; text?: string };
        if (delta.type === 'text_delta' && delta.text) {
          params.onToken(delta.text);
        }
      } else if (event.type === 'message_delta') {
        const msgDelta = event as unknown as { usage?: { output_tokens?: number } };
        if (msgDelta.usage?.output_tokens) {
          totalTokens += msgDelta.usage.output_tokens;
        }
      }
    }

    return { totalTokens };
  },
};
