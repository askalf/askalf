/**
 * Forge Unit Tests — Part 2
 *
 * Covers modules not yet tested in unit.ts:
 *   - runtime/state-machine.ts (createStateMachine, AgentState, InvalidTransitionError)
 *   - orchestration/parallel.ts (executeParallel)
 *   - memory/episodic.ts (EpisodicMemory)
 *   - memory/working.ts (WorkingMemory — in-memory Redis stub)
 *
 * Run with:
 *   tsx tests/unit2.ts
 */

import {
  createStateMachine,
  AgentState,
  InvalidTransitionError,
} from '../src/runtime/state-machine.js';
import { executeParallel } from '../src/orchestration/parallel.js';
import type { WorkflowNode } from '../src/orchestration/dag.js';
import { EpisodicMemory } from '../src/memory/episodic.js';
import { WorkingMemory } from '../src/memory/working.js';

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNode(id: string): WorkflowNode {
  return { id, type: 'agent', config: {} };
}

/** Minimal in-memory Redis stub for WorkingMemory tests. */
function makeRedis(): { redis: unknown; store: Map<string, Map<string, string>> } {
  const store = new Map<string, Map<string, string>>();
  const redis = {
    async hset(key: string, field: string, value: string): Promise<void> {
      if (!store.has(key)) store.set(key, new Map());
      store.get(key)!.set(field, value);
    },
    async expire(): Promise<void> { /* no-op */ },
    async hget(key: string, field: string): Promise<string | null> {
      return store.get(key)?.get(field) ?? null;
    },
    async hgetall(key: string): Promise<Record<string, string>> {
      const m = store.get(key);
      if (!m) return {};
      return Object.fromEntries(m);
    },
    async hdel(key: string, field: string): Promise<void> {
      store.get(key)?.delete(field);
    },
    async del(key: string): Promise<void> {
      store.delete(key);
    },
  };
  return { redis, store };
}

console.log('\nForge Unit Tests — Part 2');

// ─── createStateMachine — basics ──────────────────────────────────────────────

suite('createStateMachine — basics');

await test('starts in IDLE state', () => {
  const sm = createStateMachine('exec-1');
  assert(sm.getState() === AgentState.IDLE, `Expected IDLE, got ${sm.getState()}`);
});

await test('executionId is preserved', () => {
  const sm = createStateMachine('my-exec-id');
  assert(sm.executionId === 'my-exec-id', 'executionId should match');
});

await test('getHistory is empty on creation', () => {
  const sm = createStateMachine('x');
  assert(sm.getHistory().length === 0, 'history should start empty');
});

await test('getElapsedMs returns a non-negative number', () => {
  const sm = createStateMachine('e');
  const elapsed = sm.getElapsedMs();
  assert(typeof elapsed === 'number' && elapsed >= 0, `elapsed should be ≥0, got ${elapsed}`);
});

await test('canTransition: IDLE→THINKING is valid', () => {
  const sm = createStateMachine('e');
  assert(sm.canTransition(AgentState.THINKING) === true, 'IDLE→THINKING should be valid');
});

await test('canTransition: IDLE→COMPLETED is invalid', () => {
  const sm = createStateMachine('e');
  assert(sm.canTransition(AgentState.COMPLETED) === false, 'IDLE→COMPLETED should be invalid');
});

await test('canTransition: IDLE→FAILED is invalid', () => {
  const sm = createStateMachine('e');
  assert(sm.canTransition(AgentState.FAILED) === false, 'IDLE→FAILED should be invalid');
});

await test('transition: IDLE→THINKING advances state', () => {
  const sm = createStateMachine('e');
  sm.transition(AgentState.THINKING);
  assert(sm.getState() === AgentState.THINKING, `Expected THINKING, got ${sm.getState()}`);
});

await test('transition: invalid path throws InvalidTransitionError', () => {
  const sm = createStateMachine('e');
  let threw = false;
  try {
    sm.transition(AgentState.COMPLETED); // IDLE→COMPLETED is invalid
  } catch (err) {
    threw = true;
    assert(err instanceof InvalidTransitionError, 'should be InvalidTransitionError');
    assert((err as InvalidTransitionError).from === AgentState.IDLE, 'from should be IDLE');
    assert((err as InvalidTransitionError).to === AgentState.COMPLETED, 'to should be COMPLETED');
  }
  assert(threw, 'should have thrown');
});

