// ===========================================
// SYSTEM ASSISTANT — Proxies to Forge CLI Query (OAuth + MCP tools)
// No direct Anthropic API calls — uses Claude CLI with OAuth subscription
// ===========================================

const FORGE_URL = process.env.FORGE_URL || 'http://forge:3005';
const FORGE_API_KEY = process.env.FORGE_API_KEY || '';

// Rate limiting (in-memory, 10 req/min per user — CLI queries are heavier)
const rateLimits = new Map();

function checkRateLimit(key) {
  const now = Date.now();
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + 60000 });
    return true;
  }
  entry.count++;
  return entry.count <= 10;
}

// Forge API helper (for context fetching + CLI query)
async function callForge(path, options = {}) {
  const url = `${FORGE_URL}/api/v1/forge${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(FORGE_API_KEY ? { 'Authorization': `Bearer ${FORGE_API_KEY}` } : {}),
  };
  try {
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(options.timeout || 30000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { error: true, status: res.status, message: text || res.statusText };
    }
    return await res.json();
  } catch (err) {
    return { error: true, status: 503, message: `Forge unreachable: ${err.message}` };
  }
}

// ===========================================
// SYSTEM CONTEXT (injected into system prompt)
// ===========================================

async function fetchSystemContext(query, queryOne) {
  try {
    const [agentsRes, ticketStats, findingStats, interventionCount, recentExecs] = await Promise.all([
      callForge('/agents?limit=100'),
      query(`SELECT status, COUNT(*)::int as count FROM agent_tickets GROUP BY status`, []),
      query(`SELECT severity, COUNT(*)::int as count FROM agent_findings GROUP BY severity`, []),
      queryOne(`SELECT COUNT(*)::int as count FROM agent_interventions WHERE status = 'pending'`, []),
      callForge('/executions?limit=5'),
    ]);

    const agents = agentsRes.error ? [] : (agentsRes.agents || []).filter(a => !a.is_decommissioned);
    const errorAgents = agents.filter(a => a.status === 'error').map(a => `${a.name} (${a.id})`);
    const agentList = agents.map(a => `- ${a.name} [${a.id}] — status: ${a.status}, model: ${a.model_id || 'default'}`).join('\n');

    return {
      agents: {
        total: agents.length,
        running: agents.filter(a => a.status === 'running').length,
        idle: agents.filter(a => a.status === 'idle').length,
        error: agents.filter(a => a.status === 'error').length,
        paused: agents.filter(a => a.status === 'paused').length,
      },
      agentList,
      errorAgents,
      tickets: Object.fromEntries((ticketStats || []).map(r => [r.status, r.count])),
      findings: Object.fromEntries((findingStats || []).map(r => [r.severity, r.count])),
      pendingInterventions: interventionCount?.count || 0,
      recentExecutions: (recentExecs?.executions || []).slice(0, 5).map(e =>
        `${e.agent_name}: ${e.status}${e.error ? ' (error)' : ''}`
      ),
    };
  } catch (err) {
    return { agents: { total: 0 }, agentList: '', errorAgents: [], tickets: {}, findings: {}, pendingInterventions: 0, recentExecutions: [], fetchError: err.message };
  }
}

function buildSystemPrompt(ctx, pageContext) {
  let prompt = `You are the System Assistant for Agent Forge, an AI agent orchestration platform.
You help administrators manage their AI agent fleet through conversation.

## Current Fleet Status
- Agents: ${ctx.agents.total} total (${ctx.agents.running} running, ${ctx.agents.idle} idle, ${ctx.agents.error} errors, ${ctx.agents.paused} paused)
${ctx.errorAgents?.length ? `- Agents with errors: ${ctx.errorAgents.join(', ')}` : '- No agent errors'}
- Pending interventions: ${ctx.pendingInterventions}
- Tickets: ${JSON.stringify(ctx.tickets)}
- Findings: ${JSON.stringify(ctx.findings)}
- Recent executions: ${ctx.recentExecutions?.join(' | ') || 'none'}

## Agent Fleet
${ctx.agentList || 'No agents found'}

## Available MCP Tools
You have access to MCP tools for fleet management:
- **ticket_ops**: Create, update, list, search agent tickets (CRUD operations on agent_tickets table)
- **finding_ops**: List and search agent findings by severity, agent, category
- **intervention_ops**: List pending interventions, approve/deny them
- **db_query**: Run read-only SQL queries against the forge database (tables: forge_agents, forge_executions, forge_api_keys, forge_user_assistants)
- **substrate_db_query**: Run read-only SQL queries against the substrate database (tables: agent_tickets, agent_findings, agent_interventions, agent_schedules, users, sessions)
- **memory_search**: Search fleet cognitive memory (semantic, episodic, procedural)
- **memory_store**: Store new memories
- **docker_api**: Query Docker container status, logs, stats
- **web_search**: Search the web via SearXNG
- **web_browse**: Fetch and read web pages

## Database Schema Reference
### substrate DB:
- agent_tickets: id, title, description, status (open/in_progress/resolved/closed), priority (urgent/high/medium/low), agent_id, agent_name, assigned_to, resolution, created_at, updated_at
- agent_findings: id, finding, severity (critical/warning/info), category, agent_id, agent_name, execution_id, created_at
- agent_interventions: id, title, type, status (pending/approved/denied), agent_id, agent_name, payload, resolution, resolved_at, created_at
- agent_schedules: id, agent_id, name, schedule_type, interval_minutes, execution_mode, next_run_at, last_run_at

### forge DB:
- forge_agents: id, name, slug, status, system_prompt, model_id, autonomy_level, enabled_tools, execution_mode, last_run_at, metadata, created_at
- forge_executions: id, agent_id, status, input, output, error, started_at, completed_at, duration_ms, total_tokens, cost

## Guidelines
- Use MCP tools to get real data. Never make up information.
- For fleet queries, prefer substrate_db_query or db_query over generic tools when you need specific data.
- Be concise and direct. Use markdown formatting.
- When listing items, use tables or bullet points.
- If a tool fails, explain what went wrong.
- To run an agent: use db_query to look up the agent, then explain you'd need to trigger it through the Forge API.
- To pause an agent: similar — look up current status, explain the action needed.`;

  if (pageContext === 'agents') {
    prompt += '\n\n## Page Context\nUser is viewing the Agent Fleet page. Focus on agent status, health, schedules, and management.';
  } else if (pageContext === 'users') {
    prompt += '\n\n## Page Context\nUser is viewing the Users page.';
  } else if (pageContext === 'git-space') {
    prompt += '\n\n## Page Context\nUser is viewing the Code Review / Git Space page. Focus on agent branches and code changes.';
  } else if (pageContext === 'settings') {
    prompt += '\n\n## Page Context\nUser is viewing System Settings.';
  }

  return prompt;
}

// Build a single prompt string from conversation history + current message
function buildPrompt(message, history) {
  const parts = [];

  // Include recent conversation history (last 10 exchanges)
  const recent = (history || []).slice(-20);
  if (recent.length > 0) {
    parts.push('## Conversation History');
    for (const msg of recent) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      parts.push(`**${role}**: ${msg.content}`);
    }
    parts.push('');
  }

  // Current message
  parts.push(`## Current Question\n${message}`);

  return parts.join('\n');
}

