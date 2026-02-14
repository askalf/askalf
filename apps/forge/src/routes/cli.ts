/**
 * Master CLI endpoint — interprets natural language commands
 * from the dashboard Command Center.
 *
 * Simple commands are handled directly (agent status, list tickets, etc.)
 * Complex commands dispatch agent executions.
 */

import type { FastifyInstance } from 'fastify';
import { query, queryOne } from '../database.js';
import { substrateQuery } from '../database.js';

// Build a map of agent_id → name from forge DB (cached in memory)
let agentNameCache: Map<string, string> | null = null;

async function getAgentNames(): Promise<Map<string, string>> {
  if (agentNameCache) return agentNameCache;
  const agents = await query<{ id: string; name: string }>('SELECT id, name FROM forge_agents');
  agentNameCache = new Map(agents.map(a => [a.id, a.name]));
  // Refresh every 5 minutes
  setTimeout(() => { agentNameCache = null; }, 300_000);
  return agentNameCache;
}

export async function cliRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/forge/cli', async (request, reply) => {
    const { command } = request.body as { command: string };
    if (!command?.trim()) {
      return reply.status(400).send({ error: 'Command is required' });
    }

    const cmd = command.trim().toLowerCase();

    try {
      // Agent status commands
      if (cmd.includes('agent') && (cmd.includes('status') || cmd.includes('show') || cmd.includes('list'))) {
        const agents = await query<{
          name: string; status: string; autonomy_level: number;
        }>(
          `SELECT name, status, autonomy_level FROM forge_agents ORDER BY name`
        );
        const lines = agents.map(a => {
          const tag = a.status === 'running' ? '[RUNNING]' : a.status === 'error' ? '[ERROR]' : a.status === 'paused' ? '[PAUSED]' : '[IDLE]';
          return `  ${tag} ${a.name} (autonomy ${a.autonomy_level})`;
        });
        return { result: `Fleet Status (${agents.length} agents):\n${lines.join('\n')}` };
      }

      // Ticket commands
      if (cmd.includes('ticket') && (cmd.includes('list') || cmd.includes('open') || cmd.includes('show'))) {
        const tickets = await substrateQuery<{
          title: string; status: string; priority: string; assigned_to: string | null;
        }>(
          `SELECT title, status, priority, assigned_to
           FROM agent_tickets WHERE status IN ('open', 'in_progress')
           ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END
           LIMIT 15`
        );
        if (tickets.length === 0) return { result: 'No open tickets.' };
        const lines = tickets.map(t =>
          `  [${t.priority.toUpperCase()}] ${t.title} -- ${t.status}${t.assigned_to ? ` (${t.assigned_to})` : ''}`
        );
        return { result: `Open Tickets (${tickets.length}):\n${lines.join('\n')}` };
      }

      // Intervention commands
      if (cmd.includes('intervention') || (cmd.includes('pending') && cmd.includes('review'))) {
        const interventions = await substrateQuery<{
          title: string; agent_id: string; created_at: string;
        }>(
          `SELECT title, agent_id, created_at
           FROM agent_interventions
           WHERE status = 'pending'
           ORDER BY created_at ASC LIMIT 10`
        );
        if (interventions.length === 0) return { result: 'No pending interventions.' };
        const names = await getAgentNames();
        const lines = interventions.map(i =>
          `  ${names.get(i.agent_id) || 'Unknown'}: ${i.title}`
        );
        return { result: `Pending Interventions (${interventions.length}):\n${lines.join('\n')}` };
      }

      // Finding commands
      if (cmd.includes('finding') && (cmd.includes('list') || cmd.includes('show') || cmd.includes('critical'))) {
        const findings = await substrateQuery<{
          severity: string; category: string; finding: string; agent_id: string;
        }>(
          `SELECT severity, category, finding, agent_id
           FROM agent_findings
           ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'warning' THEN 2 ELSE 3 END, created_at DESC
           LIMIT 10`
        );
        if (findings.length === 0) return { result: 'No findings.' };
        const names = await getAgentNames();
        const lines = findings.map(f =>
          `  [${f.severity.toUpperCase()}] ${names.get(f.agent_id) || 'Unknown'}: ${f.finding}`
        );
        return { result: `Recent Findings (${findings.length}):\n${lines.join('\n')}` };
      }

      // Execution stats
      if (cmd.includes('execution') || (cmd.includes('task') && cmd.includes('stat'))) {
        const stats = await query<{ status: string; count: string }>(
          `SELECT status, COUNT(*)::text as count FROM forge_executions
           WHERE created_at > NOW() - INTERVAL '24 hours'
           GROUP BY status`
        );
        if (stats.length === 0) return { result: 'No executions in last 24 hours.' };
        const lines = stats.map(s => `  ${s.status}: ${s.count}`);
        return { result: `Executions (last 24h):\n${lines.join('\n')}` };
      }

      // Run agent
      if (cmd.startsWith('run ') || cmd.startsWith('execute ') || cmd.startsWith('start ')) {
        const agentName = command.replace(/^(run|execute|start)\s+/i, '').trim();
        const agent = await queryOne<{ id: string; name: string }>(
          `SELECT id, name FROM forge_agents WHERE LOWER(name) LIKE $1 LIMIT 1`,
          [`%${agentName.toLowerCase()}%`]
        );
        if (!agent) return { result: `Agent not found: "${agentName}"` };

        // Create execution
        const { ulid } = await import('ulid');
        const execId = ulid();
        await query(
          `INSERT INTO forge_executions (id, agent_id, status, input, created_at)
           VALUES ($1, $2, 'pending', $3, NOW())`,
          [execId, agent.id, JSON.stringify({ prompt: 'Run triggered via CLI', source: 'cli' })]
        );

        // Dispatch
        try {
          const { runDirectCliExecution } = await import('../runtime/worker.js');
          void runDirectCliExecution(execId, agent.id, 'Run triggered via CLI', 'cli-user');
        } catch {
          // Worker not available, execution will stay pending
        }

        return { result: `Execution ${execId} started for ${agent.name}` };
      }

      // Help
      if (cmd === 'help' || cmd === '?') {
        return {
          result: [
            'Available commands:',
            '  show agent status    -- Fleet overview',
            '  list open tickets    -- Open tickets by priority',
            '  show interventions   -- Pending approval items',
            '  show findings        -- Recent findings',
            '  execution stats      -- 24h execution summary',
            '  run <agent name>     -- Start agent execution',
            '  help                 -- This message',
          ].join('\n'),
        };
      }

      // Unknown command
      return {
        result: `Unknown command: "${command}"\nType "help" for available commands.`,
      };
    } catch (err) {
      return reply.status(500).send({
        error: `CLI error: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}
