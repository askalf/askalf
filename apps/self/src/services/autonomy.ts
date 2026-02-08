/**
 * Autonomy Decision Engine
 * Determines whether SELF should act or ask for approval
 */

import { shouldActAutonomously, ACTION_RISK_SCORES } from '@substrate/self-core';

export interface AutonomyDecision {
  shouldAct: boolean;
  reason: string;
  riskScore: number;
}

/**
 * Decide whether SELF should act autonomously or request approval
 */
export function decideAutonomy(
  autonomyLevel: number,
  actionName: string,
  estimatedCost: number,
  dailyBudgetUsd: number,
  dailySpentUsd: number,
): AutonomyDecision {
  const riskScore = ACTION_RISK_SCORES[actionName] ?? 5;

  // Budget gate: always ask if would exceed daily budget
  if (dailySpentUsd + estimatedCost > dailyBudgetUsd) {
    return {
      shouldAct: false,
      reason: `Action would exceed daily budget ($${dailySpentUsd.toFixed(2)} + $${estimatedCost.toFixed(2)} > $${dailyBudgetUsd.toFixed(2)})`,
      riskScore,
    };
  }

  const shouldAct = shouldActAutonomously(autonomyLevel, riskScore);

  return {
    shouldAct,
    reason: shouldAct
      ? `Autonomy level ${autonomyLevel} permits risk ${riskScore} actions`
      : `Risk score ${riskScore} exceeds threshold for autonomy level ${autonomyLevel}`,
    riskScore,
  };
}