await test('InvalidTransitionError message contains from and to states', () => {
  const err = new InvalidTransitionError(AgentState.IDLE, AgentState.COMPLETED);
  assert(err.message.includes('idle'), 'message should include source state');
  assert(err.message.includes('completed'), 'message should include target state');
  assert(err.name === 'InvalidTransitionError', 'name should be set correctly');
});

suite('createStateMachine — history & events');

await test('transition records history entry', () => {
  const sm = createStateMachine('e');
  sm.transition(AgentState.THINKING);
  const h = sm.getHistory();
  assert(h.length === 1, 'history should have 1 entry');
  assert(h[0]!.from === AgentState.IDLE, 'from should be IDLE');
  assert(h[0]!.to === AgentState.THINKING, 'to should be THINKING');
  assert(typeof h[0]!.timestamp === 'number', 'timestamp should be a number');
});

await test('metadata is stored in transition record', () => {
  const sm = createStateMachine('e');
  sm.transition(AgentState.THINKING, { reason: 'test' });
  assert(sm.getHistory()[0]!.metadata?.['reason'] === 'test', 'metadata should be stored');
});

await test('multiple transitions build history in order', () => {
  const sm = createStateMachine('e');
  sm.transition(AgentState.THINKING);
  sm.transition(AgentState.TOOL_CALLING);
  sm.transition(AgentState.THINKING);
  const h = sm.getHistory();
  assert(h.length === 3, `Expected 3 history entries, got ${h.length}`);
  assert(h[0]!.to === AgentState.THINKING, '1st to=THINKING');
  assert(h[1]!.to === AgentState.TOOL_CALLING, '2nd to=TOOL_CALLING');
  assert(h[2]!.to === AgentState.THINKING, '3rd to=THINKING');
});

await test('onTransition handler fires with transition data', async () => {
  const sm = createStateMachine('e');
  const events: Array<{ from: string; to: string }> = [];
  sm.onTransition((t) => events.push({ from: t.from, to: t.to }));
  sm.transition(AgentState.THINKING);
  assert(events.length === 1, 'handler should fire once');
  assert(events[0]!.from === AgentState.IDLE && events[0]!.to === AgentState.THINKING, 'event data correct');
});

await test('unsubscribe removes handler', () => {
  const sm = createStateMachine('e');
  let fired = 0;
  const unsub = sm.onTransition(() => { fired++; });
  sm.transition(AgentState.THINKING);
  unsub();
  sm.transition(AgentState.TOOL_CALLING);
  assert(fired === 1, `handler should only fire once after unsub, got ${fired}`);
});

await test('listener errors are swallowed (state still advances)', () => {
  const sm = createStateMachine('e');
  sm.onTransition(() => { throw new Error('listener boom'); });
  // Should not throw
  sm.transition(AgentState.THINKING);
  assert(sm.getState() === AgentState.THINKING, 'state should advance despite listener error');
});

await test('multiple listeners all receive events', () => {
  const sm = createStateMachine('e');
  let a = 0, b = 0;
  sm.onTransition(() => { a++; });
  sm.onTransition(() => { b++; });
  sm.transition(AgentState.THINKING);
  assert(a === 1 && b === 1, 'both listeners should fire');
});

suite('createStateMachine — lifecycle paths');

await test('IDLE→THINKING→COMPLETED→IDLE full cycle', () => {
  const sm = createStateMachine('e');
  sm.transition(AgentState.THINKING);
  sm.transition(AgentState.COMPLETED);
  sm.transition(AgentState.IDLE);
  assert(sm.getState() === AgentState.IDLE, 'should be back at IDLE');
  assert(sm.getHistory().length === 3, 'should have 3 history entries');
});

await test('approval flow: TOOL_CALLING→WAITING_APPROVAL→TOOL_CALLING', () => {
  const sm = createStateMachine('e');
  sm.transition(AgentState.THINKING);
  sm.transition(AgentState.TOOL_CALLING);
  sm.transition(AgentState.WAITING_APPROVAL);
  sm.transition(AgentState.TOOL_CALLING); // approved
  assert(sm.getState() === AgentState.TOOL_CALLING, 'should be back in TOOL_CALLING');
});

await test('independent state machines do not share state', () => {
  const sm1 = createStateMachine('a');
  const sm2 = createStateMachine('b');
  sm1.transition(AgentState.THINKING);
  assert(sm2.getState() === AgentState.IDLE, 'sm2 should be unaffected by sm1');
});

