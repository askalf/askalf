/**
 * Forge Unit Tests — Part 4
 *
 * Covers pure/in-memory modules not yet tested:
 *   - orchestration/dag.ts  → DAGEngine (validate, topologicalSort,
 *                              getNextNodes, isComplete, getRootNodes, getNode)
 *   - consciousness/affect.ts → updateFromSignals, decayTowardBaseline,
 *                               describeAffect, defaultAffect
 *
 * Run with:
 *   tsx tests/unit4.ts
 */

import { DAGEngine } from '../src/orchestration/dag.js';
import type { WorkflowDefinition, NodeStates } from '../src/orchestration/dag.js';
import {
  updateFromSignals,
  decayTowardBaseline,
  describeAffect,
  defaultAffect,
} from '../src/consciousness/affect.js';
import type { Affect, IntegrationSignals } from '../src/consciousness/affect.js';

// ─── Minimal test runner ────────────────────────────────────────────────────

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
    console.log(`    ✗ ${name} (${duration}ms)\n      ${error}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertApprox(actual: number, expected: number, tol: number, label: string): void {
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${label}: expected ~${expected} got ${actual} (tol ±${tol})`);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeNode(id: string) {
  return { id, type: 'agent' as const, config: {} };
}

function emptySignals(): IntegrationSignals {
  return {
    activeAgents: 0,
    pausedAgents: 0,
    errorAgents: 0,
    recentExecutions: 0,
    recentFailures: 0,
    recentSuccesses: 0,
    recentEvents: 0,
    goalsCompleted: 0,
    goalsProposed: 0,
    anomalyFindings: 0,
    criticalFindings: 0,
    positiveFeedback: 0,
    negativeFeedback: 0,
    predictionsViolated: 0,
    totalSurprise: 0,
    newKnowledge: 0,
  };
}

// ─── DAGEngine tests ─────────────────────────────────────────────────────────

console.log('\nDAGEngine + Affect Engine — Unit Tests');
console.log('=======================================');

const dag = new DAGEngine();

suite('DAGEngine.validate');

await test('accepts a single-node workflow', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const r = dag.validate(def);
  assert(r.valid, 'should be valid');
  assert(r.errors.length === 0, 'no errors');
});

await test('rejects empty node list', () => {
  const def: WorkflowDefinition = { nodes: [], edges: [] };
  const r = dag.validate(def);
  assert(!r.valid, 'should be invalid');
  assert(r.errors.some((e) => e.includes('at least one node')), 'mentions at least one node');
});

await test('rejects duplicate node IDs', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('a')],
    edges: [],
  };
  const r = dag.validate(def);
  assert(!r.valid, 'should be invalid');
  assert(r.errors.some((e) => e.includes('Duplicate node ID')), 'mentions duplicate');
});

await test('rejects edge with non-existent source', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a')],
    edges: [{ source: 'x', target: 'a' }],
  };
  const r = dag.validate(def);
  assert(!r.valid, 'should be invalid');
  assert(r.errors.some((e) => e.includes('source node')), 'mentions source node');
});

await test('rejects edge with non-existent target', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a')],
    edges: [{ source: 'a', target: 'z' }],
  };
  const r = dag.validate(def);
  assert(!r.valid, 'should be invalid');
  assert(r.errors.some((e) => e.includes('target node')), 'mentions target node');
});

await test('detects a cycle', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
    edges: [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'c' },
      { source: 'c', target: 'a' }, // cycle
    ],
  };
  const r = dag.validate(def);
  assert(!r.valid, 'should be invalid');
  assert(r.errors.some((e) => e.includes('cycle')), 'mentions cycle');
});

await test('accepts a valid linear chain', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
  };
  const r = dag.validate(def);
  assert(r.valid, 'should be valid');
});

await test('accepts a diamond (fan-out + merge)', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('start'), makeNode('left'), makeNode('right'), makeNode('end')],
    edges: [
      { source: 'start', target: 'left' },
      { source: 'start', target: 'right' },
      { source: 'left', target: 'end' },
      { source: 'right', target: 'end' },
    ],
  };
  const r = dag.validate(def);
  assert(r.valid, 'diamond should be valid');
});

suite('DAGEngine.topologicalSort');

await test('single node returns itself', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const order = dag.topologicalSort(def);
  assert(order.length === 1 && order[0] === 'a', 'just [a]');
});

await test('linear chain returns in order', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
  };
  const order = dag.topologicalSort(def);
  assert(order[0] === 'a', 'a is first');
  assert(order[order.length - 1] === 'c', 'c is last');
});

