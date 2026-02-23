/**
 * Forge Unit Tests — Part 5
 *
 * Covers: orchestration/dag.ts → DAGEngine
 *   - validate()
 *   - getNextNodes()
 *   - topologicalSort()
 *   - isComplete()
 *   - getRootNodes()
 *   - getNode()
 *
 * Run with:
 *   tsx tests/unit5.ts
 */

import {
  DAGEngine,
  type WorkflowDefinition,
  type WorkflowNode,
  type NodeStates,
} from '../src/orchestration/dag.js';

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

function assertEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

function assertThrows(fn: () => unknown, msgSubstr: string): void {
  try {
    fn();
    throw new Error(`Expected throw with "${msgSubstr}" but did not throw`);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Expected throw')) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(msgSubstr)) {
      throw new Error(`Expected error containing "${msgSubstr}", got "${msg}"`);
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNode(id: string, type: WorkflowNode['type'] = 'agent'): WorkflowNode {
  return { id, type, config: {} };
}

function linearDag(...ids: string[]): WorkflowDefinition {
  const nodes = ids.map((id) => makeNode(id));
  const edges = ids.slice(0, -1).map((id, i) => ({ source: id, target: ids[i + 1] }));
  return { nodes, edges };
}

const engine = new DAGEngine();

// ─── validate() ──────────────────────────────────────────────────────────────

suite('DAGEngine.validate()');

await test('valid single node returns valid=true', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const result = engine.validate(def);
  assert(result.valid, 'should be valid');
  assertEqual(result.errors, [], 'no errors expected');
});

await test('valid linear 3-node DAG', () => {
  const result = engine.validate(linearDag('a', 'b', 'c'));
  assert(result.valid, 'should be valid');
  assertEqual(result.errors, [], 'no errors');
});

await test('empty nodes array returns error', () => {
  const def: WorkflowDefinition = { nodes: [], edges: [] };
  const result = engine.validate(def);
  assert(!result.valid, 'should be invalid');
  assert(result.errors.some((e) => e.includes('at least one node')), 'should mention at least one node');
});

await test('duplicate node IDs returns error', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('a')],
    edges: [],
  };
  const result = engine.validate(def);
  assert(!result.valid, 'should be invalid');
  assert(result.errors.some((e) => e.includes('Duplicate node ID: a')), 'should report duplicate');
});

await test('edge with non-existent source node returns error', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a')],
    edges: [{ source: 'z', target: 'a' }],
  };
  const result = engine.validate(def);
  assert(!result.valid, 'should be invalid');
  assert(result.errors.some((e) => e.includes('non-existent source node: z')), 'should name missing source');
});

await test('edge with non-existent target node returns error', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a')],
    edges: [{ source: 'a', target: 'z' }],
  };
  const result = engine.validate(def);
  assert(!result.valid, 'should be invalid');
  assert(result.errors.some((e) => e.includes('non-existent target node: z')), 'should name missing target');
});

await test('simple 2-node cycle returns error', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ],
  };
  const result = engine.validate(def);
  assert(!result.valid, 'cycle should be invalid');
  assert(result.errors.some((e) => e.toLowerCase().includes('cycle')), 'should mention cycle');
});

await test('3-node cycle detected', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' },
    ],
  };
  const result = engine.validate(def);
  assert(!result.valid, 'should be invalid');
  assert(result.errors.some((e) => e.toLowerCase().includes('cycle')), 'should mention cycle');
});

await test('self-loop is a cycle', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a')],
    edges: [{ source: 'a', target: 'a' }],
  };
  const result = engine.validate(def);
  assert(!result.valid, 'self-loop should be invalid');
});

await test('diamond DAG is valid (no cycle)', () => {
  // a -> b, a -> c, b -> d, c -> d
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ],
  };
  const result = engine.validate(def);
  assert(result.valid, 'diamond should be valid');
  assertEqual(result.errors, [], 'no errors');
});

await test('multiple errors collected (both dangling edges)', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a')],
    edges: [{ source: 'x', target: 'y' }],
  };
  const result = engine.validate(def);
  assert(!result.valid, 'should be invalid');
  assert(result.errors.length >= 2, 'should have at least 2 errors (source and target)');
});

// ─── getNextNodes() ───────────────────────────────────────────────────────────

suite('DAGEngine.getNextNodes()');

await test('returns all unconditional outgoing targets', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
  ];
  const states: NodeStates = {};
  const result = engine.getNextNodes('a', states, edges);
  assert(result.includes('b'), 'b should be next');
  assert(result.includes('c'), 'c should be next');
  assertEqual(result.length, 2, '2 results');
});

