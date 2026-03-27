/**
 * Report Builder
 * Generates daily/weekly summary reports and dispatches to Discord or email.
 */

import { query, queryOne } from '../database.js';
import { substrateQuery, substrateQueryOne } from '../database.js';
import { ulid } from 'ulid';

interface ReportSchedule {
  id: string;
  name: string;
  report_type: string;
  schedule_hour: number;
  schedule_day_of_week: number;
  include_sections: string[];
  recipients: { type: string; url?: string; address?: string }[];
  is_enabled: boolean;
  last_sent_at: string | null;
}

interface ReportMetrics {
  agents: { total: number; active: number; errored: number };
  executions: { total: number; completed: number; failed: number; running: number };
  cost: { total: number; byAgent: { name: string; cost: number }[] };
  tickets: { open: number; closed: number; created: number };
  findings: { critical: number; warning: number; info: number };
}

interface GeneratedReport {
  id: string;
  type: string;
  period: { start: Date; end: Date };
  metrics: ReportMetrics;
  summary: string;
  sections: Record<string, string>;
}

export async function generateReport(type: 'daily' | 'weekly', sections: string[]): Promise<GeneratedReport> {
  const now = new Date();
  const periodStart = new Date(now);
  if (type === 'daily') {
    periodStart.setDate(periodStart.getDate() - 1);
  } else {
    periodStart.setDate(periodStart.getDate() - 7);
  }

  const interval = type === 'daily' ? '24 hours' : '7 days';

  // Gather metrics
  const [
    agentStats, execStats, costStats, ticketStats, findingStats,
    topAgents, recentFindings,
  ] = await Promise.all([
    query<Record<string, unknown>>('SELECT status, COUNT(*)::int as count FROM forge_agents WHERE deleted_at IS NULL GROUP BY status'),
    query<Record<string, unknown>>(`SELECT status, COUNT(*)::int as count FROM forge_executions WHERE created_at > NOW() - INTERVAL '${interval}' GROUP BY status`),
    queryOne<{ total: string }>(`SELECT COALESCE(SUM(cost), 0)::text as total FROM forge_executions WHERE created_at > NOW() - INTERVAL '${interval}'`),
    Promise.all([
      substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM agent_tickets WHERE status IN ('open','in_progress') AND deleted_at IS NULL`),
      substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM agent_tickets WHERE status = 'closed' AND updated_at > NOW() - INTERVAL '${interval}'`),
      substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM agent_tickets WHERE created_at > NOW() - INTERVAL '${interval}' AND deleted_at IS NULL`),
    ]),
    Promise.all([
      substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM agent_findings WHERE severity = 'critical' AND created_at > NOW() - INTERVAL '${interval}'`).catch(() => ({ count: '0' })),
      substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM agent_findings WHERE severity = 'warning' AND created_at > NOW() - INTERVAL '${interval}'`).catch(() => ({ count: '0' })),
      substrateQueryOne<{ count: string }>(`SELECT COUNT(*)::text as count FROM agent_findings WHERE severity = 'info' AND created_at > NOW() - INTERVAL '${interval}'`).catch(() => ({ count: '0' })),
    ]),
    query<{ name: string; cost: string }>(`SELECT a.name, COALESCE(SUM(e.cost), 0)::text as cost FROM forge_executions e JOIN forge_agents a ON a.id = e.agent_id WHERE e.created_at > NOW() - INTERVAL '${interval}' GROUP BY a.name ORDER BY SUM(e.cost) DESC LIMIT 10`),
    substrateQuery<Record<string, unknown>>(`SELECT * FROM agent_findings WHERE created_at > NOW() - INTERVAL '${interval}' ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, created_at DESC LIMIT 10`).catch(() => []),
  ]);

  const agentTotal = agentStats.reduce((s, r) => s + (r['count'] as number), 0);
  const agentActive = agentStats.find(r => r['status'] === 'active')?.['count'] as number || 0;
  const agentErrored = agentStats.find(r => r['status'] === 'error')?.['count'] as number || 0;

  const execTotal = execStats.reduce((s, r) => s + (r['count'] as number), 0);
  const execCompleted = execStats.find(r => r['status'] === 'completed')?.['count'] as number || 0;
  const execFailed = execStats.find(r => r['status'] === 'failed')?.['count'] as number || 0;
  const execRunning = execStats.find(r => r['status'] === 'running')?.['count'] as number || 0;

  const metrics: ReportMetrics = {
    agents: { total: agentTotal, active: agentActive, errored: agentErrored },
    executions: { total: execTotal, completed: execCompleted, failed: execFailed, running: execRunning },
    cost: {
      total: parseFloat(costStats?.total || '0'),
      byAgent: topAgents.map(a => ({ name: a.name, cost: parseFloat(a.cost) })),
    },
    tickets: {
      open: parseInt(ticketStats[0]?.count || '0'),
      closed: parseInt(ticketStats[1]?.count || '0'),
      created: parseInt(ticketStats[2]?.count || '0'),
    },
    findings: {
      critical: parseInt(findingStats[0]?.count || '0'),
      warning: parseInt(findingStats[1]?.count || '0'),
      info: parseInt(findingStats[2]?.count || '0'),
    },
  };

  // Build summary
  const successRate = execTotal > 0 ? Math.round((execCompleted / execTotal) * 100) : 100;
  const period = type === 'daily' ? 'Today' : 'This Week';
  const lines: string[] = [];

  lines.push(`**AskAlf ${type === 'daily' ? 'Daily' : 'Weekly'} Report** — ${now.toLocaleDateString()}`);
  lines.push('');

  if (sections.includes('metrics')) {
    lines.push('**Fleet Status**');
    lines.push(`- ${agentTotal} agents (${agentActive} active, ${agentErrored} errored)`);
    lines.push(`- ${execTotal} executions ${period.toLowerCase()} (${successRate}% success)`);
    lines.push('');
  }

  if (sections.includes('cost')) {
    lines.push('**Cost**');
    lines.push(`- Total spend: $${metrics.cost.total.toFixed(4)}`);
    if (metrics.cost.byAgent.length > 0) {
      const top3 = metrics.cost.byAgent.slice(0, 3);
      lines.push(`- Top spenders: ${top3.map(a => `${a.name} ($${a.cost.toFixed(4)})`).join(', ')}`);
    }
    lines.push('');
  }

  if (sections.includes('findings') && (metrics.findings.critical > 0 || metrics.findings.warning > 0)) {
    lines.push('**Findings**');
    if (metrics.findings.critical > 0) lines.push(`- ${metrics.findings.critical} critical`);
    if (metrics.findings.warning > 0) lines.push(`- ${metrics.findings.warning} warnings`);
    lines.push('');
  }

  if (sections.includes('activity')) {
    lines.push('**Tickets**');
    lines.push(`- ${metrics.tickets.created} created, ${metrics.tickets.closed} closed, ${metrics.tickets.open} open`);
    lines.push('');
  }

  const summary = lines.join('\n');

  const reportSections: Record<string, string> = {};
  if (sections.includes('findings') && recentFindings.length > 0) {
    reportSections['findings'] = recentFindings.map(f =>
      `[${f['severity']}] ${f['finding']}`
    ).join('\n');
  }

  return {
    id: ulid(),
    type,
    period: { start: periodStart, end: now },
    metrics,
    summary,
    sections: reportSections,
  };
}

async function getSmtpConfig(): Promise<{ host: string; port: number; user: string; pass: string; from: string } | null> {
  // Check env vars first, then platform_settings
  const host = process.env['SMTP_HOST'];
  const port = process.env['SMTP_PORT'];
  const user = process.env['SMTP_USER'];
  const pass = process.env['SMTP_PASS'];
  const from = process.env['SMTP_FROM'] || 'noreply@askalf.org';

  if (host && port) {
    return { host, port: parseInt(port), user: user || '', pass: pass || '', from };
  }

  // Try platform_settings
  try {
    const settings = await query<{ key: string; value: string }>(
      `SELECT key, value FROM platform_settings WHERE key IN ('SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','SMTP_FROM')`,
    );
    const map: Record<string, string> = {};
    for (const s of settings) map[s.key] = s.value;
    if (map['SMTP_HOST'] && map['SMTP_PORT']) {
      return {
        host: map['SMTP_HOST'],
        port: parseInt(map['SMTP_PORT']),
        user: map['SMTP_USER'] || '',
        pass: map['SMTP_PASS'] || '',
        from: map['SMTP_FROM'] || 'noreply@askalf.org',
      };
    }
  } catch { /* ignore */ }

  return null;
}

async function sendEmailReport(to: string, report: GeneratedReport): Promise<boolean> {
  const smtp = await getSmtpConfig();
  if (!smtp) {
    console.log(`[ReportBuilder] No SMTP configured — skipping email to ${to}`);
    return false;
  }

  try {
    const subject = `AskAlf ${report.type === 'daily' ? 'Daily' : 'Weekly'} Report — ${new Date().toLocaleDateString()}`;
    const htmlBody = report.summary
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>')
      .replace(/- /g, '&bull; ');
    const html = `<div style="font-family:system-ui,sans-serif;max-width:600px;padding:20px;color:#333">${htmlBody}</div>`;

    // Use fetch to send via a simple HTTP-to-SMTP bridge, or raw SMTP via net
    const { createConnection } = await import('net');
    const { connect: tlsConnect } = await import('tls');

    const sent = await new Promise<boolean>((resolve) => {
      const secure = smtp.port === 465;
      const connectFn = secure ? () => tlsConnect({ host: smtp.host, port: smtp.port }) : () => createConnection(smtp.port, smtp.host);
      const socket = connectFn();
      let step = 0;
      const boundary = `----askalf${Date.now()}`;

      const commands = [
        `EHLO askalf.org`,
        ...(smtp.user ? [`AUTH LOGIN`, Buffer.from(smtp.user).toString('base64'), Buffer.from(smtp.pass).toString('base64')] : []),
        `MAIL FROM:<${smtp.from}>`,
        `RCPT TO:<${to}>`,
        `DATA`,
        `From: AskAlf <${smtp.from}>\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${report.summary}\r\n\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n\r\n--${boundary}--\r\n.`,
        `QUIT`,
      ];

      socket.on('data', (data: Buffer) => {
        const line = data.toString();
        if (line.startsWith('2') || line.startsWith('3')) {
          if (step < commands.length) {
            socket.write(commands[step]! + '\r\n');
            step++;
          }
        } else if (line.startsWith('5') || line.startsWith('4')) {
          console.error(`[ReportBuilder] SMTP error: ${line.trim()}`);
          socket.end();
          resolve(false);
        }
      });

      socket.on('end', () => resolve(step >= commands.length - 1));
      socket.on('error', (err: Error) => { console.error(`[ReportBuilder] SMTP socket error: ${err.message}`); resolve(false); });
      setTimeout(() => { socket.end(); resolve(false); }, 15000);
    });

    if (sent) console.log(`[ReportBuilder] Email sent to ${to}`);
    return sent;
  } catch (err) {
    console.error(`[ReportBuilder] Email failed to ${to}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function sendToDiscordWebhook(webhookUrl: string, content: string): Promise<boolean> {
  try {
    // Discord webhook limit is 2000 chars
    const text = content.length > 1950 ? content.substring(0, 1950) + '...' : content;
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text }),
    });
    return res.ok;
  } catch (err) {
    console.error('[ReportBuilder] Discord webhook failed:', err);
    return false;
  }
}

