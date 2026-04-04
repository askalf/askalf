/**
 * Forge Admin API Integration Tests — Knowledge Graph, Goals, Events, Metabolic
 *
 * Tests the platform-admin endpoints added in Phases 9, 11, 14, and metabolic.
 * Requires forge to be running on FORGE_URL (default http://forge:3005).
 * Set FORGE_API_KEY for authenticated tests (otherwise only auth-guard tests run).
 */

import { describe, it, expect } from 'vitest';

const FORGE_URL = process.env.FORGE_URL ?? 'http://forge:3005';
const API_KEY = process.env.FORGE_API_KEY ?? '';

async function get(path: string, auth = false) {
  const headers: Record<string, string> = {};
  if (auth && API_KEY) headers['Authorization'] = `Bearer ${API_KEY}`;
  const res = await fetch(`${FORGE_URL}${path}`, { headers });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

// ── Auth guards — all admin endpoints must reject unauthenticated requests ──

describe('Auth guards — Knowledge Graph endpoints', () => {
  it('rejects unauthenticated GET /api/v1/admin/knowledge/stats', async () => {
    const { status } = await get('/api/v1/admin/knowledge/stats');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/knowledge/search', async () => {
    const { status } = await get('/api/v1/admin/knowledge/search?q=test');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/knowledge/graph', async () => {
    const { status } = await get('/api/v1/admin/knowledge/graph');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/knowledge/entity-types', async () => {
    const { status } = await get('/api/v1/admin/knowledge/entity-types');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/knowledge/agents', async () => {
    const { status } = await get('/api/v1/admin/knowledge/agents');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/knowledge/top-connected', async () => {
    const { status } = await get('/api/v1/admin/knowledge/top-connected');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/knowledge/nodes/:id', async () => {
    const { status } = await get('/api/v1/admin/knowledge/nodes/fake-id');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/knowledge/nodes/:id/neighborhood', async () => {
    const { status } = await get('/api/v1/admin/knowledge/nodes/fake-id/neighborhood');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

describe('Auth guards — Goals endpoints', () => {
  it('rejects unauthenticated GET /api/v1/admin/goals', async () => {
    const { status } = await get('/api/v1/admin/goals');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/goals/:id', async () => {
    const { status } = await get('/api/v1/admin/goals/fake-id');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/agents/:id/goals', async () => {
    const { status } = await get('/api/v1/admin/agents/fake-id/goals');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

describe('Auth guards — Events endpoints', () => {
  it('rejects unauthenticated GET /api/v1/admin/events/recent', async () => {
    const { status } = await get('/api/v1/admin/events/recent');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/events/stats', async () => {
    const { status } = await get('/api/v1/admin/events/stats');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/events/execution/:id', async () => {
    const { status } = await get('/api/v1/admin/events/execution/fake-id');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/events/session/:id', async () => {
    const { status } = await get('/api/v1/admin/events/session/fake-id');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated GET /api/v1/admin/fleet/leaderboard', async () => {
    const { status } = await get('/api/v1/admin/fleet/leaderboard');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

describe('Auth guards — Metabolic endpoints', () => {
  it('rejects unauthenticated GET /api/v1/admin/metabolic/status', async () => {
    const { status } = await get('/api/v1/admin/metabolic/status');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

// ── Authenticated tests — only run when FORGE_API_KEY is set ──

const describeAuth = API_KEY ? describe : describe.skip;

describeAuth('Knowledge Graph — authenticated', () => {
  it('GET /api/v1/admin/knowledge/stats returns graph statistics', async () => {
    const { status, body } = await get('/api/v1/admin/knowledge/stats', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('nodeCount');
    expect(b).toHaveProperty('edgeCount');
  });

  it('GET /api/v1/admin/knowledge/search returns results for query', async () => {
    const { status, body } = await get('/api/v1/admin/knowledge/search?q=agent', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/v1/admin/knowledge/graph returns nodes and edges', async () => {
    const { status, body } = await get('/api/v1/admin/knowledge/graph?limit=5', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('nodes');
    expect(b).toHaveProperty('edges');
  });

  it('GET /api/v1/admin/knowledge/entity-types returns distribution', async () => {
    const { status, body } = await get('/api/v1/admin/knowledge/entity-types', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/v1/admin/knowledge/agents returns agent contributions', async () => {
    const { status, body } = await get('/api/v1/admin/knowledge/agents', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/v1/admin/knowledge/top-connected returns hub nodes', async () => {
    const { status, body } = await get('/api/v1/admin/knowledge/top-connected?limit=3', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/v1/admin/knowledge/nodes/:id returns 404 for non-existent node', async () => {
    const { status } = await get('/api/v1/admin/knowledge/nodes/NONEXISTENT', true);
    expect(status).toBe(404);
  });
});

describeAuth('Goals — authenticated', () => {
  it('GET /api/v1/admin/goals returns goals list', async () => {
    const { status, body } = await get('/api/v1/admin/goals', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(Array.isArray(b.goals)).toBe(true);
    expect(b).toHaveProperty('total');
  });

  it('GET /api/v1/admin/goals supports status filter', async () => {
    const { status } = await get('/api/v1/admin/goals?status=proposed', true);
    expect(status).toBe(200);
  });

  it('GET /api/v1/admin/goals/:id returns 404 for non-existent goal', async () => {
    const { status } = await get('/api/v1/admin/goals/NONEXISTENT', true);
    expect([404, 400]).toContain(status);
  });
});

describeAuth('Events — authenticated', () => {
  it('GET /api/v1/admin/events/recent returns event array', async () => {
    const { status, body } = await get('/api/v1/admin/events/recent?limit=5', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /api/v1/admin/events/stats returns statistics', async () => {
    const { status, body } = await get('/api/v1/admin/events/stats', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('totalEvents');
  });

  it('GET /api/v1/admin/events/execution/:id returns array for valid execution', async () => {
    const { status, body } = await get('/api/v1/admin/events/execution/NONEXISTENT', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });

  it('GET /api/v1/admin/fleet/leaderboard returns leaderboard data', async () => {
    const { status, body } = await get('/api/v1/admin/fleet/leaderboard', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describeAuth('Metabolic — authenticated', () => {
  it('GET /api/v1/admin/metabolic/status returns uptime and memory', async () => {
    const { status, body } = await get('/api/v1/admin/metabolic/status', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('startedAt');
    expect(b).toHaveProperty('uptimeSeconds');
    expect(b).toHaveProperty('cycles');
    expect(b).toHaveProperty('memory');
    expect(typeof b.uptimeSeconds).toBe('number');
  });
});
