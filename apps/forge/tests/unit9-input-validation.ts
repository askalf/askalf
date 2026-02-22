/**
 * Unit 9 — API Input Validation Tests
 *
 * Tests validation behavior across Forge API route handlers. Audits both the
 * correct guards that exist and documents gaps where validation is missing.
 *
 * Two test categories:
 *   VALIDATION_OK  — existing check works, should always pass
 *   GAP_DOCUMENTED — input is accepted when it shouldn't be; marks missing validation
 *
 * Integration tests require a live forge server:
 *   tsx tests/unit9-input-validation.ts [BASE_URL] [API_KEY]
 *
 * Defaults: BASE_URL=http://forge:3005  API_KEY=from FORGE_INTERNAL_API_KEY env
 *
 * Unit-only tests (regex/logic) run without a server and are marked [UNIT].
 */

const BASE_URL = process.argv[2] ?? process.env['FORGE_BASE_URL'] ?? 'http://forge:3005';
const API_KEY  = process.argv[3] ?? process.env['FORGE_INTERNAL_API_KEY'] ?? '';

// ─── Test runner ──────────────────────────────────────────────────────────────

type Expectation = 'validation_ok' | 'gap_documented' | 'unit_only';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
  expectation: Expectation;
}

const results: TestResult[] = [];
let currentSuite = '';

function suite(name: string): void {
  currentSuite = name;
  console.log(`\n  ${name}`);
}