// ─── executeParallel ──────────────────────────────────────────────────────────

suite('executeParallel — success paths');

await test('empty nodes → allSucceeded=true, empty maps', async () => {
  const r = await executeParallel([], {}, async () => null);
  assert(r.allSucceeded === true, 'allSucceeded should be true for empty');
  assert(r.results.size === 0, 'results should be empty');
  assert(r.errors.size === 0, 'errors should be empty');
});

await test('all succeed → results populated, allSucceeded=true', async () => {
  const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
  const r = await executeParallel(nodes, {}, async (node) => `output-${node.id}`);
  assert(r.allSucceeded === true, 'should all succeed');
  assert(r.results.size === 3, 'should have 3 results');
  assert(r.results.get('a') === 'output-a', 'result a should match');
  assert(r.results.get('b') === 'output-b', 'result b should match');
  assert(r.results.get('c') === 'output-c', 'result c should match');
  assert(r.errors.size === 0, 'no errors expected');
});

await test('context is passed to executeFn', async () => {
  const nodes = [makeNode('n')];
  let receivedCtx: Record<string, unknown> = {};
  await executeParallel(nodes, { key: 'val' }, async (_node, ctx) => {
    receivedCtx = ctx;
    return null;
  });
  assert(receivedCtx['key'] === 'val', 'context should be passed through');
});

suite('executeParallel — failure paths');

await test('one node fails → allSucceeded=false, partial results', async () => {
  const nodes = [makeNode('ok'), makeNode('bad')];
  const r = await executeParallel(nodes, {}, async (node) => {
    if (node.id === 'bad') throw new Error('node failed');
    return 'good';
  });
  assert(r.allSucceeded === false, 'should not all succeed');
  assert(r.results.size === 1 && r.results.get('ok') === 'good', 'ok result should be present');
  assert(r.errors.size === 1 && r.errors.has('bad'), 'bad error should be present');
  assert(r.errors.get('bad')!.message === 'node failed', 'error message should match');
});

await test('all nodes fail → allSucceeded=false, errors for all', async () => {
  const nodes = [makeNode('x'), makeNode('y')];
  const r = await executeParallel(nodes, {}, async (node) => {
    throw new Error(`fail-${node.id}`);
  });
  assert(r.allSucceeded === false, 'allSucceeded false');
  assert(r.results.size === 0, 'no results');
  assert(r.errors.size === 2, '2 errors');
  assert(r.errors.get('x')!.message === 'fail-x', 'x error message');
  assert(r.errors.get('y')!.message === 'fail-y', 'y error message');
});

await test('non-Error rejection is coerced to Error', async () => {
  const nodes = [makeNode('n')];
  const r = await executeParallel(nodes, {}, async () => {
    return Promise.reject('just a string rejection'); // eslint-disable-line prefer-promise-reject-errors
  });
  assert(r.errors.has('n'), 'n should have an error entry');
  assert(r.errors.get('n') instanceof Error, 'coerced to Error');
  assert(r.errors.get('n')!.message === 'just a string rejection', 'message preserved');
});

await test('node IDs correctly key the results', async () => {
  const nodes = [makeNode('alpha'), makeNode('beta')];
  const r = await executeParallel(nodes, {}, async (node) => node.id.toUpperCase());
  assert(r.results.get('alpha') === 'ALPHA', 'alpha key maps to ALPHA');
  assert(r.results.get('beta') === 'BETA', 'beta key maps to BETA');
});

// ─── EpisodicMemory ───────────────────────────────────────────────────────────

suite('EpisodicMemory.store()');

await test('returns a non-empty string ID', async () => {
  const em = new EpisodicMemory(async () => [], async () => null);
  const id = await em.store('a1', 'o1', 'situation', 'action', 'outcome', 0.8);
  assert(typeof id === 'string' && id.length > 0, 'should return string ID');
});

await test('calls INSERT with correct positional params', async () => {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const em = new EpisodicMemory(
    async (text, params) => { calls.push({ text, params: params ?? [] }); return []; },
    async () => null,
  );
  await em.store('agent1', 'owner1', 'sit', 'act', 'out', 0.5);
  assert(calls.length === 1, 'should call query once');
  assert(calls[0]!.text.includes('INSERT INTO forge_episodic_memories'), 'should INSERT');
  const p = calls[0]!.params;
  assert(p[1] === 'agent1', '$2 should be agentId');
  assert(p[2] === 'owner1', '$3 should be ownerId');
  assert(p[3] === 'sit', '$4 should be situation');
  assert(p[4] === 'act', '$5 should be action');
  assert(p[5] === 'out', '$6 should be outcome');
  assert(p[6] === 0.5, '$7 should be quality');
});

