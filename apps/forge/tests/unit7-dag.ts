/**
 * Forge Unit Tests — Part 7
 *
 * Covers DAGEngine from orchestration/dag.ts:
 *   - validate(): empty workflow, duplicate IDs, dangling edge refs, cycles, valid graphs
 *   - getNextNodes(): unconditional edges, conditional edges, already-running targets
 *   - topologicalSort(): linear, branching, multiple roots, cycle throws
 *   - isComplete(): terminal nodes, all nodes when no edges, in-progress states
 *   - getRootNodes(): single root, multiple roots, no-edge graph
 *   - getNode(): found, not found
 *
 * Run with:
 *   tsx tests/unit7-dag.ts
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

function assertDeepEqual<T>(actual: T, expected: T, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNode(id: string, type: WorkflowNode['type'] = 'agent'): WorkflowNode {
  return { id, type, config: {} };
}

function linearDef(...ids: string[]): WorkflowDefinition {
  const nodes = ids.map((id) => makeNode(id));
  const edges = ids.slice(0, -1).map((id, i) => ({ source: id, target: ids[i + 1] }));
  return { nodes, edges };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const engine = new DAGEngine();

console.log('DAGEngine unit tests\n');

// ─── validate() ──────────────────────────────────────────────────────────────

suite('validate()');

await test('rejects empty node list', () => {
  const result = engine.validate({ nodes: [], edges: [] });
  assert(!result.valid, 'should be invalid');
  assert(result.errors.some((e) => e.includes('at least one node')), 'should mention at least one node');
});

await test('accepts single node, no edges', () => {
  const result = engine.validate({ nodes: [makeNode('a')], edges: [] });
  assert(result.valid, `should be valid, got errors: ${result.errors.join(', ')}`);
  assertDeepEqual(result.errors, [], 'no errors');
});

await test('rejects duplicate node IDs', () => {
  const result = engine.validate({
    nodes: [makeNode('a'), makeNode('b'), makeNode('a')],
    edges: [],
  });
  assert(!result.valid, 'should be invalid');
  assert(result.errors.some((e) => e.includes('Duplicate node ID: a')), 'should report duplicate ID');
});

await test('rejects edge with non-existent source', () => {
  const result = engine.validate({
    nodes: [makeNode('a'), makeNode('b')],
    edges: [{ source: 'x', target: 'b' }],
  });
  assert(!result.valid, 'should be invalid');
  assert(result.errors.some((e) => e.includes('non-existent source node: x')), 'should report missing source');
});

await test('rejects edge with non-existent target', () => {
  const result = engine.validate({
    nodes: [makeNode('a'), makeNode('b')],
    edges: [{ source: 'a', target: 'z' }],
  });
  assert(!result.valid, 'should be invalid');
  assert(result.errors.some((e) => e.includes('non-existent target node: z')), 'should report missing target');
});

await test('rejects direct self-loop', () => {
  const result = engine.validate({
    nodes: [makeNode('a')],
    edges: [{ source: 'a', target: 'a' }],
  });
  assert(!result.valid, 'self-loop should be invalid');
  assert(result.errors.some((e) => e.toLowerCase().includes('cycle')), 'should report cycle');
});

await test('rejects two-node cycle', () => {
  const result = engine.validate({
    nodes: [makeNode('a'), makeNode('b')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ],
  });
  assert(!result.valid, 'two-node cycle should be invalid');
  assert(result.errors.some((e) => e.toLowerCase().includes('cycle')), 'should report cycle');
});

await test('rejects three-node cycle', () => {
  const result = engine.validate({
    nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' },
    ],
  });
  assert(!result.valid, 'three-node cycle should be invalid');
});

await test('accepts valid linear chain', () => {
  const result = engine.validate(linearDef('a', 'b', 'c'));
  assert(result.valid, `should be valid, errors: ${result.errors.join(', ')}`);
});

await test('accepts diamond DAG (branching + merging)', () => {
  // a → b, a → c, b → d, c → d
  const result = engine.validate({
    nodes: [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ],
  });
  assert(result.valid, `diamond should be valid, errors: ${result.errors.join(', ')}`);
});

await test('accumulates multiple errors in single pass', () => {
  const result = engine.validate({
    nodes: [makeNode('a'), makeNode('a')],
    edges: [{ source: 'x', target: 'y' }],
  });
  assert(!result.valid, 'should be invalid');
  // Duplicate ID + two dangling edge references
  assert(result.errors.length >= 3, `expected >=3 errors, got ${result.errors.length}`);
});

await test('cycle check is skipped when structural errors exist', () => {
  // With duplicate IDs the engine should NOT attempt cycle detection
  // (it short-circuits). Just verify it returns errors without throwing.
  const result = engine.validate({
    nodes: [makeNode('a'), makeNode('a')],
    edges: [],
  });
  assert(!result.valid, 'should be invalid');
});

// ─── getNextNodes() ───────────────────────────────────────────────────────────

suite('getNextNodes()');

await test('returns all pending targets for unconditional edges', () => {
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'a', target: 'c' },
  ];
  const nodeStates: NodeStates = {};
  const next = engine.getNextNodes('a', nodeStates, edges);
  assert(next.includes('b'), 'should include b');
  assert(next.includes('c'), 'should include c');
  assert(next.length === 2, 'should have exactly 2');
});

await test('skips targets that are already running', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const nodeStates: NodeStates = { b: { status: 'running' } };
  const next = engine.getNextNodes('a', nodeStates, edges);
  assert(next.length === 0, 'running target should be skipped');
});

await test('skips targets that are completed', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const nodeStates: NodeStates = { b: { status: 'completed' } };
  const next = engine.getNextNodes('a', nodeStates, edges);
  assert(next.length === 0, 'completed target should be skipped');
});

await test('skips targets that are failed', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const nodeStates: NodeStates = { b: { status: 'failed' } };
  const next = engine.getNextNodes('a', nodeStates, edges);
  assert(next.length === 0, 'failed target should be skipped');
});

await test('includes targets that are pending', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const nodeStates: NodeStates = { b: { status: 'pending' } };
  const next = engine.getNextNodes('a', nodeStates, edges);
  assert(next.includes('b'), 'pending target should be included');
});

await test('includes targets with no recorded state yet', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const nodeStates: NodeStates = {};
  const next = engine.getNextNodes('a', nodeStates, edges);
  assert(next.includes('b'), 'absent state should be treated as pending');
});

await test('evaluates conditional edge — condition true', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'flag' }];
  const nodeStates: NodeStates = {};
  const context = { flag: true };
  const evaluateFn = (cond: string, ctx: Record<string, unknown>) => Boolean(ctx[cond]);
  const next = engine.getNextNodes('a', nodeStates, edges, context, evaluateFn);
  assert(next.includes('b'), 'condition=true should include target');
});

await test('evaluates conditional edge — condition false', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'flag' }];
  const nodeStates: NodeStates = {};
  const context = { flag: false };
  const evaluateFn = (cond: string, ctx: Record<string, unknown>) => Boolean(ctx[cond]);
  const next = engine.getNextNodes('a', nodeStates, edges, context, evaluateFn);
  assert(!next.includes('b'), 'condition=false should exclude target');
  assert(next.length === 0, 'no targets should be returned');
});

await test('skips conditional edges when no evaluator provided', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'someCondition' }];
  const nodeStates: NodeStates = {};
  const next = engine.getNextNodes('a', nodeStates, edges);
  assert(next.length === 0, 'conditional edge without evaluator should be skipped');
});

await test('skips conditional edges when no context provided', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'x' }];
  const nodeStates: NodeStates = {};
  const evaluateFn = (_c: string, _ctx: Record<string, unknown>) => true;
  // evaluateFn provided but context omitted
  const next = engine.getNextNodes('a', nodeStates, edges, undefined, evaluateFn);
  assert(next.length === 0, 'conditional edge without context should be skipped');
});

await test('returns empty array when node has no outgoing edges', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const next = engine.getNextNodes('b', {}, edges);
  assert(next.length === 0, 'leaf node should have no next nodes');
});

await test('empty condition string treated as unconditional', () => {
  const edges = [{ source: 'a', target: 'b', condition: '' }];
  const next = engine.getNextNodes('a', {}, edges);
  assert(next.includes('b'), 'empty condition string should not gate the edge');
});

// ─── topologicalSort() ───────────────────────────────────────────────────────

suite('topologicalSort()');

await test('single node returns that node', () => {
  const sorted = engine.topologicalSort({ nodes: [makeNode('a')], edges: [] });
  assertDeepEqual(sorted, ['a'], 'single node sort');
});

await test('linear chain preserves order', () => {
  const sorted = engine.topologicalSort(linearDef('a', 'b', 'c'));
  assertDeepEqual(sorted, ['a', 'b', 'c'], 'linear order');
});

await test('diamond DAG: a comes first, d comes last', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ],
  };
  const sorted = engine.topologicalSort(def);
  assert(sorted[0] === 'a', 'a must come first');
  assert(sorted[sorted.length - 1] === 'd', 'd must come last');
  assert(sorted.length === 4, 'all 4 nodes in result');
});

await test('multiple independent roots both appear before their descendants', () => {
  // r1 → c, r2 → c
  const def: WorkflowDefinition = {
    nodes: [makeNode('r1'), makeNode('r2'), makeNode('c')],
    edges: [
      { source: 'r1', target: 'c' },
      { source: 'r2', target: 'c' },
    ],
  };
  const sorted = engine.topologicalSort(def);
  assert(sorted.length === 3, 'all nodes present');
  const idxC = sorted.indexOf('c');
  const idxR1 = sorted.indexOf('r1');
  const idxR2 = sorted.indexOf('r2');
  assert(idxR1 < idxC, 'r1 must precede c');
  assert(idxR2 < idxC, 'r2 must precede c');
});

await test('throws on cyclic graph', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ],
  };
  let threw = false;
  try {
    engine.topologicalSort(def);
  } catch (e) {
    threw = true;
    assert(e instanceof Error && e.message.includes('cycle'), 'error should mention cycle');
  }
  assert(threw, 'should have thrown for cyclic graph');
});

await test('result contains all nodes exactly once', () => {
  const def = linearDef('a', 'b', 'c', 'd', 'e');
  const sorted = engine.topologicalSort(def);
  assert(sorted.length === 5, 'all 5 nodes');
  assert(new Set(sorted).size === 5, 'no duplicates');
});

// ─── isComplete() ────────────────────────────────────────────────────────────

suite('isComplete()');

await test('returns false when terminal node is still pending', () => {
  const def = linearDef('a', 'b');
  const nodeStates: NodeStates = { a: { status: 'completed' }, b: { status: 'pending' } };
  assert(!engine.isComplete(def, nodeStates), 'pending terminal → not complete');
});

await test('returns false when terminal node has no recorded state', () => {
  const def = linearDef('a', 'b');
  const nodeStates: NodeStates = { a: { status: 'completed' } };
  assert(!engine.isComplete(def, nodeStates), 'absent state → not complete');
});

await test('returns true when terminal node is completed', () => {
  const def = linearDef('a', 'b');
  const nodeStates: NodeStates = { a: { status: 'completed' }, b: { status: 'completed' } };
  assert(engine.isComplete(def, nodeStates), 'completed terminal → complete');
});

await test('returns true when terminal node is failed', () => {
  const def = linearDef('a', 'b');
  const nodeStates: NodeStates = { a: { status: 'completed' }, b: { status: 'failed' } };
  assert(engine.isComplete(def, nodeStates), 'failed terminal → complete');
});

await test('returns true when terminal node is skipped', () => {
  const def = linearDef('a', 'b');
  const nodeStates: NodeStates = { a: { status: 'completed' }, b: { status: 'skipped' } };
  assert(engine.isComplete(def, nodeStates), 'skipped terminal → complete');
});

await test('diamond: complete when leaf is done', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ],
  };
  const nodeStates: NodeStates = {
    a: { status: 'completed' },
    b: { status: 'completed' },
    c: { status: 'completed' },
    d: { status: 'completed' },
  };
  assert(engine.isComplete(def, nodeStates), 'diamond complete');
});

await test('diamond: not complete when leaf is running', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c'), makeNode('d')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'a', target: 'c' },
      { source: 'b', target: 'd' },
      { source: 'c', target: 'd' },
    ],
  };
  const nodeStates: NodeStates = {
    a: { status: 'completed' },
    b: { status: 'completed' },
    c: { status: 'completed' },
    d: { status: 'running' },
  };
  assert(!engine.isComplete(def, nodeStates), 'running leaf → not complete');
});

await test('no-edge graph: complete when all nodes done', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [],
  };
  const nodeStates: NodeStates = { a: { status: 'completed' }, b: { status: 'completed' } };
  assert(engine.isComplete(def, nodeStates), 'no-edge graph all done → complete');
});

await test('no-edge graph: not complete when any node pending', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [],
  };
  const nodeStates: NodeStates = { a: { status: 'completed' }, b: { status: 'pending' } };
  assert(!engine.isComplete(def, nodeStates), 'no-edge graph with pending → not complete');
});

// ─── getRootNodes() ───────────────────────────────────────────────────────────

suite('getRootNodes()');

await test('single node graph has one root', () => {
  const roots = engine.getRootNodes({ nodes: [makeNode('a')], edges: [] });
  assertDeepEqual(roots, ['a'], 'single root');
});

await test('linear chain: only first node is root', () => {
  const roots = engine.getRootNodes(linearDef('a', 'b', 'c'));
  assertDeepEqual(roots, ['a'], 'single root in chain');
});

await test('two disconnected nodes are both roots', () => {
  const roots = engine.getRootNodes({
    nodes: [makeNode('a'), makeNode('b')],
    edges: [],
  });
  assert(roots.includes('a'), 'a is root');
  assert(roots.includes('b'), 'b is root');
  assert(roots.length === 2, 'exactly 2 roots');
});

await test('diamond: only source node is root', () => {
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
  assertDeepEqual(roots, ['a'], 'only a is root in diamond');
});

await test('two separate chains each have their own root', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('r1'), makeNode('n1'), makeNode('r2'), makeNode('n2')],
    edges: [
      { source: 'r1', target: 'n1' },
      { source: 'r2', target: 'n2' },
    ],
  };
  const roots = engine.getRootNodes(def);
  assert(roots.includes('r1'), 'r1 is root');
  assert(roots.includes('r2'), 'r2 is root');
  assert(roots.length === 2, 'exactly 2 roots');
});

// ─── getNode() ────────────────────────────────────────────────────────────────

suite('getNode()');

await test('returns node when found', () => {
  const def = linearDef('a', 'b', 'c');
  const node = engine.getNode(def, 'b');
  assert(node !== undefined, 'node should be found');
  assert(node?.id === 'b', 'should return correct node');
});

await test('returns undefined for missing node', () => {
  const def = linearDef('a', 'b');
  const node = engine.getNode(def, 'z');
  assert(node === undefined, 'missing node should return undefined');
});

await test('returns first node', () => {
  const def = linearDef('a', 'b', 'c');
  const node = engine.getNode(def, 'a');
  assert(node?.id === 'a', 'first node lookup');
});

await test('returns last node', () => {
  const def = linearDef('a', 'b', 'c');
  const node = engine.getNode(def, 'c');
  assert(node?.id === 'c', 'last node lookup');
});

await test('returned node has correct type and config', () => {
  const def: WorkflowDefinition = {
    nodes: [{ id: 'x', type: 'human_checkpoint', config: { prompt: 'approve?' } }],
    edges: [],
  };
  const node = engine.getNode(def, 'x');
  assert(node?.type === 'human_checkpoint', 'type preserved');
  assertDeepEqual(node?.config, { prompt: 'approve?' }, 'config preserved');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
const total = results.length;

console.log('\n' + '─'.repeat(60));
console.log(`  Results: ${passed}/${total} passed${failed > 0 ? `, ${failed} FAILED` : ''}`);
console.log('─'.repeat(60));

if (failed > 0) {
  console.log('\nFailed tests:');
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  ✗ ${r.name}`);
    console.log(`      ${r.error}`);
  }
  process.exit(1);
}
