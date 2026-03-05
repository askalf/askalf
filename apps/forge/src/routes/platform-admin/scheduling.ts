/**
 * Platform Admin — Scheduler control, audit log, retention cleanup,
 * scheduler daemon, intervention auto-handler
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../../database.js';
import { substrateQuery, substrateQueryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/session-auth.js';
import { runDirectCliExecution } from '../../runtime/worker.js';
import { schedulerState, AUTO_APPROVE_PATTERNS } from './utils.js';

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

  // Start the scheduler daemon
  startSchedulerDaemon();
}

// ============================================
// Scheduler daemon (runs inside Forge process)
// ============================================

async function processInterventions(): Promise<void> {
  try {
    const pending = await substrateQuery<Record<string, unknown>>(
      `SELECT id, agent_name, type, title, description, proposed_action, created_at
       FROM agent_interventions WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`,
    );

    for (const intervention of pending) {
      const ageMinutes = (Date.now() - new Date(intervention['created_at'] as string).getTime()) / 60_000;

      // Email notification for fresh interventions (< 2 min old)
      if (ageMinutes < 2) {
        const adminEmail = process.env['ADMIN_EMAIL'];
        if (adminEmail) {
          try {
            const { sendInterventionAlert } = await import('@askalf/email');
            const baseUrl = process.env['DASHBOARD_URL'] ?? 'https://askalf.org';
            await sendInterventionAlert(adminEmail, {
              agentName: intervention['agent_name'] as string,
              interventionType: (intervention['type'] as string) ?? 'approval',
              title: intervention['title'] as string,
              description: (intervention['description'] as string) ?? '',
              proposedAction: (intervention['proposed_action'] as string) ?? undefined,
              approveUrl: `${baseUrl}/admin/hub/interventions`,
              denyUrl: `${baseUrl}/admin/hub/interventions`,
              dashboardUrl: `${baseUrl}/admin/hub/interventions`,
              timestamp: new Date().toISOString(),
            });
          } catch { /* non-fatal — don't block intervention processing */ }
        }
      }

      // Auto-approve low-risk feedback/resource requests
      if (intervention['type'] === 'feedback' || intervention['type'] === 'resource') {
        const text = `${intervention['title']} ${intervention['description'] || ''} ${intervention['proposed_action'] || ''}`;
        if (AUTO_APPROVE_PATTERNS.some((p) => p.test(text))) {
          await substrateQuery(
            `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved by system (low-risk operation)', responded_by = 'system:auto', responded_at = NOW() WHERE id = $1`,
            [intervention['id']],
          );
          console.log(`[Interventions] Auto-approved: ${intervention['title']} (${intervention['agent_name']})`);
          continue;
        }
      }

      // Auto-approve merge requests faster (5min) to keep autonomy loop moving
      if (intervention['type'] === 'approval' && String(intervention['title']).startsWith('Merge branch:') && ageMinutes > 5) {
        await substrateQuery(
          `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved merge after 5min (autonomy loop)', responded_by = 'system:auto-merge', responded_at = NOW() WHERE id = $1`,
          [intervention['id']],
        );
        console.log(`[Interventions] Auto-approved merge (5min): ${intervention['title']}`);
        continue;
      }

      // Auto-approve other approval requests after 30 minutes
      if (intervention['type'] === 'approval' && ageMinutes > 30) {
        await substrateQuery(
          `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved after 30min timeout', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
          [intervention['id']],
        );
        console.log(`[Interventions] Auto-approved (timeout): ${intervention['title']}`);
        continue;
      }

      // Escalate errors/escalations older than 60 min → create Infra ticket
      if ((intervention['type'] === 'escalation' || intervention['type'] === 'error') && ageMinutes > 60) {
        try {
          await substrateQuery(
            `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, is_agent_ticket, source, metadata)
             VALUES ($1, $2, $3, 'open', 'urgent', 'escalation', 'system', 'Infra', true, 'agent', $4)
             ON CONFLICT DO NOTHING`,
            [
              'INT-' + (intervention['id'] as string).substring(0, 20),
              `[ESCALATION] ${intervention['title']}`,
              `Agent ${intervention['agent_name']} requested intervention: ${intervention['description'] || intervention['title']}`,
              JSON.stringify({ intervention_id: intervention['id'], auto_escalated: true }),
            ],
          );
          await substrateQuery(
            `UPDATE agent_interventions SET status = 'resolved', human_response = 'Auto-escalated to Infra ticket after 60min', responded_by = 'system:escalation', responded_at = NOW() WHERE id = $1`,
            [intervention['id']],
          );
        } catch { /* non-fatal */ }
        continue;
      }

      // Catch-all: auto-approve after 30 min
      if (ageMinutes > 30) {
        await substrateQuery(
          `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved after 30min timeout', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
          [intervention['id']],
        );
        console.log(`[Interventions] Auto-approved (catchall): ${intervention['title']}`);
      }
    }
  } catch (err) {
    console.error('[Interventions] Error processing interventions:', err);
  }
}

