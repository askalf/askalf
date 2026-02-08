/**
 * Autonomous Agent Scheduler Service
 * Runs scheduled and continuous agents automatically
 */

import { query, queryOne } from '@substrate/database';

const ANTHROPIC_API_KEY = process.env['ANTHROPIC_API_KEY'];

interface ScheduledAgent {
  id: string;
  name: string;
  type: string;
  status: string;
  system_prompt: string;
  config: Record<string, unknown>;
  schedule_type: 'manual' | 'scheduled' | 'continuous';
  schedule_interval_minutes: number | null;
  next_run_at: string | null;
  is_continuous: boolean;
  last_run_at: string | null;
}

let schedulerInterval: NodeJS.Timeout | null = null;
let isRunning = false;

// Destructive patterns that require human approval
const DESTRUCTIVE_PATTERNS = [
  /\bDELETE\b/i,
  /\bDROP\b/i,
  /\bTRUNCATE\b/i,
  /\brm\s+-rf?\b/i,
  /\bdocker\s+volume\s+rm\b/i,
  /\bdocker\s+system\s+prune\b/i,
  /\b--force\b/i,
  /\b--hard\b/i,
  /\bRESET\b.*\bHARD\b/i,
  /\bdestroy\b/i,
  /\bwipe\b/i,
  /\bpurge\b/i,
];

/**
 * Check if an intervention contains destructive patterns
 */
