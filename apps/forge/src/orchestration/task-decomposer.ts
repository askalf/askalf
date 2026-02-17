/**
 * LLM-Powered Task Decomposer
 * Breaks complex tasks into subtasks with DAG dependencies.
 * Uses Claude CLI to analyze tasks and produce structured work breakdowns.
 */

import type { CoordinationPlan } from '../runtime/fleet-coordinator.js';

export interface DecomposedTask {
  title: string;
  description: string;
  suggestedAgentType: string;
  dependencies: string[]; // Task titles that must complete first
  estimatedComplexity: 'low' | 'medium' | 'high';
}

export interface DecompositionResult {
  tasks: DecomposedTask[];
  pattern: CoordinationPlan['pattern'];
  reasoning: string;
}

/**
 * Decompose a complex task into subtasks using LLM analysis.
 * Returns structured subtasks with dependencies and suggested agent types.
 */
export async function decomposeTask(
  taskDescription: string,
  availableAgents: Array<{ name: string; type: string; description: string }>,
): Promise<DecompositionResult> {
  // Dynamic import to avoid circular dependency
  const { runCliQuery } = await import('../runtime/worker.js');

  const agentList = availableAgents
    .map((a) => `- ${a.name} (${a.type}): ${a.description}`)
    .join('\n');

  const prompt = `You are a task decomposition engine for an AI agent orchestration system.

## Available Agents
${agentList}

## Task
${taskDescription}

## Instructions
Analyze this task and break it into 2-6 subtasks that can be assigned to the available agents.
For each subtask, specify:
- title: short name
- description: what the agent should do
- suggestedAgentType: which type of agent is best (dev, research, support, content, monitor, custom)
- dependencies: list of task titles that must complete before this one starts
- estimatedComplexity: low, medium, or high

Also determine the best coordination pattern:
- "pipeline": tasks flow sequentially (A → B → C)
- "fan-out": tasks run in parallel then merge
- "consensus": multiple agents work on same problem, results are synthesized

Return ONLY valid JSON matching this schema:
{
  "tasks": [{ "title": "", "description": "", "suggestedAgentType": "", "dependencies": [], "estimatedComplexity": "" }],
  "pattern": "pipeline|fan-out|consensus",
  "reasoning": "brief explanation of why this decomposition was chosen"
}`;

  const result = await runCliQuery(prompt, {
    model: 'haiku',
    maxTurns: 1,
    timeout: 45000,
  });

  // Parse the JSON from the response
  const match = result.output.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('Task decomposition failed: no JSON in response');
  }

  const parsed = JSON.parse(match[0]) as DecompositionResult;

  // Validate
  if (!parsed.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error('Task decomposition returned no subtasks');
  }

  // Normalize pattern
  if (!['pipeline', 'fan-out', 'consensus'].includes(parsed.pattern)) {
    parsed.pattern = 'pipeline';
  }

  console.log(
    `[Decomposer] Task decomposed into ${parsed.tasks.length} subtasks (${parsed.pattern}): ` +
    parsed.tasks.map((t) => t.title).join(', '),
  );

  return parsed;
}

/**
 * Check if a task is complex enough to warrant decomposition.
 * Simple heuristics: length, keyword indicators, multiple objectives.
 */
export function shouldDecompose(taskDescription: string): boolean {
  const length = taskDescription.length;
  if (length < 100) return false;
  if (length > 500) return true;

  const complexityIndicators = [
    /\band\b.*\band\b/i, // Multiple "and"s
    /\bthen\b/i, // Sequential steps
    /\bfirst\b.*\bthen\b/i, // Ordered steps
    /\bmultiple\b/i,
    /\bseveral\b/i,
    /\ball\b.*\b(files|services|endpoints|components)\b/i,
    /\brefactor\b/i,
    /\bmigrat/i,
    /\bimplement.*system\b/i,
    /\bbuild.*and.*deploy\b/i,
  ];

  const matches = complexityIndicators.filter((re) => re.test(taskDescription)).length;
  return matches >= 2;
}
