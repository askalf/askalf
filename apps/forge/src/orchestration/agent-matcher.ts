/**
 * Intelligent Agent Matcher
 * Scores and selects the best agent for each subtask based on:
 * - Agent type alignment (dev, research, etc.)
 * - System prompt relevance
 * - Past execution history (episodic memory)
 * - Current availability (idle > running)
 */

import { query } from '../database.js';
import type { DecomposedTask } from './task-decomposer.js';

interface AgentCandidate {
  id: string;
  name: string;
  type: string;
  description: string;
  system_prompt: string;
  status: string;
  autonomy_level: number;
  tasks_completed: number;
  tasks_failed: number;
}

interface ScoredAgent {
  agent: AgentCandidate;
  score: number;
  reasons: string[];
}

export interface MatchResult {
  taskTitle: string;
  agentId: string;
  agentName: string;
  score: number;
  reasons: string[];
}

/**
 * Match each decomposed task to the best available agent.
 * Returns one match per task.
 */
export async function matchAgentsToTasks(
  tasks: DecomposedTask[],
): Promise<MatchResult[]> {
  // Fetch all active agents
  const agents = await query<AgentCandidate>(
    `SELECT id, name, type, description, system_prompt, status,
            autonomy_level, tasks_completed, tasks_failed
     FROM forge_agents
     WHERE status != 'error'
       AND (is_decommissioned IS NULL OR is_decommissioned = false)
     ORDER BY tasks_completed DESC`,
  );

  if (agents.length === 0) {
    throw new Error('No active agents available for task assignment');
  }

  const results: MatchResult[] = [];
  const assignedAgentIds = new Set<string>();

  for (const task of tasks) {
    const scored = scoreAgents(task, agents, assignedAgentIds);

    if (scored.length === 0) {
      // Fallback: pick first available agent
      const fallback = agents[0]!;
      results.push({
        taskTitle: task.title,
        agentId: fallback.id,
        agentName: fallback.name,
        score: 0,
        reasons: ['fallback: no ideal match'],
      });
      continue;
    }

    const best = scored[0]!;
    assignedAgentIds.add(best.agent.id);

    results.push({
      taskTitle: task.title,
      agentId: best.agent.id,
      agentName: best.agent.name,
      score: best.score,
      reasons: best.reasons,
    });
  }

  console.log(
    `[Matcher] Assigned ${results.length} tasks: ` +
    results.map((r) => `${r.taskTitle} → ${r.agentName} (${r.score.toFixed(1)})`).join(', '),
  );

  return results;
}

/**
 * Score all agents for a specific task. Higher score = better match.
 */
function scoreAgents(
  task: DecomposedTask,
  agents: AgentCandidate[],
  alreadyAssigned: Set<string>,
): ScoredAgent[] {
  const scored: ScoredAgent[] = [];

  for (const agent of agents) {
    let score = 0;
    const reasons: string[] = [];

    // 1. Type alignment (0-30 points)
    if (agent.type === task.suggestedAgentType) {
      score += 30;
      reasons.push(`type match: ${agent.type}`);
    } else if (isTypeCompatible(agent.type, task.suggestedAgentType)) {
      score += 15;
      reasons.push(`compatible type: ${agent.type}≈${task.suggestedAgentType}`);
    }

    // 2. Description/prompt keyword overlap (0-25 points)
    const keywordScore = computeKeywordOverlap(
      task.description + ' ' + task.title,
      agent.description + ' ' + agent.system_prompt,
    );
    score += keywordScore * 25;
    if (keywordScore > 0.3) {
      reasons.push(`keyword match: ${(keywordScore * 100).toFixed(0)}%`);
    }

    // 3. Success rate (0-20 points)
    const total = agent.tasks_completed + agent.tasks_failed;
    if (total > 0) {
      const successRate = agent.tasks_completed / total;
      score += successRate * 20;
      if (successRate > 0.8) {
        reasons.push(`high success: ${(successRate * 100).toFixed(0)}%`);
      }
    } else {
      score += 10; // New agents get benefit of the doubt
      reasons.push('new agent');
    }

    // 4. Availability (0-15 points)
    if (agent.status === 'idle') {
      score += 15;
      reasons.push('idle');
    } else if (agent.status === 'paused') {
      score += 5;
    }
    // Running agents get 0

    // 5. Autonomy level alignment (0-10 points)
    if (task.estimatedComplexity === 'high' && agent.autonomy_level >= 7) {
      score += 10;
      reasons.push('high autonomy for complex task');
    } else if (task.estimatedComplexity === 'low' && agent.autonomy_level <= 5) {
      score += 10;
    } else {
      score += 5;
    }

    // 6. Prefer unassigned agents (-10 penalty if already assigned in this plan)
    if (alreadyAssigned.has(agent.id)) {
      score -= 10;
      reasons.push('already assigned');
    }

    scored.push({ agent, score, reasons });
  }

  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Check if two agent types are compatible (close enough to work).
 */
function isTypeCompatible(agentType: string, suggestedType: string): boolean {
  const compatMap: Record<string, string[]> = {
    dev: ['custom', 'research'],
    research: ['custom', 'dev', 'content'],
    support: ['custom', 'content'],
    content: ['custom', 'research', 'support'],
    monitor: ['custom', 'dev'],
    custom: ['dev', 'research', 'support', 'content', 'monitor'],
  };
  return compatMap[agentType]?.includes(suggestedType) ?? false;
}

/**
 * Simple keyword overlap score between two texts.
 * Returns 0-1 based on shared significant words.
 */
function computeKeywordOverlap(textA: string, textB: string): number {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
    'not', 'no', 'if', 'then', 'else', 'when', 'up', 'out', 'this', 'that',
    'it', 'its', 'all', 'each', 'every', 'both', 'few', 'more', 'most',
    'other', 'some', 'such', 'than', 'too', 'very',
  ]);

  const extractWords = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stopWords.has(w)),
    );

  const wordsA = extractWords(textA);
  const wordsB = extractWords(textB);

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let overlap = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) overlap++;
  }

  return overlap / Math.max(wordsA.size, wordsB.size);
}
