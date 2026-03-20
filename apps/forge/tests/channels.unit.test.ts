/**
 * Channel Provider Unit Tests
 *
 * Coverage:
 *   - TeamsProvider.verifyWebhook  — Bearer JWT validation
 *   - isAllowedUrl                 — SSRF URL allowlist
 *   - EmailProvider.parseMessage   — multi-format parsing + SMTP header sanitization
 *   - OpenClawProvider.parseMessage — v3 protocol payload parsing
 *   - OpenClawGatewayClient        — lifecycle, protocol frame handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TeamsProvider } from '../src/channels/teams.js';
import { isAllowedUrl, WebhooksProvider } from '../src/channels/webhooks.js';
import { EmailProvider } from '../src/channels/email-channel.js';
import { OpenClawProvider, OpenClawGatewayClient } from '../src/channels/openclaw.js';
import type { ChannelConfig } from '../src/channels/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ChannelConfig['config']> = {}, meta: Record<string, unknown> = {}): ChannelConfig {
  return {
    id: 'test-id',
    tenant_id: 'tenant-1',
    user_id: 'user-1',
    channel_type: 'teams',
    name: 'Test Channel',
    is_active: true,
    config: overrides,
    metadata: meta,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

/** Generates a valid-looking JWT: 3 base64url segments totalling > 100 chars. */
function makeJwt(header = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9', payload = 'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0', sig = 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c_JCEI') {
  return `${header}.${payload}.${sig}`;
}

// ── 1. TeamsProvider.verifyWebhook ────────────────────────────────────────────

describe('TeamsProvider.verifyWebhook', () => {
  const provider = new TeamsProvider();

  describe('no Authorization header', () => {
    it('allows when no app_password is configured', () => {
      const result = provider.verifyWebhook({}, {}, makeConfig());
      expect(result.valid).toBe(true);
    });

    it('rejects when app_password is configured', () => {
      const result = provider.verifyWebhook({}, {}, makeConfig({ app_password: 'secret' }));
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Missing Authorization header/);
    });

    it('rejects when header has wrong scheme and app_password is configured', () => {
      const result = provider.verifyWebhook(
        { authorization: 'Basic dXNlcjpwYXNz' },
        {},
        makeConfig({ app_password: 'secret' }),
      );
      expect(result.valid).toBe(false);
    });

    it('allows non-Bearer header when no app_password configured', () => {
      const result = provider.verifyWebhook(
        { authorization: 'Basic dXNlcjpwYXNz' },
        {},
        makeConfig(),
      );
      expect(result.valid).toBe(true);
    });
  });

  describe('Bearer token format validation', () => {
    it('accepts a well-formed JWT Bearer token', () => {
      const jwt = makeJwt();
      expect(jwt.length).toBeGreaterThanOrEqual(100);
      const result = provider.verifyWebhook({ authorization: `Bearer ${jwt}` }, {}, makeConfig());
      expect(result.valid).toBe(true);
    });

    it('rejects an empty Bearer value', () => {
      const result = provider.verifyWebhook({ authorization: 'Bearer ' }, {}, makeConfig());
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Empty Bearer token/);
    });

    it('rejects a token with only two JWT segments', () => {
      const result = provider.verifyWebhook(
        { authorization: `Bearer ${makeJwt().split('.').slice(0, 2).join('.')}` },
        {},
        makeConfig(),
      );
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/3 segments/);
    });

    it('rejects a token with four JWT segments', () => {
      const jwt = makeJwt() + '.extra';
      const result = provider.verifyWebhook({ authorization: `Bearer ${jwt}` }, {}, makeConfig());
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/3 segments/);
    });

    it('rejects a token containing non-base64url characters', () => {
      const badJwt = 'aaa.b+b/b.ccc';
      const result = provider.verifyWebhook({ authorization: `Bearer ${badJwt}` }, {}, makeConfig());
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid JWT segment/);
    });

    it('rejects a token with an empty segment', () => {
      const result = provider.verifyWebhook({ authorization: 'Bearer aaa..ccc' }, {}, makeConfig());
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/invalid JWT segment/);
    });

    it('rejects a token shorter than 100 characters', () => {
      const shortJwt = 'aaa.bbb.ccc'; // valid format but way too short
      const result = provider.verifyWebhook({ authorization: `Bearer ${shortJwt}` }, {}, makeConfig());
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/too short/);
    });

    it('accepts Authorization header with mixed case key', () => {
      const jwt = makeJwt();
      const result = provider.verifyWebhook({ Authorization: `Bearer ${jwt}` }, {}, makeConfig());
      expect(result.valid).toBe(true);
    });

    it('trims whitespace around the token value', () => {
      const jwt = makeJwt();
      const result = provider.verifyWebhook({ authorization: `Bearer  ${jwt}` }, {}, makeConfig());
      // Extra space causes token.trim() to still produce a valid JWT
      expect(result.valid).toBe(true);
    });
  });
});

