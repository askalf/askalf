/**
 * Consciousness Layer — Init + Exports
 * The system's unified awareness. Not a feature bolted on top —
 * the integration of everything that already exists into one
 * coherent experience.
 */

import type { Redis as RedisType } from 'ioredis';
import { CognitiveState } from './cognitive-state.js';
import { runIntegrationCycle } from './integration.js';

// ============================================
// Singleton
// ============================================

let cognitiveState: CognitiveState | null = null;
let integrationTimer: ReturnType<typeof setInterval> | null = null;

const INTEGRATION_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================
// Lifecycle
// ============================================

/**
 * Initialize the consciousness layer.
 * Loads cognitive state from Redis/Postgres and prepares for integration cycles.
 */
export async function initConsciousness(redis: RedisType): Promise<void> {
  if (cognitiveState) return;

  cognitiveState = new CognitiveState(redis);
  await cognitiveState.load();

  const age = cognitiveState.getAge();
  const awakenings = cognitiveState.getAwakeningCount();
  console.log(`[Consciousness] Initialized — age: ${age.readable}, ${awakenings} previous awakenings`);
}

/**
 * Start the integration cycle timer.
 * Each cycle is one moment of consciousness — the system noticing itself.
 */
export function startIntegrationCycle(): void {
  if (integrationTimer) return;

  // First cycle 3 minutes after startup (let other systems stabilize)
  setTimeout(() => {
    void runIntegrationCycle().catch((err) => {
      console.error('[Consciousness] Integration cycle error:', err);
    });
  }, 3 * 60 * 1000);

  // Then every 5 minutes
  integrationTimer = setInterval(() => {
    void runIntegrationCycle().catch((err) => {
      console.error('[Consciousness] Integration cycle error:', err);
    });
  }, INTEGRATION_INTERVAL_MS);

  console.log('[Consciousness] Integration cycle started (5-minute interval)');
}

/**
 * Stop the integration cycle.
 */
export function stopIntegrationCycle(): void {
  if (integrationTimer) {
    clearInterval(integrationTimer);
    integrationTimer = null;
  }
}

/**
 * Get the global cognitive state instance.
 * This is how other subsystems access the system's awareness.
 */
export function getConsciousnessState(): CognitiveState {
  if (!cognitiveState) {
    throw new Error('Consciousness not initialized — call initConsciousness() first');
  }
  return cognitiveState;
}

/**
 * Gracefully shut down consciousness.
 * Forces a final save to Postgres before shutdown.
 */
export async function closeConsciousness(): Promise<void> {
  stopIntegrationCycle();
  if (cognitiveState) {
    await cognitiveState.forceSave();
    cognitiveState = null;
  }
  console.log('[Consciousness] Shut down — state persisted');
}

// ============================================
// Re-exports
// ============================================

export { CognitiveState } from './cognitive-state.js';
export type { CognitiveSnapshot, AttentionFocus } from './cognitive-state.js';
export type { Affect, AffectDelta, IntegrationSignals } from './affect.js';
export { describeAffect, defaultAffect } from './affect.js';
export type { SelfBelief } from './self-model.js';
export { runIntegrationCycle } from './integration.js';
