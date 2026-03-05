/**
 * Platform Admin — Scheduler control, audit log, retention cleanup,
 * coordination task dispatcher
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../../database.js';
import { substrateQuery, substrateQueryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';
import { runDirectCliExecution } from '../../runtime/worker.js';
import { schedulerState } from './utils.js';

export async function registerSchedulingRoutes(app: FastifyInstance): Promise<void> {

  // Scheduler status
  app.get(
    '/api/v1/admin/reports/scheduler',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const [agents, continuous, scheduled] = await Promise.all([
        query<Record<string, unknown>>('SELECT id, name, status FROM forge_agents LIMIT 100'),
        substrateQuery<Record<string, unknown>>(
          `SELECT * FROM agent_schedules WHERE is_continuous = true`,
        ),
        substrateQuery<Record<string, unknown>>(
          `SELECT * FROM agent_schedules WHERE schedule_type = 'scheduled' AND next_run_at IS NOT NULL`,
        ),
      ]);

      const agentMap = new Map(agents.map((a) => [a['id'] as string, a]));

      return {
        running: schedulerState.running,
        continuousAgents: continuous.map((s) => {
          const agent = agentMap.get(s['agent_id'] as string);
          return { ...s, agent_name: agent?.['name'] || 'Unknown', agent_status: agent?.['status'] || 'unknown' };
        }),
        nextScheduledAgents: scheduled.map((s) => {
          const agent = agentMap.get(s['agent_id'] as string);
          return { ...s, agent_name: agent?.['name'] || 'Unknown', agent_status: agent?.['status'] || 'unknown' };
        }),
      };
    },
  );

  // Scheduler control
  app.post(
    '/api/v1/admin/reports/scheduler',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const body = request.body as { action: 'start' | 'stop' };
      if (body.action === 'start') {
        schedulerState.running = true;
      } else if (body.action === 'stop') {
        schedulerState.running = false;
      }
      return { success: true, action: body.action, running: schedulerState.running };
    },
  );

  // Audit log
  app.get(
    '/api/v1/admin/audit',
    { preHandler: [authMiddleware, requireAdmin] },
    async (request: FastifyRequest) => {
      const qs = request.query as {
        entity_type?: string; entity_id?: string; actor?: string; action?: string;
        limit?: string; offset?: string;
      };
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (qs.entity_type) { params.push(qs.entity_type); conditions.push(`entity_type = $${params.length}`); }
      if (qs.entity_id) { params.push(qs.entity_id); conditions.push(`entity_id = $${params.length}`); }
      if (qs.actor) { params.push(qs.actor); conditions.push(`actor = $${params.length}`); }
      if (qs.action) { params.push(qs.action); conditions.push(`action = $${params.length}`); }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = Math.min(parseInt(qs.limit ?? '50'), 100);
      const offset = parseInt(qs.offset ?? '0') || 0;

      const [entries, countResult] = await Promise.all([
        substrateQuery(
          `SELECT id, entity_type, entity_id, action, actor, actor_id, old_value, new_value, execution_id, created_at
           FROM agent_audit_log ${where}
           ORDER BY created_at DESC
           LIMIT ${limit} OFFSET ${offset}`,
          params,
        ),
        substrateQueryOne<{ total: number }>(`SELECT COUNT(*)::int as total FROM agent_audit_log ${where}`, params),
      ]);

      return { audit_trail: entries, total: countResult?.total || 0, limit, offset };
    },
  );

  // Data retention cleanup
  app.post(
    '/api/v1/admin/retention-cleanup',
    { preHandler: [authMiddleware, requireAdmin] },
    async () => {
      const RETENTION_DAYS = 90;
      const EVENT_RETENTION_DAYS = 30;
      const results: Record<string, number> = {};

      const forgeTables = [
        { name: 'forge_audit_log', days: RETENTION_DAYS },
        { name: 'forge_event_log', days: EVENT_RETENTION_DAYS },
        { name: 'forge_cost_events', days: RETENTION_DAYS },
      ];

      for (const t of forgeTables) {
        try {
          const deleted = await query(
            `DELETE FROM ${t.name} WHERE created_at < NOW() - INTERVAL '${t.days} days' RETURNING id`
          );
          results[t.name] = deleted?.length ?? 0;
        } catch {
          results[t.name] = -1;
        }
      }

      return { success: true, pruned: results, retention_days: RETENTION_DAYS };
    },
  );

}

// ============================================
// Coordination task dispatcher (called by unified-dispatcher tick)
// ============================================

export async function processCoordinationTasks(): Promise<void> {
  try {
    // 1. Get active coordination sessions
    const sessions = await query<{
      id: string; title: string; pattern: string;
    }>(`SELECT id, title, pattern FROM coordination_sessions WHERE status = 'active'`);

    console.log(`[Coordination] Found ${sessions.length} active session(s)`);
    if (sessions.length === 0) return;

    for (const session of sessions) {
      const tasks = await query<{
        id: string; title: string; description: string | null;
        assigned_agent: string; assigned_agent_id: string | null;
        dependencies: string[]; status: string; result: string | null; started_at: string | null;
      }>(`SELECT id, title, description, assigned_agent, assigned_agent_id, dependencies, status, result, started_at
          FROM coordination_tasks WHERE session_id = $1`, [session.id]);

      const taskMap = new Map(tasks.map(t => [t.id, t]));
      const taskByTitle = new Map(tasks.map(t => [t.title, t]));

      // 2. Advance pending tasks whose dependencies are all completed (or have no deps)
      for (const task of tasks) {
        if (task.status !== 'pending') continue;
        const deps = (task.dependencies || []).filter(d => d); // filter empty strings
        // Dependencies may be task IDs or task titles — check both maps
        const allDepsCompleted = deps.length === 0 || deps.every(dep => {
          const depTask = taskMap.get(dep) || taskByTitle.get(dep);
          return depTask?.status === 'completed';
        });
        if (allDepsCompleted) {
          await query(`UPDATE coordination_tasks SET status = 'running', started_at = NOW() WHERE id = $1`, [task.id]);
          task.status = 'running';
          console.log(`[Coordination] Advanced task "${task.title}" to running (deps completed)`);
        }
      }

      // 3. Dispatch running tasks
      const runningTasks = tasks.filter(t => t.status === 'running');
      console.log(`[Coordination] Session "${session.title}": ${runningTasks.length} running, ${tasks.filter(t => t.status === 'pending').length} pending`);
      // Dispatch running tasks that don't have active executions
      //    Cap at 2 dispatches per tick to avoid exhausting the DB pool
      //    (each dispatch triggers buildMemoryContext which runs heavy pgvector queries)
      let dispatchedThisTick = 0;
      const MAX_DISPATCHES_PER_TICK = 8;

      for (const task of tasks) {
        if (task.status !== 'running') continue;
        if (!task.assigned_agent_id) continue;
        if (dispatchedThisTick >= MAX_DISPATCHES_PER_TICK) break;

        // Check for existing active execution
        const activeExec = await queryOne<{ id: string }>(
          `SELECT id FROM forge_executions WHERE metadata->>'coordination_task_id' = $1 AND status IN ('pending', 'running') LIMIT 1`,
          [task.id],
        );
        if (activeExec) continue; // Already dispatched

        // Check if a recent execution (since task was set to running) completed or failed
        const completedExec = await queryOne<{ id: string; status: string; output: string | null }>(
          `SELECT id, status, output FROM forge_executions WHERE metadata->>'coordination_task_id' = $1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 1`,
          [task.id, task.started_at || '1970-01-01'],
        );
        if (completedExec?.status === 'completed') {
          await query(
            `UPDATE coordination_tasks SET status = 'completed', result = $2, completed_at = NOW() WHERE id = $1`,
            [task.id, completedExec.output?.substring(0, 2000) || 'Completed'],
          );
          task.status = 'completed';
          console.log(`[Coordination] Task "${task.title}" marked completed from execution ${completedExec.id}`);
          continue;
        }
        if (completedExec?.status === 'failed') {
          // Check if failure was due to SIGTERM (deploy) — treat as retryable, not permanent failure
          const execDetail = await queryOne<{ error: string | null }>(
            `SELECT error FROM forge_executions WHERE id = $1`, [completedExec.id],
          );
          const isSigterm = execDetail?.error?.includes('SIGTERM') || execDetail?.error?.includes('shutting down');
          if (isSigterm) {
            console.log(`[Coordination] Task "${task.title}" execution killed by SIGTERM — will retry`);
            // Fall through to dispatch block below (don't continue)
          } else {
            await query(
              `UPDATE coordination_tasks SET status = 'failed', error = 'Execution failed', completed_at = NOW() WHERE id = $1`,
              [task.id],
            );
            task.status = 'failed';
            continue;
          }
        }

        // Dispatch: no active or recent exec — look up agent details
        console.log(`[Coordination] Preparing to dispatch task "${task.title}" (id: ${task.id})`);
        const agent = await queryOne<Record<string, unknown>>(
          `SELECT id, name, model_id, system_prompt, max_cost_per_execution, max_iterations FROM forge_agents WHERE id = $1`,
          [task.assigned_agent_id],
        );
        if (!agent) continue;

        // Build dependency context (deps may be IDs or titles)
        const depResults: string[] = [];
        for (const depRef of (task.dependencies || [])) {
          const dep = taskMap.get(depRef) || taskByTitle.get(depRef);
          if (dep?.result) {
            depResults.push(`- ${dep.title}: ${dep.result.substring(0, 500)}`);
          }
        }
        const depBlock = depResults.length > 0
          ? `\n\nDEPENDENCY RESULTS (from prior tasks in this session):\n${depResults.join('\n')}`
          : '';

        const input = `[COORDINATION TASK] Session: "${session.title}" | Task: "${task.title}"

${task.description || task.title}${depBlock}

INSTRUCTIONS:
- This is a coordinated team task. Focus specifically on what's described above.
- When done, summarize your findings/results clearly — they will be passed to downstream tasks.
- Use memory_search to check if relevant knowledge already exists.
- Store key learnings via memory_store when done.`;

        const execId = ulid();
        const ownerId = 'system:coordination';

        await queryOne(
          `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
           VALUES ($1, $2, $3, $4, 'pending', $5, NOW()) RETURNING id`,
          [execId, task.assigned_agent_id, ownerId, input, JSON.stringify({
            coordination_task_id: task.id,
            coordination_session_id: session.id,
          })],
        );

        void runDirectCliExecution(execId, task.assigned_agent_id, input, ownerId, {
          modelId: (agent['model_id'] as string) ?? undefined,
          systemPrompt: (agent['system_prompt'] as string) ?? undefined,
          maxBudgetUsd: (agent['max_cost_per_execution'] as string) ?? undefined,
          maxTurns: (agent['max_iterations'] as number) ?? undefined,
          scheduleIntervalMinutes: 120, // Give coordination tasks a generous runtime budget
        }).catch((err) => {
          console.error(`[Coordination] Execution failed for task "${task.title}":`, err);
        });

        console.log(`[Coordination] Dispatched "${task.title}" → ${task.assigned_agent} (exec ${execId})`);
        dispatchedThisTick++;
      }

      // 4. Check session completion
      const statuses = tasks.map(t => t.status);
      const allDone = statuses.every(s => s === 'completed' || s === 'failed');
      if (allDone && tasks.length > 0) {
        const anyFailed = statuses.some(s => s === 'failed');
        await query(
          `UPDATE coordination_sessions SET status = $2, completed_at = NOW() WHERE id = $1`,
          [session.id, anyFailed ? 'failed' : 'completed'],
        );
        console.log(`[Coordination] Session "${session.title}" ${anyFailed ? 'failed' : 'completed'}`);
      }
    }
  } catch (err) {
    console.error('[Coordination] Error processing coordination tasks:', err);
  }
}

