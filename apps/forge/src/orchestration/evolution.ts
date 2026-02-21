/**
 * Agent Cloning & Evolution (Phase 13)
 * Clone agents with mutations, run A/B tests, promote winners.
 */

import { query } from '../database.js';
import { ulid } from 'ulid';
import { runDirectCliExecution } from '../runtime/worker.js';

export interface EvolutionExperiment {
  id: string;
  parent_agent_id: string;
  variant_agent_id: string;
  mutation_type: string;
  mutation_description: string;
  test_task: string;
  parent_score: number | null;
  variant_score: number | null;
  winner: string | null;
  status: string;
  results: Record<string, unknown>;
}

/**
 * Clone an agent with a specified mutation.
 */
export async function cloneAgent(
  parentId: string,
  mutation: {
    type: 'prompt' | 'tools' | 'model' | 'config' | 'combined';
    description: string;
    promptOverride?: string;
    modelOverride?: string;
    toolsOverride?: string[];
  },
): Promise<string> {
  const parent = await query<{
    name: string; description: string; system_prompt: string;
    model_id: string; tools: string[]; metadata: Record<string, unknown>;
    owner_id: string; type: string;
  }>(
    `SELECT name, description, system_prompt,
            COALESCE(metadata->>'model_id', 'claude-sonnet-4-6') AS model_id,
            enabled_tools AS tools, metadata, owner_id, type
     FROM forge_agents WHERE id = $1`,
    [parentId],
  );

  if (parent.length === 0) throw new Error('Parent agent not found');
  const p = parent[0]!;

  const variantId = ulid();
  const variantName = `${p.name}-v${Date.now().toString(36).slice(-4)}`;

  // Apply mutation
  const systemPrompt = mutation.promptOverride ?? p.system_prompt;
  const modelId = mutation.modelOverride ?? p.model_id;
  const metadata = {
    ...p.metadata,
    parent_agent_id: parentId,
    mutation_type: mutation.type,
    mutation_description: mutation.description,
    ...(mutation.modelOverride ? { model_id: mutation.modelOverride } : {}),
  };

  await query(
    `INSERT INTO forge_agents
     (id, name, description, system_prompt, owner_id, type, status, metadata, enabled_tools)
     VALUES ($1, $2, $3, $4, $5, $6, 'idle', $7, $8)`,
    [
      variantId,
      variantName,
      `Variant of ${p.name}: ${mutation.description}`,
      systemPrompt,
      p.owner_id,
      p.type || 'custom',
      JSON.stringify(metadata),
      mutation.toolsOverride ?? p.tools ?? [],
    ],
  );

  console.log(`[Evolution] Cloned ${p.name} → ${variantName} (${mutation.type}: ${mutation.description})`);
  return variantId;
}

/**
 * Run an A/B test between parent and variant on a specific task.
 */
export async function runExperiment(
  parentId: string,
  variantId: string,
  testTask: string,
  mutationDescription: string,
  mutationType: string = 'combined',
): Promise<EvolutionExperiment> {
  const experimentId = ulid();

  await query(
    `INSERT INTO forge_evolution_experiments
     (id, parent_agent_id, variant_agent_id, mutation_type, mutation_description, test_task, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'running')`,
    [experimentId, parentId, variantId, mutationType, mutationDescription, testTask],
  );

  const ownerId = 'system:evolution';

  // Run both agents on the same task
  const parentExecId = ulid();
  const variantExecId = ulid();

  // Create execution records
  await Promise.all([
    query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
      [parentExecId, parentId, ownerId, testTask, JSON.stringify({ experimentId, role: 'parent' })],
    ),
    query(
      `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, metadata, started_at)
       VALUES ($1, $2, $3, $4, 'pending', $5, NOW())`,
      [variantExecId, variantId, ownerId, testTask, JSON.stringify({ experimentId, role: 'variant' })],
    ),
  ]);

  // Get agent configs
  const [parentAgent, variantAgent] = await Promise.all([
    query<{ system_prompt: string; model_id: string }>(
      `SELECT system_prompt, COALESCE(metadata->>'model_id', 'claude-sonnet-4-6') AS model_id
       FROM forge_agents WHERE id = $1`, [parentId]),
    query<{ system_prompt: string; model_id: string }>(
      `SELECT system_prompt, COALESCE(metadata->>'model_id', 'claude-sonnet-4-6') AS model_id
       FROM forge_agents WHERE id = $1`, [variantId]),
  ]);

  // Run executions (fire-and-forget, scoring happens when both complete)
  void Promise.all([
    runDirectCliExecution(parentExecId, parentId, testTask, ownerId, {
      systemPrompt: parentAgent[0]?.system_prompt,
      modelId: parentAgent[0]?.model_id,
    }),
    runDirectCliExecution(variantExecId, variantId, testTask, ownerId, {
      systemPrompt: variantAgent[0]?.system_prompt,
      modelId: variantAgent[0]?.model_id,
    }),
  ]).then(async () => {
    // Both done — score them
    await scoreExperiment(experimentId, parentExecId, variantExecId);
  }).catch(async (err) => {
    console.error(`[Evolution] Experiment ${experimentId} failed:`, err);
    await query(
      `UPDATE forge_evolution_experiments SET status = 'failed', completed_at = NOW() WHERE id = $1`,
      [experimentId],
    );
  });

  return {
    id: experimentId,
    parent_agent_id: parentId,
    variant_agent_id: variantId,
    mutation_type: mutationType,
    mutation_description: mutationDescription,
    test_task: testTask,
    parent_score: null,
    variant_score: null,
    winner: 'pending',
    status: 'running',
    results: { parentExecId, variantExecId },
  };
}

