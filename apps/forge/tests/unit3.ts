/**
 * Forge Unit Tests — Part 3
 *
 * Covers pure functions not yet tested in unit.ts / unit2.ts:
 *   - orchestration/task-decomposer.ts  → shouldDecompose()
 *   - orchestration/replanner.ts        → assessPlanHealth()
 *   - runtime/budget.ts                 → checkRuntimeBudget(), formatBudgetPromptHint()
 *
 * Run with:
 *   tsx tests/unit3.ts
 */

import { shouldDecompose } from '../src/orchestration/task-decomposer.js';
import { assessPlanHealth } from '../src/orchestration/replanner.js';
import type { CoordinationPlan, CoordinationTask } from '../src/runtime/fleet-coordinator.js';
import {
  checkRuntimeBudget,
  formatBudgetPromptHint,
  calculateRuntimeBudget,
} from '../src/runtime/budget.js';

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

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
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

function assertClose(actual: number, expected: number, tolerance: number, label: string): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(
      `Assertion failed: ${label} — got ${actual}, expected ${expected} ± ${tolerance}`,
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTask(
  id: string,
  status: CoordinationTask['status'],
  dependencies: string[] = [],
): CoordinationTask {
  return {
    id,
    title: `Task ${id}`,
    description: `Description for task ${id}`,
    assignedAgent: 'TestAgent',
    assignedAgentId: 'agent-001',
    dependencies,
    status,
  };
}

function makePlan(
  tasks: CoordinationTask[],
  status: CoordinationPlan['status'] = 'executing',
): CoordinationPlan {
  return {
    id: 'plan-001',
    title: 'Test Plan',
    pattern: 'pipeline',
    leadAgentId: 'lead-001',
    leadAgentName: 'Lead',
    tasks,
    status,
    createdAt: new Date().toISOString(),
  };
}

// ─── shouldDecompose ──────────────────────────────────────────────────────────

console.log('\nForge Unit Tests — Part 3');

suite('shouldDecompose');

await test('short task (< 100 chars) always returns false', () => {
  assert(shouldDecompose('Fix the login bug') === false, 'short task should not decompose');
  assert(shouldDecompose('') === false, 'empty string should not decompose');
  assert(shouldDecompose('a'.repeat(99)) === false, '99-char string should not decompose');
});

await test('long task (> 500 chars) always returns true', () => {
  assert(shouldDecompose('x '.repeat(251)) === true, '502-char string should always decompose');
  assert(shouldDecompose('a'.repeat(501)) === true, '501-char string should always decompose');
});

await test('medium task with no complexity indicators returns false', () => {
  const task = 'a'.repeat(200); // 200 chars, no indicators
  assert(shouldDecompose(task) === false, 'medium, no indicators → false');
});

await test('medium task with only one complexity indicator returns false', () => {
  // "multiple" is one indicator; need >= 2
  const task = 'Please check multiple files to ensure correctness. ' + 'a'.repeat(150);
  assert(shouldDecompose(task) === false, 'one indicator should not trigger decomposition');
});

await test('multiple "and" conjunctions trigger decomposition', () => {
  // "and ... and" plus another indicator needed; use "refactor" to reach 2 indicators
  const task =
    'Please refactor the module and also update tests and fix the build system. ' + 'a'.repeat(100);
  assert(shouldDecompose(task) === true, '"and…and" + "refactor" should trigger decompose');
});

await test('"then" keyword signals sequential steps', () => {
  // "then" + "migrate" = 2 indicators
  const task =
    'First migrate the database schema, then rebuild the indexes for consistency. ' + 'a'.repeat(80);
  assert(shouldDecompose(task) === true, '"then" + "migrate" should trigger decompose');
});

await test('"first…then" pattern triggers decomposition', () => {
  const task =
    'First implement the feature, then deploy it to production. ' + 'a'.repeat(100);
  assert(shouldDecompose(task) === true, '"first…then" + "implement" should trigger decompose');
});

await test('"multiple" + "refactor" triggers decomposition', () => {
  const task =
    'Refactor multiple components to improve performance and readability. ' + 'a'.repeat(80);
  assert(shouldDecompose(task) === true, '"multiple" + "refactor" should trigger decompose');
});

await test('"implement…system" pattern triggers decomposition', () => {
  const task =
    'Implement a new authentication system and migrate users. ' + 'a'.repeat(100);
  assert(shouldDecompose(task) === true, '"implement system" + "migrate" should trigger decompose');
});

await test('"build…and…deploy" pattern triggers decomposition', () => {
  const task =
    'Build the container image and deploy it to staging, then migrate the schema. ' + 'a'.repeat(80);
  assert(shouldDecompose(task) === true, '"build and deploy" + "migrate" should trigger decompose');
});

await test('exactly 100 chars with no indicators returns false', () => {
  // Boundary: length === 100 uses indicator check, not the < 100 short-circuit
  const task = 'a'.repeat(100);
  assert(shouldDecompose(task) === false, '100-char no-indicator task should not decompose');
});

// ─── assessPlanHealth ─────────────────────────────────────────────────────────

suite('assessPlanHealth');

await test('all tasks completed → completionRate 1, healthy, "All tasks completed"', () => {
  const plan = makePlan([
    makeTask('t1', 'completed'),
    makeTask('t2', 'completed'),
    makeTask('t3', 'completed'),
  ]);
  const h = assessPlanHealth(plan);
  assertClose(h.completionRate, 1, 0.001, 'completionRate');
  assertClose(h.failureRate, 0, 0.001, 'failureRate');
  assert(h.healthy === true, 'should be healthy');
  assert(h.stalled === false, 'should not be stalled');
  assert(h.recommendation === 'All tasks completed successfully', 'wrong recommendation');
});

await test('no tasks (empty plan) → completionRate 0, failureRate 0, not stalled', () => {
  const plan = makePlan([]);
  const h = assessPlanHealth(plan);
  assertClose(h.completionRate, 0, 0.001, 'completionRate');
  assertClose(h.failureRate, 0, 0.001, 'failureRate');
  assert(h.healthy === true, 'empty plan is healthy (no failures)');
  assert(h.stalled === false, 'empty plan is not stalled (no pending tasks)');
});

await test('executing plan with no running tasks but pending → stalled', () => {
  const plan = makePlan(
    [makeTask('t1', 'pending'), makeTask('t2', 'pending')],
    'executing',
  );
  const h = assessPlanHealth(plan);
  assert(h.stalled === true, 'pending tasks with no running → stalled');
  assert(h.recommendation.includes('stalled'), 'recommendation should mention stalled');
});

await test('pending tasks in non-executing plan → NOT stalled', () => {
  const plan = makePlan(
    [makeTask('t1', 'pending'), makeTask('t2', 'pending')],
    'planning',
  );
  const h = assessPlanHealth(plan);
  assert(h.stalled === false, 'non-executing status should not be stalled');
});

await test('> 50% failure rate → high failure recommendation', () => {
  const plan = makePlan([
    makeTask('t1', 'failed'),
    makeTask('t2', 'failed'),
    makeTask('t3', 'failed'),
    makeTask('t4', 'completed'),
  ]);
  const h = assessPlanHealth(plan);
  assert(h.failureRate > 0.5, 'failureRate should exceed 0.5');
  assert(h.healthy === false, 'should not be healthy');
  assert(h.recommendation.includes('High failure rate'), 'wrong recommendation');
});

await test('20-50% failure rate → elevated failures recommendation', () => {
  // 1 failed out of 4 = 25% failure rate (> 0.2 but ≤ 0.5)
  const plan = makePlan([
    makeTask('t1', 'failed'),
    makeTask('t2', 'completed'),
    makeTask('t3', 'completed'),
    makeTask('t4', 'completed'),
  ]);
  const h = assessPlanHealth(plan);
  assertClose(h.failureRate, 0.25, 0.001, 'failureRate');
  assert(h.recommendation.includes('Elevated failures'), 'wrong recommendation');
});

await test('< 20% failure rate → "On track" recommendation', () => {
  // 1 failed out of 6 ≈ 16.7%
  const plan = makePlan([
    makeTask('t1', 'failed'),
    makeTask('t2', 'completed'),
    makeTask('t3', 'completed'),
    makeTask('t4', 'running'),
    makeTask('t5', 'pending'),
    makeTask('t6', 'completed'),
  ]);
  const h = assessPlanHealth(plan);
  assert(h.recommendation === 'On track', `wrong recommendation: ${h.recommendation}`);
});

await test('failureRate >= 30% marks plan unhealthy', () => {
  // 3 failed out of 9 = 33.3%
  const plan = makePlan([
    makeTask('t1', 'failed'),
    makeTask('t2', 'failed'),
    makeTask('t3', 'failed'),
    makeTask('t4', 'completed'),
    makeTask('t5', 'completed'),
    makeTask('t6', 'completed'),
    makeTask('t7', 'completed'),
    makeTask('t8', 'completed'),
    makeTask('t9', 'completed'),
  ]);
  const h = assessPlanHealth(plan);
  assert(h.healthy === false, 'failureRate ≥ 0.3 should mark unhealthy');
});

await test('running task prevents stalled state', () => {
  const plan = makePlan([
    makeTask('t1', 'running'),
    makeTask('t2', 'pending'),
  ], 'executing');
  const h = assessPlanHealth(plan);
  assert(h.stalled === false, 'running task means not stalled');
});

// ─── checkRuntimeBudget ───────────────────────────────────────────────────────

suite('checkRuntimeBudget');

await test('elapsed < maxDuration → allowed = true', () => {
  const start = Date.now() - 1000; // 1 second ago
  const result = checkRuntimeBudget(start, 10_000); // 10s budget
  assert(result.allowed === true, 'should be allowed');
  assert(result.elapsedMs >= 1000, 'elapsed should be at least 1000ms');
  assert(result.remainingMs > 0, 'remaining should be positive');
});

await test('elapsed > maxDuration → allowed = false, remaining = 0', () => {
  const start = Date.now() - 20_000; // 20 seconds ago
  const result = checkRuntimeBudget(start, 10_000); // 10s budget
  assert(result.allowed === false, 'should not be allowed');
  assert(result.remainingMs === 0, 'remaining should clamp to 0');
  assert(result.usagePercent > 100, 'usage should exceed 100%');
});

await test('zero maxDurationMs → usagePercent = 0', () => {
  const result = checkRuntimeBudget(Date.now(), 0);
  assertClose(result.usagePercent, 0, 0.001, 'usagePercent with zero maxDuration');
  assert(result.remainingMs === 0, 'remaining should be 0');
});

await test('warning = true when usage exceeds 80% threshold', () => {
  const start = Date.now() - 9_000; // 9s elapsed
  const result = checkRuntimeBudget(start, 10_000, 0.8); // 10s budget, 80% warn
  // 9000/10000 = 90% ≥ 80% → warning
  assert(result.warning === true, 'should warn at 90% usage');
});

await test('warning = false when usage is below threshold', () => {
  const start = Date.now() - 1_000; // 1s elapsed
  const result = checkRuntimeBudget(start, 10_000, 0.8); // 10% usage
  assert(result.warning === false, 'should not warn at 10% usage');
});

await test('usagePercent scales proportionally', () => {
  const start = Date.now() - 5_000; // 5s elapsed
  const result = checkRuntimeBudget(start, 10_000); // 10s budget
  // 5000/10000 = 50% (±2% for execution time jitter)
  assertClose(result.usagePercent, 50, 2, 'usagePercent at half budget');
});

// ─── formatBudgetPromptHint ───────────────────────────────────────────────────

suite('formatBudgetPromptHint');

await test('scheduleIntervalMs <= 0 produces simple message', () => {
  const budget = calculateRuntimeBudget(null, 5 * 60 * 1000); // 5min fallback
  const hint = formatBudgetPromptHint(budget, 'TestAgent');
  assert(hint.includes('approximately'), 'should say "approximately"');
  assert(hint.includes('5 minutes'), 'should mention 5 minutes');
  assert(!hint.includes('scheduled every'), 'should not mention schedule interval');
});

await test('scheduleIntervalMs > 0 produces detailed message with agent name', () => {
  const budget = calculateRuntimeBudget(45, 0); // 45 min schedule → 27min budget
  const hint = formatBudgetPromptHint(budget, 'Nexus');
  assert(hint.includes('Nexus'), 'should include agent name');
  assert(hint.includes('45 minutes'), 'should mention schedule interval');
  assert(hint.includes('scheduled every'), 'should mention scheduled interval');
  assert(hint.includes('60%'), 'should mention 60% budget fraction');
});

await test('hint always starts and ends with newline (prompt injection boundary)', () => {
  const budget = calculateRuntimeBudget(30, 0);
  const hint = formatBudgetPromptHint(budget, 'Heartbeat');
  assert(hint.startsWith('\n'), 'hint should start with newline');
  assert(hint.endsWith('\n'), 'hint should end with newline');
});

await test('budget percent appears correctly in hint', () => {
  const budget = calculateRuntimeBudget(60, 0, 0.5); // 50% custom budget
  const hint = formatBudgetPromptHint(budget, 'Scout');
  assert(hint.includes('50%'), 'should show 50% when custom budgetPercent=0.5');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const total = results.length;

console.log(`\n  Results: ${passed}/${total} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\n  Failed tests:');
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`    ✗ ${r.name}`);
    console.log(`        ${r.error}`);
  }
  process.exit(1);
} else {
  console.log('\n  All tests passed.\n');
}
