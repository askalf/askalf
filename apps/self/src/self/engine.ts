/**
 * Self Conversation Engine
 * Streams AI responses via SSE with an agentic tool loop.
 * Uses Anthropic SDK directly — not MCP, not the Forge agent pipeline.
 */

import type { FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { selfQuery, selfQueryOne } from '../database.js';
import { getAnthropicClient } from './credentials.js';
import { SELF_TOOLS, executeSelfTool } from './tools.js';
import { buildSystemPrompt, WELCOME_MESSAGE } from './system-prompt.js';
import type Anthropic from '@anthropic-ai/sdk';

interface MessageRow {
  role: string;
  content: string;
  tool_calls: unknown[];
}

const MAX_TOOL_TURNS = 10;
const MAX_TOKENS = 4096;
const MODEL = 'claude-sonnet-4-5-20250929';

/**
 * Stream a Self conversation response via SSE.
 */
export async function streamSelfConversation(
  userId: string,
  conversationId: string,
  userMessage: string,
  reply: FastifyReply,
): Promise<void> {
  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Store user message
    const userMsgId = ulid();
    await selfQuery(
      `INSERT INTO self_messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
      [userMsgId, conversationId, userMessage],
    );

    // Update conversation
    await selfQuery(
      `UPDATE self_conversations SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1`,
      [conversationId],
    );

    // Load conversation history (last 50 messages)
    const history = await selfQuery<MessageRow>(
      `SELECT role, content, tool_calls FROM self_messages
       WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 50`,
      [conversationId],
    );

    // Load user preferences for system prompt context
    const preferences = await selfQuery<{ key: string; value: string }>(
      `SELECT key, value FROM user_preferences WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [userId],
    );

    // Build messages for Anthropic API
    const systemPrompt = buildSystemPrompt(preferences);
    const messages = buildApiMessages(history);

    // Get Anthropic client (user's key or platform fallback)
    const anthropic = await getAnthropicClient(userId);

    // Agentic tool loop
    let fullContent = '';
    const allToolCalls: unknown[] = [];
    const allActions: unknown[] = [];
    let totalTokens = 0;

    let currentMessages = messages;
    let toolTurns = 0;

    while (toolTurns < MAX_TOOL_TURNS) {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: currentMessages,
        tools: SELF_TOOLS as Anthropic.Tool[],
      });

      let turnContent = '';
      const turnToolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];

      for await (const event of stream) {
        if (event.type === 'content_block_delta') {
          const delta = event.delta as { type: string; text?: string; partial_json?: string };
          if (delta.type === 'text_delta' && delta.text) {
            turnContent += delta.text;
            send('token', { text: delta.text });
          }
        } else if (event.type === 'content_block_start') {
          const block = event.content_block as { type: string; id?: string; name?: string };
          if (block.type === 'tool_use' && block.id && block.name) {
            turnToolCalls.push({ id: block.id, name: block.name, input: {} });
          }
        } else if (event.type === 'message_delta') {
          const msgDelta = event as unknown as { usage?: { output_tokens?: number } };
          if (msgDelta.usage?.output_tokens) {
            totalTokens += msgDelta.usage.output_tokens;
          }
        }
      }

      // Get the final message to extract complete tool inputs
      const finalMessage = await stream.finalMessage();

      // Extract complete tool call inputs from final message
      for (const block of finalMessage.content) {
        if (block.type === 'tool_use') {
          const tc = turnToolCalls.find(t => t.id === block.id);
          if (tc) {
            tc.input = block.input as Record<string, unknown>;
          }
        }
      }

      fullContent += turnContent;

      // If no tool calls, we're done
      if (turnToolCalls.length === 0) {
        break;
      }

      // Execute tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const tc of turnToolCalls) {
        send('tool_use', { id: tc.id, name: tc.name, input: tc.input });

        const result = await executeSelfTool(tc.name, tc.input, userId, conversationId);

        allToolCalls.push({ id: tc.id, name: tc.name, input: tc.input, result: result.content });

        if (result.actions) {
          for (const action of result.actions) {
            allActions.push(action);
            send('action', action);
          }
        }

        send('tool_result', { id: tc.id, name: tc.name, result: result.content });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: result.content,
        });
      }

      // Build next turn messages: add assistant response + tool results
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: finalMessage.content },
        ...toolResults.map(tr => ({ role: 'user' as const, content: [tr] })),
      ];

      toolTurns++;
    }

    // Store assistant message
    const assistantMsgId = ulid();
    await selfQuery(
      `INSERT INTO self_messages (id, conversation_id, role, content, tool_calls, actions, tokens_used)
       VALUES ($1, $2, 'assistant', $3, $4, $5, $6)`,
      [assistantMsgId, conversationId, fullContent, JSON.stringify(allToolCalls), JSON.stringify(allActions), totalTokens],
    );

    // Update conversation count
    await selfQuery(
      `UPDATE self_conversations SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1`,
      [conversationId],
    );

    // Auto-generate title after first exchange (2 messages = user + assistant)
    const convo = await selfQueryOne<{ message_count: number; title: string | null }>(
      `SELECT message_count, title FROM self_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convo && convo.message_count <= 2 && !convo.title) {
      const title = generateTitle(userMessage);
      await selfQuery(
        `UPDATE self_conversations SET title = $1 WHERE id = $2`,
        [title, conversationId],
      );
      send('title', { title });
    }

    send('done', { tokens: totalTokens, toolCalls: allToolCalls.length });
  } catch (err) {
    console.error('[Self Engine] Error:', err);
    send('error', { message: err instanceof Error ? err.message : 'An error occurred' });
  } finally {
    reply.raw.end();
  }
}

/**
 * Get or create a welcome message for new conversations.
 */
export function getWelcomeMessage(): string {
  return WELCOME_MESSAGE;
}

// ============================================
// Helpers
// ============================================

function buildApiMessages(history: MessageRow[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.content });
    }
  }

  // Ensure messages alternate user/assistant (Anthropic requirement)
  // If first message isn't from user, we have a problem — shouldn't happen normally
  return messages;
}

function generateTitle(firstMessage: string): string {
  // Simple title generation from first message
  const words = firstMessage.trim().split(/\s+/).slice(0, 6);
  let title = words.join(' ');
  if (firstMessage.trim().split(/\s+/).length > 6) {
    title += '...';
  }
  return title.length > 60 ? title.slice(0, 57) + '...' : title;
}
