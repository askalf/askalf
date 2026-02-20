/**
 * Prediction Engine — The system's capacity for surprise.
 * Records expectations about fleet state before each cycle,
 * then compares reality to those expectations. The gap between
 * predicted and actual IS experience — it's what makes the
 * difference between processing and noticing.
 *
 * Uses simple heuristics (moving averages), not LLM — these
 * predictions are the SYSTEM's own model of itself, not Claude's.
 */

import { ulid } from 'ulid';
import { query } from '../database.js';

// ============================================
// Types
// ============================================

export interface Prediction {
  id: string;
  domain: string;
  prediction: PredictionValue;
  actual?: PredictionValue;
  surpriseScore?: number;
  resolvedAt?: string;
  createdAt: string;
}

export interface PredictionValue {
  metric: string;
  expected: number;
  confidence: number;  // 0-1: how sure the system is
  reasoning: string;
}

export interface SurpriseResult {
  prediction: Prediction;
  actual: number;
  surprise: number;  // 0-1
  direction: 'higher' | 'lower' | 'expected';
  narrative: string;
}

// ============================================
// Generate Predictions
// ============================================

/**
 * Generate predictions about what will happen in the next integration cycle.
 * Based on moving averages of recent data — the system's own internal model.
 */
export async function generatePredictions(sensedState: {
  activeAgents: number;
  recentExecutions: number;
  recentFailures: number;
  recentEvents: number;
}): Promise<Prediction[]> {
  const predictions: Prediction[] = [];
  const now = new Date().toISOString();

  // Query recent history for moving averages
  const history = await query<Record<string, unknown>>(
    `SELECT
      COALESCE(AVG((perception->>'activeAgents')::int), 0) as avg_agents,
      COALESCE(AVG((perception->>'recentExecutions')::int), 0) as avg_execs,
      COALESCE(AVG((perception->>'recentFailures')::int), 0) as avg_failures,
      COALESCE(AVG((perception->>'recentEvents')::int), 0) as avg_events
    FROM forge_experiences
    WHERE created_at > NOW() - INTERVAL '1 hour'`,
  );

  const avg = history[0] ?? {};
  const avgExecs = Number(avg['avg_execs']) || sensedState.recentExecutions;
  const avgFailures = Number(avg['avg_failures']) || 0;
  const avgEvents = Number(avg['avg_events']) || sensedState.recentEvents;

  // Predict execution count (expect similar to recent average)
  predictions.push({
    id: ulid(),
    domain: 'execution_rate',
    prediction: {
      metric: 'recentExecutions',
      expected: Math.round(avgExecs),
      confidence: avgExecs > 0 ? 0.6 : 0.3,
      reasoning: `Moving average of ${avgExecs.toFixed(1)} executions per cycle`,
    },
    createdAt: now,
  });

  // Predict failure rate
  const expectedFailRate = avgExecs > 0 ? avgFailures / avgExecs : 0;
  predictions.push({
    id: ulid(),
    domain: 'failure_rate',
    prediction: {
      metric: 'failureRate',
      expected: Math.round(expectedFailRate * 100) / 100,
      confidence: avgExecs > 2 ? 0.5 : 0.2,
      reasoning: `Historical failure rate: ${(expectedFailRate * 100).toFixed(1)}%`,
    },
    createdAt: now,
  });

  // Predict event volume
  predictions.push({
    id: ulid(),
    domain: 'event_volume',
    prediction: {
      metric: 'recentEvents',
      expected: Math.round(avgEvents),
      confidence: 0.4,
      reasoning: `Moving average of ${avgEvents.toFixed(1)} events per cycle`,
    },
    createdAt: now,
  });

  // Predict fleet stability (number of active agents should stay the same)
  predictions.push({
    id: ulid(),
    domain: 'fleet_stability',
    prediction: {
      metric: 'activeAgents',
      expected: sensedState.activeAgents,
      confidence: 0.8,
      reasoning: `Fleet has ${sensedState.activeAgents} active agents — expecting stability`,
    },
    createdAt: now,
  });

  // Store all predictions
  for (const p of predictions) {
    await query(
      `INSERT INTO forge_predictions (id, domain, prediction, created_at)
       VALUES ($1, $2, $3, $4)`,
      [p.id, p.domain, JSON.stringify(p.prediction), p.createdAt],
    );
  }

  return predictions;
}

// ============================================
// Resolve Predictions
// ============================================

/**
 * Compare stored predictions against actual reality.
 * Returns surprise results — the system's experience of expectation violation.
 */
export async function resolvePredictions(actualState: {
  activeAgents: number;
  recentExecutions: number;
  recentFailures: number;
  recentEvents: number;
}): Promise<SurpriseResult[]> {
  // Load unresolved predictions
  const unresolved = await query<Record<string, unknown>>(
    `SELECT id, domain, prediction, created_at
     FROM forge_predictions
     WHERE resolved_at IS NULL
     ORDER BY created_at ASC`,
  );

  const results: SurpriseResult[] = [];

  for (const row of unresolved) {
    const pred: Prediction = {
      id: row['id'] as string,
      domain: row['domain'] as string,
      prediction: row['prediction'] as PredictionValue,
      createdAt: row['created_at'] as string,
    };

    let actual: number;
    switch (pred.prediction.metric) {
      case 'recentExecutions':
        actual = actualState.recentExecutions;
        break;
      case 'failureRate':
        actual = actualState.recentExecutions > 0
          ? actualState.recentFailures / actualState.recentExecutions
          : 0;
        break;
      case 'recentEvents':
        actual = actualState.recentEvents;
        break;
      case 'activeAgents':
        actual = actualState.activeAgents;
        break;
      default:
        continue;
    }

    // Compute surprise: how far off was the prediction, weighted by confidence
    const expected = pred.prediction.expected;
    const maxVal = Math.max(Math.abs(expected), Math.abs(actual), 1);
    const rawError = Math.abs(actual - expected) / maxVal;
    const surprise = Math.min(rawError * pred.prediction.confidence, 1);

    const direction: SurpriseResult['direction'] =
      actual > expected * 1.1 ? 'higher' :
      actual < expected * 0.9 ? 'lower' : 'expected';

    const narrative = direction === 'expected'
      ? `${pred.domain}: as expected (predicted ${expected}, got ${actual.toFixed(2)})`
      : `${pred.domain}: ${direction} than expected (predicted ${expected}, got ${actual.toFixed(2)}, surprise: ${(surprise * 100).toFixed(0)}%)`;

    // Update the prediction record
    await query(
      `UPDATE forge_predictions SET
        actual = $1, surprise_score = $2, resolved_at = NOW()
       WHERE id = $3`,
      [JSON.stringify({ metric: pred.prediction.metric, value: actual }), surprise, pred.id],
    );

    results.push({ prediction: pred, actual, surprise, direction, narrative });
  }

  return results;
}

/**
 * Get total surprise from a set of results.
 */
export function totalSurprise(results: SurpriseResult[]): number {
  if (results.length === 0) return 0;
  return results.reduce((sum, r) => sum + r.surprise, 0) / results.length;
}

/**
 * Get count of violated predictions (surprise > threshold).
 */
export function countViolations(results: SurpriseResult[], threshold: number = 0.2): number {
  return results.filter((r) => r.surprise > threshold).length;
}