await test('diamond: start before end, both branches present', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('s'), makeNode('l'), makeNode('r'), makeNode('e')],
    edges: [
      { source: 's', target: 'l' },
      { source: 's', target: 'r' },
      { source: 'l', target: 'e' },
      { source: 'r', target: 'e' },
    ],
  };
  const order = dag.topologicalSort(def);
  assert(order[0] === 's', 's is first');
  assert(order[order.length - 1] === 'e', 'e is last');
  assert(order.includes('l') && order.includes('r'), 'both branches present');
});

await test('throws on cyclic graph', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }],
  };
  let threw = false;
  try { dag.topologicalSort(def); } catch { threw = true; }
  assert(threw, 'should throw on cycle');
});

suite('DAGEngine.getRootNodes');

await test('single node is the root', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  assert(dag.getRootNodes(def).includes('a'), 'a is root');
});

await test('only source nodes are roots in a chain', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b'), makeNode('c')],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }],
  };
  const roots = dag.getRootNodes(def);
  assert(roots.length === 1 && roots[0] === 'a', 'only a is root');
});

await test('diamond has one root', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('s'), makeNode('l'), makeNode('r'), makeNode('e')],
    edges: [
      { source: 's', target: 'l' },
      { source: 's', target: 'r' },
      { source: 'l', target: 'e' },
      { source: 'r', target: 'e' },
    ],
  };
  const roots = dag.getRootNodes(def);
  assert(roots.length === 1 && roots[0] === 's', 's is the only root');
});

await test('disconnected nodes are all roots', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [],
  };
  const roots = dag.getRootNodes(def);
  assert(roots.length === 2, 'both disconnected nodes are roots');
});

suite('DAGEngine.getNextNodes');

await test('returns target node when no condition', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const states: NodeStates = {};
  const next = dag.getNextNodes('a', states, edges);
  assert(next.includes('b'), 'b is next');
});

await test('skips already-running target', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const states: NodeStates = { b: { status: 'running' } };
  const next = dag.getNextNodes('a', states, edges);
  assert(!next.includes('b'), 'b should be skipped (running)');
});

await test('skips already-completed target', () => {
  const edges = [{ source: 'a', target: 'b' }];
  const states: NodeStates = { b: { status: 'completed' } };
  const next = dag.getNextNodes('a', states, edges);
  assert(!next.includes('b'), 'b should be skipped (completed)');
});

await test('conditional edge followed when evaluator returns true', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'ok' }];
  const states: NodeStates = {};
  const next = dag.getNextNodes('a', states, edges, {}, () => true);
  assert(next.includes('b'), 'b included when condition passes');
});

await test('conditional edge skipped when evaluator returns false', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'fail' }];
  const states: NodeStates = {};
  const next = dag.getNextNodes('a', states, edges, {}, () => false);
  assert(!next.includes('b'), 'b excluded when condition fails');
});

await test('conditional edge skipped when no evaluator provided', () => {
  const edges = [{ source: 'a', target: 'b', condition: 'something' }];
  const states: NodeStates = {};
  const next = dag.getNextNodes('a', states, edges);
  assert(!next.includes('b'), 'conditional edge needs evaluator');
});

suite('DAGEngine.isComplete');

await test('single terminal node completed → complete', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const states: NodeStates = { a: { status: 'completed' } };
  assert(dag.isComplete(def, states), 'complete');
});

await test('single terminal node pending → not complete', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const states: NodeStates = {};
  assert(!dag.isComplete(def, states), 'not complete');
});

await test('terminal node failed counts as complete', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const states: NodeStates = { a: { status: 'failed' } };
  assert(dag.isComplete(def, states), 'failed terminal = complete');
});

await test('terminal node skipped counts as complete', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  const states: NodeStates = { a: { status: 'skipped' } };
  assert(dag.isComplete(def, states), 'skipped terminal = complete');
});

await test('linear chain: only end node matters for completion', () => {
  const def: WorkflowDefinition = {
    nodes: [makeNode('a'), makeNode('b')],
    edges: [{ source: 'a', target: 'b' }],
  };
  // b is terminal; a is not
  const states: NodeStates = { a: { status: 'completed' }, b: { status: 'completed' } };
  assert(dag.isComplete(def, states), 'complete when terminal done');

  const partialStates: NodeStates = { a: { status: 'completed' } };
  assert(!dag.isComplete(def, partialStates), 'not complete when terminal pending');
});

suite('DAGEngine.getNode');

await test('returns node by ID', () => {
  const def: WorkflowDefinition = {
    nodes: [{ id: 'alpha', type: 'agent', config: { foo: 'bar' } }],
    edges: [],
  };
  const node = dag.getNode(def, 'alpha');
  assert(node !== undefined, 'found node');
  assert(node?.config['foo'] === 'bar', 'correct config');
});

