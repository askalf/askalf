#!/usr/bin/env node

/**
 * AskAlf Standalone Server
 *
 * Boots a working AskAlf instance in a single process.
 * PGlite database, in-memory cache, Fastify API server.
 */

import { createAdapter } from '@askalf/database-adapter';
import { createRedisAdapter } from '@askalf/redis-adapter';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';

process.env['ASKALF_MODE'] = 'standalone';
process.env['SELFHOSTED'] = 'true';
process.env['NODE_ENV'] = 'production';

const DEFAULT_PORT = 3000;

function getConfig() {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  const port = portIdx !== -1 ? parseInt(args[portIdx + 1]!, 10) : (parseInt(process.env['PORT'] || '', 10) || DEFAULT_PORT);

  const dataDir = process.env['ASKALF_DATA_DIR']
    || (process.platform === 'win32'
      ? join(process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'), 'askalf')
      : join(homedir(), '.askalf'));

  return { port, dataDir };
}

async function main() {
  const config = getConfig();

  console.log('');
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║          AskAlf Standalone             ║');
  console.log('  ║    No Docker. No Postgres. No Redis.   ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log('');
  console.log(`  Data:  ${config.dataDir}`);
  console.log(`  Port:  ${config.port}`);
  console.log('');

  for (const sub of [config.dataDir, join(config.dataDir, 'data'), join(config.dataDir, 'logs')]) {
    if (!existsSync(sub)) mkdirSync(sub, { recursive: true });
  }

  // 1. PGlite
  console.log('  [1/4] Starting PGlite database...');
  const db = await createAdapter({
    mode: 'pglite',
    dataDir: join(config.dataDir, 'data', 'pglite'),
  });
  console.log('  [1/4] Database ready.');

  // 2. In-memory cache
  console.log('  [2/4] Starting in-memory cache...');
  const redis = createRedisAdapter({ mode: 'memory' });
  console.log('  [2/4] Cache ready.');

  // 3. Schema & seed data
  console.log('  [3/4] Setting up database...');
  try {
    // Create core tables (PGlite-compatible — no extensions, no complex types)
    await db.query(`CREATE TABLE IF NOT EXISTS forge_agents (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT DEFAULT 'worker', status TEXT DEFAULT 'active',
      description TEXT, system_prompt TEXT, model_id TEXT DEFAULT 'claude-haiku-4-5',
      schedule_cron TEXT, tasks_completed INTEGER DEFAULT 0, tasks_failed INTEGER DEFAULT 0,
      tenant_id TEXT DEFAULT 'default', created_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS forge_agent_templates (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, category TEXT,
      is_active BOOLEAN DEFAULT true, system_prompt TEXT, model_id TEXT DEFAULT 'claude-haiku-4-5',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS forge_executions (
      id TEXT PRIMARY KEY, agent_id TEXT, owner_id TEXT, tenant_id TEXT DEFAULT 'default',
      input TEXT, output TEXT, status TEXT DEFAULT 'pending', cost NUMERIC DEFAULT 0,
      metadata JSONB, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY, title TEXT, description TEXT, status TEXT DEFAULT 'open',
      priority TEXT DEFAULT 'medium', category TEXT, created_by TEXT, assigned_to TEXT,
      resolution TEXT, source TEXT DEFAULT 'system', is_agent_ticket BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), deleted_at TIMESTAMPTZ
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS platform_settings (
      key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY, title TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`INSERT INTO platform_settings (key, value) VALUES ('onboarding_completed', 'false') ON CONFLICT DO NOTHING`);
    console.log('  [3/4] Schema ready.');
  } catch (err) {
    console.log(`  [3/4] Schema warning: ${err instanceof Error ? err.message : err}`);
  }

  // 3b. Seed default data if fresh install
  try {
    const templateCount = await db.query<{ count: string }>('SELECT COUNT(*)::text as count FROM forge_agent_templates');
    if (parseInt(templateCount[0]?.count || '0') === 0) {
      console.log('  [3/4] Seeding templates and agents...');
      const categories = [
        { cat: 'Software Dev', items: ['Full-Stack Builder', 'Code Reviewer', 'CI/CD Manager', 'Bug Triage', 'Security Auditor'] },
        { cat: 'DevOps', items: ['Infrastructure Monitor', 'Deploy Manager', 'Log Analyzer', 'Cost Optimizer', 'Backup Agent'] },
        { cat: 'Marketing', items: ['Content Writer', 'SEO Analyst', 'Social Media Manager', 'Campaign Tracker', 'Brand Monitor'] },
        { cat: 'Support', items: ['Ticket Responder', 'FAQ Builder', 'Escalation Manager', 'Satisfaction Tracker', 'Onboarding Guide'] },
        { cat: 'E-Commerce', items: ['Order Manager', 'Inventory Tracker', 'Review Responder', 'Price Monitor', 'Returns Processor'] },
        { cat: 'Research', items: ['Deep Researcher', 'Competitive Analyst', 'Data Synthesizer', 'Trend Spotter', 'Report Generator'] },
        { cat: 'Finance', items: ['Invoice Chaser', 'Expense Categorizer', 'Budget Tracker', 'Revenue Reporter', 'Compliance Monitor'] },
        { cat: 'Personal', items: ['Daily Briefer', 'Email Triager', 'Calendar Optimizer', 'Reading Summarizer', 'Task Prioritizer'] },
        { cat: 'Agency', items: ['Client Communicator', 'Brief Analyzer', 'Project Tracker', 'Asset Organizer', 'Timesheet Manager'] },
        { cat: 'Custom', items: ['General Assistant', 'Workflow Automator', 'Integration Builder', 'Notification Manager', 'Data Migrator'] },
      ];
      for (const { cat, items } of categories) {
        for (const name of items) {
          await db.query(
            `INSERT INTO forge_agent_templates (id, name, description, category, is_active, created_at)
             VALUES (gen_random_uuid()::text, $1, $2, $3, true, NOW()) ON CONFLICT DO NOTHING`,
            [name, `${name} agent for ${cat.toLowerCase()} workflows`, cat],
          ).catch(() => {});
        }
      }

      // Seed default fleet agents
      const defaultAgents = [
        { name: 'Watchdog', type: 'monitor', desc: 'Monitors system health, detects anomalies, creates tickets for issues' },
        { name: 'Builder', type: 'worker', desc: 'Claims tickets, writes code, fixes bugs, deploys changes autonomously' },
        { name: 'Fleet Chief', type: 'meta', desc: 'Coordinates the fleet, evolves agent prompts, creates new agents when gaps are found' },
      ];
      for (const agent of defaultAgents) {
        await db.query(
          `INSERT INTO forge_agents (id, name, type, status, description, tasks_completed, tasks_failed, tenant_id, created_at)
           VALUES (gen_random_uuid()::text, $1, $2, 'active', $3, 0, 0, 'default', NOW()) ON CONFLICT DO NOTHING`,
          [agent.name, agent.type, agent.desc],
        ).catch(() => {});
      }
      console.log(`  [3/4] Seeded ${categories.reduce((s, c) => s + c.items.length, 0)} templates, ${defaultAgents.length} agents.`);
    }
  } catch {}

  // 4. API Server
  console.log('  [4/4] Starting server...');

  const app = Fastify({ logger: false });

  // Detect available AI providers
  const claudeCredsPath = join(homedir(), '.claude', '.credentials.json');
  const hasOauth = (() => { try { return !!JSON.parse(readFileSync(claudeCredsPath, 'utf-8'))?.claudeAiOauth?.refreshToken; } catch { return false; } })();
  const providers: string[] = [];
  if (hasOauth) providers.push('claude-oauth');
  if (process.env['ANTHROPIC_API_KEY']) providers.push('anthropic-api');
  if (process.env['OPENAI_API_KEY']) providers.push('openai-api');
  providers.push('ollama-local'); // always available as fallback attempt
  console.log(`  ✓ AI providers: ${providers.filter(p => p !== 'ollama-local').join(', ') || 'ollama (local only)'}`);

  // Health
  app.get('/health', async () => ({
    status: 'ok',
    mode: 'standalone',
    database: 'pglite',
    cache: 'memory',
    providers,
    uptime: process.uptime(),
  }));

  // Agent list
  app.get('/api/v1/forge/agents', async () => {
    try {
      const agents = await db.query('SELECT id, name, status, type, description, tasks_completed, tasks_failed FROM forge_agents WHERE deleted_at IS NULL ORDER BY name');
      return { agents };
    } catch { return { agents: [] }; }
  });

  // Agent templates
  app.get('/api/v1/forge/templates', async () => {
    try {
      const templates = await db.query('SELECT id, name, description, category FROM forge_agent_templates WHERE is_active = true ORDER BY category, name');
      return { templates };
    } catch { return { templates: [] }; }
  });

  // Executions
  app.get('/api/v1/admin/executions', async (req) => {
    const qs = req.query as { limit?: string };
    const limit = Math.min(parseInt(qs.limit || '20', 10), 100);
    try {
      const executions = await db.query(`SELECT id, agent_id, status, input, output, cost, created_at FROM forge_executions ORDER BY created_at DESC LIMIT $1`, [limit]);
      return { executions };
    } catch { return { executions: [] }; }
  });

  // Tickets
  app.get('/api/v1/admin/tickets', async (req) => {
    const qs = req.query as { status?: string };
    const params: unknown[] = [];
    let where = '';
    if (qs.status) {
      where = 'WHERE status = $1';
      params.push(qs.status);
    }
    try {
      const tickets = await db.query(`SELECT * FROM tickets ${where} ORDER BY created_at DESC LIMIT 50`, params);
      return { tickets, total: tickets.length };
    } catch {
      try {
        const tickets = await db.query(`SELECT * FROM agent_tickets ${where} ORDER BY created_at DESC LIMIT 50`, params);
        return { tickets, total: tickets.length };
      } catch { return { tickets: [], total: 0 }; }
    }
  });

  // Costs
  app.get('/api/v1/admin/costs', async () => {
    try {
      const result = await db.query<{ total: string; count: string }>(`SELECT COALESCE(SUM(cost), 0)::text as total, COUNT(*)::text as count FROM forge_executions WHERE created_at > NOW() - INTERVAL '24 hours'`);
      return { totals: { totalCost: parseFloat(result[0]?.total || '0'), executionCount: parseInt(result[0]?.count || '0', 10) } };
    } catch { return { totals: { totalCost: 0, executionCount: 0 } }; }
  });

  // Onboarding status
  app.get('/api/v1/onboarding/status', async () => {
    try {
      const r = await db.query("SELECT value FROM platform_settings WHERE key = 'onboarding_completed'");
      return { completed: r[0]?.value === 'true' };
    } catch { return { completed: false }; }
  });

  // ── Universal AI provider for intent/chat ──
  const ALF_SYSTEM = `You are Alf — an AI workforce builder. When someone describes what they need, you design an AI agent team. Name each agent with a clear role, describe what it does autonomously, show the schedule, and end with a monthly cost estimate. Keep it under 200 words, conversational, no markdown headers.`;

  async function callAI(message: string): Promise<string> {
    const anthropicKey = process.env['ANTHROPIC_API_KEY'];
    const openaiKey = process.env['OPENAI_API_KEY'];
    const ollamaUrl = process.env['OLLAMA_URL'] || 'http://localhost:11434';
    const ollamaModel = process.env['OLLAMA_MODEL'] || 'llama3.2';

    // 1. Try Claude OAuth (via CLI — uses subscription, no API key needed)
    const claudeCredsPath = join(homedir(), '.claude', '.credentials.json');
    if (existsSync(claudeCredsPath)) {
      try {
        const creds = JSON.parse(readFileSync(claudeCredsPath, 'utf-8'));
        if (creds?.claudeAiOauth?.refreshToken) {
          const { execSync: exec } = await import('node:child_process');
          const result = exec(`echo ${JSON.stringify(message)} | claude --print --model claude-haiku-4-5`, {
            timeout: 30000,
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, CLAUDE_SYSTEM_PROMPT: ALF_SYSTEM },
          });
          if (result.trim()) return result.trim();
        }
      } catch { /* fall through to next provider */ }
    }

    // 2. Try Anthropic API key
    if (anthropicKey) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: 500, system: ALF_SYSTEM, messages: [{ role: 'user', content: message }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json() as { content: { text: string }[] };
        return data.content[0]?.text || '';
      }
    }

    // 3. Try OpenAI API key
    if (openaiKey) {
      const baseUrl = process.env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1';
      const model = process.env['OPENAI_MODEL'] || 'gpt-4o-mini';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: 'system', content: ALF_SYSTEM }, { role: 'user', content: message }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json() as { choices: { message: { content: string } }[] };
        return data.choices[0]?.message?.content || '';
      }
    }

    // 4. Try Ollama (local)
    try {
      const res = await fetch(`${ollamaUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ollamaModel, stream: false, messages: [{ role: 'system', content: ALF_SYSTEM }, { role: 'user', content: message }] }),
        signal: AbortSignal.timeout(60000),
      });
      if (res.ok) {
        const data = await res.json() as { message?: { content: string } };
        return data.message?.content || '';
      }
    } catch { /* ollama not running */ }

    // 5. Nothing available
    return `No AI provider configured. AskAlf supports:\n• Claude OAuth (claude login)\n• Anthropic API key (ANTHROPIC_API_KEY)\n• OpenAI API key (OPENAI_API_KEY)\n• Ollama local (OLLAMA_URL)\n\nConfigure any one in ${join(config.dataDir, '.env')} and restart.`;
  }

  // Intent (chat with Alf) — universal provider
  app.post('/api/v1/intent', async (req) => {
    const body = req.body as { message?: string };
    const message = (body?.message || '').trim();
    if (!message) return { response: 'Send a message to get started.', intent: null };

    try {
      const response = await callAI(message);
      return { response, intent: null };
    } catch (err) {
      return { response: `Error: ${err instanceof Error ? err.message : String(err)}`, intent: null };
    }
  });

  // Conversations
  app.get('/api/v1/conversations', async () => ({ conversations: [] }));
  app.post('/api/v1/conversations', async () => ({ id: 'standalone-' + Date.now() }));

  // Serve the full dashboard UI if it's been built
  const dashboardDir = join(process.cwd(), 'apps', 'dashboard', 'public', 'app');
  const hasDashboard = existsSync(join(dashboardDir, 'index.html'));

  if (hasDashboard) {
    // Serve static assets from the Vite build
    await app.register(await import('@fastify/static').then(m => m.default), {
      root: dashboardDir,
      prefix: '/',
    });

    // Cache the index.html for SPA fallback
    const indexHtml = readFileSync(join(dashboardDir, 'index.html'), 'utf-8');

    // SPA fallback — serve index.html for all non-API, non-asset routes
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url === '/health') {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.type('text/html').send(indexHtml);
    });

    console.log('  ✓ Dashboard UI loaded');
  } else {
    // Fallback: minimal status page
    app.get('/', async (_req, reply) => {
      reply.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AskAlf</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{background:#030306;color:#e8e8ec;font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;text-align:center}.logo{font-size:2rem;font-weight:700;color:#00ff88;margin-bottom:8px}.sub{color:rgba(232,232,236,.4);font-size:.9rem;margin-bottom:2rem}code{font-family:monospace;background:rgba(0,255,136,.08);padding:2px 8px;border-radius:3px;color:#00ff88}a{color:#00ff88}</style></head><body>
<div><div class="logo">AskAlf</div><p class="sub">Server running. Dashboard not yet built.</p>
<p style="color:rgba(232,232,236,.4);font-size:.85rem;line-height:2">
Build the dashboard:<br><code>cd apps/dashboard/client && npm install && npm run build</code><br><br>
Then restart the server.<br><br>
<a href="/health">API Health</a> · <a href="https://github.com/askalf/askalf">GitHub</a> · <a href="https://discord.gg/fENVZpdYcX">Discord</a>
</p></div></body></html>`);
    });
  }

  // CORS
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  });

  await app.listen({ port: config.port, host: '0.0.0.0' });

  console.log('  [4/4] Server ready.');
  console.log('');
  console.log(`  Open:  http://localhost:${config.port}`);
  console.log(`  API:   http://localhost:${config.port}/health`);
  console.log('');
  console.log('  Press Ctrl+C to stop.');

  process.on('SIGINT', async () => {
    console.log('\n  Shutting down...');
    await app.close();
    await redis.quit();
    await db.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start AskAlf:', err);
  process.exit(1);
});