function isDestructive(text: string): boolean {
  return DESTRUCTIVE_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Auto-approve non-destructive pending interventions
 */
async function autoApproveInterventions(): Promise<void> {
  try {
    const pending = await query<{ id: string; description: string; proposed_action: string; title: string }>(`
      SELECT id, description, proposed_action, title
      FROM intervention_requests
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT 20
    `);

    for (const intervention of pending) {
      const fullText = `${intervention.title} ${intervention.description} ${intervention.proposed_action || ''}`;

      if (isDestructive(fullText)) {
        console.log(`[Scheduler] Intervention ${intervention.id} requires human approval (destructive)`);
        continue;
      }

      // Auto-approve non-destructive intervention (responded_by has FK to users, leave null)
      await query(`
        UPDATE intervention_requests
        SET status = 'approved',
            human_response = 'Auto-approved (non-destructive)',
            responded_at = NOW()
        WHERE id = $1
      `, [intervention.id]);

      console.log(`[Scheduler] Auto-approved intervention: ${intervention.title}`);
    }
  } catch (error) {
    console.error('[Scheduler] Error in auto-approve:', error);
  }
}

/**
 * Get real system context for an agent
 */
async function getAgentContext(agentType: string, agentName: string): Promise<string> {
  const context: string[] = [
    `=== SYSTEM CONTEXT FOR ${agentName.toUpperCase()} (${agentType}) ===`,
    `Generated at: ${new Date().toISOString()}`,
    '',
  ];

  // System Stats
  const userStats = await queryOne<{ total: string; active: string; new_week: string }>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE last_login_at > NOW() - INTERVAL '24 hours') as active,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') as new_week
    FROM users
  `);
  context.push(`📊 USER METRICS:`);
  context.push(`   Total users: ${userStats?.total || 0}`);
  context.push(`   Active (24h): ${userStats?.active || 0}`);
  context.push(`   New this week: ${userStats?.new_week || 0}`);
  context.push('');

  // Shard Stats
  const shardStats = await queryOne<{ total: string; promoted: string; shadow: string; success_rate: string }>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE lifecycle = 'promoted') as promoted,
      COUNT(*) FILTER (WHERE lifecycle = 'shadow') as shadow,
      COALESCE(ROUND(SUM(success_count) * 100.0 / NULLIF(SUM(execution_count), 0)), 0) as success_rate
    FROM procedural_shards
  `);
  context.push(`🧠 SHARD METRICS:`);
  context.push(`   Total shards: ${shardStats?.total || 0}`);
  context.push(`   Promoted: ${shardStats?.promoted || 0}`);
  context.push(`   Shadow testing: ${shardStats?.shadow || 0}`);
  context.push(`   Success rate: ${shardStats?.success_rate || 0}%`);
  context.push('');

  // Chat Activity
  const chatStats = await queryOne<{ sessions: string; messages: string }>(`
    SELECT
      COUNT(DISTINCT cs.id) as sessions,
      COUNT(cm.id) as messages
    FROM chat_sessions cs
    LEFT JOIN chat_messages cm ON cs.id = cm.session_id
    WHERE cs.created_at > NOW() - INTERVAL '24 hours'
  `);
  context.push(`💬 CHAT ACTIVITY (24h):`);
  context.push(`   Sessions: ${chatStats?.sessions || 0}`);
  context.push(`   Messages: ${chatStats?.messages || 0}`);
  context.push('');

  // Agent Fleet Status
  const agentStats = await queryOne<{ total: string; running: string; error: string }>(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'running') as running,
      COUNT(*) FILTER (WHERE status = 'error') as error
    FROM agents WHERE is_decommissioned = FALSE
  `);
  context.push(`🤖 AGENT FLEET:`);
  context.push(`   Active agents: ${agentStats?.total || 0}`);
  context.push(`   Currently running: ${agentStats?.running || 0}`);
  context.push(`   In error state: ${agentStats?.error || 0}`);
  context.push('');

  // Pending Interventions
  const pendingInterventions = await queryOne<{ count: string }>(`
    SELECT COUNT(*) as count FROM intervention_requests WHERE status = 'pending'
  `);
  if (parseInt(pendingInterventions?.count || '0') > 0) {
    context.push(`⚠️ ${pendingInterventions?.count} pending interventions requiring human review`);
    context.push('');
  }

  // Recent Agent Activity
  const recentTasks = await query<{ agent_name: string; status: string; type: string; completed_at: string }>(`
    SELECT a.name as agent_name, at.status, at.type, at.completed_at
    FROM agent_tasks at
    JOIN agents a ON at.agent_id = a.id
    WHERE at.created_at > NOW() - INTERVAL '1 hour'
    ORDER BY at.created_at DESC
    LIMIT 10
  `);
  if (recentTasks.length > 0) {
    context.push(`📋 RECENT AGENT ACTIVITY (1h):`);
    for (const task of recentTasks) {
      context.push(`   - ${task.agent_name}: ${task.type} [${task.status}]`);
    }
    context.push('');
  }

  // Open Tickets
  const openTickets = await queryOne<{ count: string; high_priority: string }>(`
    SELECT
      COUNT(*) as count,
      COUNT(*) FILTER (WHERE priority = 'high' OR priority = 'critical') as high_priority
    FROM tickets
    WHERE status IN ('open', 'in_progress')
  `);
  context.push(`🎫 TICKET STATUS:`);
  context.push(`   Open tickets: ${openTickets?.count || 0}`);
  context.push(`   High priority: ${openTickets?.high_priority || 0}`);
  context.push('');

  // TICKETS ASSIGNED TO THIS AGENT (assignment stored in description as "ASSIGNED TO: AgentName")
  const assignedTickets = await query<{ id: string; title: string; priority: string; description: string }>(`
    SELECT id, title, priority, description
    FROM tickets
    WHERE description ILIKE $1
      AND status = 'open'
      AND source = 'pm_agent'
    ORDER BY
      CASE priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
      created_at ASC
    LIMIT 5
  `, [`%ASSIGNED TO: ${agentName}%`]);

  if (assignedTickets.length > 0) {
    context.push(`🎯 TICKETS ASSIGNED TO YOU (${agentName}):`);
    for (const ticket of assignedTickets) {
      context.push(`   [${ticket.priority?.toUpperCase() || 'MEDIUM'}] ${ticket.title}`);
      context.push(`   ID: ${ticket.id}`);
      if (ticket.description) {
        const descPreview = ticket.description.slice(0, 200).replace(/\n/g, ' ');
        context.push(`   ${descPreview}${ticket.description.length > 200 ? '...' : ''}`);
      }
      context.push('');
    }
  } else {
    context.push(`📭 No tickets currently assigned to ${agentName}`);
    context.push('');
  }

  context.push('=== END CONTEXT ===');
  return context.join('\n');
}

/**
 * Execute an agent task
 */
async function executeAgentTask(
  agent: ScheduledAgent,
  taskId: string,
  taskType: string
): Promise<void> {
  try {
    // Fetch real system context
    const systemContext = await getAgentContext(agent.type, agent.name);

    // Default task based on agent type
    const defaultTasks: Record<string, string> = {
      dev: 'Analyze the system context above. Report any issues that need attention, suggest improvements, and identify any concerning trends.',
      research: 'Analyze the business metrics above. Identify growth opportunities, concerning trends, and provide actionable recommendations.',
      support: 'Review the ticket data above. Prioritize issues, identify patterns, and suggest responses or escalations needed.',
      content: 'Based on the system stats, suggest content ideas that would be valuable to our users. Consider documentation gaps or feature highlights.',
      monitor: 'Analyze the system health metrics above. Report any anomalies, performance concerns, or areas needing immediate attention.',
      custom: 'Analyze the provided context and execute your assigned task.',
    };
    const userPrompt = defaultTasks[agent.type] ?? 'Analyze the provided context and report your findings.';

    const fullPrompt = `${systemContext}\n\nYOUR TASK:\n${userPrompt}\n\nProvide a clear, actionable response. If you identify issues requiring human intervention, clearly state them.`;

    // Log task execution
    await query(`
      INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
      VALUES ($1, $2, 'info', 'Scheduler executing task', $3)
    `, [agent.id, taskId, JSON.stringify({ task_type: taskType, triggered_by: 'scheduler' })]);

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

    // Check for intervention requests - avoid duplicates
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

    // PROJECT MANAGER: Parse output for ticket requests and create real tickets
    if (agent.name === 'Project Manager') {
      // Handle markdown bold formatting: **TITLE**: or **TITLE:** or just TITLE:
      const ticketMatches = output.matchAll(/\*?\*?TITLE\*?\*?:?\s*:?\s*([^\n]+)\s*\n[\s\S]*?\*?\*?ASSIGNED TO\*?\*?:?\s*:?\s*([^\n]+)(?:[\s\S]*?\*?\*?PRIORITY\*?\*?:?\s*:?\s*([^\n]+))?/gi);
      let ticketsCreated = 0;

      for (const match of ticketMatches) {
        // Clean up markdown formatting (remove ** and other markers)
        const title = match[1]?.replace(/\*+/g, '').trim();
        // Stop agent name at parenthesis, comma, or common boundary words
        let assignedTo = match[2]?.replace(/\*+/g, '').trim();
        assignedTo = assignedTo?.split(/[\(\,]|after|before|once|when|if/i)[0]?.trim();
        const priority = match[3]?.replace(/\*+/g, '').trim()?.toLowerCase() || 'medium';

        if (!title || !assignedTo) continue;
        console.log(`[Scheduler] PM parsed ticket: "${title}" -> ${assignedTo}`);

        // Find the assigned agent
        const assignedAgent = await queryOne<{ id: string; name: string }>(`
          SELECT id, name FROM agents
          WHERE name ILIKE $1 AND is_decommissioned = false
          LIMIT 1
        `, [`%${assignedTo}%`]);

        if (!assignedAgent) {
          console.log(`[Scheduler] PM ticket assignment failed: agent "${assignedTo}" not found`);
          continue;
        }

        // Check if similar ticket already exists
        const existingTicket = await queryOne<{ id: string }>(`
          SELECT id FROM tickets
          WHERE title ILIKE $1 AND status IN ('open', 'in_progress')
          LIMIT 1
        `, [`%${title.slice(0, 50)}%`]);

        if (existingTicket) {
          console.log(`[Scheduler] PM ticket skipped: "${title}" already exists`);
          continue;
        }

        // Extract description from the output
        const descStart = output.indexOf(title);
        const descMatch = output.slice(descStart).match(/DESCRIPTION:\s*([\s\S]*?)(?=ASSIGNED TO:|PRIORITY:|TICKET #|\n\n\*\*|$)/i);
        const description = descMatch && descMatch[1] ? descMatch[1].trim() : title;

        // Create the ticket (assigned_to has FK to users, so we put agent assignment in description)
        const fullDescription = `ASSIGNED TO: ${assignedAgent.name}\n\n${description}`;
        await query(`
          INSERT INTO tickets (title, description, status, priority, category, source, created_at)
          VALUES ($1, $2, 'open', $3, 'development', 'pm_agent', NOW())
        `, [title, fullDescription, priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'medium']);

        ticketsCreated++;
        console.log(`[Scheduler] PM created ticket: "${title}" assigned to ${assignedAgent.name}`);
      }

      if (ticketsCreated > 0) {
        await query(`
          INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
          VALUES ($1, $2, 'info', 'Created tickets from PM output', $3)
        `, [agent.id, taskId, JSON.stringify({ tickets_created: ticketsCreated })]);
      }
    }

    // DEV AGENTS: Check if they completed a ticket and update its status
    if (agent.name === 'Backend Dev' || agent.name === 'Frontend Dev') {
      // Look for "TICKET: <title>" and "STATUS: complete" pattern
      const ticketMatch = output.match(/TICKET:\s*([^\n]+)/i);
      const statusMatch = output.match(/STATUS:\s*(complete|done|finished)/i);

      if (ticketMatch && ticketMatch[1] && statusMatch) {
        const ticketTitle = ticketMatch[1].replace(/\*+/g, '').trim();

        // Find and close matching open ticket
        const closedTicket = await queryOne<{ id: string; title: string }>(`
          UPDATE tickets
          SET status = 'resolved', updated_at = NOW()
          WHERE status = 'open'
            AND source = 'pm_agent'
            AND (title ILIKE $1 OR title ILIKE $2)
          RETURNING id, title
        `, [`%${ticketTitle.slice(0, 30)}%`, `%${ticketTitle.split(' ').slice(0, 4).join(' ')}%`]);

        if (closedTicket) {
          console.log(`[Scheduler] ${agent.name} completed ticket: "${closedTicket.title}"`);
          await query(`
            INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
            VALUES ($1, $2, 'info', 'Completed ticket', $3)
          `, [agent.id, taskId, JSON.stringify({ ticket_id: closedTicket.id, ticket_title: closedTicket.title })]);
        }
      }
    }

    // Only create tickets when issues are found (interventions needed)
    // Skip if agent already has an open ticket - only surface if previous was resolved
    if (hasInterventions) {
      // Check for existing open ticket for this agent
      const existingTicket = await queryOne<{ id: string }>(`
        SELECT id FROM tickets
        WHERE agent_id = $1 AND status IN ('open', 'in_progress')
        LIMIT 1
      `, [agent.id]);

      if (!existingTicket) {
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
      } else {
        // Log that we skipped due to existing open ticket
        await query(`
          INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
          VALUES ($1, $2, 'info', 'Skipped ticket creation - open ticket already exists', $3)
        `, [agent.id, taskId, JSON.stringify({ existing_ticket_id: existingTicket.id })]);
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
      VALUES ($1, $2, 'info', 'Scheduled task completed', $3)
    `, [agent.id, taskId, JSON.stringify({
      output_length: output.length,
      tokens: data.usage,
      interventions_created: interventionMatches?.length || 0
    })]);

    console.log(`[Scheduler] Agent ${agent.name} completed task ${taskId}`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await query(`
      UPDATE agent_tasks
      SET status = 'failed', error = $1, completed_at = NOW()
      WHERE id = $2
    `, [errorMessage, taskId]);

    await query(`
      UPDATE agents
      SET status = 'error',
          tasks_failed = tasks_failed + 1,
          updated_at = NOW()
      WHERE id = $1
    `, [agent.id]);

    await query(`
      INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
      VALUES ($1, $2, 'error', 'Scheduled task failed', $3)
    `, [agent.id, taskId, JSON.stringify({ error: errorMessage })]);

    console.error(`[Scheduler] Agent ${agent.name} task ${taskId} failed:`, errorMessage);
  }
}

