/**
 * DAG Workflow Engine
 * Validates, traverses, and manages directed acyclic graph workflows.
 * Provides cycle detection, topological sorting, and execution state tracking.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkflowNodeType =
  | 'agent'
  | 'condition'
  | 'parallel'
  | 'merge'
  | 'human_checkpoint'
  | 'input'
  | 'output'
  | 'transform';

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  config: Record<string, unknown>;
}

export interface WorkflowEdge {
  source: string;
  target: string;
  condition?: string;
}

export interface WorkflowDefinition {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export type NodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface NodeState {
  status: NodeStatus;
  output?: unknown | undefined;
  error?: string | undefined;
  startedAt?: string | undefined;
  completedAt?: string | undefined;
}

export type NodeStates = Record<string, NodeState>;

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ---------------------------------------------------------------------------
// DAGEngine
// ---------------------------------------------------------------------------

export class DAGEngine {
  /**
   * Validate a workflow definition.
   * Checks for: cycles, dangling edge references, at least one node,
   * duplicate node IDs, and that every edge references existing nodes.
   */
  validate(definition: WorkflowDefinition): ValidationResult {
    const errors: string[] = [];

    // Must have at least one node
    if (definition.nodes.length === 0) {
      errors.push('Workflow must contain at least one node');
    }

    // Check for duplicate node IDs
    const nodeIds = new Set<string>();
    for (const node of definition.nodes) {
      if (nodeIds.has(node.id)) {
        errors.push(`Duplicate node ID: ${node.id}`);
      }
      nodeIds.add(node.id);
    }

    // Validate edge references
    for (const edge of definition.edges) {
      if (!nodeIds.has(edge.source)) {
        errors.push(`Edge references non-existent source node: ${edge.source}`);
      }
      if (!nodeIds.has(edge.target)) {
        errors.push(`Edge references non-existent target node: ${edge.target}`);
      }
    }

    // Cycle detection via DFS
    if (errors.length === 0) {
      const cycleError = this.detectCycle(definition);
      if (cycleError) {
        errors.push(cycleError);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Determine the next nodes to execute given the current node, overall
   * node states, and the edge list. For condition nodes the `evaluateFn`
   * callback is invoked to decide which outgoing edge to follow.
   *
   * Returns an array of node IDs that are ready to execute.
   */
  getNextNodes(
    currentNodeId: string,
    nodeStates: NodeStates,
    edges: WorkflowEdge[],
    context?: Record<string, unknown>,
    evaluateFn?: (condition: string, ctx: Record<string, unknown>) => boolean,
  ): string[] {
    const outgoing = edges.filter((e) => e.source === currentNodeId);
    const next: string[] = [];

    for (const edge of outgoing) {
      // If the edge has a condition, evaluate it
      if (edge.condition !== undefined && edge.condition !== '') {
        if (evaluateFn && context) {
          if (!evaluateFn(edge.condition, context)) {
            continue; // condition not met – skip this edge
          }
        } else {
          // No evaluator provided – skip conditional edges
          continue;
        }
      }

      const targetState = nodeStates[edge.target];
      // Only enqueue if the target has not yet started
      if (!targetState || targetState.status === 'pending') {
        next.push(edge.target);
      }
    }

    return next;
  }

  /**
   * Return nodes in topological order (Kahn's algorithm).
   * Throws if the graph contains a cycle.
   */
  topologicalSort(definition: WorkflowDefinition): string[] {
    const { nodes, edges } = definition;

    // Build in-degree map and adjacency list
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    for (const edge of edges) {
      const current = inDegree.get(edge.target);
      if (current !== undefined) {
        inDegree.set(edge.target, current + 1);
      }
      adjacency.get(edge.source)?.push(edge.target);
    }

    // Seed queue with zero in-degree nodes
    const queue: string[] = [];
    for (const [nodeId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(nodeId);
      }
    }

    const sorted: string[] = [];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      sorted.push(nodeId);

      const neighbors = adjacency.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        const deg = inDegree.get(neighbor);
        if (deg !== undefined) {
          const newDeg = deg - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) {
            queue.push(neighbor);
          }
        }
      }
    }

    if (sorted.length !== nodes.length) {
      throw new Error('Workflow definition contains a cycle');
    }

    return sorted;
  }

  /**
   * Check whether every terminal node (no outgoing edges) has completed.
   */
  isComplete(definition: WorkflowDefinition, nodeStates: NodeStates): boolean {
    const nodesWithOutgoing = new Set(definition.edges.map((e) => e.source));
    const terminalNodes = definition.nodes.filter((n) => !nodesWithOutgoing.has(n.id));

    // If there are no terminal nodes, consider all nodes
    if (terminalNodes.length === 0) {
      return definition.nodes.every((n) => {
        const state = nodeStates[n.id];
        return state !== undefined && (state.status === 'completed' || state.status === 'failed' || state.status === 'skipped');
      });
    }

    return terminalNodes.every((n) => {
      const state = nodeStates[n.id];
      return state !== undefined && (state.status === 'completed' || state.status === 'failed' || state.status === 'skipped');
    });
  }

  /**
   * Find all root nodes (nodes with no incoming edges).
   */
  getRootNodes(definition: WorkflowDefinition): string[] {
    const targets = new Set(definition.edges.map((e) => e.target));
    return definition.nodes.filter((n) => !targets.has(n.id)).map((n) => n.id);
  }

  /**
   * Look up a node by ID within a definition.
   */
  getNode(definition: WorkflowDefinition, nodeId: string): WorkflowNode | undefined {
    return definition.nodes.find((n) => n.id === nodeId);
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private detectCycle(definition: WorkflowDefinition): string | null {
    const { nodes, edges } = definition;

    const adjacency = new Map<string, string[]>();
    for (const node of nodes) {
      adjacency.set(node.id, []);
    }
    for (const edge of edges) {
      adjacency.get(edge.source)?.push(edge.target);
    }

    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    for (const node of nodes) {
      color.set(node.id, WHITE);
    }

    const dfs = (nodeId: string): boolean => {
      color.set(nodeId, GRAY);
      const neighbors = adjacency.get(nodeId) ?? [];
      for (const neighbor of neighbors) {
        const c = color.get(neighbor);
        if (c === GRAY) {
          return true; // back edge found – cycle
        }
        if (c === WHITE) {
          if (dfs(neighbor)) return true;
        }
      }
      color.set(nodeId, BLACK);
      return false;
    };

    for (const node of nodes) {
      if (color.get(node.id) === WHITE) {
        if (dfs(node.id)) {
          return 'Workflow definition contains a cycle';
        }
      }
    }

    return null;
  }
}
