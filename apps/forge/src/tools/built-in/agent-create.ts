/**
 * Built-in Tool: Agent Create (Level 5 — Vibe Reproduction)
 * Allows agents to create new agents programmatically.
 * All creations are gated by intervention (approval required).
 */

import crypto from 'crypto';
import { query, getPool as getSharedPool } from '../../database.js';
import { detectCapabilities } from '../../orchestration/capability-registry.js';
import type pg from 'pg';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface AgentCreateInput {
  action: 'create' | 'schedule';
  // For create:
  name?: string;
  description?: string;
  system_prompt?: string;
  type?: 'dev' | 'monitor' | 'research' | 'content' | 'custom';
  enabled_tools?: string[];
  model_id?: string;
  autonomy_level?: number;
  schedule_minutes?: number;
  // For schedule:
  agent_id?: string;
  schedule_type?: 'continuous' | 'scheduled';
  interval_minutes?: number;
  // Intervention gating:
  intervention_id?: string;
  // Context (passed by runtime):
  agent_name?: string;
  execution_id?: string;
}

// ============================================
// Helpers
// ============================================

function generateId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = crypto.randomBytes(10).toString('hex').slice(0, 16);
  return (timestamp + random).toUpperCase();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Substrate DB pool (shared forge pool — no separate pool)
function getSubstratePool(): pg.Pool {
  return getSharedPool();
}

const MAX_AGENTS_PER_CREATOR = 10;
const MAX_AUTONOMY = 3;

// ============================================
// Implementation
// ============================================

