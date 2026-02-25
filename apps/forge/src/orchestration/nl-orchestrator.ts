/**
 * Natural Language Orchestration (Phase 7)
 * Accepts plain English instructions and automatically decomposes into
 * agent tasks, matches agents, and executes the plan.
 */

import { ulid } from 'ulid';
import { query } from '../database.js';
import { runCliQuery } from '../runtime/worker.js';
import { decomposeTask, type DecomposedTask } from './task-decomposer.js';
import { matchAgentsToTasks } from './agent-matcher.js';
import { runDirectCliExecution } from '../runtime/worker.js';
import { getEventBus } from './event-bus.js';

export interface NLOrchestrationRequest {
  instruction: string;
  ownerId: string;
  sessionId?: string;
  maxAgents?: number;
  autoApprove?: boolean;
}

export interface NLOrchestrationResult {
  sessionId: string;
  tasks: Array<{
    title: string;
    agentId: string;
    agentName: string;
    executionId: string;
    status: string;
  }>;
  totalTasks: number;
}

/**
 * Orchestrate a natural language instruction end-to-end.
 * Decomposes → matches → executes (fire-and-forget or awaited).
 */
export async function orchestrateFromNL(
  request: NLOrchestrationRequest,
): Promise<NLOrchestrationResult> {
  const sessionId = request.sessionId ?? ulid();
  const eventBus = getEventBus();

  // Fetch available agents for decomposition
  const agents = await query<{ name: string; type: string; description: string }>(
    `SELECT name, COALESCE(type, 'custom') AS type, description
     FROM forge_agents
     WHERE status != 'error' AND (is_decommissioned IS NULL OR is_decommissioned = false)`,
  );

  // Step 1: Decompose instruction into tasks
  const decomposition = await decomposeTask(request.instruction, agents);
  const limitedTasks = decomposition.tasks.slice(0, request.maxAgents ?? 5);

  console.log(`[NL-Orch] Decomposed "${request.instruction.substring(0, 80)}..." into ${limitedTasks.length} tasks`);

  void eventBus?.emitCoordination('plan_created', sessionId, {
    data: {
      instruction: request.instruction.substring(0, 200),
      taskCount: limitedTasks.length,
      tasks: limitedTasks.map((t) => t.title),
    },
  }).catch(() => {});

  // Step 2: Match agents to tasks
  const matches = await matchAgentsToTasks(limitedTasks);

  // Step 3: Create executions and dispatch
  const results: NLOrchestrationResult['tasks'] = [];

  for (const match of matches) {
    const task = limitedTasks.find((t) => t.title === match.taskTitle);
    if (!task) continue;

    const executionId = ulid();

    // Create execution record
    await query(
      `INSERT INTO forge_executions
       (id, agent_id, owner_id, input, status, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
      [
        executionId,
        match.agentId,
        request.ownerId,
        task.description,
        JSON.stringify({
          source: 'nl-orchestration',
          sessionId,
          taskTitle: task.title,
          matchScore: match.score,
        }),
      ],
    );

    // Get agent config for execution
    const agent = await query<{ system_prompt: string; model_id: string; max_budget: string }>(
      `SELECT system_prompt,
              COALESCE(metadata->>'model_id', 'claude-sonnet-4-6') AS model_id,
              COALESCE(metadata->>'max_budget', '0.50') AS max_budget
       FROM forge_agents WHERE id = $1`,
      [match.agentId],
    );

    const agentConfig = agent[0];

    // Fire-and-forget execution
    void runDirectCliExecution(executionId, match.agentId, task.description, request.ownerId, {
      systemPrompt: agentConfig?.system_prompt,
      modelId: agentConfig?.model_id,
      maxBudgetUsd: agentConfig?.max_budget,
    }).catch((err) => {
      console.error(`[NL-Orch] Execution ${executionId} failed:`, err instanceof Error ? err.message : err);
    });

    void eventBus?.emitCoordination('task_started', sessionId, {
      taskId: executionId,
      agentId: match.agentId,
      agentName: match.agentName,
      data: { taskTitle: task.title },
    }).catch(() => {});

    results.push({
      title: task.title,
      agentId: match.agentId,
      agentName: match.agentName,
      executionId,
      status: 'pending',
    });
  }

  console.log(
    `[NL-Orch] Dispatched ${results.length} tasks: ` +
    results.map((r) => `${r.title} → ${r.agentName}`).join(', '),
  );

  return {
    sessionId,
    tasks: results,
    totalTasks: results.length,
  };
}

// ── Chat-layer orchestration dispatch ──

export interface OrchestrationPlanRequest {
  subtasks: Array<{
    title: string;
    description: string;
    suggestedAgentType: string;
    dependencies: string[];
    estimatedComplexity: 'low' | 'medium' | 'high';
  }>;
  ownerId: string;
  conversationId?: string;
  originalInstruction: string;
  pattern: 'pipeline' | 'fan-out' | 'consensus';
  repoContext?: {
    repoFullName: string;
    repoProvider: string;
    cloneUrl?: string;
    defaultBranch?: string;
  };
}

/**
 * Dispatch a pre-decomposed orchestration plan from the chat layer.
 * Skips LLM decomposition (already done by intent parser).
 * Matches agents via scoring, creates executions, dispatches.
 */
export async function dispatchOrchestrationPlan(
  request: OrchestrationPlanRequest,
): Promise<NLOrchestrationResult> {
  const sessionId = ulid();

  // Convert subtasks to DecomposedTask format for agent-matcher
  const decomposedTasks: DecomposedTask[] = request.subtasks.map((st) => ({
    title: st.title,
    description: st.description,
    suggestedAgentType: st.suggestedAgentType,
    dependencies: st.dependencies,
    estimatedComplexity: st.estimatedComplexity,
  }));

  // Match agents (cheap — DB + scoring, no LLM)
  const matches = await matchAgentsToTasks(decomposedTasks);

  // Create executions and dispatch
  const results: NLOrchestrationResult['tasks'] = [];
  let taskIndex = 0;

  for (const match of matches) {
    const task = decomposedTasks.find((t) => t.title === match.taskTitle);
    if (!task) continue;

    const executionId = ulid();

    // Determine if this task should start immediately
    const shouldStart = request.pattern === 'fan-out'
      || request.pattern === 'consensus'
      || taskIndex === 0; // Pipeline: start first task only

    await query(
      `INSERT INTO forge_executions
       (id, agent_id, owner_id, input, status, metadata, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        executionId,
        match.agentId,
        request.ownerId,
        task.description,
        shouldStart ? 'pending' : 'queued',
        JSON.stringify({
          source: 'chat-orchestration',
          source_layer: 'chat',
          sessionId,
          taskTitle: task.title,
          matchScore: match.score,
          pattern: request.pattern,
          conversationId: request.conversationId,
          originalInstruction: request.originalInstruction.substring(0, 500),
          ...(request.repoContext ? { repoContext: request.repoContext } : {}),
        }),
      ],
    );

    if (shouldStart) {
      // Get agent config and dispatch
      const agentRow = await query<{ system_prompt: string; model_id: string; max_budget: string }>(
        `SELECT system_prompt,
                COALESCE(metadata->>'model_id', 'claude-sonnet-4-6') AS model_id,
                COALESCE(metadata->>'max_budget', '0.50') AS max_budget
         FROM forge_agents WHERE id = $1`,
        [match.agentId],
      );
      const cfg = agentRow[0];

      // Prepend repo context to the task description if available
      let taskInput = task.description;
      if (request.repoContext) {
        const rc = request.repoContext;
        const repoPrefix = `TARGET REPOSITORY: ${rc.repoFullName} (${rc.repoProvider})` +
          (rc.cloneUrl ? `\nCLONE URL: ${rc.cloneUrl}` : '') +
          `\nDEFAULT BRANCH: ${rc.defaultBranch ?? 'main'}` +
          '\n\n';
        taskInput = repoPrefix + taskInput;
      }

      void runDirectCliExecution(executionId, match.agentId, taskInput, request.ownerId, {
        systemPrompt: cfg?.system_prompt,
        modelId: cfg?.model_id,
        maxBudgetUsd: cfg?.max_budget,
      }).catch((err) => {
        console.error(`[Chat-Orch] Execution ${executionId} failed:`, err instanceof Error ? err.message : err);
      });
    }

    results.push({
      title: task.title,
      agentId: match.agentId,
      agentName: match.agentName,
      executionId,
      status: shouldStart ? 'pending' : 'queued',
    });

    taskIndex++;
  }

  console.log(
    `[Chat-Orch] Dispatched ${results.length} tasks (${request.pattern}): ` +
    results.map((r) => `${r.title} → ${r.agentName} [${r.status}]`).join(', '),
  );

  return { sessionId, tasks: results, totalTasks: results.length };
}