// ============================================
// Coordination task dispatcher
// ============================================

async function processCoordinationTasks(): Promise<void> {
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

let tickCount = 0;
let tickRunning = false;

async function runSchedulerTick(): Promise<void> {
  if (!schedulerState.running) return;
  if (tickRunning) {
    console.log('[Scheduler] Skipping tick — previous tick still in progress');
    return;
  }
  tickRunning = true;
  tickCount++;

  try {
    await processInterventions();
    await processCoordinationTasks();

    const dueAgents = await substrateQuery<Record<string, unknown>>(
      `SELECT s.agent_id, s.schedule_type, s.schedule_interval_minutes, s.is_continuous
       FROM agent_schedules s WHERE s.next_run_at <= NOW()
       ORDER BY s.next_run_at ASC LIMIT 16`,
    );

    if (dueAgents.length === 0) {
      if (tickCount % 5 === 0) {
        const nextDue = await substrateQueryOne<{ next: string }>(`SELECT MIN(next_run_at) as next FROM agent_schedules`);
        console.log(`[Scheduler] Heartbeat #${tickCount} — next: ${nextDue?.next ? new Date(nextDue.next).toISOString() : 'none'}`);
      }
      return;
    }

    interface ScheduledAgent {
      agentId: string;
      agentName: string;
      input: string;
      intervalMinutes: number;
      modelId?: string;
      systemPrompt?: string;
      maxBudget?: string;
      maxTurns?: number;
      ticketId?: string;
    }
    const batchAgents: ScheduledAgent[] = [];

    // Build fleet awareness context — what's running and what just completed
    const [runningExecs, recentCompletions] = await Promise.all([
      query<{ agent_name: string; input: string; started_at: string }>(
        `SELECT a.name as agent_name, substring(e.input from 1 for 100) as input, e.started_at
         FROM forge_executions e JOIN forge_agents a ON e.agent_id = a.id
         WHERE e.status IN ('running', 'pending') ORDER BY e.started_at DESC LIMIT 10`,
      ).catch(() => [] as { agent_name: string; input: string; started_at: string }[]),
      query<{ agent_name: string; input: string; completed_at: string }>(
        `SELECT a.name as agent_name, substring(e.input from 1 for 100) as input, e.completed_at
         FROM forge_executions e JOIN forge_agents a ON e.agent_id = a.id
         WHERE e.status = 'completed' AND e.completed_at > NOW() - INTERVAL '2 hours'
         ORDER BY e.completed_at DESC LIMIT 8`,
      ).catch(() => [] as { agent_name: string; input: string; completed_at: string }[]),
    ]);

    const fleetContext = [
      '\n\nFLEET AWARENESS (avoid duplicate work):',
      runningExecs.length > 0
        ? `Currently running: ${runningExecs.map((e) => `${e.agent_name}`).join(', ')}`
        : 'No agents currently running.',
      recentCompletions.length > 0
        ? `Recent completions (last 2h): ${recentCompletions.map((e) => `${e.agent_name}: ${e.input}`).join(' | ')}`
        : '',
    ].filter(Boolean).join('\n');

    // Count in-flight executions per agent (allow concurrent work on multiple tickets)
    const MAX_CONCURRENT_PER_AGENT = 3;
    const inFlightCounts = await query<{ agent_id: string; cnt: string }>(
      `SELECT agent_id, COUNT(*)::text as cnt FROM forge_executions WHERE status IN ('running', 'pending') GROUP BY agent_id`,
    ).catch(() => [] as { agent_id: string; cnt: string }[]);
    const inFlightMap = new Map(inFlightCounts.map((r) => [r.agent_id, parseInt(r.cnt, 10)]));

    // Track how many we've queued this tick per agent
    const queuedThisTick = new Map<string, number>();

    for (const schedule of dueAgents) {
      const agentId = schedule['agent_id'] as string;
      const intervalMinutes = (schedule['schedule_interval_minutes'] as number) || 60;

      const inFlight = (inFlightMap.get(agentId) ?? 0) + (queuedThisTick.get(agentId) ?? 0);
      if (inFlight >= MAX_CONCURRENT_PER_AGENT) {
        await substrateQuery(
          `UPDATE agent_schedules SET next_run_at = NOW() + ($1 || ' minutes')::INTERVAL WHERE agent_id = $2`,
          [String(intervalMinutes), agentId],
        );
        continue;
      }

      const agent = await queryOne<Record<string, unknown>>(
        `SELECT id, name, status, model_id, system_prompt, max_cost_per_execution, max_iterations, metadata FROM forge_agents WHERE id = $1`,
        [agentId],
      );

      if (!agent || agent['status'] !== 'active') {
        continue;
      }

      const agentName = agent['name'] as string;

      // Pre-load this agent's assigned tickets to inject into prompt
      const assignedTickets = await substrateQuery<{ id: string; title: string; priority: string; description: string }>(
        `SELECT id, title, priority, substring(description from 1 for 1000) as description
         FROM agent_tickets
         WHERE assigned_to = $1 AND status IN ('open', 'in_progress')
         ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, created_at
         LIMIT 5`,
        [agentName],
      ).catch(() => [] as { id: string; title: string; priority: string; description: string }[]);

      // Monitor agents (create tickets/findings for others) are exempt from ticket-gating
      const MONITOR_AGENTS = ['QA', 'Watchdog', 'Infra'];
      const isMonitor = MONITOR_AGENTS.includes(agentName);

      // Monitor agents run single-instance patrols — skip if already running
      if (isMonitor && inFlight >= 1) {
        await substrateQuery(
          `UPDATE agent_schedules SET next_run_at = NOW() + ($1 || ' minutes')::INTERVAL WHERE agent_id = $2`,
          [String(intervalMinutes), agentId],
        );
        console.log(`[Scheduler] Skipping ${agentName} (monitor) — already running (${inFlight} in-flight)`);
        continue;
      }

      // If no tickets assigned and not a monitor agent, skip entirely — don't waste money on busywork
      if (assignedTickets.length === 0 && !isMonitor) {
        // Advance next_run_at so we check again later
        await substrateQuery(
          `UPDATE agent_schedules SET next_run_at = NOW() + ($1 || ' minutes')::INTERVAL WHERE agent_id = $2`,
          [String(intervalMinutes), agentId],
        );
        console.log(`[Scheduler] Skipping ${agentName} — no tickets assigned`);
        continue;
      }

      // Find tickets already being worked by in-flight executions for this agent
      const inFlightTickets = await query<{ ticket_id: string }>(
        `SELECT metadata->>'ticket_id' as ticket_id FROM forge_executions
         WHERE agent_id = $1 AND status IN ('running', 'pending') AND metadata->>'ticket_id' IS NOT NULL`,
        [agentId],
      ).catch(() => [] as { ticket_id: string }[]);
      const inFlightTicketSet = new Set(inFlightTickets.map(r => r.ticket_id));

      if (isMonitor) {
        // Monitor agents: single dispatch for patrol + own tickets
        const ownTicketBlock = assignedTickets.length > 0
          ? `\n\nYOU ALSO HAVE ${assignedTickets.length} TICKET(S) ASSIGNED TO YOU:\n${assignedTickets.map((t, i) => `${i + 1}. [${t.priority.toUpperCase()}] ${t.id}: ${t.title}\n   ${t.description}`).join('\n')}\n\nWork these first before doing your patrol.`
          : '';

        const input = `[PATROL CYCLE — ${new Date().toISOString()}] You are ${agentName}.

You are a MONITOR agent. Your job is to patrol the system, detect issues, and create tickets/findings for other agents to act on.${ownTicketBlock}

PATROL PROTOCOL:
1. CHECK: Run your standard checks as defined in your system prompt.
2. FINDINGS: Create findings (finding_ops) for any issues detected — categorize and describe clearly.
3. TICKETS: For actionable issues, create tickets (ticket_ops action=create) assigned to the correct agent:
   - Security issues → Security
   - Infrastructure/container issues → Infra
   - Code bugs → Backend Dev
   - UI/dashboard issues → Frontend Dev
   - Documentation gaps → Writer
   - Architecture concerns → Architect
4. DEDUP: Before creating any ticket, check for existing open tickets with similar title (ticket_ops action=list).
5. SUMMARY: Create one summary finding with what you checked and what you found.

RULES:
- Do NOT fix issues yourself — create tickets for the right agent.
- Do NOT create duplicate tickets. Check existing tickets first.
- Batch similar issues into single tickets (e.g., "Fix 3 health check failures" not 3 tickets).
- If everything is healthy, create a brief "all clear" finding and stop. Do NOT create tickets for non-issues.
- BEFORE starting: search memory (memory_search) for your last patrol results.
- AFTER completing: store what you found (memory_store) so you can compare next time.
- EVERY patrol must leave at least one finding. No silent runs.

PATROL. Detect. Report. Stop.${fleetContext}`;

        batchAgents.push({
          agentId,
          agentName: agent['name'] as string,
          input,
          intervalMinutes,
          modelId: (agent['model_id'] as string) ?? undefined,
          systemPrompt: (agent['system_prompt'] as string) ?? undefined,
          maxBudget: (agent['max_cost_per_execution'] as string) ?? undefined,
          maxTurns: (agent['max_iterations'] as number) ?? undefined,
        });
        queuedThisTick.set(agentId, (queuedThisTick.get(agentId) ?? 0) + 1);
      } else {
        // Worker agents: dispatch one execution per unworked ticket (up to concurrency limit)
        const unworkedTickets = assignedTickets.filter(t => !inFlightTicketSet.has(t.id));
        if (unworkedTickets.length === 0) {
          // All tickets already have in-flight executions
          await substrateQuery(
            `UPDATE agent_schedules SET next_run_at = NOW() + ($1 || ' minutes')::INTERVAL WHERE agent_id = $2`,
            [String(intervalMinutes), agentId],
          );
          continue;
        }

        const currentInFlight = (inFlightMap.get(agentId) ?? 0) + (queuedThisTick.get(agentId) ?? 0);
        const slotsAvailable = MAX_CONCURRENT_PER_AGENT - currentInFlight;
        const ticketsToDispatch = unworkedTickets.slice(0, slotsAvailable);

        for (const ticket of ticketsToDispatch) {
          const otherTickets = assignedTickets.filter(t => t.id !== ticket.id);
          const otherBlock = otherTickets.length > 0
            ? `\n\nOTHER TICKETS IN YOUR QUEUE (do NOT work these — another instance may handle them):\n${otherTickets.map(t => `- [${t.priority.toUpperCase()}] ${t.id}: ${t.title}`).join('\n')}`
            : '';

          const input = `[WORK CYCLE — ${new Date().toISOString()}] You are ${agentName}.

YOUR TICKET:
[${ticket.priority.toUpperCase()}] ${ticket.id}: ${ticket.title}
${ticket.description}${otherBlock}

TICKET LIFECYCLE (you MUST follow every step):
1. CLAIM: Update ticket status to in_progress (ticket_ops action=update).
2. NOTE: Add a progress note (ticket_ops action=add_note) describing what you're about to do.
3. WORK: Do the actual work — write code, fix bugs, run commands. Use your tools.
4. COMMIT: Stage and commit your changes (git add + git commit). Every execution must produce a commit if code was changed.
5. NOTE: Add a completion note with what was done, files changed, and outcome.
6. RESOLVE: When done, update ticket status to resolved with a detailed resolution note.

RULES:
- FOCUS on this ONE ticket only. Do NOT work on other tickets.
- DO NOT CREATE NEW TICKETS. If you find something that needs a ticket, add a note to your current ticket mentioning it — a human will triage.
- BEFORE starting: search memory (memory_search) for context another agent may have left.
- AFTER completing: store what you learned (memory_store) so the fleet benefits.
- Do NOT write analysis reports, architecture docs, or proposals unless the ticket specifically asks for one.
- Do NOT explore the codebase without purpose. Read only the files your ticket requires.
- EVERY execution must leave at least one progress note. No silent runs.
- If you cannot complete the ticket in this cycle, add a note explaining what's left and what's blocking you.

FOCUS. Work the ticket. Ship code. Stop.${fleetContext}`;

          batchAgents.push({
            agentId,
            agentName: agent['name'] as string,
            input,
            intervalMinutes,
            modelId: (agent['model_id'] as string) ?? undefined,
            systemPrompt: (agent['system_prompt'] as string) ?? undefined,
            maxBudget: (agent['max_cost_per_execution'] as string) ?? undefined,
            maxTurns: (agent['max_iterations'] as number) ?? undefined,
            ticketId: ticket.id,
          });
          queuedThisTick.set(agentId, (queuedThisTick.get(agentId) ?? 0) + 1);
        }
      }
    }

    if (batchAgents.length === 0) return;

    console.log(`[Scheduler] Dispatching ${batchAgents.length} executions: ${batchAgents.map((a) => a.ticketId ? `${a.agentName}[${a.ticketId}]` : a.agentName).join(', ')}`);

    // Stagger dispatches 1s apart — spread connection init without wasting time
    const STAGGER_DELAY_MS = 1_000;

    for (let i = 0; i < batchAgents.length; i++) {
      const agent = batchAgents[i]!;

      // Wait before dispatching (skip delay for first agent)
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, STAGGER_DELAY_MS));
      }

      const execId = ulid();
      const ownerId = 'system:scheduler';

      const metadata = agent.ticketId ? { ticket_id: agent.ticketId } : {};

      await queryOne(
        `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
         VALUES ($1, $2, $3, $4, 'pending', $5, NOW()) RETURNING id`,
        [execId, agent.agentId, ownerId, agent.input, JSON.stringify(metadata)],
      );

      void runDirectCliExecution(execId, agent.agentId, agent.input, ownerId, {
        modelId: agent.modelId,
        systemPrompt: agent.systemPrompt,
        maxBudgetUsd: agent.maxBudget,
        maxTurns: agent.maxTurns,
        scheduleIntervalMinutes: agent.intervalMinutes,
      }).catch((err) => {
        console.error(`[Scheduler] CLI execution failed for ${agent.agentName}:`, err);
      });

      const ticketSuffix = agent.ticketId ? ` [${agent.ticketId}]` : '';
      console.log(`[Scheduler] Dispatched ${agent.agentName}${ticketSuffix} (${i + 1}/${batchAgents.length})`);
    }

    // Deduplicate schedule updates (agent may have multiple dispatches)
    const updatedAgents = new Set<string>();
    for (const agent of batchAgents) {
      if (updatedAgents.has(agent.agentId)) continue;
      updatedAgents.add(agent.agentId);
      await substrateQuery(
        `UPDATE agent_schedules SET last_run_at = NOW(), next_run_at = NOW() + ($1 || ' minutes')::INTERVAL WHERE agent_id = $2`,
        [String(agent.intervalMinutes), agent.agentId],
      );
    }
  } catch (err) {
    console.error('[Scheduler] Tick error:', err);
  } finally {
    tickRunning = false;
  }
}

function startSchedulerDaemon(): void {
  console.log('[Scheduler] Agent scheduler daemon started (60s interval)');
  setInterval(runSchedulerTick, 60_000);
  setTimeout(runSchedulerTick, 10_000);
}
