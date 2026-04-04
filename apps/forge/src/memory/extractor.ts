/**
 * Post-Execution Memory Extractor
 * Automatically creates episodic and semantic memories from completed executions.
 * Runs as fire-and-forget after every CLI execution.
 */

import { getMemoryManager } from './singleton.js';

export interface ExecutionData {
  executionId: string;
  agentId: string;
  ownerId: string;
  input: string;
  output: string;
  isError: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
  durationMs: number;
}

/**
 * Extract memories from a completed execution.
 * Always creates an episodic memory (SAO record).
 * For successful executions with substantial output, also extracts semantic facts.
 */
export async function extractMemories(data: ExecutionData): Promise<void> {
  const manager = getMemoryManager();

  // --- Episodic Memory (always) ---
  const situation = data.input.substring(0, 500);
  const action = `CLI execution: ${data.numTurns} turns, $${data.costUsd.toFixed(4)}, ${data.durationMs}ms`;
  const outcome = data.output.substring(0, 1000);
  const quality = data.isError ? 0.0 : 1.0;

  await manager.store(data.agentId, {
    type: 'episodic',
    ownerId: data.ownerId,
    situation,
    action,
    outcome,
    quality,
    executionId: data.executionId,
    metadata: {
      runtime: 'cli',
      cost: data.costUsd,
      durationMs: data.durationMs,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      numTurns: data.numTurns,
    },
  });

  console.log(`[Memory] Episodic memory stored for execution ${data.executionId}`);

  // --- Semantic Memory (only for successful executions with substantial output) ---
  if (!data.isError && data.output.length > 200) {
    await extractSemanticFacts(data).catch((err) => {
      console.warn('[Memory] Semantic extraction failed:', err instanceof Error ? err.message : err);
    });
  }
}

/**
 * Use a fast LLM call to extract key facts from execution output.
 * Each extracted fact is stored as a semantic memory with deduplication.
 */
async function extractSemanticFacts(data: ExecutionData): Promise<void> {
  const manager = getMemoryManager();

  const prompt = `You are a knowledge extraction assistant. Given the following task and its result, extract 0-3 key factual statements that would be valuable to remember for future similar tasks.

TASK: ${data.input.substring(0, 500)}

RESULT: ${data.output.substring(0, 2000)}

Return ONLY a JSON array of strings. Each string should be a concise, self-contained factual statement.
Return [] if nothing is worth remembering (e.g., trivial tasks, generic responses).

Examples of good facts:
- "The user's API uses JWT tokens with RS256 signing"
- "Database migrations are in /src/db/migrations/ using knex"
- "The project uses pnpm workspaces with apps/ and packages/ directories"

JSON array:`;

  let facts: string[] = [];
  try {
    // Dynamic import to avoid circular dependency (worker → extractor → worker)
    const { runCliQuery } = await import('../runtime/worker.js');
    const result = await runCliQuery(prompt, {
      model: 'haiku',
      maxTurns: 1,
      timeout: 30000,
    });

    // Parse the JSON array from the response
    const match = result.output.match(/\[[\s\S]*?\]/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed)) {
        facts = parsed.filter((f): f is string => typeof f === 'string' && f.length > 10);
      }
    }
  } catch (err) {
    console.warn('[Memory] Fact extraction LLM call failed:', err instanceof Error ? err.message : err);
    return;
  }

  if (facts.length === 0) return;

  // Deduplicate: check if similar facts already exist
  for (const fact of facts.slice(0, 3)) {
    try {
      const existing = await manager.semantic.search(
        data.agentId,
        await manager['embed'](fact),
        1,
        0.90,
      );

      if (existing.length > 0) {
        console.log(`[Memory] Skipping duplicate fact (${(existing[0]!.similarity * 100).toFixed(0)}% similar)`);
        continue;
      }

      await manager.store(data.agentId, {
        type: 'semantic',
        ownerId: data.ownerId,
        content: fact,
        options: {
          source: 'auto-extract',
          importance: 0.6,
          metadata: {
            executionId: data.executionId,
            extractedFrom: 'execution-output',
          },
        },
      });

      console.log(`[Memory] Semantic fact stored: "${fact.substring(0, 60)}..."`);
    } catch (err) {
      console.warn('[Memory] Failed to store fact:', err instanceof Error ? err.message : err);
    }
  }
}
