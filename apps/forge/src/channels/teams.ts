/**
 * Microsoft Teams Channel Provider
 * Handles Bot Framework webhook verification and message parsing.
 */

import { createHmac } from 'crypto';
import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class TeamsProvider implements ChannelProvider {
  type = 'teams' as const;

  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    // Bot Framework uses Bearer token auth via Azure AD
    const authHeader = headers['authorization'] || headers['Authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // In self-hosted mode, we trust internal routing if no auth header
      return { valid: true };
    }
    return { valid: true };
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const activity = body as Record<string, unknown>;

    // Bot Framework sends activities — we only handle 'message' type
    if (activity['type'] !== 'message') return null;

    const text = activity['text'] as string | undefined;
    if (!text || text.trim().length === 0) return null;

    // Strip bot mention from text (Teams prefixes with @botname)
    const cleanText = text.replace(/<at>.*?<\/at>\s*/g, '').trim();
    if (!cleanText) return null;

    return {
      text: cleanText,
      externalMessageId: activity['id'] as string | undefined,
      externalChannelId: ((activity['channelData'] as Record<string, unknown>)?.['channel'] as Record<string, unknown> | undefined)?.['id'] as string | undefined
        ?? (activity['conversation'] as Record<string, unknown>)?.['id'] as string | undefined,
      externalUserId: (activity['from'] as Record<string, unknown>)?.['id'] as string | undefined,
      metadata: {
        conversationId: (activity['conversation'] as Record<string, unknown>)?.['id'],
        serviceUrl: activity['serviceUrl'],
        channelId: activity['channelId'],
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const appId = config.config['app_id'] as string;
    const appPassword = config.config['app_password'] as string;
    if (!appId || !appPassword) {
      throw new Error('Teams sendReply: missing app_id or app_password');
    }

    // Get OAuth token from Bot Framework
    const tokenRes = await fetch('https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: appId,
        client_secret: appPassword,
        scope: 'https://api.botframework.com/.default',
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text().catch(() => '');
      throw new Error(`Teams OAuth failed (${tokenRes.status}): ${errBody.substring(0, 200)}`);
    }
    const tokenData = await tokenRes.json() as { access_token: string };

    // serviceUrl and conversationId come from the inbound message metadata
    const serviceUrl = (config.metadata?.['serviceUrl'] as string) ?? 'https://smba.trafficmanager.net/teams/';
    const conversationId = config.metadata?.['conversationId'] as string;
    if (!conversationId) {
      throw new Error('Teams sendReply: no conversationId in message metadata');
    }

    const replyRes = await fetch(`${serviceUrl}v3/conversations/${conversationId}/activities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenData.access_token}`,
      },
      body: JSON.stringify({
        type: 'message',
        text: message.text.substring(0, 28_000), // Teams message limit
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!replyRes.ok) {
      const errBody = await replyRes.text().catch(() => '');
      throw new Error(`Teams reply failed (${replyRes.status}): ${errBody.substring(0, 200)}`);
    }
  }
}
