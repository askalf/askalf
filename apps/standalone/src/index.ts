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

  // 3. Migrations
  console.log('  [3/4] Running migrations...');
  try {
    const { readdir, readFile } = await import('fs/promises');
    const migrationsDir = join(process.cwd(), 'apps', 'forge', 'migrations');

    if (existsSync(migrationsDir)) {
      await db.query(`CREATE TABLE IF NOT EXISTS forge_migrations (id SERIAL PRIMARY KEY, name TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      const applied = new Set((await db.query<{ name: string }>('SELECT name FROM forge_migrations')).map(r => r.name));
      const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
      let count = 0;
      for (const file of files) {
        if (applied.has(file)) continue;
        try {
          await db.query(await readFile(join(migrationsDir, file), 'utf8'));
          await db.query('INSERT INTO forge_migrations (name) VALUES ($1)', [file]);
          count++;
        } catch {
          await db.query('INSERT INTO forge_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING', [file]);
        }
      }
      console.log(`  [3/4] ${count} migrations applied (${files.length} total).`);
    }
  } catch (err) {
    console.log(`  [3/4] Warning: ${err instanceof Error ? err.message : err}`);
  }

  // 4. API Server
  console.log('  [4/4] Starting server...');

  const app = Fastify({ logger: false });

  // Health
  app.get('/health', async () => ({
    status: 'ok',
    mode: 'standalone',
    database: 'pglite',
    cache: 'memory',
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
    const where = qs.status ? `WHERE status = '${qs.status}'` : '';
    try {
      const tickets = await db.query(`SELECT * FROM tickets ${where} ORDER BY created_at DESC LIMIT 50`);
      return { tickets, total: tickets.length };
    } catch {
      try {
        const tickets = await db.query(`SELECT * FROM agent_tickets ${where} ORDER BY created_at DESC LIMIT 50`);
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

  // Intent (chat with Alf)
  app.post('/api/v1/intent', async (req) => {
    const body = req.body as { message?: string };
    return {
      response: `Received: "${body?.message}". The full AI intent engine requires an API key configured in .env. Check ${join(config.dataDir, '.env')}`,
      intent: null,
    };
  });

  // Conversations
  app.get('/api/v1/conversations', async () => ({ conversations: [] }));
  app.post('/api/v1/conversations', async () => ({ id: 'standalone-' + Date.now() }));

  // Static dashboard placeholder
  app.get('/', async (_req, reply) => {
    reply.type('text/html').send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AskAlf</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0a0a14;color:#c8d6e5;font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{max-width:600px;width:100%;text-align:center}
h1{font-size:2rem;color:#00ff88;margin-bottom:8px}
.sub{color:rgba(200,214,229,.5);font-size:.9rem;margin-bottom:32px}
.status{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:32px}
.stat{background:rgba(0,255,136,.03);border:1px solid rgba(0,255,136,.08);border-radius:8px;padding:16px}
.stat-val{font-family:monospace;font-size:1.5rem;color:#00ff88;font-weight:700}
.stat-label{font-size:.75rem;color:rgba(200,214,229,.4);margin-top:4px;text-transform:uppercase;letter-spacing:.1em}
.links{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
.btn{font-family:monospace;font-size:12px;padding:10px 20px;border-radius:4px;text-decoration:none;border:1px solid rgba(0,255,136,.2);color:#00ff88;transition:all .2s}
.btn:hover{background:rgba(0,255,136,.1);border-color:#00ff88}
.btn-primary{background:#00ff88;color:#000;border-color:#00ff88}
.btn-primary:hover{background:#fff}
code{font-family:monospace;background:rgba(0,255,136,.08);padding:2px 8px;border-radius:3px;font-size:.85rem;color:#00ff88}
.next{margin-top:32px;text-align:left;background:rgba(0,255,136,.02);border:1px solid rgba(0,255,136,.06);border-radius:8px;padding:20px}
.next h3{color:#fff;font-size:.9rem;margin-bottom:12px}
.next li{color:rgba(200,214,229,.6);font-size:.85rem;line-height:2;list-style:none}
.next li::before{content:"→ ";color:#00ff88}
</style></head><body>
<div class="card">
<h1>AskAlf</h1>
<p class="sub">Standalone Mode — PGlite + In-Memory Cache</p>
<div class="status">
<div class="stat"><div class="stat-val">✓</div><div class="stat-label">Database</div></div>
<div class="stat"><div class="stat-val">✓</div><div class="stat-label">Cache</div></div>
<div class="stat"><div class="stat-val">✓</div><div class="stat-label">API</div></div>
<div class="stat"><div class="stat-val">:${config.port}</div><div class="stat-label">Port</div></div>
</div>
<div class="links">
<a href="/health" class="btn">API Health</a>
<a href="/api/v1/forge/agents" class="btn">Agents</a>
<a href="/api/v1/forge/templates" class="btn">Templates</a>
<a href="https://github.com/askalf/askalf" class="btn btn-primary">GitHub</a>
</div>
<div class="next">
<h3>Next Steps</h3>
<ul>
<li>Add your API key to <code>${join(config.dataDir, '.env')}</code></li>
<li>Full dashboard requires Docker: <code>curl -fsSL https://get.askalf.org | bash</code></li>
<li>Join Discord: <a href="https://discord.gg/fENVZpdYcX" style="color:#00ff88">discord.gg/fENVZpdYcX</a></li>
</ul>
</div>
</div></body></html>`);
  });

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
