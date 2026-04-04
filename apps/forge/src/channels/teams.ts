/**
 * Microsoft Teams Channel Provider
 * Handles Bot Framework webhook verification and message parsing.
 */

import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

export class TeamsProvider implements ChannelProvider {
  type = 'teams' as const;

  verifyWebhook(headers: Record<string, string>, body: unknown, config: ChannelConfig): ChannelVerifyResult {
    // Bot Framework uses Bearer token auth via Azure AD
    const authHeader = headers['authorization'] || headers['Authorization'];
    const appPassword = config.config['app_password'] as string | undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth header present — only allow if the channel has no app_password configured
      // (i.e. unconfigured/development channel). If app_password is set, auth is required.
      if (appPassword) {
        return { valid: false, error: 'Missing Authorization header; authentication is required when app_password is configured' };
      }
      return { valid: true };
    }

    // Validate Bearer token structure.
    // Azure AD JWT tokens are three Base64url-encoded segments separated by dots.
    const token = authHeader.slice('Bearer '.length).trim();

    if (!token) {
      return { valid: false, error: 'Empty Bearer token' };
    }

    // JWT format: header.payload.signature — each segment is non-empty Base64url
    const jwtSegments = token.split('.');
    if (jwtSegments.length !== 3) {
      return { valid: false, error: 'Bearer token is not a valid JWT (expected 3 segments)' };
    }

    const base64urlPattern = /^[A-Za-z0-9_-]+$/;
    for (const segment of jwtSegments) {
      if (!segment || !base64urlPattern.test(segment)) {
        return { valid: false, error: 'Bearer token contains invalid JWT segment' };
      }
    }

    // Reject suspiciously short tokens — real Azure AD JWTs are typically 800+ chars
    if (token.length < 100) {
      return { valid: false, error: 'Bearer token is too short to be a valid Azure AD JWT' };
    }

    // Decode and verify JWT claims (issuer + audience)
    try {
      const payloadB64 = jwtSegments[1]!;
      const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as Record<string, unknown>;

      // Verify issuer — must be Microsoft Bot Framework or Azure AD
      const iss = payload['iss'] as string || '';
      const validIssuers = [
        'https://api.botframework.com',
        'https://sts.windows.net/',
        'https://login.microsoftonline.com/',
      ];
      if (!validIssuers.some(vi => iss.startsWith(vi))) {
        return { valid: false, error: `JWT issuer "${iss}" is not a recognized Microsoft issuer` };
      }

      // Verify audience — must match app ID if configured
      const appId = config.config['app_id'] as string | undefined;
      if (appId) {
        const aud = payload['aud'] as string || '';
        if (aud !== appId) {
          return { valid: false, error: `JWT audience "${aud}" does not match configured app_id` };
        }
      }

      // Verify token is not expired
      const exp = payload['exp'] as number | undefined;
      if (exp && exp * 1000 < Date.now()) {
        return { valid: false, error: 'JWT token has expired' };
      }
    } catch {
      return { valid: false, error: 'Failed to decode JWT payload' };
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
