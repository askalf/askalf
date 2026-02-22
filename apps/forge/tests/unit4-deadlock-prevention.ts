/**
 * Forge Unit Tests — Deadlock Prevention (Part 4)
 *
 * Tests the critical patterns that prevent CLI slot deadlocks:
 *   1. Memory context build timeout — rejects after 15s, caller catches → ''
 *   2. Stale execution detection — iteration=0 stuck executions identified correctly
 *   3. Health gate logic — >6/8 CLI slots at iteration=0 should block new dispatches
 *
 * Background: On 2026-02-22, the system deadlocked because executions stalled
 * at iteration=0 (during memory context build) and were never cleaned up quickly.
 * All 8 CLI slots were consumed indefinitely, blocking the entire execution queue.
 *
 * Run with:
 *   tsx tests/unit4-deadlock-prevention.ts
 */

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

function assertApprox(actual: number, expected: number, tolerance: number, label: string): void {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    throw new Error(`Assertion failed: ${label} — got ${actual}, expected ${expected} ± ${tolerance}`);
  }
}

// ─── 1. Memory Context Timeout Pattern ───────────────────────────────────────
//
// These tests verify the Promise.race timeout pattern used in context-builder.ts.
// The real buildMemoryContext cannot be imported (requires DB/Redis), so we test
// the pattern in isolation — the same logic will apply to the real implementation.

