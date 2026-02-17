/**
 * Pre-Execution Memory Context Builder
 * Retrieves relevant memories and formats them for injection into agent CLAUDE.md.
 * Searches both agent-specific and fleet-wide memories.
 */

import { getMemoryManager } from './singleton.js';

export interface ContextOptions {
  /** Include fleet-wide memories from all agents. */
  fleetWide?: boolean;
  /** Max results per memory tier. */
  k?: number;
}

/**
 * Build a formatted memory context block for injection into CLAUDE.md.
 * Returns empty string if no relevant memories are found.
 */
export async function buildMemoryContext(
  agentId: string,
  input: string,
  options?: ContextOptions,
): Promise<string> {
  const manager = getMemoryManager();
  const k = options?.k ?? 5;

  // Agent-specific recall
  const agentRecall = await manager.recall(agentId, input, {
    k,
    tiers: ['semantic', 'episodic', 'procedural'],
  });

  const lines: string[] = [];

  // Format agent-specific results
  for (const s of agentRecall.semantic) {
    const sim = s.similarity ? ` (${(s.similarity * 100).toFixed(0)}%)` : '';
    lines.push(`- [semantic]${sim}: ${s.content}`);
  }
  for (const e of agentRecall.episodic) {
    const qualLabel = e.outcome_quality >= 0.7 ? 'success' : 'failure';
    lines.push(`- [episodic][${qualLabel}]: ${e.situation.substring(0, 100)} → ${e.outcome.substring(0, 150)}`);
  }
  for (const p of agentRecall.procedural) {
    lines.push(`- [procedural] (confidence: ${(p.confidence * 100).toFixed(0)}%): ${p.trigger_pattern}`);
  }

  // Fleet-wide recall (cross-agent knowledge sharing)
  if (options?.fleetWide) {
    const fleetRecall = await manager.recallFleet(input, { k: 3 });

    // Only include fleet results not already in agent results
    const agentSemanticIds = new Set(agentRecall.semantic.map((s) => s.id));
    const agentEpisodicIds = new Set(agentRecall.episodic.map((e) => e.id));

    for (const s of fleetRecall.semantic) {
      if (!agentSemanticIds.has(s.id)) {
        const sim = s.similarity ? ` (${(s.similarity * 100).toFixed(0)}%)` : '';
        lines.push(`- [fleet-semantic]${sim}: ${s.content}`);
      }
    }
    for (const e of fleetRecall.episodic) {
      if (!agentEpisodicIds.has(e.id)) {
        const qualLabel = e.outcome_quality >= 0.7 ? 'success' : 'failure';
        lines.push(`- [fleet-episodic][${qualLabel}]: ${e.situation.substring(0, 100)} → ${e.outcome.substring(0, 150)}`);
      }
    }
  }

  if (lines.length === 0) return '';

  return [
    '',
    '## [FLEET MEMORY — Relevant Knowledge]',
    'The following memories were recalled from past experiences. Use them to inform your approach:',
    '',
    ...lines,
    '',
  ].join('\n');
}
