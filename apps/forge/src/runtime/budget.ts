/**
 * Runtime Budget Module
 *
 * Calculates and enforces time-based execution budgets to prevent
 * agents from exceeding their schedule intervals. An agent scheduled
 * every 45 minutes should not run for 15 minutes — it wastes resources
 * and risks overlapping with its next invocation.
 *
 * Strategy: max_execution_duration = schedule_interval * budget_percent
 * Default budget_percent = 60% (e.g., 45min schedule → 27min max)
 */

// ============================================
// Types
// ============================================

export interface RuntimeBudget {
  /** Maximum allowed execution duration in milliseconds. */
  maxDurationMs: number;
  /** The agent's schedule interval in milliseconds (0 if unknown). */
  scheduleIntervalMs: number;
  /** Fraction of schedule used as budget (0-1). */
  budgetPercent: number;
}

export interface RuntimeBudgetCheck {
  /** Whether the execution may continue. */
  allowed: boolean;
  /** Time elapsed since execution start in milliseconds. */
  elapsedMs: number;
  /** Maximum allowed duration in milliseconds. */
  maxDurationMs: number;
  /** Time remaining before budget is exhausted. */
  remainingMs: number;
  /** Percentage of budget consumed (0-100). */
  usagePercent: number;
  /** True when usage exceeds the warning threshold (default 80%). */
  warning: boolean;
}

// ============================================
// Budget Calculation
// ============================================

/**
 * Calculate the runtime budget for an agent based on its schedule interval.
 *
 * @param scheduleIntervalMinutes - Agent's schedule frequency in minutes (null if unknown)
 * @param fallbackTimeoutMs - Default timeout when schedule is unknown
 * @param budgetPercent - Fraction of schedule interval to use (default 0.6 = 60%)
 */
export function calculateRuntimeBudget(
  scheduleIntervalMinutes: number | null | undefined,
  fallbackTimeoutMs: number,
  budgetPercent = 0.6,
): RuntimeBudget {
  if (scheduleIntervalMinutes && scheduleIntervalMinutes > 0) {
    const intervalMs = scheduleIntervalMinutes * 60 * 1000;
    return {
      maxDurationMs: Math.floor(intervalMs * budgetPercent),
      scheduleIntervalMs: intervalMs,
      budgetPercent,
    };
  }

  return {
    maxDurationMs: fallbackTimeoutMs,
    scheduleIntervalMs: 0,
    budgetPercent: 1.0,
  };
}

/**
 * Check whether the current execution is within its runtime budget.
 *
 * @param startTimeMs - Timestamp (Date.now()) when execution started
 * @param maxDurationMs - Maximum allowed duration in milliseconds
 * @param warningThreshold - Fraction at which to flag a warning (default 0.8 = 80%)
 */
export function checkRuntimeBudget(
  startTimeMs: number,
  maxDurationMs: number,
  warningThreshold = 0.8,
): RuntimeBudgetCheck {
  const elapsedMs = Date.now() - startTimeMs;
  const remainingMs = Math.max(0, maxDurationMs - elapsedMs);
  const usagePercent = maxDurationMs > 0 ? (elapsedMs / maxDurationMs) * 100 : 0;

  return {
    allowed: elapsedMs < maxDurationMs,
    elapsedMs,
    maxDurationMs,
    remainingMs,
    usagePercent,
    warning: usagePercent >= warningThreshold * 100,
  };
}

// ============================================
// Task Complexity Estimation
// ============================================

/** Complexity tiers that map to iteration / budget adjustments. */
export type TaskComplexity = 'light' | 'moderate' | 'heavy';

/**
 * Estimate task complexity from prompt characteristics.
 * Used to adjust --max-turns dynamically.
 *
 * Heuristics:
 *  - Prompt length (longer prompts tend to contain more sub-tasks)
 *  - Presence of keywords that signal multi-step work
 */
export function estimateTaskComplexity(prompt: string): TaskComplexity {
  const length = prompt.length;

  // Keywords that signal heavy work
  const heavyPatterns = /\b(implement|refactor|build|create|architect|design|migrate|deploy|pipeline)\b/i;
  const multiTaskPatterns = /\b(and then|after that|next|also|additionally|step \d|phase \d)\b/i;
  const listPattern = /(?:^|\n)\s*(?:\d+[.):]|\*|-)\s+/gm;
  const listItems = prompt.match(listPattern);

  const hasHeavyWork = heavyPatterns.test(prompt);
  const hasMultiTask = multiTaskPatterns.test(prompt);
  const taskCount = listItems ? listItems.length : 0;

  if ((hasHeavyWork && hasMultiTask) || taskCount >= 4 || length > 3000) {
    return 'heavy';
  }
  if (hasHeavyWork || taskCount >= 2 || length > 1500) {
    return 'moderate';
  }
  return 'light';
}

/**
 * Suggest max turns based on task complexity and available budget.
 * Scales down turns when runtime budget is tight.
 */
export function suggestMaxTurns(
  agentMaxIterations: number,
  complexity: TaskComplexity,
  runtimeBudgetMs: number,
): number {
  // Base scaling by complexity
  const complexityMultiplier: Record<TaskComplexity, number> = {
    light: 0.5,
    moderate: 0.75,
    heavy: 1.0,
  };

  let suggested = Math.ceil(agentMaxIterations * complexityMultiplier[complexity]);

  // If runtime budget is under 10 minutes, further scale down
  const budgetMinutes = runtimeBudgetMs / 60_000;
  if (budgetMinutes < 5) {
    suggested = Math.min(suggested, 10);
  } else if (budgetMinutes < 10) {
    suggested = Math.min(suggested, Math.ceil(agentMaxIterations * 0.6));
  }

  // Always allow at least 5 turns
  return Math.max(5, suggested);
}

/**
 * Format a runtime budget summary for injection into agent prompts.
 * Helps agents self-regulate by knowing their time constraints.
 */
export function formatBudgetPromptHint(
  budget: RuntimeBudget,
  agentName: string,
): string {
  const maxMinutes = Math.round(budget.maxDurationMs / 60_000);
  if (budget.scheduleIntervalMs <= 0) {
    return `\nRUNTIME BUDGET: You have approximately ${maxMinutes} minutes for this execution. Prioritize the most impactful work first.\n`;
  }

  const intervalMinutes = Math.round(budget.scheduleIntervalMs / 60_000);
  return (
    `\nRUNTIME BUDGET: You are ${agentName}, scheduled every ${intervalMinutes} minutes. ` +
    `You have ~${maxMinutes} minutes (${Math.round(budget.budgetPercent * 100)}% of interval) for this execution. ` +
    `Prioritize the most impactful work first. If the task is too large, focus on the highest-priority item and leave notes for your next cycle.\n`
  );
}
