/**
 * Forge Platform Admin API Integration Tests
 *
 * Tests /api/v1/forge/admin/platform endpoints (orchestration, fleet, scheduling,
 * memory, agents, executions, coordination, reports, analytics).
 *
 * Requires forge running on FORGE_URL (default http://forge:3005).
 * Set FORGE_API_KEY for authenticated tests.
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

// ── Auth guards — platform admin endpoints must reject unauthed requests ──

describe('Auth guards — Platform Admin orchestration', () => {
  const paths = [
    '/api/v1/forge/admin/platform/orchestration/status',
    '/api/v1/forge/admin/platform/orchestration/agents',
    '/api/v1/forge/admin/platform/orchestration/schedules',
    '/api/v1/forge/admin/platform/orchestration/executions?limit=1',
  ];

  for (const path of paths) {
    it(`rejects unauthenticated GET ${path}`, async () => {
      const { status } = await get(path);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    });
  }
});

describe('Auth guards — Platform Admin memory', () => {
  const paths = [
    '/api/v1/forge/admin/platform/memory/stats',
    '/api/v1/forge/admin/platform/memory/search?q=test&limit=1',
  ];

  for (const path of paths) {
    it(`rejects unauthenticated GET ${path}`, async () => {
      const { status } = await get(path);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    });
  }
});

describe('Auth guards — Platform Admin tickets', () => {
  const paths = [
    '/api/v1/forge/admin/platform/tickets?limit=1',
    '/api/v1/forge/admin/platform/tickets/stats',
  ];

  for (const path of paths) {
    it(`rejects unauthenticated GET ${path}`, async () => {
      const { status } = await get(path);
      expect(status).toBeGreaterThanOrEqual(400);
      expect(status).toBeLessThan(500);
    });
  }
});

describe('Auth guards — Platform Admin coordination', () => {
  it('rejects unauthenticated GET /api/v1/forge/admin/platform/coordination/sessions', async () => {
    const { status } = await get('/api/v1/forge/admin/platform/coordination/sessions');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

describe('Auth guards — Platform Admin reports', () => {
  it('rejects unauthenticated GET /api/v1/forge/admin/platform/reports/cost-summary', async () => {
    const { status } = await get('/api/v1/forge/admin/platform/reports/cost-summary');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

describe('Auth guards — Platform Admin analytics', () => {
  it('rejects unauthenticated GET /api/v1/forge/admin/platform/analytics/agent-performance', async () => {
    const { status } = await get('/api/v1/forge/admin/platform/analytics/agent-performance');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

// ── Authenticated tests — only when FORGE_API_KEY is set ──

const describeAuth = API_KEY ? describe : describe.skip;

describeAuth('Orchestration — authenticated', () => {
  it('GET .../orchestration/status returns system status', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/orchestration/status', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('status');
  });

  it('GET .../orchestration/agents returns agent list', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/orchestration/agents', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    const agents = body as Array<Record<string, unknown>>;
    expect(agents.length).toBeGreaterThan(0);
    expect(agents[0]).toHaveProperty('id');
    expect(agents[0]).toHaveProperty('name');
  });

  it('GET .../orchestration/schedules returns schedule list', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/orchestration/schedules', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET .../orchestration/executions returns paginated executions', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/orchestration/executions?limit=5', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    // Could be array or paginated object
    if (Array.isArray(b)) {
      expect(b.length).toBeLessThanOrEqual(5);
    } else {
      expect(b).toHaveProperty('executions');
    }
  });
});

describeAuth('Memory — authenticated', () => {
  it('GET .../memory/stats returns memory statistics', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/memory/stats', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(b).toHaveProperty('semantic');
    expect(b).toHaveProperty('episodic');
  });

  it('GET .../memory/search returns search results', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/memory/search?q=agent&limit=3', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describeAuth('Tickets — authenticated', () => {
  it('GET .../tickets returns ticket list', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/tickets?limit=5', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    if (Array.isArray(b)) {
      expect(b.length).toBeLessThanOrEqual(5);
    } else {
      expect(b).toHaveProperty('tickets');
    }
  });

  it('GET .../tickets/stats returns ticket statistics', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/tickets/stats', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b).toBe('object');
  });
});

describeAuth('Coordination — authenticated', () => {
  it('GET .../coordination/sessions returns session list', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/coordination/sessions', true);
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describeAuth('Reports — authenticated', () => {
  it('GET .../reports/cost-summary returns cost data', async () => {
    const { status, body } = await get('/api/v1/forge/admin/platform/reports/cost-summary', true);
    expect(status).toBe(200);
    const b = body as Record<string, unknown>;
    expect(typeof b).toBe('object');
  });
});
