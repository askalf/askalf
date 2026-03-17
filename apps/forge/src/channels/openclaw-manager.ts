/**
 * OpenClaw Bridge Manager
 * Manages the lifecycle of the OpenClaw Gateway WebSocket connection.
 * Started on forge boot if an active OpenClaw channel config exists.
 */

import { query, queryOne } from '../database.js';
import { OpenClawGatewayClient } from './openclaw.js';
import { dispatchChannelMessage } from './dispatch-adapter.js';
import type { ChannelConfig } from './types.js';

const log = (msg: string) => console.log(`[OpenClaw Bridge] ${new Date().toISOString()} ${msg}`);

let bridgeActive = false;

export async function startOpenClawBridge(): Promise<void> {
  // Check for env-based config first
  const gatewayUrl = process.env['OPENCLAW_GATEWAY_URL'];
  const gatewayToken = process.env['OPENCLAW_GATEWAY_TOKEN'] || '';

  if (!gatewayUrl) {
    // Check for database-configured OpenClaw channel
    const config = await queryOne<{ id: string; config: Record<string, unknown>; metadata: Record<string, unknown> }>(
      `SELECT id, config, metadata FROM channel_configs
       WHERE channel_type = 'openclaw' AND is_active = true
       LIMIT 1`,
    );

    if (!config) return;  // No OpenClaw config — skip silently

    const url = config.config['gateway_url'] as string;
    const token = config.config['gateway_token'] as string || '';

    if (!url) {
      log('OpenClaw channel config found but gateway_url is empty');
      return;
    }

    startBridge(url, token, config.id);
    return;
  }

  startBridge(gatewayUrl, gatewayToken, 'env');
}

function startBridge(url: string, token: string, configSource: string): void {
  log(`Starting bridge (source: ${configSource}) → ${url}`);

  const client = OpenClawGatewayClient.create(url, token);

  client.onInboundMessage(async (message, platform) => {
    try {
      // Build a virtual ChannelConfig for dispatch
      const channelConfig: ChannelConfig = {
        id: `openclaw-${configSource}`,
        tenant_id: 'selfhosted',
        user_id: 'selfhosted-admin',
        channel_type: 'openclaw',
        name: `OpenClaw (${platform})`,
        is_active: true,
        config: {},
        metadata: {
          platform,
          reply_channel_id: message.externalChannelId,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const result = await dispatchChannelMessage(channelConfig, message);
      if (result) {
        log(`Dispatched ${platform} message → execution ${result.executionId}`);
      }
    } catch (err) {
      log(`Dispatch error: ${err}`);
    }
  });

  client.connect();
  bridgeActive = true;
}

export function stopOpenClawBridge(): void {
  if (!bridgeActive) return;

  const client = OpenClawGatewayClient.getInstance();
  if (client) {
    client.disconnect();
  }
  bridgeActive = false;
  log('Bridge stopped');
}
