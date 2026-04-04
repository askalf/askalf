import { describe, it, expect, vi } from 'vitest';
import { executeParallel } from '../../apps/forge/src/orchestration/parallel.js';
import type { WorkflowNode } from '../../apps/forge/src/orchestration/dag.js';

function makeNode(id: string): WorkflowNode {
  return { id, type: 'agent', config: {} };
}

describe('executeParallel', () => {
  it('returns allSucceeded: true when all nodes succeed', async () => {
    const nodes = [makeNode('a'), makeNode('b'), makeNode('c')];
    const executeFn = vi.fn(async (node: WorkflowNode) => `result-${node.id}`);

    const result = await executeParallel(nodes, {}, executeFn);

    expect(result.allSucceeded).toBe(true);
    expect(result.errors.size).toBe(0);
    expect(result.results.size).toBe(3);
    expect(result.results.get('a')).toBe('result-a');
    expect(result.results.get('b')).toBe('result-b');
    expect(result.results.get('c')).toBe('result-c');
  });

  it('captures partial failures without aborting other nodes', async () => {
    const nodes = [makeNode('ok'), makeNode('fail')];
    const executeFn = vi.fn(async (node: WorkflowNode) => {
      if (node.id === 'fail') throw new Error('node failed');
      return 'ok-value';
    });

    const result = await executeParallel(nodes, {}, executeFn);

    expect(result.allSucceeded).toBe(false);
    expect(result.results.get('ok')).toBe('ok-value');
    expect(result.errors.has('fail')).toBe(true);
    expect(result.errors.get('fail')!.message).toBe('node failed');
  });

  it('handles all nodes failing', async () => {
    const nodes = [makeNode('a'), makeNode('b')];
    const executeFn = vi.fn(async () => {
      throw new Error('nope');
    });

    const result = await executeParallel(nodes, {}, executeFn);

    expect(result.allSucceeded).toBe(false);
    expect(result.results.size).toBe(0);
    expect(result.errors.size).toBe(2);
  });

  it('returns empty results for empty nodes array', async () => {
    const executeFn = vi.fn();
    const result = await executeParallel([], {}, executeFn);

    expect(result.allSucceeded).toBe(true);
    expect(result.results.size).toBe(0);
    expect(result.errors.size).toBe(0);
    expect(executeFn).not.toHaveBeenCalled();
  });

  it('wraps non-Error rejections in Error objects', async () => {
    const nodes = [makeNode('a')];
    const executeFn = vi.fn(async () => {
      throw 'string-error'; // eslint-disable-line no-throw-literal
    });

    const result = await executeParallel(nodes, {}, executeFn);

    expect(result.errors.get('a')).toBeInstanceOf(Error);
    expect(result.errors.get('a')!.message).toBe('string-error');
  });

  it('passes context to execute function', async () => {
    const nodes = [makeNode('a')];
    const ctx = { key: 'value' };
    const executeFn = vi.fn(async (_node: WorkflowNode, context: Record<string, unknown>) => context);

    const result = await executeParallel(nodes, ctx, executeFn);

    expect(executeFn).toHaveBeenCalledWith(nodes[0], ctx);
    expect(result.results.get('a')).toEqual({ key: 'value' });
  });
});
