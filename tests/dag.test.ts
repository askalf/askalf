/**
 * DAG Engine Unit Tests
 * Tests the pure-logic workflow DAG engine: validation, traversal,
 * topological sort, cycle detection, and completion checks.
 */
import { describe, it, expect } from 'vitest';
import { DAGEngine } from '../apps/forge/src/orchestration/dag.js';
import type { WorkflowDefinition, NodeStates } from '../apps/forge/src/orchestration/dag.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkNode(id: string, type: 'agent' | 'condition' | 'input' | 'output' | 'transform' = 'agent') {
  return { id, type, config: {} };
}

function mkEdge(source: string, target: string, condition?: string) {
  return { source, target, ...(condition ? { condition } : {}) };
}

function linearWorkflow(): WorkflowDefinition {
  return {
    nodes: [mkNode('A', 'input'), mkNode('B'), mkNode('C', 'output')],
    edges: [mkEdge('A', 'B'), mkEdge('B', 'C')],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DAGEngine', () => {
  const dag = new DAGEngine();

  // --- validate -----------------------------------------------------------

  describe('validate', () => {
    it('accepts a valid linear workflow', () => {
      const result = dag.validate(linearWorkflow());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects empty workflows', () => {
      const result = dag.validate({ nodes: [], edges: [] });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Workflow must contain at least one node');
    });

    it('rejects duplicate node IDs', () => {
      const result = dag.validate({
        nodes: [mkNode('A'), mkNode('A')],
        edges: [],
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duplicate node ID: A');
    });

    it('rejects edges referencing non-existent source', () => {
      const result = dag.validate({
        nodes: [mkNode('A')],
        edges: [mkEdge('X', 'A')],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/non-existent source.*X/);
    });

    it('rejects edges referencing non-existent target', () => {
      const result = dag.validate({
        nodes: [mkNode('A')],
        edges: [mkEdge('A', 'Z')],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/non-existent target.*Z/);
    });

    it('detects cycles', () => {
      const result = dag.validate({
        nodes: [mkNode('A'), mkNode('B'), mkNode('C')],
        edges: [mkEdge('A', 'B'), mkEdge('B', 'C'), mkEdge('C', 'A')],
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/cycle/i);
    });

    it('accepts a diamond DAG (no cycle)', () => {
      const result = dag.validate({
        nodes: [mkNode('A'), mkNode('B'), mkNode('C'), mkNode('D')],
        edges: [mkEdge('A', 'B'), mkEdge('A', 'C'), mkEdge('B', 'D'), mkEdge('C', 'D')],
      });
      expect(result.valid).toBe(true);
    });
  });

  // --- topologicalSort ----------------------------------------------------

  describe('topologicalSort', () => {
    it('returns correct order for linear workflow', () => {
      const sorted = dag.topologicalSort(linearWorkflow());
      expect(sorted).toEqual(['A', 'B', 'C']);
    });

    it('respects dependency ordering in diamond', () => {
      const sorted = dag.topologicalSort({
        nodes: [mkNode('A'), mkNode('B'), mkNode('C'), mkNode('D')],
        edges: [mkEdge('A', 'B'), mkEdge('A', 'C'), mkEdge('B', 'D'), mkEdge('C', 'D')],
      });
      expect(sorted[0]).toBe('A');
      expect(sorted[sorted.length - 1]).toBe('D');
      expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('B'));
      expect(sorted.indexOf('A')).toBeLessThan(sorted.indexOf('C'));
    });

    it('throws on cyclic graph', () => {
      expect(() =>
        dag.topologicalSort({
          nodes: [mkNode('A'), mkNode('B')],
          edges: [mkEdge('A', 'B'), mkEdge('B', 'A')],
        }),
      ).toThrow(/cycle/i);
    });

    it('handles single node', () => {
      expect(dag.topologicalSort({ nodes: [mkNode('X')], edges: [] })).toEqual(['X']);
    });
  });

  // --- getRootNodes -------------------------------------------------------

  describe('getRootNodes', () => {
    it('finds root of linear workflow', () => {
      expect(dag.getRootNodes(linearWorkflow())).toEqual(['A']);
    });

    it('finds multiple roots', () => {
      const roots = dag.getRootNodes({
        nodes: [mkNode('A'), mkNode('B'), mkNode('C')],
        edges: [mkEdge('A', 'C'), mkEdge('B', 'C')],
      });
      expect(roots).toContain('A');
      expect(roots).toContain('B');
      expect(roots).toHaveLength(2);
    });
  });

  // --- getNextNodes -------------------------------------------------------

  describe('getNextNodes', () => {
    it('returns immediate successors', () => {
      const states: NodeStates = {
        A: { status: 'completed' },
        B: { status: 'pending' },
        C: { status: 'pending' },
      };
      const next = dag.getNextNodes('A', states, linearWorkflow().edges);
      expect(next).toEqual(['B']);
    });

    it('skips already-completed successors', () => {
      const states: NodeStates = {
        A: { status: 'completed' },
        B: { status: 'completed' },
        C: { status: 'pending' },
      };
      const next = dag.getNextNodes('A', states, linearWorkflow().edges);
      expect(next).toEqual([]);
    });

    it('skips conditional edges without evaluator', () => {
      const edges = [mkEdge('A', 'B', 'x > 0'), mkEdge('A', 'C')];
      const states: NodeStates = {
        A: { status: 'completed' },
        B: { status: 'pending' },
        C: { status: 'pending' },
      };
      const next = dag.getNextNodes('A', states, edges);
      expect(next).toEqual(['C']);
    });

    it('evaluates conditional edges when evaluator provided', () => {
      const edges = [mkEdge('A', 'B', 'yes'), mkEdge('A', 'C', 'no')];
      const states: NodeStates = {
        A: { status: 'completed' },
        B: { status: 'pending' },
        C: { status: 'pending' },
      };
      const evalFn = (cond: string) => cond === 'yes';
      const next = dag.getNextNodes('A', states, edges, {}, evalFn);
      expect(next).toEqual(['B']);
    });
  });

  // --- isComplete ---------------------------------------------------------

  describe('isComplete', () => {
    it('returns true when all terminal nodes completed', () => {
      const states: NodeStates = {
        A: { status: 'completed' },
        B: { status: 'completed' },
        C: { status: 'completed' },
      };
      expect(dag.isComplete(linearWorkflow(), states)).toBe(true);
    });

    it('returns false when terminal node still pending', () => {
      const states: NodeStates = {
        A: { status: 'completed' },
        B: { status: 'completed' },
        C: { status: 'pending' },
      };
      expect(dag.isComplete(linearWorkflow(), states)).toBe(false);
    });

    it('treats failed terminal nodes as complete', () => {
      const states: NodeStates = {
        A: { status: 'completed' },
        B: { status: 'completed' },
        C: { status: 'failed', error: 'boom' },
      };
      expect(dag.isComplete(linearWorkflow(), states)).toBe(true);
    });
  });

  // --- getNode ------------------------------------------------------------

  describe('getNode', () => {
    it('finds existing node', () => {
      const node = dag.getNode(linearWorkflow(), 'B');
      expect(node).toBeDefined();
      expect(node!.id).toBe('B');
    });

    it('returns undefined for missing node', () => {
      expect(dag.getNode(linearWorkflow(), 'Z')).toBeUndefined();
    });
  });
});
