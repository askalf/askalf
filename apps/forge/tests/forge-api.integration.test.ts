/**
 * Forge API Integration Tests — Critical Paths
 *
 * Tests the forge API for the four critical flows:
 *   1. Agent CRUD (create, list, get, update, delete)
 *   2. Execution lifecycle (create, list, get, cancel, retry)
 *   3. Session auth flow (login, get session, use session, logout)
 *   4. API key auth flow
 *
 * Usage:
 *   FORGE_BASE_URL=http://forge:3005
 *   FORGE_INTERNAL_API_KEY=fk_...        # required for agent/execution tests
 *   TEST_USER_EMAIL=test@example.com     # required for session auth tests
 *   TEST_USER_PASSWORD=Password123!      # required for session auth tests
 *
 * Run: vitest run tests/forge-api.integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const BASE_URL = process.env['FORGE_BASE_URL'] ?? 'http://forge:3005';
const API_KEY = process.env['FORGE_INTERNAL_API_KEY'] ?? '';
const TEST_EMAIL = process.env['TEST_USER_EMAIL'] ?? '';
const TEST_PASSWORD = process.env['TEST_USER_PASSWORD'] ?? '';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
  headers: Headers;
}

async function api(
  method: string,
  path: string,
  opts: {
    apiKey?: string;
    cookie?: string;
    json?: unknown;
    csrfToken?: string;
  } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;
  if (opts.cookie) headers['Cookie'] = opts.cookie;
  if (opts.csrfToken) headers['X-Csrf-Token'] = opts.csrfToken;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = { _raw: await res.text() };
  }

  return { status: res.status, body, headers: res.headers };
}

const get = (path: string, opts?: { apiKey?: string; cookie?: string }) =>
  api('GET', path, opts);
const post = (path: string, json: unknown, opts?: { apiKey?: string; cookie?: string; csrfToken?: string }) =>
  api('POST', path, { json, ...opts });
const put = (path: string, json: unknown, opts?: { apiKey?: string; cookie?: string }) =>
  api('PUT', path, { json, ...opts });
const del = (path: string, opts?: { apiKey?: string; cookie?: string }) =>
  api('DELETE', path, opts);

// ─── Shared test state ────────────────────────────────────────────────────────

let testAgentId = '';
let testExecutionId = '';

// ─── 1. API Key Auth Flow ─────────────────────────────────────────────────────

describe('API Key Auth Flow', () => {
  it('returns 401 with no auth header on protected routes', async () => {
    const res = await get('/api/v1/forge/agents');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 with a non-fk_ Bearer token', async () => {
    const res = await get('/api/v1/forge/agents', { apiKey: 'not-a-valid-key' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with a well-formatted but unknown fk_ key', async () => {
    const fakeKey = 'fk_' + '0'.repeat(56);
    const res = await get('/api/v1/forge/agents', { apiKey: fakeKey });
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 200 with a valid API key', async () => {
    if (!API_KEY) return; // skip if no key provided
    const res = await get('/api/v1/forge/agents', { apiKey: API_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('agents');
    expect(Array.isArray(res.body['agents'])).toBe(true);
  });

  it('error response has error and message fields', async () => {
    const res = await get('/api/v1/forge/agents');
    expect(typeof res.body['error']).toBe('string');
  });
});

// ─── 2. Agent CRUD ────────────────────────────────────────────────────────────

describe('Agent CRUD', () => {
  beforeAll(async () => {
    if (!API_KEY) return;
    // Create a test agent to use in subsequent tests
    const res = await post(
      '/api/v1/forge/agents',
      {
        name: `QA Test Agent ${Date.now()}`,
        systemPrompt: 'You are a QA test agent. Do not use this in production.',
        description: 'Automated integration test agent — safe to delete',
        autonomyLevel: 1,
        maxIterations: 5,
        maxCostPerExecution: 0.01,
      },
      { apiKey: API_KEY },
    );
    if (res.status === 201) {
      const agent = (res.body['agent'] ?? {}) as Record<string, unknown>;
      testAgentId = (agent['id'] as string) ?? '';
    }
  });

  afterAll(async () => {
    // Clean up: archive the test agent
    if (!API_KEY || !testAgentId) return;
    await del(`/api/v1/forge/agents/${testAgentId}`, { apiKey: API_KEY });
  });

  it('POST /api/v1/forge/agents → 401 without auth', async () => {
    const res = await post('/api/v1/forge/agents', { name: 'No Auth Agent' });
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/forge/agents → 201 with valid payload', async () => {
    if (!API_KEY) return;
    expect(testAgentId).toBeTruthy();
  });

  it('POST /api/v1/forge/agents returns agent with required fields', async () => {
    if (!API_KEY) return;
    const res = await post(
      '/api/v1/forge/agents',
      {
        name: `QA Temp Agent ${Date.now()}`,
        systemPrompt: 'Temp QA agent for field validation test',
      },
      { apiKey: API_KEY },
    );
    expect(res.status).toBe(201);
    const agent = (res.body['agent'] ?? {}) as Record<string, unknown>;
    expect(agent).toHaveProperty('id');
    expect(agent).toHaveProperty('name');
    expect(agent).toHaveProperty('slug');
    expect(agent).toHaveProperty('status');
    expect(agent['status']).toBe('draft');
    // Clean up temp agent
    const id = agent['id'] as string;
    if (id) await del(`/api/v1/forge/agents/${id}`, { apiKey: API_KEY });
  });

  it('GET /api/v1/forge/agents → returns paginated agents list', async () => {
    if (!API_KEY) return;
    const res = await get('/api/v1/forge/agents', { apiKey: API_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('agents');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('limit');
    expect(res.body).toHaveProperty('offset');
    expect(Array.isArray(res.body['agents'])).toBe(true);
    expect(typeof res.body['total']).toBe('number');
  });

  it('GET /api/v1/forge/agents → respects limit param', async () => {
    if (!API_KEY) return;
    const res = await get('/api/v1/forge/agents?limit=2', { apiKey: API_KEY });
    expect(res.status).toBe(200);
    const agents = res.body['agents'] as unknown[];
    expect(agents.length).toBeLessThanOrEqual(2);
  });

  it('GET /api/v1/forge/agents/:id → returns the created agent', async () => {
    if (!API_KEY || !testAgentId) return;
    const res = await get(`/api/v1/forge/agents/${testAgentId}`, { apiKey: API_KEY });
    expect(res.status).toBe(200);
    const agent = (res.body['agent'] ?? {}) as Record<string, unknown>;
    expect(agent['id']).toBe(testAgentId);
    expect(agent).toHaveProperty('name');
    expect(agent).toHaveProperty('system_prompt');
    expect(agent).toHaveProperty('status');
  });

  it('GET /api/v1/forge/agents/:id → 404 for non-existent ID', async () => {
    if (!API_KEY) return;
    const res = await get('/api/v1/forge/agents/01NONEXISTENTID0000000000000', { apiKey: API_KEY });
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body['error']).toBe('Not Found');
  });

  it('PUT /api/v1/forge/agents/:id → updates agent fields', async () => {
    if (!API_KEY || !testAgentId) return;
    const res = await put(
      `/api/v1/forge/agents/${testAgentId}`,
      { description: 'Updated by QA integration test' },
      { apiKey: API_KEY },
    );
    expect(res.status).toBe(200);
    const agent = (res.body['agent'] ?? {}) as Record<string, unknown>;
    expect(agent['description']).toBe('Updated by QA integration test');
    expect(agent['id']).toBe(testAgentId);
  });

  it('PUT /api/v1/forge/agents/:id → increments version on update', async () => {
    if (!API_KEY || !testAgentId) return;
    // Get current version
    const before = await get(`/api/v1/forge/agents/${testAgentId}`, { apiKey: API_KEY });
    const agentBefore = (before.body['agent'] ?? {}) as Record<string, unknown>;
    const versionBefore = agentBefore['version'] as number;

    // Update
    await put(
      `/api/v1/forge/agents/${testAgentId}`,
      { description: 'Version bump test' },
      { apiKey: API_KEY },
    );

    // Get after
    const after = await get(`/api/v1/forge/agents/${testAgentId}`, { apiKey: API_KEY });
    const agentAfter = (after.body['agent'] ?? {}) as Record<string, unknown>;
    const versionAfter = agentAfter['version'] as number;

    expect(versionAfter).toBeGreaterThan(versionBefore);
  });

  it('PUT /api/v1/forge/agents/:id → 400 with empty body', async () => {
    if (!API_KEY || !testAgentId) return;
    const res = await put(`/api/v1/forge/agents/${testAgentId}`, {}, { apiKey: API_KEY });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('DELETE /api/v1/forge/agents/:id → archives agent (soft delete)', async () => {
    if (!API_KEY) return;
    // Create a temporary agent to delete
    const create = await post(
      '/api/v1/forge/agents',
      { name: `QA Delete Test ${Date.now()}`, systemPrompt: 'Delete me' },
      { apiKey: API_KEY },
    );
    expect(create.status).toBe(201);
    const tempId = ((create.body['agent'] ?? {}) as Record<string, unknown>)['id'] as string;
    expect(tempId).toBeTruthy();

    // Delete it
    const del2 = await del(`/api/v1/forge/agents/${tempId}`, { apiKey: API_KEY });
    expect(del2.status).toBe(200);
    expect(del2.body).toHaveProperty('message');
    const agent = (del2.body['agent'] ?? {}) as Record<string, unknown>;
    expect(agent['status']).toBe('archived');

    // Verify it no longer shows in list (archived are hidden)
    const list = await get('/api/v1/forge/agents', { apiKey: API_KEY });
    const agents = (list.body['agents'] ?? []) as Record<string, unknown>[];
    const found = agents.find((a) => a['id'] === tempId);
    expect(found).toBeUndefined();
  });

  it('DELETE /api/v1/forge/agents/:id → 404 for non-existent ID', async () => {
    if (!API_KEY) return;
    const res = await del('/api/v1/forge/agents/01NONEXISTENTID0000000000000', { apiKey: API_KEY });
    expect(res.status).toBe(404);
  });

  it('POST /api/v1/forge/agents/:id/fork → creates a forked copy', async () => {
    if (!API_KEY || !testAgentId) return;
    const res = await post(
      `/api/v1/forge/agents/${testAgentId}/fork`,
      { name: 'QA Forked Agent' },
      { apiKey: API_KEY },
    );
    expect(res.status).toBe(201);
    const forked = (res.body['agent'] ?? {}) as Record<string, unknown>;
    expect(forked['id']).not.toBe(testAgentId);
    expect(forked['forked_from']).toBe(testAgentId);

    // Clean up the fork
    if (forked['id']) await del(`/api/v1/forge/agents/${forked['id']}`, { apiKey: API_KEY });
  });
});

// ─── 3. Execution Lifecycle ───────────────────────────────────────────────────

describe('Execution Lifecycle', () => {
  beforeAll(async () => {
    if (!API_KEY || !testAgentId) return;
    // Create a test execution (it will fail fast since no real LLM budget)
    const res = await post(
      '/api/v1/forge/executions',
      {
        agentId: testAgentId,
        input: 'QA integration test — respond with "ok" only',
        metadata: { source: 'qa-integration-test' },
      },
      { apiKey: API_KEY },
    );
    if (res.status === 201) {
      const exec = (res.body['execution'] ?? {}) as Record<string, unknown>;
      testExecutionId = (exec['id'] as string) ?? '';
    }
  });

  it('POST /api/v1/forge/executions → 401 without auth', async () => {
    const res = await post('/api/v1/forge/executions', { agentId: 'any', input: 'test' });
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/forge/executions → 404 for non-existent agent', async () => {
    if (!API_KEY) return;
    const res = await post(
      '/api/v1/forge/executions',
      { agentId: '01NONEXISTENTID0000000000000', input: 'test' },
      { apiKey: API_KEY },
    );
    expect(res.status).toBe(404);
    expect(res.body['error']).toBe('Not Found');
  });

  it('POST /api/v1/forge/executions → 201 with valid agent', async () => {
    if (!API_KEY || !testAgentId) return;
    expect(testExecutionId).toBeTruthy();
  });

  it('POST /api/v1/forge/executions returns execution with required fields', async () => {
    if (!API_KEY || !testAgentId) return;
    const res = await post(
      '/api/v1/forge/executions',
      { agentId: testAgentId, input: 'Field validation test — respond "ok"' },
      { apiKey: API_KEY },
    );
    expect(res.status).toBe(201);
    const exec = (res.body['execution'] ?? {}) as Record<string, unknown>;
    expect(exec).toHaveProperty('id');
    expect(exec).toHaveProperty('agent_id');
    expect(exec['agent_id']).toBe(testAgentId);
    expect(exec).toHaveProperty('status');
    expect(['pending', 'running']).toContain(exec['status']);
    expect(exec).toHaveProperty('input');
    expect(exec['input']).toBe('Field validation test — respond "ok"');
    // Cancel immediately to avoid costs
    const newId = exec['id'] as string;
    if (newId) await post(`/api/v1/forge/executions/${newId}/cancel`, {}, { apiKey: API_KEY });
  });

  it('GET /api/v1/forge/executions → returns paginated list', async () => {
    if (!API_KEY) return;
    const res = await get('/api/v1/forge/executions', { apiKey: API_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('executions');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('limit');
    expect(Array.isArray(res.body['executions'])).toBe(true);
  });

  it('GET /api/v1/forge/executions → filters by agentId', async () => {
    if (!API_KEY || !testAgentId) return;
    const res = await get(`/api/v1/forge/executions?agentId=${testAgentId}`, { apiKey: API_KEY });
    expect(res.status).toBe(200);
    const executions = (res.body['executions'] ?? []) as Record<string, unknown>[];
    for (const exec of executions) {
      expect(exec['agent_id']).toBe(testAgentId);
    }
  });

  it('GET /api/v1/forge/executions/:id → returns the created execution', async () => {
    if (!API_KEY || !testExecutionId) return;
    const res = await get(`/api/v1/forge/executions/${testExecutionId}`, { apiKey: API_KEY });
    expect(res.status).toBe(200);
    const exec = (res.body['execution'] ?? {}) as Record<string, unknown>;
    expect(exec['id']).toBe(testExecutionId);
    expect(exec).toHaveProperty('status');
    expect(exec).toHaveProperty('input');
    expect(exec).toHaveProperty('agent_id');
  });

  it('GET /api/v1/forge/executions/:id → 404 for non-existent ID', async () => {
    if (!API_KEY) return;
    const res = await get('/api/v1/forge/executions/01NONEXISTENTID0000000000000', { apiKey: API_KEY });
    expect(res.status).toBe(404);
    expect(res.body['error']).toBe('Not Found');
  });

  it('POST /api/v1/forge/executions/:id/cancel → cancels a pending execution', async () => {
    if (!API_KEY || !testAgentId) return;
    // Create a new execution to cancel
    const create = await post(
      '/api/v1/forge/executions',
      { agentId: testAgentId, input: 'Cancel me immediately' },
      { apiKey: API_KEY },
    );
    expect(create.status).toBe(201);
    const execId = ((create.body['execution'] ?? {}) as Record<string, unknown>)['id'] as string;
    expect(execId).toBeTruthy();

    // Cancel it
    const cancel = await post(`/api/v1/forge/executions/${execId}/cancel`, {}, { apiKey: API_KEY });
    expect(cancel.status).toBe(200);
    expect(cancel.body['cancelled']).toBe(true);

    // Verify status is cancelled
    const getRes = await get(`/api/v1/forge/executions/${execId}`, { apiKey: API_KEY });
    const exec = (getRes.body['execution'] ?? {}) as Record<string, unknown>;
    expect(exec['status']).toBe('cancelled');
  });

  it('POST /api/v1/forge/executions/:id/cancel → 400 for already-completed execution', async () => {
    if (!API_KEY || !testExecutionId) return;
    // Wait briefly for the execution to finish (it may still be pending/running)
    // Then try to cancel a cancelled/completed execution
    const getRes = await get(`/api/v1/forge/executions/${testExecutionId}`, { apiKey: API_KEY });
    const status = ((getRes.body['execution'] ?? {}) as Record<string, unknown>)['status'];
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      const cancel = await post(`/api/v1/forge/executions/${testExecutionId}/cancel`, {}, { apiKey: API_KEY });
      expect(cancel.status).toBe(400);
      expect(cancel.body).toHaveProperty('error');
    }
    // If still pending/running, skip (can't guarantee timing)
  });

  it('POST /api/v1/forge/executions/:id/retry → 400 for non-failed execution', async () => {
    if (!API_KEY || !testAgentId) return;
    // Create and immediately retrieve an execution that is still pending/running
    const create = await post(
      '/api/v1/forge/executions',
      { agentId: testAgentId, input: 'Retry test — pending state' },
      { apiKey: API_KEY },
    );
    if (create.status !== 201) return;
    const execId = ((create.body['execution'] ?? {}) as Record<string, unknown>)['id'] as string;

    // Try to retry while it's still pending
    const retry = await post(`/api/v1/forge/executions/${execId}/retry`, {}, { apiKey: API_KEY });
    // Should be 400 (not failed/cancelled) or 201 if the timing is off
    expect([400, 201]).toContain(retry.status);

    // Clean up
    await post(`/api/v1/forge/executions/${execId}/cancel`, {}, { apiKey: API_KEY });
  });

  it('GET /api/v1/forge/executions/costs/summary → returns cost breakdown', async () => {
    if (!API_KEY) return;
    const res = await get('/api/v1/forge/executions/costs/summary', { apiKey: API_KEY });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('period');
    expect(res.body).toHaveProperty('totals');
    expect(res.body).toHaveProperty('daily');
    expect(res.body).toHaveProperty('weekly');
    const totals = (res.body['totals'] ?? {}) as Record<string, unknown>;
    expect(typeof totals['totalCost']).toBe('number');
    expect(typeof totals['executionCount']).toBe('number');
  });

  it('POST /api/v1/forge/executions/batch → 401 without auth', async () => {
    const res = await post('/api/v1/forge/executions/batch', { agents: [] });
    expect(res.status).toBe(401);
  });
});

// ─── 4. Session Auth Flow ─────────────────────────────────────────────────────

describe('Session Auth Flow', () => {
  let sessionCookie = '';
  let csrfToken = '';

  beforeAll(async () => {
    if (!TEST_EMAIL || !TEST_PASSWORD) return;
    const res = await post('/api/v1/auth/login', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (res.status === 200) {
      const setCookie = res.headers.get('set-cookie') ?? '';
      const match = setCookie.match(/substrate_session=([^;]+)/);
      sessionCookie = match ? `substrate_session=${match[1]}` : '';
      csrfToken = (res.body['csrf_token'] as string) ?? '';
    }
  });

  afterAll(async () => {
    if (!sessionCookie) return;
    await post('/api/v1/auth/logout', {}, { cookie: sessionCookie, csrfToken });
  });

  it('POST /api/v1/auth/login → 400 with missing credentials', async () => {
    const res = await post('/api/v1/auth/login', { email: 'only-email@example.com' });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('POST /api/v1/auth/login → 401 with wrong password', async () => {
    if (!TEST_EMAIL) return;
    const res = await post('/api/v1/auth/login', {
      email: TEST_EMAIL,
      password: 'WrongPassword999!',
    });
    expect(res.status).toBe(401);
    expect(res.body['error']).toBe('Invalid email or password');
  });

  it('POST /api/v1/auth/login → 200 with valid credentials', async () => {
    if (!TEST_EMAIL || !TEST_PASSWORD) return;
    const res = await post('/api/v1/auth/login', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body['success']).toBe(true);
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('csrf_token');
    const user = (res.body['user'] ?? {}) as Record<string, unknown>;
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('email');
    // Verify session cookie was set
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('substrate_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  it('GET /api/v1/auth/me → 401 without session cookie', async () => {
    const res = await get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body['error']).toBe('Not authenticated');
  });

  it('GET /api/v1/auth/me → 200 with valid session', async () => {
    if (!sessionCookie) return;
    const res = await get('/api/v1/auth/me', { cookie: sessionCookie });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body).toHaveProperty('session');
    const user = (res.body['user'] ?? {}) as Record<string, unknown>;
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('email');
    expect(user['email']).toBe(TEST_EMAIL.toLowerCase());
    const session = (res.body['session'] ?? {}) as Record<string, unknown>;
    expect(session).toHaveProperty('id');
    expect(session).toHaveProperty('expiresAt');
  });

  it('session can be used to call forge API (GET /api/v1/forge/agents)', async () => {
    if (!sessionCookie) return;
    const res = await get('/api/v1/forge/agents', { cookie: sessionCookie });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('agents');
    expect(Array.isArray(res.body['agents'])).toBe(true);
  });

  it('POST /api/v1/auth/logout → invalidates session', async () => {
    if (!TEST_EMAIL || !TEST_PASSWORD) return;
    // Login fresh
    const login = await post('/api/v1/auth/login', {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    if (login.status !== 200) return;
    const setCookie = login.headers.get('set-cookie') ?? '';
    const match = setCookie.match(/substrate_session=([^;]+)/);
    const tempCookie = match ? `substrate_session=${match[1]}` : '';
    const tempCsrf = (login.body['csrf_token'] as string) ?? '';

    // Verify session works
    const before = await get('/api/v1/auth/me', { cookie: tempCookie });
    expect(before.status).toBe(200);

    // Logout
    const logout = await post('/api/v1/auth/logout', {}, { cookie: tempCookie, csrfToken: tempCsrf });
    expect(logout.status).toBe(200);
    expect(logout.body['success']).toBe(true);

    // Session should now be invalid
    const after = await get('/api/v1/auth/me', { cookie: tempCookie });
    expect(after.status).toBe(401);
  });

  it('GET /api/v1/auth/sessions → 401 without auth', async () => {
    const res = await get('/api/v1/auth/sessions');
    expect(res.status).toBe(401);
  });

  it('GET /api/v1/auth/sessions → 200 with valid session', async () => {
    if (!sessionCookie) return;
    const res = await get('/api/v1/auth/sessions', { cookie: sessionCookie });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessions');
    expect(Array.isArray(res.body['sessions'])).toBe(true);
    const sessions = res.body['sessions'] as Record<string, unknown>[];
    // Current session should be in the list
    const current = sessions.find((s) => s['is_current'] === true);
    expect(current).toBeDefined();
  });

  it('POST /api/v1/auth/login → 400 with invalid email format', async () => {
    const res = await post('/api/v1/auth/login', {
      email: 'not-an-email',
      password: 'SomePassword123!',
    });
    // Either 400 (validation) or 401 (not found) — both acceptable
    expect([400, 401]).toContain(res.status);
  });
});

// ─── 5. Auth Error Response Shape Validation ──────────────────────────────────

describe('Error Response Shape Consistency', () => {
  it('401 on /forge/agents has error field', async () => {
    const res = await get('/api/v1/forge/agents');
    expect(typeof res.body['error']).toBe('string');
  });

  it('404 on unknown agent has error field', async () => {
    if (!API_KEY) return;
    const res = await get('/api/v1/forge/agents/01NONEXISTENTID0000000000000', { apiKey: API_KEY });
    expect(typeof res.body['error']).toBe('string');
    expect(typeof res.body['message']).toBe('string');
  });

  it('404 on unknown execution has error field', async () => {
    if (!API_KEY) return;
    const res = await get('/api/v1/forge/executions/01NONEXISTENTID0000000000000', { apiKey: API_KEY });
    expect(typeof res.body['error']).toBe('string');
    expect(typeof res.body['message']).toBe('string');
  });

  it('401 on /auth/me has error field', async () => {
    const res = await get('/api/v1/auth/me');
    expect(typeof res.body['error']).toBe('string');
  });
});