await test('skips already-running target', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const states: NodeStates = { b: { status: 'running' } };
  const result = engine.getNextNodes('a', states, edges);
  assertEqual(result, [], 'running node should not be re-queued');
});

await test('skips completed target', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const states: NodeStates = { b: { status: 'completed' } };
  const result = engine.getNextNodes('a', states, edges);
  assertEqual(result, [], 'completed node should not be re-queued');
});

await test('skips failed target', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const states: NodeStates = { b: { status: 'failed' } };
  const result = engine.getNextNodes('a', states, edges);
  assertEqual(result, [], 'failed node should not be re-queued');
});

await test('includes pending target', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const states: NodeStates = { b: { status: 'pending' } };
  const result = engine.getNextNodes('a', states, edges);
  assertEqual(result, ['b'], 'pending node should be included');
});

await test('includes target with no state entry', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const states: NodeStates = {};
  const result = engine.getNextNodes('a', states, edges);
  assertEqual(result, ['b'], 'unknown state treated as pending');
});

await test('conditional edge skipped without evaluateFn', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'x === 1' }];
  const states: NodeStates = {};
  const result = engine.getNextNodes('a', states, edges);
  assertEqual(result, [], 'conditional edge should be skipped without evaluator');
});

await test('conditional edge followed when evaluateFn returns true', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'go' }];
  const states: NodeStates = {};
  const ctx = { val: true };
  const result = engine.getNextNodes('a', states, edges, ctx, (_cond, _c) => true);
  assertEqual(result, ['b'], 'should follow edge when condition passes');
});

await test('conditional edge skipped when evaluateFn returns false', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'go' }];
  const states: NodeStates = {};
  const ctx = {};
  const result = engine.getNextNodes('a', states, edges, ctx, () => false);
  assertEqual(result, [], 'should skip edge when condition fails');
});

await test('conditional edge skipped when context missing even with evaluateFn', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'go' }];
  const states: NodeStates = {};
  const result = engine.getNextNodes('a', states, edges, undefined, () => true);
  assertEqual(result, [], 'no context → skip conditional edge');
});

await test('empty condition string treated as unconditional', () => {
  const edges = [{ source: 'a', target: 'b', condition: '' }];
  const states: NodeStates = {};
  const result = engine.getNextNodes('a', states, edges);
  assertEqual(result, ['b'], 'empty condition string is unconditional');
});

await test('returns empty for node with no outgoing edges', () => {
  const edges = [{ source: 'b', target: 'c' }];
  const states: NodeStates = {};
  const result = engine.getNextNodes('a', states, edges);
  assertEqual(result, [], 'no outgoing edges → empty result');
});

// ─── topologicalSort() ───────────────────────────────────────────────────────

suite('DAGEngine.topologicalSort()');

await test('single node returns [node]', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const result = engine.topologicalSort(def);
  assertEqual(result, ['a'], 'should return single node');
});

await test('linear chain returns nodes in order', () => {
  const def = linearDag('a', 'b', 'c');
  const result = engine.topologicalSort(def);
  assertEqual(result, ['a', 'b', 'c'], 'linear order');
});

await test('diamond DAG: root comes first, merge comes last', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ],
  };
  const result = engine.topologicalSort(def);
  assert(result[0] === 'a', 'a must be first');
  assert(result[result.length - 1] === 'd', 'd must be last');
  assert(result.includes('b') && result.includes('c'), 'b and c present');
  assertEqual(result.length, 4, '4 nodes');
});

await test('disconnected nodes all appear in output', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [],
  };
  const result = engine.topologicalSort(def);
  assertEqual(result.length, 2, 'both nodes in result');
  assert(result.includes('a') && result.includes('b'), 'a and b present');
});

await test('throws on cyclic graph', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ],
  };
  assertThrows(() => engine.topologicalSort(def), 'cycle');
});

await test('result length equals node count', () => {
  const def = linearDag('x', 'y', 'z', 'w');
  const result = engine.topologicalSort(def);
  assertEqual(result.length, 4, 'all 4 nodes in result');
});

// ─── isComplete() ─────────────────────────────────────────────────────────────

suite('DAGEngine.isComplete()');

await test('linear dag complete when terminal node is completed', () => {
  const def = linearDag('a', 'b', 'c');
  const states: NodeStates = { c: { status: 'completed' } };
  assert(engine.isComplete(def, states), 'should be complete');
});

await test('linear dag not complete when terminal is pending', () => {
  const def = linearDag('a', 'b', 'c');
  const states: NodeStates = { c: { status: 'pending' } };
  assert(!engine.isComplete(def, states), 'should not be complete');
});