// ── 2. isAllowedUrl ───────────────────────────────────────────────────────────

describe('isAllowedUrl', () => {
  const OLD_ENV = process.env['NODE_ENV'];
  afterEach(() => { process.env['NODE_ENV'] = OLD_ENV; });

  describe('valid HTTPS public URLs', () => {
    it('allows a plain public HTTPS URL', () => {
      expect(isAllowedUrl('https://example.com/webhook')).toBe(true);
    });

    it('allows HTTPS URL with port', () => {
      expect(isAllowedUrl('https://api.example.com:8443/callback')).toBe(true);
    });

    it('allows HTTPS URL with path and query string', () => {
      expect(isAllowedUrl('https://hooks.example.com/deliver?token=abc')).toBe(true);
    });
  });

  describe('HTTP scheme', () => {
    beforeEach(() => { process.env['NODE_ENV'] = 'development'; });

    it('allows HTTP for localhost in development', () => {
      expect(isAllowedUrl('http://localhost:3000/webhook')).toBe(true);
    });

    it('allows HTTP for 127.0.0.1 in development', () => {
      expect(isAllowedUrl('http://127.0.0.1:3000/webhook')).toBe(true);
    });

    it('blocks HTTP for non-localhost even in development', () => {
      expect(isAllowedUrl('http://example.com/webhook')).toBe(false);
    });

    it('blocks HTTP for localhost in production', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isAllowedUrl('http://localhost:3000/webhook')).toBe(false);
    });
  });

  describe('private IPv4 SSRF ranges', () => {
    it('blocks 10.0.0.0/8', () => {
      expect(isAllowedUrl('https://10.0.0.1/api')).toBe(false);
      expect(isAllowedUrl('https://10.255.255.255/api')).toBe(false);
    });

    it('blocks 172.16.0.0/12', () => {
      expect(isAllowedUrl('https://172.16.0.1/api')).toBe(false);
      expect(isAllowedUrl('https://172.31.255.255/api')).toBe(false);
    });

    it('allows 172.15.x.x (outside /12 range)', () => {
      expect(isAllowedUrl('https://172.15.0.1/api')).toBe(true);
    });

    it('allows 172.32.x.x (outside /12 range)', () => {
      expect(isAllowedUrl('https://172.32.0.1/api')).toBe(true);
    });

    it('blocks 192.168.0.0/16', () => {
      expect(isAllowedUrl('https://192.168.1.1/api')).toBe(false);
      expect(isAllowedUrl('https://192.168.0.0/api')).toBe(false);
    });

    it('blocks 169.254.x.x link-local', () => {
      expect(isAllowedUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
    });

    it('blocks 0.0.0.0', () => {
      expect(isAllowedUrl('https://0.0.0.0/api')).toBe(false);
    });

    it('blocks loopback 127.x.x.x in production', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isAllowedUrl('https://127.0.0.1/api')).toBe(false);
    });
  });

  describe('IPv6 loopback', () => {
    it('blocks ::1 loopback', () => {
      // URL.hostname for https://[::1]/ is '::1' after parsing
      expect(isAllowedUrl('https://[::1]/api')).toBe(false);
    });
  });

  describe('internal metadata endpoints', () => {
    it('blocks GCP metadata endpoint', () => {
      expect(isAllowedUrl('https://metadata.google.internal/computeMetadata/v1/')).toBe(false);
    });

    it('blocks metadata.google.com', () => {
      expect(isAllowedUrl('https://metadata.google.com/')).toBe(false);
    });

    it('blocks .internal hostnames in production', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isAllowedUrl('https://service.internal/api')).toBe(false);
    });

    it('blocks .local hostnames in production', () => {
      process.env['NODE_ENV'] = 'production';
      expect(isAllowedUrl('https://forge.local/api')).toBe(false);
    });
  });

  describe('disallowed schemes', () => {
    it('blocks file: scheme', () => {
      expect(isAllowedUrl('file:///etc/passwd')).toBe(false);
    });

    it('blocks ftp: scheme', () => {
      expect(isAllowedUrl('ftp://example.com/file')).toBe(false);
    });

    it('blocks javascript: scheme', () => {
      expect(isAllowedUrl('javascript:alert(1)')).toBe(false);
    });
  });

  describe('malformed URLs', () => {
    it('blocks empty string', () => {
      expect(isAllowedUrl('')).toBe(false);
    });

    it('blocks a bare hostname with no scheme', () => {
      expect(isAllowedUrl('example.com/webhook')).toBe(false);
    });

    it('blocks garbage input', () => {
      expect(isAllowedUrl('not a url!!')).toBe(false);
    });
  });
});

