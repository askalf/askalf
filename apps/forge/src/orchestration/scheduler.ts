/**
 * BullMQ Workflow Job Scheduler
 * Enqueues workflow runs as BullMQ jobs and processes them through the
 * DAG engine.
 */

import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { DAGEngine } from './dag.js';
import type {
  NodeStates,
  NodeState,
  WorkflowDefinition,
  WorkflowNode,
} from './dag.js';
import { evaluateCondition } from './router.js';
import { executeParallel } from './parallel.js';
import { createCheckpoint, waitForCheckpoint } from './checkpoint.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WorkflowRow {
  id: string;
  owner_id: string;
  definition: WorkflowDefinition;
}

interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  owner_id: string;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  node_states: NodeStates;
  shared_context: Record<string, unknown>;
  current_node: string | null;
  error: string | null;
}

export interface ScheduleResult {
  runId: string;
  jobId: string;
}

export interface WorkflowJobData {
  runId: string;
  workflowId: string;
  ownerId: string;
}

/**
 * Optional callback that callers can supply to handle individual node
 * execution (e.g. invoking an LLM for "agent" nodes). If not provided
 * the scheduler will use a no-op default.
 */
export type NodeExecutor = (
  node: WorkflowNode,
  context: Record<string, unknown>,
  runId: string,
) => Promise<unknown>;

// ---------------------------------------------------------------------------
// ForgeScheduler
// ---------------------------------------------------------------------------

export class ForgeScheduler {
  private readonly queue: Queue<WorkflowJobData>;
  private worker: Worker<WorkflowJobData> | null = null;
  private readonly dag: DAGEngine;
  private nodeExecutor: NodeExecutor;

  constructor(
    redisUrl: string,
    nodeExecutor?: NodeExecutor,
  ) {
    this.queue = new Queue<WorkflowJobData>('workflow-runs', {
      prefix: 'forge:',
      connection: { url: redisUrl },
    });

    this.dag = new DAGEngine();

    // Default node executor simply returns an empty object.
    this.nodeExecutor = nodeExecutor ?? (async () => ({}));
  }

  /**
   * Replace the node executor callback at runtime.
   */
  setNodeExecutor(executor: NodeExecutor): void {
    this.nodeExecutor = executor;
  }

  // -----------------------------------------------------------------------
  // Scheduling
  // -----------------------------------------------------------------------

  /**
   * Create a new workflow run record in the database and enqueue a BullMQ
   * job to process it.
   */
  async scheduleWorkflowRun(
    workflowId: string,
    input: Record<string, unknown>,
    ownerId: string,
  ): Promise<ScheduleResult> {
    const runId = ulid();

    // Verify the workflow exists
    const workflow = await queryOne<WorkflowRow>(
      `SELECT id, owner_id, definition FROM forge_workflows WHERE id = $1`,
      [workflowId],
    );

    if (!workflow) {
      throw new Error(`Workflow not found: ${workflowId}`);
    }

    // Insert run record
    await query(
      `INSERT INTO forge_workflow_runs
         (id, workflow_id, owner_id, status, input, node_states, shared_context)
       VALUES ($1, $2, $3, 'pending', $4, '{}', '{}')`,
      [runId, workflowId, ownerId, JSON.stringify(input)],
    );

    // Enqueue BullMQ job
    const job = await this.queue.add(
      'execute-workflow',
      { runId, workflowId, ownerId },
      {
        jobId: runId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
      },
    );

    return { runId, jobId: job.id ?? runId };
  }

  // -----------------------------------------------------------------------
  // Processing
  // -----------------------------------------------------------------------