// ===========================================
// ROUTE REGISTRATION
// ===========================================

export async function registerAssistantRoutes(fastify, requireAdmin, query, queryOne) {

  fastify.post('/api/v1/admin/assistant', async (request, reply) => {
    const admin = await requireAdmin(request, reply);
    if (!admin) return { error: 'Admin access required' };

    // Rate limit per user
    if (!checkRateLimit(`user:${admin.id}`)) {
      return reply.code(429).send({ error: 'Rate limit exceeded. Try again in a minute.' });
    }

    const { message, history = [], context = {} } = request.body || {};
    if (!message?.trim()) {
      return reply.code(400).send({ error: 'Message is required' });
    }

    const startTime = Date.now();

    try {
      // Build system context and prompt
      const systemContext = await fetchSystemContext(query, queryOne);
      const systemPrompt = buildSystemPrompt(systemContext, context.pageContext);
      const prompt = buildPrompt(message.trim(), history);

      // Call Forge CLI query endpoint (spawns Claude CLI with OAuth + MCP tools)
      const result = await callForge('/assistant/query', {
        method: 'POST',
        body: {
          prompt,
          systemPrompt,
          model: 'claude-sonnet-4-5-20250929',
          maxTurns: 10,
        },
        timeout: 150000, // 2.5 min timeout (CLI has 2 min internal timeout)
      });

      if (result.error) {
        console.error('[assistant] Forge CLI query failed:', result.message);
        return reply.code(502).send({ error: `Assistant unavailable: ${result.message}` });
      }

      if (result.isError) {
        return reply.code(502).send({ error: `Assistant error: ${result.output || 'CLI execution failed'}` });
      }

      return {
        response: result.output || 'No response generated.',
        meta: {
          responseMs: Date.now() - startTime,
          tokensUsed: (result.inputTokens || 0) + (result.outputTokens || 0),
          costUsd: result.costUsd,
          numTurns: result.numTurns,
        },
      };
    } catch (err) {
      console.error('[assistant] Error:', err);
      return reply.code(500).send({ error: `Assistant error: ${err.message}` });
    }
  });
}
