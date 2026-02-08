/**
 * Context Manager
 * Builds, manages, and truncates the message context window
 * for agent execution loops.
 */

import { estimateTokens } from './token-counter.js';

// ============================================
// Types
// ============================================

export interface MessageToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
  /** Tool calls made by the assistant in this message (for assistant messages only) */
  tool_calls?: MessageToolCall[];
}

export interface AgentConfig {
  systemPrompt: string;
  maxTokensPerTurn: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}

// ============================================
// Build Initial Context
// ============================================

/**
 * Builds the initial messages array for an execution.
 * Places the system prompt first, then appends session history (if any),
 * and finally the current user input.
 *
 * @param agent - Agent configuration with system prompt
 * @param userInput - The current user input text
 * @param sessionHistory - Optional previous session messages to prepend
 * @returns The ordered messages array ready for the completion request
 */
export function buildInitialContext(
  agent: AgentConfig,
  userInput: string,
  sessionHistory?: ReadonlyArray<SessionMessage>,
): Message[] {
  const messages: Message[] = [];

  // System prompt is always first
  messages.push({
    role: 'system',
    content: agent.systemPrompt,
  });

  // Append session history if provided
  if (sessionHistory && sessionHistory.length > 0) {
    for (const msg of sessionHistory) {
      const message: Message = {
        role: msg.role,
        content: msg.content,
      };
      if (msg.tool_call_id !== undefined) {
        message.tool_call_id = msg.tool_call_id;
      }
      if (msg.name !== undefined) {
        message.name = msg.name;
      }
      messages.push(message);
    }
  }

  // Current user input is always last
  messages.push({
    role: 'user',
    content: userInput,
  });

  return messages;
}

// ============================================
// Token Estimation for Messages
// ============================================

/**
 * Estimate the total token count for a messages array.
 * Adds per-message overhead for role and formatting tokens.
 *
 * @param messages - The messages to estimate
 * @returns Estimated total token count
 */
export function estimateContextTokens(messages: ReadonlyArray<Message>): number {
  let total = 0;
  for (const msg of messages) {
    // ~4 tokens overhead per message for role, delimiters, etc.
    total += 4 + estimateTokens(msg.content);
    if (msg.name) {
      total += estimateTokens(msg.name);
    }
  }
  // Small fixed overhead for the request wrapper
  total += 3;
  return total;
}

// ============================================
// Context Truncation
// ============================================

/**
 * Truncates the messages array to fit within a token budget.
 * Strategy:
 * 1. The system prompt (first message) is ALWAYS preserved.
 * 2. The most recent user message (last message) is ALWAYS preserved.
 * 3. Removes the oldest non-system, non-final messages first until
 *    the estimated token count is within budget.
 *
 * If even the system prompt + last user message exceed maxTokens,
 * the messages are returned as-is (the provider will handle the overflow).
 *
 * @param messages - The full messages array
 * @param maxTokens - Maximum allowed tokens for the context window
 * @returns Truncated messages array
 */
export function truncateContext(
  messages: ReadonlyArray<Message>,
  maxTokens: number,
): Message[] {
  if (messages.length === 0) return [];

  // Quick check: if we're already under budget, return as-is
  const currentEstimate = estimateContextTokens(messages);
  if (currentEstimate <= maxTokens) {
    return [...messages];
  }

  // Identify fixed messages (system prompt + last message)
  const systemMessage = messages[0]!;
  const lastMessage = messages[messages.length - 1]!;
  const middleMessages = messages.length > 2 ? messages.slice(1, -1) : [];

  // Check if even the minimum set exceeds the budget
  const minMessages: Message[] =
    systemMessage === lastMessage ? [systemMessage] : [systemMessage, lastMessage];
  const minEstimate = estimateContextTokens(minMessages);
  if (minEstimate >= maxTokens) {
    // Cannot fit even the minimum; return it and let the provider handle truncation
    return minMessages;
  }

  // Build from the most recent messages backward (keeping system prompt and last message fixed)
  const result: Message[] = [systemMessage];
  const budgetForMiddle = maxTokens - minEstimate;
  let middleTokens = 0;

  // We want to keep the most RECENT middle messages, so iterate from the end
  const keptMiddle: Message[] = [];
  for (let i = middleMessages.length - 1; i >= 0; i--) {
    const msg = middleMessages[i];
    if (msg === undefined) continue;

    const msgTokens = 4 + estimateTokens(msg.content) + (msg.name ? estimateTokens(msg.name) : 0);

    if (middleTokens + msgTokens > budgetForMiddle) {
      break;
    }

    middleTokens += msgTokens;
    keptMiddle.unshift(msg);
  }

  result.push(...keptMiddle);

  // Only add last message if it's not the same as the system message
  if (systemMessage !== lastMessage) {
    result.push(lastMessage);
  }

  return result;
}

// ============================================
// Append Tool Results
// ============================================

/**
 * Appends an assistant message (with tool calls) and corresponding
 * tool result messages to the context.
 *
 * @param messages - The current messages array (mutated in place)
 * @param assistantContent - The assistant's text content (may be empty if only tool calls)
 * @param toolResults - Array of tool call results to append
 * @returns The mutated messages array
 */
export function appendToolResults(
  messages: Message[],
  assistantContent: string,
  toolResults: ReadonlyArray<{
    toolCallId: string;
    toolName: string;
    toolArguments?: Record<string, unknown>;
    result: string;
  }>,
): Message[] {
  // Build tool_calls array for the assistant message so the provider can
  // reconstruct proper tool_use content blocks.
  const toolCalls: MessageToolCall[] = toolResults.map((tr) => ({
    id: tr.toolCallId,
    name: tr.toolName,
    arguments: tr.toolArguments ?? {},
  }));

  // Add the assistant message with tool call info attached
  messages.push({
    role: 'assistant',
    content: assistantContent,
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
  });

  // Add each tool result as a tool message
  for (const result of toolResults) {
    messages.push({
      role: 'tool',
      content: result.result,
      tool_call_id: result.toolCallId,
      name: result.toolName,
    });
  }

  return messages;
}
