/**
 * OpenClaw Channel Provider
 * Connects to OpenClaw's WebSocket Gateway to bridge messages from
 * OpenClaw-connected platforms (WhatsApp, Telegram, Discord, etc.)
 * into the AskAlf agent fleet.
 */

import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

// Node 22+ has global WebSocket; declare for TypeScript
declare const WebSocket: {
  new(url: string): WebSocket;
  readonly OPEN: number;
  readonly CLOSED: number;
};
interface WebSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  removeEventListener(type: string, listener: (event: { data: string }) => void): void;
  onopen: ((event: unknown) => void) | null;
  onclose: ((event: { code: number; reason: string }) => void) | null;
  onerror: ((event: { message?: string }) => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
}

const log = (msg: string) => console.log(`[OpenClaw] ${new Date().toISOString()} ${msg}`);

// ── Provider (for result-handler reply routing) ──────────────

export class OpenClawProvider implements ChannelProvider {
  type = 'openclaw' as const;

  verifyWebhook(_headers: Record<string, string>, _body: unknown, _config: ChannelConfig): ChannelVerifyResult {
    // OpenClaw uses WebSocket, not webhooks — always valid if we get here
    return { valid: true };
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const msg = body as Record<string, unknown>;
    const content = (msg['content'] as string) || (msg['text'] as string);
    if (!content?.trim()) return null;

    return {
      text: content.trim(),
      externalMessageId: msg['id'] as string,
      externalChannelId: msg['channel_id'] as string,
      externalUserId: msg['author_id'] as string || msg['user_id'] as string,
      metadata: {
        source: 'openclaw',
        platform: msg['platform'] as string,
        session_id: msg['session_id'] as string,
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    // Route reply through the active gateway client
    const client = OpenClawGatewayClient.getInstance();
    if (!client?.isConnected()) {
      log('Cannot send reply: gateway not connected');
      return;
    }

    const channelId = config.metadata?.['reply_channel_id'] as string;
    client.sendMessage(channelId || 'default', message.text);
  }
}

// ── WebSocket Gateway Client ────────────────────────────────

interface GatewayMessage {
  op: string;
  d?: Record<string, unknown>;
  t?: string;  // event type
}

export class OpenClawGatewayClient {
  private static instance: OpenClawGatewayClient | null = null;

  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private sessionId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private connected = false;
  private onMessage: ((msg: ChannelInboundMessage, platform: string) => void) | null = null;

  constructor(url: string, token: string) {
    this.url = url;
    this.token = token;
  }

  static getInstance(): OpenClawGatewayClient | null {
    return OpenClawGatewayClient.instance;
  }

  static create(url: string, token: string): OpenClawGatewayClient {
    if (OpenClawGatewayClient.instance) {
      OpenClawGatewayClient.instance.disconnect();
    }
    OpenClawGatewayClient.instance = new OpenClawGatewayClient(url, token);
    return OpenClawGatewayClient.instance;
  }

  onInboundMessage(handler: (msg: ChannelInboundMessage, platform: string) => void): void {
    this.onMessage = handler;
  }

  isConnected(): boolean {
    return this.connected && this.ws?.readyState === WebSocket.OPEN;
  }

  connect(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }

    log(`Connecting to gateway: ${this.url}`);

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      log(`Connection error: ${err}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      log('WebSocket connected, identifying...');
      this.reconnectAttempts = 0;
      this.send({
        op: 'identify',
        d: {
          token: this.token,
          client: 'askalf-bridge',
          version: '1.0.0',
          intents: ['messages', 'sessions'],
        },
      });
    };

    this.ws.onmessage = (event: { data: string }) => {
      try {
        const msg: GatewayMessage = JSON.parse(String(event.data));
        this.handleGatewayMessage(msg);
      } catch (err) {
        log(`Failed to parse message: ${err}`);
      }
    };

    this.ws.onclose = (event: { code: number; reason: string }) => {
      this.connected = false;
      this.stopHeartbeat();
      log(`Disconnected: ${event.code} ${event.reason || ''}`);
      this.scheduleReconnect();
    };

    this.ws.onerror = (event: { message?: string }) => {
      log(`WebSocket error: ${event.message || 'unknown'}`);
    };
  }

  disconnect(): void {
    this.connected = false;
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close(1000, 'AskAlf bridge shutting down');
      this.ws = null;
    }
    OpenClawGatewayClient.instance = null;
    log('Disconnected from gateway');
  }

  sendMessage(channelId: string, content: string): void {
    this.send({
      op: 'message_send',
      d: {
        channel_id: channelId,
        content,
        session_id: this.sessionId,
      },
    });
  }

  // ── Internal ──────────────────────────────────────────

  private handleGatewayMessage(msg: GatewayMessage): void {
    switch (msg.op) {
      case 'ready': {
        this.connected = true;
        this.sessionId = msg.d?.['session_id'] as string || null;
        log(`Identified. Session: ${this.sessionId}`);
        this.startHeartbeat();
        break;
      }

      case 'message_create': {
        const data = msg.d;
        if (!data) break;

        const content = data['content'] as string;
        if (!content?.trim()) break;

        const platform = (data['platform'] as string) || 'unknown';
        const parsed: ChannelInboundMessage = {
          text: content.trim(),
          externalMessageId: data['id'] as string,
          externalChannelId: data['channel_id'] as string,
          externalUserId: (data['author'] as Record<string, unknown>)?.['id'] as string
            || data['user_id'] as string,
          metadata: {
            source: 'openclaw',
            platform,
            session_id: data['session_id'] as string,
            raw: data,
          },
        };

        log(`Message from ${platform}: "${content.slice(0, 80)}"`);
        this.onMessage?.(parsed, platform);
        break;
      }

      case 'heartbeat_ack':
        break;

      case 'error': {
        const error = msg.d?.['message'] || JSON.stringify(msg.d);
        log(`Gateway error: ${error}`);
        break;
      }

      default:
        // Log unknown opcodes for future extension
        if (msg.op !== 'heartbeat') {
          log(`Unknown op: ${msg.op}`);
        }
    }
  }

  private send(msg: GatewayMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.send({ op: 'heartbeat', d: { session_id: this.sessionId } });
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log(`Max reconnect attempts (${this.maxReconnectAttempts}) reached. Giving up.`);
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60_000);
    this.reconnectAttempts++;
    log(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