await test('embedding is null when not provided', async () => {
  const params: unknown[][] = [];
  const em = new EpisodicMemory(
    async (_, p) => { params.push(p ?? []); return []; },
    async () => null,
  );
  await em.store('a', 'o', 's', 'a', 'o', 0.5);
  assert(params[0]![7] === null, 'embedding param should be null when omitted');
});

await test('embedding is formatted as pgvector string when provided', async () => {
  const params: unknown[][] = [];
  const em = new EpisodicMemory(
    async (_, p) => { params.push(p ?? []); return []; },
    async () => null,
  );
  await em.store('a', 'o', 's', 'a', 'o', 0.5, [0.1, 0.2, 0.3]);
  assert(params[0]![7] === '[0.1,0.2,0.3]', `embedding should be [0.1,0.2,0.3], got ${params[0]![7]}`);
});

await test('executionId defaults to null when not provided', async () => {
  const params: unknown[][] = [];
  const em = new EpisodicMemory(
    async (_, p) => { params.push(p ?? []); return []; },
    async () => null,
  );
  await em.store('a', 'o', 's', 'a', 'o', 0.5);
  assert(params[0]![8] === null, 'executionId should default to null');
});

await test('executionId is passed when provided', async () => {
  const params: unknown[][] = [];
  const em = new EpisodicMemory(
    async (_, p) => { params.push(p ?? []); return []; },
    async () => null,
  );
  await em.store('a', 'o', 's', 'a', 'o', 0.5, undefined, 'exec-42');
  assert(params[0]![8] === 'exec-42', 'executionId should be passed');
});

await test('metadata is serialized to JSON string', async () => {
  const params: unknown[][] = [];
  const em = new EpisodicMemory(
    async (_, p) => { params.push(p ?? []); return []; },
    async () => null,
  );
  await em.store('a', 'o', 's', 'a', 'o', 0.5, undefined, undefined, { key: 'val' });
  assert(params[0]![9] === '{"key":"val"}', `metadata should be JSON, got ${params[0]![9]}`);
});

suite('EpisodicMemory.search()');

await test('passes formatted embedding as $1', async () => {
  const firstParams: unknown[] = [];
  const em = new EpisodicMemory(
    async (_, p) => { if (firstParams.length === 0) firstParams.push(...(p ?? [])); return []; },
    async () => null,
  );
  await em.search('agent1', [1, 2, 3], 5);
  assert(firstParams[0] === '[1,2,3]', `embedding param should be [1,2,3], got ${firstParams[0]}`);
});

await test('passes agentId as $2 in search', async () => {
  const firstParams: unknown[] = [];
  const em = new EpisodicMemory(
    async (_, p) => { if (firstParams.length === 0) firstParams.push(...(p ?? [])); return []; },
    async () => null,
  );
  await em.search('my-agent', [0.1], 10);
  assert(firstParams[1] === 'my-agent', `agentId should be param $2`);
});

suite('EpisodicMemory.searchFleet()');

await test('searchFleet SQL does not filter by agent_id', async () => {
  const sqlCalls: string[] = [];
  const em = new EpisodicMemory(
    async (text) => { sqlCalls.push(text); return []; },
    async () => null,
  );
  await em.searchFleet([0.1], 5);
  assert(!sqlCalls[0]!.includes('agent_id ='), 'should not have agent_id = filter');
});

suite('EpisodicMemory.delete()');

await test('returns true when a row is deleted', async () => {
  const em = new EpisodicMemory(async () => [{ id: 'ep1' }], async () => null);
  assert(await em.delete('ep1') === true, 'should return true');
});

await test('returns false when no row is deleted', async () => {
  const em = new EpisodicMemory(async () => [], async () => null);
  assert(await em.delete('ghost') === false, 'should return false');
});

await test('calls DELETE with the correct id param', async () => {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  const em = new EpisodicMemory(
    async (text, params) => { calls.push({ text, params: params ?? [] }); return [{ id: 'target' }]; },
    async () => null,
  );
  await em.delete('target');
  assert(calls[0]!.text.includes('DELETE FROM forge_episodic_memories'), 'should DELETE');
  assert(calls[0]!.params[0] === 'target', 'id param should match');
});