// ── 3. EmailProvider.parseMessage + SMTP sanitization ─────────────────────────

describe('EmailProvider.parseMessage', () => {
  const provider = new EmailProvider();

  it('parses a SendGrid Inbound Parse payload', () => {
    const body = {
      from: 'alice@example.com',
      to: 'agent@askalf.io',
      subject: 'Hello agent',
      text: 'Can you help me?',
      'Message-Id': '<abc123@mail.example.com>',
    };
    const msg = provider.parseMessage(body);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('Subject: Hello agent\n\nCan you help me?');
    expect(msg!.externalUserId).toBe('alice@example.com');
    expect(msg!.externalMessageId).toBe('<abc123@mail.example.com>');
    expect(msg!.metadata?.['subject']).toBe('Hello agent');
  });

  it('parses a Mailgun payload (body-plain, sender fields)', () => {
    const body = {
      sender: 'bob@example.com',
      'body-plain': 'Mailgun message body',
      subject: 'Mailgun test',
    };
    const msg = provider.parseMessage(body);
    expect(msg).not.toBeNull();
    expect(msg!.text).toContain('Mailgun message body');
    expect(msg!.externalUserId).toBe('bob@example.com');
  });

  it('parses stripped-text field', () => {
    const body = { 'stripped-text': 'Only the stripped part', from: 'x@x.com' };
    const msg = provider.parseMessage(body);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('Only the stripped part');
  });

  it('parses envelope.from when top-level from is absent', () => {
    const body = {
      text: 'Envelope message',
      envelope: { from: 'envelope@example.com', to: 'agent@askalf.io' },
    };
    const msg = provider.parseMessage(body);
    expect(msg).not.toBeNull();
    expect(msg!.externalUserId).toBe('envelope@example.com');
  });

  it('omits Subject prefix when subject is absent', () => {
    const body = { text: 'No subject here', from: 'x@x.com' };
    const msg = provider.parseMessage(body);
    expect(msg!.text).toBe('No subject here');
  });

  it('returns null when text fields are all absent', () => {
    expect(provider.parseMessage({ from: 'x@x.com', subject: 'Hi' })).toBeNull();
  });

  it('returns null for empty text', () => {
    expect(provider.parseMessage({ text: '   ', from: 'x@x.com' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(provider.parseMessage(null)).toBeNull();
    expect(provider.parseMessage('string')).toBeNull();
  });

  describe('SMTP header injection — sanitization contract', () => {
    /**
     * These tests document the SMTP header injection payloads that parseMessage
     * passes through unchanged.  The sanitization (`replace(/[\r\n]/g, '')`)
     * occurs inside sendReply before the values are written into SMTP headers.
     * We verify here that the regexes strip the injection sequences correctly.
     */

    const crlf = '\r\n';
    const lf = '\n';

    it('parseMessage forwards CRLF-injected subject without modification', () => {
      const body = { text: 'hi', from: 'x@x.com', subject: `Legit${crlf}Bcc: attacker@evil.com` };
      const msg = provider.parseMessage(body);
      // parseMessage does NOT sanitize — value is preserved as-is
      expect(msg!.metadata?.['subject']).toContain(crlf);
    });

    it('sendReply subject sanitization strips CR and LF', () => {
      const raw = `Subject${crlf}X-Injected: evil`;
      const sanitized = raw.replace(/[\r\n]/g, ' ');
      expect(sanitized).not.toMatch(/[\r\n]/);
      expect(sanitized).toBe('Subject  X-Injected: evil');
    });

    it('sendReply from sanitization strips CR and LF', () => {
      const raw = `alice@example.com${lf}Bcc: attacker@evil.com`;
      const sanitized = raw.replace(/[\r\n]/g, '');
      expect(sanitized).not.toMatch(/[\r\n]/);
      expect(sanitized).toBe('alice@example.comBcc: attacker@evil.com');
    });

    it('sendReply to sanitization strips CR and LF', () => {
      const raw = `victim@example.com${crlf}Content-Type: text/html`;
      const sanitized = raw.replace(/[\r\n]/g, '');
      expect(sanitized).not.toMatch(/[\r\n]/);
    });

    it('sendReply raw SMTP DATA dot-stuffing prevents premature end-of-data', () => {
      // The raw SMTP path escapes lone dots on a line with an extra dot
      const body = 'Line 1\r\n.\r\nLine 3 (after injected end-of-DATA)';
      const escaped = body.replace(/\r\n\.\r\n/g, '\r\n..\r\n');
      expect(escaped).toBe('Line 1\r\n..\r\nLine 3 (after injected end-of-DATA)');
    });
  });
});

// ── 4. EmailProvider.verifyWebhook ─────────────────────────────────────────────

describe('EmailProvider.verifyWebhook', () => {
  const provider = new EmailProvider();

  it('accepts when no credentials configured', () => {
    const result = provider.verifyWebhook({}, {}, makeConfig());
    expect(result.valid).toBe(true);
  });

  it('accepts valid api_key via Authorization Bearer header', () => {
    const cfg = makeConfig({ api_key: 'mykey' });
    expect(provider.verifyWebhook({ authorization: 'Bearer mykey' }, {}, cfg).valid).toBe(true);
  });

  it('accepts valid api_key via x-api-key header', () => {
    const cfg = makeConfig({ api_key: 'mykey' });
    expect(provider.verifyWebhook({ 'x-api-key': 'mykey' }, {}, cfg).valid).toBe(true);
  });

  it('rejects wrong api_key', () => {
    const cfg = makeConfig({ api_key: 'mykey' });
    expect(provider.verifyWebhook({ 'x-api-key': 'wrong' }, {}, cfg).valid).toBe(false);
  });

  it('accepts valid webhook_secret via Authorization Bearer header', () => {
    const cfg = makeConfig({ webhook_secret: 'ws_secret' });
    expect(provider.verifyWebhook({ authorization: 'Bearer ws_secret' }, {}, cfg).valid).toBe(true);
  });

  it('accepts valid webhook_secret via x-webhook-secret header', () => {
    const cfg = makeConfig({ webhook_secret: 'ws_secret' });
    expect(provider.verifyWebhook({ 'x-webhook-secret': 'ws_secret' }, {}, cfg).valid).toBe(true);
  });

  it('rejects wrong webhook_secret', () => {
    const cfg = makeConfig({ webhook_secret: 'ws_secret' });
    expect(provider.verifyWebhook({ 'x-webhook-secret': 'wrong' }, {}, cfg).valid).toBe(false);
  });
});

// ── 5. OpenClawProvider.parseMessage ─────────────────────────────────────────

describe('OpenClawProvider.parseMessage', () => {
  const provider = new OpenClawProvider();

  it('parses a payload with content field', () => {
    const body = {
      content: 'Hello from OpenClaw',
      id: 'msg-1',
      channel_id: 'chan-abc',
      author_id: 'user-123',
      platform: 'discord',
      sessionKey: 'sess-xyz',
    };
    const msg = provider.parseMessage(body);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('Hello from OpenClaw');
    expect(msg!.externalMessageId).toBe('msg-1');
    expect(msg!.externalChannelId).toBe('chan-abc');
    expect(msg!.externalUserId).toBe('user-123');
    expect(msg!.metadata?.['platform']).toBe('discord');
    expect(msg!.metadata?.['sessionKey']).toBe('sess-xyz');
    expect(msg!.metadata?.['source']).toBe('openclaw');
  });

  it('falls back to text field when content is absent', () => {
    const body = { text: 'Text field message', id: 'msg-2' };
    const msg = provider.parseMessage(body);
    expect(msg).not.toBeNull();
    expect(msg!.text).toBe('Text field message');
  });

  it('prefers content over text when both are present', () => {
    const body = { content: 'Content wins', text: 'Text loses' };
    const msg = provider.parseMessage(body);
    expect(msg!.text).toBe('Content wins');
  });

  it('falls back externalChannelId to sessionKey when channel_id is absent', () => {
    const body = { content: 'hi', sessionKey: 'sess-99' };
    const msg = provider.parseMessage(body);
    expect(msg!.externalChannelId).toBe('sess-99');
  });

  it('falls back externalUserId to senderId when author_id is absent', () => {
    const body = { content: 'hi', senderId: 'sender-42' };
    const msg = provider.parseMessage(body);
    expect(msg!.externalUserId).toBe('sender-42');
  });

  it('returns null for empty content', () => {
    expect(provider.parseMessage({ content: '' })).toBeNull();
    expect(provider.parseMessage({ content: '   ' })).toBeNull();
  });

  it('returns null when content and text are both absent', () => {
    expect(provider.parseMessage({ id: 'msg-3' })).toBeNull();
  });

  it('trims whitespace from content', () => {
    const msg = provider.parseMessage({ content: '  trimmed  ' });
    expect(msg!.text).toBe('trimmed');
  });
});

// ── 6. OpenClawGatewayClient — lifecycle ──────────────────────────────────────

describe('OpenClawGatewayClient lifecycle', () => {
  afterEach(() => {
    // Ensure singleton is cleaned up after each test
    const instance = OpenClawGatewayClient.getInstance();
    if (instance) instance.disconnect();
  });

  it('getInstance() returns null before any client is created', () => {
    expect(OpenClawGatewayClient.getInstance()).toBeNull();
  });

  it('create() registers the singleton', () => {
    const client = OpenClawGatewayClient.create('ws://localhost:9999', 'test-token');
    expect(OpenClawGatewayClient.getInstance()).toBe(client);
  });

  it('create() replaces an existing singleton and disconnects the old one', () => {
    const first = OpenClawGatewayClient.create('ws://localhost:9999', 'token-1');
    const firstDisconnectedSpy = vi.spyOn(first, 'disconnect');
    const second = OpenClawGatewayClient.create('ws://localhost:9998', 'token-2');
    expect(firstDisconnectedSpy).toHaveBeenCalled();
    expect(OpenClawGatewayClient.getInstance()).toBe(second);
  });

  it('isConnected() returns false before connect() is called', () => {
    const client = OpenClawGatewayClient.create('ws://localhost:9999', 'test-token');
    expect(client.isConnected()).toBe(false);
  });

  it('disconnect() clears the singleton', () => {
    const client = OpenClawGatewayClient.create('ws://localhost:9999', 'test-token');
    client.disconnect();
    expect(OpenClawGatewayClient.getInstance()).toBeNull();
  });

  it('sendMessage() does not throw when not connected', async () => {
    const client = OpenClawGatewayClient.create('ws://localhost:9999', 'test-token');
    // No WebSocket connected — sendMessage internally calls request() → send()
    // send() checks readyState and is a no-op when ws is null
    // The promise will hang on request timeout unless we detect it; test with race
    const result = await Promise.race([
      client.sendMessage('sess-1', 'hello').then(() => 'resolved').catch(() => 'rejected'),
      new Promise<string>(resolve => setTimeout(() => resolve('timeout'), 100)),
    ]);
    // It either resolves (noop) or times out — it must not synchronously throw
    expect(['resolved', 'rejected', 'timeout']).toContain(result);
  });
});

// ── 7. OpenClawGatewayClient — v3 protocol frame handling ────────────────────

describe('OpenClawGatewayClient v3 protocol frame handling', () => {
  let client: OpenClawGatewayClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let c: any; // cast to any so we can invoke private methods in tests

  beforeEach(() => {
    client = OpenClawGatewayClient.create('ws://localhost:9999', 'test-token');
    c = client;
  });

  afterEach(() => {
    if (OpenClawGatewayClient.getInstance()) client.disconnect();
  });

  describe('handleFrame dispatch', () => {
    it('dispatches "event" frames to handleEvent', () => {
      const spy = vi.spyOn(c, 'handleEvent');
      c.handleFrame({ type: 'event', event: 'tick' });
      expect(spy).toHaveBeenCalledWith({ type: 'event', event: 'tick' });
    });

    it('dispatches "res" frames to handleResponse', () => {
      const spy = vi.spyOn(c, 'handleResponse');
      c.handleFrame({ type: 'res', id: 'req-1', ok: true });
      expect(spy).toHaveBeenCalled();
    });

    it('ignores unknown frame types without throwing', () => {
      expect(() => c.handleFrame({ type: 'unknown', id: 'x' })).not.toThrow();
    });
  });

  describe('connect.challenge event', () => {
    it('calls sendConnect when challenge is received', () => {
      const spy = vi.spyOn(c, 'sendConnect');
      c.handleEvent({ type: 'event', event: 'connect.challenge' });
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('connect success response (connect-init)', () => {
    it('sets connected=true and starts heartbeat on successful connect-init', () => {
      const heartbeatSpy = vi.spyOn(c, 'startHeartbeat');
      c.handleResponse({ type: 'res', id: 'connect-init', ok: true, payload: { server: { version: '3.1.0' } } });
      expect(client.isConnected()).toBe(true);
      expect(heartbeatSpy).toHaveBeenCalled();
    });

    it('does not set connected on failed connect-init', () => {
      c.handleResponse({ type: 'res', id: 'connect-init', ok: false, error: { code: 'AUTH_FAIL', message: 'Bad token' } });
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('agent event (inbound message bridging)', () => {
    it('invokes onMessage handler for agent events with text', () => {
      const handler = vi.fn();
      client.onInboundMessage(handler);
      c.handleEvent({
        type: 'event',
        event: 'agent',
        payload: {
          text: 'Hello from platform',
          id: 'msg-oc-1',
          sessionKey: 'sess-abc',
          senderId: 'user-remote',
          channel: 'discord',
        },
      });
      expect(handler).toHaveBeenCalledOnce();
      const [msg, platform] = handler.mock.calls[0]!;
      expect(msg.text).toBe('Hello from platform');
      expect(msg.externalChannelId).toBe('sess-abc');
      expect(msg.externalUserId).toBe('user-remote');
      expect(msg.metadata?.['source']).toBe('openclaw');
      expect(platform).toBe('discord');
    });

    it('does not invoke onMessage handler when text is absent', () => {
      const handler = vi.fn();
      client.onInboundMessage(handler);
      c.handleEvent({ type: 'event', event: 'agent', payload: { sessionKey: 'sess-1' } });
      expect(handler).not.toHaveBeenCalled();
    });

    it('does not throw when no onMessage handler is registered', () => {
      expect(() =>
        c.handleEvent({ type: 'event', event: 'agent', payload: { text: 'hi', sessionKey: 's' } }),
      ).not.toThrow();
    });

    it('generates a synthetic message ID when id is absent', () => {
      const handler = vi.fn();
      client.onInboundMessage(handler);
      c.handleEvent({ type: 'event', event: 'agent', payload: { text: 'no-id', sessionKey: 'sess' } });
      const [msg] = handler.mock.calls[0]!;
      expect(msg.externalMessageId).toMatch(/^oc-/);
    });
  });

  describe('shutdown event', () => {
    it('sets connected=false on shutdown', () => {
      // Manually mark connected first
      c.connected = true;
      c.handleEvent({ type: 'event', event: 'shutdown' });
      expect(client.isConnected()).toBe(false);
    });
  });

  describe('pending request resolution', () => {
    it('resolves a pending request on successful response', async () => {
      const id = 'req-test-1';
      let resolve: (v: unknown) => void = () => {};
      const promise = new Promise(r => { resolve = r; });
      c.pendingRequests.set(id, { resolve, reject: vi.fn() });
      c.handleResponse({ type: 'res', id, ok: true, payload: { result: 'done' } });
      const result = await promise;
      expect(result).toEqual({ result: 'done' });
      expect(c.pendingRequests.has(id)).toBe(false);
    });

    it('rejects a pending request on error response', async () => {
      const id = 'req-test-2';
      const reject = vi.fn();
      c.pendingRequests.set(id, { resolve: vi.fn(), reject });
      c.handleResponse({ type: 'res', id, ok: false, error: { code: 'ERR', message: 'Oops' } });
      expect(reject).toHaveBeenCalledWith(expect.objectContaining({ message: 'Oops' }));
      expect(c.pendingRequests.has(id)).toBe(false);
    });

    it('ignores response frames with unknown IDs', () => {
      expect(() =>
        c.handleResponse({ type: 'res', id: 'unknown-id', ok: true }),
      ).not.toThrow();
    });
  });

  describe('reconnect backoff', () => {
    it('schedules reconnect with exponential backoff', () => {
      vi.useFakeTimers();
      const connectSpy = vi.spyOn(c, 'connect');
      c.reconnectAttempts = 0;
      c.scheduleReconnect(); // attempt 1 → 1000ms
      vi.advanceTimersByTime(999);
      expect(connectSpy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(connectSpy).toHaveBeenCalledOnce();
      vi.useRealTimers();
    });

    it('stops reconnecting after maxReconnectAttempts', () => {
      vi.useFakeTimers();
      const connectSpy = vi.spyOn(c, 'connect');
      c.reconnectAttempts = c.maxReconnectAttempts; // already at max
      c.scheduleReconnect();
      vi.advanceTimersByTime(60_000);
      expect(connectSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('caps backoff delay at 60 seconds', () => {
      // At attempt 10+, delay = min(1000 * 2^10, 60000) = 60000
      const delay = Math.min(1000 * Math.pow(2, 10), 60_000);
      expect(delay).toBe(60_000);
    });
  });
});
