/**
 * Channel Dispatch Adapter
 * Shared dispatch pipeline: inbound message → intent parse → agent match → execute
 */

import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { runDirectCliExecution } from '../runtime/worker.js';
import type { ChannelConfig, ChannelInboundMessage } from './types.js';

interface AgentMatch {
  id: string;
  name: string;
  model_id: string | null;
  system_prompt: string | null;
  max_cost_per_execution: string;
  max_iterations: number;
  agent_type: string;
}

interface ParsedIntentResult {
  category: string;
  agentName: string;
  systemPrompt: string;
  complexity: string;
}

/**
 * Parse intent directly using Claude Haiku (no HTTP round-trip).
 * Lightweight version of the full intent parser for channel dispatches.
 */
async function parseIntentDirect(message: string): Promise<ParsedIntentResult> {
  const apiKey = process.env['ANTHROPIC_INTENT_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY_FALLBACK'];
  if (!apiKey) {
    // Fallback: default to research category
    return {
      category: 'research',
      agentName: 'Channel Agent',
      systemPrompt: 'You are a helpful AI agent.',
      complexity: 'medium',
    };
  }

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: `Classify this user request into one category. Respond in JSON only.
Categories: research, monitor, build, analyze, automate, security
JSON format: {"category":"...","agentName":"short name","systemPrompt":"focused prompt","complexity":"low|medium|high"}`,
      messages: [{ role: 'user', content: message }],
    });

    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('');

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as ParsedIntentResult;
    }
  } catch (err) {
    console.warn('[Channel] Intent parse failed, using default:', err instanceof Error ? err.message : err);
  }

  return {
    category: 'research',
    agentName: 'Channel Agent',
    systemPrompt: 'You are a helpful AI agent.',
    complexity: 'medium',
  };
}

/**
 * Match a parsed intent category to the best available user-facing agent.
 */
async function matchAgent(category: string, ownerId: string): Promise<AgentMatch | null> {
  // Map intent categories to agent types
  const typeMap: Record<string, string[]> = {
    research: ['research'],
    security: ['security'],
    build: ['dev'],
    analyze: ['research'],
    automate: ['content'],
    monitor: ['monitor'],
  };

  const agentTypes = typeMap[category] ?? ['research'];

  // Find the best matching user-facing agent (not internal)
  for (const agentType of agentTypes) {
    const agent = await queryOne<AgentMatch>(
      `SELECT id, name, model_id, system_prompt, max_cost_per_execution, max_iterations, agent_type
       FROM forge_agents
       WHERE owner_id = $1 AND agent_type = $2 AND status = 'active'
         AND (metadata->>'is_internal')::boolean IS NOT TRUE
       ORDER BY created_at DESC LIMIT 1`,
      [ownerId, agentType],
    );
    if (agent) return agent;
  }

  // Fallback: any active user-facing agent
  return queryOne<AgentMatch>(
    `SELECT id, name, model_id, system_prompt, max_cost_per_execution, max_iterations, agent_type
     FROM forge_agents
     WHERE owner_id = $1 AND status = 'active'
       AND (metadata->>'is_internal')::boolean IS NOT TRUE
     ORDER BY created_at DESC LIMIT 1`,
    [ownerId],
  );
}

/**
 * Dispatch an inbound channel message to the agent pipeline.
 * Returns the execution ID if dispatched, null if no agent available.
 */
export async function dispatchChannelMessage(
  channelConfig: ChannelConfig,
  message: ChannelInboundMessage,
): Promise<{ executionId: string; channelMessageId: string } | null> {
  // Record the inbound message
  const channelMessageId = ulid();
  await query(
    `INSERT INTO channel_messages (id, channel_config_id, execution_id, channel_type, external_message_id, external_channel_id, external_user_id, direction, content, status)
     VALUES ($1, $2, NULL, $3, $4, $5, $6, 'inbound', $7, 'received')`,
    [channelMessageId, channelConfig.id, channelConfig.channel_type, message.externalMessageId ?? null, message.externalChannelId ?? null, message.externalUserId ?? null, message.text],
  );

  // Parse intent
  const intent = await parseIntentDirect(message.text);

  // Match to agent
  const agent = await matchAgent(intent.category, channelConfig.user_id);
  if (!agent) {
    await query(
      `UPDATE channel_messages SET status = 'failed', metadata = jsonb_set(metadata, '{error}', '"No agent available"') WHERE id = $1`,
      [channelMessageId],
    );
    return null;
  }

  // Create execution
  const executionId = ulid();
  await query(
    `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
     VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
    [
      executionId,
      agent.id,
      channelConfig.user_id,
      message.text,
      JSON.stringify({
        source: `channel:${channelConfig.channel_type}`,
        channel_config_id: channelConfig.id,
        channel_message_id: channelMessageId,
        external_channel_id: message.externalChannelId,
        external_user_id: message.externalUserId,
      }),
    ],
  );

  // Link message to execution
  await query(
    `UPDATE channel_messages SET execution_id = $1, status = 'dispatched' WHERE id = $2`,
    [executionId, channelMessageId],
  );

  // Fire-and-forget execution
  void runDirectCliExecution(executionId, agent.id, message.text, channelConfig.user_id, {
    modelId: agent.model_id ?? undefined,
    systemPrompt: agent.system_prompt ?? undefined,
    maxBudgetUsd: agent.max_cost_per_execution,
    maxTurns: agent.max_iterations,
  }).catch((err) => {
    console.error(`[Channel] Execution ${executionId} failed:`, err instanceof Error ? err.message : err);
  });

  return { executionId, channelMessageId };
}
