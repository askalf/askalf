/**
 * OpenClaw Channel Provider
 * Connects to OpenClaw's WebSocket Gateway (protocol v3) to bridge messages
 * from OpenClaw-connected platforms into the AskAlf agent fleet.
 *
 * Protocol: JSON-RPC over WebSocket
 * Frame types: req (client→server), res (server→client), event (server→client)
 * Auth: token-based via connect handshake
 */

import type { ChannelProvider, ChannelConfig, ChannelInboundMessage, ChannelOutboundMessage, ChannelVerifyResult } from './types.js';

const log = (msg: string) => console.log(`[OpenClaw] ${new Date().toISOString()} ${msg}`);

// ── Protocol v3 Frame Types ──────────────────────────

interface RequestFrame {
  type: 'req';
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface ResponseFrame {
  type: 'res';
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { code: string; message: string; retryable?: boolean; retryAfterMs?: number };
}

interface EventFrame {
  type: 'event';
  event: string;
  payload?: Record<string, unknown>;
  seq?: number;
}

type GatewayFrame = RequestFrame | ResponseFrame | EventFrame;

// ── Provider (for result-handler reply routing) ──────────────

export class OpenClawProvider implements ChannelProvider {
  type = 'openclaw' as const;

  verifyWebhook(): ChannelVerifyResult {
    return { valid: true };
  }

  parseMessage(body: unknown): ChannelInboundMessage | null {
    const msg = body as Record<string, unknown>;
    const content = (msg['content'] as string) || (msg['text'] as string);
    if (!content?.trim()) return null;

    return {
      text: content.trim(),
      externalMessageId: msg['id'] as string,
      externalChannelId: msg['channel_id'] as string || msg['sessionKey'] as string,
      externalUserId: msg['author_id'] as string || msg['senderId'] as string,
      metadata: {
        source: 'openclaw',
        platform: msg['platform'] as string,
        sessionKey: msg['sessionKey'] as string,
      },
    };
  }

  async sendReply(config: ChannelConfig, message: ChannelOutboundMessage): Promise<void> {
    const client = OpenClawGatewayClient.getInstance();
    if (!client?.isConnected()) {
      log('Cannot send reply: gateway not connected');
      return;
    }
    const sessionKey = config.metadata?.['reply_session_key'] as string;
    if (sessionKey) {
      await client.sendMessage(sessionKey, message.text);
    }
  }
}

// ── WebSocket Gateway Client (Protocol v3) ────────────────────

export class OpenClawGatewayClient {
  private static instance: OpenClawGatewayClient | null = null;

  private ws: WebSocket | null = null;
  private url: string;
  private token: string;
  private connected = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private requestId = 0;
  private pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
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
    return this.connected;
  }

  connect(): void {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
    }

    log(`Connecting to Gateway: ${this.url}`);

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      log(`Connection error: ${err}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      log('WebSocket connected, waiting for challenge...');
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event: { data: string }) => {
      try {
        const frame: GatewayFrame = JSON.parse(String(event.data));
        this.handleFrame(frame);
      } catch (err) {
        log(`Failed to parse frame: ${err}`);
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
    this.pendingRequests.clear();
    OpenClawGatewayClient.instance = null;
    log('Disconnected');
  }

  async sendMessage(sessionKey: string, content: string): Promise<void> {
    await this.request('send', { sessionKey, text: content });
  }

  // ── Protocol Handling ──────────────────────────────

  private handleFrame(frame: GatewayFrame): void {
    switch (frame.type) {
      case 'event':
        this.handleEvent(frame as EventFrame);
        break;
      case 'res':
        this.handleResponse(frame as ResponseFrame);
        break;
      default:
        break;
    }
  }

  private handleEvent(frame: EventFrame): void {
    switch (frame.event) {
      case 'connect.challenge': {
        // Server sends challenge — respond with connect request
        log('Received challenge, sending connect...');
        this.sendConnect();
        break;
      }

      case 'agent': {
        // Agent execution event — check if it's a message we should bridge
        const payload = frame.payload || {};
        const text = payload['text'] as string;
        if (text && this.onMessage) {
          const parsed: ChannelInboundMessage = {
            text: text.trim(),
            externalMessageId: payload['id'] as string || `oc-${Date.now()}`,
            externalChannelId: payload['sessionKey'] as string || 'openclaw',
            externalUserId: payload['senderId'] as string || 'openclaw-user',
            metadata: {
              source: 'openclaw',
              platform: payload['channel'] as string || payload['platform'] as string || 'openclaw',
              sessionKey: payload['sessionKey'] as string,
              raw: payload,
            },
          };
          const platform = (payload['channel'] as string) || 'openclaw';
          log(`Message from ${platform}: "${text.slice(0, 80)}"`);
          this.onMessage(parsed, platform);
        }
        break;
      }

      case 'tick':
        // Heartbeat — server is alive
        break;

      case 'presence':
        log(`Presence update: ${JSON.stringify(frame.payload || {}).slice(0, 100)}`);
        break;

      case 'shutdown':
        log('Gateway shutting down');
        this.connected = false;
        break;

      default:
        // Log unknown events for debugging
        if (frame.event !== 'health') {
          log(`Event: ${frame.event}`);
        }
    }
  }

  private handleResponse(frame: ResponseFrame): void {
    const pending = this.pendingRequests.get(frame.id);
    if (pending) {
      this.pendingRequests.delete(frame.id);
      if (frame.ok) {
        pending.resolve(frame.payload || {});
      } else {
        pending.reject(new Error(frame.error?.message || 'Request failed'));
      }
      return;
    }

    // Connect response (hello)
    if (frame.ok && frame.id === 'connect-init') {
      this.connected = true;
      const server = (frame.payload as Record<string, unknown>)?.['server'] as Record<string, unknown>;
      log(`Connected to OpenClaw ${server?.['version'] || 'unknown'} (protocol v3)`);
      this.startHeartbeat();
    } else if (!frame.ok && frame.id === 'connect-init') {
      log(`Connect failed: ${frame.error?.message || 'unknown'}`);
    }
  }

  private sendConnect(): void {
    const connectFrame: RequestFrame = {
      type: 'req',
      id: 'connect-init',
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: { name: 'askalf-bridge', version: '1.1.0', platform: 'docker' },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        auth: { token: this.token },
      },
    };
    this.send(connectFrame);
  }

  private async request(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const id = `req-${++this.requestId}`;
    const frame: RequestFrame = { type: 'req', id, method, params };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.send(frame);

      // Timeout after 30s
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 30_000);
    });
  }

  private send(frame: RequestFrame): void {
    if (this.ws?.readyState === 1) { // WebSocket.OPEN = 1
      this.ws.send(JSON.stringify(frame));
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // OpenClaw sends tick events every 5s — we just need to detect disconnects
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState !== 1) {
        this.connected = false;
        this.stopHeartbeat();
        this.scheduleReconnect();
      }
    }, 15_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      log(`Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60_000);
    this.reconnectAttempts++;
    log(`Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
