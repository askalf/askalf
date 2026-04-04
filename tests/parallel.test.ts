import { describe, it, expect, vi } from 'vitest';
import { executeParallel } from '../apps/forge/src/orchestration/parallel.js';
import type { ParallelResult, NodeExecuteFn } from '../apps/forge/src/orchestration/parallel.js';

// Minimal WorkflowNode stubs (only id is used by executeParallel)
function makeNode(id: string) {
  return { id, type: 'agent' as const, config: {} };
}

describe('executeParallel', () => {
  it('runs all nodes and returns results on success', async () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const executeFn: NodeExecuteFn = vi.fn(async (node) => `result-${node.id}`);

    const result = await executeParallel(nodes, {}, executeFn);

    expect(result.allSucceeded).toBe(true);
    expect(result.results.size).toBe(3);
    expect(result.errors.size).toBe(0);
    expect(result.results.get('a')).toBe('result-a');
    expect(result.results.get('b')).toBe('result-b');
    expect(result.results.get('c')).toBe('result-c');
  });

  it('handles partial failures gracefully', async () => {
    const nodes = [makeNode('ok'), makeNode('fail')];
    const executeFn: NodeExecuteFn = async (node) => {
      if (node.id === 'fail') throw new Error('node failed');
      return 'ok-result';
    };

    const result = await executeParallel(nodes, {}, executeFn);

    expect(result.allSucceeded).toBe(false);
    expect(result.results.size).toBe(1);
    expect(result.results.get('ok')).toBe('ok-result');
    expect(result.errors.size).toBe(1);
    expect(result.errors.get('fail')).toBeInstanceOf(Error);
    expect(result.errors.get('fail')!.message).toBe('node failed');
  });

  it('handles all nodes failing', async () => {
    const nodes = [makeNode('x'), makeNode('y')];
    const executeFn: NodeExecuteFn = async () => { throw new Error('boom'); };

    const result = await executeParallel(nodes, {}, executeFn);

    expect(result.allSucceeded).toBe(false);
    expect(result.results.size).toBe(0);
    expect(result.errors.size).toBe(2);
  });

  it('handles empty node list', async () => {
    const result = await executeParallel([], {}, async () => null);

    expect(result.allSucceeded).toBe(true);
    expect(result.results.size).toBe(0);
    expect(result.errors.size).toBe(0);
  });

  it('passes context to executeFn', async () => {
    const nodes = [makeNode('n1')];
    const ctx = { key: 'value' };
    const executeFn: NodeExecuteFn = vi.fn(async (_node, context) => context);

    await executeParallel(nodes, ctx, executeFn);

    expect(executeFn).toHaveBeenCalledWith(nodes[0], ctx);
  });

  it('wraps non-Error rejections as Error instances', async () => {
    const nodes = [makeNode('str-throw')];
    const executeFn: NodeExecuteFn = async () => {
      throw 'string-error'; // eslint-disable-line no-throw-literal
    };

    const result = await executeParallel(nodes, {}, executeFn);

    expect(result.errors.get('str-throw')).toBeInstanceOf(Error);
    expect(result.errors.get('str-throw')!.message).toBe('string-error');
  });

  it('executes nodes concurrently', async () => {
    const nodes = [makeNode('s1'), makeNode('s2')];
    const started: string[] = [];
    const executeFn: NodeExecuteFn = async (node) => {
      started.push(node.id);
      await new Promise((r) => setTimeout(r, 10));
      return node.id;
    };

    await executeParallel(nodes, {}, executeFn);

    // Both should start before either finishes (concurrent execution)
    expect(started).toEqual(['s1', 's2']);
  });
});
