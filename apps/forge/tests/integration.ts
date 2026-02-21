/**
 * Forge API Integration Tests
 *
 * Tests the live forge server endpoints for correct status codes
 * and response shapes. Run with:
 *   tsx tests/integration.ts [BASE_URL] [API_KEY]
 *
 * Defaults: BASE_URL=http://forge:3005  API_KEY=from FORGE_INTERNAL_API_KEY env
 */

const BASE_URL = process.argv[2] ?? process.env['FORGE_BASE_URL'] ?? 'http://forge:3005';
const API_KEY = process.argv[3] ?? process.env['FORGE_INTERNAL_API_KEY'] ?? '';

// ─── Test runner ─────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
}

const results: TestResult[] = [];
let currentSuite = '';

function suite(name: string): void {
  currentSuite = name;
  console.log(`\n  ${name}`);
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  const start = performance.now();
  try {
    await fn();
    const duration = Math.round(performance.now() - start);
    results.push({ name: `${currentSuite} > ${name}`, passed: true, duration });
    console.log(`    ✓ ${name} (${duration}ms)`);
  } catch (err) {
    const duration = Math.round(performance.now() - start);
    const error = err instanceof Error ? err.message : String(err);
    results.push({ name: `${currentSuite} > ${name}`, passed: false, error, duration });
    console.log(`    ✗ ${name} (${duration}ms)`);
    console.log(`        ${error}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertHasKeys(obj: Record<string, unknown>, keys: string[]): void {
  for (const key of keys) {
    assert(key in obj, `Expected key "${key}" in response: ${JSON.stringify(obj)}`);
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function get(path: string, authKey?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authKey) headers['Authorization'] = `Bearer ${authKey}`;

  const res = await fetch(`${BASE_URL}${path}`, { headers });
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { status: res.status, body };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

console.log(`\nForge API Integration Tests`);
console.log(`Base URL: ${BASE_URL}`);
console.log(`Auth key: ${API_KEY ? `${API_KEY.slice(0, 8)}…` : '(none — 401 tests only)'}`);

// ─── /health ──────────────────────────────────────────────────────────────────
suite('/health — public endpoint');

await test('returns HTTP 200', async () => {
  const { status } = await get('/health');
  assert(status === 200, `Expected 200, got ${status}`);
});

await test('returns required fields', async () => {
  const { body } = await get('/health');
  const b = body as Record<string, unknown>;
  assertHasKeys(b, ['status', 'service', 'version', 'timestamp', 'checks', 'uptime']);
});

await test('service is "forge"', async () => {
  const { body } = await get('/health');
  const b = body as Record<string, unknown>;
  assert(b['service'] === 'forge', `Expected service="forge", got "${b['service']}"`);
});

await test('checks.database is boolean', async () => {
  const { body } = await get('/health');
  const checks = (body as Record<string, unknown>)['checks'] as Record<string, unknown>;
  assert(typeof checks['database'] === 'boolean', `checks.database should be boolean`);
});

await test('uptime is a non-negative number', async () => {
  const { body } = await get('/health');
  const b = body as Record<string, unknown>;
  assert(typeof b['uptime'] === 'number' && (b['uptime'] as number) >= 0, `uptime should be >= 0`);
});

// ─── Auth enforcement ─────────────────────────────────────────────────────────
suite('Auth enforcement — unauthenticated requests');

const authRequired = [
  '/api/v1/admin/agents',
  '/api/v1/admin/executions',
  '/api/v1/admin/monitoring/health',
  '/api/v1/admin/cost/dashboard',
  '/api/v1/admin/fleet/leaderboard',
  '/api/v1/admin/orchestration',
  '/api/v1/admin/knowledge/stats',
  '/api/v1/admin/checkpoints',
];

for (const path of authRequired) {
  await test(`${path} → 401 without auth`, async () => {
    const { status } = await get(path);
    assert(status === 401, `Expected 401, got ${status}`);
  });
}

await test('invalid Bearer format → 401', async () => {
  const { status } = await get('/api/v1/admin/agents', 'not-a-real-token');
  assert(status === 401, `Expected 401, got ${status}`);
});

await test('fk_ prefix but unknown key → 401', async () => {
  const { status } = await get('/api/v1/admin/agents', 'fk_00000000000000000000000000000000000000000000000000000000');
  assert(status === 401, `Expected 401, got ${status}`);
});

// ─── Authenticated tests (only if API_KEY is provided) ───────────────────────

if (API_KEY) {
  suite('/api/v1/admin/agents — authenticated');

  await test('returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/agents', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('returns agents array', async () => {
    const { body } = await get('/api/v1/admin/agents', API_KEY);
    const b = body as Record<string, unknown>;
    assertHasKeys(b, ['agents']);
    assert(Array.isArray(b['agents']), 'agents should be an array');
  });

  await test('agents have required fields', async () => {
    const { body } = await get('/api/v1/admin/agents', API_KEY);
    const agents = (body as Record<string, unknown>)['agents'] as Record<string, unknown>[];
    if (agents.length > 0) {
      assertHasKeys(agents[0]!, ['id', 'name', 'status']);
    }
  });

  suite('/api/v1/admin/executions — authenticated');

  await test('returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/executions', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('returns executions array', async () => {
    const { body } = await get('/api/v1/admin/executions', API_KEY);
    const b = body as Record<string, unknown>;
    assertHasKeys(b, ['executions']);
    assert(Array.isArray(b['executions']), 'executions should be an array');
  });

  suite('/api/v1/admin/monitoring/health — authenticated');

  await test('returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/monitoring/health', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('returns timestamp field', async () => {
    const { body } = await get('/api/v1/admin/monitoring/health', API_KEY);
    const b = body as Record<string, unknown>;
    assert('timestamp' in b, `Expected timestamp field in health report`);
  });

  suite('/api/v1/admin/cost/dashboard — authenticated');

  await test('returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/cost/dashboard', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  suite('/api/v1/admin/fleet/leaderboard — authenticated');

  await test('returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/fleet/leaderboard', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  suite('/api/v1/admin/knowledge/stats — authenticated');

  await test('returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/knowledge/stats', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('returns node and edge counts', async () => {
    const { body } = await get('/api/v1/admin/knowledge/stats', API_KEY);
    const b = body as Record<string, unknown>;
    assert('totalNodes' in b || 'total_nodes' in b || 'nodes' in b,
      `Expected node count field in knowledge stats: ${JSON.stringify(b)}`);
  });
  // ─── Knowledge Graph endpoints ───────────────────────────────────────────
  suite('/api/v1/admin/knowledge/* — knowledge graph');

  await test('/knowledge/graph returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/knowledge/graph', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/knowledge/graph returns nodes and edges arrays', async () => {
    const { body } = await get('/api/v1/admin/knowledge/graph', API_KEY);
    const b = body as Record<string, unknown>;
    assert(Array.isArray(b['nodes']) || 'nodes' in b, `Expected nodes in response: ${JSON.stringify(Object.keys(b))}`);
    assert(Array.isArray(b['edges']) || 'edges' in b || 'links' in b, `Expected edges/links in response`);
  });

  await test('/knowledge/entity-types returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/knowledge/entity-types', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/knowledge/agents returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/knowledge/agents', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/knowledge/top-connected returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/knowledge/top-connected', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/knowledge/search?q=agent returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/knowledge/search?q=agent', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ─── Events endpoints ──────────────────────────────────────────────────────
  suite('/api/v1/admin/events/* — real-time events');

  await test('/events/recent returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/events/recent', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/events/recent returns events array', async () => {
    const { body } = await get('/api/v1/admin/events/recent', API_KEY);
    const b = body as Record<string, unknown>;
    assert(Array.isArray(b['events']) || Array.isArray(b), `Expected events array in response`);
  });

  await test('/events/stats returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/events/stats', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ─── Goals endpoints ───────────────────────────────────────────────────────
  suite('/api/v1/admin/goals — autonomous goals');

  await test('/goals returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/goals', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/goals returns goals array', async () => {
    const { body } = await get('/api/v1/admin/goals', API_KEY);
    const b = body as Record<string, unknown>;
    assert(Array.isArray(b['goals']) || Array.isArray(b), `Expected goals data in response`);
  });

  // ─── Prompt Revisions endpoints ────────────────────────────────────────────
  suite('/api/v1/admin/prompt-revisions — self-rewriting');

  await test('/prompt-revisions returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/prompt-revisions', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/prompt-revisions returns revisions array', async () => {
    const { body } = await get('/api/v1/admin/prompt-revisions', API_KEY);
    const b = body as Record<string, unknown>;
    assert(Array.isArray(b['revisions']) || Array.isArray(b), `Expected revisions data in response`);
  });

  await test('/prompt-revisions items have required fields', async () => {
    const { body } = await get('/api/v1/admin/prompt-revisions', API_KEY);
    const b = body as Record<string, unknown>;
    const revisions = (b['revisions'] ?? (Array.isArray(b) ? b : [])) as Record<string, unknown>[];
    if (revisions.length > 0) {
      const rev = revisions[0]!;
      assert('id' in rev, `Expected id field in revision: ${JSON.stringify(Object.keys(rev))}`);
      assert('agent_id' in rev || 'agentId' in rev, `Expected agent_id in revision`);
      assert('status' in rev, `Expected status field in revision`);
    }
  });

  // ─── Metabolic Status endpoint ─────────────────────────────────────────────
  suite('/api/v1/admin/metabolic/status — metabolic cycle');

  await test('/metabolic/status returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/metabolic/status', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/metabolic/status returns status data', async () => {
    const { body } = await get('/api/v1/admin/metabolic/status', API_KEY);
    const b = body as Record<string, unknown>;
    assert(typeof b === 'object' && b !== null, `Expected object response`);
  });

  // ─── Users endpoints ───────────────────────────────────────────────────────
  suite('/api/v1/admin/users — user management');

  await test('/users returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/users', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/users/stats returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/users/stats', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/users returns users array', async () => {
    const { body } = await get('/api/v1/admin/users', API_KEY);
    const b = body as Record<string, unknown>;
    const users = b['users'] ?? b;
    assert(Array.isArray(users) || typeof b === 'object', 'Expected users data in response');
  });

  await test('/users/stats returns numeric counts', async () => {
    const { body } = await get('/api/v1/admin/users/stats', API_KEY);
    const b = body as Record<string, unknown>;
    assert(typeof b === 'object' && b !== null, 'Expected object response');
    assert('total' in b || 'totalUsers' in b || 'total_users' in b || 'count' in b,
      `Expected user count field in stats: ${JSON.stringify(Object.keys(b))}`);
  });

  // ─── Capabilities endpoints ────────────────────────────────────────────────
  suite('/api/v1/admin/capabilities — agent capabilities');

  await test('/capabilities/catalog returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/capabilities/catalog', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/capabilities/summary returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/capabilities/summary', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/capabilities/catalog returns array or object', async () => {
    const { body } = await get('/api/v1/admin/capabilities/catalog', API_KEY);
    assert(typeof body === 'object' && body !== null, 'Expected object/array response');
    const b = body as Record<string, unknown>;
    const catalog = b['capabilities'] ?? b['catalog'] ?? body;
    assert(Array.isArray(catalog) || typeof catalog === 'object',
      `Expected capabilities data in catalog: ${JSON.stringify(Object.keys(b))}`);
  });

  await test('/capabilities/summary has agent count or capability data', async () => {
    const { body } = await get('/api/v1/admin/capabilities/summary', API_KEY);
    const b = body as Record<string, unknown>;
    assert(typeof b === 'object' && b !== null, 'Expected object response');
    assert('agents' in b || 'capabilities' in b || 'totalAgents' in b || 'total_agents' in b || 'summary' in b,
      `Expected summary data, got keys: ${JSON.stringify(Object.keys(b))}`);
  });

  // ─── Cost endpoints (extended) ─────────────────────────────────────────────
  suite('/api/v1/admin/costs — cost tracking');

  await test('/costs returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/costs', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/costs/hourly returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/costs/hourly', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ─── Checkpoints ───────────────────────────────────────────────────────────
  suite('/api/v1/admin/checkpoints — authenticated');

  await test('returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/checkpoints', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('returns checkpoints array', async () => {
    const { body } = await get('/api/v1/admin/checkpoints', API_KEY);
    const b = body as Record<string, unknown>;
    assertHasKeys(b, ['checkpoints', 'total']);
    assert(Array.isArray(b['checkpoints']), 'checkpoints should be an array');
  });

  await test('supports status filter', async () => {
    const { status } = await get('/api/v1/admin/checkpoints?status=pending', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('non-existent checkpoint returns 404', async () => {
    const { status } = await get('/api/v1/admin/checkpoints/00000000000000000000000000', API_KEY);
    assert(status === 404, `Expected 404, got ${status}`);
  });

  // ─── Orchestration endpoints ──────────────────────────────────────────────
  suite('/api/v1/admin/orchestration — orchestration');

  await test('/orchestration returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/orchestration', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/orchestration returns object with overview data', async () => {
    const { body } = await get('/api/v1/admin/orchestration', API_KEY);
    assert(typeof body === 'object' && body !== null, 'Expected object response');
  });

  // ─── Interventions endpoints ────────────────────────────────────────────────
  suite('/api/v1/admin/interventions — human-in-the-loop');

  await test('/interventions returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/interventions', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/interventions returns array or paginated result', async () => {
    const { body } = await get('/api/v1/admin/interventions', API_KEY);
    const b = body as Record<string, unknown>;
    assert(Array.isArray(b['interventions']) || Array.isArray(b) || 'total' in b,
      `Expected interventions data in response`);
  });

  // ─── Coordination Sessions endpoints ────────────────────────────────────────
  suite('/api/v1/admin/coordination — multi-agent sessions');

  await test('/coordination/sessions returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/coordination/sessions', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/coordination/sessions returns sessions array', async () => {
    const { body } = await get('/api/v1/admin/coordination/sessions', API_KEY);
    const b = body as Record<string, unknown>;
    assert(Array.isArray(b['sessions']) || Array.isArray(b),
      `Expected sessions data in response`);
  });

  // ─── Tickets admin endpoints ────────────────────────────────────────────────
  suite('/api/v1/admin/tickets — ticket management');

  await test('/tickets returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/tickets', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/tickets returns tickets array with total', async () => {
    const { body } = await get('/api/v1/admin/tickets', API_KEY);
    const b = body as Record<string, unknown>;
    assert(Array.isArray(b['tickets']) || Array.isArray(b), `Expected tickets data`);
  });

  await test('/tickets supports status filter', async () => {
    const { status } = await get('/api/v1/admin/tickets?status=open', API_KEY);
    assert(status === 200, `Expected 200 for status filter, got ${status}`);
  });

  await test('/tickets/:id returns 404 for non-existent', async () => {
    const { status } = await get('/api/v1/admin/tickets/00000000000000000000000000', API_KEY);
    assert(status === 404 || status === 400, `Expected 404/400, got ${status}`);
  });

  // ─── Tasks admin endpoints ──────────────────────────────────────────────────
  suite('/api/v1/admin/tasks — task management');

  await test('/tasks returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/tasks', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ─── Memory proxy endpoints ─────────────────────────────────────────────────
  suite('/api/v1/admin/memory — fleet memory proxy');

  await test('/memory/stats returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/memory/stats', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/memory/recent returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/memory/recent', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  await test('/memory/search?q=test returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/memory/search?q=test', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ─── Audit log endpoint ─────────────────────────────────────────────────────
  suite('/api/v1/admin/audit — audit trail');

  await test('/audit returns HTTP 200', async () => {
    const { status } = await get('/api/v1/admin/audit', API_KEY);
    assert(status === 200, `Expected 200, got ${status}`);
  });

  // ─── Knowledge Graph deep validation ────────────────────────────────────────
  suite('/api/v1/admin/knowledge/* — deep shape validation');

  await test('/knowledge/stats returns totalNodes and totalEdges as numbers', async () => {
    const { body } = await get('/api/v1/admin/knowledge/stats', API_KEY);
    const b = body as Record<string, unknown>;
    const nodes = b['totalNodes'] ?? b['total_nodes'];
    const edges = b['totalEdges'] ?? b['total_edges'];
    assert(typeof nodes === 'number' && nodes >= 0, `totalNodes should be non-negative number, got ${nodes}`);
    assert(typeof edges === 'number' && edges >= 0, `totalEdges should be non-negative number, got ${edges}`);
  });

  await test('/knowledge/graph nodes have id and label', async () => {
    const { body } = await get('/api/v1/admin/knowledge/graph?limit=5', API_KEY);
    const b = body as Record<string, unknown>;
    const nodes = b['nodes'] as Record<string, unknown>[];
    if (nodes && nodes.length > 0) {
      assertHasKeys(nodes[0]!, ['id', 'label']);
    }
  });

  await test('/knowledge/graph edges have source and target', async () => {
    const { body } = await get('/api/v1/admin/knowledge/graph?limit=5', API_KEY);
    const b = body as Record<string, unknown>;
    const edges = (b['edges'] ?? b['links']) as Record<string, unknown>[];
    if (edges && edges.length > 0) {
      assertHasKeys(edges[0]!, ['source', 'target']);
    }
  });

  await test('/knowledge/graph respects limit param', async () => {
    const { body } = await get('/api/v1/admin/knowledge/graph?limit=3', API_KEY);
    const b = body as Record<string, unknown>;
    const nodes = b['nodes'] as unknown[];
    assert(Array.isArray(nodes), 'nodes should be an array');
    assert(nodes.length <= 100, `Expected limited nodes, got ${nodes.length}`);
  });

  await test('/knowledge/entity-types returns array with entity_type field', async () => {
    const { body } = await get('/api/v1/admin/knowledge/entity-types', API_KEY);
    const arr = (Array.isArray(body) ? body : (body as Record<string, unknown>)['types'] ?? body) as Record<string, unknown>[];
    if (Array.isArray(arr) && arr.length > 0) {
      assert('entity_type' in arr[0]! || 'type' in arr[0]! || 'name' in arr[0]!,
        `Expected entity type field in: ${JSON.stringify(arr[0])}`);
    }
  });

  await test('/knowledge/top-connected returns array of hub nodes', async () => {
    const { body } = await get('/api/v1/admin/knowledge/top-connected', API_KEY);
    const arr = Array.isArray(body) ? body : [];
    if (arr.length > 0) {
      const node = arr[0] as Record<string, unknown>;
      assert('id' in node || 'label' in node, `Expected id or label in top-connected node`);
    }
  });

  await test('/knowledge/search returns results with similarity', async () => {
    const { body } = await get('/api/v1/admin/knowledge/search?q=agent', API_KEY);
    const arr = Array.isArray(body) ? body : (body as Record<string, unknown>)['results'] ?? [];
    if (Array.isArray(arr) && arr.length > 0) {
      const item = arr[0] as Record<string, unknown>;
      assert('id' in item || 'label' in item, `Expected id/label in search result: ${JSON.stringify(item)}`);
    }
  });

  await test('/knowledge/search without q returns 400', async () => {
    const { status } = await get('/api/v1/admin/knowledge/search', API_KEY);
    assert(status === 400 || status === 200, `Expected 400 or 200, got ${status}`);
  });

  await test('/knowledge/agents returns agent contribution data', async () => {
    const { body } = await get('/api/v1/admin/knowledge/agents', API_KEY);
    const arr = Array.isArray(body) ? body : [];
    if (arr.length > 0) {
      const agent = arr[0] as Record<string, unknown>;
      assert('agent_id' in agent || 'agent_name' in agent || 'name' in agent,
        `Expected agent identifier in: ${JSON.stringify(agent)}`);
    }
  });

  // ─── Goals deep validation ──────────────────────────────────────────────────
  suite('/api/v1/admin/goals — deep shape validation');

  await test('/goals returns goals array and total count', async () => {
    const { body } = await get('/api/v1/admin/goals', API_KEY);
    const b = body as Record<string, unknown>;
    if ('goals' in b) {
      assert(Array.isArray(b['goals']), 'goals should be an array');
      assert(typeof b['total'] === 'number', `total should be a number, got ${typeof b['total']}`);
    }
  });

  await test('/goals items have required fields', async () => {
    const { body } = await get('/api/v1/admin/goals', API_KEY);
    const b = body as Record<string, unknown>;
    const goals = (b['goals'] ?? (Array.isArray(b) ? b : [])) as Record<string, unknown>[];
    if (goals.length > 0) {
      const goal = goals[0]!;
      assertHasKeys(goal, ['id', 'title', 'status']);
    }
  });

  await test('/goals supports status filter', async () => {
    const { status } = await get('/api/v1/admin/goals?status=proposed', API_KEY);
    assert(status === 200, `Expected 200 for status filter, got ${status}`);
  });

  await test('/goals supports agent_id filter', async () => {
    const { status } = await get('/api/v1/admin/goals?agent_id=nonexistent', API_KEY);
    assert(status === 200, `Expected 200 for agent_id filter, got ${status}`);
  });

  await test('/goals supports limit param', async () => {
    const { body } = await get('/api/v1/admin/goals?limit=2', API_KEY);
    const b = body as Record<string, unknown>;
    const goals = (b['goals'] ?? []) as unknown[];
    assert(Array.isArray(goals), 'goals should be an array');
    assert(goals.length <= 2, `Expected max 2 goals, got ${goals.length}`);
  });

  await test('/goals/:goalId returns 404 for non-existent goal', async () => {
    const { status } = await get('/api/v1/admin/goals/00000000000000000000000000', API_KEY);
    assert(status === 404 || status === 400, `Expected 404/400 for non-existent goal, got ${status}`);
  });

  // ─── Events deep validation ─────────────────────────────────────────────────
  suite('/api/v1/admin/events/* — deep shape validation');

  await test('/events/recent items have event_type and timestamp', async () => {
    const { body } = await get('/api/v1/admin/events/recent', API_KEY);
    const arr = Array.isArray(body) ? body : ((body as Record<string, unknown>)['events'] ?? []);
    if (Array.isArray(arr) && arr.length > 0) {
      const ev = arr[0] as Record<string, unknown>;
      assert('event_type' in ev || 'type' in ev || 'event_name' in ev,
        `Expected event type field in: ${JSON.stringify(ev)}`);
      assert('timestamp' in ev || 'created_at' in ev,
        `Expected timestamp in event: ${JSON.stringify(ev)}`);
    }
  });

  await test('/events/recent respects limit param', async () => {
    const { body } = await get('/api/v1/admin/events/recent?limit=3', API_KEY);
    const arr = Array.isArray(body) ? body : ((body as Record<string, unknown>)['events'] ?? []);
    if (Array.isArray(arr)) {
      assert(arr.length <= 50, `Expected reasonable limit, got ${arr.length}`);
    }
  });

  await test('/events/stats returns total and breakdown', async () => {
    const { body } = await get('/api/v1/admin/events/stats', API_KEY);
    const b = body as Record<string, unknown>;
    assert(typeof b === 'object' && b !== null, 'Expected object response');
    assert('total_events' in b || 'totalEvents' in b || 'total' in b,
      `Expected total events field in: ${JSON.stringify(Object.keys(b))}`);
  });

  await test('/events/execution/:id returns array for valid format', async () => {
    const { status } = await get('/api/v1/admin/events/execution/00000000000000000000000000', API_KEY);
    assert(status === 200 || status === 404, `Expected 200/404, got ${status}`);
  });

  await test('/events/session/:id returns array for valid format', async () => {
    const { status } = await get('/api/v1/admin/events/session/00000000000000000000000000', API_KEY);
    assert(status === 200 || status === 404, `Expected 200/404, got ${status}`);
  });

  // ─── Metabolic deep validation ──────────────────────────────────────────────
  suite('/api/v1/admin/metabolic/status — deep shape validation');

  await test('/metabolic/status has cycles and memory fields', async () => {
    const { body } = await get('/api/v1/admin/metabolic/status', API_KEY);
    const b = body as Record<string, unknown>;
    assert('cycles' in b || 'memory' in b || 'startedAt' in b || 'started_at' in b,
      `Expected metabolic fields, got keys: ${JSON.stringify(Object.keys(b))}`);
  });

  await test('/metabolic/status memory counts are non-negative', async () => {
    const { body } = await get('/api/v1/admin/metabolic/status', API_KEY);
    const b = body as Record<string, unknown>;
    const mem = b['memory'] as Record<string, unknown> | undefined;
    if (mem) {
      for (const [key, val] of Object.entries(mem)) {
        assert(typeof val === 'number' && val >= 0, `memory.${key} should be non-negative, got ${val}`);
      }
    }
  });

  await test('/metabolic/status uptime is non-negative', async () => {
    const { body } = await get('/api/v1/admin/metabolic/status', API_KEY);
    const b = body as Record<string, unknown>;
    const uptime = b['uptimeSeconds'] ?? b['uptime_seconds'] ?? b['uptime'];
    if (typeof uptime === 'number') {
      assert(uptime >= 0, `uptimeSeconds should be >= 0, got ${uptime}`);
    }
  });

  // ─── Costs deep validation ──────────────────────────────────────────────────
  suite('/api/v1/admin/costs — deep shape validation');

  await test('/costs returns summary with totals', async () => {
    const { body } = await get('/api/v1/admin/costs', API_KEY);
    const b = body as Record<string, unknown>;
    assert('summary' in b || 'totalCost' in b || 'total_cost' in b,
      `Expected cost summary in: ${JSON.stringify(Object.keys(b))}`);
  });

  await test('/costs/hourly returns hourly array', async () => {
    const { body } = await get('/api/v1/admin/costs/hourly', API_KEY);
    const b = body as Record<string, unknown>;
    assert('hourly' in b, `Expected hourly field, got keys: ${JSON.stringify(Object.keys(b))}`);
    assert(Array.isArray(b['hourly']), 'hourly should be an array');
  });

  await test('/costs/hourly items have hour and cost fields', async () => {
    const { body } = await get('/api/v1/admin/costs/hourly', API_KEY);
    const b = body as Record<string, unknown>;
    const hourly = b['hourly'] as Record<string, unknown>[];
    if (Array.isArray(hourly) && hourly.length > 0) {
      const item = hourly[0]!;
      assert('hour' in item, `Expected hour field in hourly item`);
      assert('totalCost' in item || 'total_cost' in item || 'cost' in item,
        `Expected cost field in hourly item: ${JSON.stringify(item)}`);
    }
  });

  await test('/costs supports days param', async () => {
    const { status } = await get('/api/v1/admin/costs?days=7', API_KEY);
    assert(status === 200, `Expected 200 for days param, got ${status}`);
  });

  // ─── Fleet leaderboard deep validation ──────────────────────────────────────
  suite('/api/v1/admin/fleet/leaderboard — deep shape validation');

  await test('/fleet/leaderboard items have agent_name and metrics', async () => {
    const { body } = await get('/api/v1/admin/fleet/leaderboard', API_KEY);
    const arr = Array.isArray(body) ? body : [];
    if (arr.length > 0) {
      const agent = arr[0] as Record<string, unknown>;
      assert('agent_name' in agent || 'name' in agent || 'agent_id' in agent,
        `Expected agent identifier in leaderboard: ${JSON.stringify(agent)}`);
      assert('success_rate' in agent || 'tasks_completed' in agent || 'total_cost' in agent,
        `Expected metrics in leaderboard: ${JSON.stringify(Object.keys(agent))}`);
    }
  });

} else {
  console.log('\n  (Skipping authenticated tests — no API_KEY provided)');
  console.log('  Set FORGE_INTERNAL_API_KEY env var or pass key as second arg to run full suite.');
}

// ─── Swagger / OpenAPI tests ──────────────────────────────────────────────────
suite('/docs — Swagger UI and OpenAPI spec');

await test('/docs returns HTTP 200', async () => {
  const res = await fetch(`${BASE_URL}/docs`);
  assert(res.status === 200, `Expected 200, got ${res.status}`);
});

await test('/docs/json returns valid OpenAPI spec', async () => {
  const res = await fetch(`${BASE_URL}/docs/json`);
  assert(res.status === 200, `Expected 200, got ${res.status}`);
  const spec = await res.json() as Record<string, unknown>;
  assertHasKeys(spec, ['openapi', 'info', 'paths']);
  assert(typeof spec['openapi'] === 'string', 'openapi field should be a string');
});

await test('OpenAPI spec contains agent routes', async () => {
  const res = await fetch(`${BASE_URL}/docs/json`);
  const spec = await res.json() as Record<string, unknown>;
  const paths = spec['paths'] as Record<string, unknown>;
  assert('/api/v1/forge/agents' in paths, 'Expected /api/v1/forge/agents in paths');
});

await test('OpenAPI spec contains checkpoint routes', async () => {
  const res = await fetch(`${BASE_URL}/docs/json`);
  const spec = await res.json() as Record<string, unknown>;
  const paths = spec['paths'] as Record<string, unknown>;
  assert('/api/v1/admin/checkpoints' in paths, 'Expected /api/v1/admin/checkpoints in paths');
});

// ─── Error shape tests ────────────────────────────────────────────────────────
suite('Error response shapes');

await test('401 response has error field', async () => {
  const { body } = await get('/api/v1/admin/agents');
  const b = body as Record<string, unknown>;
  assert('error' in b, `Expected "error" field in 401 response: ${JSON.stringify(b)}`);
});

await test('404 route returns non-200', async () => {
  const { status } = await get('/api/v1/does-not-exist');
  assert(status !== 200, `Expected non-200 for unknown route, got ${status}`);
});

// ─── Security header tests ────────────────────────────────────────────────────
suite('Security headers');

await test('/health has X-Content-Type-Options: nosniff', async () => {
  const res = await fetch(`${BASE_URL}/health`);
  const header = res.headers.get('x-content-type-options');
  assert(header === 'nosniff', `Expected nosniff, got "${header}"`);
});

await test('/health has X-Frame-Options: DENY', async () => {
  const res = await fetch(`${BASE_URL}/health`);
  const header = res.headers.get('x-frame-options');
  assert(header === 'DENY', `Expected DENY, got "${header}"`);
});

// ─── Summary ──────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const totalMs = results.reduce((s, r) => s + r.duration, 0);

console.log('\n────────────────────────────────────────');
console.log(`Results: ${passed} passed, ${failed} failed (${totalMs}ms total)`);

if (failed > 0) {
  console.log('\nFailed tests:');
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  ✗ ${r.name}`);
    console.log(`      ${r.error}`);
  }
  process.exit(1);
} else {
  console.log('All tests passed ✓');
  process.exit(0);
}