export async function dispatchReport(report: GeneratedReport, recipients: ReportSchedule['recipients']): Promise<{ recipient: string; sent: boolean; error?: string }[]> {
  const results: { recipient: string; sent: boolean; error?: string }[] = [];

  for (const r of recipients) {
    if (r.type === 'discord_webhook' && r.url) {
      const sent = await sendToDiscordWebhook(r.url, report.summary);
      results.push({ recipient: `discord:${r.url.substring(0, 40)}...`, sent, error: sent ? undefined : 'Webhook delivery failed' });
    } else if (r.type === 'email' && r.address) {
      const sent = await sendEmailReport(r.address, report);
      results.push({ recipient: `email:${r.address}`, sent, error: sent ? undefined : 'Email delivery failed (check SMTP settings)' });
    }
  }

  return results;
}

export async function saveReport(report: GeneratedReport, scheduleId: string | null, deliveryStatus: unknown[]): Promise<void> {
  await query(
    `INSERT INTO generated_reports (id, schedule_id, report_type, period_start, period_end, content, summary_text, metrics_snapshot, delivery_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      report.id,
      scheduleId,
      report.type,
      report.period.start.toISOString(),
      report.period.end.toISOString(),
      JSON.stringify({ sections: report.sections }),
      report.summary,
      JSON.stringify(report.metrics),
      JSON.stringify(deliveryStatus),
    ],
  );
}

export async function getActiveSchedules(): Promise<ReportSchedule[]> {
  return query<ReportSchedule>('SELECT * FROM report_schedules WHERE is_enabled = true');
}

export async function checkAndRunSchedules(): Promise<void> {
  const schedules = await getActiveSchedules();
  const now = new Date();
  const currentHour = now.getUTCHours();
  const currentDay = now.getUTCDay();

  for (const schedule of schedules) {
    if (schedule.schedule_hour !== currentHour) continue;
    if (schedule.report_type === 'weekly' && schedule.schedule_day_of_week !== currentDay) continue;

    // Check if already sent today
    if (schedule.last_sent_at) {
      const lastSent = new Date(schedule.last_sent_at);
      const hoursSince = (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);
      if (schedule.report_type === 'daily' && hoursSince < 20) continue;
      if (schedule.report_type === 'weekly' && hoursSince < 160) continue;
    }

    try {
      const report = await generateReport(
        schedule.report_type as 'daily' | 'weekly',
        schedule.include_sections || ['metrics', 'activity', 'findings', 'cost'],
      );
      const deliveryStatus = await dispatchReport(report, schedule.recipients || []);
      await saveReport(report, schedule.id, deliveryStatus);
      await query('UPDATE report_schedules SET last_sent_at = NOW(), updated_at = NOW() WHERE id = $1', [schedule.id]);
      console.log(`[ReportBuilder] Sent ${schedule.report_type} report "${schedule.name}"`);
    } catch (err) {
      console.error(`[ReportBuilder] Failed to run schedule "${schedule.name}":`, err);
    }
  }
}
