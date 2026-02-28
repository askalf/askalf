/**
 * Webhook Delivery Worker
 * Processes outbound webhook deliveries with exponential backoff retry.
 */

import { createHmac } from 'crypto';
import { query } from '../database.js';
import { decryptConfigFields, SENSITIVE_KEYS } from './crypto.js';
import type { ChannelConfig } from './types.js';

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 300_000, 1_800_000]; // 1min, 5min, 30min
const POLL_INTERVAL_MS = 15_000; // Check for pending deliveries every 15s

let intervalHandle: ReturnType<typeof setInterval> | undefined;

/**
 * Start the webhook delivery worker. Polls for pending deliveries and sends them.
 */
export function startWebhookRetryWorker(): void {
  // Process immediately on start
  void processWebhookDeliveries();

  intervalHandle = setInterval(() => {
    void processWebhookDeliveries();
  }, POLL_INTERVAL_MS);

  console.log('[WebhookDelivery] Retry worker started');
}

export function stopWebhookRetryWorker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = undefined;
  }
}

async function processWebhookDeliveries(): Promise<void> {
  try {
    // Fetch pending deliveries that are due for retry
    const deliveries = await query<{
      id: string;
      channel_config_id: string;
      execution_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      attempts: number;
    }>(
      `SELECT id, channel_config_id, execution_id, event_type, payload, attempts
       FROM webhook_deliveries
       WHERE status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC LIMIT 20`,
    );

    for (const delivery of deliveries) {
      await deliverWebhook(delivery);
    }
  } catch (err) {
    console.warn('[WebhookDelivery] Poll error:', err instanceof Error ? err.message : err);
  }
}

async function deliverWebhook(delivery: {
  id: string;
  channel_config_id: string;
  execution_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}): Promise<void> {
  // Load channel config
  const config = await query<ChannelConfig>(
    `SELECT * FROM channel_configs WHERE id = $1`,
    [delivery.channel_config_id],
  );
  if (config.length === 0) {
    await query(`UPDATE webhook_deliveries SET status = 'failed', last_error = 'Config not found' WHERE id = $1`, [delivery.id]);
    return;
  }

  const channelConfig = config[0]!;
  const decrypted = decryptConfigFields(channelConfig.config, SENSITIVE_KEYS['webhooks'] ?? []);
  const webhookUrl = decrypted['webhook_url'] as string | undefined;
  const webhookSecret = decrypted['webhook_secret'] as string | undefined;

  if (!webhookUrl) {
    await query(`UPDATE webhook_deliveries SET status = 'failed', last_error = 'No webhook_url configured' WHERE id = $1`, [delivery.id]);
    return;
  }

  const payloadJson = JSON.stringify(delivery.payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AskAlf-Webhooks/1.0',
    'X-AskAlf-Event': delivery.event_type,
    'X-AskAlf-Delivery': delivery.id,
  };

  // Sign payload with HMAC-SHA256 if secret is configured
  if (webhookSecret) {
    const signature = createHmac('sha256', webhookSecret).update(payloadJson).digest('hex');
    headers['X-AskAlf-Signature'] = `sha256=${signature}`;
  }

  const attempt = delivery.attempts + 1;

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: payloadJson,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.ok) {
      await query(
        `UPDATE webhook_deliveries SET status = 'delivered', attempts = $1, delivered_at = NOW() WHERE id = $2`,
        [attempt, delivery.id],
      );
    } else {
      const errorMsg = `HTTP ${response.status}: ${response.statusText}`;
      await handleDeliveryFailure(delivery.id, attempt, errorMsg);
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Network error';
    await handleDeliveryFailure(delivery.id, attempt, errorMsg);
  }
}

async function handleDeliveryFailure(deliveryId: string, attempt: number, error: string): Promise<void> {
  if (attempt >= MAX_ATTEMPTS) {
    await query(
      `UPDATE webhook_deliveries SET status = 'failed', attempts = $1, last_error = $2 WHERE id = $3`,
      [attempt, error, deliveryId],
    );
  } else {
    const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? 1_800_000;
    await query(
      `UPDATE webhook_deliveries SET attempts = $1, last_error = $2, next_retry_at = NOW() + ($3 || ' milliseconds')::INTERVAL WHERE id = $4`,
      [attempt, error, String(delayMs), deliveryId],
    );
  }
}
