/**
 * Built-in Tool: Team Coordinate
 * Allows an agent to create and start a multi-agent team coordination plan.
 * Supports pipeline (sequential), fan-out (parallel), and consensus patterns.
 */

import type { ToolResult } from '../registry.js';

export interface TeamCoordinateInput {
  title: string;
  pattern: 'pipeline' | 'fan-out' | 'consensus';
  tasks: Array<{
    title: string;
    description: string;
    agentName: string;
    dependencies?: string[];
  }>;
}

export interface TeamCoordinateDeps {
  startTeam: (
    leadAgentId: string,
    leadAgentName: string,
    title: string,
    pattern: 'pipeline' | 'fan-out' | 'consensus',
    tasks: Array<{ title: string; description: string; agentName: string; dependencies?: string[] }>,
  ) => Promise<{ id: string; planId: string; status: string }>;
  agentId: string;
  agentName: string;
}

export async function teamCoordinate(
  input: TeamCoordinateInput,
  deps: TeamCoordinateDeps,
): Promise<ToolResult> {
  const startTime = performance.now();

  if (!input.title?.trim()) {
    return { output: null, error: 'title is required', durationMs: Math.round(performance.now() - startTime) };
  }

  const validPatterns = ['pipeline', 'fan-out', 'consensus'];
  if (!validPatterns.includes(input.pattern)) {
    return { output: null, error: `pattern must be one of: ${validPatterns.join(', ')}`, durationMs: Math.round(performance.now() - startTime) };
  }

  if (!input.tasks?.length) {
    return { output: null, error: 'At least one task is required', durationMs: Math.round(performance.now() - startTime) };
  }

  try {
    const session = await deps.startTeam(
      deps.agentId,
      deps.agentName,
      input.title,
      input.pattern,
      input.tasks,
    );

    return {
      output: {
        sessionId: session.id,
        planId: session.planId,
        status: session.status,
        taskCount: input.tasks.length,
        pattern: input.pattern,
        message: `Team session started with ${input.tasks.length} tasks (${input.pattern} pattern)`,
      },
      durationMs: Math.round(performance.now() - startTime),
    };
  } catch (err) {
    return {
      output: null,
      error: `Team coordination failed: ${err instanceof Error ? err.message : String(err)}`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}