  /**
   * Start a BullMQ Worker that processes enqueued workflow run jobs.
   * Returns the Worker instance (also stored internally).
   */
  processWorkflowJobs(
    redisUrl: string,
    concurrency: number = 5,
  ): Worker<WorkflowJobData> {
    this.worker = new Worker<WorkflowJobData>(
      'workflow-runs',
      async (job: Job<WorkflowJobData>) => {
        await this.executeWorkflowRun(job.data);
      },
      {
        prefix: 'forge:',
        connection: { url: redisUrl },
        concurrency,
      },
    );

    this.worker.on('failed', (job: Job<WorkflowJobData> | undefined, err: Error) => {
      console.error(
        `[ForgeScheduler] Job ${job?.id ?? 'unknown'} failed:`,
        err.message,
      );
      // Persist failure to DB so workflow runs don't get stuck in 'running'
      if (job?.data?.runId) {
        import('../database.js').then(({ query: dbQuery }) =>
          dbQuery(
            `UPDATE forge_workflow_runs SET status = 'failed', error = $1, completed_at = NOW() WHERE id = $2 AND status != 'failed'`,
            [err.message.substring(0, 2000), job.data.runId],
          ),
        ).catch((dbErr) => console.error('[ForgeScheduler] Failed to persist job failure:', dbErr));
      }
    });

    this.worker.on('completed', (job: Job<WorkflowJobData>) => {
      console.log(`[ForgeScheduler] Job ${job.id ?? 'unknown'} completed`);
    });

    return this.worker;
  }

  // -----------------------------------------------------------------------
  // Graceful shutdown
  // -----------------------------------------------------------------------

  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  // -----------------------------------------------------------------------
  // Internal: workflow execution loop
  // -----------------------------------------------------------------------