await test('returns undefined for missing ID', () => {
  const def: WorkflowDefinition = { nodes: [makeNode('a')], edges: [] };
  assert(dag.getNode(def, 'nope') === undefined, 'undefined for missing');
});

// ─── Affect engine tests ─────────────────────────────────────────────────────

suite('defaultAffect');

await test('returns an Affect with expected initial values', () => {
  const a = defaultAffect();
  assert(a.curiosity === 0.5, `curiosity = 0.5, got ${a.curiosity}`);
  assert(a.engagement === 0.5, `engagement = 0.5, got ${a.engagement}`);
  assert(a.concern === 0, `concern = 0, got ${a.concern}`);
  assert(a.satisfaction === 0.3, `satisfaction = 0.3, got ${a.satisfaction}`);
  assert(a.uncertainty === 0.2, `uncertainty = 0.2, got ${a.uncertainty}`);
});

await test('each call returns a fresh object (no shared reference)', () => {
  const a1 = defaultAffect();
  const a2 = defaultAffect();
  a1.curiosity = 0.99;
  assert(a2.curiosity === 0.5, 'a2 not mutated by a1 change');
});

suite('updateFromSignals');

await test('no signals → concern decreases (no-issue path)', () => {
  const base = defaultAffect();
  const { affect } = updateFromSignals(base, emptySignals());
  assert(affect.concern < base.concern || affect.concern === 0, 'concern did not increase with zero signals');
});

await test('critical findings → concern increases', () => {
  const base: Affect = { curiosity: 0.5, concern: 0, engagement: 0.5, satisfaction: 0.3, uncertainty: 0.2 };
  const signals = { ...emptySignals(), criticalFindings: 2 };
  const { affect, deltas } = updateFromSignals(base, signals);
  assert(affect.concern > base.concern, `concern should rise, got ${affect.concern}`);
  assert(deltas.some((d) => d.variable === 'concern'), 'delta for concern');
});

await test('new knowledge → curiosity increases', () => {
  const base = defaultAffect();
  const signals = { ...emptySignals(), newKnowledge: 5 };
  const { affect } = updateFromSignals(base, signals);
  assert(affect.curiosity > base.curiosity, `curiosity should rise, got ${affect.curiosity}`);
});

await test('predictions violated with high surprise → uncertainty increases', () => {
  const base = defaultAffect();
  const signals = { ...emptySignals(), predictionsViolated: 3, totalSurprise: 0.8 };
  const { affect } = updateFromSignals(base, signals);
  assert(affect.uncertainty > base.uncertainty, `uncertainty should rise, got ${affect.uncertainty}`);
});

await test('stable predictions → uncertainty decreases', () => {
  const base: Affect = { curiosity: 0.5, concern: 0, engagement: 0.5, satisfaction: 0.3, uncertainty: 0.5 };
  const signals = { ...emptySignals(), predictionsViolated: 0, totalSurprise: 0 };
  const { affect } = updateFromSignals(base, signals);
  assert(affect.uncertainty <= base.uncertainty, `uncertainty should not grow, got ${affect.uncertainty}`);
});

await test('goals completed → satisfaction increases', () => {
  const base = defaultAffect();
  const signals = { ...emptySignals(), goalsCompleted: 3 };
  const { affect } = updateFromSignals(base, signals);
  assert(affect.satisfaction > base.satisfaction, `satisfaction should rise, got ${affect.satisfaction}`);
});

await test('negative feedback → satisfaction decreases', () => {
  const base: Affect = { curiosity: 0.5, concern: 0, engagement: 0.5, satisfaction: 0.8, uncertainty: 0.2 };
  const signals = { ...emptySignals(), negativeFeedback: 4 };
  const { affect } = updateFromSignals(base, signals);
  assert(affect.satisfaction < base.satisfaction, `satisfaction should drop, got ${affect.satisfaction}`);
});

await test('values are clamped to [0, 1]', () => {
  const base: Affect = { curiosity: 0.99, concern: 0.99, engagement: 0.99, satisfaction: 0.99, uncertainty: 0.99 };
  const signals = { ...emptySignals(), criticalFindings: 100, newKnowledge: 100, goalsCompleted: 100 };
  const { affect } = updateFromSignals(base, signals);
  for (const key of Object.keys(affect) as (keyof Affect)[]) {
    assert(affect[key] >= 0 && affect[key] <= 1, `${key} out of [0,1]: ${affect[key]}`);
  }
});