/**
 * Get the status of an NL orchestration session.
 */
export async function getOrchestrationStatus(sessionId: string): Promise<{
  tasks: Array<{
    executionId: string;
    agentName: string;
    taskTitle: string;
    status: string;
    output?: string;
    error?: string;
    durationMs?: number;
  }>;
  completed: number;
  failed: number;
  running: number;
  pending: number;
}> {
  const executions = await query<{
    id: string;
    status: string;
    output: string | null;
    error: string | null;
    duration_ms: number | null;
    metadata: { taskTitle?: string; sessionId?: string };
    agent_name: string;
  }>(
    `SELECT e.id, e.status, e.output, e.error, e.duration_ms, e.metadata,
            a.name AS agent_name
     FROM forge_executions e
     JOIN forge_agents a ON a.id = e.agent_id
     WHERE e.metadata->>'sessionId' = $1
     ORDER BY e.started_at`,
    [sessionId],
  );

  const tasks = executions.map((e) => ({
    executionId: e.id,
    agentName: e.agent_name,
    taskTitle: e.metadata?.taskTitle ?? 'unknown',
    status: e.status,
    output: e.output?.substring(0, 500) ?? undefined,
    error: e.error?.substring(0, 500) ?? undefined,
    durationMs: e.duration_ms ?? undefined,
  }));

  return {
    tasks,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    running: tasks.filter((t) => t.status === 'running').length,
    pending: tasks.filter((t) => t.status === 'pending').length,
  };
}