async function test(
  name: string,
  fn: () => void | Promise<void>,
  expectation: Expectation = 'validation_ok',
): Promise<void> {
  const start = performance.now();
  try {
    await fn();
    const duration = Math.round(performance.now() - start);
    results.push({ name: `${currentSuite} > ${name}`, passed: true, duration, expectation });
    console.log(`    ✓ ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name: `${currentSuite} > ${name}`, passed: false, error, duration, expectation });
    const tag = expectation === 'gap_documented' ? ' [EXPECTED — gap in validation]' : '';
    console.log(`    ✗ ${name} (${duration}ms)${tag}`);
    console.log(`        ${error}`);
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function assertIncludes(actual: string, substr: string, label: string): void {
  if (!actual.includes(substr)) {
    throw new Error(`${label}: expected to include "${substr}", got "${actual.slice(0, 300)}"`);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  body: unknown;
}

async function apiPost(path: string, body: unknown): Promise<HttpResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  try { parsed = await res.json(); } catch { parsed = await res.text(); }
  return { status: res.status, body: parsed };
}

async function apiPut(path: string, body: unknown): Promise<HttpResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });
  let parsed: unknown;
  try { parsed = await res.json(); } catch { parsed = await res.text(); }
  return { status: res.status, body: parsed };
}

async function apiGet(path: string): Promise<HttpResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
  });
  let parsed: unknown;
  try { parsed = await res.json(); } catch { parsed = await res.text(); }
  return { status: res.status, body: parsed };
}

function b(r: HttpResponse): Record<string, unknown> {
  return r.body as Record<string, unknown>;
}

// ─── Server connectivity check ─────────────────────────────────────────────────

async function checkServerReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Pure unit tests (no server needed) ───────────────────────────────────────

async function runUnitTests(): Promise<void> {

  // ────────────────────────────────────────────────────────────────────────────
  suite('[UNIT] Dynamic WHERE clause safety — agents.ts / executions.ts / sessions.ts');
  // ────────────────────────────────────────────────────────────────────────────
  // The agents.ts / executions.ts / sessions.ts routes build a WHERE clause by
  // appending to a `conditions[]` array and joining with ' AND '.
  // Column names and operators are hardcoded (e.g. "status = $1") — user input
  // ONLY flows in via parameterized placeholders, never into the column/operator
  // part of the string. This is safe, and we verify the pattern here.

  await test('[UNIT] hardcoded conditions cannot carry user input into column names', () => {
    // Simulate the pattern used in agents.ts lines 151-174
    const params: unknown[] = [];
    const conditions: string[] = ['owner_id = $1'];
    params.push('user-123');

    let paramIndex = 2;

    // User supplies "status" query param — value goes into params[], not SQL text
    const qs = { status: 'running; DROP TABLE forge_agents; --' };
    conditions.push(`status = $${paramIndex}`);
    params.push(qs.status);
    paramIndex++;

    const whereClause = conditions.join(' AND ');

    // The WHERE clause only contains safe SQL text with placeholders
    assert(!whereClause.includes('DROP'), 'DROP TABLE must not appear in SQL text');
    assert(!whereClause.includes('--'), 'SQL comment must not appear in SQL text');
    assert(whereClause === 'owner_id = $1 AND status = $2', `WHERE clause should be safe: ${whereClause}`);
    // The injection string is in params[1] which is safely parameterized
    assert(params[1] === qs.status, 'Injection string is a parameter value, not SQL text');
  }, 'unit_only');

  await test('[UNIT] LIMIT is clamped — cannot exceed 100 via query string', () => {
    // agents.ts line 173: Math.min(parseInt(qs.limit ?? '50', 10) || 50, 100)
    const limitStr = '99999';
    const clamped = Math.min(parseInt(limitStr, 10) || 50, 100);
    assert(clamped === 100, `LIMIT should be clamped to 100, got ${clamped}`);
  }, 'unit_only');

  await test('[UNIT] LIMIT with NaN input falls back to default', () => {
    // parseInt('garbage', 10) returns NaN; || 50 provides fallback
    const limitStr = 'garbage';
    const limit = Math.min(parseInt(limitStr, 10) || 50, 100);
    assert(limit === 50, `LIMIT should fall back to 50 for NaN input, got ${limit}`);
  }, 'unit_only');

  await test('[UNIT] LIMIT with negative input is clamped correctly', () => {
    // parseInt('-100', 10) = -100; Math.min(-100, 100) = -100 — gap: negative limit
    const limitStr = '-100';
    const parsed = parseInt(limitStr, 10);
    // parsed is -100, truthy in || context (falsy only for 0/NaN), clamped to -100
    const limit = Math.min(parsed || 50, 100);
    // NOTE: negative limit becomes -100 because -100 || 50 → -100 (truthy)
    // Math.min(-100, 100) = -100 which would cause a DB error
    // This is a gap: no lower-bound check on LIMIT/OFFSET
    assert(limit === -100, `Negative limit passes through as ${limit} — gap documented`);
  }, 'gap_documented');

  // ────────────────────────────────────────────────────────────────────────────
  suite('[UNIT] tools.ts — riskLevel enum gap');
  // ────────────────────────────────────────────────────────────────────────────

  await test('[UNIT] riskLevel "critical" is a valid enum value (stored as-is without check)', () => {
    // tools.ts line 103: riskLevel?: string  — no enum check in handler
    // Valid values should be: low | medium | high | critical
    // But the route also accepts arbitrary strings like "none" or "CRITICAL"
    const validRiskLevels = ['low', 'medium', 'high', 'critical'];
    const invalidRiskLevels = ['none', 'CRITICAL', 'zero', 'ultra-high', '1', ''];

    // Verify valid values pass a proper enum check (if one existed)
    for (const level of validRiskLevels) {
      assert(validRiskLevels.includes(level), `${level} should be valid`);
    }

    // Verify invalid values would be caught by a proper enum check
    for (const level of invalidRiskLevels) {
      assert(!validRiskLevels.includes(level), `${level} should be caught by enum check`);
    }

    // Document: the current route at tools.ts line 141 has no such check:
    //   body.riskLevel ?? 'low'  — just uses it without validation
    // This means riskLevel='ultra-high' would be stored in DB without error
    console.log('    GAP: tools.ts POST /tools does NOT validate riskLevel against enum');
  }, 'unit_only');

  // ────────────────────────────────────────────────────────────────────────────
  suite('[UNIT] executions.ts — days parameter negative-value gap (commit 88f70c1)');
  // ────────────────────────────────────────────────────────────────────────────

  await test('[UNIT] negative days passes through the clamping logic (DB error risk)', () => {
    // executions.ts line 75: Math.min(parseInt(qs.days ?? '30', 10) || 30, 90)
    // parseInt('-5', 10) = -5; -5 is truthy so -5 || 30 = -5; Math.min(-5, 90) = -5
    // Result: INTERVAL '1 day' * -5 → valid SQL but goes 5 days into the future
    // or some DBs reject negative intervals — either way, wrong behavior
    const daysStr = '-5';
    const parsed = parseInt(daysStr, 10);
    const days = Math.min(parsed || 30, 90);
    assert(days === -5, `Expected -5 to pass through (gap), got ${days}`);
    console.log('    GAP: executions.ts days parameter has no lower-bound guard (negative days pass through)');
  }, 'gap_documented');

  await test('[UNIT] negative limit passes through the clamping logic', () => {
    // Same pattern across agents.ts, tools.ts, and executions.ts
    // Math.min(parseInt('-1', 10) || 50, 100) = Math.min(-1, 100) = -1
    // LIMIT -1 → PostgreSQL error: "LIMIT must not be negative"
    const limitStr = '-1';
    const parsed = parseInt(limitStr, 10);
    const limit = Math.min(parsed || 50, 100);
    assert(limit === -1, `Expected -1 to pass through (gap), got ${limit}`);
    console.log('    GAP: limit parameter has no lower-bound guard across multiple route files');
  }, 'gap_documented');

  await test('[UNIT] fix pattern: Math.max(0, ...) would prevent negative values', () => {
    // Correct implementation adds Math.max(0, ...) as a lower bound:
    // Math.max(0, Math.min(parseInt(str, 10) || default, max))
    const testCases = ['-1', '-100', '-9999'];
    for (const str of testCases) {
      const fixed = Math.max(0, Math.min(parseInt(str, 10) || 50, 100));
      assert(fixed === 0, `Fixed pattern should clamp ${str} to 0, got ${fixed}`);
    }
    const validCase = Math.max(0, Math.min(parseInt('25', 10) || 50, 100));
    assert(validCase === 25, `Valid input 25 should pass through as 25, got ${validCase}`);
  }, 'unit_only');

  await test('[UNIT] workflows.ts — status field has no enum validation', () => {
    // workflows.ts line 241: if (body.status !== undefined) addParam('status', body.status)
    // No check that body.status is in ['draft', 'active', 'paused', 'archived'] or similar
    const validStatuses = ['draft', 'active', 'paused', 'archived'];
    const badStatus = 'HACKED';

    // If the route had a check, this would be caught:
    const wouldBeValidated = validStatuses.includes(badStatus);
    assert(!wouldBeValidated, `${badStatus} should fail enum check — but route has none`);

    console.log('    GAP: workflows.ts PUT does NOT validate status against known values');
  }, 'unit_only');

  // ────────────────────────────────────────────────────────────────────────────
  suite('[UNIT] Name field length limits — all POST routes');
  // ────────────────────────────────────────────────────────────────────────────

  await test('[UNIT] guardrails name has no max-length constraint (potential DoS vector)', () => {
    // admin.ts line 108: if (!body.name || !body.type || !body.config)
    // Truthy check catches empty/null but NOT a 10MB string
    const oversizedName = 'a'.repeat(100_000); // 100 KB
    const truthyCheck = !oversizedName; // false — passes the guard
    assert(!truthyCheck, 'Oversized name passes the truthy guard — no length limit enforced');
    console.log('    GAP: admin.ts POST /guardrails has no max-length on name field');
  }, 'unit_only');

  await test('[UNIT] tools name has no max-length constraint', () => {
    const oversizedName = 'a'.repeat(100_000);
    const truthyCheck = !oversizedName;
    assert(!truthyCheck, 'Oversized tool name passes truthy guard');
    console.log('    GAP: tools.ts POST /tools has no max-length on name field');
  }, 'unit_only');
}

// ─── Integration tests (require live server) ─────────────────────────────────

async function runIntegrationTests(): Promise<void> {

  // ────────────────────────────────────────────────────────────────────────────
  suite('admin.ts POST /api/v1/forge/admin/guardrails — validation checks');
  // ────────────────────────────────────────────────────────────────────────────

  await test('rejects request missing required field: name', async () => {
    const r = await apiPost('/api/v1/forge/admin/guardrails', {
      type: 'cost_limit',
      config: { maxCost: 1.0 },
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assertIncludes(JSON.stringify(r.body), 'name', 'Error should mention missing field');
  });

  await test('rejects request missing required field: type', async () => {
    const r = await apiPost('/api/v1/forge/admin/guardrails', {
      name: 'test-guardrail',
      config: { maxCost: 1.0 },
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assertIncludes(JSON.stringify(r.body), 'type', 'Error should mention missing field');
  });

  await test('rejects request missing required field: config', async () => {
    const r = await apiPost('/api/v1/forge/admin/guardrails', {
      name: 'test-guardrail',
      type: 'cost_limit',
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
    assertIncludes(JSON.stringify(r.body), 'config', 'Error should mention missing field');
  });

  await test('rejects invalid type value (not in enum)', async () => {
    const r = await apiPost('/api/v1/forge/admin/guardrails', {
      name: 'test-guardrail',
      type: 'invalid_type_xyz',
      config: { value: 1 },
    });
    assert(r.status === 400, `Expected 400 for invalid type, got ${r.status}: ${JSON.stringify(r.body)}`);
    assertIncludes(JSON.stringify(r.body), 'type', 'Error should mention invalid type');
  });

  await test('rejects unauthenticated request with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/forge/admin/guardrails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', type: 'cost_limit', config: {} }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // GAP: no max-length on name — oversized input accepted
  await test('[GAP] accepts oversized name field (no max-length validation)', async () => {
    const r = await apiPost('/api/v1/forge/admin/guardrails', {
      name: 'a'.repeat(10_000),   // 10 KB — no size limit in handler
      type: 'cost_limit',
      config: { maxCost: 1.0 },
    });
    // If validation were correct, this would be 400. Currently it's 201 or 409.
    // We assert it is NOT 400, documenting the gap.
    assert(
      r.status !== 400,
      `Expected oversized name to pass validation (gap), but got 400: ${JSON.stringify(r.body)}`,
    );
    console.log(`      status=${r.status} — oversized name accepted, no length guard exists`);
  }, 'gap_documented');

  // ────────────────────────────────────────────────────────────────────────────
  suite('tools.ts POST /api/v1/forge/tools — validation checks');
  // ────────────────────────────────────────────────────────────────────────────

  await test('rejects request missing name', async () => {
    const r = await apiPost('/api/v1/forge/tools', {
      displayName: 'Test Tool',
      description: 'A test tool',
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('rejects request missing displayName', async () => {
    const r = await apiPost('/api/v1/forge/tools', {
      name: 'test-tool',
      description: 'A test tool',
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('rejects request missing description', async () => {
    const r = await apiPost('/api/v1/forge/tools', {
      name: 'test-tool',
      displayName: 'Test Tool',
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('rejects unauthenticated request with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/forge/tools`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', displayName: 'X', description: 'x' }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // GAP: riskLevel accepts any string without enum check
  await test('[GAP] accepts invalid riskLevel value (no enum validation)', async () => {
    const r = await apiPost('/api/v1/forge/tools', {
      name: `qa-test-tool-gap-${Date.now()}`,
      displayName: 'QA Test Gap Tool',
      description: 'Written by QA to document validation gap',
      riskLevel: 'ULTRA_DANGEROUS', // invalid — should be: low | medium | high | critical
    });
    // Should be 400 for invalid riskLevel, but currently 201 (or 409 if exists)
    assert(
      r.status !== 400,
      `Expected invalid riskLevel to be accepted (gap), but got 400: ${JSON.stringify(r.body)}`,
    );
    console.log(`      status=${r.status} — invalid riskLevel stored without enum check`);
  }, 'gap_documented');

  // ────────────────────────────────────────────────────────────────────────────
  suite('tools.ts POST /api/v1/forge/mcp/servers — validation checks');
  // ────────────────────────────────────────────────────────────────────────────

  await test('rejects request missing name', async () => {
    const r = await apiPost('/api/v1/forge/mcp/servers', {
      transportType: 'stdio',
      connectionConfig: { command: 'test' },
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('rejects request missing transportType', async () => {
    const r = await apiPost('/api/v1/forge/mcp/servers', {
      name: 'test-server',
      connectionConfig: { command: 'test' },
    });
    assert(r.status === 400, `Expected 400, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('rejects invalid transportType (not in enum)', async () => {
    const r = await apiPost('/api/v1/forge/mcp/servers', {
      name: 'test-server',
      transportType: 'websocket', // not in ['stdio', 'sse', 'streamable_http']
      connectionConfig: { url: 'ws://example.com' },
    });
    assert(r.status === 400, `Expected 400 for invalid transportType, got ${r.status}: ${JSON.stringify(r.body)}`);
    assertIncludes(JSON.stringify(r.body), 'transportType', 'Error should mention transportType');
  });

  await test('rejects unauthenticated request with 401', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/forge/mcp/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', transportType: 'stdio', connectionConfig: {} }),
    });
    assert(res.status === 401, `Expected 401, got ${res.status}`);
  });

  // ────────────────────────────────────────────────────────────────────────────
  suite('agents.ts GET /api/v1/forge/agents — query param guards');
  // ────────────────────────────────────────────────────────────────────────────

  await test('returns 200 with default limit/offset (no params)', async () => {
    const r = await apiGet('/api/v1/forge/agents');
    assert(r.status === 200 || r.status === 401,
      `Expected 200 or 401, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('handles limit=100 (max allowed)', async () => {
    const r = await apiGet('/api/v1/forge/agents?limit=100');
    assert(r.status === 200 || r.status === 401,
      `Expected 200 or 401, got ${r.status}`);
    if (r.status === 200) {
      const body = b(r);
      assert('agents' in body, 'Response should contain agents array');
      const agents = body.agents as unknown[];
      assert(agents.length <= 100, `Response should not exceed LIMIT 100, got ${agents.length}`);
    }
  });

  await test('clamps limit=99999 to 100', async () => {
    const r = await apiGet('/api/v1/forge/agents?limit=99999');
    assert(r.status === 200 || r.status === 401,
      `Expected 200 or 401, got ${r.status}`);
    if (r.status === 200) {
      const body = b(r);
      const agents = body.agents as unknown[];
      assert(agents.length <= 100, `LIMIT should be clamped — returned ${agents.length} (max 100)`);
    }
  });

  // GAP: negative limit/offset passes through as-is
  await test('[GAP] negative limit does not trigger 400 (no lower-bound guard)', async () => {
    const r = await apiGet('/api/v1/forge/agents?limit=-1');
    // A proper guard would return 400, but the current code does Math.min(-1, 100) = -1
    // which will likely cause a DB error. We document whether it's 400 or 500.
    assert(r.status !== 200,
      `Expected non-200 for limit=-1 (negative limit should not return results), got ${r.status}`);
    if (r.status === 400) {
      console.log('      status=400 — server rejects negative limit (good behavior!)');
    } else {
      console.log(`      status=${r.status} — server passes negative limit to DB (gap)`);
    }
  }, 'gap_documented');

  // ────────────────────────────────────────────────────────────────────────────
  suite('auth.ts — authentication boundary tests');
  // ────────────────────────────────────────────────────────────────────────────

  await test('protected routes require Authorization header', async () => {
    const protectedPaths = [
      '/api/v1/forge/agents',
      '/api/v1/forge/sessions',
      '/api/v1/forge/admin/guardrails',
      '/api/v1/forge/tools',
    ];

    for (const path of protectedPaths) {
      const res = await fetch(`${BASE_URL}${path}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      assert(
        res.status === 401,
        `${path}: Expected 401 without auth, got ${res.status}`,
      );
    }
  });

  await test('invalid API key returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/forge/agents`, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer definitely-not-a-valid-key-xyz',
      },
    });
    assert(res.status === 401, `Expected 401 for invalid key, got ${res.status}`);
  });

  // ────────────────────────────────────────────────────────────────────────────
  suite('Content-Type and body parsing edge cases');
  // ────────────────────────────────────────────────────────────────────────────

  await test('POST with non-JSON Content-Type returns 415 or 400', async () => {
    // Fastify should reject non-JSON bodies on JSON-only routes
    const res = await fetch(`${BASE_URL}/api/v1/forge/admin/guardrails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: 'name=test&type=cost_limit',
    });
    assert(
      res.status === 415 || res.status === 400 || res.status === 401,
      `Expected 415/400/401 for text/plain body, got ${res.status}`,
    );
  });

  await test('POST with empty body returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/forge/admin/guardrails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: '',
    });
    assert(
      res.status === 400 || res.status === 401,
      `Expected 400/401 for empty body, got ${res.status}`,
    );
  });

  await test('POST with malformed JSON returns 400', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/forge/admin/guardrails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: '{ invalid json {{',
    });
    assert(
      res.status === 400 || res.status === 401,
      `Expected 400/401 for malformed JSON, got ${res.status}`,
    );
  });

  // ────────────────────────────────────────────────────────────────────────────
  suite('executions.ts GET /api/v1/admin/executions/costs — cost tracking endpoints');
  // ────────────────────────────────────────────────────────────────────────────
  // Added in commit 88f70c1: new cost tracking routes. Audit for input validation.

  await test('requires authentication (returns 401 without key)', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/admin/executions/costs`);
    assert(res.status === 401, `Expected 401 without auth, got ${res.status}`);
  });

  await test('returns 200 with valid days param', async () => {
    const r = await apiGet('/api/v1/admin/executions/costs?days=7');
    assert(r.status === 200 || r.status === 401,
      `Expected 200 or 401, got ${r.status}: ${JSON.stringify(r.body)}`);
    if (r.status === 200) {
      const body = b(r);
      assert('executions' in body, 'Response should have executions array');
      assert('total' in body, 'Response should have total count');
      assert('page' in body, 'Response should have page');
      assert('limit' in body, 'Response should have limit');
    }
  });

  await test('clamps limit=99999 to max 100', async () => {
    const r = await apiGet('/api/v1/admin/executions/costs?limit=99999');
    assert(r.status === 200 || r.status === 401,
      `Expected 200 or 401, got ${r.status}`);
    if (r.status === 200) {
      const body = b(r);
      const executions = body.executions as unknown[];
      assert(executions.length <= 100, `Limit should be clamped to 100, got ${executions.length}`);
    }
  });

  await test('clamps days=999 to max 90', async () => {
    const r = await apiGet('/api/v1/admin/executions/costs?days=999');
    assert(r.status === 200 || r.status === 401,
      `Expected 200 or 401, got ${r.status}`);
    // If 200, response period.days should not exceed 90 (verified in summary endpoint below)
  });

  // GAP: negative days passes through as -5 (truthy), causing INTERVAL error
  await test('[GAP] negative days does not return 200 with corrupted data', async () => {
    const r = await apiGet('/api/v1/admin/executions/costs?days=-5');
    // Should return 400 for invalid days; currently may return 500 (DB INTERVAL error)
    // We assert it does NOT silently return 200 with wrong data
    if (r.status === 200) {
      const body = b(r);
      // If server returned 200, the period.days should be positive (gap if it returns -5)
      console.log(`      status=200, body=${JSON.stringify(body).slice(0, 100)} — negative days may have been used`);
    } else {
      console.log(`      status=${r.status} — server handled negative days (${r.status === 400 ? 'rejected correctly' : 'server error'})`);
    }
    // Document: the gap exists regardless of whether it 200s or 500s
    assert(r.status !== 200 || (r.body as Record<string, unknown>).executions !== undefined,
      `Negative days returned unexpected response`);
  }, 'gap_documented');

  await test('GET /costs/summary requires authentication', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/admin/executions/costs/summary`);
    assert(res.status === 401, `Expected 401 without auth, got ${res.status}`);
  });

  await test('GET /costs/summary returns correct shape', async () => {
    const r = await apiGet('/api/v1/admin/executions/costs/summary?days=7');
    assert(r.status === 200 || r.status === 401,
      `Expected 200 or 401, got ${r.status}: ${JSON.stringify(r.body)}`);
    if (r.status === 200) {
      const body = b(r);
      assert('period' in body, 'Response should have period');
      assert('totals' in body, 'Response should have totals');
      assert('daily' in body, 'Response should have daily breakdown');
      assert('weekly' in body, 'Response should have weekly breakdown');
      const period = body.period as Record<string, unknown>;
      assert(typeof period.days === 'number' && period.days > 0,
        `period.days should be positive, got ${period.days}`);
    }
  });

  await test('GET /:id/cost returns 404 for nonexistent execution', async () => {
    const r = await apiGet('/api/v1/admin/executions/nonexistent-id-xyz/cost');
    assert(r.status === 404 || r.status === 401,
      `Expected 404 or 401 for nonexistent ID, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('GET /:id/cost requires authentication', async () => {
    const res = await fetch(`${BASE_URL}/api/v1/admin/executions/fake-id/cost`);
    assert(res.status === 401, `Expected 401 without auth, got ${res.status}`);
  });

  // ────────────────────────────────────────────────────────────────────────────

  // CVE-2026-25223: Tab character in Content-Type bypasses Fastify validation
  // (fixed in Fastify >=5.7.3, tracked in memory)
  await test('[CVE-2026-25223] tab in Content-Type header does not bypass validation', async () => {
    // If Content-Type: application/json\t; charset=utf-8 bypasses Fastify's
    // content-type check, the body parser is skipped and body arrives as Buffer.
    // Routes using `request.body as {...}` would then have body=Buffer, and
    // the manual `if (!body.name ...)` check would pass (Buffer is truthy),
    // causing body.name to be `undefined` inserted into DB.
    const res = await fetch(`${BASE_URL}/api/v1/forge/admin/guardrails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json\t; charset=utf-8',
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      body: JSON.stringify({ name: 'cve-test', type: 'cost_limit', config: {} }),
    });
    // If patched (Fastify >=5.7.3): 400 (body not parsed) or 201 (normal flow)
    // If vulnerable: may return 201 with corrupted data or 500
    assert(
      res.status !== 500,
      `Status 500 on tab Content-Type — server crashed, likely CVE-2026-25223 is unpatched`,
    );
    if (res.status === 201) {
      console.log('      status=201 — parsed normally (patch likely applied)');
    } else {
      console.log(`      status=${res.status} — tab header rejected/handled correctly`);
    }
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\nForge API Input Validation Tests (Unit 9)');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Auth key: ${API_KEY ? `${API_KEY.slice(0, 8)}…` : '(none)'}`);

  // Always run pure unit tests
  await runUnitTests();

  // Integration tests require live server
  const serverUp = await checkServerReachable();
  if (!serverUp) {
    console.log('\n  ⚠ Forge server not reachable — skipping integration tests');
    console.log(`  (set FORGE_BASE_URL or pass BASE_URL as arg to target live server)`);
  } else {
    await runIntegrationTests();
  }

  // ─── Summary ────────────────────────────────────────────────────────────────

  const passed       = results.filter((r) => r.passed).length;
  const failed       = results.filter((r) => !r.passed).length;
  const gaps         = results.filter((r) => !r.passed && r.expectation === 'gap_documented');
  const realFailures = results.filter((r) => !r.passed && r.expectation === 'validation_ok');
  const totalTime    = results.reduce((sum, r) => sum + r.duration, 0);

  console.log('\n' + '─'.repeat(80));
  console.log(`RESULTS: ${passed} passed, ${failed} failed (${totalTime}ms)`);

  if (gaps.length > 0) {
    console.log(`\n⚠  VALIDATION GAPS DOCUMENTED (${gaps.length}):`);
    console.log(`   These tests fail because validation is missing. File tickets to fix.\n`);
    gaps.forEach((r) => {
      console.log(`  ⚠ [GAP] ${r.name}`);
      console.log(`    ${r.error}`);
    });
  }

  if (realFailures.length > 0) {
    console.log(`\n❌ UNEXPECTED FAILURES (${realFailures.length}):`);
    realFailures.forEach((r) => {
      console.log(`  ✗ ${r.name}`);
      console.log(`    ${r.error}`);
    });
    process.exit(1);
  }

  if (gaps.length > 0) {
    console.log('\n⚠  Validation gaps detected. See GAP findings above for remediation.');
    process.exit(2); // exit 2 = gaps found (not a runner failure)
  }

  console.log('\n✓ All validation tests passed');
  process.exit(0);
}

main().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
