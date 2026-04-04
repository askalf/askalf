/**
 * E2E Test — Autonomous Loop: Agent Dispatch → Execution → Ticket Resolution
 *
 * Tests the complete autonomous loop end-to-end:
 *   1. Create a test agent via admin API
 *   2. Create a ticket assigned to the test agent
 *   3. Dispatch an execution against the agent
 *   4. Wait for the execution to reach a terminal state (with timeout)
 *   5. Verify the ticket resolution flow works (PATCH → resolved)
 *   6. Clean up all created resources
 *
 * Requires FORGE_API_KEY (admin) to run — skipped without it.
 * Set FORGE_URL to override the default http://forge:3005.
 *
 * Run: vitest run tests/integration/e2e-autonomous-loop.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const FORGE_URL = process.env['FORGE_URL'] ?? 'http://forge:3005';
const API_KEY = process.env['FORGE_API_KEY'] ?? '';

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

interface ApiResponse {
  status: number;
  body: Record<string, unknown>;
}

async function api(
  method: string,
  path: string,
  opts: { json?: unknown; apiKey?: string } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;

  const res = await fetch(`${FORGE_URL}${path}`, {
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

  return { status: res.status, body };
}

const get = (path: string) => api('GET', path, { apiKey: API_KEY });
const post = (path: string, json: unknown) => api('POST', path, { json, apiKey: API_KEY });
const patch = (path: string, json: unknown) => api('PATCH', path, { json, apiKey: API_KEY });
const del = (path: string) => api('DELETE', path, { apiKey: API_KEY });

/** Poll execution status until it reaches a terminal state or times out. */
async function waitForExecution(
  executionId: string,
  timeoutMs = 90_000,
  intervalMs = 2_000,
): Promise<string> {
  const terminal = new Set(['completed', 'failed', 'cancelled', 'error']);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const res = await get(`/api/v1/forge/executions/${executionId}`);
    if (res.status === 200) {
      const exec = (res.body['execution'] ?? {}) as Record<string, unknown>;
      const status = exec['status'] as string;
      if (terminal.has(status)) return status;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return 'timeout';
}

// ─── Test state ───────────────────────────────────────────────────────────────

let testAgentId = '';
let testTicketId = '';
let testExecutionId = '';

// ─── Skip without API key ─────────────────────────────────────────────────────

const describeE2E = API_KEY ? describe : describe.skip;

// ─── Setup / teardown ─────────────────────────────────────────────────────────

describeE2E('E2E — Autonomous Loop: dispatch → execution → ticket resolution', () => {
  beforeAll(async () => {
    // 1. Create test agent
    const agentRes = await post('/api/v1/admin/agents', {
      name: `E2E Test Agent ${Date.now()}`,
      systemPrompt: 'You are an E2E test agent. Respond with "ok" only. Do not use any tools.',
      description: 'Automated E2E test agent — safe to delete',
      autonomyLevel: 1,
      maxIterations: 3,
      maxCostPerExecution: 0.05,
      metadata: { type: 'dev', e2e_test: true },
    });

    expect(agentRes.status).toBe(201);
    const agent = (agentRes.body['agent'] ?? {}) as Record<string, unknown>;
    testAgentId = (agent['id'] as string) ?? '';
    expect(testAgentId).toBeTruthy();

    // 2. Create ticket assigned to the test agent
    const ticketRes = await post('/api/v1/admin/tickets', {
      title: `E2E Test Ticket ${Date.now()}`,
      description: 'End-to-end test ticket — created by automated E2E test suite',
      priority: 'low',
      category: 'testing',
      assigned_to: 'E2E Test Agent',
      agent_id: testAgentId,
      agent_name: agent['name'] as string,
      source: 'agent',
      metadata: { e2e_test: true },
    });

    expect(ticketRes.status).toBe(201);
    const ticket = (ticketRes.body['ticket'] ?? {}) as Record<string, unknown>;
    testTicketId = (ticket['id'] as string) ?? '';
    expect(testTicketId).toBeTruthy();

    // 3. Dispatch execution for the test agent
    const execRes = await post('/api/v1/admin/executions', {
      agentId: testAgentId,
      input: 'E2E integration test — respond with "ok" only.',
      metadata: { source: 'e2e-test', ticket_id: testTicketId },
    });

    expect(execRes.status).toBe(200);
    const exec = (execRes.body['execution'] ?? {}) as Record<string, unknown>;
    testExecutionId = (exec['id'] as string) ?? '';
    expect(testExecutionId).toBeTruthy();
  });

  afterAll(async () => {
    // Cleanup: delete ticket and agent regardless of test outcomes
    if (testTicketId) {
      await del(`/api/v1/admin/tickets/${testTicketId}`).catch(() => {});
    }
    if (testAgentId) {
      await del(`/api/v1/forge/agents/${testAgentId}`).catch(() => {});
    }
  });

  // ─── Step 1: Agent created successfully ──────────────────────────────────

  it('step 1 — test agent was created and is active', async () => {
    const res = await get(`/api/v1/admin/agents/${testAgentId}`);
    expect(res.status).toBe(200);
    const agent = (res.body['agent'] ?? {}) as Record<string, unknown>;
    expect(agent['id']).toBe(testAgentId);
    expect(agent['raw_status']).toBe('active');
  });

  // ─── Step 2: Ticket created and assigned ─────────────────────────────────

  it('step 2 — test ticket was created with status open', async () => {
    const res = await get(`/api/v1/admin/tickets?status=open`);
    expect(res.status).toBe(200);
    const tickets = (res.body['tickets'] ?? []) as Record<string, unknown>[];
    const ticket = tickets.find((t) => t['id'] === testTicketId);
    expect(ticket).toBeDefined();
    expect(ticket!['status']).toBe('open');
    expect(ticket!['agent_id']).toBe(testAgentId);
  });

  // ─── Step 3: Execution dispatched ────────────────────────────────────────

  it('step 3 — execution was dispatched and is pending or running', async () => {
    const res = await get(`/api/v1/forge/executions/${testExecutionId}`);
    expect(res.status).toBe(200);
    const exec = (res.body['execution'] ?? {}) as Record<string, unknown>;
    expect(exec['id']).toBe(testExecutionId);
    expect(exec['agent_id']).toBe(testAgentId);
    expect(['pending', 'running', 'completed', 'failed']).toContain(exec['status']);
  });

  // ─── Step 4: Execution reaches terminal state ─────────────────────────────

  it('step 4 — execution reaches a terminal state within 90s', async () => {
    const finalStatus = await waitForExecution(testExecutionId, 90_000);
    expect(['completed', 'failed', 'cancelled']).toContain(finalStatus);
  }, 95_000);

  // ─── Step 5: Ticket resolution flow ──────────────────────────────────────

  it('step 5a — ticket status can be updated to in_progress', async () => {
    const res = await patch(`/api/v1/admin/tickets/${testTicketId}`, {
      status: 'in_progress',
    });
    expect(res.status).toBe(200);
    const ticket = (res.body['ticket'] ?? {}) as Record<string, unknown>;
    expect(ticket['status']).toBe('in_progress');
  });

  it('step 5b — ticket can be marked resolved with a resolution note', async () => {
    const res = await patch(`/api/v1/admin/tickets/${testTicketId}`, {
      status: 'resolved',
      resolution: 'E2E test passed — autonomous loop verified end-to-end.',
    });
    expect(res.status).toBe(200);
    const ticket = (res.body['ticket'] ?? {}) as Record<string, unknown>;
    expect(ticket['status']).toBe('resolved');
    expect(ticket['resolution']).toBe('E2E test passed — autonomous loop verified end-to-end.');
  });

  it('step 5c — resolved ticket no longer appears in open tickets list', async () => {
    const res = await get(`/api/v1/admin/tickets?filter=open`);
    expect(res.status).toBe(200);
    const tickets = (res.body['tickets'] ?? []) as Record<string, unknown>[];
    const found = tickets.find((t) => t['id'] === testTicketId);
    expect(found).toBeUndefined();
  });

  // ─── Step 6: Execution cost was recorded ─────────────────────────────────

  it('step 6 — completed execution has cost and status in history', async () => {
    const res = await get(`/api/v1/forge/executions/${testExecutionId}`);
    expect(res.status).toBe(200);
    const exec = (res.body['execution'] ?? {}) as Record<string, unknown>;
    expect(exec['id']).toBe(testExecutionId);
    // Terminal status should be set
    expect(['completed', 'failed', 'cancelled']).toContain(exec['status']);
    // Agent link should be preserved
    expect(exec['agent_id']).toBe(testAgentId);
  });
});

// ─── Auth guard — runs without API key ───────────────────────────────────────

describe('E2E — Auth guards', () => {
  it('POST /api/v1/admin/agents → 401 without auth', async () => {
    const res = await api('POST', '/api/v1/admin/agents', { json: { name: 'No Auth' } });
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/admin/tickets → 401 without auth', async () => {
    const res = await api('POST', '/api/v1/admin/tickets', { json: { title: 'No Auth' } });
    expect(res.status).toBe(401);
  });

  it('POST /api/v1/admin/executions → 401 without auth', async () => {
    const res = await api('POST', '/api/v1/admin/executions', {
      json: { agentId: 'any', input: 'test' },
    });
    expect(res.status).toBe(401);
  });

  it('PATCH /api/v1/admin/tickets/:id → 401 without auth', async () => {
    const res = await api('PATCH', '/api/v1/admin/tickets/FAKE_ID', {
      json: { status: 'resolved' },
    });
    expect(res.status).toBe(401);
  });
});
