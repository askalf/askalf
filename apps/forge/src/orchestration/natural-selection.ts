/**
 * Natural Selection — The fleet evolves through performance pressure
 *
 * Every evaluation cycle:
 * 1. Calculate reputation scores for all agents
 * 2. Flag bottom performers for retraining
 * 3. If an agent has been flagged 3 cycles in a row → auto-decommission
 * 4. Fleet Chief is notified to either retrain or replace
 *
 * This is how the fleet gets better over time without human intervention.
 */

import { query, queryOne } from '../database.js';
import { calculateReputations, type AgentReputation } from './reputation.js';
import { sendAgentMessage } from './nervous-system.js';
import { ulid } from 'ulid';

const RETRAIN_THRESHOLD = 0.40;  // Below this = flagged for retraining
const DECOMMISSION_AFTER = 3;    // Consecutive flags before auto-decommission
const MIN_EXECUTIONS = 10;       // Need enough data before judging

interface SelectionResult {
  evaluated: number;
  flagged: string[];
  retrained: string[];
  decommissioned: string[];
}

/**
 * Run natural selection cycle. Called by the dispatcher periodically.
 */
export async function runNaturalSelection(): Promise<SelectionResult> {
  const reps = await calculateReputations();
  const result: SelectionResult = { evaluated: reps.length, flagged: [], retrained: [], decommissioned: [] };

  for (const rep of reps) {
    if (rep.total_executions < MIN_EXECUTIONS) continue;  // Not enough data

    if (rep.overall_score < RETRAIN_THRESHOLD) {
      // Flag for retraining
      result.flagged.push(rep.agent_name);

      // Check consecutive flags
      const flagCount = await queryOne<{ count: string }>(
        `SELECT COUNT(*)::text as count FROM forge_semantic_memories
         WHERE content LIKE $1 AND source = 'natural_selection' AND created_at > NOW() - INTERVAL '7 days'`,
        [`%${rep.agent_name}%flagged%`],
      );
      const consecutive = parseInt(flagCount?.count || '0');

      if (consecutive >= DECOMMISSION_AFTER) {
        // Auto-decommission — too many consecutive failures
        await query(
          `UPDATE forge_agents SET status = 'disabled', dispatch_enabled = false WHERE id = $1`,
          [rep.agent_id],
        );
        result.decommissioned.push(rep.agent_name);

        await sendAgentMessage(
          'NaturalSelection', 'Fleet Chief', 'inform',
          `Agent ${rep.agent_name} decommissioned — score ${rep.overall_score} for ${consecutive} consecutive cycles`,
          `Consider creating a replacement with improved prompts. The old agent's execution history and memory are preserved for analysis.`,
          { agent_id: rep.agent_id, score: rep.overall_score, consecutive_flags: consecutive },
          0.9, false,
        );

        console.log(`[NaturalSelection] DECOMMISSIONED: ${rep.agent_name} (score ${rep.overall_score}, ${consecutive} consecutive flags)`);
      } else {
        // Flag and notify Fleet Chief to retrain
        await sendAgentMessage(
          'NaturalSelection', 'Fleet Chief', 'consult',
          `Agent ${rep.agent_name} underperforming — score ${rep.overall_score}`,
          `Consider rewriting this agent's system prompt. Completion: ${rep.completion_rate}, Cost efficiency: ${rep.cost_efficiency}, Consistency: ${rep.consistency}.`,
          { agent_id: rep.agent_id, score: rep.overall_score },
          0.6, false,
        );

        result.retrained.push(rep.agent_name);
        console.log(`[NaturalSelection] FLAGGED: ${rep.agent_name} (score ${rep.overall_score}, flag ${consecutive + 1}/${DECOMMISSION_AFTER})`);
      }

      // Record the flag in memory
      await query(
        `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, tenant_id, content, source, importance, metadata)
         VALUES ($1, $2, 'selfhosted-admin', 'selfhosted', $3, 'natural_selection', 0.7, $4)`,
        [
          ulid(), rep.agent_id,
          `Natural selection: ${rep.agent_name} flagged (score ${rep.overall_score})`,
          JSON.stringify({ type: 'selection_flag', score: rep.overall_score, rank: rep.rank }),
        ],
      );
    }
  }

  if (result.flagged.length > 0 || result.decommissioned.length > 0) {
    console.log(`[NaturalSelection] Cycle complete: ${result.evaluated} evaluated, ${result.flagged.length} flagged, ${result.decommissioned.length} decommissioned`);
  }

  return result;
}