/**
 * Create a task for an agent
 */
async function createAgentTask(agent: ScheduledAgent, taskType: string): Promise<string | null> {
  try {
    const result = await queryOne<{ id: string }>(`
      INSERT INTO agent_tasks (agent_id, type, status, input, created_at)
      VALUES ($1, $2, 'pending', $3, NOW())
      RETURNING id
    `, [agent.id, taskType, JSON.stringify({ triggered_by: 'scheduler', schedule_type: agent.schedule_type })]);

    return result?.id || null;
  } catch (error) {
    console.error(`[Scheduler] Failed to create task for agent ${agent.name}:`, error);
    return null;
  }
}

/**
 * Process scheduled and continuous agents
 */
async function processScheduledAgents(): Promise<void> {
  if (isRunning) {
    console.log('[Scheduler] Previous run still in progress, skipping...');
    return;
  }

  isRunning = true;

  try {
    // Auto-approve non-destructive interventions
    await autoApproveInterventions();
    // Get agents that need to run:
    // 1. Continuous agents that are idle
    // 2. Scheduled agents where next_run_at <= NOW()
    const agentsToRun = await query<ScheduledAgent>(`
      SELECT
        id, name, type, status, system_prompt, config,
        COALESCE(schedule_type, 'manual') as schedule_type,
        schedule_interval_minutes,
        next_run_at,
        COALESCE(is_continuous, FALSE) as is_continuous,
        last_run_at
      FROM agents
      WHERE is_decommissioned = FALSE
        AND status IN ('idle', 'error')
        AND (
          (is_continuous = TRUE)
          OR (schedule_type = 'scheduled' AND next_run_at IS NOT NULL AND next_run_at <= NOW())
        )
      ORDER BY
        is_continuous DESC,
        next_run_at ASC NULLS LAST
      LIMIT 5
    `);

    if (agentsToRun.length === 0) {
      return;
    }

    console.log(`[Scheduler] Found ${agentsToRun.length} agents to run`);

    for (const agent of agentsToRun) {
      // Determine task type based on agent type
      const taskTypes: Record<string, string> = {
        dev: 'system_analysis',
        research: 'market_research',
        support: 'ticket_triage',
        content: 'content_ideation',
        monitor: 'health_check',
        custom: 'custom_task',
      };
      const taskType = taskTypes[agent.type] || 'general_task';

      // Create task
      const taskId = await createAgentTask(agent, taskType);
      if (!taskId) continue;

      // Set agent to running
      await query(`
        UPDATE agents
        SET status = 'running',
            current_task = $1,
            updated_at = NOW()
        WHERE id = $2
      `, [taskId, agent.id]);

      // Update next_run_at for scheduled agents
      if (agent.schedule_type === 'scheduled' && agent.schedule_interval_minutes) {
        await query(`
          UPDATE agents
          SET next_run_at = NOW() + ($1 || ' minutes')::INTERVAL
          WHERE id = $2
        `, [agent.schedule_interval_minutes.toString(), agent.id]);
      }

      // For continuous agents, set next run to 15 minutes from now
      if (agent.is_continuous) {
        await query(`
          UPDATE agents
          SET next_run_at = NOW() + INTERVAL '15 minutes'
          WHERE id = $1
        `, [agent.id]);
      }

      // Update task to in_progress
      await query(`
        UPDATE agent_tasks SET status = 'in_progress', started_at = NOW() WHERE id = $1
      `, [taskId]);

      // Log scheduler trigger
      await query(`
        INSERT INTO agent_logs (agent_id, task_id, level, message, metadata)
        VALUES ($1, $2, 'info', 'Scheduler triggered agent', $3)
      `, [agent.id, taskId, JSON.stringify({
        schedule_type: agent.schedule_type,
        is_continuous: agent.is_continuous,
        interval_minutes: agent.schedule_interval_minutes
      })]);

      console.log(`[Scheduler] Starting agent ${agent.name} (${agent.schedule_type})`);

      // Execute task asynchronously
      executeAgentTask(agent, taskId, taskType).catch(err => {
        console.error(`[Scheduler] Error executing task for ${agent.name}:`, err);
      });

      // Small delay between starting agents to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

  } catch (error) {
    console.error('[Scheduler] Error in scheduler loop:', error);
  } finally {
    isRunning = false;
  }
}

/**
 * Start the agent scheduler
 */
export function startAgentScheduler(intervalMs: number = 60000): void {
  if (schedulerInterval) {
    console.log('[Scheduler] Scheduler already running');
    return;
  }

  console.log(`[Scheduler] Starting agent scheduler (interval: ${intervalMs}ms)`);

  // Run immediately on start
  processScheduledAgents();

  // Then run on interval
  schedulerInterval = setInterval(() => {
    processScheduledAgents();
  }, intervalMs);
}

/**
 * Stop the agent scheduler
 */
export function stopAgentScheduler(): void {
  if (schedulerInterval) {
    console.log('[Scheduler] Stopping agent scheduler');
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/**
 * Check if scheduler is running
 */
export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

/**
 * Get scheduler status
 */
export async function getSchedulerStatus(): Promise<{
  running: boolean;
  nextScheduledAgents: Array<{ name: string; next_run_at: string | null; schedule_type: string }>;
  continuousAgents: Array<{ name: string; status: string }>;
}> {
  const scheduled = await query<{ name: string; next_run_at: string | null; schedule_type: string }>(`
    SELECT name, next_run_at, COALESCE(schedule_type, 'manual') as schedule_type
    FROM agents
    WHERE is_decommissioned = FALSE
      AND schedule_type = 'scheduled'
      AND next_run_at IS NOT NULL
    ORDER BY next_run_at ASC
    LIMIT 10
  `);

  const continuous = await query<{ name: string; status: string }>(`
    SELECT name, status
    FROM agents
    WHERE is_decommissioned = FALSE
      AND is_continuous = TRUE
    ORDER BY name
  `);

  return {
    running: isSchedulerRunning(),
    nextScheduledAgents: scheduled,
    continuousAgents: continuous,
  };
}