/**
 * Score a completed experiment based on execution results.
 */
async function scoreExperiment(
  experimentId: string,
  parentExecId: string,
  variantExecId: string,
): Promise<void> {
  const [parentExec, variantExec] = await Promise.all([
    query<{ status: string; cost: number; duration_ms: number; output: string }>(
      `SELECT status, cost, duration_ms, output FROM forge_executions WHERE id = $1`, [parentExecId]),
    query<{ status: string; cost: number; duration_ms: number; output: string }>(
      `SELECT status, cost, duration_ms, output FROM forge_executions WHERE id = $1`, [variantExecId]),
  ]);

  const p = parentExec[0];
  const v = variantExec[0];
  if (!p || !v) return;

  // Simple scoring: success=50, cost efficiency=25, speed=25
  const scoreAgent = (exec: typeof p) => {
    let score = 0;
    if (exec.status === 'completed') score += 50;
    // Lower cost is better (max 25 pts at $0, 0 pts at $1+)
    score += Math.max(0, 25 - (parseFloat(String(exec.cost)) || 0) * 25);
    // Faster is better (max 25 pts at 0s, 0 pts at 300s+)
    score += Math.max(0, 25 - ((exec.duration_ms || 0) / 300000) * 25);
    return Math.round(score * 100) / 100;
  };

  const parentScore = scoreAgent(p);
  const variantScore = scoreAgent(v);
  const winner = variantScore > parentScore + 2 ? 'variant' : parentScore > variantScore + 2 ? 'parent' : 'tie';

  await query(
    `UPDATE forge_evolution_experiments
     SET parent_score = $1, variant_score = $2, winner = $3,
         status = 'completed', completed_at = NOW(),
         results = $4
     WHERE id = $5`,
    [
      parentScore, variantScore, winner,
      JSON.stringify({
        parent: { status: p.status, cost: p.cost, durationMs: p.duration_ms },
        variant: { status: v.status, cost: v.cost, durationMs: v.duration_ms },
      }),
      experimentId,
    ],
  );

  console.log(`[Evolution] Experiment ${experimentId}: parent=${parentScore}, variant=${variantScore}, winner=${winner}`);
}

/**
 * Get experiments for an agent.
 */
export async function getExperiments(agentId: string): Promise<EvolutionExperiment[]> {
  return query<EvolutionExperiment>(
    `SELECT * FROM forge_evolution_experiments
     WHERE parent_agent_id = $1 OR variant_agent_id = $1
     ORDER BY created_at DESC LIMIT 20`,
    [agentId],
  );
}

/**
 * Promote a variant: copy its config to the parent and decommission the variant.
 */
export async function promoteVariant(experimentId: string): Promise<boolean> {
  const exp = await query<{ parent_agent_id: string; variant_agent_id: string; winner: string }>(
    `SELECT parent_agent_id, variant_agent_id, winner FROM forge_evolution_experiments WHERE id = $1`,
    [experimentId],
  );
  if (exp.length === 0 || exp[0]!.winner !== 'variant') return false;

  const variant = await query<{ system_prompt: string; metadata: Record<string, unknown> }>(
    `SELECT system_prompt, metadata FROM forge_agents WHERE id = $1`,
    [exp[0]!.variant_agent_id],
  );
  if (variant.length === 0) return false;

  // Copy variant's prompt to parent
  await query(
    `UPDATE forge_agents SET system_prompt = $1, updated_at = NOW() WHERE id = $2`,
    [variant[0]!.system_prompt, exp[0]!.parent_agent_id],
  );

  // Decommission variant
  await query(
    `UPDATE forge_agents SET is_decommissioned = true, status = 'paused' WHERE id = $1`,
    [exp[0]!.variant_agent_id],
  );

  console.log(`[Evolution] Promoted variant for experiment ${experimentId}`);
  return true;
}
