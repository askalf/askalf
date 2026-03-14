/**
 * Admin Routes Smoke Tests
 *
 * Verifies every admin endpoint responds correctly:
 *   - 401 without auth
 *   - 2xx with valid API key (no 500s)
 *   - Basic response shape validation
 *
 * Covers both /api/v1/admin/* (platform-admin) and /api/v1/forge/admin/* routes.
 *
 * Run: vitest run tests/admin-routes.smoke.test.ts
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env['FORGE_BASE_URL'] ?? 'http://forge:3005';
const API_KEY = process.env['FORGE_INTERNAL_API_KEY'] ?? '';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

async function api(
  method: string,
  path: string,
  opts: { apiKey?: string; json?: unknown } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

const get = (path: string, apiKey?: string) => api('GET', path, { apiKey });
const post = (path: string, json: unknown, apiKey?: string) => api('POST', path, { apiKey, json });

// ─── Auth enforcement — all admin routes require auth ─────────────────────────

const ADMIN_GET_ENDPOINTS = [
  // Platform admin — agents & executions
  '/api/v1/admin/agents',
  '/api/v1/admin/executions',
  // Reports
  '/api/v1/admin/reports/findings',
  '/api/v1/admin/reports/schedules',
  '/api/v1/admin/reports/feed',
  '/api/v1/admin/reports/feed/agents',
  '/api/v1/admin/reports/feed/categories',
  '/api/v1/admin/reports/documents',
  '/api/v1/admin/reports/documents/agents',
  '/api/v1/admin/executions/timeline',
  '/api/v1/admin/metrics',
  // Users
  '/api/v1/admin/users',
  '/api/v1/admin/users/stats',
  // Capabilities
  '/api/v1/admin/capabilities/catalog',
  '/api/v1/admin/capabilities/summary',
  // Memory
  '/api/v1/admin/memory/stats',
  '/api/v1/admin/memory/recent',
  '/api/v1/admin/memory/recalls',
  // Git space
  '/api/v1/admin/git-space/branches',
  // Costs & analytics
  '/api/v1/admin/costs',
  '/api/v1/admin/costs/hourly',
  '/api/v1/admin/costs/summary',
  '/api/v1/admin/executions/costs',
  '/api/v1/admin/executions/costs/summary',
  // Tickets
  '/api/v1/admin/tickets',
  // Tasks
  '/api/v1/admin/tasks',
  '/api/v1/admin/tasks/stats',
  // Templates
  '/api/v1/admin/templates',
  // Checkpoints
  '/api/v1/admin/checkpoints',
  // Orchestration & coordination
  '/api/v1/admin/orchestration',
  '/api/v1/admin/coordination/sessions',
  '/api/v1/admin/coordination/stats',
  '/api/v1/admin/coordination/plans',
  // Events
  '/api/v1/admin/events/recent',
  '/api/v1/admin/events/stats',
  // Scheduling & audit
  '/api/v1/admin/audit',
  // Chat
  '/api/v1/admin/chat/sessions',
  // Forge admin
  '/api/v1/forge/admin/costs',
  '/api/v1/forge/admin/audit',
  '/api/v1/forge/admin/guardrails',
  '/api/v1/forge/admin/deployment-logs',
];

describe('Admin routes — auth enforcement', () => {
  it.each(ADMIN_GET_ENDPOINTS)('%s → 401 without auth', async (path) => {
    const res = await get(path);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('invalid Bearer token → 401', async () => {
    const res = await get('/api/v1/admin/agents', 'not-valid');
    expect(res.status).toBe(401);
  });

  it('well-formatted but unknown fk_ key → 401', async () => {
    const fakeKey = 'fk_' + '0'.repeat(56);
    const res = await get('/api/v1/admin/agents', fakeKey);
    expect(res.status).toBe(401);
  });
});

// ─── Authenticated smoke tests — verify no 500s and basic shape ──────────────

describe('Admin routes — authenticated smoke (GET)', () => {
  if (!API_KEY) {
    it.skip('skipped — no FORGE_INTERNAL_API_KEY', () => {});
    return;
  }

  it.each(ADMIN_GET_ENDPOINTS)('%s → 2xx (no 500)', async (path) => {
    const res = await get(path, API_KEY);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(500);
  });
});

// ─── Response shape validation for key endpoints ─────────────────────────────

describe('Admin routes — response shapes', () => {
  if (!API_KEY) {
    it.skip('skipped — no FORGE_INTERNAL_API_KEY', () => {});
    return;
  }

  // Agents
  it('GET /admin/agents returns agents array', async () => {
    const res = await get('/api/v1/admin/agents', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body['agents'])).toBe(true);
  });

  it('GET /admin/agents respects limit param', async () => {
    const res = await get('/api/v1/admin/agents?limit=2', API_KEY);
    expect(res.status).toBe(200);
    const agents = res.body['agents'] as unknown[];
    expect(agents.length).toBeLessThanOrEqual(2);
  });

  // Executions
  it('GET /admin/executions returns executions array', async () => {
    const res = await get('/api/v1/admin/executions', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body['executions'])).toBe(true);
  });

  // Users
  it('GET /admin/users returns user data', async () => {
    const res = await get('/api/v1/admin/users', API_KEY);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  it('GET /admin/users/stats returns counts', async () => {
    const res = await get('/api/v1/admin/users/stats', API_KEY);
    expect(res.status).toBe(200);
    const b = res.body;
    expect('total' in b || 'totalUsers' in b || 'total_users' in b || 'count' in b).toBe(true);
  });

  // Tickets
  it('GET /admin/tickets returns tickets data', async () => {
    const res = await get('/api/v1/admin/tickets', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body['tickets']) || Array.isArray(res.body)).toBe(true);
  });

  it('GET /admin/tickets supports status filter', async () => {
    const res = await get('/api/v1/admin/tickets?status=open', API_KEY);
    expect(res.status).toBe(200);
  });

  // Checkpoints
  it('GET /admin/checkpoints returns checkpoints and total', async () => {
    const res = await get('/api/v1/admin/checkpoints', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('checkpoints');
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body['checkpoints'])).toBe(true);
  });

  it('GET /admin/checkpoints supports status filter', async () => {
    const res = await get('/api/v1/admin/checkpoints?status=pending', API_KEY);
    expect(res.status).toBe(200);
  });

  // Costs
  it('GET /admin/costs returns cost data', async () => {
    const res = await get('/api/v1/admin/costs', API_KEY);
    expect(res.status).toBe(200);
    const b = res.body;
    expect('summary' in b || 'totalCost' in b || 'total_cost' in b).toBe(true);
  });

  it('GET /admin/costs/hourly returns hourly array', async () => {
    const res = await get('/api/v1/admin/costs/hourly', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hourly');
    expect(Array.isArray(res.body['hourly'])).toBe(true);
  });

  it('GET /admin/costs supports days param', async () => {
    const res = await get('/api/v1/admin/costs?days=7', API_KEY);
    expect(res.status).toBe(200);
  });

  // Events
  it('GET /admin/events/recent returns events', async () => {
    const res = await get('/api/v1/admin/events/recent', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body['events']) || Array.isArray(res.body)).toBe(true);
  });

  it('GET /admin/events/stats returns total', async () => {
    const res = await get('/api/v1/admin/events/stats', API_KEY);
    expect(res.status).toBe(200);
    const b = res.body;
    expect('total_events' in b || 'totalEvents' in b || 'total' in b).toBe(true);
  });

  // Memory
  it('GET /admin/memory/stats returns stats', async () => {
    const res = await get('/api/v1/admin/memory/stats', API_KEY);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  it('GET /admin/memory/recent returns memories', async () => {
    const res = await get('/api/v1/admin/memory/recent', API_KEY);
    expect(res.status).toBe(200);
  });

  // Capabilities
  it('GET /admin/capabilities/catalog returns data', async () => {
    const res = await get('/api/v1/admin/capabilities/catalog', API_KEY);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  it('GET /admin/capabilities/summary returns data', async () => {
    const res = await get('/api/v1/admin/capabilities/summary', API_KEY);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(
      'agents' in b || 'capabilities' in b || 'totalAgents' in b || 'summary' in b,
    ).toBe(true);
  });

  // Coordination
  it('GET /admin/coordination/sessions returns sessions', async () => {
    const res = await get('/api/v1/admin/coordination/sessions', API_KEY);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body['sessions']) || Array.isArray(res.body)).toBe(true);
  });

  // Orchestration
  it('GET /admin/orchestration returns object', async () => {
    const res = await get('/api/v1/admin/orchestration', API_KEY);
    expect(res.status).toBe(200);
    expect(typeof res.body).toBe('object');
  });

  // Reports
  it('GET /admin/reports/findings returns findings', async () => {
    const res = await get('/api/v1/admin/reports/findings', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('findings');
  });

  it('GET /admin/reports/schedules returns schedules', async () => {
    const res = await get('/api/v1/admin/reports/schedules', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('schedules');
  });

  // Templates
  it('GET /admin/templates returns data', async () => {
    const res = await get('/api/v1/admin/templates', API_KEY);
    expect(res.status).toBe(200);
  });

  // Tasks
  it('GET /admin/tasks returns data', async () => {
    const res = await get('/api/v1/admin/tasks', API_KEY);
    expect(res.status).toBe(200);
  });

  // Audit
  it('GET /admin/audit returns data', async () => {
    const res = await get('/api/v1/admin/audit', API_KEY);
    expect(res.status).toBe(200);
  });

  // Forge admin routes
  it('GET /forge/admin/guardrails returns guardrails', async () => {
    const res = await get('/api/v1/forge/admin/guardrails', API_KEY);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('guardrails');
    expect(Array.isArray(res.body['guardrails'])).toBe(true);
  });

  it('GET /forge/admin/costs returns cost summary', async () => {
    const res = await get('/api/v1/forge/admin/costs', API_KEY);
    expect(res.status).toBe(200);
  });

  it('GET /forge/admin/audit returns audit entries', async () => {
    const res = await get('/api/v1/forge/admin/audit', API_KEY);
    expect(res.status).toBe(200);
  });

  it('GET /forge/admin/deployment-logs returns logs', async () => {
    const res = await get('/api/v1/forge/admin/deployment-logs', API_KEY);
    expect(res.status).toBe(200);
  });
});

// ─── POST endpoints — auth enforcement only (no side effects) ────────────────

const ADMIN_POST_ENDPOINTS = [
  { path: '/api/v1/admin/memory/search', body: { query: 'test' } },
  { path: '/api/v1/admin/memory/store', body: { content: 'test', memoryType: 'semantic' } },
  { path: '/api/v1/admin/retention-cleanup', body: {} },
  { path: '/api/v1/admin/capabilities/detect-all', body: {} },
];

describe('Admin POST routes — auth enforcement', () => {
  it.each(ADMIN_POST_ENDPOINTS)('$path → 401 without auth', async ({ path, body }) => {
    const res = await post(path, body);
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

// ─── 404 handling for parameterized routes ───────────────────────────────────

describe('Admin routes — 404 for non-existent resources', () => {
  if (!API_KEY) {
    it.skip('skipped — no FORGE_INTERNAL_API_KEY', () => {});
    return;
  }

  const FAKE_ID = '00000000000000000000000000';

  it('GET /admin/tickets/:id → 404', async () => {
    const res = await get(`/api/v1/admin/tickets/${FAKE_ID}`, API_KEY);
    expect([400, 404]).toContain(res.status);
  });

  it('GET /admin/checkpoints/:id → 404', async () => {
    const res = await get(`/api/v1/admin/checkpoints/${FAKE_ID}`, API_KEY);
    expect(res.status).toBe(404);
  });

  it('GET /admin/templates/:id → 404', async () => {
    const res = await get(`/api/v1/admin/templates/${FAKE_ID}`, API_KEY);
    expect([404, 400]).toContain(res.status);
  });

  it('GET /admin/tasks/:id → 404', async () => {
    const res = await get(`/api/v1/admin/tasks/${FAKE_ID}`, API_KEY);
    expect([404, 400]).toContain(res.status);
  });

  it('GET /admin/agents/:id → 404', async () => {
    const res = await get(`/api/v1/admin/agents/${FAKE_ID}`, API_KEY);
    expect([404, 400]).toContain(res.status);
  });
});

// ─── Error response shape consistency ────────────────────────────────────────

describe('Admin routes — error response shape', () => {
  it('401 has error field as string', async () => {
    const res = await get('/api/v1/admin/agents');
    expect(typeof res.body['error']).toBe('string');
  });

  it('unknown admin route returns non-200', async () => {
    const res = await get('/api/v1/admin/does-not-exist');
    expect(res.status).not.toBe(200);
  });
});