suite('EpisodicMemory.getById()');

await test('delegates to queryOne and returns the row', async () => {
  const fakeRow = { id: 'ep99', situation: 'test' };
  const em = new EpisodicMemory(async () => [], async () => fakeRow as never);
  const result = await em.getById('ep99');
  assert(result === fakeRow, 'should return fakeRow');
});

await test('returns null when queryOne returns null', async () => {
  const em = new EpisodicMemory(async () => [], async () => null);
  const result = await em.getById('missing');
  assert(result === null, 'should return null');
});

// ─── WorkingMemory ────────────────────────────────────────────────────────────

suite('WorkingMemory — key format & basic operations');

await test('set and get roundtrip works', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  await wm.set('agent1', 'sess1', 'myfield', 'myvalue');
  const got = await wm.get('agent1', 'sess1', 'myfield');
  assert(got === 'myvalue', `Expected 'myvalue', got '${got}'`);
});

await test('get returns null for missing field', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  const got = await wm.get('a', 's', 'nonexistent');
  assert(got === null, 'should return null for missing field');
});

await test('getAll returns all fields', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  await wm.set('a', 's', 'f1', 'v1');
  await wm.set('a', 's', 'f2', 'v2');
  const all = await wm.getAll('a', 's');
  assert(all['f1'] === 'v1' && all['f2'] === 'v2', 'getAll should return both fields');
});

await test('delete removes a specific field', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  await wm.set('a', 's', 'keep', 'yes');
  await wm.set('a', 's', 'remove', 'no');
  await wm.delete('a', 's', 'remove');
  assert(await wm.get('a', 's', 'keep') === 'yes', 'keep field should remain');
  assert(await wm.get('a', 's', 'remove') === null, 'remove field should be gone');
});

await test('clear removes the entire session', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  await wm.set('a', 's', 'f', 'v');
  await wm.clear('a', 's');
  const all = await wm.getAll('a', 's');
  assert(Object.keys(all).length === 0, 'all fields should be gone after clear');
});

await test('different sessions are isolated', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  await wm.set('agent', 'sess-a', 'field', 'value-a');
  await wm.set('agent', 'sess-b', 'field', 'value-b');
  assert(await wm.get('agent', 'sess-a', 'field') === 'value-a', 'sess-a isolated');
  assert(await wm.get('agent', 'sess-b', 'field') === 'value-b', 'sess-b isolated');
});

suite('WorkingMemory — message buffer');

await test('getMessages returns empty array when no messages stored', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  const msgs = await wm.getMessages('a', 's');
  assert(Array.isArray(msgs) && msgs.length === 0, 'should return empty array');
});

await test('addMessage stores a message with role, content, timestamp', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  await wm.addMessage('a', 's', 'user', 'hello');
  const msgs = await wm.getMessages('a', 's');
  assert(msgs.length === 1, 'should have 1 message');
  assert(msgs[0]!.role === 'user', 'role should be user');
  assert(msgs[0]!.content === 'hello', 'content should match');
  assert(typeof msgs[0]!.timestamp === 'string', 'timestamp should be a string');
});

await test('addMessage appends without overwriting', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  await wm.addMessage('a', 's', 'user', 'first');
  await wm.addMessage('a', 's', 'assistant', 'second');
  await wm.addMessage('a', 's', 'user', 'third');
  const msgs = await wm.getMessages('a', 's');
  assert(msgs.length === 3, `Expected 3 messages, got ${msgs.length}`);
  assert(msgs[0]!.content === 'first', '1st message');
  assert(msgs[1]!.content === 'second', '2nd message');
  assert(msgs[2]!.content === 'third', '3rd message');
});

await test('messages from different sessions are independent', async () => {
  const { redis } = makeRedis();
  const wm = new WorkingMemory(redis as never);
  await wm.addMessage('agent', 'sess-a', 'user', 'msg-a');
  await wm.addMessage('agent', 'sess-b', 'user', 'msg-b');
  const msgsA = await wm.getMessages('agent', 'sess-a');
  const msgsB = await wm.getMessages('agent', 'sess-b');
  assert(msgsA.length === 1 && msgsA[0]!.content === 'msg-a', 'sess-a has its own messages');
  assert(msgsB.length === 1 && msgsB[0]!.content === 'msg-b', 'sess-b has its own messages');
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
