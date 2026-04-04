/**
 * MCP-Tools Integration Tests
 *
 * Tests the MCP tools server HTTP endpoints and MCP protocol.
 * Requires mcp-tools to be running on MCP_URL (default http://mcp-tools:3010).
 */

import { describe, it, expect } from 'vitest';

const MCP_URL = process.env.MCP_URL ?? 'http://mcp-tools:3010';

async function get(path: string) {
  const res = await fetch(`${MCP_URL}${path}`);
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function mcpPost(payload: unknown) {
  const res = await fetch(`${MCP_URL}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.text(), headers: res.headers };
}

// ── Health endpoint ───────────────────────────────────────

describe('MCP-Tools Health', () => {
  it('GET /health returns healthy status with tool count', async () => {
    const { status, body } = await get('/health');
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('status', 'healthy');
    expect(b).toHaveProperty('service', 'mcp-tools');
    expect(b).toHaveProperty('tools');
    expect(typeof b.tools).toBe('number');
    expect(b.tools).toBeGreaterThanOrEqual(15);
  });
});

// ── Metrics endpoint ──────────────────────────────────────

describe('MCP-Tools Metrics', () => {
  it('GET /metrics returns Prometheus text', async () => {
    const res = await fetch(`${MCP_URL}/metrics`);
    expect(res.status).toBe(200);
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toContain('text/plain');
    const text = await res.text();
    expect(text.length).toBeGreaterThan(0);
  });
});

// ── MCP Protocol ──────────────────────────────────────────

describe('MCP Streamable HTTP transport', () => {
  it('POST /mcp with initialize request returns server capabilities', async () => {
    const { status, body } = await mcpPost({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' },
      },
      id: 1,
    });
    expect(status).toBe(200);
    // Response may be JSON or SSE — parse accordingly
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      // SSE format: extract data lines
      const dataLines = body.split('\n').filter((l: string) => l.startsWith('data: '));
      if (dataLines.length > 0) {
        parsed = JSON.parse(dataLines[0].replace('data: ', ''));
      }
    }
    expect(parsed).toBeDefined();
    const p = parsed as Record<string, unknown>;
    expect(p).toHaveProperty('jsonrpc', '2.0');
    expect(p).toHaveProperty('id', 1);
    expect(p).toHaveProperty('result');
    const result = p.result as Record<string, unknown>;
    expect(result).toHaveProperty('capabilities');
    expect(result).toHaveProperty('serverInfo');
    const serverInfo = result.serverInfo as Record<string, unknown>;
    expect(serverInfo).toHaveProperty('name', 'mcp-tools');
  });

  it('GET /mcp returns 405 (use POST)', async () => {
    const res = await fetch(`${MCP_URL}/mcp`);
    expect(res.status).toBe(405);
  });

  it('DELETE /mcp returns 405', async () => {
    const res = await fetch(`${MCP_URL}/mcp`, { method: 'DELETE' });
    expect(res.status).toBe(405);
  });
});

// ── SSE endpoint ──────────────────────────────────────────

describe('MCP SSE transport', () => {
  it('GET /sse returns SSE content type', async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${MCP_URL}/sse`, {
        signal: controller.signal,
        headers: { 'Accept': 'text/event-stream' },
      });
      expect(res.status).toBe(200);
      const ct = res.headers.get('content-type') ?? '';
      expect(ct).toContain('text/event-stream');
    } catch (e) {
      // AbortError is expected (we cut the SSE stream after 3s)
      if ((e as Error).name !== 'AbortError') throw e;
    } finally {
      clearTimeout(timeout);
    }
  });
});

// ── Message endpoint guards ───────────────────────────────

describe('MCP Message endpoint', () => {
  it('POST /message without sessionId returns 400', async () => {
    const res = await fetch(`${MCP_URL}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('POST /message with invalid sessionId returns 404', async () => {
    const res = await fetch(`${MCP_URL}/message?sessionId=nonexistent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(404);
  });
});
