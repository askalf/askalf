/**
 * Agent Reputation Economy
 *
 * Every agent earns a reputation score based on:
 * - Ticket resolution quality (did the fix stick?)
 * - Cost efficiency (output quality vs cost)
 * - Completion rate (how often do they finish vs max-turns?)
 * - Peer feedback (other agents rating the work)
 *
 * High-rep agents get:
 * - Harder tickets routed to them
 * - Higher autonomy level
 * - More execution budget
 *
 * Low-rep agents get:
 * - Retrained by Fleet Chief (prompt rewrite)
 * - Demoted to simpler tasks
 * - Eventually decommissioned if no improvement
 */

import { query, queryOne } from '../database.js';
import { ulid } from 'ulid';

interface AgentReputation {
  agent_id: string;
  agent_name: string;
  completion_rate: number;      // 0-1: completed / (completed + failed)
  cost_efficiency: number;      // 0-1: lower cost per successful execution = higher
  resolution_quality: number;   // 0-1: resolved tickets that stayed resolved
  consistency: number;          // 0-1: variance in output quality
  overall_score: number;        // weighted average
  total_executions: number;
  total_cost: number;
  rank: number;
}

/**
 * Calculate reputation scores for all active fleet agents.
 */
export async function calculateReputations(): Promise<AgentReputation[]> {
  const agents = await query<{
    id: string; name: string;
    tasks_completed: number; tasks_failed: number;
  }>(
    `SELECT id, name, tasks_completed, tasks_failed FROM forge_agents WHERE status = 'active' AND is_internal = true`,
  );

  const reputations: AgentReputation[] = [];

  for (const agent of agents) {
    // Completion rate
    const total = agent.tasks_completed + agent.tasks_failed;
    const completionRate = total > 0 ? agent.tasks_completed / total : 0.5;

    // Cost efficiency — compare to fleet average
    const costData = await queryOne<{ avg_cost: string; agent_cost: string; exec_count: string }>(
      `SELECT
        (SELECT COALESCE(AVG(cost), 0)::text FROM forge_executions WHERE status = 'completed' AND created_at > NOW() - INTERVAL '7 days') as avg_cost,
        (SELECT COALESCE(AVG(cost), 0)::text FROM forge_executions WHERE agent_id = $1 AND status = 'completed' AND created_at > NOW() - INTERVAL '7 days') as agent_cost,
        (SELECT COUNT(*)::text FROM forge_executions WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '7 days') as exec_count`,
      [agent.id],
    );

    const fleetAvgCost = parseFloat(costData?.avg_cost || '0.1');
    const agentAvgCost = parseFloat(costData?.agent_cost || '0.1');
    const execCount = parseInt(costData?.exec_count || '0');
    // Lower cost = higher efficiency. Normalize: if agent costs half of fleet avg → 1.0
    const costEfficiency = fleetAvgCost > 0 ? Math.min(fleetAvgCost / Math.max(agentAvgCost, 0.001), 2) / 2 : 0.5;

    // Max-turns failure rate (incomplete executions = bad)
    const maxTurnsData = await queryOne<{ max_turns_hits: string; total: string }>(
      `SELECT
        COUNT(*) FILTER (WHERE output LIKE '%Max turns reached%')::text as max_turns_hits,
        COUNT(*)::text as total
       FROM forge_executions WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
      [agent.id],
    );
    const maxTurnsRate = parseInt(maxTurnsData?.total || '1') > 0
      ? 1 - (parseInt(maxTurnsData?.max_turns_hits || '0') / parseInt(maxTurnsData?.total || '1'))
      : 0.5;

    // Resolution quality — for Builder: did resolved tickets stay resolved?
    let resolutionQuality = 0.5;
    if (agent.name === 'Builder') {
      const ticketData = await queryOne<{ resolved: string; reopened: string }>(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'resolved')::text as resolved,
          COUNT(*) FILTER (WHERE status = 'open' AND resolution IS NOT NULL)::text as reopened
        FROM agent_tickets WHERE assigned_to = 'Builder' AND deleted_at IS NULL
      `);
      const resolved = parseInt(ticketData?.resolved || '0');
      const reopened = parseInt(ticketData?.reopened || '0');
      resolutionQuality = resolved > 0 ? (resolved - reopened) / resolved : 0.5;
    }

    // Weighted overall score
    const overall = (
      completionRate * 0.30 +
      costEfficiency * 0.25 +
      maxTurnsRate * 0.25 +
      resolutionQuality * 0.20
    );

    const totalCost = parseFloat(costData?.agent_cost || '0') * execCount;

    reputations.push({
      agent_id: agent.id,
      agent_name: agent.name,
      completion_rate: Math.round(completionRate * 100) / 100,
      cost_efficiency: Math.round(costEfficiency * 100) / 100,
      resolution_quality: Math.round(resolutionQuality * 100) / 100,
      consistency: Math.round(maxTurnsRate * 100) / 100,
      overall_score: Math.round(overall * 100) / 100,
      total_executions: execCount,
      total_cost: Math.round(totalCost * 10000) / 10000,
      rank: 0,
    });
  }

  // Assign ranks
  reputations.sort((a, b) => b.overall_score - a.overall_score);
  reputations.forEach((r, i) => { r.rank = i + 1; });

  return reputations;
}

