/**
 * Agents API Routes
 * Autonomous agent management system
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query, queryOne } from '@substrate/database';

const SESSION_COOKIE_NAME = 'substrate_session';

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getAdminUser(
  request: FastifyRequest
): Promise<{ user_id: string; tenant_id: string; email: string } | null> {
  const sessionToken = (request.cookies as Record<string, string> | undefined)?.[SESSION_COOKIE_NAME];
  if (!sessionToken) return null;

  const tokenHash = await hashToken(sessionToken);
  const session = await queryOne<{ user_id: string; tenant_id: string; email: string }>(
    `SELECT s.user_id, u.tenant_id, u.email FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND s.revoked = false AND u.role IN ('admin', 'super_admin')`,
    [tokenHash]
  );

  return session || null;
}

// Agent type definitions
const AGENT_TYPES = ['dev', 'research', 'support', 'content', 'monitor', 'custom'] as const;
const AGENT_STATUSES = ['idle', 'running', 'paused', 'error'] as const;

// Default system prompts for each agent type
const DEFAULT_PROMPTS: Record<string, string> = {
  dev: `You are a DevOps agent for Ask ALF. Your responsibilities:
- Monitor build and deployment status
- Identify and fix common build errors
- Suggest infrastructure improvements
- Review code changes for potential issues
Be concise, technical, and action-oriented.`,

  research: `You are a Research agent for Ask ALF. Your responsibilities:
- Research competitor products and features
- Track industry trends and emerging technologies
- Analyze user feedback and feature requests
- Summarize findings in actionable reports
Be thorough, analytical, and provide citations.`,

  support: `You are a Customer Support agent for Ask ALF. Your responsibilities:
- Triage incoming bug reports and feature requests
- Draft responses to common user questions
- Identify patterns in user issues
- Escalate critical issues appropriately
Be helpful, empathetic, and solution-focused.`,

  content: `You are a Content Creation agent for Ask ALF. Your responsibilities:
- Write blog posts about AI and product updates
- Create social media content
- Draft documentation and tutorials
- Generate marketing copy
Be engaging, clear, and on-brand.`,

  monitor: `You are a System Monitoring agent for Ask ALF. Your responsibilities:
- Monitor system health and performance metrics
- Alert on anomalies and potential issues
- Track usage patterns and trends
- Recommend optimizations
Be vigilant, precise, and proactive.`,

  custom: `You are a custom agent for Ask ALF. Follow the specific instructions provided for your task.`,
};

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  // ============================================
  // AGENT CRUD
  // ============================================

  // List all agents
  app.get('/api/v1/admin/agents', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { include_decommissioned = 'false' } = request.query as { include_decommissioned?: string };

    const agents = await query<{
      id: string;
      name: string;
      type: string;
      status: string;
      description: string;
      schedule: string;
      autonomy_level: number;
      is_decommissioned: boolean;
      decommissioned_at: string | null;
      created_at: string;
      updated_at: string;
      last_run_at: string;
      tasks_completed: number;
      tasks_failed: number;
      current_task: string | null;
      pending_interventions: number;
    }>(`
      SELECT a.*,
             (SELECT at.type FROM agent_tasks at
              WHERE at.agent_id = a.id AND at.status = 'running'
              LIMIT 1) as current_task,
             (SELECT COUNT(*) FROM intervention_requests ir
              WHERE ir.agent_id = a.id AND ir.status = 'pending') as pending_interventions
      FROM agents a
      WHERE ($1 = 'true' OR a.is_decommissioned = FALSE)
      ORDER BY a.is_decommissioned ASC, a.created_at DESC
    `, [include_decommissioned]);

    return { agents };
  });

  // Get single agent with recent logs
  app.get('/api/v1/admin/agents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };

    const agent = await queryOne<{
      id: string;
      name: string;
      type: string;
      status: string;
      description: string;
      system_prompt: string;
      schedule: string;
      config: Record<string, unknown>;
      autonomy_level: number;
      is_decommissioned: boolean;
      decommissioned_at: string | null;
      created_at: string;
      updated_at: string;
      last_run_at: string;
      tasks_completed: number;
      tasks_failed: number;
    }>('SELECT * FROM agents WHERE id = $1', [id]);

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    // Get recent logs
    const logs = await query<{
      id: string;
      level: string;
      message: string;
      metadata: Record<string, unknown>;
      created_at: string;
    }>(`
      SELECT id, level, message, metadata, created_at
      FROM agent_logs
      WHERE agent_id = $1
      ORDER BY created_at DESC
      LIMIT 50
    `, [id]);

    // Get recent tasks
    const tasks = await query<{
      id: string;
      type: string;
      status: string;
      input: Record<string, unknown>;
      output: Record<string, unknown>;
      error: string;
      started_at: string;
      completed_at: string;
      created_at: string;
    }>(`
      SELECT * FROM agent_tasks
      WHERE agent_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [id]);

    return { agent, logs, tasks };
  });

  // Create agent
  app.post('/api/v1/admin/agents', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const body = request.body as {
      name?: string;
      type?: string;
      description?: string;
      system_prompt?: string;
      schedule?: string;
      config?: Record<string, unknown>;
    };

    if (!body.name?.trim()) {
      return reply.code(400).send({ error: 'Name is required' });
    }

    const type = body.type && AGENT_TYPES.includes(body.type as any) ? body.type : 'custom';
    const systemPrompt = body.system_prompt?.trim() || DEFAULT_PROMPTS[type];

    const agent = await queryOne<{ id: string }>(`
      INSERT INTO agents (name, type, description, system_prompt, schedule, config, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id
    `, [
      body.name.trim(),
      type,
      body.description?.trim() || null,
      systemPrompt,
      body.schedule || null,
      JSON.stringify(body.config || {}),
      adminUser.user_id,
    ]);

    // Log agent creation
    await query(`
      INSERT INTO agent_logs (agent_id, level, message, metadata)
      VALUES ($1, 'info', 'Agent created', $2)
    `, [agent?.id, JSON.stringify({ created_by: adminUser.email })]);

    return { success: true, id: agent?.id };
  });

  // Update agent
  app.patch('/api/v1/admin/agents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const body = request.body as {
      name?: string;
      type?: string;
      description?: string;
      system_prompt?: string;
      schedule?: string;
      config?: Record<string, unknown>;
      status?: string;
    };

    const updates: string[] = [];
    const params: (string | null)[] = [];
    let paramIndex = 1;

    if (body.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(body.name);
    }
    if (body.type !== undefined && AGENT_TYPES.includes(body.type as any)) {
      updates.push(`type = $${paramIndex++}`);
      params.push(body.type);
    }
    if (body.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(body.description);
    }
    if (body.system_prompt !== undefined) {
      updates.push(`system_prompt = $${paramIndex++}`);
      params.push(body.system_prompt);
    }
    if (body.schedule !== undefined) {
      updates.push(`schedule = $${paramIndex++}`);
      params.push(body.schedule);
    }
    if (body.config !== undefined) {
      updates.push(`config = $${paramIndex++}`);
      params.push(JSON.stringify(body.config));
    }
    if (body.status !== undefined && AGENT_STATUSES.includes(body.status as any)) {
      updates.push(`status = $${paramIndex++}`);
      params.push(body.status);
    }

    if (updates.length === 0) {
      return reply.code(400).send({ error: 'No updates provided' });
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    await query(`
      UPDATE agents SET ${updates.join(', ')}
      WHERE id = $${paramIndex}
    `, params);

    return { success: true };
  });

  // Delete agent
  app.delete('/api/v1/admin/agents/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    await query('DELETE FROM agents WHERE id = $1', [id]);
    return { success: true };
  });

  // ============================================
  // AGENT EXECUTION
  // ============================================

  // Run agent task
  app.post('/api/v1/admin/agents/:id/run', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const body = request.body as {
      task_type?: string;
      input?: Record<string, unknown>;
    };

    // Get agent
    const agent = await queryOne<{
      id: string;
      name: string;
      type: string;
      status: string;
      system_prompt: string;
      config: Record<string, unknown>;
    }>('SELECT * FROM agents WHERE id = $1', [id]);

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    if (agent.status === 'running') {
      return reply.code(400).send({ error: 'Agent is already running' });
    }

    // Create task
    const task = await queryOne<{ id: string }>(`
      INSERT INTO agent_tasks (agent_id, type, input, status, started_at)
      VALUES ($1, $2, $3, 'running', NOW())
      RETURNING id
    `, [id, body.task_type || 'manual', JSON.stringify(body.input || {})]);

    // Update agent status
    await query(`
      UPDATE agents SET status = 'running', updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // Log task start
    await query(`
      INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
      VALUES ($1, $2, 'info', 'Task started', $3)
    `, [id, task?.id, JSON.stringify({ task_type: body.task_type, triggered_by: adminUser.email })]);

    // Execute task asynchronously
    executeAgentTask(agent, task?.id!, body.input || {}).catch(err => {
      console.error('Agent task failed:', err);
    });

    return { success: true, task_id: task?.id };
  });

  // Stop agent
  app.post('/api/v1/admin/agents/:id/stop', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };

    // Update agent status
    await query(`
      UPDATE agents SET status = 'idle', updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // Cancel running tasks
    await query(`
      UPDATE agent_tasks SET status = 'cancelled', completed_at = NOW()
      WHERE agent_id = $1 AND status = 'running'
    `, [id]);

    // Log stop
    await query(`
      INSERT INTO agent_logs (agent_id, level, message, metadata)
      VALUES ($1, 'info', 'Agent stopped', $2)
    `, [id, JSON.stringify({ stopped_by: adminUser.email })]);

    return { success: true };
  });

  // Process next pending task for an agent
  app.post('/api/v1/admin/agents/:id/process', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };

    // Get agent
    const agent = await queryOne<{
      id: string;
      name: string;
      type: string;
      status: string;
      system_prompt: string;
      config: Record<string, unknown>;
    }>('SELECT * FROM agents WHERE id = $1', [id]);

    if (!agent) {
      return reply.code(404).send({ error: 'Agent not found' });
    }

    if (agent.status === 'running') {
      return reply.code(400).send({ error: 'Agent is already running' });
    }

    // Get next pending task
    const pendingTask = await queryOne<{
      id: string;
      type: string;
      input: Record<string, unknown>;
    }>(`
      SELECT id, type, input FROM agent_tasks
      WHERE agent_id = $1 AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `, [id]);

    if (!pendingTask) {
      return reply.code(404).send({ error: 'No pending tasks for this agent' });
    }

    // Update task to running
    await query(`
      UPDATE agent_tasks SET status = 'running', started_at = NOW()
      WHERE id = $1
    `, [pendingTask.id]);

    // Update agent status
    await query(`
      UPDATE agents SET status = 'running', updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // Log task start
    await query(`
      INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
      VALUES ($1, $2, 'info', 'Processing pending task', $3)
    `, [id, pendingTask.id, JSON.stringify({ task_type: pendingTask.type, triggered_by: adminUser.email })]);

    // Execute task asynchronously
    executeAgentTask(agent, pendingTask.id, pendingTask.input || {}).catch(err => {
      console.error('Agent task failed:', err);
    });

    return { success: true, task_id: pendingTask.id, task_type: pendingTask.type };
  });

  // Batch process - start all agents with pending tasks
  app.post('/api/v1/admin/agents/batch/process', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    // Get all idle agents with pending tasks
    const agentsWithTasks = await query<{
      agent_id: string;
      agent_name: string;
      agent_type: string;
      system_prompt: string;
      config: Record<string, unknown>;
      task_id: string;
      task_type: string;
      task_input: Record<string, unknown>;
    }>(`
      SELECT
        a.id as agent_id, a.name as agent_name, a.type as agent_type,
        a.system_prompt, a.config,
        t.id as task_id, t.type as task_type, t.input as task_input
      FROM agents a
      JOIN LATERAL (
        SELECT id, type, input FROM agent_tasks
        WHERE agent_id = a.id AND status = 'pending'
        ORDER BY created_at ASC LIMIT 1
      ) t ON true
      WHERE a.status = 'idle' AND a.is_decommissioned = FALSE
    `);

    if (agentsWithTasks.length === 0) {
      return { success: true, started: 0, message: 'No idle agents with pending tasks' };
    }

    const started: string[] = [];

    for (const row of agentsWithTasks) {
      // Update task to running
      await query(`
        UPDATE agent_tasks SET status = 'running', started_at = NOW()
        WHERE id = $1
      `, [row.task_id]);

      // Update agent status
      await query(`
        UPDATE agents SET status = 'running', updated_at = NOW()
        WHERE id = $1
      `, [row.agent_id]);

      // Log task start
      await query(`
        INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
        VALUES ($1, $2, 'info', 'Batch processing started', $3)
      `, [row.agent_id, row.task_id, JSON.stringify({ triggered_by: adminUser.email })]);

      // Execute task asynchronously
      const agent = {
        id: row.agent_id,
        name: row.agent_name,
        type: row.agent_type,
        system_prompt: row.system_prompt,
        config: row.config || {},
      };

      executeAgentTask(agent, row.task_id, row.task_input || {}).catch(err => {
        console.error(`Agent ${row.agent_name} task failed:`, err);
      });

      started.push(row.agent_name);
    }

    return {
      success: true,
      started: started.length,
      agents: started,
      message: `Started ${started.length} agents`
    };
  });

  // Get agent logs
  app.get('/api/v1/admin/agents/:id/logs', async (request: FastifyRequest, reply: FastifyReply) => {
    const adminUser = await getAdminUser(request);
    if (!adminUser) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const { limit = '100', offset = '0' } = request.query as { limit?: string; offset?: string };

    const logs = await query<{
      id: string;
      task_id: string;
      level: string;
      message: string;
      metadata: Record<string, unknown>;
      created_at: string;
    }>(`
      SELECT * FROM agent_logs
      WHERE agent_id = $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [id, parseInt(limit), parseInt(offset)]);

    return { logs };
  });
}

// ============================================
// AGENT TASK EXECUTION WITH REAL TOOLS
// ============================================

// Fetch real system context based on agent type
async function getAgentContext(agentType: string, agentName: string): Promise<string> {
  const context: string[] = [`=== SYSTEM CONTEXT FOR ${agentName} ===`, `Timestamp: ${new Date().toISOString()}`, ''];

  try {
    // Common stats for all agents
    const userStats = await queryOne<{ total: string; active_24h: string; new_7d: string }>(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '24 hours') as active_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_7d
      FROM users
    `);
    context.push(`Users: ${userStats?.total || 0} total, ${userStats?.active_24h || 0} active (24h), ${userStats?.new_7d || 0} new (7d)`);

    // Type-specific context
    if (agentType === 'dev' || agentType === 'monitor') {
      // System health metrics
      const apiStats = await queryOne<{ total_requests: string; avg_duration: string }>(`
        SELECT COUNT(*) as total_requests, ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - created_at)) * 1000)) as avg_duration
        FROM agent_tasks WHERE created_at > NOW() - INTERVAL '24 hours'
      `);
      context.push(`API Activity (24h): ${apiStats?.total_requests || 0} agent tasks, avg ${apiStats?.avg_duration || 0}ms`);

      const shardStats = await queryOne<{ total: string; high_conf: string; low_conf: string; success_rate: string }>(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE confidence >= 0.7) as high_conf,
          COUNT(*) FILTER (WHERE confidence < 0.5) as low_conf,
          ROUND(SUM(success_count) * 100.0 / NULLIF(SUM(execution_count), 0)) as success_rate
        FROM procedural_shards
      `);
      context.push(`Shards: ${shardStats?.total || 0} total, ${shardStats?.high_conf || 0} high confidence, ${shardStats?.low_conf || 0} low confidence, ${shardStats?.success_rate || 0}% success rate`);

      const dbStats = await queryOne<{ tables: string; size: string }>(`
        SELECT COUNT(*) as tables, pg_size_pretty(pg_database_size(current_database())) as size
        FROM information_schema.tables WHERE table_schema = 'public'
      `);
      context.push(`Database: ${dbStats?.tables || 0} tables, ${dbStats?.size || 'unknown'} size`);
    }

    if (agentType === 'support') {
      // Ticket stats
      const ticketStats = await query<{ status: string; count: string }>(`
        SELECT status, COUNT(*) as count FROM tickets
        GROUP BY status ORDER BY count DESC
      `);
      const ticketSummary = ticketStats.map(t => `${t.status}: ${t.count}`).join(', ');
      context.push(`Tickets: ${ticketSummary || 'none'}`);

      // Recent tickets
      const recentTickets = await query<{ title: string; priority: string; created_at: string }>(`
        SELECT title, priority, created_at FROM tickets
        WHERE status IN ('open', 'in_progress')
        ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, created_at DESC
        LIMIT 5
      `);
      if (recentTickets.length > 0) {
        context.push('Recent Open Tickets:');
        recentTickets.forEach(t => context.push(`  - [${t.priority}] ${t.title}`));
      }
    }

    if (agentType === 'research') {
      // Business metrics - user roles breakdown
      const roleStats = await query<{ role: string; count: string }>(`
        SELECT role, COUNT(*) as count FROM users GROUP BY role ORDER BY count DESC
      `);
      const roleSummary = roleStats.map(r => `${r.role}: ${r.count}`).join(', ');
      context.push(`User Roles: ${roleSummary || 'none'}`);

      // Chat session stats
      const chatStats = await queryOne<{ total_sessions: string; total_messages: string; avg_per_session: string }>(`
        SELECT
          COUNT(DISTINCT cs.id) as total_sessions,
          COUNT(cm.id) as total_messages,
          ROUND(COUNT(cm.id)::numeric / NULLIF(COUNT(DISTINCT cs.id), 0)) as avg_per_session
        FROM chat_sessions cs
        LEFT JOIN chat_messages cm ON cs.id = cm.session_id
      `);
      context.push(`Chat: ${chatStats?.total_sessions || 0} sessions, ${chatStats?.total_messages || 0} messages, avg ${chatStats?.avg_per_session || 0} per session`);
    }

    if (agentType === 'content') {
      // Content-related stats
      const shardContent = await queryOne<{ total_shards: string; unique_patterns: string }>(`
        SELECT COUNT(*) as total_shards, COUNT(DISTINCT pattern_hash) as unique_patterns FROM procedural_shards
      `);
      context.push(`Content: ${shardContent?.total_shards || 0} shards, ${shardContent?.unique_patterns || 0} unique patterns`);

      // Knowledge facts
      const factStats = await queryOne<{ total: string }>(`
        SELECT COUNT(*) as total FROM knowledge_facts
      `);
      context.push(`Knowledge Facts: ${factStats?.total || 0} stored`);
    }

    // Pending interventions for all agents
    const pendingInterventions = await queryOne<{ count: string }>(`
      SELECT COUNT(*) as count FROM intervention_requests WHERE status = 'pending'
    `);
    if (parseInt(pendingInterventions?.count || '0') > 0) {
      context.push(`\n⚠️ ${pendingInterventions?.count} pending interventions requiring human review`);
    }

    // Agent's own history
    const recentTasks = await query<{ status: string; created_at: string }>(`
      SELECT status, created_at FROM agent_tasks
      WHERE agent_id = (SELECT id FROM agents WHERE name = $1 LIMIT 1)
      ORDER BY created_at DESC LIMIT 5
    `, [agentName]);
    if (recentTasks.length > 0) {
      const taskSummary = recentTasks.map(t => t.status).join(', ');
      context.push(`Your recent tasks: ${taskSummary}`);
    }

  } catch (err) {
    context.push(`[Error fetching context: ${err instanceof Error ? err.message : 'unknown'}]`);
  }

  context.push('', '=== END CONTEXT ===', '');
  return context.join('\n');
}

async function executeAgentTask(
  agent: { id: string; name: string; type: string; system_prompt: string; config: Record<string, unknown> },
  taskId: string,
  input: Record<string, unknown>
): Promise<void> {
  const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];

  try {
    // Fetch real system context
    const systemContext = await getAgentContext(agent.type, agent.name);

    // Build the prompt based on agent type and input
    let userPrompt = '';

    if (input['prompt']) {
      userPrompt = String(input['prompt']);
    } else if (input['task']) {
      userPrompt = String(input['task']);
    } else {
      // Default task based on agent type
      const defaultTasks: Record<string, string> = {
        dev: 'Analyze the system context above. Report any issues that need attention, suggest improvements, and identify any concerning trends.',
        research: 'Analyze the business metrics above. Identify growth opportunities, concerning trends, and provide actionable recommendations.',
        support: 'Review the ticket data above. Prioritize issues, identify patterns, and suggest responses or escalations needed.',
        content: 'Based on the system stats, suggest content ideas that would be valuable to our users. Consider documentation gaps or feature highlights.',
        monitor: 'Analyze the system health metrics above. Report any anomalies, performance concerns, or areas needing immediate attention.',
        custom: 'Analyze the provided context and execute your assigned task.',
      };
      userPrompt = defaultTasks[agent.type] ?? 'Analyze the provided context and report your findings.';
    }

    // Combine context with prompt
    const fullPrompt = `${systemContext}\n\nYOUR TASK:\n${userPrompt}\n\nProvide a clear, actionable response. If you identify issues requiring human intervention, clearly state them.`;

    // Log task execution
    await query(`
      INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
      VALUES ($1, $2, 'info', 'Executing task with system context', $3)
    `, [agent.id, taskId, JSON.stringify({ prompt: userPrompt.slice(0, 200), has_context: true })]);

    // Call Claude API
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: `${agent.system_prompt}\n\nYou have access to real system data. Analyze it carefully and provide specific, actionable insights. If something requires human approval or action, clearly flag it as "INTERVENTION NEEDED: [reason]".`,
        messages: [{ role: 'user', content: fullPrompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json() as {
      content: Array<{ type: string; text?: string }>;
      usage?: { input_tokens: number; output_tokens: number };
    };

    const output = data.content?.[0]?.text || '';

    // Check for intervention requests in the output - avoid duplicates
    const interventionMatches = output.match(/INTERVENTION NEEDED:\s*([^\n]+)/gi);
    let newInterventions = 0;
    if (interventionMatches && interventionMatches.length > 0) {
      for (const match of interventionMatches) {
        const reason = match.replace(/INTERVENTION NEEDED:\s*/i, '').trim();
        if (!reason || reason === '**') continue; // Skip empty or malformed interventions

        // Check if a similar pending intervention already exists for this agent
        const existing = await queryOne<{ id: string }>(`
          SELECT id FROM intervention_requests
          WHERE agent_id = $1
            AND status = 'pending'
            AND description ILIKE $2
          LIMIT 1
        `, [agent.id, `%${reason.slice(0, 50)}%`]);

        if (!existing) {
          await query(`
            INSERT INTO intervention_requests (agent_id, task_id, type, title, description, proposed_action)
            VALUES ($1, $2, 'approval', $3, $4, $5)
          `, [
            agent.id,
            taskId,
            `${agent.name}: Issue Detected`,
            reason,
            `Agent ${agent.name} has identified an issue requiring human review.`,
          ]);
          newInterventions++;
        }
      }

      // Log intervention creation
      if (newInterventions > 0) {
        await query(`
          INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
          VALUES ($1, $2, 'warn', 'Created intervention request', $3)
        `, [agent.id, taskId, JSON.stringify({ interventions: newInterventions, skipped: interventionMatches.length - newInterventions })]);
      }
    }

    // Update task as completed
    const hasInterventions = newInterventions > 0;
    await query(`
      UPDATE agent_tasks
      SET status = 'completed', output = $1, completed_at = NOW()
      WHERE id = $2
    `, [JSON.stringify({ response: output, usage: data.usage, interventions: interventionMatches?.length || 0 }), taskId]);

    // Only create tickets when issues are found - no ticket spam for routine reports
    if (hasInterventions) {
      const ticketTitle = `${agent.name}: Issues Detected`;
      const ticketDescription = output.length > 5000 ? output.slice(0, 5000) + '\n\n[truncated]' : output;

      const ticketResult = await queryOne<{ id: string }>(`
        INSERT INTO tickets (title, description, status, priority, category, source, agent_id, task_id, created_at)
        VALUES ($1, $2, 'open', 'high', $3, 'agent', $4, $5, NOW())
        RETURNING id
      `, [
        ticketTitle,
        ticketDescription,
        agent.type,
        agent.id,
        taskId,
      ]);

      if (ticketResult?.id) {
        await query(`
          UPDATE agent_tasks SET output = output || $1 WHERE id = $2
        `, [JSON.stringify({ ticket_id: ticketResult.id }), taskId]);
      }
    }

    // Update agent stats
    await query(`
      UPDATE agents
      SET status = 'idle',
          tasks_completed = tasks_completed + 1,
          last_run_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `, [agent.id]);

    // Log completion
    await query(`
      INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
      VALUES ($1, $2, 'info', 'Task completed successfully', $3)
    `, [agent.id, taskId, JSON.stringify({
      output_length: output.length,
      tokens: data.usage,
      interventions_created: interventionMatches?.length || 0
    })]);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    // Update task as failed
    await query(`
      UPDATE agent_tasks
      SET status = 'failed', error = $1, completed_at = NOW()
      WHERE id = $2
    `, [errorMessage, taskId]);

    // Update agent stats
    await query(`
      UPDATE agents
      SET status = 'error',
          tasks_failed = tasks_failed + 1,
          updated_at = NOW()
      WHERE id = $1
    `, [agent.id]);

    // Log error
    await query(`
      INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
      VALUES ($1, $2, 'error', 'Task failed', $3)
    `, [agent.id, taskId, JSON.stringify({ error: errorMessage })]);
  }
}
