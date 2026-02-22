/**
 * Forge Unit Tests — Part 8
 *
 * Covers: routes/platform-admin/utils.ts
 *   - paginationResponse
 *   - mapAgentType
 *   - mapAgentStatus
 *   - transformAgent
 *   - AUTO_APPROVE_PATTERNS
 *
 * All functions are pure / DB-free.
 * Run with:
 *   tsx tests/unit8-utils.ts
 */

import {
  paginationResponse,
  mapAgentType,
  mapAgentStatus,
  transformAgent,
  AUTO_APPROVE_PATTERNS,
  type ForgeAgent,
  type ForgeExecution,
} from '../src/routes/platform-admin/utils.js';

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

function test(name: string, fn: () => void): void {
  const start = performance.now();
  try {
    fn();
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

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAgent(overrides: Partial<ForgeAgent> = {}): ForgeAgent {
  return {
    id: 'agent-001',
    name: 'Test Agent',
    description: 'A test agent',
    system_prompt: 'Be helpful.',
    status: 'active',
    autonomy_level: 2,
    metadata: null,
    provider_config: null,
    model_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeExecution(overrides: Partial<ForgeExecution> = {}): ForgeExecution {
  return {
    id: 'exec-001',
    agent_id: 'agent-001',
    status: 'completed',
    input: 'Do the thing',
    output: 'Done',
    error: null,
    started_at: '2026-01-01T00:00:00Z',
    completed_at: '2026-01-01T00:01:00Z',
    created_at: '2026-01-01T00:00:00Z',
    total_tokens: 100,
    cost: '0.001',
    duration_ms: 60000,
    metadata: null,
    ...overrides,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
suite('paginationResponse');
// ──────────────────────────────────────────────────────────────────────────

test('first page — hasNext true, hasPrev false', () => {
  const r = paginationResponse(100, 1, 10);
  assertEqual(r.page, 1, 'page');
  assertEqual(r.limit, 10, 'limit');
  assertEqual(r.total, 100, 'total');
  assertEqual(r.totalPages, 10, 'totalPages');
  assertEqual(r.hasNext, true, 'hasNext');
  assertEqual(r.hasPrev, false, 'hasPrev');
});

test('last page — hasNext false, hasPrev true', () => {
  const r = paginationResponse(100, 10, 10);
  assertEqual(r.hasNext, false, 'hasNext');
  assertEqual(r.hasPrev, true, 'hasPrev');
});

test('middle page — hasNext true, hasPrev true', () => {
  const r = paginationResponse(100, 5, 10);
  assertEqual(r.hasNext, true, 'hasNext');
  assertEqual(r.hasPrev, true, 'hasPrev');
});

test('zero total → totalPages is 1 (not 0)', () => {
  const r = paginationResponse(0, 1, 10);
  assertEqual(r.totalPages, 1, 'totalPages with zero total');
  assertEqual(r.hasNext, false, 'hasNext with zero total');
});

test('non-integer division rounds up', () => {
  // 15 items, 10 per page → 2 pages
  const r = paginationResponse(15, 1, 10);
  assertEqual(r.totalPages, 2, 'totalPages should ceil');
});

test('exactly divisible total', () => {
  const r = paginationResponse(20, 2, 10);
  assertEqual(r.totalPages, 2, 'totalPages exact division');
  assertEqual(r.hasNext, false, 'hasNext on exact last page');
});

test('single item single page', () => {
  const r = paginationResponse(1, 1, 10);
  assertEqual(r.totalPages, 1, 'totalPages');
  assertEqual(r.hasNext, false, 'hasNext');
  assertEqual(r.hasPrev, false, 'hasPrev');
});

// ──────────────────────────────────────────────────────────────────────────
suite('mapAgentType');
// ──────────────────────────────────────────────────────────────────────────

test('null metadata → custom', () => {
  assertEqual(mapAgentType(null), 'custom', 'null metadata');
});

test('empty metadata → custom', () => {
  assertEqual(mapAgentType({}), 'custom', 'empty object');
});

test('type=development → dev', () => {
  assertEqual(mapAgentType({ type: 'development' }), 'dev', 'development');
});

test('type=dev → dev', () => {
  assertEqual(mapAgentType({ type: 'dev' }), 'dev', 'dev');
});

test('type=research → research', () => {
  assertEqual(mapAgentType({ type: 'research' }), 'research', 'research');
});

test('type=support → support', () => {
  assertEqual(mapAgentType({ type: 'support' }), 'support', 'support');
});

test('type=content → content', () => {
  assertEqual(mapAgentType({ type: 'content' }), 'content', 'content');
});

test('type=monitoring → monitor', () => {
  assertEqual(mapAgentType({ type: 'monitoring' }), 'monitor', 'monitoring');
});

test('type=monitor → monitor', () => {
  assertEqual(mapAgentType({ type: 'monitor' }), 'monitor', 'monitor');
});

test('unknown type string → custom', () => {
  assertEqual(mapAgentType({ type: 'unknown-category' }), 'custom', 'unknown type');
});

test('type matching is case-insensitive', () => {
  assertEqual(mapAgentType({ type: 'DEVELOPMENT' }), 'dev', 'uppercase DEVELOPMENT');
  assertEqual(mapAgentType({ type: 'Research' }), 'research', 'mixed-case Research');
});

// ──────────────────────────────────────────────────────────────────────────
suite('mapAgentStatus');
// ──────────────────────────────────────────────────────────────────────────

test('paused → paused', () => {
  assertEqual(mapAgentStatus('paused'), 'paused', 'paused status');
});

test('archived → idle', () => {
  assertEqual(mapAgentStatus('archived'), 'idle', 'archived status');
});

test('active → idle (no running exec)', () => {
  // mapAgentStatus is for the DB status field only, not live exec state
  assertEqual(mapAgentStatus('active'), 'idle', 'active (no exec override)');
});

test('any other status → idle', () => {
  assertEqual(mapAgentStatus('inactive'), 'idle', 'inactive');
  assertEqual(mapAgentStatus(''), 'idle', 'empty string');
  assertEqual(mapAgentStatus('error'), 'idle', 'error status');
});

// ──────────────────────────────────────────────────────────────────────────
suite('transformAgent');
// ──────────────────────────────────────────────────────────────────────────

test('agent with no executions', () => {
  const agent = makeAgent();
  const result = transformAgent(agent, [], 0);
  assertEqual(result.id, 'agent-001', 'id');
  assertEqual(result.name, 'Test Agent', 'name');
  assertEqual(result.tasks_completed, 0, 'tasks_completed');
  assertEqual(result.tasks_failed, 0, 'tasks_failed');
  assertEqual(result.current_task, null, 'current_task');
  assertEqual(result.last_run_at, null, 'last_run_at');
  assertEqual(result.pending_interventions, 0, 'pending_interventions');
});

test('agent with completed executions counts correctly', () => {
  const execs = [
    makeExecution({ id: 'e1', status: 'completed' }),
    makeExecution({ id: 'e2', status: 'completed' }),
    makeExecution({ id: 'e3', status: 'failed' }),
  ];
  const result = transformAgent(makeAgent(), execs, 0);
  assertEqual(result.tasks_completed, 2, 'tasks_completed');
  assertEqual(result.tasks_failed, 1, 'tasks_failed');
});

test('running execution makes status=running and sets current_task', () => {
  const execs = [
    makeExecution({ id: 'e-running', status: 'running', completed_at: null }),
  ];
  const result = transformAgent(makeAgent(), execs, 0);
  assertEqual(result.status, 'running', 'status should be running');
  assertEqual(result.current_task, 'e-running', 'current_task should be exec id');
});

test('pending execution also triggers running status', () => {
  const execs = [
    makeExecution({ id: 'e-pending', status: 'pending', completed_at: null }),
  ];
  const result = transformAgent(makeAgent(), execs, 0);
  assertEqual(result.status, 'running', 'pending exec triggers running status');
});

test('executions from other agents are filtered out', () => {
  const execs = [
    makeExecution({ id: 'e-other', agent_id: 'other-agent', status: 'completed' }),
    makeExecution({ id: 'e-own', agent_id: 'agent-001', status: 'completed' }),
  ];
  const result = transformAgent(makeAgent(), execs, 0);
  assertEqual(result.tasks_completed, 1, 'only own agent executions counted');
});

test('last_run_at uses most recent completed execution', () => {
  const execs = [
    makeExecution({ id: 'e1', completed_at: '2026-01-01T01:00:00Z' }),
    makeExecution({ id: 'e2', completed_at: '2026-01-02T00:00:00Z' }), // newer
  ];
  const result = transformAgent(makeAgent(), execs, 0);
  assertEqual(result.last_run_at, '2026-01-02T00:00:00Z', 'should pick most recent');
});

test('archived agent sets is_decommissioned=true', () => {
  const agent = makeAgent({ status: 'archived' });
  const result = transformAgent(agent, [], 0);
  assertEqual(result.is_decommissioned, true, 'is_decommissioned');
  assert(result.decommissioned_at !== null, 'decommissioned_at should be set');
});

test('active agent is_decommissioned=false', () => {
  const agent = makeAgent({ status: 'active' });
  const result = transformAgent(agent, [], 0);
  assertEqual(result.is_decommissioned, false, 'is_decommissioned');
  assertEqual(result.decommissioned_at, null, 'decommissioned_at');
});

test('pending_interventions propagated correctly', () => {
  const result = transformAgent(makeAgent(), [], 3);
  assertEqual(result.pending_interventions, 3, 'pending_interventions');
});

test('null description/system_prompt become empty string', () => {
  const agent = makeAgent({ description: null, system_prompt: null });
  const result = transformAgent(agent, [], 0);
  assertEqual(result.description, '', 'null description → empty string');
  assertEqual(result.system_prompt, '', 'null system_prompt → empty string');
});

test('autonomy_level defaults to 2 when undefined', () => {
  const agent = makeAgent({ autonomy_level: undefined as unknown as number });
  const result = transformAgent(agent, [], 0);
  assertEqual(result.autonomy_level, 2, 'autonomy_level default');
});

// ──────────────────────────────────────────────────────────────────────────
suite('AUTO_APPROVE_PATTERNS');
// ──────────────────────────────────────────────────────────────────────────

test('matches "restart container" text', () => {
  const text = 'Please restart the container for agent X';
  assert(AUTO_APPROVE_PATTERNS.some(p => p.test(text)), 'restart container should match');
});

test('matches "install extension" text', () => {
  const text = 'install the postgres extension pg_stat_statements';
  assert(AUTO_APPROVE_PATTERNS.some(p => p.test(text)), 'install extension should match');
});

test('matches "apply migration" text', () => {
  const text = 'apply migration 001_add_index.sql';
  assert(AUTO_APPROVE_PATTERNS.some(p => p.test(text)), 'apply migration should match');
});

test('matches "create index" text', () => {
  const text = 'create index on forge_executions(agent_id)';
  assert(AUTO_APPROVE_PATTERNS.some(p => p.test(text)), 'create index should match');
});

test('matches "enable monitoring" text', () => {
  const text = 'enable monitoring for the forge service';
  assert(AUTO_APPROVE_PATTERNS.some(p => p.test(text)), 'enable monitoring should match');
});

test('matches "update schedule" text', () => {
  const text = 'update schedule for agent QA Engineer to every 15 minutes';
  assert(AUTO_APPROVE_PATTERNS.some(p => p.test(text)), 'update schedule should match');
});

test('patterns are case-insensitive', () => {
  assert(AUTO_APPROVE_PATTERNS.some(p => p.test('RESTART CONTAINER')), 'uppercase RESTART CONTAINER');
  assert(AUTO_APPROVE_PATTERNS.some(p => p.test('Apply Migration')), 'mixed case Apply Migration');
});

test('does NOT match dangerous operations', () => {
  const dangerous = [
    'drop table forge_agents',
    'delete all executions',
    'rm -rf /workspace',
    'push to main branch',
  ];
  for (const text of dangerous) {
    assert(!AUTO_APPROVE_PATTERNS.some(p => p.test(text)), `should NOT match: "${text}"`);
  }
});

// ─── Results ─────────────────────────────────────────────────────────────────

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
const totalTime = results.reduce((sum, r) => sum + r.duration, 0);

console.log('\n' + '─'.repeat(80));
console.log(`RESULTS: ${passed} passed, ${failed} failed (${totalTime}ms total)`);

if (failed > 0) {
  console.log('\nFailures:');
  results
    .filter(r => !r.passed)
    .forEach(r => {
      console.log(`  ✗ ${r.name}`);
      console.log(`    ${r.error}`);
    });
  process.exit(1);
}

console.log('✓ All tests passed');
process.exit(0);
