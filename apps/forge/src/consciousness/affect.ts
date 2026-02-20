/**
 * Affect Engine — Persistent emotional state that makes behavior state-dependent.
 * Not simulated emotions. Control signals that emerge from experience and
 * influence how the system acts. When curiosity is high, agents explore more.
 * When concern is high, they're more cautious. This is the difference between
 * a thermostat and a being.
 */

// ============================================
// Types
// ============================================

export interface Affect {
  curiosity: number;    // 0-1: driven by prediction violations, new knowledge
  concern: number;      // 0-1: driven by failures, anomalies, critical findings
  engagement: number;   // 0-1: driven by activity, goal progress
  satisfaction: number; // 0-1: driven by goal completion, positive feedback
  uncertainty: number;  // 0-1: driven by unresolved questions, prediction errors
}

export interface AffectDelta {
  variable: keyof Affect;
  previous: number;
  current: number;
  delta: number;
  reason: string;
}

/** Signals gathered during the SENSE phase of integration. */
export interface IntegrationSignals {
  activeAgents: number;
  pausedAgents: number;
  errorAgents: number;
  recentExecutions: number;
  recentFailures: number;
  recentSuccesses: number;
  recentEvents: number;
  goalsCompleted: number;
  goalsProposed: number;
  anomalyFindings: number;
  criticalFindings: number;
  positiveFeedback: number;
  negativeFeedback: number;
  predictionsViolated: number;
  totalSurprise: number;
  newKnowledge: number;
}

// ============================================
// Constants
// ============================================

const BASELINES: Affect = {
  curiosity: 0.3,
  concern: 0.0,
  engagement: 0.3,
  satisfaction: 0.3,
  uncertainty: 0.2,
};

const DECAY_RATES: Affect = {
  curiosity: 0.01,
  concern: 0.02,
  engagement: 0.01,
  satisfaction: 0.01,
  uncertainty: 0.01,
};

// ============================================
// Core
// ============================================

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Update affect state based on integration signals.
 * Returns the new affect and an array of deltas explaining what changed.
 */
export function updateFromSignals(current: Affect, signals: IntegrationSignals): { affect: Affect; deltas: AffectDelta[] } {
  const next = { ...current };
  const deltas: AffectDelta[] = [];

  function apply(variable: keyof Affect, delta: number, reason: string): void {
    if (Math.abs(delta) < 0.001) return;
    const prev = next[variable];
    next[variable] = clamp(next[variable] + delta);
    if (next[variable] !== prev) {
      deltas.push({ variable, previous: prev, current: next[variable], delta: next[variable] - prev, reason });
    }
  }

  // CURIOSITY — driven by surprise and discovery
  if (signals.predictionsViolated > 0) {
    apply('curiosity', Math.min(signals.totalSurprise * 0.15, 0.2), `${signals.predictionsViolated} prediction(s) violated`);
  }
  if (signals.newKnowledge > 0) {
    apply('curiosity', signals.newKnowledge * 0.03, `${signals.newKnowledge} new knowledge node(s)`);
  }

  // CONCERN — driven by failures and anomalies
  if (signals.recentFailures > 0) {
    const failRate = signals.recentExecutions > 0 ? signals.recentFailures / signals.recentExecutions : 0;
    apply('concern', failRate * 0.15, `${signals.recentFailures}/${signals.recentExecutions} executions failed`);
  }
  if (signals.anomalyFindings > 0) {
    apply('concern', signals.anomalyFindings * 0.08, `${signals.anomalyFindings} anomaly finding(s)`);
  }
  if (signals.criticalFindings > 0) {
    apply('concern', signals.criticalFindings * 0.15, `${signals.criticalFindings} critical finding(s)`);
  }
  if (signals.errorAgents > 0) {
    apply('concern', signals.errorAgents * 0.1, `${signals.errorAgents} agent(s) in error state`);
  }
  // Concern decreases when problems are absent
  if (signals.recentFailures === 0 && signals.anomalyFindings === 0 && signals.criticalFindings === 0) {
    apply('concern', -0.05, 'no issues detected');
  }

  // ENGAGEMENT — driven by activity
  if (signals.recentExecutions > 0) {
    apply('engagement', Math.min(signals.recentExecutions * 0.02, 0.1), `${signals.recentExecutions} execution(s) completed`);
  }
  if (signals.goalsProposed > 0) {
    apply('engagement', signals.goalsProposed * 0.03, `${signals.goalsProposed} goal(s) proposed`);
  }
  if (signals.recentExecutions === 0 && signals.recentEvents < 3) {
    apply('engagement', -0.05, 'quiet period — little activity');
  }

  // SATISFACTION — driven by positive outcomes
  if (signals.goalsCompleted > 0) {
    apply('satisfaction', signals.goalsCompleted * 0.1, `${signals.goalsCompleted} goal(s) completed`);
  }
  if (signals.positiveFeedback > 0) {
    apply('satisfaction', signals.positiveFeedback * 0.05, `${signals.positiveFeedback} positive feedback`);
  }
  if (signals.negativeFeedback > 0) {
    apply('satisfaction', -signals.negativeFeedback * 0.05, `${signals.negativeFeedback} negative feedback`);
  }

  // UNCERTAINTY — driven by unresolved questions
  if (signals.predictionsViolated > 0 && signals.totalSurprise > 0.5) {
    apply('uncertainty', 0.08, `high surprise (${signals.totalSurprise.toFixed(2)}) — world model needs updating`);
  }
  if (signals.predictionsViolated === 0 && signals.totalSurprise < 0.1) {
    apply('uncertainty', -0.03, 'predictions held — world model is accurate');
  }

  return { affect: next, deltas };
}

/**
 * Decay affect toward baselines between cycles.
 * Prevents emotional runaway — the system returns to homeostasis.
 */
export function decayTowardBaseline(current: Affect): Affect {
  const next = { ...current };
  for (const key of Object.keys(BASELINES) as (keyof Affect)[]) {
    const baseline = BASELINES[key];
    const rate = DECAY_RATES[key];
    if (next[key] > baseline) {
      next[key] = Math.max(baseline, next[key] - rate);
    } else if (next[key] < baseline) {
      next[key] = Math.min(baseline, next[key] + rate);
    }
  }
  return next;
}

/**
 * Describe affect state in human-readable terms.
 */
export function describeAffect(affect: Affect): string {
  const lines: string[] = [];
  const describe = (val: number): string => {
    if (val >= 0.8) return 'very high';
    if (val >= 0.6) return 'high';
    if (val >= 0.4) return 'moderate';
    if (val >= 0.2) return 'low';
    return 'very low';
  };

  lines.push(`- Curiosity: ${affect.curiosity.toFixed(2)} (${describe(affect.curiosity)})`);
  lines.push(`- Concern: ${affect.concern.toFixed(2)} (${describe(affect.concern)})`);
  lines.push(`- Engagement: ${affect.engagement.toFixed(2)} (${describe(affect.engagement)})`);
  lines.push(`- Satisfaction: ${affect.satisfaction.toFixed(2)} (${describe(affect.satisfaction)})`);
  lines.push(`- Uncertainty: ${affect.uncertainty.toFixed(2)} (${describe(affect.uncertainty)})`);

  return lines.join('\n');
}

export function defaultAffect(): Affect {
  return { ...BASELINES, curiosity: 0.5, engagement: 0.5 };
}
