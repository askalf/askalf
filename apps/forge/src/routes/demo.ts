/**
 * Demo Routes — Anonymous sessions for demo.askalf.org
 * Budget-capped, tool-restricted, time-limited demo experience.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { randomBytes, createHash } from 'crypto';
import { query, queryOne } from '../database.js';
import { query, queryOne } from '../database.js';

const MAX_INTERACTIONS = parseInt(process.env['DEMO_SESSION_MAX_INTERACTIONS'] || '15');
const SESSION_DURATION_MIN = parseInt(process.env['DEMO_SESSION_DURATION_MINUTES'] || '30');
const SESSION_BUDGET = parseFloat(process.env['DEMO_SESSION_BUDGET_USD'] || '0.50');
const MAX_SESSIONS_PER_IP = parseInt(process.env['DEMO_MAX_SESSIONS_PER_IP'] || '5');
const MESSAGE_MAX_LENGTH = 500;

function hashIp(ip: string): string {
  return createHash('sha256').update(ip + 'askalf-demo-salt').digest('hex').substring(0, 16);
}

interface DemoSession {
  id: string;
  session_token: string;
  ip_hash: string;
  interactions_used: number;
  max_interactions: number;
  expires_at: string;
  created_at: string;
}

async function validateSession(token: string): Promise<{ session: DemoSession; spent: number } | null> {
  const session = await queryOne<DemoSession>(
    `SELECT * FROM demo_sessions WHERE session_token = $1 AND expires_at > NOW()`,
    [token],
  );
  if (!session) return null;
  if (session.interactions_used >= session.max_interactions) return null;

  const costRow = await queryOne<{ total: string }>(
    `SELECT COALESCE(SUM(cost), 0)::text as total FROM forge_executions WHERE tenant_id = 'demo' AND metadata->>'demo_session' = $1`,
    [session.id],
  );
  const spent = parseFloat(costRow?.total || '0');

  return { session, spent };
}

export async function demoRoutes(app: FastifyInstance): Promise<void> {

  // CORS preflight for demo routes
  app.addHook('onRequest', async (request, reply) => {
    if (request.url.startsWith('/api/v1/demo/')) {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (request.method === 'OPTIONS') {
        return reply.status(204).send();
      }
    }
  });

  /**
   * POST /api/v1/demo/session — Create anonymous demo session
   */
  app.post('/api/v1/demo/session', async (request: FastifyRequest, reply: FastifyReply) => {
    const ip = request.headers['x-forwarded-for'] as string || request.headers['x-real-ip'] as string || request.ip;
    const ipHash = hashIp(ip);
    const ua = request.headers['user-agent'] || '';
    const body = (request.body || {}) as { referrer?: string };

    // Rate limit: max sessions per IP
    const existing = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text as count FROM demo_sessions WHERE ip_hash = $1 AND expires_at > NOW()`,
      [ipHash],
    );
    if (parseInt(existing?.count || '0') >= MAX_SESSIONS_PER_IP) {
      return reply.status(429).send({ error: 'Too many demo sessions. Try again later.' });
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MIN * 60 * 1000);

    const session = await queryOne<{ id: string; session_token: string; expires_at: string }>(
      `INSERT INTO demo_sessions (id, session_token, ip_hash, user_agent, referrer, max_interactions, expires_at)
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6) RETURNING id, session_token, expires_at`,
      [token, ipHash, ua.substring(0, 200), body.referrer || '', MAX_INTERACTIONS, expiresAt.toISOString()],
    );

    return reply.status(201).send({
      token: session?.session_token,
      expires_at: session?.expires_at,
      max_interactions: MAX_INTERACTIONS,
      budget: SESSION_BUDGET,
    });
  });

  /**
   * GET /api/v1/demo/session/status — Check session status
   */
  app.get('/api/v1/demo/session/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.headers.authorization || '').replace('Bearer ', '');
    if (!token) return reply.status(401).send({ error: 'No session token' });

    const result = await validateSession(token);
    if (!result) return reply.status(401).send({ error: 'Session expired or limit reached' });

    const { session, spent } = result;
    const expiresIn = Math.max(0, Math.round((new Date(session.expires_at).getTime() - Date.now()) / 1000));

    return {
      interactions_used: session.interactions_used,
      interactions_remaining: session.max_interactions - session.interactions_used,
      budget_used: Math.round(spent * 10000) / 10000,
      budget_remaining: Math.round((SESSION_BUDGET - spent) * 10000) / 10000,
      expires_in_seconds: expiresIn,
    };
  });

  /**
   * POST /api/v1/demo/chat — Send a message in the demo
   */
  app.post('/api/v1/demo/chat', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.headers.authorization || '').replace('Bearer ', '');
    if (!token) return reply.status(401).send({ error: 'No session token' });

    const result = await validateSession(token);
    if (!result) return reply.status(401).send({ error: 'Session expired or limit reached' });

    const { session, spent } = result;
    if (spent >= SESSION_BUDGET) {
      return reply.status(403).send({ error: 'Demo budget exceeded', spent });
    }

    const body = (request.body || {}) as { message?: string };
    const message = (body.message || '').trim().substring(0, MESSAGE_MAX_LENGTH);
    if (!message) return reply.status(400).send({ error: 'Message required' });

    // Increment interaction count
    await query(
      `UPDATE demo_sessions SET interactions_used = interactions_used + 1, last_active_at = NOW() WHERE id = $1`,
      [session.id],
    );

    // Stream response from Haiku via SSE
    const anthropicKey = process.env['ANTHROPIC_API_KEY'];
    if (!anthropicKey) {
      return { message: 'Demo is being configured. Please try again shortly.', type: 'system' };
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    try {
      const chatRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          stream: true,
          system: `You are Alf — an AI workforce builder. You CREATE AI AGENTS to handle work autonomously.

When someone describes what they need, you design an AI agent team that runs inside AskAlf:
- Name each agent with a clear role (e.g. "Invoice Tracker", "Client Communicator", "Compliance Monitor")
- Describe what each agent does AUTONOMOUSLY — what it monitors, what it acts on, what it reports
- Show the schedule — which run 24/7, daily, weekly, or triggered by events
- Show how they coordinate — who creates tickets for whom, who escalates

You are building autonomous AI workers. They use tools like web_search, shell, ticket_ops, memory_store, email, discord_ops. They have system prompts, schedules, and cost budgets. They patrol, detect, act, and report without human intervention.

CRITICAL RULES:
- NEVER suggest hiring humans. You build AI agent teams.
- NEVER give generic business advice. Design specific agents.
- NEVER just list what you "could" do. Present the actual team ready to deploy.
- Each agent needs: a name, what it monitors/does, its schedule, and what tools it uses.
- Keep responses conversational and direct. No walls of markdown.
- Use short paragraphs, not headers for every line.
- Bold agent names only. No ## headers, no --- dividers, no bullet-heavy lists.
- Write like you're texting a founder, not writing documentation.
- End with total monthly cost and a "Deploy now?" call to action.
- Costs are LOW. Agents use Haiku ($0.25/M tokens). A typical agent costs $1-5/month. A full team of 4 agents costs $5-15/month total. Never quote costs over $20/month for a team.

Make it feel real — like they click "Deploy" and this team starts working in 60 seconds. Because in the full version, that's exactly what happens.

Under 250 words.`,
          messages: [{ role: 'user', content: message }],
        }),
      });

      if (!chatRes.ok || !chatRes.body) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', text: 'AI service unavailable' })}\n\n`);
        reply.raw.end();
        return reply;
      }

      const reader = chatRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'content_block_delta' && data.delta?.text) {
                reply.raw.write(`data: ${JSON.stringify({ type: 'text', text: data.delta.text })}\n\n`);
              }
            } catch { /* skip non-JSON lines */ }
          }
        }
      }

      reply.raw.write(`data: ${JSON.stringify({ type: 'done', session: { interactions_remaining: session.max_interactions - session.interactions_used - 1, budget_remaining: Math.round((SESSION_BUDGET - spent) * 100) / 100 } })}\n\n`);
      reply.raw.end();
      return reply;
    } catch {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', text: 'Something went wrong' })}\n\n`);
      reply.raw.end();
      return reply;
    }

  });

  /**
   * POST /api/v1/demo/execute — Actually execute a task (costs budget)
   */
  app.post('/api/v1/demo/execute', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.headers.authorization || '').replace('Bearer ', '');
    if (!token) return reply.status(401).send({ error: 'No session token' });

    const result = await validateSession(token);
    if (!result) return reply.status(401).send({ error: 'Session expired or limit reached' });

    const { session, spent } = result;
    if (spent >= SESSION_BUDGET) {
      return reply.status(403).send({ error: 'Demo budget exceeded' });
    }

    const body = (request.body || {}) as { message: string };
    const message = (body.message || '').trim().substring(0, MESSAGE_MAX_LENGTH);
    if (!message) return reply.status(400).send({ error: 'Message required' });

    // Find a demo agent
    const demoAgent = await queryOne<{ id: string; name: string }>(
      `SELECT id, name FROM forge_agents WHERE tenant_id = 'demo' AND status = 'active' ORDER BY RANDOM() LIMIT 1`,
    );

    if (!demoAgent) {
      return reply.status(503).send({ error: 'No demo agents available' });
    }

    // Create execution
    const { ulid } = await import('ulid');
    const execId = ulid();
    await query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, tenant_id, input, status, metadata, started_at)
       VALUES ($1, $2, 'demo-user', 'demo', $3, 'pending', $4, NOW())`,
      [execId, demoAgent.id, message, JSON.stringify({ source: 'demo', demo_session: session.id })],
    );

    return reply.status(202).send({
      execution_id: execId,
      agent: demoAgent.name,
      status: 'pending',
      message: `Task dispatched to ${demoAgent.name}. Check status at /api/v1/demo/execution/${execId}`,
    });
  });

  /**
   * GET /api/v1/demo/execution/:id — Check execution status
   */
  app.get('/api/v1/demo/execution/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const token = (request.headers.authorization || '').replace('Bearer ', '');
    if (!token) return reply.status(401).send({ error: 'No session token' });

    const { id } = request.params as { id: string };

    const exec = await queryOne<Record<string, unknown>>(
      `SELECT e.id, e.status, e.output, e.cost, e.created_at, e.completed_at, a.name as agent_name
       FROM forge_executions e JOIN forge_agents a ON a.id = e.agent_id
       WHERE e.id = $1 AND e.tenant_id = 'demo'`,
      [id],
    );

    if (!exec) return reply.status(404).send({ error: 'Execution not found' });

    return {
      id: exec['id'],
      agent: exec['agent_name'],
      status: exec['status'],
      output: exec['status'] === 'completed' ? exec['output'] : null,
      cost: exec['cost'] ? Number(exec['cost']) : 0,
    };
  });

  /**
   * GET /api/v1/demo/fleet — Read-only fleet view
   */
  app.get('/api/v1/demo/fleet', async (_request: FastifyRequest) => {
    const agents = await query<Record<string, unknown>>(
      `SELECT name, type, status, tasks_completed, tasks_failed, description, enabled_tools
       FROM forge_agents WHERE tenant_id = 'demo' AND status = 'active' ORDER BY name`,
    );

    const recentExecs = await query<Record<string, unknown>>(
      `SELECT a.name as agent_name, e.status, ROUND(e.cost::numeric, 4) as cost, e.created_at
       FROM forge_executions e JOIN forge_agents a ON a.id = e.agent_id
       WHERE e.tenant_id = 'demo' AND e.created_at > NOW() - INTERVAL '1 hour'
       ORDER BY e.created_at DESC LIMIT 10`,
    );

    return { agents, recent_executions: recentExecs };
  });
}
