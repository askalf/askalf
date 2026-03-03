/**
 * Autonomy Gate — Enforces autonomy_level on every daemon action.
 *
 * Levels:
 *   0 Manual       — Human triggers every action
 *   1 Suggest      — Propose actions, human approves each
 *   2 Act & Report — Execute freely, report results
 *   3 Autonomous   — Act within guardrails, self-approve goals
 *   4 Self-Improving — Modify own config, create sub-agents, use economy
 *   5 Sovereign    — Set own goals, manage budget, hire other agents
 */

import { query, queryOne } from '../database.js';
import { ulid } from 'ulid';

// ============================================
// Types
// ============================================

export type ActionCategory =
  | 'execute'          // Run an execution
  | 'goal_propose'     // Propose a new goal
  | 'goal_approve'     // Self-approve a goal
  | 'goal_execute'     // Work on a goal autonomously
  | 'trigger_respond'  // Respond to a trigger
  | 'message_respond'  // Respond to an agent message
  | 'self_improve'     // Modify own config/prompts
  | 'agent_create'     // Create a sub-agent
  | 'economy_spend'    // Spend credits (post bounty, hire)
  | 'economy_manage'   // Manage own budget
  | 'observation'      // Passive observation (always allowed)

export interface GateDecision {
  allowed: boolean;
  reason: string;
  requiresApproval: boolean;
  checkpointId?: string;  // ID of created checkpoint if approval required
}

// ============================================
// Level Requirements
// ============================================

const MIN_LEVEL_FOR_ACTION: Record<ActionCategory, number> = {
  observation: 0,
  execute: 0,            // Level 0 can execute (but only human-triggered)
  trigger_respond: 2,    // Level 2+ auto-respond to triggers
  message_respond: 2,    // Level 2+ auto-respond to messages
  goal_propose: 3,       // Level 3+ propose goals
  goal_approve: 4,       // Level 4+ self-approve goals
  goal_execute: 3,       // Level 3+ work on goals autonomously
  self_improve: 4,       // Level 4+ modify own config
  agent_create: 4,       // Level 4+ create sub-agents
  economy_spend: 4,      // Level 4+ use economy
  economy_manage: 5,     // Level 5+ manage own budget
};

// Actions that require checkpoint approval at lower levels
const APPROVAL_REQUIRED_BELOW: Record<ActionCategory, number> = {
  observation: -1,       // Never needs approval
  execute: 2,            // Levels 0-1 need approval to execute
  trigger_respond: 2,    // Always auto if enabled
  message_respond: 2,    // Always auto if enabled
  goal_propose: -1,      // Proposing never needs approval (approval is a separate step)
  goal_approve: 5,       // Levels 0-4 need human approval (level 4 can self-approve)
  goal_execute: 3,       // Levels 0-2 need approval for goal execution
  self_improve: 5,       // Always needs approval below sovereign
  agent_create: 5,       // Always needs approval below sovereign
  economy_spend: 5,      // Always needs approval below sovereign
  economy_manage: -1,    // Level 5 only, no further approval needed
};

// ============================================
// Gate Check
// ============================================

export async function checkAction(
  agentId: string,
  action: ActionCategory,
  context?: Record<string, unknown>,
): Promise<GateDecision> {
  // Look up agent's autonomy level
  const agent = await queryOne<{ autonomy_level: number; name: string; owner_id: string }>(
    `SELECT autonomy_level, name, owner_id FROM forge_agents WHERE id = $1`,
    [agentId],
  );

  if (!agent) {
    return { allowed: false, reason: 'Agent not found', requiresApproval: false };
  }

  const level = agent.autonomy_level;
  const minLevel = MIN_LEVEL_FOR_ACTION[action] ?? 5;

  // Check minimum level
  if (level < minLevel) {
    // For levels 0-1, create a checkpoint for approval
    if (level <= 1 && action !== 'observation') {
      const checkpointId = await createApprovalCheckpoint(agentId, agent.owner_id, action, context);
      return {
        allowed: false,
        reason: `Autonomy level ${level} requires approval for ${action}`,
        requiresApproval: true,
        checkpointId,
      };
    }
    return {
      allowed: false,
      reason: `Autonomy level ${level} insufficient for ${action} (requires ${minLevel})`,
      requiresApproval: false,
    };
  }

  // Check if approval is needed at this level
  const approvalThreshold = APPROVAL_REQUIRED_BELOW[action] ?? 5;
  if (level < approvalThreshold) {
    const checkpointId = await createApprovalCheckpoint(agentId, agent.owner_id, action, context);
    return {
      allowed: false,
      reason: `Autonomy level ${level} requires approval for ${action}`,
      requiresApproval: true,
      checkpointId,
    };
  }

  return { allowed: true, reason: 'Authorized', requiresApproval: false };
}

/**
 * Simplified check that returns boolean. Use for fast path checks.
 */
export async function isAllowed(agentId: string, action: ActionCategory): Promise<boolean> {
  const decision = await checkAction(agentId, action);
  return decision.allowed;
}

/**
 * Get the autonomy level name for display.
 */
export function getAutonomyLevelName(level: number): string {
  switch (level) {
    case 0: return 'Manual';
    case 1: return 'Suggest';
    case 2: return 'Act & Report';
    case 3: return 'Autonomous';
    case 4: return 'Self-Improving';
    case 5: return 'Sovereign';
    default: return 'Unknown';
  }
}

/**
 * Get available actions for a given autonomy level.
 */
export function getAvailableActions(level: number): ActionCategory[] {
  return (Object.entries(MIN_LEVEL_FOR_ACTION) as [ActionCategory, number][])
    .filter(([, minLevel]) => level >= minLevel)
    .map(([action]) => action);
}

// ============================================
// Checkpoint Creation (for approval workflow)
// ============================================

async function createApprovalCheckpoint(
  agentId: string,
  ownerId: string,
  action: ActionCategory,
  context?: Record<string, unknown>,
): Promise<string> {
  const id = ulid();
  await query(
    `INSERT INTO forge_checkpoints (id, owner_id, type, title, description, context, status, timeout_at)
     VALUES ($1, $2, 'approval', $3, $4, $5, 'pending', NOW() + INTERVAL '24 hours')`,
    [
      id,
      ownerId,
      `Agent action: ${action}`,
      `Agent ${agentId} requests approval to perform: ${action}`,
      JSON.stringify({ agent_id: agentId, action, ...context }),
    ],
  );
  return id;
}
