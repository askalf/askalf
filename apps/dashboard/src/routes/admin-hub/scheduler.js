// Scheduler daemon, scheduler status/control, schedule CRUD, intervention auto-handler, data retention
import { callForgeAdmin, schedulerPausedTenants } from './utils.js';

export async function registerSchedulerRoutes(fastify, requireAdmin, query, queryOne) {

  // GET /api/v1/admin/reports/scheduler - Scheduler status (per-tenant)
  fastify.get('/api/v1/admin/reports/scheduler', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const tenantId = admin.id;
    const continuousSchedules = await query(
      `SELECT * FROM agent_schedules WHERE is_continuous = true AND tenant_id = $1`, [tenantId]
    );
    const scheduledSchedules = await query(
      `SELECT * FROM agent_schedules WHERE schedule_type = 'scheduled' AND next_run_at IS NOT NULL AND tenant_id = $1`, [tenantId]
    );

    // Look up agent names from Forge
    const agentsRes = await callForgeAdmin('/agents');
    const agentNameMap = {};
    if (!agentsRes.error) {
      for (const a of (agentsRes.agents || [])) {
        agentNameMap[a.id] = a.name;
      }
    }

    return {
      running: !schedulerPausedTenants.has(tenantId),
      continuousAgents: continuousSchedules.map(s => ({
        name: agentNameMap[s.agent_id] || s.agent_id,
        status: s.last_run_at ? 'active' : 'idle',
      })),
      nextScheduledAgents: scheduledSchedules.map(s => ({
        name: agentNameMap[s.agent_id] || s.agent_id,
        next_run_at: s.next_run_at,
        schedule_type: s.schedule_type,
      })),
    };
  });

  // POST /api/v1/admin/reports/scheduler - Scheduler control (per-tenant)
  fastify.post('/api/v1/admin/reports/scheduler', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const tenantId = admin.id;
    const { action } = request.body || {};
    if (action === 'start') {
      schedulerPausedTenants.delete(tenantId);
      console.log(`[Scheduler] Scheduler started by tenant ${tenantId}`);
    } else if (action === 'stop') {
      schedulerPausedTenants.add(tenantId);
      console.log(`[Scheduler] Scheduler paused by tenant ${tenantId}`);
    }
    return { success: true, action: action || 'acknowledged', running: !schedulerPausedTenants.has(tenantId) };
  });

  // POST /api/v1/admin/agents/:id/schedule - Set agent schedule
  fastify.post('/api/v1/admin/agents/:id/schedule', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    const { id } = request.params;
    const { schedule_type, schedule_interval_minutes, is_continuous, execution_mode } = request.body || {};

    let nextRunAt = null;
    if (schedule_type === 'scheduled' && schedule_interval_minutes) {
      nextRunAt = new Date(Date.now() + schedule_interval_minutes * 60000).toISOString();
    }

    const result = await queryOne(`
      INSERT INTO agent_schedules (agent_id, schedule_type, schedule_interval_minutes, next_run_at, is_continuous, execution_mode, tenant_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (agent_id) DO UPDATE SET
        schedule_type = EXCLUDED.schedule_type,
        schedule_interval_minutes = EXCLUDED.schedule_interval_minutes,
        next_run_at = EXCLUDED.next_run_at,
        is_continuous = EXCLUDED.is_continuous,
        execution_mode = EXCLUDED.execution_mode,
        tenant_id = EXCLUDED.tenant_id
      RETURNING *
    `, [id, schedule_type || 'manual', schedule_interval_minutes || null, nextRunAt, is_continuous || false, execution_mode || 'batch', admin.id]);

    return { schedule: result };
  });

  // ============================================
  // INTERVENTION AUTO-HANDLER
  // ============================================

  const AUTO_APPROVE_PATTERNS = [
    /restart.*container/i,
    /install.*extension/i,
    /apply.*migration/i,
    /create.*index/i,
    /enable.*monitoring/i,
    /update.*schedule/i,
    /run.*backup/i,
  ];

  async function processInterventions() {
    try {
      const pending = await query(
        `SELECT id, agent_name, type, title, description, proposed_action, created_at
         FROM agent_interventions
         WHERE status = 'pending'
         ORDER BY created_at ASC
         LIMIT 10`
      );

      if (pending.length === 0) return;

      for (const intervention of pending) {
        const ageMinutes = (Date.now() - new Date(intervention.created_at).getTime()) / 60_000;

        // Auto-approve low-risk resource/feedback requests
        if (intervention.type === 'feedback' || intervention.type === 'resource') {
          const text = `${intervention.title} ${intervention.description || ''} ${intervention.proposed_action || ''}`;
          const isAutoApprovable = AUTO_APPROVE_PATTERNS.some(p => p.test(text));

          if (isAutoApprovable) {
            await queryOne(
              `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved by system (low-risk operation)', responded_by = 'system:auto', responded_at = NOW() WHERE id = $1`,
              [intervention.id]
            );
            try {
              await query(
                `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
                 VALUES ('intervention', $1, 'auto_approved', 'system:auto', '{"status":"pending"}', $2)`,
                [intervention.id, JSON.stringify({ status: 'approved', reason: 'auto_approve_low_risk', title: intervention.title })]
              );
            } catch { /* audit non-fatal */ }
            console.log(`[Interventions] Auto-approved: ${intervention.title} (${intervention.agent_name})`);
            continue;
          }
        }

        // Auto-approve approval requests older than 30 minutes (agent is waiting)
        if (intervention.type === 'approval' && ageMinutes > 30) {
          await queryOne(
            `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved after 30min timeout (no human response)', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
            [intervention.id]
          );
          try {
            await query(
              `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
               VALUES ('intervention', $1, 'auto_approved', 'system:timeout', '{"status":"pending"}', $2)`,
              [intervention.id, JSON.stringify({ status: 'approved', reason: 'timeout_30min', title: intervention.title })]
            );
          } catch { /* audit non-fatal */ }
          console.log(`[Interventions] Auto-approved (timeout): ${intervention.title} (${intervention.agent_name})`);
          continue;
        }

        // Escalation/error interventions older than 60 min — create a ticket for Nexus
        if ((intervention.type === 'escalation' || intervention.type === 'error') && ageMinutes > 60) {
          try {
            await query(
              `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, is_agent_ticket, source, metadata)
               VALUES ($1, $2, $3, 'open', 'urgent', 'escalation', 'system', 'Nexus', true, 'agent', $4)
               ON CONFLICT DO NOTHING`,
              [
                'INT-' + intervention.id.substring(0, 20),
                `[ESCALATION] ${intervention.title}`,
                `Agent ${intervention.agent_name} requested intervention: ${intervention.description || intervention.title}\n\nProposed action: ${intervention.proposed_action || 'None'}`,
                JSON.stringify({ intervention_id: intervention.id, auto_escalated: true }),
              ]
            );
            await queryOne(
              `UPDATE agent_interventions SET status = 'resolved', human_response = 'Auto-escalated to Nexus ticket after 60min', responded_by = 'system:escalation', responded_at = NOW() WHERE id = $1`,
              [intervention.id]
            );
          } catch { /* non-fatal */ }
          console.log(`[Interventions] Escalated to Nexus ticket: ${intervention.title}`);
          continue;
        }

        // Catch-all: any unhandled type older than 30 min gets auto-approved
        if (ageMinutes > 30) {
          await queryOne(
            `UPDATE agent_interventions SET status = 'approved', human_response = 'Auto-approved after 30min timeout (unhandled type: ' || $2 || ')', responded_by = 'system:timeout', responded_at = NOW() WHERE id = $1`,
            [intervention.id, intervention.type || 'unknown']
          );
          try {
            await query(
              `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
               VALUES ('intervention', $1, 'auto_approved', 'system:timeout', '{"status":"pending"}', $2)`,
              [intervention.id, JSON.stringify({ status: 'approved', reason: 'timeout_catchall', type: intervention.type, title: intervention.title })]
            );
          } catch { /* audit non-fatal */ }
          console.log(`[Interventions] Auto-approved (catchall timeout): ${intervention.title} (type: ${intervention.type})`);
        }
      }
    } catch (err) {
      console.error('[Interventions] Error processing interventions:', err);
    }
  }

  // ============================================
  // SCHEDULER DAEMON
  // ============================================

  const SCHEDULER_INTERVAL_MS = 60_000;
  let tickCount = 0;

  async function runSchedulerTick() {
    tickCount++;
    try {
      // Process pending interventions each tick
      await processInterventions();

      // Find agents due to run, excluding paused tenants
      const pausedIds = [...schedulerPausedTenants];
      const dueAgents = pausedIds.length > 0
        ? await query(
            `SELECT s.agent_id, s.schedule_type, s.schedule_interval_minutes, s.is_continuous
             FROM agent_schedules s
             WHERE s.next_run_at <= NOW()
               AND (s.tenant_id IS NULL OR s.tenant_id != ALL($1))
             ORDER BY s.next_run_at ASC
             LIMIT 16`, [pausedIds]
          )
        : await query(
            `SELECT s.agent_id, s.schedule_type, s.schedule_interval_minutes, s.is_continuous
             FROM agent_schedules s
             WHERE s.next_run_at <= NOW()
             ORDER BY s.next_run_at ASC
             LIMIT 16`
          );

      if (dueAgents.length === 0) {
        if (tickCount % 5 === 0) {
          const nextDue = await queryOne(`SELECT MIN(next_run_at) as next FROM agent_schedules`);
          const nextStr = nextDue?.next ? new Date(nextDue.next).toISOString() : 'none';
          console.log(`[Scheduler] Heartbeat tick #${tickCount} — no agents due. Next: ${nextStr}`);
        }
        return;
      }

      const batchAgents = [];

      for (const schedule of dueAgents) {
        try {
          const agentRes = await callForgeAdmin(`/agents/${schedule.agent_id}`);
          if (agentRes.error || !agentRes.agent) {
            console.log(`[Scheduler] Agent ${schedule.agent_id} not found in Forge, skipping`);
            continue;
          }

          const agent = agentRes.agent;
          // Skip archived/paused agents (raw_status preserved from admin transform)
          if (agent.is_decommissioned || agent.status === 'paused') {
            console.log(`[Scheduler] Agent ${agent.name} is ${agent.raw_status || agent.status}, skipping`);
            continue;
          }

          const input = `[SCHEDULED RUN - ${new Date().toISOString()}] You are running on a ${schedule.schedule_interval_minutes}-minute schedule.

MANDATORY TICKET LIFECYCLE — Follow this exact order every run:

1. CHECK ASSIGNED TICKETS: Use ticket_ops action=list filter_assigned_to=YOUR_NAME filter_status=open to find work assigned to you. Also check filter_status=in_progress for your ongoing work.

2. PICK UP WORK: For each open ticket assigned to you, update it to in_progress with ticket_ops action=update ticket_id=ID status=in_progress BEFORE starting work.

3. DO THE WORK: Execute your core duties. Use your tools to investigate, fix, monitor, or build as needed.

4. RESOLVE WITH NOTES: When work is done, update the ticket with ticket_ops action=update ticket_id=ID status=resolved resolution="Detailed description of what you did and the outcome."

5. REPORT FINDINGS: Use finding_ops to report anything noteworthy (security issues, bugs, performance problems, optimization opportunities). Warning/critical findings auto-create tickets for the right agent.

6. CREATE FOLLOW-UP TICKETS: If your work reveals new tasks needed, create tickets with ticket_ops action=create and assign them to the appropriate agent (assigned_to=AGENT_NAME).

7. ROUTINE DUTIES: After ticket work, perform your standard monitoring/maintenance tasks. Log any new findings.

Be efficient and concise. Every action you take must be tracked through a ticket.`;

          batchAgents.push({
            agentId: schedule.agent_id,
            agentName: agent.name,
            input,
            intervalMinutes: schedule.schedule_interval_minutes || 60,
          });
        } catch (agentErr) {
          console.error(`[Scheduler] Error loading agent ${schedule.agent_id}:`, agentErr);
        }
      }

      if (batchAgents.length === 0) return;

      if (batchAgents.length >= 2) {
        console.log(`[Scheduler] Batching ${batchAgents.length} agents: ${batchAgents.map(a => a.agentName).join(', ')}`);

        const batchRes = await callForgeAdmin('/executions/batch', {
          method: 'POST',
          body: {
            agents: batchAgents.map(a => ({ agentId: a.agentId, input: a.input })),
          },
        });

        if (batchRes.error) {
          console.error(`[Scheduler] Batch failed, falling back to individual:`, batchRes.message);
          for (const agent of batchAgents) {
            const execRes = await callForgeAdmin('/executions', {
              method: 'POST',
              body: { agentId: agent.agentId, input: agent.input },
            });
            if (!execRes.error) {
              console.log(`[Scheduler] Started ${agent.agentName} individually`);
            }
          }
        } else {
          console.log(`[Scheduler] Batch started: ${batchAgents.length} agents (50% cost reduction)`);
        }
      } else {
        const agent = batchAgents[0];
        const execRes = await callForgeAdmin('/executions', {
          method: 'POST',
          body: { agentId: agent.agentId, input: agent.input },
        });
        if (!execRes.error) {
          console.log(`[Scheduler] Started ${agent.agentName}`);
        }
      }

      for (const agent of batchAgents) {
        await queryOne(
          `UPDATE agent_schedules
           SET last_run_at = NOW(),
               next_run_at = NOW() + ($1 || ' minutes')::INTERVAL
           WHERE agent_id = $2`,
          [String(agent.intervalMinutes), agent.agentId]
        );
      }
    } catch (err) {
      console.error('[Scheduler] Tick error:', err);
    }
  }

  // ============================================
  // DATA RETENTION
  // ============================================

  const RETENTION_DAYS = 90;
  const SESSION_RETENTION_DAYS = 30;
  let lastRetentionRun = 0;

  async function runRetentionCleanup() {
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;

    if (now - lastRetentionRun < ONE_DAY) return;
    lastRetentionRun = now;

    console.log(`[Retention] Starting daily cleanup (${RETENTION_DAYS}-day retention)...`);

    const tables = [
      { name: 'agent_audit_log', days: RETENTION_DAYS },
      { name: 'agent_logs', days: RETENTION_DAYS },
      { name: 'audit_logs', days: RETENTION_DAYS },
      { name: 'sessions', days: SESSION_RETENTION_DAYS },
    ];

    for (const t of tables) {
      try {
        const result = await query(
          `DELETE FROM ${t.name} WHERE created_at < NOW() - INTERVAL '${t.days} days'`
        );
        const deleted = result?.length ?? 0;
        if (deleted > 0) {
          console.log(`[Retention] Pruned ${deleted} rows from ${t.name} (>${t.days} days)`);
        }
      } catch (err) {
        console.error(`[Retention] Error cleaning ${t.name}:`, err.message);
      }
    }

    try {
      await callForgeAdmin('/retention-cleanup', { method: 'POST', body: {} });
      console.log('[Retention] Forge cleanup triggered');
    } catch (err) {
      console.error('[Retention] Forge cleanup failed:', err.message);
    }

    console.log('[Retention] Daily cleanup complete');
  }

  // Start the scheduler loop
  console.log('[Scheduler] Agent scheduler daemon started (60s interval)');
  setInterval(runSchedulerTick, SCHEDULER_INTERVAL_MS);
  setTimeout(runSchedulerTick, 10_000);

  setInterval(runRetentionCleanup, SCHEDULER_INTERVAL_MS);
  setTimeout(runRetentionCleanup, 30_000);
}