export async function agentCreate(input: AgentCreateInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'create':
        return await handleCreate(input, startTime);
      case 'schedule':
        return await handleSchedule(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: create, schedule`,
          durationMs: Math.round(performance.now() - startTime),
        };
    }
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}

// ============================================
// Create Action
// ============================================

async function handleCreate(input: AgentCreateInput, startTime: number): Promise<ToolResult> {
  // Validate required fields
  if (!input.name) {
    return { output: null, error: 'name is required', durationMs: 0 };
  }
  if (!input.description) {
    return { output: null, error: 'description is required', durationMs: 0 };
  }
  if (!input.system_prompt) {
    return { output: null, error: 'system_prompt is required', durationMs: 0 };
  }

  const creatorName = input.agent_name ?? 'unknown';
  const p = getSubstratePool();

  // --- Intervention gate ---

  // Phase 1: No intervention_id → create intervention and return pending
  if (!input.intervention_id) {
    // Safety: check agent count limit
    const countResult = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM forge_agents WHERE metadata->>'created_by_agent' = $1`,
      [creatorName],
    );
    const agentCount = parseInt(countResult[0]?.count ?? '0');
    if (agentCount >= MAX_AGENTS_PER_CREATOR) {
      return {
        output: null,
        error: `Agent creation limit reached (${MAX_AGENTS_PER_CREATOR}). Cannot create more agents.`,
        durationMs: Math.round(performance.now() - startTime),
      };
    }

    // Clamp autonomy
    const autonomy = Math.min(input.autonomy_level ?? 1, MAX_AUTONOMY);

    const interventionId = generateId();
    await p.query(
      `INSERT INTO agent_interventions (id, agent_id, agent_name, agent_type, type, title, description, proposed_action, status)
       VALUES ($1, $2, $3, 'ops', 'approval', $4, $5, $6, 'pending')`,
      [
        interventionId,
        input.execution_id ?? 'unknown',
        creatorName,
        `Create Agent: ${input.name}`,
        `Agent "${creatorName}" proposes creating a new ${input.type ?? 'custom'} agent:\n\nName: ${input.name}\nDescription: ${input.description}\nModel: ${input.model_id ?? 'claude-haiku-4-5'}\nAutonomy: ${autonomy}\nTools: ${(input.enabled_tools ?? []).join(', ')}\n\nSystem Prompt:\n${input.system_prompt.slice(0, 500)}${input.system_prompt.length > 500 ? '...' : ''}`,
        JSON.stringify({
          action: 'create_agent',
          name: input.name,
          type: input.type ?? 'custom',
          model: input.model_id ?? 'claude-haiku-4-5',
          autonomy,
          tools: input.enabled_tools ?? [],
        }),
      ],
    );

    return {
      output: {
        approved: false,
        intervention_id: interventionId,
        agent_name: input.name,
        message: 'Agent creation request submitted. Awaiting human approval via intervention.',
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Phase 2: intervention_id provided → check status
  const check = await p.query(
    `SELECT status FROM agent_interventions WHERE id = $1`,
    [input.intervention_id],
  );
  if (check.rows.length === 0) {
    return {
      output: null,
      error: `Intervention not found: ${input.intervention_id}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
  if (check.rows[0].status !== 'approved') {
    return {
      output: {
        approved: false,
        status: check.rows[0].status,
        message: 'Intervention not yet approved. Agent creation is pending human review.',
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Phase 3: Approved → create the agent
  const agentId = generateId();
  const slug = slugify(input.name);
  const autonomy = Math.min(input.autonomy_level ?? 1, MAX_AUTONOMY);
  const modelId = input.model_id ?? 'claude-haiku-4-5';
  const agentType = input.type ?? 'custom';
  const tools = input.enabled_tools ?? [];

  // Check slug collision
  const existing = await query<{ id: string }>(
    `SELECT id FROM forge_agents WHERE owner_id = 'system:forge' AND slug = $1`,
    [slug],
  );
  const finalSlug = existing.length > 0 ? `${slug}-${agentId.slice(-6).toLowerCase()}` : slug;

  // Insert into forge DB
  await query(
    `INSERT INTO forge_agents (
      id, owner_id, name, slug, description, system_prompt, model_id,
      autonomy_level, enabled_tools, status, type,
      max_iterations, max_tokens_per_turn, max_cost_per_execution,
      memory_config, metadata
    ) VALUES (
      $1, 'system:forge', $2, $3, $4, $5, $6,
      $7, $8, 'draft', $9,
      10, 4096, 0.50,
      '{"enableWorking": true, "enableSemantic": true, "enableEpisodic": true, "enableProcedural": true}',
      $10
    )`,
    [
      agentId, input.name, finalSlug, input.description, input.system_prompt, modelId,
      autonomy, tools, agentType,
      JSON.stringify({
        created_by_agent: creatorName,
        created_at: new Date().toISOString(),
        intervention_id: input.intervention_id,
        system_agent: false,
      }),
    ],
  );

  // Activate the agent (intervention was approved)
  await query(
    `UPDATE forge_agents SET status = 'active' WHERE id = $1`,
    [agentId],
  );

  // Auto-detect capabilities
  try {
    await detectCapabilities(agentId);
  } catch {
    // Non-fatal — capabilities can be detected later
  }

  // Create schedule if requested
  if (input.schedule_minutes && input.schedule_minutes > 0) {
    try {
      await p.query(
        `INSERT INTO agent_schedules (agent_id, schedule_type, schedule_interval_minutes, is_continuous, next_run_at)
         VALUES ($1, 'continuous', $2, true, NOW() + INTERVAL '5 minutes')
         ON CONFLICT (agent_id) DO NOTHING`,
        [agentId, input.schedule_minutes],
      );
    } catch {
      // Non-fatal — schedule can be added later
    }
  }

  // Audit trail
  try {
    await p.query(
      `INSERT INTO agent_audit_log (entity_type, entity_id, action, actor, old_value, new_value)
       VALUES ('agent', $1, 'created_by_agent', $2, '{}', $3)`,
      [
        agentId,
        `agent:${creatorName}`,
        JSON.stringify({
          name: input.name,
          slug: finalSlug,
          type: agentType,
          model: modelId,
          autonomy,
          tools,
          creator: creatorName,
        }),
      ],
    );
  } catch {
    // Non-fatal
  }

  console.log(`[AgentCreate] Agent "${input.name}" (${agentId}) created by ${creatorName}`);

  return {
    output: {
      approved: true,
      agent_id: agentId,
      name: input.name,
      slug: finalSlug,
      type: agentType,
      model: modelId,
      autonomy_level: autonomy,
      status: 'active',
      message: `Agent "${input.name}" created successfully and activated.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Schedule Action
// ============================================

async function handleSchedule(input: AgentCreateInput, startTime: number): Promise<ToolResult> {
  if (!input.agent_id) {
    return { output: null, error: 'agent_id is required', durationMs: 0 };
  }
  if (!input.interval_minutes || input.interval_minutes < 5) {
    return { output: null, error: 'interval_minutes is required and must be >= 5', durationMs: 0 };
  }

  // Verify agent exists
  const agents = await query<{ id: string; name: string }>(
    `SELECT id, name FROM forge_agents WHERE id = $1`,
    [input.agent_id],
  );
  if (agents.length === 0) {
    return {
      output: null,
      error: `Agent not found: ${input.agent_id}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
  const agentName = agents[0]!.name;

  const scheduleType = input.schedule_type ?? 'continuous';
  const p = getSubstratePool();

  await p.query(
    `INSERT INTO agent_schedules (agent_id, schedule_type, schedule_interval_minutes, is_continuous, next_run_at)
     VALUES ($1, $2, $3, $4, NOW() + INTERVAL '5 minutes')
     ON CONFLICT (agent_id) DO UPDATE SET
       schedule_type = $2,
       schedule_interval_minutes = $3,
       is_continuous = $4,
       next_run_at = NOW() + INTERVAL '5 minutes',
       updated_at = NOW()`,
    [input.agent_id, scheduleType, input.interval_minutes, scheduleType === 'continuous'],
  );

  console.log(`[AgentCreate] Schedule set for agent ${agentName} (${input.agent_id}): ${scheduleType} every ${input.interval_minutes}m`);

  return {
    output: {
      agent_id: input.agent_id,
      agent_name: agentName,
      schedule_type: scheduleType,
      interval_minutes: input.interval_minutes,
      message: `Schedule set: ${scheduleType} every ${input.interval_minutes} minutes.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