await test('terminal node with failed status counts as complete', () => {
  const def = linearDag('a', 'b', 'c');
  const states: NodeStates = { c: { status: 'failed' } };
  assert(engine.isComplete(def, states), 'failed terminal = complete');
});

await test('terminal node with skipped status counts as complete', () => {
  const def = linearDag('a', 'b', 'c');
  const states: NodeStates = { c: { status: 'skipped' } };
  assert(engine.isComplete(def, states), 'skipped terminal = complete');
});

await test('multiple terminal nodes: all must be done', () => {
  // a -> b, a -> c (b and c are both terminals)
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
    ],
  };
  const states: NodeStates = { b: { status: 'completed' } };
  assert(!engine.isComplete(def, states), 'c is not done — not complete');
});

await test('multiple terminal nodes: all done returns complete', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
    ],
  };
  const states: NodeStates = {
    b: { status: 'completed' },
    c: { status: 'failed' },
  };
  assert(engine.isComplete(def, states), 'both terminals done');
});

await test('terminal with no state entry is not complete', () => {
  const def = linearDag('a', 'b');
  const states: NodeStates = {};
  assert(!engine.isComplete(def, states), 'undefined state is not done');
});

await test('single node no edges: complete when node done', () => {
  // No terminal nodes from edges perspective — falls through to "all nodes" check
  // Actually, with no edges, the single node has no outgoing AND no incoming, so it IS terminal
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const states: NodeStates = { a: { status: 'completed' } };
  assert(engine.isComplete(def, states), 'single done node is complete');
});

await test('single node no edges: not complete when pending', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const states: NodeStates = { a: { status: 'pending' } };
  assert(!engine.isComplete(def, states), 'pending single node not complete');
});

// ─── getRootNodes() ───────────────────────────────────────────────────────────

suite('DAGEngine.getRootNodes()');

await test('all nodes are roots when no edges', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [],
  };
  const roots = engine.getRootNodes(def);
  assert(roots.includes('a'), 'a is root');
  assert(roots.includes('b'), 'b is root');
  assertEqual(roots.length, 2, '2 roots');
});

await test('linear chain: only first node is root', () => {
  const def = linearDag('a', 'b', 'c');
  const roots = engine.getRootNodes(def);
  assertEqual(roots, ['a'], 'only a is root');
});

await test('diamond: only root node is root', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ],
  };
  const roots = engine.getRootNodes(def);
  assertEqual(roots, ['a'], 'only a is root');
});

await test('disconnected sub-graphs: both entry nodes are roots', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'c', target: 'd' },
    ],
  };
  const roots = engine.getRootNodes(def);
  assert(roots.includes('a'), 'a is root');
  assert(roots.includes('c'), 'c is root');
  assertEqual(roots.length, 2, '2 roots');
});

await test('single node no edges: that node is root', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('x')], edges: [] };
  const roots = engine.getRootNodes(def);
  assertEqual(roots, ['x'], 'single node is root');
});

// ─── getNode() ────────────────────────────────────────────────────────────────

suite('DAGEngine.getNode()');

await test('returns node when found', () => {
  const node = makeNode('abc', 'condition');
  const def: WorkflowDefinition = { nodes: [makeNode('x'), node], edges: [] };
  const result = engine.getNode(def, 'abc');
  assert(result !== undefined, 'should find node');
  assertEqual(result?.id, 'abc', 'correct id');
  assertEqual(result?.type, 'condition', 'correct type');
});

await test('returns undefined when not found', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const result = engine.getNode(def, 'z');
  assertEqual(result, undefined, 'should return undefined');
});

await test('returns first match among duplicates (raw find)', () => {
  // Edge case: if somehow two nodes share same id (won't pass validate, but getNode still works)
  const n1: WorkflowNode = { id: 'a', type: 'agent', config: { v: 1 } };
  const n2: WorkflowNode = { id: 'a', type: 'output', config: { v: 2 } };
  const def: WorkflowDefinition = { nodes: [n1, n2], edges: [] };
  const result = engine.getNode(def, 'a');
  assertEqual(result?.type, 'agent', 'first match returned');
});

await test('empty node list returns undefined', () => {
  const def: WorkflowDefinition = { nodes: [], edges: [] };
  const result = engine.getNode(def, 'a');
  assertEqual(result, undefined, 'empty list → undefined');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const total = results.length;

console.log(`\n${'─'.repeat(60)}`);
console.log(`DAGEngine tests: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);

if (failed > 0) {
  console.log('\nFailed tests:');
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  ✗ ${r.name}`);
    console.log(`      ${r.error}`);
  }
  process.exit(1);
}
