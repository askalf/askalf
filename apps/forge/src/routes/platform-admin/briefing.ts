/**
 * Platform Admin — Daily Briefing
 * Generates a shareable overnight report with execution stats, costs, tickets, findings, and memory growth.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '../../database.js';
import { substrateQuery, substrateQueryOne } from '../../database.js';
import { authMiddleware } from '../../middleware/auth.js';
import { requireAdmin } from '../../middleware/auth.js';

// ── Helpers ──────────────────────────────────────────────────────────

interface ExecutionRow {
  id: string;
  agent_id: string;
  agent_name: string;
  status: string;
  cost: string | null;
  duration_ms: string | null;
  input: string | null;
  created_at: string;
  completed_at: string | null;
}

interface AgentCostRow {
  agent_name: string;
  total_cost: string;
  execution_count: string;
}

interface TicketRow {
  id: string;
  title: string;
  status: string;
  priority: string;
  source: string | null;
  created_at: string;
  resolved_at: string | null;
}

interface FindingRow {
  id: string;
  finding: string;
  severity: string;
  category: string | null;
  agent_name: string | null;
  created_at: string;
}

interface MemoryCountRow {
  count: string;
}

function fmtCost(n: number): string {
  return `$${n.toFixed(4)}`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Data loader ──────────────────────────────────────────────────────

async function loadBriefingData() {
  const [
    executions,
    costByAgent,
    totalCostRow,
    ticketsCreated,
    ticketsResolved,
    ticketsOpen,
    findings,
    semanticCount,
    episodicCount,
    proceduralCount,
  ] = await Promise.all([
    // Completed executions in last 24h
    query<ExecutionRow>(
      `SELECT e.id, e.agent_id, COALESCE(a.name, 'Unknown') AS agent_name,
              e.status, e.cost::text, e.duration_ms::text, SUBSTRING(e.input, 1, 120) AS input,
              e.created_at::text, e.completed_at::text
       FROM forge_executions e
       LEFT JOIN forge_agents a ON a.id = e.agent_id
       WHERE e.created_at > NOW() - INTERVAL '24 hours'
       ORDER BY e.created_at DESC`,
    ),

    // Cost breakdown by agent (last 24h)
    query<AgentCostRow>(
      `SELECT COALESCE(a.name, 'Unknown') AS agent_name,
              COALESCE(SUM(ce.cost), 0)::text AS total_cost,
              COUNT(DISTINCT ce.execution_id)::text AS execution_count
       FROM forge_cost_events ce
       LEFT JOIN forge_agents a ON a.id = ce.agent_id
       WHERE ce.created_at >= NOW() - INTERVAL '24 hours'
       GROUP BY a.name
       ORDER BY SUM(ce.cost) DESC`,
    ),

    // Total cost (last 24h)
    queryOne<{ total_cost: string }>(
      `SELECT COALESCE(SUM(cost), 0)::text AS total_cost
       FROM forge_cost_events
       WHERE created_at >= NOW() - INTERVAL '24 hours'`,
    ),

    // Tickets created in last 24h
    substrateQuery<TicketRow>(
      `SELECT id, title, status, priority, source, created_at::text, resolved_at::text
       FROM agent_tickets
       WHERE deleted_at IS NULL AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC`,
    ),

    // Tickets resolved in last 24h
    substrateQueryOne<MemoryCountRow>(
      `SELECT COUNT(*)::text AS count FROM agent_tickets
       WHERE deleted_at IS NULL AND resolved_at > NOW() - INTERVAL '24 hours'`,
    ),

    // Tickets still open
    substrateQueryOne<MemoryCountRow>(
      `SELECT COUNT(*)::text AS count FROM agent_tickets
       WHERE deleted_at IS NULL AND status IN ('open', 'in_progress')`,
    ),

    // Findings in last 24h
    substrateQuery<FindingRow>(
      `SELECT id, finding, severity, category, agent_name, created_at::text
       FROM agent_findings
       WHERE created_at > NOW() - INTERVAL '24 hours'
       ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 WHEN 'info' THEN 2 END,
       created_at DESC LIMIT 25`,
    ),

    // Memory growth — semantic
    queryOne<MemoryCountRow>(
      `SELECT COUNT(*)::text AS count FROM forge_semantic_memories
       WHERE created_at > NOW() - INTERVAL '24 hours'`,
    ).catch(() => ({ count: '0' })),

    // Memory growth — episodic
    queryOne<MemoryCountRow>(
      `SELECT COUNT(*)::text AS count FROM forge_episodic_memories
       WHERE created_at > NOW() - INTERVAL '24 hours'`,
    ).catch(() => ({ count: '0' })),

    // Memory growth — procedural
    queryOne<MemoryCountRow>(
      `SELECT COUNT(*)::text AS count FROM forge_procedural_memories
       WHERE created_at > NOW() - INTERVAL '24 hours'`,
    ).catch(() => ({ count: '0' })),
  ]);

  const completedExecs = executions.filter((e) => e.status === 'completed');
  const failedExecs = executions.filter((e) => e.status === 'failed');
  const totalCost = parseFloat(totalCostRow?.total_cost ?? '0') || 0;
  const avgDuration =
    completedExecs.length > 0
      ? completedExecs.reduce((sum, e) => sum + (parseFloat(e.duration_ms ?? '0') || 0), 0) / completedExecs.length
      : 0;

  const ticketsCreatedCount = ticketsCreated.length;
  const ticketsResolvedCount = parseInt(ticketsResolved?.count ?? '0');
  const ticketsOpenCount = parseInt(ticketsOpen?.count ?? '0');

  const criticalFindings = findings.filter((f) => f.severity === 'critical');
  const warningFindings = findings.filter((f) => f.severity === 'warning');

  const memSemantic = parseInt(semanticCount?.count ?? '0');
  const memEpisodic = parseInt(episodicCount?.count ?? '0');
  const memProcedural = parseInt(proceduralCount?.count ?? '0');
  const memTotal = memSemantic + memEpisodic + memProcedural;

  // Build highlights
  const highlights: string[] = [];
  if (completedExecs.length > 0) {
    highlights.push(`Completed ${completedExecs.length} execution${completedExecs.length !== 1 ? 's' : ''} across ${new Set(completedExecs.map((e) => e.agent_name)).size} agent${new Set(completedExecs.map((e) => e.agent_name)).size !== 1 ? 's' : ''}.`);
  }
  if (ticketsResolvedCount > 0) {
    highlights.push(`Resolved ${ticketsResolvedCount} ticket${ticketsResolvedCount !== 1 ? 's' : ''}.`);
  }
  if (memTotal > 0) {
    highlights.push(`Fleet memory grew by ${memTotal} entries (${memSemantic} semantic, ${memEpisodic} episodic, ${memProcedural} procedural).`);
  }
  if (criticalFindings.length > 0) {
    highlights.push(`${criticalFindings.length} critical finding${criticalFindings.length !== 1 ? 's' : ''} require attention.`);
  } else if (findings.length > 0) {
    highlights.push(`${findings.length} finding${findings.length !== 1 ? 's' : ''} logged — no critical issues.`);
  }
  if (failedExecs.length > 0) {
    highlights.push(`${failedExecs.length} execution${failedExecs.length !== 1 ? 's' : ''} failed and may need review.`);
  }
  if (highlights.length === 0) {
    highlights.push('Quiet period — no significant activity in the last 24 hours.');
  }

  // Build next actions
  const nextActions: string[] = [];
  if (criticalFindings.length > 0) nextActions.push('Review and triage critical findings.');
  if (failedExecs.length > 0) nextActions.push('Investigate failed executions and consider retries.');
  if (ticketsOpenCount > 5) nextActions.push(`${ticketsOpenCount} tickets remain open — consider prioritising the backlog.`);
  if (totalCost > 5) nextActions.push('Daily spend exceeded $5 — review cost optimisation opportunities.');
  if (nextActions.length === 0) nextActions.push('No urgent actions required. Continue monitoring.');

  // Summary sentence
  const summary = `Over the last 24 hours, AskAlf completed ${completedExecs.length} execution${completedExecs.length !== 1 ? 's' : ''}, resolved ${ticketsResolvedCount} ticket${ticketsResolvedCount !== 1 ? 's' : ''}, and spent ${fmtCost(totalCost)} across the fleet.`;

  const now = new Date();
  const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  return {
    summary,
    highlights,
    period: {
      from: periodStart.toISOString(),
      to: now.toISOString(),
    },
    executions: {
      total: executions.length,
      completed: completedExecs.length,
      failed: failedExecs.length,
      running: executions.filter((e) => e.status === 'running' || e.status === 'pending').length,
      averageDurationMs: Math.round(avgDuration),
      items: executions.slice(0, 20).map((e) => ({
        id: e.id,
        agent: e.agent_name,
        status: e.status,
        cost: e.cost ? parseFloat(e.cost) : 0,
        durationMs: e.duration_ms ? parseInt(e.duration_ms) : null,
        task: e.input?.substring(0, 120) || null,
        createdAt: e.created_at,
      })),
    },
    cost: {
      total: totalCost,
      formatted: fmtCost(totalCost),
      byAgent: costByAgent.map((r) => ({
        agent: r.agent_name,
        cost: parseFloat(r.total_cost) || 0,
        formatted: fmtCost(parseFloat(r.total_cost) || 0),
        executions: parseInt(r.execution_count) || 0,
      })),
    },
    tickets: {
      created: ticketsCreatedCount,
      resolved: ticketsResolvedCount,
      stillOpen: ticketsOpenCount,
      items: ticketsCreated.slice(0, 10).map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        source: t.source,
      })),
    },
    findings: {
      total: findings.length,
      critical: criticalFindings.length,
      warning: warningFindings.length,
      info: findings.length - criticalFindings.length - warningFindings.length,
      items: findings.slice(0, 10).map((f) => ({
        id: f.id,
        finding: f.finding,
        severity: f.severity,
        category: f.category,
        agent: f.agent_name,
      })),
    },
    memory: {
      newEntries: memTotal,
      semantic: memSemantic,
      episodic: memEpisodic,
      procedural: memProcedural,
    },
    nextActions,
    generatedAt: now.toISOString(),
  };
}

// ── HTML renderer ────────────────────────────────────────────────────

function renderBriefingHtml(data: Awaited<ReturnType<typeof loadBriefingData>>): string {
  const dateRange = `${new Date(data.period.from).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} &mdash; ${new Date(data.period.to).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;

  const severityColor = (s: string) => {
    if (s === 'critical') return '#dc2626';
    if (s === 'warning') return '#f59e0b';
    return '#6b7280';
  };

  const statusColor = (s: string) => {
    if (s === 'completed') return '#16a34a';
    if (s === 'failed') return '#dc2626';
    if (s === 'running' || s === 'pending') return '#2563eb';
    return '#6b7280';
  };

  const priorityIcon = (p: string) => {
    if (p === 'urgent') return '!!!';
    if (p === 'high') return '!!';
    if (p === 'medium') return '!';
    return '-';
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>AskAlf Daily Briefing</title>
  <style>
    @media print {
      body { margin: 0; }
      .page-break { page-break-before: always; }
      .no-print { display: none !important; }
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      color: #1a1a2e;
      background: #f8f9fb;
      line-height: 1.6;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .container {
      max-width: 820px;
      margin: 0 auto;
      padding: 32px 24px;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 3px solid #6c5ce7;
      padding-bottom: 16px;
      margin-bottom: 28px;
    }
    .header-brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo {
      width: 48px;
      height: 48px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      font-weight: 800;
      font-size: 20px;
      letter-spacing: -1px;
    }
    .brand-text h1 {
      font-size: 22px;
      font-weight: 700;
      color: #1a1a2e;
    }
    .brand-text p {
      font-size: 13px;
      color: #6b7280;
      margin-top: 2px;
    }
    .header-date {
      text-align: right;
      font-size: 13px;
      color: #6b7280;
    }

    /* Sections */
    .section {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      padding: 20px 24px;
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 15px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #6c5ce7;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .section-icon {
      font-size: 18px;
    }

    /* Summary */
    .summary-text {
      font-size: 16px;
      color: #374151;
      line-height: 1.7;
    }

    /* Stat grid */
    .stat-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 14px;
      margin-bottom: 16px;
    }
    .stat-card {
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px 16px;
      text-align: center;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 800;
      color: #1a1a2e;
    }
    .stat-label {
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      margin-top: 2px;
    }

    /* Highlights */
    .highlight-list {
      list-style: none;
    }
    .highlight-list li {
      padding: 8px 0 8px 28px;
      position: relative;
      font-size: 14px;
      color: #374151;
      border-bottom: 1px solid #f3f4f6;
    }
    .highlight-list li:last-child { border-bottom: none; }
    .highlight-list li::before {
      content: '>';
      position: absolute;
      left: 4px;
      top: 8px;
      color: #6c5ce7;
      font-weight: 700;
      font-size: 16px;
    }

    /* Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      font-weight: 600;
      color: #6b7280;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      padding: 8px 10px;
      border-bottom: 2px solid #e5e7eb;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid #f3f4f6;
      color: #374151;
    }
    tr:last-child td { border-bottom: none; }
    .cost-total {
      font-weight: 700;
      background: #f9fafb;
    }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }

    /* Next actions */
    .action-list {
      list-style: none;
      counter-reset: actions;
    }
    .action-list li {
      padding: 8px 0 8px 32px;
      position: relative;
      font-size: 14px;
      color: #374151;
      counter-increment: actions;
    }
    .action-list li::before {
      content: counter(actions);
      position: absolute;
      left: 0;
      top: 7px;
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: #6c5ce7;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* Footer */
    .footer {
      text-align: center;
      padding: 24px 0 8px;
      font-size: 12px;
      color: #9ca3af;
      border-top: 1px solid #e5e7eb;
      margin-top: 12px;
    }
    .footer a { color: #6c5ce7; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
  </style>
</head>
<body>
<div class="container">

  <!-- Header -->
  <div class="header">
    <div class="header-brand">
      <div class="logo">Alf</div>
      <div class="brand-text">
        <h1>AskAlf Daily Briefing</h1>
        <p>Autonomous Fleet Intelligence Report</p>
      </div>
    </div>
    <div class="header-date">${dateRange}</div>
  </div>

  <!-- Executive Summary -->
  <div class="section">
    <div class="section-title"><span class="section-icon">&#9670;</span> Executive Summary</div>
    <p class="summary-text">${escHtml(data.summary)}</p>
  </div>

  <!-- Key Stats -->
  <div class="stat-grid">
    <div class="stat-card">
      <div class="stat-value">${data.executions.completed}</div>
      <div class="stat-label">Completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${data.executions.failed}</div>
      <div class="stat-label">Failed</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${data.cost.formatted}</div>
      <div class="stat-label">Total Cost</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${data.tickets.resolved}</div>
      <div class="stat-label">Tickets Resolved</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${data.memory.newEntries}</div>
      <div class="stat-label">Memories Created</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${data.findings.total}</div>
      <div class="stat-label">Findings</div>
    </div>
  </div>

  <!-- Highlights -->
  <div class="section">
    <div class="section-title"><span class="section-icon">&#9733;</span> Highlights</div>
    <ul class="highlight-list">
      ${data.highlights.map((h) => `<li>${escHtml(h)}</li>`).join('\n      ')}
    </ul>
  </div>

  <!-- Cost Breakdown -->
  <div class="section">
    <div class="section-title"><span class="section-icon">&#36;</span> Cost Breakdown by Agent</div>
    ${data.cost.byAgent.length > 0 ? `
    <table>
      <thead><tr><th>Agent</th><th>Executions</th><th style="text-align:right">Cost</th></tr></thead>
      <tbody>
        ${data.cost.byAgent.map((a) => `<tr><td>${escHtml(a.agent)}</td><td>${a.executions}</td><td style="text-align:right">${a.formatted}</td></tr>`).join('\n        ')}
        <tr class="cost-total"><td>Total</td><td></td><td style="text-align:right">${data.cost.formatted}</td></tr>
      </tbody>
    </table>` : '<p style="color:#9ca3af;font-size:14px;">No cost events recorded in the last 24 hours.</p>'}
  </div>

  <!-- Ticket Activity -->
  <div class="section">
    <div class="section-title"><span class="section-icon">&#9993;</span> Ticket Activity</div>
    <div class="stat-grid" style="margin-bottom:14px;">
      <div class="stat-card"><div class="stat-value">${data.tickets.created}</div><div class="stat-label">Created</div></div>
      <div class="stat-card"><div class="stat-value">${data.tickets.resolved}</div><div class="stat-label">Resolved</div></div>
      <div class="stat-card"><div class="stat-value">${data.tickets.stillOpen}</div><div class="stat-label">Still Open</div></div>
    </div>
    ${data.tickets.items.length > 0 ? `
    <table>
      <thead><tr><th>Title</th><th>Priority</th><th>Status</th><th>Source</th></tr></thead>
      <tbody>
        ${data.tickets.items.map((t) => `<tr><td>${escHtml(t.title)}</td><td>${priorityIcon(t.priority)} ${escHtml(t.priority)}</td><td><span class="badge" style="background:${statusColor(t.status)}20;color:${statusColor(t.status)}">${escHtml(t.status)}</span></td><td>${escHtml(t.source || '-')}</td></tr>`).join('\n        ')}
      </tbody>
    </table>` : '<p style="color:#9ca3af;font-size:14px;">No new tickets in the last 24 hours.</p>'}
  </div>

  <!-- Findings -->
  <div class="section">
    <div class="section-title"><span class="section-icon">&#128270;</span> Findings</div>
    ${data.findings.items.length > 0 ? `
    <table>
      <thead><tr><th>Severity</th><th>Finding</th><th>Category</th><th>Agent</th></tr></thead>
      <tbody>
        ${data.findings.items.map((f) => `<tr><td><span class="badge" style="background:${severityColor(f.severity)}20;color:${severityColor(f.severity)}">${escHtml(f.severity)}</span></td><td>${escHtml(f.finding.substring(0, 100))}</td><td>${escHtml(f.category || '-')}</td><td>${escHtml(f.agent || '-')}</td></tr>`).join('\n        ')}
      </tbody>
    </table>` : '<p style="color:#9ca3af;font-size:14px;">No findings in the last 24 hours.</p>'}
  </div>

  <!-- Memory Growth -->
  <div class="section">
    <div class="section-title"><span class="section-icon">&#129504;</span> Memory Growth</div>
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-value">${data.memory.semantic}</div><div class="stat-label">Semantic</div></div>
      <div class="stat-card"><div class="stat-value">${data.memory.episodic}</div><div class="stat-label">Episodic</div></div>
      <div class="stat-card"><div class="stat-value">${data.memory.procedural}</div><div class="stat-label">Procedural</div></div>
    </div>
  </div>

  <!-- Execution Log -->
  ${data.executions.items.length > 0 ? `
  <div class="section">
    <div class="section-title"><span class="section-icon">&#9881;</span> Recent Executions</div>
    <table>
      <thead><tr><th>Agent</th><th>Status</th><th>Duration</th><th>Cost</th><th>Task</th></tr></thead>
      <tbody>
        ${data.executions.items.map((e) => `<tr><td>${escHtml(e.agent)}</td><td><span class="badge" style="background:${statusColor(e.status)}20;color:${statusColor(e.status)}">${escHtml(e.status)}</span></td><td>${e.durationMs ? fmtDuration(e.durationMs) : '-'}</td><td>${fmtCost(e.cost)}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml((e.task || '-').substring(0, 80))}</td></tr>`).join('\n        ')}
      </tbody>
    </table>
  </div>` : ''}

  <!-- Next Actions -->
  <div class="section">
    <div class="section-title"><span class="section-icon">&#10148;</span> Suggested Next Actions</div>
    <ol class="action-list">
      ${data.nextActions.map((a) => `<li>${escHtml(a)}</li>`).join('\n      ')}
    </ol>
  </div>

  <!-- Footer -->
  <div class="footer">
    Generated by <strong>AskAlf</strong> on ${new Date(data.generatedAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}<br/>
    <a href="https://askalf.org">askalf.org</a>
  </div>

</div>
</body>
</html>`;
}

// ── Route registration ───────────────────────────────────────────────

export async function registerBriefingRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/v1/admin/briefing/daily
   * Returns structured JSON daily briefing data.
   */
  app.get(
    '/api/v1/admin/briefing/daily',
    { preHandler: [authMiddleware, requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await loadBriefingData();
        return data;
      } catch (err) {
        app.log.error(err, 'Failed to generate daily briefing');
        return reply.code(500).send({ error: 'Failed to generate daily briefing' });
      }
    },
  );

  /**
   * GET /api/v1/admin/briefing/daily/html
   * Returns a styled HTML page suitable for PDF printing.
   */
  app.get(
    '/api/v1/admin/briefing/daily/html',
    { preHandler: [authMiddleware, requireAdmin] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await loadBriefingData();
        const html = renderBriefingHtml(data);
        return reply.type('text/html').send(html);
      } catch (err) {
        app.log.error(err, 'Failed to generate daily briefing HTML');
        return reply.code(500).type('text/html').send('<h1>Error generating briefing</h1><p>Please try again later.</p>');
      }
    },
  );
}