  private async executeWorkflowRun(data: WorkflowJobData): Promise<void> {
    const { runId, workflowId } = data;

    // Mark as running
    await query(
      `UPDATE forge_workflow_runs
          SET status = 'running', started_at = NOW()
        WHERE id = $1`,
      [runId],
    );

    try {
      // Load workflow definition
      const workflow = await queryOne<WorkflowRow>(
        `SELECT id, owner_id, definition FROM forge_workflows WHERE id = $1`,
        [workflowId],
      );

      if (!workflow) {
        throw new Error(`Workflow disappeared: ${workflowId}`);
      }

      const definition: WorkflowDefinition = workflow.definition;

      // Validate the DAG
      const validation = this.dag.validate(definition);
      if (!validation.valid) {
        throw new Error(`Invalid workflow: ${validation.errors.join('; ')}`);
      }

      // Load the run row for current state
      let run = await queryOne<WorkflowRunRow>(
        `SELECT * FROM forge_workflow_runs WHERE id = $1`,
        [runId],
      );

      if (!run) {
        throw new Error(`Workflow run disappeared: ${runId}`);
      }

      const nodeStates: NodeStates = run.node_states;
      const sharedContext: Record<string, unknown> = {
        ...run.shared_context,
        __input: run.input,
      };

      // Determine execution order
      const sortedNodeIds = this.dag.topologicalSort(definition);

      // Initialize pending state for all nodes
      for (const nodeId of sortedNodeIds) {
        if (!nodeStates[nodeId]) {
          nodeStates[nodeId] = { status: 'pending' };
        }
      }

      // Walk through in topological order
      for (const nodeId of sortedNodeIds) {
        const nodeState = nodeStates[nodeId];
        if (!nodeState) continue;

        // Skip already completed/failed/skipped nodes
        if (
          nodeState.status === 'completed' ||
          nodeState.status === 'failed' ||
          nodeState.status === 'skipped'
        ) {
          continue;
        }

        // Check if all predecessors are done
        const incomingEdges = definition.edges.filter((e) => e.target === nodeId);
        const allPredsDone = incomingEdges.length === 0 || incomingEdges.some((edge) => {
          const predState = nodeStates[edge.source];
          if (!predState) return false;

          // For conditional edges, check if the condition was met
          if (edge.condition !== undefined && edge.condition !== '') {
            const conditionMet = evaluateCondition(edge.condition, sharedContext);
            return predState.status === 'completed' && conditionMet;
          }

          return predState.status === 'completed' || predState.status === 'skipped';
        });

        if (!allPredsDone) {
          nodeStates[nodeId] = { ...nodeState, status: 'skipped' };
          await this.persistState(runId, nodeId, nodeStates, sharedContext);
          continue;
        }

        const node = this.dag.getNode(definition, nodeId);
        if (!node) {
          nodeStates[nodeId] = { ...nodeState, status: 'failed', error: 'Node not found in definition' };
          await this.persistState(runId, nodeId, nodeStates, sharedContext);
          continue;
        }

        // Execute the node based on its type
        nodeStates[nodeId] = { ...nodeState, status: 'running', startedAt: new Date().toISOString() };
        await this.persistState(runId, nodeId, nodeStates, sharedContext);

        try {
          const output = await this.executeNode(node, sharedContext, definition, nodeStates, runId, data.ownerId);

          nodeStates[nodeId] = {
            status: 'completed',
            output,
            startedAt: nodeState.startedAt ?? nodeStates[nodeId]?.startedAt,
            completedAt: new Date().toISOString(),
          };

          // Merge output into shared context
          if (output !== undefined && output !== null) {
            sharedContext[nodeId] = output;
          }
        } catch (nodeErr) {
          const errMsg = nodeErr instanceof Error ? nodeErr.message : String(nodeErr);
          nodeStates[nodeId] = {
            status: 'failed',
            error: errMsg,
            startedAt: nodeState.startedAt ?? nodeStates[nodeId]?.startedAt,
            completedAt: new Date().toISOString(),
          };
        }

        await this.persistState(runId, nodeId, nodeStates, sharedContext);
      }

      // Determine final status
      const anyFailed = Object.values(nodeStates).some((s: NodeState) => s.status === 'failed');
      const finalStatus = anyFailed ? 'failed' : 'completed';

      // Collect output from terminal (output-type) nodes
      const outputNodes = definition.nodes.filter((n: WorkflowNode) => n.type === 'output');
      const output: Record<string, unknown> = {};
      for (const outNode of outputNodes) {
        const state = nodeStates[outNode.id];
        if (state) {
          output[outNode.id] = state.output;
        }
      }

      await query(
        `UPDATE forge_workflow_runs
            SET status = $1,
                output = $2,
                node_states = $3,
                shared_context = $4,
                completed_at = NOW()
          WHERE id = $5`,
        [
          finalStatus,
          JSON.stringify(Object.keys(output).length > 0 ? output : null),
          JSON.stringify(nodeStates),
          JSON.stringify(sharedContext),
          runId,
        ],
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await query(
        `UPDATE forge_workflow_runs
            SET status = 'failed',
                error = $1,
                completed_at = NOW()
          WHERE id = $2`,
        [errMsg, runId],
      );
      throw err; // re-throw so BullMQ records the failure
    }
  }

  // -----------------------------------------------------------------------
  // Node execution dispatcher
  // -----------------------------------------------------------------------

  private async executeNode(
    node: WorkflowNode,
    context: Record<string, unknown>,
    definition: WorkflowDefinition,
    nodeStates: NodeStates,
    runId: string,
    ownerId: string,
  ): Promise<unknown> {
    switch (node.type) {
      case 'input': {
        // Input nodes pass through the workflow input
        return context['__input'] ?? {};
      }

      case 'output': {
        // Output nodes collect data from the context
        const sourceKey = node.config['source'] as string | undefined;
        if (sourceKey) {
          return context[sourceKey];
        }
        // Default: return entire shared context (minus internals)
        const { __input, ...rest } = context;
        return rest;
      }

      case 'transform': {
        // Transform nodes apply a simple key mapping
        const mapping = node.config['mapping'] as Record<string, string> | undefined;
        if (!mapping) return context;
        const result: Record<string, unknown> = {};
        for (const [outKey, inPath] of Object.entries(mapping)) {
          result[outKey] = resolveContextPath(inPath, context);
        }
        return result;
      }

      case 'condition': {
        // Condition nodes evaluate and return the boolean result.
        // The actual branching is handled by edge conditions in getNextNodes.
        const expr = node.config['expression'] as string | undefined;
        if (!expr) return true;
        return evaluateCondition(expr, context);
      }

      case 'parallel': {
        // Gather child node IDs from config
        const childIds = node.config['nodeIds'] as string[] | undefined;
        if (!childIds || childIds.length === 0) return {};

        const childNodes = childIds
          .map((id) => this.dag.getNode(definition, id))
          .filter((n): n is WorkflowNode => n !== undefined);

        const { results, errors } = await executeParallel(
          childNodes,
          context,
          async (childNode: WorkflowNode, ctx: Record<string, unknown>) => this.nodeExecutor(childNode, ctx, runId),
        );

        // Record child states
        for (const childNode of childNodes) {
          const err = errors.get(childNode.id);
          if (err) {
            nodeStates[childNode.id] = {
              status: 'failed',
              error: err.message,
              completedAt: new Date().toISOString(),
            };
          } else {
            nodeStates[childNode.id] = {
              status: 'completed',
              output: results.get(childNode.id),
              completedAt: new Date().toISOString(),
            };
          }
        }

        // Return collected results as an object
        const collected: Record<string, unknown> = {};
        for (const [id, val] of results) {
          collected[id] = val;
        }
        return collected;
      }

      case 'merge': {
        // Merge nodes combine outputs from specified source nodes
        const sourceIds = node.config['sources'] as string[] | undefined;
        if (!sourceIds) return context;
        const merged: Record<string, unknown> = {};
        for (const srcId of sourceIds) {
          const srcState = nodeStates[srcId];
          if (srcState?.status === 'completed') {
            merged[srcId] = srcState.output;
          }
        }
        return merged;
      }

      case 'human_checkpoint': {
        const checkpointId = await createCheckpoint({
          workflowRunId: runId,
          ownerId,
          type: (node.config['checkpointType'] as 'approval' | 'review' | 'input' | 'confirmation') ?? 'approval',
          title: (node.config['title'] as string) ?? 'Human review required',
          description: node.config['description'] as string | undefined,
          context,
          timeoutMinutes: node.config['timeoutMinutes'] as number | undefined,
        });

        // Pause the run
        await query(
          `UPDATE forge_workflow_runs SET status = 'paused', current_node = $1 WHERE id = $2`,
          [node.id, runId],
        );

        // Poll until response
        const pollInterval = (node.config['pollIntervalMs'] as number | undefined) ?? 2_000;
        const timeout = (node.config['timeoutMs'] as number | undefined) ?? 300_000;
        const checkpoint = await waitForCheckpoint(checkpointId, pollInterval, timeout);

        // Resume the run
        await query(
          `UPDATE forge_workflow_runs SET status = 'running', current_node = NULL WHERE id = $1`,
          [runId],
        );

        if (checkpoint.status === 'timeout') {
          throw new Error(`Checkpoint timed out: ${checkpointId}`);
        }

        return checkpoint.response;
      }

      case 'agent':
      default: {
        // Delegate to the pluggable node executor
        return this.nodeExecutor(node, context, runId);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private async persistState(
    runId: string,
    currentNodeId: string,
    nodeStates: NodeStates,
    sharedContext: Record<string, unknown>,
  ): Promise<void> {
    await query(
      `UPDATE forge_workflow_runs
          SET node_states = $1,
              shared_context = $2,
              current_node = $3
        WHERE id = $4`,
      [JSON.stringify(nodeStates), JSON.stringify(sharedContext), currentNodeId, runId],
    );
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function resolveContextPath(path: string, context: Record<string, unknown>): unknown {
  const parts = path.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}