/**
 * Store reputation scores in the database for Fleet Chief and dashboard visibility.
 */
export async function updateReputationScores(): Promise<void> {
  const reps = await calculateReputations();

  for (const rep of reps) {
    // Store in agent's metadata
    await query(
      `UPDATE forge_agents SET metadata = jsonb_set(
        COALESCE(metadata, '{}'),
        '{reputation}',
        $1::jsonb
      ) WHERE id = $2`,
      [
        JSON.stringify({
          score: rep.overall_score,
          rank: rep.rank,
          completion_rate: rep.completion_rate,
          cost_efficiency: rep.cost_efficiency,
          consistency: rep.consistency,
          resolution_quality: rep.resolution_quality,
          updated_at: new Date().toISOString(),
        }),
        rep.agent_id,
      ],
    );
  }

  // Store fleet-wide reputation report
  const topPerformer = reps[0];
  const underperformer = reps[reps.length - 1];

  if (topPerformer && underperformer) {
    await query(
      `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, tenant_id, content, source, importance, metadata)
       VALUES ($1, '01DFLTFLEETCHIEF00000000000', 'selfhosted-admin', 'selfhosted', $2, 'reputation_system', 0.8, $3)`,
      [
        ulid(),
        `Reputation scores updated. Top: ${topPerformer.agent_name} (${topPerformer.overall_score}). Bottom: ${underperformer.agent_name} (${underperformer.overall_score}). Fleet avg: ${(reps.reduce((s, r) => s + r.overall_score, 0) / reps.length).toFixed(2)}`,
        JSON.stringify({ type: 'reputation_report', scores: reps.map(r => ({ name: r.agent_name, score: r.overall_score, rank: r.rank })) }),
      ],
    );
  }

  console.log(`[Reputation] Updated scores for ${reps.length} agents. Top: ${topPerformer?.agent_name} (${topPerformer?.overall_score})`);
}

/**
 * Apply reputation consequences — called by Fleet Chief during evolution cycle.
 */
export async function applyReputationConsequences(): Promise<string[]> {
  const reps = await calculateReputations();
  const actions: string[] = [];

  for (const rep of reps) {
    if (rep.total_executions < 5) continue; // Not enough data

    // Promote high performers (score > 0.8)
    if (rep.overall_score > 0.8) {
      const current = await queryOne<{ autonomy_level: number }>(
        `SELECT autonomy_level FROM forge_agents WHERE id = $1`, [rep.agent_id],
      );
      if (current && current.autonomy_level < 4) {
        // Don't auto-promote, just flag for Fleet Chief
        actions.push(`PROMOTE candidate: ${rep.agent_name} (score ${rep.overall_score}, rank #${rep.rank})`);
      }
    }

    // Flag underperformers (score < 0.4)
    if (rep.overall_score < 0.4) {
      actions.push(`RETRAIN needed: ${rep.agent_name} (score ${rep.overall_score}) — ${rep.consistency < 0.5 ? 'hits max turns often' : rep.cost_efficiency < 0.3 ? 'too expensive' : 'low completion rate'}`);
    }

    // Flag cost outliers
    if (rep.cost_efficiency < 0.2 && rep.total_cost > 1.0) {
      actions.push(`COST ALERT: ${rep.agent_name} is 5x+ more expensive than fleet average ($${rep.total_cost.toFixed(2)}/week)`);
    }
  }

  return actions;
}
