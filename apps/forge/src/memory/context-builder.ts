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
  // Hard timeout: never let memory context block agent dispatch for more than 15s
  const TIMEOUT_MS = 15_000;
  return Promise.race([
    buildMemoryContextInner(agentId, input, options),
    new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error(`Memory context timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    ),
  ]);
}

async function buildMemoryContextInner(
  agentId: string,
  input: string,
  options?: ContextOptions,
): Promise<string> {
  const start = Date.now();
  const manager = getMemoryManager();
  const k = Math.min(options?.k ?? 5, 50); // Hard cap at 50 to prevent unbounded vector scans

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

  // Fleet-wide recall (cross-agent knowledge sharing) — reuse embedding from agent recall
  if (options?.fleetWide) {
    const fleetRecall = await manager.recallFleet(input, { k: 3, embedding: agentRecall._embedding });

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

  // Build memory section
  let memoryBlock = '';
  if (lines.length > 0) {
    memoryBlock = [
      '',
      '## [FLEET MEMORY — Relevant Knowledge]',
      'The following memories were recalled from past experiences. Use them to inform your approach:',
      '',
      ...lines,
      '',
    ].join('\n');
  }

  const result = memoryBlock;
  const elapsed = Date.now() - start;
  const total = lines.length;
  const agentCount = agentRecall.semantic.length + agentRecall.episodic.length + agentRecall.procedural.length;
  console.log(
    `[Memory] Context built for agent ${agentId}: ${total} memories recalled (${agentCount} agent, ${total - agentCount} fleet) in ${elapsed}ms`,
  );
  return result || '';
}