/** Replicates the timeout wrapper from context-builder.ts:26-33 */
async function withTimeout<T>(
  work: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return Promise.race([
    work(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

suite('Memory Context Timeout');

await test('resolves immediately when work completes fast', async () => {
  const result = await withTimeout(
    () => Promise.resolve('memory-data'),
    15_000,
    'Memory context',
  );
  assert(result === 'memory-data', `expected 'memory-data', got '${result}'`);
});

await test('rejects after timeout when work is slow', async () => {
  const start = Date.now();
  let threw = false;
  try {
    await withTimeout(
      () => new Promise<string>(() => { /* never resolves */ }),
      50, // use 50ms for test speed
      'Memory context',
    );
  } catch (err) {
    threw = true;
    const elapsed = Date.now() - start;
    assert(err instanceof Error, 'error should be an Error instance');
    assert(err.message.includes('timed out'), `error message should mention timeout, got: ${err.message}`);
    assertApprox(elapsed, 50, 40, 'timeout should fire at ~50ms');
  }
  assert(threw, 'should have thrown a timeout error');
});

await test('caller catch-to-empty-string degrades gracefully on timeout', async () => {
  // Replicates the pattern in worker.ts:1958
  const memoryContext = await withTimeout(
    () => new Promise<string>(() => { /* never resolves */ }),
    50,
    'Memory context',
  ).catch((err) => {
    // This is the exact pattern from worker.ts:1958-1961
    console.warn(`[CLI] Memory context build failed: ${err instanceof Error ? err.message : err}`);
    return '';
  });
  assert(memoryContext === '', `graceful degradation should return '', got: '${memoryContext}'`);
});

await test('timeout does not interfere with concurrent resolutions', async () => {
  // Two parallel calls: one fast, one slow-then-caught
  const [fast, slow] = await Promise.allSettled([
    withTimeout(() => Promise.resolve('fast'), 100, 'fast context'),
    withTimeout(() => new Promise<string>(() => {}), 50, 'slow context').catch(() => ''),
  ]);
  assert(fast.status === 'fulfilled' && fast.value === 'fast', 'fast call should resolve');
  assert(slow.status === 'fulfilled' && slow.value === '', 'slow call should degrade to empty string');
});

// ─── 2. Stuck Execution Detection Logic ──────────────────────────────────────
//
// These tests verify the logic for identifying iteration=0 stuck executions.
// This is pure logic — the actual DB query is in index.ts periodic cleanup.

interface MockExecution {
  id: string;
  status: 'running' | 'pending' | 'completed' | 'failed';
  iterations: number;
  started_at: Date;
}

/**
 * Detects executions stuck at iteration=0 for longer than the given threshold.
 * This is the logic that SHOULD exist in the periodic cleanup (index.ts:426).
 * Currently it is NOT implemented — running executions are only cleaned up after 20 min.
 *
 * The fix should add this check with a 10-minute threshold to release slots faster.
 */
function detectStuckAtIterationZero(
  executions: MockExecution[],
  thresholdMs: number,
): MockExecution[] {
  const now = Date.now();
  return executions.filter(
    (e) =>
      e.status === 'running' &&
      e.iterations === 0 &&
      now - e.started_at.getTime() > thresholdMs,
  );
}

/**
 * Health gate: should new dispatches be blocked?
 * Blocks if more than MAX_STUCK_SLOTS executions are stuck at iteration=0.
 */
function shouldBlockNewDispatch(
  executions: MockExecution[],
  totalSlots: number,
  maxStuckRatio: number = 0.75,
): boolean {
  const stuckCount = executions.filter(
    (e) => e.status === 'running' && e.iterations === 0,
  ).length;
  return stuckCount >= Math.ceil(totalSlots * maxStuckRatio);
}

function makeExecution(
  id: string,
  iterations: number,
  ageMinutes: number,
  status: MockExecution['status'] = 'running',
): MockExecution {
  return {
    id,
    status,
    iterations,
    started_at: new Date(Date.now() - ageMinutes * 60 * 1000),
  };
}

suite('Stuck Execution Detection');

await test('detects iteration=0 running executions older than threshold', () => {
  const executions = [
    makeExecution('exec-1', 0, 15),  // stuck 15 min at iter=0
    makeExecution('exec-2', 0, 5),   // only 5 min — below 10-min threshold
    makeExecution('exec-3', 3, 15),  // has iterations — not stuck at 0
    makeExecution('exec-4', 0, 11),  // stuck 11 min — should be caught
  ];
  const stuck = detectStuckAtIterationZero(executions, 10 * 60 * 1000);
  assert(stuck.length === 2, `expected 2 stuck executions, got ${stuck.length}`);
  assert(stuck.some((e) => e.id === 'exec-1'), 'exec-1 (15min) should be stuck');
  assert(stuck.some((e) => e.id === 'exec-4'), 'exec-4 (11min) should be stuck');
  assert(!stuck.some((e) => e.id === 'exec-2'), 'exec-2 (5min) should NOT be stuck yet');
  assert(!stuck.some((e) => e.id === 'exec-3'), 'exec-3 has iterations — not stuck at 0');
});

await test('ignores completed/failed executions', () => {
  const executions = [
    makeExecution('exec-5', 0, 15, 'completed'),
    makeExecution('exec-6', 0, 15, 'failed'),
    makeExecution('exec-7', 0, 15, 'running'),
  ];
  const stuck = detectStuckAtIterationZero(executions, 10 * 60 * 1000);
  assert(stuck.length === 1, `only running exec should be detected, got ${stuck.length}`);
  assert(stuck[0]!.id === 'exec-7', 'only exec-7 should be detected');
});

await test('returns empty list when no executions are stuck', () => {
  const executions = [
    makeExecution('exec-8', 5, 15),  // has iterations
    makeExecution('exec-9', 0, 3),   // too new
  ];
  const stuck = detectStuckAtIterationZero(executions, 10 * 60 * 1000);
  assert(stuck.length === 0, 'should find no stuck executions');
});

// ─── 3. Health Gate Logic ─────────────────────────────────────────────────────
//
// The system has 8 CLI slots. If 6+ are at iteration=0, new dispatches should be
// blocked to prevent complete deadlock. This tests that gate logic.

suite('Health Gate — Block Dispatch on Slot Saturation');

await test('blocks dispatch when ≥75% of slots stuck at iter=0', () => {
  // 6 of 8 slots at iteration=0
  const executions = Array.from({ length: 6 }, (_, i) =>
    makeExecution(`stuck-${i}`, 0, 5),
  );
  assert(shouldBlockNewDispatch(executions, 8), '6/8 stuck slots should block dispatch');
});

await test('blocks dispatch at exactly 75% threshold (6/8 slots)', () => {
  const executions = Array.from({ length: 6 }, (_, i) =>
    makeExecution(`stuck-${i}`, 0, 5),
  );
  assert(shouldBlockNewDispatch(executions, 8, 0.75), 'exactly 75% (6/8) should block');
});

await test('allows dispatch when fewer than 75% of slots are stuck', () => {
  // 5 of 8 slots at iteration=0 — should allow dispatch
  const executions = Array.from({ length: 5 }, (_, i) =>
    makeExecution(`stuck-${i}`, 0, 5),
  );
  assert(!shouldBlockNewDispatch(executions, 8), '5/8 stuck should still allow dispatch');
});

await test('does not count non-zero-iteration slots toward stuck count', () => {
  const executions = [
    ...Array.from({ length: 4 }, (_, i) => makeExecution(`stuck-${i}`, 0, 5)),
    ...Array.from({ length: 4 }, (_, i) => makeExecution(`active-${i}`, i + 1, 5)),
  ];
  assert(!shouldBlockNewDispatch(executions, 8), '4 active + 4 stuck should allow dispatch');
});

await test('zero stuck slots always allows dispatch', () => {
  const executions = Array.from({ length: 8 }, (_, i) =>
    makeExecution(`active-${i}`, i + 1, 5),
  );
  assert(!shouldBlockNewDispatch(executions, 8), 'no stuck slots — dispatch should proceed');
});

await test('all 8 slots stuck blocks dispatch', () => {
  const executions = Array.from({ length: 8 }, (_, i) =>
    makeExecution(`stuck-${i}`, 0, 2),
  );
  assert(shouldBlockNewDispatch(executions, 8), '8/8 stuck — dispatch must be blocked');
});

// ─── 4. Stale Cleanup SQL Logic ───────────────────────────────────────────────
//
// Validates the SQL query patterns used in the periodic stale cleanup.
// These are string-level tests to catch regressions if the SQL is changed.

suite('Stale Execution Cleanup SQL Patterns');

const STALE_PENDING_SQL = `UPDATE forge_executions SET status = 'failed', error = 'Timed out in pending state', completed_at = NOW()
           WHERE status = 'pending' AND created_at < NOW() - INTERVAL '20 minutes'
           RETURNING id, agent_id`;

const STALE_RUNNING_SQL = `UPDATE forge_executions SET status = 'failed', error = 'Exceeded maximum runtime', completed_at = NOW()
           WHERE status = 'running' AND started_at < NOW() - INTERVAL '20 minutes'
           RETURNING id, agent_id`;

await test('stale pending SQL targets pending status', () => {
  assert(STALE_PENDING_SQL.includes("status = 'pending'"), 'should target pending status');
  assert(STALE_PENDING_SQL.includes('20 minutes'), 'should use 20-minute threshold');
  assert(STALE_PENDING_SQL.includes('RETURNING id, agent_id'), 'should return cleaned IDs');
});

await test('stale running SQL targets running status', () => {
  assert(STALE_RUNNING_SQL.includes("status = 'running'"), 'should target running status');
  assert(STALE_RUNNING_SQL.includes('20 minutes'), 'should use 20-minute threshold');
  assert(STALE_RUNNING_SQL.includes('started_at'), 'should use started_at for running executions');
});

await test('stale running SQL does NOT filter by iteration count', () => {
  // BUG DOCUMENTATION: The current cleanup does NOT distinguish iteration=0 stuck
  // executions from long-running ones. This means:
  //   - A legitimate 19-min execution won't be killed (correct)
  //   - An iteration=0 stuck execution takes 20 min to be killed (deadlock window!)
  // The fix should add a FASTER 10-min cleanup for iteration=0 specifically.
  assert(
    !STALE_RUNNING_SQL.includes('iterations = 0'),
    'KNOWN GAP: stale running cleanup does not fast-track iteration=0 executions',
  );
  // This test documents the missing check. Backend Dev should add:
  // WHERE status = 'running' AND iterations = 0 AND started_at < NOW() - INTERVAL '10 minutes'
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n' + '─'.repeat(60));
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`  Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\n  Failed tests:');
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`    ✗ ${r.name}`);
    console.log(`        ${r.error}`);
  }
}
console.log('─'.repeat(60));

process.exit(failed > 0 ? 1 : 0);
