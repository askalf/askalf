/**
 * Built-in Tool: Evolution Test (Level 9 — Vibe Evolution)
 * A/B testing engine for agents: clone variants with mutations,
 * run head-to-head tests, review results, promote winners.
 */

import { query } from '../../database.js';
import { cloneAgent, runExperiment, getExperiments, promoteVariant } from '../../orchestration/evolution.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface EvolutionTestInput {
  action: 'clone' | 'run_test' | 'results' | 'promote';
  // For clone:
  mutation_type?: 'prompt' | 'tools' | 'model' | 'config' | 'combined';
  mutation_description?: string;
  prompt_override?: string;
  model_override?: string;
  // For run_test:
  variant_id?: string;
  test_task?: string;
  // For promote:
  experiment_id?: string;
  // Context:
  agent_id?: string;
}

const MAX_VARIANTS_PER_AGENT = 3;
const MAX_CONCURRENT_EXPERIMENTS = 2;

// ============================================
// Implementation
// ============================================

export async function evolutionTest(input: EvolutionTestInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'clone':
        return await handleClone(input, startTime);
      case 'run_test':
        return await handleRunTest(input, startTime);
      case 'results':
        return await handleResults(input, startTime);
      case 'promote':
        return await handlePromote(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: clone, run_test, results, promote`,
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
// Clone Action
// ============================================

async function handleClone(input: EvolutionTestInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (agentId === 'unknown') {
    return { output: null, error: 'Could not determine agent ID', durationMs: Math.round(performance.now() - startTime) };
  }
  if (!input.mutation_description) {
    return { output: null, error: 'mutation_description is required for clone', durationMs: 0 };
  }

  // Guard: limit active variants per agent
  const existingVariants = await query<{ id: string; name: string }>(
    `SELECT id, name FROM forge_agents
     WHERE metadata->>'parent_agent_id' = $1
       AND (is_decommissioned IS NULL OR is_decommissioned = false)
       AND status != 'archived'`,
    [agentId],
  );

  if (existingVariants.length >= MAX_VARIANTS_PER_AGENT) {
    return {
      output: null,
      error: `Maximum ${MAX_VARIANTS_PER_AGENT} active variants reached. Decommission or promote existing variants first.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const variantId = await cloneAgent(agentId, {
    type: input.mutation_type ?? 'combined',
    description: input.mutation_description,
    promptOverride: input.prompt_override,
    modelOverride: input.model_override,
  });

  return {
    output: {
      cloned: true,
      variant_id: variantId,
      parent_id: agentId,
      mutation_type: input.mutation_type ?? 'combined',
      mutation_description: input.mutation_description,
      active_variants: existingVariants.length + 1,
      message: `Variant created. Use run_test with variant_id="${variantId}" to start an A/B test.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Run Test Action
// ============================================

async function handleRunTest(input: EvolutionTestInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (!input.variant_id) {
    return { output: null, error: 'variant_id is required for run_test', durationMs: 0 };
  }
  if (!input.test_task) {
    return { output: null, error: 'test_task is required for run_test', durationMs: 0 };
  }

  // Guard: limit concurrent experiments
  const running = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM forge_evolution_experiments
     WHERE (parent_agent_id = $1 OR variant_agent_id = $1)
       AND status = 'running'`,
    [agentId],
  );
  if (parseInt(running[0]?.count ?? '0', 10) >= MAX_CONCURRENT_EXPERIMENTS) {
    return {
      output: null,
      error: `Maximum ${MAX_CONCURRENT_EXPERIMENTS} concurrent experiments reached. Wait for running experiments to complete.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Get mutation description from variant metadata
  const variant = await query<{ metadata: Record<string, unknown> }>(
    `SELECT metadata FROM forge_agents WHERE id = $1`,
    [input.variant_id],
  );
  const mutationDesc = (variant[0]?.metadata?.['mutation_description'] as string) ?? 'unknown mutation';
  const mutationType = (variant[0]?.metadata?.['mutation_type'] as string) ?? 'combined';

  const experiment = await runExperiment(
    agentId,
    input.variant_id,
    input.test_task,
    mutationDesc,
    mutationType,
  );

  return {
    output: {
      experiment_id: experiment.id,
      parent_id: agentId,
      variant_id: input.variant_id,
      test_task: input.test_task,
      status: experiment.status,
      message: 'Experiment started. Both agents are running the test task. Use results action to check when complete.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Results Action
// ============================================

async function handleResults(input: EvolutionTestInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  const experiments = await getExperiments(agentId);

  return {
    output: {
      agent_id: agentId,
      experiments: experiments.map((e) => ({
        id: e.id,
        mutation_type: e.mutation_type,
        mutation_description: e.mutation_description,
        test_task: e.test_task,
        parent_score: e.parent_score,
        variant_score: e.variant_score,
        winner: e.winner,
        status: e.status,
      })),
      total: experiments.length,
      completed: experiments.filter((e) => e.status === 'completed').length,
      running: experiments.filter((e) => e.status === 'running').length,
      promotable: experiments.filter((e) => e.status === 'completed' && e.winner === 'variant').length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Promote Action
// ============================================

async function handlePromote(input: EvolutionTestInput, startTime: number): Promise<ToolResult> {
  if (!input.experiment_id) {
    return { output: null, error: 'experiment_id is required for promote', durationMs: 0 };
  }

  // Verify experiment is completed with variant as winner
  const exp = await query<{ status: string; winner: string; parent_agent_id: string; variant_agent_id: string }>(
    `SELECT status, winner, parent_agent_id, variant_agent_id
     FROM forge_evolution_experiments WHERE id = $1`,
    [input.experiment_id],
  );
  if (exp.length === 0) {
    return { output: null, error: `Experiment not found: ${input.experiment_id}`, durationMs: Math.round(performance.now() - startTime) };
  }
  if (exp[0]!.status !== 'completed') {
    return { output: null, error: `Experiment status is '${exp[0]!.status}', must be 'completed' to promote`, durationMs: Math.round(performance.now() - startTime) };
  }
  if (exp[0]!.winner !== 'variant') {
    return { output: null, error: `Winner is '${exp[0]!.winner}', only 'variant' can be promoted`, durationMs: Math.round(performance.now() - startTime) };
  }

  const promoted = await promoteVariant(input.experiment_id);

  return {
    output: {
      promoted,
      experiment_id: input.experiment_id,
      parent_id: exp[0]!.parent_agent_id,
      variant_id: exp[0]!.variant_agent_id,
      message: promoted
        ? 'Variant promoted! Parent agent now uses the variant\'s configuration. Variant has been decommissioned.'
        : 'Promotion failed. Variant may have already been decommissioned.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