await test('returns a new object — original is not mutated', () => {
  const base = defaultAffect();
  const originalCuriosity = base.curiosity;
  const { affect } = updateFromSignals(base, { ...emptySignals(), newKnowledge: 10 });
  assert(base.curiosity === originalCuriosity, 'original not mutated');
  assert(affect !== base, 'different object returned');
});

suite('decayTowardBaseline');

await test('value above baseline decays toward it', () => {
  const elevated: Affect = { curiosity: 1.0, concern: 0.8, engagement: 1.0, satisfaction: 1.0, uncertainty: 1.0 };
  const decayed = decayTowardBaseline(elevated);
  assert(decayed.curiosity < 1.0, 'curiosity decayed');
  assert(decayed.concern < 0.8, 'concern decayed');
});

await test('value below baseline grows toward it', () => {
  const low: Affect = { curiosity: 0.0, concern: 0.0, engagement: 0.0, satisfaction: 0.0, uncertainty: 0.0 };
  const decayed = decayTowardBaseline(low);
  // curiosity baseline = 0.3, below 0 grows
  assert(decayed.curiosity > 0, 'curiosity grew toward baseline');
  // concern baseline = 0.0, already at baseline — should not change
  assert(decayed.concern === 0, 'concern stays at baseline');
});

await test('value at baseline stays there', () => {
  const atBaseline: Affect = { curiosity: 0.3, concern: 0.0, engagement: 0.3, satisfaction: 0.3, uncertainty: 0.2 };
  const decayed = decayTowardBaseline(atBaseline);
  for (const key of Object.keys(atBaseline) as (keyof Affect)[]) {
    assertApprox(decayed[key], atBaseline[key], 0.001, `${key} at baseline`);
  }
});

await test('does not overshoot baseline', () => {
  // One step above baseline with small gap
  const slightlyAbove: Affect = { curiosity: 0.305, concern: 0.0, engagement: 0.305, satisfaction: 0.305, uncertainty: 0.205 };
  const decayed = decayTowardBaseline(slightlyAbove);
  assert(decayed.curiosity >= 0.3, `curiosity did not undershoot baseline: ${decayed.curiosity}`);
  assert(decayed.engagement >= 0.3, `engagement did not undershoot baseline: ${decayed.engagement}`);
});

await test('returns a new object (original not mutated)', () => {
  const original: Affect = { curiosity: 1.0, concern: 0.5, engagement: 1.0, satisfaction: 1.0, uncertainty: 0.9 };
  const copy = { ...original };
  decayTowardBaseline(original);
  for (const key of Object.keys(original) as (keyof Affect)[]) {
    assert(original[key] === copy[key], `${key} mutated`);
  }
});

suite('describeAffect');

await test('returns a string with all 5 dimensions', () => {
  const a = defaultAffect();
  const desc = describeAffect(a);
  for (const key of ['Curiosity', 'Concern', 'Engagement', 'Satisfaction', 'Uncertainty']) {
    assert(desc.includes(key), `missing ${key} in description`);
  }
});

await test('0.8+ → very high', () => {
  const a: Affect = { curiosity: 0.9, concern: 0, engagement: 0.3, satisfaction: 0.3, uncertainty: 0.2 };
  assert(describeAffect(a).includes('very high'), 'very high for 0.9');
});

await test('0.6-0.79 → high', () => {
  const a: Affect = { curiosity: 0.7, concern: 0, engagement: 0.3, satisfaction: 0.3, uncertainty: 0.2 };
  const desc = describeAffect(a);
  assert(desc.split('\n')[0].includes('high') && !desc.split('\n')[0].includes('very high'), 'high for 0.7');
});

await test('below 0.2 → very low', () => {
  const a: Affect = { curiosity: 0.1, concern: 0, engagement: 0.3, satisfaction: 0.3, uncertainty: 0.2 };
  assert(describeAffect(a).includes('very low'), 'very low for 0.1');
});

await test('output contains one line per dimension', () => {
  const a = defaultAffect();
  const lines = describeAffect(a).split('\n').filter((l) => l.trim().length > 0);
  assert(lines.length === 5, `expected 5 lines, got ${lines.length}`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n─────────────────────────────────────────────');
const passed = results.filter((r) => r.passed).length;
const failed = results.filter((r) => !r.passed).length;
console.log(`  ${passed} passed, ${failed} failed (${results.length} total)`);

if (failed > 0) {
  console.log('\nFailed tests:');
  for (const r of results.filter((r) => !r.passed)) {
    console.log(`  ✗ ${r.name}`);
    if (r.error) console.log(`    ${r.error}`);
  }
  process.exit(1);
} else {
  console.log('  All tests passed!');
}
