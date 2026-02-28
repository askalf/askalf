/**
 * Channel Result Handler
 * Listens for execution.completed events and routes results back to originating channels.
 */

import { getEventBus, type ExecutionEvent } from '../orchestration/event-bus.js';
import { query, queryOne } from '../database.js';
import { getChannelProvider } from './index.js';
import { decryptConfigFields, SENSITIVE_KEYS } from './crypto.js';
import type { ChannelConfig, ChannelType } from './types.js';

/**
 * Start listening for execution completion events and deliver results
 * back to the originating channel.
 */
export function startChannelResultHandler(): void {
  const eventBus = getEventBus();
  if (!eventBus) {
    console.warn('[ChannelResult] Event bus not available, result handler not started');
    return;
  }

  eventBus.on('execution', async (event) => {
    const execEvent = event as ExecutionEvent;
    if (execEvent.event !== 'completed' && execEvent.event !== 'failed') return;

    try {
      await handleExecutionResult(execEvent);
    } catch (err) {
      console.error('[ChannelResult] Error handling execution result:', err instanceof Error ? err.message : err);
    }
  });

  console.log('[ChannelResult] Channel result handler started');
}

async function handleExecutionResult(event: ExecutionEvent): Promise<void> {
  // Find channel messages linked to this execution
  const messages = await query<{
    id: string;
    channel_config_id: string;
    channel_type: string;
    external_channel_id: string | null;
    external_message_id: string | null;
    external_user_id: string | null;
  }>(
    `SELECT id, channel_config_id, channel_type, external_channel_id, external_message_id, external_user_id
     FROM channel_messages
     WHERE execution_id = $1 AND direction = 'inbound' AND status = 'dispatched'`,
    [event.executionId],
  );

  if (messages.length === 0) return; // Not a channel-triggered execution

  // Get the execution output
  const execution = await queryOne<{ output: string | null; error: string | null }>(
    `SELECT output, error FROM forge_executions WHERE id = $1`,
    [event.executionId],
  );

  const resultText = event.event === 'completed'
    ? (execution?.output ?? 'Task completed successfully.')
    : (execution?.error ?? event.data?.error ?? 'Execution failed.');

  for (const msg of messages) {
    try {
      // Load channel config
      const config = await queryOne<ChannelConfig>(
        `SELECT * FROM channel_configs WHERE id = $1 AND is_active = true`,
        [msg.channel_config_id],
      );
      if (!config) continue;

      const channelType = msg.channel_type as ChannelType;

      // For webhooks channel, queue a webhook delivery instead
      if (channelType === 'webhooks') {
        await queueWebhookDelivery(config, event);
        await query(`UPDATE channel_messages SET status = 'replied' WHERE id = $1`, [msg.id]);
        continue;
      }

      // For chat channels (slack, discord, telegram, whatsapp), send reply via provider
      const provider = getChannelProvider(channelType);
      if (!provider) continue;

      // Decrypt config for sending
      const decryptedConfig = {
        ...config,
        config: decryptConfigFields(config.config, SENSITIVE_KEYS[channelType] ?? []),
      };

      await provider.sendReply(decryptedConfig, {
        text: resultText,
        executionId: event.executionId,
        channelMessageId: msg.id,
      });

      await query(`UPDATE channel_messages SET status = 'replied' WHERE id = $1`, [msg.id]);
    } catch (err) {
      console.error(`[ChannelResult] Failed to deliver result to channel ${msg.channel_type}:`, err instanceof Error ? err.message : err);
      await query(
        `UPDATE channel_messages SET status = 'failed', metadata = jsonb_set(metadata, '{delivery_error}', $1::jsonb) WHERE id = $2`,
        [JSON.stringify(err instanceof Error ? err.message : 'Unknown error'), msg.id],
      );
    }
  }
}

async function queueWebhookDelivery(config: ChannelConfig, event: ExecutionEvent): Promise<void> {
  const { ulid } = await import('ulid');

  const execution = await queryOne<{
    output: string | null;
    error: string | null;
    agent_id: string;
    status: string;
    cost: string;
    duration_ms: number | null;
  }>(
    `SELECT output, error, agent_id, status, cost, duration_ms FROM forge_executions WHERE id = $1`,
    [event.executionId],
  );

  const payload = {
    event: event.event === 'completed' ? 'execution.completed' : 'execution.failed',
    executionId: event.executionId,
    agentId: execution?.agent_id,
    status: execution?.status,
    output: execution?.output,
    error: execution?.error,
    cost: execution?.cost,
    durationMs: execution?.duration_ms,
    timestamp: new Date().toISOString(),
  };

  await query(
    `INSERT INTO webhook_deliveries (id, channel_config_id, execution_id, event_type, payload, status, next_retry_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
    [ulid(), config.id, event.executionId, payload.event, JSON.stringify(payload)],
  );
}
