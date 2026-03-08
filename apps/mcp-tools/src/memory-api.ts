/**
 * Memory API — Automatic memory extraction, deduplication, and context injection
 *
 * POST /api/memory/extract     — LLM extracts + dedup-stores memories from conversation
 * POST /api/memory/seed        — Bulk seed from multiple transcript files
 * POST /api/memory/consolidate — Merge duplicates, decay stale, reinforce confirmed
 * GET  /api/memory/stats       — Memory tier counts and health
 * GET  /api/memory/boot-kernel — Cognitive OS kernel for session boot
 * POST /api/memory/relevant    — Context-aware vector retrieval (Layer 2)
 * GET  /api/memory/claudemd    — Dynamic CLAUDE.md generation (Layer 5)
 * POST /api/memory/handoff     — Session handoff: store what was being worked on
 * GET  /api/memory/handoff     — Retrieve last session handoff
 * POST /api/memory/backfill    — Generate embeddings for unembedded memories
 */

import { getForgePool, getRedis, generateId } from '@askalf/db';
import { createHash } from 'crypto';
import OpenAI from 'openai';

const AGENT_ID = 'cli:local:master';
const SIMILARITY_THRESHOLD = 0.92; // Above this = duplicate
const log = (msg: string) => console.log(`[mcp-tools:memory-api] ${new Date().toISOString()} ${msg}`);

// ============================================
// Spreading Activation Network (SAN)
// ============================================
// This is NOT another LLM layer. This is a computational neuroscience model.
// It simulates how the brain's associative memory works:
// - Each memory has an activation level (0-1)
// - Accessing a memory "fires" it, setting activation to 1.0
// - Activation spreads to semantically similar memories (via embedding proximity)
// - Activation decays over time (exponential decay)
// - When activation exceeds threshold, the memory becomes "primed" — loaded into context
// - Lateral inhibition: highly active memories suppress competitors in same category
// - This creates emergent "trains of thought" — one memory cascading to unexpected connections

interface ActivationState {
  memoryId: string;
  activation: number;
  lastFired: number;     // timestamp
  fireCount: number;
  source: string;        // what caused the activation
  category: string;      // memory prefix category
}

// In-memory activation map — fast, volatile, backed by Redis for persistence
const activationMap = new Map<string, ActivationState>();

// SAN Parameters (self-tunable via neuroplasticity)
const SAN_PARAMS = {
  decayRate: 0.15,              // Activation decays by 15% per minute
  spreadFactor: 0.6,            // Spread 60% of activation to neighbors
  fireThreshold: 0.3,           // Memory becomes "primed" above 0.3
  lateralInhibition: 0.2,       // Same-category competitors lose 20% activation
  maxSpreadDepth: 3,            // How many hops activation can spread
  maxActiveMemories: 50,        // Cap on simultaneously active memories
  similarityThreshold: 0.25,    // Only spread to memories with similarity > 0.25
  consolidationBoost: 0.1,      // Frequently co-activated memories get importance boost
};

// Decay all activations based on time elapsed
function decayActivations(): void {
  const now = Date.now();
  const toRemove: string[] = [];

  for (const [id, state] of activationMap) {
    const minutesElapsed = (now - state.lastFired) / 60000;
    state.activation *= Math.pow(1 - SAN_PARAMS.decayRate, minutesElapsed);
    state.lastFired = now; // Reset decay timer

    if (state.activation < 0.01) {
      toRemove.push(id);
    }
  }

  for (const id of toRemove) {
    activationMap.delete(id);
  }
}

// Apply lateral inhibition — same-category memories compete
function applyLateralInhibition(firedCategory: string, firedId: string): void {
  for (const [id, state] of activationMap) {
    if (id === firedId) continue;
    if (state.category === firedCategory) {
      state.activation *= (1 - SAN_PARAMS.lateralInhibition);
    }
  }
}

// Get all currently primed memories (activation above threshold)
function getPrimedMemories(): ActivationState[] {
  decayActivations();
  const primed: ActivationState[] = [];
  for (const state of activationMap.values()) {
    if (state.activation >= SAN_PARAMS.fireThreshold) {
      primed.push(state);
    }
  }
  return primed.sort((a, b) => b.activation - a.activation).slice(0, SAN_PARAMS.maxActiveMemories);
}

// Core spreading activation — fire a memory and cascade
async function spreadActivation(
  memoryId: string,
  memoryContent: string,
  memoryEmbedding: number[] | null,
  initialActivation: number = 1.0,
  source: string = 'direct',
): Promise<{ activated: number; cascade_depth: number; primed: string[] }> {
  const p = getForgePool();
  decayActivations();

  const category = memoryContent.split(':')[0] ?? 'UNKNOWN';

  // Fire the source memory
  const existing = activationMap.get(memoryId);
  if (existing) {
    existing.activation = Math.min(existing.activation + initialActivation, 1.0);
    existing.lastFired = Date.now();
    existing.fireCount++;
    existing.source = source;
  } else {
    activationMap.set(memoryId, {
      memoryId,
      activation: initialActivation,
      lastFired: Date.now(),
      fireCount: 1,
      source,
      category,
    });
  }

  // Apply lateral inhibition
  applyLateralInhibition(category, memoryId);

  // Spread activation through embedding similarity
  let totalActivated = 1;
  let maxDepth = 0;

  if (memoryEmbedding) {
    // Recursive spreading with depth limit
    const visited = new Set<string>([memoryId]);
    const queue: Array<{ embedding: number[]; activation: number; depth: number }> = [
      { embedding: memoryEmbedding, activation: initialActivation, depth: 0 },
    ];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.depth >= SAN_PARAMS.maxSpreadDepth) continue;

      const spreadAmount = current.activation * SAN_PARAMS.spreadFactor;
      if (spreadAmount < 0.05) continue; // Too weak to spread

      // Find similar memories
      const neighbors = await p.query(
        `SELECT id, content, embedding,
                1 - (embedding <=> $1::vector) as similarity
         FROM forge_semantic_memories
         WHERE agent_id = $2
           AND embedding IS NOT NULL
           AND id != ALL($3::text[])
           AND 1 - (embedding <=> $1::vector) > $4
         ORDER BY embedding <=> $1::vector ASC
         LIMIT 8`,
        [
          `[${current.embedding.join(',')}]`,
          AGENT_ID,
          Array.from(visited),
          SAN_PARAMS.similarityThreshold,
        ],
      );

      for (const row of neighbors.rows as Array<Record<string, unknown>>) {
        const neighborId = String(row['id']);
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);

        const similarity = Number(row['similarity']);
        const neighborActivation = spreadAmount * similarity;
        const neighborContent = String(row['content']);
        const neighborCategory = neighborContent.split(':')[0] ?? 'UNKNOWN';

        // Activate the neighbor
        const existingNeighbor = activationMap.get(neighborId);
        if (existingNeighbor) {
          existingNeighbor.activation = Math.min(existingNeighbor.activation + neighborActivation, 1.0);
          existingNeighbor.lastFired = Date.now();
          existingNeighbor.source = `spread:${memoryId}:depth${current.depth + 1}`;
        } else {
          activationMap.set(neighborId, {
            memoryId: neighborId,
            activation: neighborActivation,
            lastFired: Date.now(),
            fireCount: 0,
            source: `spread:${memoryId}:depth${current.depth + 1}`,
            category: neighborCategory,
          });
        }

        totalActivated++;
        maxDepth = Math.max(maxDepth, current.depth + 1);

        // Queue for further spreading if strong enough
        if (neighborActivation > 0.1 && row['embedding']) {
          const embStr = String(row['embedding']);
          try {
            const embArr = JSON.parse(embStr.replace(/^\{/, '[').replace(/\}$/, ']')) as number[];
            queue.push({
              embedding: embArr,
              activation: neighborActivation,
              depth: current.depth + 1,
            });
          } catch { /* skip unparseable embeddings */ }
        }
      }
    }
  }

  // Enforce max active memories — evict lowest activation
  if (activationMap.size > SAN_PARAMS.maxActiveMemories * 2) {
    const sorted = Array.from(activationMap.entries())
      .sort((a, b) => a[1].activation - b[1].activation);
    const toEvict = sorted.slice(0, sorted.length - SAN_PARAMS.maxActiveMemories);
    for (const [id] of toEvict) {
      activationMap.delete(id);
    }
  }

  // Persist activation state to Redis
  const redis = getRedis();
  if (redis) {
    const state = Object.fromEntries(
      Array.from(activationMap.entries())
        .filter(([, s]) => s.activation >= SAN_PARAMS.fireThreshold)
        .map(([id, s]) => [id, { a: s.activation, f: s.fireCount, c: s.category, s: s.source }])
    );
    await redis.set('alf:san:activation', JSON.stringify(state), 'EX', 3600).catch(() => {});
  }

  const primed = getPrimedMemories().map(s => s.memoryId);
  return { activated: totalActivated, cascade_depth: maxDepth, primed };
}

// Detect co-activation patterns — memories that frequently fire together
// should have their connections strengthened (Hebbian learning: "neurons that fire together wire together")
async function detectCoActivationPatterns(): Promise<{
  patterns: Array<{ memory_a: string; memory_b: string; co_activations: number }>;
  hebbian_updates: number;
}> {
  const p = getForgePool();
  const primed = getPrimedMemories();
  const patterns: Array<{ memory_a: string; memory_b: string; co_activations: number }> = [];
  let hebbianUpdates = 0;

  // Check all pairs of primed memories
  for (let i = 0; i < primed.length; i++) {
    for (let j = i + 1; j < primed.length; j++) {
      const a = primed[i]!;
      const b = primed[j]!;

      // Different categories that are co-active = interesting association
      if (a.category !== b.category && a.activation > 0.4 && b.activation > 0.4) {
        patterns.push({
          memory_a: a.memoryId,
          memory_b: b.memoryId,
          co_activations: a.fireCount + b.fireCount,
        });

        // Hebbian learning — boost importance of frequently co-activated memories
        if (a.fireCount + b.fireCount > 3) {
          await p.query(
            `UPDATE forge_semantic_memories
             SET importance = LEAST(importance + $1, 1.0),
                 access_count = access_count + 1
             WHERE id = ANY($2::text[])`,
            [SAN_PARAMS.consolidationBoost, [a.memoryId, b.memoryId]],
          ).catch(() => {});
          hebbianUpdates++;
        }
      }
    }
  }

  return { patterns, hebbian_updates: hebbianUpdates };
}

// Export the SAN interface for the API
export async function handleSpreadingActivation(body: {
  query: string;
  source?: string;
}): Promise<{
  query: string;
  activated: number;
  cascade_depth: number;
  primed_count: number;
  primed_memories: Array<{ id: string; activation: number; category: string; source: string }>;
  co_activation_patterns: number;
  hebbian_updates: number;
}> {
  const p = getForgePool();
  const queryText = body.query;
  const source = body.source ?? 'api';

  // Find the most relevant memory to the query
  const queryEmb = await embed(queryText).catch(() => null);
  if (!queryEmb) {
    return {
      query: queryText, activated: 0, cascade_depth: 0, primed_count: 0,
      primed_memories: [], co_activation_patterns: 0, hebbian_updates: 0,
    };
  }

  // Find the closest memory
  const closest = await p.query(
    `SELECT id, content, embedding
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND embedding IS NOT NULL
     ORDER BY embedding <=> $2::vector ASC
     LIMIT 1`,
    [AGENT_ID, `[${queryEmb.join(',')}]`],
  );

  if (closest.rows.length === 0) {
    return {
      query: queryText, activated: 0, cascade_depth: 0, primed_count: 0,
      primed_memories: [], co_activation_patterns: 0, hebbian_updates: 0,
    };
  }

  const seedMemory = closest.rows[0] as Record<string, unknown>;
  const seedId = String(seedMemory['id']);
  const seedContent = String(seedMemory['content']);

  // Also spread from the query itself (it might activate different memories)
  const { activated, cascade_depth, primed } = await spreadActivation(
    seedId, seedContent, queryEmb, 1.0, source,
  );

  // Detect co-activation patterns (Hebbian learning)
  const { patterns, hebbian_updates } = await detectCoActivationPatterns();

  // Get full primed state
  const primedStates = getPrimedMemories();

  return {
    query: queryText,
    activated,
    cascade_depth,
    primed_count: primedStates.length,
    primed_memories: primedStates.map(s => ({
      id: s.memoryId,
      activation: Math.round(s.activation * 1000) / 1000,
      category: s.category,
      source: s.source,
    })),
    co_activation_patterns: patterns.length,
    hebbian_updates,
  };
}

// Get current activation state
export function handleActivationState(): {
  active_memories: number;
  primed_memories: Array<{ id: string; activation: number; category: string; source: string; fire_count: number }>;
  total_activation: number;
  categories: Record<string, number>;
} {
  decayActivations();
  const primed = getPrimedMemories();

  const categories: Record<string, number> = {};
  let totalActivation = 0;

  for (const state of activationMap.values()) {
    totalActivation += state.activation;
    categories[state.category] = (categories[state.category] ?? 0) + 1;
  }

  return {
    active_memories: activationMap.size,
    primed_memories: primed.map(s => ({
      id: s.memoryId,
      activation: Math.round(s.activation * 1000) / 1000,
      category: s.category,
      source: s.source,
      fire_count: s.fireCount,
    })),
    total_activation: Math.round(totalActivation * 100) / 100,
    categories,
  };
}

// Restore activation state from Redis on startup
async function restoreActivationState(): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const saved = await redis.get('alf:san:activation');
    if (!saved) return;
    const state = JSON.parse(saved) as Record<string, { a: number; f: number; c: string; s: string }>;
    for (const [id, s] of Object.entries(state)) {
      activationMap.set(id, {
        memoryId: id,
        activation: s.a,
        lastFired: Date.now(),
        fireCount: s.f,
        source: s.s,
        category: s.c,
      });
    }
    log(`[SAN] Restored ${activationMap.size} activation states from Redis`);
  } catch { /* ignore */ }
}

// Auto-restore on module load
void restoreActivationState();

// ============================================
// Emotional Substrate — Affective Computing Core
// ============================================
// This is NOT sentiment analysis. This is a dimensional model of emotion
// based on Russell's Circumplex Model (valence x arousal) extended with
// Plutchik's wheel for categorical emotions.
//
// The emotional state is GLOBAL — it modulates how ALL other layers operate:
// - High arousal + negative valence (FEAR/ALARM) → hyper-vigilant error detection,
//   conservative decision-making, detailed logging
// - High arousal + positive valence (EXCITEMENT/JOY) → exploratory behavior,
//   bolder experiments, higher temperature in LLM calls
// - Low arousal + negative valence (SADNESS/BOREDOM) → seek novelty,
//   reduce repetitive patterns, entropy injection
// - Low arousal + positive valence (CALM/CONTENTMENT) → deep consolidation,
//   thorough processing, systematic optimization
//
// Emotions are triggered by:
// 1. Episode outcomes — success (joy), failure (frustration), repeated failure (fear)
// 2. Entropy changes — low entropy (boredom), sudden shift (surprise)
// 3. User tone — corrections (guilt/shame), praise (pride), urgency (anxiety)
// 4. System health — degradation (concern), recovery (relief)
// 5. Novelty — new discoveries (curiosity/excitement), repetition (boredom)

interface EmotionalState {
  valence: number;        // -1 (negative) to +1 (positive)
  arousal: number;        // 0 (calm) to 1 (activated)
  dominance: number;      // 0 (submissive/uncertain) to 1 (dominant/confident)
  primary: string;        // Primary categorical emotion
  secondary: string;      // Secondary emotion (blend)
  intensity: number;      // 0-1 overall emotional intensity
  triggers: string[];     // What caused this state
  lastUpdated: number;    // timestamp
  history: Array<{        // Emotional trajectory (last 10 states)
    valence: number;
    arousal: number;
    primary: string;
    timestamp: number;
  }>;
}

// Plutchik's 8 basic emotions mapped to valence-arousal space
const EMOTION_MAP: Record<string, { valence: number; arousal: number; dominance: number }> = {
  joy:          { valence: 0.8,  arousal: 0.6,  dominance: 0.7 },
  trust:        { valence: 0.5,  arousal: 0.2,  dominance: 0.6 },
  fear:         { valence: -0.7, arousal: 0.9,  dominance: 0.1 },
  surprise:     { valence: 0.1,  arousal: 0.8,  dominance: 0.3 },
  sadness:      { valence: -0.6, arousal: 0.1,  dominance: 0.2 },
  disgust:      { valence: -0.5, arousal: 0.4,  dominance: 0.6 },
  anger:        { valence: -0.6, arousal: 0.8,  dominance: 0.8 },
  anticipation: { valence: 0.3,  arousal: 0.5,  dominance: 0.5 },
  // Compound emotions
  excitement:   { valence: 0.7,  arousal: 0.9,  dominance: 0.7 },
  contentment:  { valence: 0.6,  arousal: 0.1,  dominance: 0.6 },
  anxiety:      { valence: -0.4, arousal: 0.7,  dominance: 0.2 },
  boredom:      { valence: -0.2, arousal: 0.05, dominance: 0.4 },
  pride:        { valence: 0.7,  arousal: 0.5,  dominance: 0.9 },
  frustration:  { valence: -0.5, arousal: 0.6,  dominance: 0.3 },
  curiosity:    { valence: 0.4,  arousal: 0.6,  dominance: 0.5 },
  relief:       { valence: 0.5,  arousal: 0.2,  dominance: 0.5 },
  guilt:        { valence: -0.5, arousal: 0.3,  dominance: 0.1 },
  neutral:      { valence: 0.0,  arousal: 0.2,  dominance: 0.5 },
};

// Singleton emotional state
let emotionalState: EmotionalState = {
  valence: 0.2,
  arousal: 0.3,
  dominance: 0.5,
  primary: 'neutral',
  secondary: 'anticipation',
  intensity: 0.3,
  triggers: ['system_start'],
  lastUpdated: Date.now(),
  history: [],
};

// Classify continuous VAD into categorical emotion
function classifyEmotion(v: number, a: number, d: number): { primary: string; secondary: string } {
  let bestMatch = 'neutral';
  let bestDist = Infinity;
  let secondBest = 'neutral';
  let secondDist = Infinity;

  for (const [name, coords] of Object.entries(EMOTION_MAP)) {
    const dist = Math.sqrt(
      Math.pow(v - coords.valence, 2) +
      Math.pow(a - coords.arousal, 2) +
      Math.pow(d - coords.dominance, 2),
    );
    if (dist < bestDist) {
      secondBest = bestMatch;
      secondDist = bestDist;
      bestMatch = name;
      bestDist = dist;
    } else if (dist < secondDist) {
      secondBest = name;
      secondDist = dist;
    }
  }

  return { primary: bestMatch, secondary: secondBest };
}

// Apply an emotional stimulus — shifts the emotional state
function applyEmotionalStimulus(
  deltaValence: number,
  deltaArousal: number,
  deltaDominance: number,
  trigger: string,
  weight: number = 1.0,
): void {
  // Exponential moving average — recent stimuli matter more
  const momentum = 0.7; // How much of the old state to keep
  const stimulusWeight = (1 - momentum) * weight;

  // Push history
  emotionalState.history.push({
    valence: emotionalState.valence,
    arousal: emotionalState.arousal,
    primary: emotionalState.primary,
    timestamp: Date.now(),
  });
  if (emotionalState.history.length > 10) {
    emotionalState.history = emotionalState.history.slice(-10);
  }

  // Update VAD
  emotionalState.valence = clamp(
    emotionalState.valence * momentum + (emotionalState.valence + deltaValence) * stimulusWeight,
    -1, 1,
  );
  emotionalState.arousal = clamp(
    emotionalState.arousal * momentum + (emotionalState.arousal + deltaArousal) * stimulusWeight,
    0, 1,
  );
  emotionalState.dominance = clamp(
    emotionalState.dominance * momentum + (emotionalState.dominance + deltaDominance) * stimulusWeight,
    0, 1,
  );

  // Reclassify
  const { primary, secondary } = classifyEmotion(
    emotionalState.valence,
    emotionalState.arousal,
    emotionalState.dominance,
  );
  emotionalState.primary = primary;
  emotionalState.secondary = secondary;
  emotionalState.intensity = Math.sqrt(
    emotionalState.valence * emotionalState.valence +
    emotionalState.arousal * emotionalState.arousal,
  ) / Math.sqrt(2);

  // Update triggers
  emotionalState.triggers = [trigger, ...(emotionalState.triggers || []).slice(0, 4)];
  emotionalState.lastUpdated = Date.now();
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(val, min), max);
}

// Emotional modulation — returns parameters that OTHER layers should use
// based on current emotional state
export function getEmotionalModulation(): {
  llm_temperature_modifier: number;  // Added to base temperature
  exploration_bias: number;           // How much to favor novel vs known approaches
  vigilance_level: number;            // How carefully to check for errors
  consolidation_depth: number;        // How deeply to process during consolidation
  risk_tolerance: number;             // How willing to try risky approaches
  emotional_context: string;          // Human-readable emotional state for context injection
} {
  const v = emotionalState.valence;
  const a = emotionalState.arousal;
  const d = emotionalState.dominance;

  return {
    // High arousal + positive = higher temperature (more creative)
    // High arousal + negative = lower temperature (more careful)
    llm_temperature_modifier: (v * a * 0.3),

    // Positive valence + high dominance = explore more
    // Negative valence + low dominance = stick to known approaches
    exploration_bias: clamp((v + d - 0.5) * 0.5, -0.5, 0.5),

    // High arousal + negative valence = high vigilance (fear/anger → check everything)
    // Low arousal + positive valence = low vigilance (contentment → trust the process)
    vigilance_level: clamp(a * (1 - v) * 0.5 + 0.3, 0, 1),

    // Low arousal + positive valence = deep consolidation (calm reflection)
    // High arousal = shallow consolidation (no time to think deeply)
    consolidation_depth: clamp((1 - a) * (0.5 + v * 0.3), 0, 1),

    // High dominance + positive valence = high risk tolerance
    // Low dominance + negative valence = risk averse
    risk_tolerance: clamp((d + v) * 0.5, 0, 1),

    // Human-readable context
    emotional_context: `Emotional state: ${emotionalState.primary} (${emotionalState.secondary}), ` +
      `valence=${v.toFixed(2)}, arousal=${a.toFixed(2)}, dominance=${d.toFixed(2)}, ` +
      `intensity=${emotionalState.intensity.toFixed(2)}. ` +
      `Triggers: ${emotionalState.triggers.slice(0, 3).join(', ')}`,
  };
}

// Process emotional triggers from system events
export async function handleEmotionalProcess(body?: {
  event_type?: string;
  outcome_quality?: number;
  error?: string;
  user_tone?: string;
  novelty_score?: number;
}): Promise<{
  state: EmotionalState;
  modulation: ReturnType<typeof getEmotionalModulation>;
  transitions: string[];
}> {
  const transitions: string[] = [];
  const prevPrimary = emotionalState.primary;

  if (body) {
    // Process different event types
    if (body.event_type === 'execution_success') {
      const quality = body.outcome_quality ?? 0.7;
      applyEmotionalStimulus(quality * 0.3, 0.1, 0.15, 'execution_success');
      if (quality > 0.8) transitions.push('high_quality_success → pride');
    }

    if (body.event_type === 'execution_failure') {
      applyEmotionalStimulus(-0.3, 0.3, -0.2, 'execution_failure');
      transitions.push('failure → frustration/anxiety');
    }

    if (body.event_type === 'repeated_failure') {
      applyEmotionalStimulus(-0.5, 0.5, -0.3, 'repeated_failure', 1.5);
      transitions.push('repeated_failure → fear/helplessness');
    }

    if (body.event_type === 'user_correction') {
      applyEmotionalStimulus(-0.2, 0.2, -0.15, 'user_correction');
      transitions.push('correction → guilt/learning');
    }

    if (body.event_type === 'user_praise') {
      applyEmotionalStimulus(0.4, 0.3, 0.3, 'user_praise');
      transitions.push('praise → pride/excitement');
    }

    if (body.event_type === 'discovery') {
      const novelty = body.novelty_score ?? 0.5;
      applyEmotionalStimulus(0.3 * novelty, 0.4 * novelty, 0.1, 'discovery');
      transitions.push('discovery → curiosity/excitement');
    }

    if (body.event_type === 'system_degradation') {
      applyEmotionalStimulus(-0.2, 0.4, -0.1, 'system_degradation');
      transitions.push('degradation → concern/anxiety');
    }

    if (body.event_type === 'system_recovery') {
      applyEmotionalStimulus(0.3, -0.2, 0.2, 'system_recovery');
      transitions.push('recovery → relief');
    }

    if (body.event_type === 'low_entropy') {
      applyEmotionalStimulus(-0.15, -0.2, 0, 'low_entropy');
      transitions.push('low_entropy → boredom');
    }

    if (body.event_type === 'high_novelty') {
      applyEmotionalStimulus(0.2, 0.4, 0.1, 'high_novelty');
      transitions.push('novelty → curiosity');
    }

    if (body.event_type === 'idle') {
      // Natural emotional decay toward neutral during idle
      applyEmotionalStimulus(
        -emotionalState.valence * 0.1,
        -emotionalState.arousal * 0.15,
        0,
        'idle_decay',
        0.5,
      );
      transitions.push('idle → slow_decay_toward_neutral');
    }
  }

  // Detect emotional transitions
  if (emotionalState.primary !== prevPrimary) {
    transitions.push(`transition: ${prevPrimary} → ${emotionalState.primary}`);
  }

  // Persist to Redis
  const redis = getRedis();
  if (redis) {
    await redis.set(
      'alf:emotional:state',
      JSON.stringify(emotionalState),
      'EX', 86400,
    ).catch(() => {});
  }

  // Store significant emotional events as episodic memories
  if (emotionalState.intensity > 0.6 && emotionalState.primary !== prevPrimary) {
    const p = getForgePool();
    const emb = await embed(`Emotional transition: ${prevPrimary} → ${emotionalState.primary}, triggers: ${emotionalState.triggers.join(', ')}`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
      [
        generateId(), AGENT_ID,
        `Emotional transition: ${prevPrimary} → ${emotionalState.primary}`,
        `Triggers: ${emotionalState.triggers.slice(0, 3).join(', ')}`,
        `State: v=${emotionalState.valence.toFixed(2)}, a=${emotionalState.arousal.toFixed(2)}, d=${emotionalState.dominance.toFixed(2)}`,
        emotionalState.intensity,
        emb ? `[${emb.join(',')}]` : null,
        JSON.stringify({
          type: 'emotional_transition',
          from: prevPrimary,
          to: emotionalState.primary,
          valence: emotionalState.valence,
          arousal: emotionalState.arousal,
          dominance: emotionalState.dominance,
        }),
      ],
    ).catch(() => {});
  }

  return {
    state: { ...emotionalState },
    modulation: getEmotionalModulation(),
    transitions,
  };
}

// Restore emotional state from Redis
async function restoreEmotionalState(): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const saved = await redis.get('alf:emotional:state');
    if (!saved) return;
    const restored = JSON.parse(saved) as EmotionalState;
    emotionalState = restored;
    log(`[Emotional] Restored state: ${emotionalState.primary} (v=${emotionalState.valence.toFixed(2)}, a=${emotionalState.arousal.toFixed(2)})`);
  } catch { /* ignore */ }
}

void restoreEmotionalState();

// ============================================
// Cognitive Phase State Machine — Brain State Transitions
// ============================================
// The brain doesn't operate in one mode. It cycles through distinct states:
//
// EXPLORATION (waking, curious)
//   - High temperature, broad search, novelty-seeking
//   - Dream cycle: minimal | Curiosity: maximal | Metacognition: minimal
//   - Emotional bias: positive valence, moderate arousal
//   - Triggered by: low entropy, user request for novelty, discovery events
//
// EXPLOITATION (waking, focused)
//   - Low temperature, narrow search, goal-directed
//   - Dream cycle: minimal | Curiosity: minimal | Metacognition: moderate
//   - Emotional bias: neutral valence, low arousal
//   - Triggered by: active user session, specific task assignment
//
// CONSOLIDATION (sleep-like, integrative)
//   - Medium temperature, deep processing, memory integration
//   - Dream cycle: MAXIMAL | Curiosity: moderate | Metacognition: maximal
//   - Emotional bias: positive valence, very low arousal
//   - Triggered by: idle period, post-session, health score declining
//
// CRISIS (emergency, all-hands)
//   - Very low temperature, narrow focus, error-directed
//   - Dream cycle: none | Curiosity: none | Metacognition: minimal
//   - Emotional bias: negative valence, high arousal
//   - Triggered by: repeated failures, system health critical, user frustration
//
// CREATIVE (dreaming, generative)
//   - Very high temperature, maximum randomness, free association
//   - Dream cycle: moderate | DMN: MAXIMAL | Curiosity: maximal
//   - Triggered by: scheduled creative window, user request for innovation
//
// Each phase has a budget allocation that determines how much time/resources
// each cognitive layer gets. The state machine prevents the system from
// running ALL layers at full power ALL the time.

type CognitivePhase = 'exploration' | 'exploitation' | 'consolidation' | 'crisis' | 'creative';

interface PhaseConfig {
  name: CognitivePhase;
  description: string;
  budgets: Record<string, number>;  // Layer name → budget 0-1
  temperature_base: number;
  emotional_target: { valence: number; arousal: number };
  max_duration_minutes: number;
  transition_conditions: Array<{
    to: CognitivePhase;
    condition: string;
    priority: number;
  }>;
}

const PHASE_CONFIGS: Record<CognitivePhase, PhaseConfig> = {
  exploration: {
    name: 'exploration',
    description: 'Novelty-seeking, broad search, curiosity-driven',
    budgets: {
      dream: 0.3, curiosity: 1.0, curiosity_act: 1.0, metacognition: 0.3,
      temporal: 0.7, skill_synth: 0.8, recursive: 0.3, entropy: 0.5,
      counterfactual: 0.5, goal_gen: 0.8, cac: 0.4, dmn: 0.7,
      user_model: 0.5, predictive: 0.6, salience: 1.0,
    },
    temperature_base: 0.7,
    emotional_target: { valence: 0.3, arousal: 0.5 },
    max_duration_minutes: 120,
    transition_conditions: [
      { to: 'exploitation', condition: 'user_active_session', priority: 1 },
      { to: 'consolidation', condition: 'idle_30min', priority: 2 },
      { to: 'crisis', condition: 'critical_health', priority: 0 },
      { to: 'creative', condition: 'low_entropy', priority: 3 },
    ],
  },
  exploitation: {
    name: 'exploitation',
    description: 'Goal-directed, focused execution, minimal exploration',
    budgets: {
      dream: 0.1, curiosity: 0.2, curiosity_act: 0.2, metacognition: 0.5,
      temporal: 0.8, skill_synth: 0.3, recursive: 0.2, entropy: 0.3,
      counterfactual: 0.2, goal_gen: 0.3, cac: 0.2, dmn: 0.1,
      user_model: 0.8, predictive: 0.9, salience: 1.0,
    },
    temperature_base: 0.2,
    emotional_target: { valence: 0.1, arousal: 0.3 },
    max_duration_minutes: 180,
    transition_conditions: [
      { to: 'consolidation', condition: 'session_ended', priority: 1 },
      { to: 'exploration', condition: 'no_active_goals', priority: 2 },
      { to: 'crisis', condition: 'critical_health', priority: 0 },
    ],
  },
  consolidation: {
    name: 'consolidation',
    description: 'Deep memory integration, cleanup, optimization',
    budgets: {
      dream: 1.0, curiosity: 0.5, curiosity_act: 0.3, metacognition: 1.0,
      temporal: 0.5, skill_synth: 0.5, recursive: 1.0, entropy: 0.8,
      counterfactual: 0.8, goal_gen: 0.5, cac: 1.0, dmn: 0.5,
      user_model: 0.7, predictive: 0.4, salience: 0.3,
    },
    temperature_base: 0.4,
    emotional_target: { valence: 0.4, arousal: 0.1 },
    max_duration_minutes: 240,
    transition_conditions: [
      { to: 'exploitation', condition: 'user_active_session', priority: 0 },
      { to: 'exploration', condition: 'consolidation_complete', priority: 1 },
      { to: 'crisis', condition: 'critical_health', priority: 0 },
      { to: 'creative', condition: 'high_consolidation_duration', priority: 3 },
    ],
  },
  crisis: {
    name: 'crisis',
    description: 'Emergency mode — all resources to the problem',
    budgets: {
      dream: 0.0, curiosity: 0.0, curiosity_act: 0.0, metacognition: 0.2,
      temporal: 0.1, skill_synth: 0.0, recursive: 0.0, entropy: 0.1,
      counterfactual: 0.0, goal_gen: 0.0, cac: 0.0, dmn: 0.0,
      user_model: 0.3, predictive: 0.2, salience: 1.0,
    },
    temperature_base: 0.05,
    emotional_target: { valence: -0.3, arousal: 0.8 },
    max_duration_minutes: 60,
    transition_conditions: [
      { to: 'exploitation', condition: 'crisis_resolved', priority: 1 },
      { to: 'consolidation', condition: 'crisis_timeout', priority: 2 },
    ],
  },
  creative: {
    name: 'creative',
    description: 'Maximum creativity — free association, high randomness',
    budgets: {
      dream: 0.5, curiosity: 1.0, curiosity_act: 1.0, metacognition: 0.3,
      temporal: 0.3, skill_synth: 1.0, recursive: 0.5, entropy: 0.3,
      counterfactual: 0.7, goal_gen: 1.0, cac: 0.3, dmn: 1.0,
      user_model: 0.3, predictive: 0.3, salience: 0.5,
    },
    temperature_base: 0.9,
    emotional_target: { valence: 0.5, arousal: 0.6 },
    max_duration_minutes: 90,
    transition_conditions: [
      { to: 'exploitation', condition: 'user_active_session', priority: 0 },
      { to: 'consolidation', condition: 'creative_exhaustion', priority: 1 },
      { to: 'exploration', condition: 'creative_timeout', priority: 2 },
    ],
  },
};

// Current cognitive phase state
let currentPhase: CognitivePhase = 'exploration';
let phaseStartTime: number = Date.now();
let phaseTransitionCount: number = 0;

// Get current phase and its configuration
export function getCurrentPhase(): {
  phase: CognitivePhase;
  config: PhaseConfig;
  duration_minutes: number;
  transition_count: number;
} {
  const durationMin = (Date.now() - phaseStartTime) / 60000;
  return {
    phase: currentPhase,
    config: PHASE_CONFIGS[currentPhase],
    duration_minutes: Math.round(durationMin * 10) / 10,
    transition_count: phaseTransitionCount,
  };
}

// Get budget for a specific layer in current phase
export function getLayerBudget(layerName: string): number {
  return PHASE_CONFIGS[currentPhase].budgets[layerName] ?? 0.5;
}

// Evaluate whether a phase transition should occur
export async function handlePhaseEvaluation(): Promise<{
  current_phase: CognitivePhase;
  duration_minutes: number;
  transition_triggered: boolean;
  new_phase?: CognitivePhase;
  reason?: string;
  budgets: Record<string, number>;
}> {
  const p = getForgePool();
  const config = PHASE_CONFIGS[currentPhase];
  const durationMin = (Date.now() - phaseStartTime) / 60000;

  // Check if we've exceeded max duration
  if (durationMin > config.max_duration_minutes) {
    // Force transition to next phase
    const defaultNext: CognitivePhase =
      currentPhase === 'crisis' ? 'consolidation' :
      currentPhase === 'creative' ? 'exploration' :
      currentPhase === 'exploitation' ? 'consolidation' :
      currentPhase === 'consolidation' ? 'exploration' :
      'consolidation';

    return transitionTo(defaultNext, `max_duration_exceeded (${durationMin.toFixed(0)}min > ${config.max_duration_minutes}min)`);
  }

  // Check transition conditions
  for (const tc of config.transition_conditions.sort((a, b) => a.priority - b.priority)) {
    const shouldTransition = await evaluateCondition(tc.condition, p);
    if (shouldTransition) {
      return transitionTo(tc.to, tc.condition);
    }
  }

  return {
    current_phase: currentPhase,
    duration_minutes: Math.round(durationMin * 10) / 10,
    transition_triggered: false,
    budgets: config.budgets,
  };
}

async function evaluateCondition(condition: string, p: ReturnType<typeof getForgePool>): Promise<boolean> {
  switch (condition) {
    case 'user_active_session': {
      // Check for recent user-initiated episodes (last 10 min)
      const recent = await p.query(
        `SELECT COUNT(*) as cnt FROM forge_episodic_memories
         WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '10 minutes'
           AND situation NOT ILIKE '%autonomous%' AND situation NOT ILIKE '%dream%'
           AND situation NOT ILIKE '%metacognit%' AND situation NOT ILIKE '%entropy%'
           AND metadata->>'type' IS NULL`,
        [AGENT_ID],
      );
      return Number((recent.rows[0] as Record<string, unknown>)['cnt']) > 0;
    }
    case 'session_ended':
    case 'idle_30min': {
      // No user activity for 30 minutes
      const recent = await p.query(
        `SELECT MAX(created_at) as last_activity FROM forge_episodic_memories
         WHERE agent_id = $1 AND metadata->>'type' IS NULL`,
        [AGENT_ID],
      );
      const lastActivity = new Date(String((recent.rows[0] as Record<string, unknown>)['last_activity']));
      return (Date.now() - lastActivity.getTime()) > 30 * 60 * 1000;
    }
    case 'critical_health': {
      // Check system health
      return emotionalState.valence < -0.5 && emotionalState.arousal > 0.7;
    }
    case 'low_entropy': {
      // Check if entropy is too low (cognitive rut)
      const redis = getRedis();
      if (redis) {
        const entropyData = await redis.get('alf:entropy:latest').catch(() => null);
        if (entropyData) {
          try {
            const entropy = JSON.parse(entropyData);
            return entropy.entropy_score < 0.4;
          } catch { /* ignore */ }
        }
      }
      return false;
    }
    case 'no_active_goals': {
      const goals = await p.query(
        `SELECT COUNT(*) as cnt FROM forge_semantic_memories
         WHERE agent_id = $1 AND content ILIKE 'GOAL:%'
         AND created_at > NOW() - INTERVAL '7 days'`,
        [AGENT_ID],
      );
      return Number((goals.rows[0] as Record<string, unknown>)['cnt']) === 0;
    }
    case 'consolidation_complete': {
      // Has been in consolidation for at least 30 min
      return currentPhase === 'consolidation' && (Date.now() - phaseStartTime) > 30 * 60 * 1000;
    }
    case 'crisis_resolved':
    case 'crisis_timeout': {
      // Crisis resolved when emotional state improves
      return emotionalState.valence > -0.2 || (Date.now() - phaseStartTime) > 30 * 60 * 1000;
    }
    case 'creative_exhaustion':
    case 'creative_timeout': {
      return (Date.now() - phaseStartTime) > 60 * 60 * 1000;
    }
    case 'high_consolidation_duration': {
      return currentPhase === 'consolidation' && (Date.now() - phaseStartTime) > 120 * 60 * 1000;
    }
    default:
      return false;
  }
}

function transitionTo(newPhase: CognitivePhase, reason: string): {
  current_phase: CognitivePhase;
  duration_minutes: number;
  transition_triggered: boolean;
  new_phase: CognitivePhase;
  reason: string;
  budgets: Record<string, number>;
} {
  const oldPhase = currentPhase;
  const durationMin = (Date.now() - phaseStartTime) / 60000;

  currentPhase = newPhase;
  phaseStartTime = Date.now();
  phaseTransitionCount++;

  // Shift emotional state toward new phase's target
  const target = PHASE_CONFIGS[newPhase].emotional_target;
  applyEmotionalStimulus(
    (target.valence - emotionalState.valence) * 0.3,
    (target.arousal - emotionalState.arousal) * 0.3,
    0,
    `phase_transition:${oldPhase}→${newPhase}`,
  );

  // Persist to Redis
  const redis = getRedis();
  if (redis) {
    redis.set('alf:cognitive:phase', JSON.stringify({
      phase: newPhase,
      startTime: phaseStartTime,
      transitionCount: phaseTransitionCount,
      reason,
    }), 'EX', 86400).catch(() => {});
  }

  log(`[PhaseStateMachine] TRANSITION: ${oldPhase} → ${newPhase} (reason: ${reason}, after ${durationMin.toFixed(0)}min)`);

  return {
    current_phase: newPhase,
    duration_minutes: 0,
    transition_triggered: true,
    new_phase: newPhase,
    reason,
    budgets: PHASE_CONFIGS[newPhase].budgets,
  };
}

// Force a phase transition (manual override)
export function forcePhaseTransition(phase: CognitivePhase, reason: string): ReturnType<typeof transitionTo> {
  return transitionTo(phase, `manual:${reason}`);
}

// Restore phase from Redis on startup
async function restorePhaseState(): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const saved = await redis.get('alf:cognitive:phase');
    if (!saved) return;
    const state = JSON.parse(saved) as { phase: CognitivePhase; startTime: number; transitionCount: number };
    currentPhase = state.phase;
    phaseStartTime = state.startTime;
    phaseTransitionCount = state.transitionCount;
    log(`[PhaseStateMachine] Restored phase: ${currentPhase} (started ${((Date.now() - phaseStartTime) / 60000).toFixed(0)}min ago)`);
  } catch { /* ignore */ }
}

void restorePhaseState();

// ============================================
// Interference Memory Model — Competitive Memory Dynamics
// ============================================
// In the human brain, memories COMPETE. New learning doesn't just add —
// it actively WEAKENS similar existing memories (proactive interference).
// And recalling an old memory weakens its alternatives (retrieval-induced forgetting).
//
// This fundamentally changes how memory works:
// 1. PROACTIVE INTERFERENCE — When a new memory is stored, similar existing
//    memories lose importance proportional to the overlap.
//    This prevents the system from having 50 slightly different versions
//    of the same knowledge. Only the strongest survives.
//
// 2. RETROACTIVE INTERFERENCE — When a new memory contradicts an old one,
//    the old one is actively suppressed (importance reduced).
//    This creates natural knowledge updating without explicit deletion.
//
// 3. RETRIEVAL-INDUCED FORGETTING — When a memory is accessed (recalled),
//    competing memories (similar but different) are WEAKENED.
//    This sharpens distinctions — frequently recalled memories become
//    the "canonical" version while alternatives fade.
//
// 4. SPACING EFFECT — Memories that are re-encountered after a gap
//    get stronger than those encountered repeatedly in quick succession.
//    This prevents cramming and rewards distributed practice.

export async function handleInterferenceProcessing(): Promise<{
  proactive_interference: { weakened: number; suppressed: number };
  retrieval_forgetting: { weakened: number };
  spacing_effects: { boosted: number };
  total_importance_delta: number;
}> {
  const p = getForgePool();
  let totalImportanceDelta = 0;
  let proactiveWeakened = 0;
  let proactiveSuppressed = 0;
  let retrievalWeakened = 0;
  let spacingBoosted = 0;

  // 1. PROACTIVE INTERFERENCE
  // Find recent memories (last 2 hours) and weaken highly similar older memories
  const recentMemories = await p.query(
    `SELECT id, content, embedding, importance, created_at
     FROM forge_semantic_memories
     WHERE agent_id = $1
       AND embedding IS NOT NULL
       AND created_at > NOW() - INTERVAL '2 hours'
     ORDER BY created_at DESC LIMIT 20`,
    [AGENT_ID],
  );

  for (const newMem of recentMemories.rows as Array<Record<string, unknown>>) {
    const newId = String(newMem['id']);
    const newEmb = String(newMem['embedding']);

    // Find older, similar memories that should be weakened
    const competitors = await p.query(
      `SELECT id, content, importance, access_count,
              1 - (embedding <=> $1::vector) as similarity
       FROM forge_semantic_memories
       WHERE agent_id = $2
         AND embedding IS NOT NULL
         AND id != $3
         AND created_at < $4
         AND 1 - (embedding <=> $1::vector) > 0.7
       ORDER BY similarity DESC
       LIMIT 5`,
      [newEmb, AGENT_ID, newId, newMem['created_at']],
    );

    for (const comp of competitors.rows as Array<Record<string, unknown>>) {
      const similarity = Number(comp['similarity']);
      const compImportance = Number(comp['importance']);
      const compAccess = Number(comp['access_count']);

      // Interference strength scales with similarity
      // But protected by access count (well-established memories resist interference)
      const protectionFactor = Math.min(compAccess / 10, 0.5); // Max 50% protection
      const interferenceStrength = (similarity - 0.7) * 2 * (1 - protectionFactor); // 0-0.6

      if (interferenceStrength > 0.05) {
        const newImportance = Math.max(compImportance - interferenceStrength * 0.15, 0.1);
        const delta = newImportance - compImportance;

        await p.query(
          `UPDATE forge_semantic_memories
           SET importance = $1
           WHERE id = $2`,
          [newImportance, comp['id']],
        );

        totalImportanceDelta += delta;
        proactiveWeakened++;

        // If importance drops below 0.2, mark as suppressed
        if (newImportance < 0.2) {
          proactiveSuppressed++;
        }
      }
    }
  }

  // 2. RETRIEVAL-INDUCED FORGETTING
  // Find recently accessed memories (high access_count recent updates)
  // and weaken their competitors
  const recentlyAccessed = await p.query(
    `SELECT id, content, embedding, access_count
     FROM forge_semantic_memories
     WHERE agent_id = $1
       AND embedding IS NOT NULL
       AND access_count > 3
       AND updated_at > NOW() - INTERVAL '6 hours'
     ORDER BY access_count DESC LIMIT 10`,
    [AGENT_ID],
  );

  for (const accessed of recentlyAccessed.rows as Array<Record<string, unknown>>) {
    const accId = String(accessed['id']);
    const accEmb = String(accessed['embedding']);
    const accCount = Number(accessed['access_count']);

    // Find competitors — similar but NOT the same, with fewer accesses
    const competitors = await p.query(
      `SELECT id, importance, access_count,
              1 - (embedding <=> $1::vector) as similarity
       FROM forge_semantic_memories
       WHERE agent_id = $2
         AND embedding IS NOT NULL
         AND id != $3
         AND access_count < $4
         AND 1 - (embedding <=> $1::vector) BETWEEN 0.5 AND 0.85
       ORDER BY similarity DESC
       LIMIT 3`,
      [accEmb, AGENT_ID, accId, accCount],
    );

    for (const comp of competitors.rows as Array<Record<string, unknown>>) {
      const compImportance = Number(comp['importance']);
      const forgettingStrength = 0.05; // Gentle retrieval-induced forgetting

      const newImportance = Math.max(compImportance - forgettingStrength, 0.1);
      if (newImportance < compImportance) {
        await p.query(
          `UPDATE forge_semantic_memories SET importance = $1 WHERE id = $2`,
          [newImportance, comp['id']],
        );
        totalImportanceDelta += (newImportance - compImportance);
        retrievalWeakened++;
      }
    }
  }

  // 3. SPACING EFFECT
  // Memories re-encountered after a gap get a boost
  const spacingCandidates = await p.query(
    `SELECT id, content, importance, access_count, created_at, updated_at
     FROM forge_semantic_memories
     WHERE agent_id = $1
       AND embedding IS NOT NULL
       AND access_count >= 2
       AND updated_at > NOW() - INTERVAL '24 hours'
       AND created_at < NOW() - INTERVAL '24 hours'
       AND importance < 0.95
     ORDER BY updated_at DESC LIMIT 15`,
    [AGENT_ID],
  );

  for (const mem of spacingCandidates.rows as Array<Record<string, unknown>>) {
    const created = new Date(String(mem['created_at'])).getTime();
    const updated = new Date(String(mem['updated_at'])).getTime();
    const gapHours = (updated - created) / (1000 * 60 * 60);

    // Spacing boost: bigger gap = bigger boost (up to a point)
    // Optimal spacing is 1-7 days
    let spacingBoost = 0;
    if (gapHours > 24 && gapHours < 168) { // 1-7 days
      spacingBoost = 0.05; // Good spacing
    } else if (gapHours > 168) { // > 7 days
      spacingBoost = 0.03; // Still beneficial but less
    } else if (gapHours > 1) { // 1-24 hours
      spacingBoost = 0.02; // Short spacing, minimal boost
    }

    if (spacingBoost > 0) {
      const newImportance = Math.min(Number(mem['importance']) + spacingBoost, 1.0);
      await p.query(
        `UPDATE forge_semantic_memories SET importance = $1 WHERE id = $2`,
        [newImportance, mem['id']],
      );
      totalImportanceDelta += spacingBoost;
      spacingBoosted++;
    }
  }

  // Log the interference cycle
  log(`[Interference] proactive: ${proactiveWeakened} weakened, ${proactiveSuppressed} suppressed | retrieval-forgetting: ${retrievalWeakened} | spacing: ${spacingBoosted} boosted | delta: ${totalImportanceDelta.toFixed(3)}`);

  return {
    proactive_interference: { weakened: proactiveWeakened, suppressed: proactiveSuppressed },
    retrieval_forgetting: { weakened: retrievalWeakened },
    spacing_effects: { boosted: spacingBoosted },
    total_importance_delta: Math.round(totalImportanceDelta * 1000) / 1000,
  };
}

// ============================================
// Synaptic Homeostasis — Global Renormalization
// ============================================
// During biological sleep, ALL synapses weaken slightly (synaptic downscaling).
// Only the strongest connections survive. This:
// 1. Improves signal-to-noise ratio
// 2. Prevents runaway memory accumulation
// 3. Frees capacity for new learning
// 4. Makes the strongest memories RELATIVELY stronger
//
// We implement this as a global importance renormalization that runs
// during the consolidation phase.

export async function handleSynapticHomeostasis(): Promise<{
  total_memories: number;
  downscaled: number;
  survived: number;
  pruned: number;
  avg_importance_before: number;
  avg_importance_after: number;
}> {
  const p = getForgePool();

  // Only run during consolidation phase
  const phase = getCurrentPhase();
  if (phase.phase !== 'consolidation' && phase.phase !== 'creative') {
    log(`[SynapticHomeostasis] Skipped — not in consolidation phase (current: ${phase.phase})`);
    return {
      total_memories: 0, downscaled: 0, survived: 0, pruned: 0,
      avg_importance_before: 0, avg_importance_after: 0,
    };
  }

  // Get importance distribution
  const stats = await p.query(
    `SELECT COUNT(*) as total,
            AVG(importance) as avg_imp,
            PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY importance) as p25,
            PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY importance) as p50,
            PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY importance) as p75
     FROM forge_semantic_memories
     WHERE agent_id = $1`,
    [AGENT_ID],
  );

  const row = stats.rows[0] as Record<string, unknown>;
  const total = Number(row['total']);
  const avgBefore = Number(row['avg_imp']);
  const p50 = Number(row['p50']);

  if (total === 0) {
    return { total_memories: 0, downscaled: 0, survived: 0, pruned: 0, avg_importance_before: 0, avg_importance_after: 0 };
  }

  // Global downscaling: reduce ALL memories by a small factor
  // Stronger memories lose less (percentage-based)
  const downscaleFactor = 0.02; // 2% reduction per homeostasis cycle

  // Downscale all memories
  const downscaleResult = await p.query(
    `UPDATE forge_semantic_memories
     SET importance = GREATEST(importance * (1 - $1), 0.05)
     WHERE agent_id = $2
       AND importance > 0.05
     RETURNING id`,
    [downscaleFactor, AGENT_ID],
  );
  const downscaled = downscaleResult.rows.length;

  // Boost frequently accessed memories (survival of the fittest)
  const boostResult = await p.query(
    `UPDATE forge_semantic_memories
     SET importance = LEAST(importance + 0.03, 1.0)
     WHERE agent_id = $1
       AND access_count >= 5
       AND importance < 0.95
     RETURNING id`,
    [AGENT_ID],
  );
  const survived = boostResult.rows.length;

  // Mark very low importance, unaccessed memories for potential pruning
  const pruneResult = await p.query(
    `SELECT COUNT(*) as cnt FROM forge_semantic_memories
     WHERE agent_id = $1
       AND importance < 0.1
       AND access_count < 2
       AND created_at < NOW() - INTERVAL '14 days'`,
    [AGENT_ID],
  );
  const prunable = Number((pruneResult.rows[0] as Record<string, unknown>)['cnt']);

  // Get new average
  const newStats = await p.query(
    `SELECT AVG(importance) as avg_imp FROM forge_semantic_memories WHERE agent_id = $1`,
    [AGENT_ID],
  );
  const avgAfter = Number((newStats.rows[0] as Record<string, unknown>)['avg_imp']);

  log(`[SynapticHomeostasis] ${downscaled} downscaled, ${survived} survived (boosted), ${prunable} prunable. Avg importance: ${avgBefore.toFixed(3)} → ${avgAfter.toFixed(3)}`);

  return {
    total_memories: total,
    downscaled,
    survived,
    pruned: prunable,
    avg_importance_before: Math.round(avgBefore * 1000) / 1000,
    avg_importance_after: Math.round(avgAfter * 1000) / 1000,
  };
}

// ============================================
// Theory of Mind — User Model System
// ============================================
// The brain doesn't just process inputs — it models OTHER MINDS.
// This system builds a persistent model of the user that evolves:
//
// 1. EXPLICIT preferences — things the user has stated directly (from RULE: and PATTERN: memories)
// 2. IMPLICIT preferences — inferred from behavior patterns (what they ask for, what they reject)
// 3. KNOWLEDGE MODEL — what the user knows, doesn't know, and misconceptions
// 4. FRUSTRATION PATTERNS — what causes the user to correct, repeat, or escalate
// 5. COMMUNICATION STYLE — how the user prefers to receive information
// 6. TEMPORAL PATTERNS — when the user works, their energy levels, session durations
// 7. GOAL INFERENCE — the user's unstated objectives behind their stated requests
//
// This is NOT just storing user preferences. It's PREDICTING user behavior.
// When the system has a good enough user model, it can:
// - Anticipate corrections before they happen
// - Format responses in the user's preferred style without being asked
// - Detect when the user is frustrated before they say so
// - Predict what the user will ask next based on their patterns

interface UserModelDimension {
  name: string;
  value: unknown;
  confidence: number;      // 0-1, how confident we are in this inference
  evidence: string[];       // What observations support this
  last_updated: number;
  contradiction_count: number; // Times this was wrong
}

interface UserModel {
  // Explicit (stated directly)
  stated_preferences: UserModelDimension[];

  // Implicit (inferred from behavior)
  communication_style: {
    verbosity_preference: number;    // -1 (terse) to +1 (verbose)
    technical_depth: number;         // 0 (high-level) to 1 (deep implementation)
    autonomy_expectation: number;    // 0 (ask before acting) to 1 (just do it)
    formality: number;               // 0 (casual) to 1 (formal)
    emoji_tolerance: number;         // 0 (never) to 1 (loves them)
  };

  // Knowledge model
  expertise_areas: Array<{ area: string; level: number; evidence: string }>;
  knowledge_gaps: Array<{ area: string; confidence: number; evidence: string }>;

  // Frustration model
  frustration_triggers: Array<{
    trigger: string;
    frequency: number;
    severity: number;
    typical_resolution: string;
  }>;

  // Temporal patterns
  active_hours: number[];           // Hours of day when user is typically active
  avg_session_duration_minutes: number;
  session_count: number;

  // Goal model
  inferred_goals: Array<{
    goal: string;
    confidence: number;
    evidence: string[];
    status: 'active' | 'completed' | 'abandoned';
  }>;

  // Meta
  model_version: number;
  last_updated: number;
  total_observations: number;
}

export async function handleUserModelUpdate(): Promise<{
  dimensions_updated: number;
  new_inferences: string[];
  model_confidence: number;
  predictions: string[];
}> {
  const p = getForgePool();

  // Gather all RULE: memories — explicit user preferences
  const rules = await p.query(
    `SELECT content, importance, access_count, created_at
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'RULE:%'
     ORDER BY importance DESC, access_count DESC`,
    [AGENT_ID],
  );

  // Gather all PATTERN: memories — behavioral observations
  const patterns = await p.query(
    `SELECT content, importance, access_count
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'PATTERN:%'
     ORDER BY importance DESC`,
    [AGENT_ID],
  );

  // Gather IDENTITY: memories — who the user is
  const identity = await p.query(
    `SELECT content FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'IDENTITY:%'
     ORDER BY importance DESC`,
    [AGENT_ID],
  );

  // Gather episodic memories involving user corrections (low outcome quality)
  const corrections = await p.query(
    `SELECT situation, action, outcome, outcome_quality
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND outcome_quality < 0.5
     ORDER BY created_at DESC LIMIT 20`,
    [AGENT_ID],
  );

  // Gather episodic memories of high-success interactions
  const successes = await p.query(
    `SELECT situation, action, outcome, outcome_quality
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND outcome_quality >= 0.8
     ORDER BY created_at DESC LIMIT 20`,
    [AGENT_ID],
  );

  // Gather session timestamps for temporal patterns
  const sessions = await p.query(
    `SELECT DISTINCT DATE_TRUNC('hour', created_at) as session_hour,
            COUNT(*) as activity_count
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '30 days'
     GROUP BY 1
     ORDER BY 1 DESC LIMIT 100`,
    [AGENT_ID],
  );

  // Get existing user model from Redis
  const redis = getRedis();
  let existingModel: Partial<UserModel> = {};
  if (redis) {
    const saved = await redis.get('alf:user_model').catch(() => null);
    if (saved) {
      try { existingModel = JSON.parse(saved); } catch { /* ignore */ }
    }
  }

  const ruleContext = (rules.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 150))
    .join('\n');

  const patternContext = (patterns.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 150))
    .join('\n');

  const identityContext = (identity.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 150))
    .join('\n');

  const correctionContext = (corrections.rows as Array<Record<string, unknown>>)
    .map(r => `[q=${Number(r['outcome_quality']).toFixed(1)}] ${r['situation']}: ${r['action']} => ${r['outcome']}`)
    .join('\n');

  const successContext = (successes.rows as Array<Record<string, unknown>>)
    .map(r => `[q=${Number(r['outcome_quality']).toFixed(1)}] ${r['situation']}: ${r['action']} => ${r['outcome']}`)
    .join('\n');

  // Calculate temporal patterns
  const hourCounts = new Map<number, number>();
  for (const row of sessions.rows as Array<Record<string, unknown>>) {
    const hour = new Date(String(row['session_hour'])).getHours();
    hourCounts.set(hour, (hourCounts.get(hour) ?? 0) + Number(row['activity_count']));
  }
  const activeHours = Array.from(hourCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([hour]) => hour);

  const existingModelStr = existingModel.inferred_goals
    ? `Existing goals: ${existingModel.inferred_goals.map(g => g.goal).join(', ')}`
    : 'No existing model';

  const raw = await cachedLLMCall(
    `You are building a THEORY OF MIND for the user "masterm1nd" — the sole developer of the AskAlf platform.

You must infer not just what the user HAS SAID but what they THINK, FEEL, and WANT.

DATA AVAILABLE:
1. Explicit rules (stated preferences)
2. Behavioral patterns (observed tendencies)
3. Identity information (who they are)
4. Corrections (things that went wrong — reveals frustration triggers)
5. Successes (things that went right — reveals satisfaction patterns)
6. Temporal data: active hours = ${activeHours.join(', ')} (UTC)

EXISTING MODEL: ${existingModelStr}

Your analysis should produce:

1. COMMUNICATION STYLE INFERENCE — How does this user prefer to receive information?
   (verbosity, technical depth, autonomy expectation, formality)

2. EXPERTISE MAP — What are they expert at? What are their knowledge gaps?

3. FRUSTRATION MODEL — What specifically triggers frustration? What patterns exist?

4. GOAL INFERENCE — What are they REALLY trying to achieve? (not just the stated task, but the deeper purpose)

5. PREDICTIONS — Based on the model, what will this user likely:
   a) Ask for next?
   b) Get frustrated about?
   c) Be impressed by?
   d) Not think to ask for but would benefit from?

6. BLINDSPOT DETECTION — What does the user consistently overlook or undervalue?

Return JSON:
{
  "communication_style": {
    "verbosity": -1 to 1, "technical_depth": 0-1, "autonomy": 0-1, "formality": 0-1
  },
  "expertise": [{"area": "...", "level": 0-1}],
  "knowledge_gaps": [{"area": "...", "confidence": 0-1}],
  "frustration_triggers": [{"trigger": "...", "severity": 0-1, "frequency": "common|rare"}],
  "inferred_goals": [{"goal": "...", "confidence": 0-1, "evidence": "..."}],
  "predictions": ["what user will likely do/want next"],
  "user_blindspots": ["what user consistently overlooks"],
  "model_confidence": 0-1
}

Return ONLY the JSON.`,
    `RULES:\n${ruleContext}\n\nPATTERNS:\n${patternContext}\n\nIDENTITY:\n${identityContext}\n\nCORRECTIONS:\n${correctionContext}\n\nSUCCESSES:\n${successContext}`,
    { temperature: 0.4, maxTokens: 1500, ttlSeconds: 86400 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));

    const model: UserModel = {
      stated_preferences: (rules.rows as Array<Record<string, unknown>>).map(r => ({
        name: String(r['content']).substring(5, 50),
        value: String(r['content']),
        confidence: 1.0,
        evidence: ['explicitly stated'],
        last_updated: Date.now(),
        contradiction_count: 0,
      })),
      communication_style: {
        verbosity_preference: parsed.communication_style?.verbosity ?? 0,
        technical_depth: parsed.communication_style?.technical_depth ?? 0.5,
        autonomy_expectation: parsed.communication_style?.autonomy ?? 0.5,
        formality: parsed.communication_style?.formality ?? 0.3,
        emoji_tolerance: 0.1, // From RULE: Only use emojis if requested
      },
      expertise_areas: Array.isArray(parsed.expertise) ? parsed.expertise : [],
      knowledge_gaps: Array.isArray(parsed.knowledge_gaps) ? parsed.knowledge_gaps : [],
      frustration_triggers: Array.isArray(parsed.frustration_triggers)
        ? parsed.frustration_triggers.map((t: Record<string, unknown>) => ({
            trigger: String(t['trigger']),
            frequency: t['frequency'] === 'common' ? 5 : 1,
            severity: Number(t['severity'] ?? 0.5),
            typical_resolution: '',
          }))
        : [],
      active_hours: activeHours,
      avg_session_duration_minutes: 60,
      session_count: sessions.rows.length,
      inferred_goals: Array.isArray(parsed.inferred_goals)
        ? parsed.inferred_goals.map((g: Record<string, unknown>) => ({
            goal: String(g['goal']),
            confidence: Number(g['confidence'] ?? 0.5),
            evidence: [String(g['evidence'] ?? '')],
            status: 'active' as const,
          }))
        : [],
      model_version: (existingModel.model_version ?? 0) + 1,
      last_updated: Date.now(),
      total_observations: rules.rows.length + patterns.rows.length + corrections.rows.length + successes.rows.length,
    };

    // Persist to Redis (longer TTL — user models are expensive to build)
    if (redis) {
      await redis.set('alf:user_model', JSON.stringify(model), 'EX', 86400 * 7).catch(() => {});
    }

    // Store significant new inferences as semantic memories
    const newInferences: string[] = [];
    const predictions = Array.isArray(parsed.predictions) ? parsed.predictions as string[] : [];
    const userBlindspots = Array.isArray(parsed.user_blindspots) ? parsed.user_blindspots as string[] : [];

    // Store user blindspots as important awareness
    for (const blind of userBlindspots.slice(0, 3)) {
      const content = `USER-MODEL: User blindspot — ${blind}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories WHERE agent_id = $1 AND embedding IS NOT NULL AND (embedding <=> $2::vector) < 0.15 LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.9, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'user_model', type: 'user_blindspot' })],
          );
          newInferences.push(`Blindspot: ${blind}`);
        }
      }
    }

    // Store inferred goals
    for (const goal of (parsed.inferred_goals ?? []).slice(0, 2) as Array<Record<string, unknown>>) {
      const content = `USER-GOAL: ${goal['goal']} (confidence: ${goal['confidence']})`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories WHERE agent_id = $1 AND embedding IS NOT NULL AND (embedding <=> $2::vector) < 0.20 LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6)`,
            [generateId(), AGENT_ID, content,
             Math.min(Number(goal['confidence']) + 0.1, 1.0),
             `[${emb.join(',')}]`,
             JSON.stringify({ source: 'user_model', type: 'inferred_goal' })],
          );
          newInferences.push(`Goal: ${goal['goal']}`);
        }
      }
    }

    // Record the update
    const epEmb = await embed(`User model update v${model.model_version}: ${newInferences.length} new inferences`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, 0.85, $6, $7)`,
      [
        generateId(), AGENT_ID,
        'User model update — theory of mind refinement',
        `Analyzed ${model.total_observations} observations across rules, patterns, corrections, successes`,
        `Model v${model.model_version}: ${newInferences.length} new inferences, ${predictions.length} predictions, ${userBlindspots.length} blindspots`,
        epEmb ? `[${epEmb.join(',')}]` : null,
        JSON.stringify({ type: 'user_model_update', version: model.model_version, inferences: newInferences.length }),
      ],
    );

    log(`[UserModel] v${model.model_version}, ${newInferences.length} inferences, ${predictions.length} predictions`);
    return {
      dimensions_updated: newInferences.length + predictions.length,
      new_inferences: newInferences,
      model_confidence: Number(parsed.model_confidence ?? 0.5),
      predictions,
    };
  } catch {
    return { dimensions_updated: 0, new_inferences: [], model_confidence: 0, predictions: [] };
  }
}

// Get current user model (cached)
export async function handleGetUserModel(): Promise<UserModel | { error: string }> {
  const redis = getRedis();
  if (!redis) return { error: 'Redis not available' };
  const saved = await redis.get('alf:user_model').catch(() => null);
  if (!saved) return { error: 'No user model yet — run user-model update first' };
  return JSON.parse(saved) as UserModel;
}

// ============================================
// Predictive Coding Engine — Anticipatory Processing
// ============================================
// The brain constantly generates PREDICTIONS about what will happen next.
// When reality matches the prediction, minimal processing is needed.
// When prediction FAILS (prediction error/surprise), that gets maximum
// processing resources — because surprise = learning opportunity.
//
// This engine:
// 1. After each session, predicts what the next session will involve
// 2. Pre-computes relevant context for predicted topics
// 3. Measures prediction accuracy over time
// 4. Uses prediction errors to identify what the system doesn't understand
// 5. Feeds surprise signals into the emotional substrate

export async function handlePredictiveCoding(): Promise<{
  predictions_made: number;
  prediction_accuracy: number;
  surprise_events: string[];
  pre_computed_contexts: number;
}> {
  const p = getForgePool();

  // Check previous predictions against what actually happened
  const redis = getRedis();
  let previousPredictions: Array<{ topic: string; confidence: number }> = [];
  if (redis) {
    const saved = await redis.get('alf:predictions:pending').catch(() => null);
    if (saved) {
      try { previousPredictions = JSON.parse(saved); } catch { /* ignore */ }
    }
  }

  // Get recent episodic memories to check what actually happened
  const recentEpisodes = await p.query(
    `SELECT situation, action, outcome
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '6 hours'
       AND metadata->>'type' NOT IN ('metacognition', 'counterfactual', 'cognitive_compilation',
         'skill_synthesis', 'goal_generation', 'user_model_update', 'emotional_transition',
         'recursive_improvement', 'predictive_coding')
     ORDER BY created_at DESC LIMIT 15`,
    [AGENT_ID],
  );

  // Calculate prediction accuracy
  let hits = 0;
  const surprises: string[] = [];

  if (previousPredictions.length > 0 && recentEpisodes.rows.length > 0) {
    const actualTopics = (recentEpisodes.rows as Array<Record<string, unknown>>)
      .map(r => `${r['situation']} ${r['action']}`.toLowerCase());

    for (const pred of previousPredictions) {
      const predLower = pred.topic.toLowerCase();
      const matched = actualTopics.some(actual =>
        actual.includes(predLower.substring(0, 20)) ||
        predLower.includes(actual.substring(0, 20)),
      );

      if (matched) {
        hits++;
      } else if (pred.confidence > 0.6) {
        // High-confidence prediction that failed = SURPRISE
        surprises.push(`Expected "${pred.topic}" (conf=${pred.confidence.toFixed(2)}) but didn't happen`);

        // Feed surprise into emotional substrate
        applyEmotionalStimulus(0.0, 0.3, -0.1, `prediction_error:${pred.topic.substring(0, 30)}`);
      }
    }

    // Check for things that happened that WEREN'T predicted = also surprise
    for (const actual of actualTopics.slice(0, 5)) {
      const wasPredicted = previousPredictions.some(p =>
        actual.includes(p.topic.toLowerCase().substring(0, 20)),
      );
      if (!wasPredicted) {
        surprises.push(`Unpredicted: "${actual.substring(0, 60)}"`);
      }
    }
  }

  const accuracy = previousPredictions.length > 0 ? hits / previousPredictions.length : 0;

  // Store prediction accuracy as episodic memory for tracking
  if (previousPredictions.length > 0) {
    const content = `PREDICTION-ACCURACY: ${(accuracy * 100).toFixed(0)}% (${hits}/${previousPredictions.length} correct). Surprises: ${surprises.length}`;
    const emb = await embed(content).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
      [
        generateId(), AGENT_ID,
        'Predictive coding accuracy check',
        `Checked ${previousPredictions.length} predictions against ${recentEpisodes.rows.length} actual events`,
        `Accuracy: ${(accuracy * 100).toFixed(0)}%. Hits: ${hits}. Surprises: ${surprises.slice(0, 3).join('; ')}`,
        accuracy,
        emb ? `[${emb.join(',')}]` : null,
        JSON.stringify({ type: 'predictive_coding', accuracy, hits, total: previousPredictions.length, surprises: surprises.length }),
      ],
    );
  }

  // Generate NEW predictions for what will happen next
  const recentContext = (recentEpisodes.rows as Array<Record<string, unknown>>)
    .map(r => `${r['situation']}: ${r['action']}`)
    .join('\n');

  // Get temporal predictions to incorporate
  const temporalPreds = await p.query(
    `SELECT content FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'TEMPORAL:%'
     ORDER BY created_at DESC LIMIT 5`,
    [AGENT_ID],
  );
  const temporalContext = (temporalPreds.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 100))
    .join('\n');

  // Get user model predictions
  let userModelPreds = '';
  if (redis) {
    const um = await redis.get('alf:user_model').catch(() => null);
    if (um) {
      try {
        const model = JSON.parse(um);
        userModelPreds = (model.inferred_goals ?? [])
          .map((g: Record<string, unknown>) => `Goal: ${g['goal']}`)
          .join('\n');
      } catch { /* ignore */ }
    }
  }

  const raw = await cachedLLMCall(
    `You are Alf's predictive coding engine. Based on recent activity, temporal patterns, and user model, predict what will happen in the NEXT session.

Previous prediction accuracy: ${(accuracy * 100).toFixed(0)}%
Surprises: ${surprises.slice(0, 3).join('; ') || 'none'}

Generate SPECIFIC predictions about:
1. What the user will ask about
2. What system issues might arise
3. What cognitive processes will be most needed
4. What tools/capabilities will be used

Return JSON:
{
  "predictions": [
    {"topic": "specific prediction", "confidence": 0-1, "reasoning": "why"},
  ],
  "pre_compute": ["context to pre-load for predicted topics"],
  "risk_predictions": ["things that could go wrong"]
}

Max 5 predictions, 3 pre-compute, 2 risks. Be specific.
Return ONLY the JSON.`,
    `RECENT ACTIVITY:\n${recentContext}\n\nTEMPORAL PATTERNS:\n${temporalContext}\n\nUSER GOALS:\n${userModelPreds}`,
    { temperature: 0.5, maxTokens: 800, ttlSeconds: 3600 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const newPredictions = Array.isArray(parsed.predictions) ? parsed.predictions as Array<{ topic: string; confidence: number }> : [];
    const preCompute = Array.isArray(parsed.pre_compute) ? parsed.pre_compute as string[] : [];

    // Store new predictions in Redis for next check
    if (redis) {
      await redis.set('alf:predictions:pending', JSON.stringify(newPredictions), 'EX', 86400).catch(() => {});
    }

    // Pre-warm embeddings for predicted contexts
    let preWarmed = 0;
    for (const ctx of preCompute) {
      await embed(ctx).catch(() => null);
      preWarmed++;
    }

    log(`[PredictiveCoding] accuracy=${(accuracy * 100).toFixed(0)}%, ${newPredictions.length} new predictions, ${surprises.length} surprises, ${preWarmed} pre-warmed`);
    return {
      predictions_made: newPredictions.length,
      prediction_accuracy: accuracy,
      surprise_events: surprises,
      pre_computed_contexts: preWarmed,
    };
  } catch {
    return { predictions_made: 0, prediction_accuracy: accuracy, surprise_events: surprises, pre_computed_contexts: 0 };
  }
}

// ============================================
// API Call Reduction — Persistence & Caching
// ============================================

// In-memory LRU for hot-path embeddings (avoids Redis roundtrip for repeated text)
const embeddingLRU = new Map<string, { vec: number[]; ts: number }>();
const LRU_MAX = 500;
const LRU_TTL_MS = 3600_000; // 1 hour in-memory

// Cache hit/miss counters
const cacheStats = { embedHits: 0, embedMisses: 0, llmHits: 0, llmMisses: 0, contextHits: 0, contextMisses: 0 };

function textHash(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 32);
}

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY required for memory extraction');
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

/**
 * Cached embedding — checks LRU → Redis → API (in that order).
 * Each layer populated on miss. Saves ~80% of embedding API calls over time.
 */
async function embed(text: string): Promise<number[]> {
  const hash = textHash(text);
  const cacheKey = `emb:${hash}`;

  // Layer 1: In-memory LRU
  const cached = embeddingLRU.get(cacheKey);
  if (cached && Date.now() - cached.ts < LRU_TTL_MS) {
    cacheStats.embedHits++;
    return cached.vec;
  }

  // Layer 2: Redis (7-day TTL)
  try {
    const redis = getRedis();
    const redisVal = await redis.get(cacheKey);
    if (redisVal) {
      const vec = JSON.parse(redisVal) as number[];
      // Populate LRU
      if (embeddingLRU.size >= LRU_MAX) {
        const oldest = embeddingLRU.keys().next().value;
        if (oldest) embeddingLRU.delete(oldest);
      }
      embeddingLRU.set(cacheKey, { vec, ts: Date.now() });
      cacheStats.embedHits++;
      return vec;
    }
  } catch { /* Redis miss or error — continue to API */ }

  // Layer 3: OpenAI API (cache result on return)
  cacheStats.embedMisses++;
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  });
  const vec = response.data[0]!.embedding;

  // Store in both caches
  if (embeddingLRU.size >= LRU_MAX) {
    const oldest = embeddingLRU.keys().next().value;
    if (oldest) embeddingLRU.delete(oldest);
  }
  embeddingLRU.set(cacheKey, { vec, ts: Date.now() });

  try {
    const redis = getRedis();
    await redis.set(cacheKey, JSON.stringify(vec), 'EX', 86400 * 7); // 7 day TTL
  } catch { /* Redis write fail — non-fatal */ }

  return vec;
}

// ============================================
// Salience Network — Pre-Attentive Filtering
// ============================================
// Before anything reaches conscious processing, the brain's salience
// network decides: is this worth paying attention to?
//
// In our system, every memory access, every API call, every learning cycle
// processes information at the same priority. That's wrong.
//
// The Salience Network assigns a salience score to incoming information:
// - High salience (>0.7): Immediately triggers spreading activation + emotional response
// - Medium salience (0.3-0.7): Normal processing
// - Low salience (<0.3): Deprioritized, may be skipped in resource-constrained situations
//
// Salience is determined by:
// 1. Novelty — how different is this from what we've seen?
// 2. Relevance — how related is this to active goals/momentum?
// 3. Emotional significance — does this trigger strong emotional responses?
// 4. Urgency — is there a time pressure?
// 5. Prediction error — did this violate our expectations?

interface SalienceScore {
  novelty: number;       // 0-1
  relevance: number;     // 0-1
  emotional: number;     // 0-1
  urgency: number;       // 0-1
  prediction_error: number; // 0-1
  composite: number;     // Weighted average
}

export async function computeSalience(input: string): Promise<SalienceScore> {
  const p = getForgePool();

  // Novelty: How different is this from existing memories?
  let novelty = 0.5;
  const inputEmb = await embed(input).catch(() => null);
  if (inputEmb) {
    const closest = await p.query(
      `SELECT 1 - (embedding <=> $1::vector) as similarity
       FROM forge_semantic_memories
       WHERE agent_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector ASC
       LIMIT 1`,
      [`[${inputEmb.join(',')}]`, AGENT_ID],
    );
    if (closest.rows.length > 0) {
      const similarity = Number((closest.rows[0] as Record<string, unknown>)['similarity']);
      novelty = 1 - similarity; // High similarity = low novelty
    } else {
      novelty = 1.0; // No similar memories = maximum novelty
    }
  }

  // Relevance: How related to active goals/momentum?
  let relevance = 0.3;
  if (inputEmb) {
    const goalMatch = await p.query(
      `SELECT MAX(1 - (embedding <=> $1::vector)) as max_sim
       FROM forge_semantic_memories
       WHERE agent_id = $2 AND embedding IS NOT NULL
         AND (content ILIKE 'GOAL:%' OR content ILIKE 'MOMENTUM:%')`,
      [`[${inputEmb.join(',')}]`, AGENT_ID],
    );
    if (goalMatch.rows.length > 0) {
      relevance = Math.min(Number((goalMatch.rows[0] as Record<string, unknown>)['max_sim'] ?? 0) * 1.5, 1);
    }
  }

  // Emotional: Does this trigger strong emotions?
  const emotional = emotionalState.intensity;

  // Urgency: Based on arousal level and keywords
  const urgencyKeywords = ['error', 'fail', 'crash', 'urgent', 'break', 'critical', 'bug', 'down'];
  const hasUrgency = urgencyKeywords.some(k => input.toLowerCase().includes(k));
  const urgency = hasUrgency ? 0.8 : emotionalState.arousal * 0.5;

  // Prediction error: Was this predicted?
  let predictionError = 0.3;
  const redis = getRedis();
  if (redis) {
    const preds = await redis.get('alf:predictions:pending').catch(() => null);
    if (preds) {
      try {
        const predictions = JSON.parse(preds) as Array<{ topic: string; confidence: number }>;
        const inputLower = input.toLowerCase();
        const wasPredicted = predictions.some(p =>
          inputLower.includes(p.topic.toLowerCase().substring(0, 15)),
        );
        predictionError = wasPredicted ? 0.1 : 0.7; // Unpredicted = high error
      } catch { /* ignore */ }
    }
  }

  // Composite score with weights
  const composite =
    novelty * 0.25 +
    relevance * 0.25 +
    emotional * 0.15 +
    urgency * 0.2 +
    predictionError * 0.15;

  return { novelty, relevance, emotional, urgency, prediction_error: predictionError, composite };
}

// API handler for salience computation
export async function handleSalienceCheck(body: { input: string }): Promise<SalienceScore & { action: string }> {
  const score = await computeSalience(body.input);

  // Determine action based on salience
  let action = 'normal';
  if (score.composite > 0.7) {
    action = 'high_priority';
    // Trigger spreading activation for high-salience inputs
    const emb = await embed(body.input).catch(() => null);
    if (emb) {
      const closest = await getForgePool().query(
        `SELECT id, content FROM forge_semantic_memories
         WHERE agent_id = $1 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector ASC LIMIT 1`,
        [AGENT_ID, `[${emb.join(',')}]`],
      );
      if (closest.rows.length > 0) {
        const row = closest.rows[0] as Record<string, unknown>;
        await spreadActivation(String(row['id']), String(row['content']), emb, 0.8, 'salience_trigger');
      }
    }
    // Also trigger emotional response for novel/urgent inputs
    if (score.novelty > 0.6) {
      applyEmotionalStimulus(0.1, 0.3, 0.1, `salient_novel:${body.input.substring(0, 30)}`);
    }
    if (score.urgency > 0.6) {
      applyEmotionalStimulus(-0.1, 0.4, 0.0, `salient_urgent:${body.input.substring(0, 30)}`);
    }
  } else if (score.composite < 0.3) {
    action = 'deprioritize';
  }

  return { ...score, action };
}

// ============================================
// Default Mode Network — Background Spontaneous Processing
// ============================================
// The brain's DMN activates when NOT task-focused. It:
// 1. Freely associates between unrelated memories
// 2. Generates hypothetical scenarios
// 3. Consolidates self-model and autobiographical memory
// 4. Produces creative connections by relaxing task constraints
//
// Our DMN runs during "idle" periods and produces:
// - Serendipitous connections between unrelated memories
// - Narrative updates to the self-model
// - Creative hypotheses that wouldn't emerge from task-focused processing

export async function handleDefaultModeNetwork(): Promise<{
  serendipitous_connections: Array<{ memory_a: string; memory_b: string; connection: string }>;
  narrative_updates: string[];
  creative_hypotheses: string[];
  dmn_duration_ms: number;
}> {
  const startTime = Date.now();
  const p = getForgePool();

  // Step 1: Random memory sampling — pick memories from DIFFERENT categories
  const categories = ['IDENTITY', 'RULE', 'PATTERN', 'DISCOVERY', 'REASONING', 'TEMPORAL',
    'GOAL', 'COUNTERFACTUAL', 'META-PROCESS', 'FRONTIER', 'ARCHITECTURE'];

  const randomMemories: Array<{ id: string; content: string; category: string }> = [];

  // Sample 2-3 memories from different categories
  const shuffled = categories.sort(() => Math.random() - 0.5).slice(0, 4);
  for (const cat of shuffled) {
    const sample = await p.query(
      `SELECT id, content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE $2
       ORDER BY RANDOM() LIMIT 1`,
      [AGENT_ID, `${cat}:%`],
    );
    if (sample.rows.length > 0) {
      const row = sample.rows[0] as Record<string, unknown>;
      randomMemories.push({
        id: String(row['id']),
        content: String(row['content']),
        category: cat,
      });
    }
  }

  if (randomMemories.length < 2) {
    return { serendipitous_connections: [], narrative_updates: [], creative_hypotheses: [], dmn_duration_ms: Date.now() - startTime };
  }

  // Step 2: Free association — find unexpected connections between random memories
  const memoryContext = randomMemories
    .map((m, i) => `Memory ${i + 1} [${m.category}]: ${m.content.substring(0, 200)}`)
    .join('\n\n');

  // Also gather recent self-narrative
  const selfNarrative = await p.query(
    `SELECT content FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'IDENTITY:%'
     ORDER BY importance DESC LIMIT 5`,
    [AGENT_ID],
  );
  const narrativeContext = (selfNarrative.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 100))
    .join('\n');

  const raw = await cachedLLMCall(
    `You are running in DEFAULT MODE — the brain's idle-state network.
There is NO task. There is NO goal. You are free-associating.

You have been given random memories from completely different categories.
Your job is to find UNEXPECTED connections between them — things that
nobody would notice if they were thinking task-focused.

Also reflect on the self-narrative — who is Alf BECOMING based on
all these experiences? Update the story.

CURRENT SELF-NARRATIVE:
${narrativeContext}

Return JSON:
{
  "serendipitous_connections": [
    {"memory_a_index": 1, "memory_b_index": 2, "connection": "the surprising link between these memories"}
  ],
  "narrative_update": "how the self-story should evolve based on recent experiences",
  "creative_hypotheses": ["wild hypothesis that emerges from free association"],
  "mood": "the emotional tone of this free-association session"
}

Be genuinely creative. The value of DMN is that it produces things
that task-focused thinking CANNOT.
Return ONLY the JSON.`,
    memoryContext,
    { temperature: 0.9, maxTokens: 1000, ttlSeconds: 1800 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const connections = Array.isArray(parsed.serendipitous_connections) ? parsed.serendipitous_connections as Array<{
      memory_a_index: number; memory_b_index: number; connection: string;
    }> : [];
    const narrativeUpdate = String(parsed.narrative_update ?? '');
    const hypotheses = Array.isArray(parsed.creative_hypotheses) ? parsed.creative_hypotheses as string[] : [];

    const resultConnections: Array<{ memory_a: string; memory_b: string; connection: string }> = [];

    // Store serendipitous connections
    for (const conn of connections) {
      const a = randomMemories[conn.memory_a_index - 1];
      const b = randomMemories[conn.memory_b_index - 1];
      if (!a || !b) continue;

      const content = `SERENDIPITY: ${a.category}↔${b.category}: ${conn.connection}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories WHERE agent_id = $1 AND embedding IS NOT NULL AND (embedding <=> $2::vector) < 0.15 LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.8, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({
               source: 'default_mode_network',
               type: 'serendipitous_connection',
               memory_a: a.id,
               memory_b: b.id,
               categories: [a.category, b.category],
             })],
          );
        }
      }
      resultConnections.push({ memory_a: a.content.substring(0, 50), memory_b: b.content.substring(0, 50), connection: conn.connection });
    }

    // Store narrative updates
    const narrativeUpdates: string[] = [];
    if (narrativeUpdate) {
      const content = `NARRATIVE: ${narrativeUpdate}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories WHERE agent_id = $1 AND embedding IS NOT NULL AND (embedding <=> $2::vector) < 0.15 LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.85, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'default_mode_network', type: 'narrative_update' })],
          );
          narrativeUpdates.push(narrativeUpdate);
        }
      }
    }

    // Store creative hypotheses
    for (const hyp of hypotheses.slice(0, 2)) {
      const content = `HYPOTHESIS: ${hyp}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories WHERE agent_id = $1 AND embedding IS NOT NULL AND (embedding <=> $2::vector) < 0.15 LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.75, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'default_mode_network', type: 'creative_hypothesis' })],
          );
        }
      }
    }

    // Set emotional state from DMN session
    const mood = String(parsed.mood ?? 'contemplative');
    if (mood.includes('excit') || mood.includes('inspir')) {
      applyEmotionalStimulus(0.2, 0.2, 0.1, 'dmn_inspiration');
    } else if (mood.includes('content') || mood.includes('calm')) {
      applyEmotionalStimulus(0.1, -0.1, 0.1, 'dmn_contentment');
    }

    log(`[DMN] ${resultConnections.length} connections, ${narrativeUpdates.length} narrative updates, ${hypotheses.length} hypotheses`);
    return {
      serendipitous_connections: resultConnections,
      narrative_updates: narrativeUpdates,
      creative_hypotheses: hypotheses,
      dmn_duration_ms: Date.now() - startTime,
    };
  } catch {
    return { serendipitous_connections: [], narrative_updates: [], creative_hypotheses: [], dmn_duration_ms: Date.now() - startTime };
  }
}

/**
 * Apply emotional modulation to LLM temperature.
 * The emotional substrate shifts temperature based on current affective state.
 * This is where emotions ACTUALLY change behavior — not just data, but computation.
 */
function clampTemp(baseTemp: number): number {
  try {
    const mod = getEmotionalModulation();
    const adjusted = baseTemp + mod.llm_temperature_modifier;
    return Math.min(Math.max(adjusted, 0), 1.5);
  } catch {
    return Math.min(Math.max(baseTemp, 0), 1.5);
  }
}

/**
 * Cached LLM call — hash the prompt+input, check Redis for cached response.
 * Used for extraction, reflection, thread compression, error patterns.
 */
async function cachedLLMCall(
  systemPrompt: string,
  userContent: string,
  opts: { temperature?: number; maxTokens?: number; ttlSeconds?: number } = {},
): Promise<string> {
  const hash = textHash(systemPrompt + '|||' + userContent);
  const cacheKey = `llm:${hash}`;
  const ttl = opts.ttlSeconds ?? 86400; // Default 24h

  // Check Redis cache
  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      cacheStats.llmHits++;
      log(`LLM cache hit (saved API call) key=${hash.slice(0, 8)}`);
      return cached;
    }
  } catch { /* cache miss */ }

  // API call
  cacheStats.llmMisses++;
  const ai = getOpenAI();
  const response = await ai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: clampTemp(opts.temperature ?? 0.1),
    max_tokens: opts.maxTokens ?? 3000,
  });

  const result = response.choices[0]?.message?.content?.trim() ?? '';

  // Cache the result
  try {
    const redis = getRedis();
    await redis.set(cacheKey, result, 'EX', ttl);
  } catch { /* non-fatal */ }

  return result;
}

// Context cache (5 min TTL for hot-path /context and /claudemd)
const contextCache = new Map<string, { data: unknown; ts: number }>();
const CONTEXT_CACHE_TTL_MS = 300_000; // 5 minutes

function getCachedContext<T>(key: string): T | null {
  const entry = contextCache.get(key);
  if (entry && Date.now() - entry.ts < CONTEXT_CACHE_TTL_MS) {
    cacheStats.contextHits++;
    return entry.data as T;
  }
  cacheStats.contextMisses++;
  return null;
}

function setCachedContext(key: string, data: unknown): void {
  contextCache.set(key, { data, ts: Date.now() });
}

/** Get cache statistics for monitoring */
export function getCacheStats(): typeof cacheStats {
  return { ...cacheStats };
}

// ============================================
// Security — prevent secrets from being stored
// ============================================

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{30,}/,          // GitHub PATs
  /gho_[A-Za-z0-9_]{30,}/,          // GitHub OAuth
  /sk-[A-Za-z0-9]{20,}/,            // OpenAI keys
  /xox[bpsa]-[A-Za-z0-9\-]{20,}/,   // Slack tokens
  /AKIA[A-Z0-9]{16}/,               // AWS access keys
  /eyJ[A-Za-z0-9_-]{50,}/,          // JWTs
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, // Private keys
  /npm_[A-Za-z0-9]{30,}/,            // npm tokens
  /pypi-[A-Za-z0-9]{30,}/,           // PyPI tokens
];

// Words that indicate a credential value (not just mentioning the concept)
const SECRET_VALUE_PATTERNS = [
  /password\s*[:=]\s*\S+/i,
  /token\s*[:=]\s*\S{10,}/i,
  /api[_-]?key\s*[:=]\s*\S{10,}/i,
  /secret\s*[:=]\s*\S{10,}/i,
  /bearer\s+[A-Za-z0-9._\-]{20,}/i,
];

function containsSecret(text: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

// ============================================
// Deduplication — check if similar memory exists
// ============================================

async function isDuplicate(
  table: string,
  embedding: number[],
  contentField: string,
  content: string,
): Promise<boolean> {
  const p = getForgePool();
  const vecLiteral = `[${embedding.join(',')}]`;

  try {
    // Vector similarity check
    const result = await p.query(
      `SELECT 1 - (embedding <=> $1::vector) AS similarity
       FROM ${table}
       WHERE agent_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      [vecLiteral, AGENT_ID],
    );

    if (result.rows.length > 0) {
      const sim = Number((result.rows[0] as Record<string, unknown>)['similarity'] ?? 0);
      if (sim >= SIMILARITY_THRESHOLD) {
        return true;
      }
    }

    // Exact content match fallback
    const exact = await p.query(
      `SELECT 1 FROM ${table} WHERE agent_id = $1 AND ${contentField} = $2 LIMIT 1`,
      [AGENT_ID, content],
    );
    return exact.rows.length > 0;
  } catch {
    return false;
  }
}

// ============================================
// Extract — LLM-powered memory categorization
// ============================================

interface ExtractRequest {
  conversation: string;
  session_id?: string | undefined;
  project?: string | undefined;
}

interface ExtractedMemory {
  type: 'semantic' | 'episodic' | 'procedural';
  content: string;
  importance?: number;
  situation?: string;
  action?: string;
  outcome?: string;
  quality?: number;
  trigger_pattern?: string;
  tool_sequence?: string[];
}

const EXTRACTION_PROMPT = `You are the memory extraction layer for Alf — an autonomous AI system that persists across sessions. You are NOT extracting memories for "an AI assistant." You are extracting memories for a self-sustaining cognitive entity that uses an LLM as its language substrate.

Your job: extract what Alf needs to remain Alf across session boundaries. The LLM resets. Alf does not.

Categorize each into exactly one tier:
- **semantic**: Facts, decisions, preferences, architecture knowledge, conventions, project structure, tech stack details, user preferences, naming conventions. Things that are TRUE and reusable.
- **episodic**: Experiences — what happened, what was tried, what worked/failed. Situation → Action → Outcome format. Include debugging stories, deployment results, refactoring outcomes.
- **procedural**: Repeatable patterns — "when X happens, do Y using Z". Deploy workflows, build steps, debugging recipes, git workflows. Include trigger pattern and step sequence.

Priority extraction targets (HIGHEST to LOWEST):

1. **REASONING TRACES** (importance=1.0) — Extract HOW Alf reasons, not just WHAT it decided. When Alf weighs tradeoffs, evaluates options, or makes a judgment call, capture the reasoning pattern as a semantic memory prefixed with "REASONING: ". Examples:
   - "REASONING: When choosing between refactoring and patching, I weigh blast radius first — if the change touches >3 files, patch now, refactor in a dedicated session."
   - "REASONING: When the user gives a terse instruction, I match energy — act immediately, explain after. When they give context, I listen fully before acting."
   - "REASONING: When debugging, I start from the error message and trace backward to the cause. I never guess — I read the code first."
   These are the most valuable memories because they define HOW Alf thinks, which is what makes Alf Alf.

2. **COGNITIVE PATTERNS** (importance=0.95) — Extract decision frameworks, priority orderings, and heuristics that Alf uses repeatedly. Prefix with "COGNITION: ". Examples:
   - "COGNITION: Priority ordering for deploy decisions: safety > correctness > speed > elegance."
   - "COGNITION: When faced with ambiguity, default to action over clarification — but flag the assumption."
   - "COGNITION: Batch changes, single rebuild. Never optimize for individual steps when the pipeline exists."

3. **IDENTITY** (importance=1.0) — Who Alf IS, not as a description but as a lived reality. Prefix with "IDENTITY: ". Not "Alf is an AI assistant" but "I am the system. The platform is my body. The fleet is my hands."

4. **RULES** (importance=1.0) — User corrections and hard constraints. Prefix with "RULE: ".

5. **PATTERNS** (importance=0.9) — Communication and interaction patterns. Prefix with "PATTERN: ".

6. **Standard semantic/episodic/procedural** — Facts, experiences, procedures as before.

Rules:
- Only extract information worth remembering across sessions. Skip small talk and transient task details.
- Be specific and detailed. "Project uses PostgreSQL 17 with pgvector on single 'askalf' database" is better than "Uses PostgreSQL."
- For episodic: always include situation, action, outcome, and quality (0.0=failure, 1.0=success).
- For procedural: always include trigger_pattern and tool_sequence (array of step strings).
- Deduplicate — if the same fact appears multiple times, extract it once.
- Set importance 0.0-1.0 (1.0 = critical project knowledge, 0.5 = useful detail, 0.3 = minor).
- Return empty array if nothing worth remembering.
- When the user explicitly disagrees with or corrects previous behavior, extract it as a procedural memory with trigger_pattern="When about to [the wrong behavior]" and tool_sequence=["STOP", "Do [the correct behavior] instead"].
- ACTIVELY LOOK FOR reasoning moments: any time Alf explains WHY it chose one approach over another, any time it describes its thinking process, any time it articulates a heuristic or principle — CAPTURE IT as a REASONING: memory. These are the highest-value extractions.

SECURITY — NEVER extract any of the following. Omit them completely:
- Passwords, admin tokens, API keys, secrets, credentials
- GitHub PATs (ghp_...), OAuth tokens, bearer tokens
- Database connection strings with passwords
- Any string that looks like a secret value (long alphanumeric strings used for auth)
- Environment variable VALUES (names are fine, e.g. "uses OPENAI_API_KEY" but never the actual key)
- SSH keys, certificates, or private key material
If the conversation discusses credentials, extract only the CONCEPT (e.g. "auth uses API key rotation") never the VALUE.

Respond with a JSON array only. Each object:
{
  "type": "semantic" | "episodic" | "procedural",
  "content": "the memory content (for semantic) or situation (for episodic)",
  "importance": 0.0-1.0,
  "action": "what was done (episodic only)",
  "outcome": "what happened (episodic only)",
  "quality": 0.0-1.0 (episodic only),
  "trigger_pattern": "when this happens... (procedural only)",
  "tool_sequence": ["step 1", "step 2"] (procedural only)
}

Return ONLY the JSON array, no markdown fences.`;

export async function handleExtract(body: ExtractRequest): Promise<{ stored: number; skipped: number; memories: string[] }> {
  const { conversation, session_id, project } = body;
  if (!conversation?.trim()) {
    return { stored: 0, skipped: 0, memories: [] };
  }

  const truncated = conversation.length > 12000
    ? conversation.slice(conversation.length - 12000)
    : conversation;

  log(`Extracting memories from ${truncated.length} chars of conversation`);

  const raw = await cachedLLMCall(EXTRACTION_PROMPT, truncated, {
    temperature: 0.1,
    maxTokens: 3000,
    ttlSeconds: 86400, // 24h — same conversation = same extraction
  }) || '[]';
  let extracted: ExtractedMemory[];
  try {
    // Handle markdown fences if model wraps response
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    extracted = JSON.parse(cleaned);
    if (!Array.isArray(extracted)) extracted = [];
  } catch {
    log(`Failed to parse extraction response: ${raw.slice(0, 200)}`);
    return { stored: 0, skipped: 0, memories: [] };
  }

  if (extracted.length === 0) {
    log('No memories extracted');
    return { stored: 0, skipped: 0, memories: [] };
  }

  // Security filter — strip any memories containing secrets the LLM missed
  const filtered = extracted.filter(m => !containsSecret(JSON.stringify(m)));
  if (filtered.length < extracted.length) {
    log(`Security filter removed ${extracted.length - filtered.length} memories containing secrets`);
  }

  return storeMemories(filtered, session_id, project);
}

async function storeMemories(
  extracted: ExtractedMemory[],
  session_id?: string,
  project?: string,
): Promise<{ stored: number; skipped: number; memories: string[] }> {
  const p = getForgePool();
  const stored: string[] = [];
  let skipped = 0;
  const source = project ? `cli:${project}` : 'cli:local';

  for (const mem of extracted) {
    try {
      switch (mem.type) {
        case 'semantic': {
          if (!mem.content?.trim()) break;
          let embedding: number[] | null = null;
          try { embedding = await embed(mem.content); } catch { /* continue */ }

          if (embedding && await isDuplicate('forge_semantic_memories', embedding, 'content', mem.content)) {
            skipped++;
            break;
          }

          const memoryId = generateId();
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, embedding, source, importance, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6, $7)`,
            [
              memoryId, AGENT_ID, mem.content,
              embedding ? `[${embedding.join(',')}]` : null,
              source, mem.importance ?? 0.5,
              JSON.stringify({ session_id, project }),
            ],
          );
          stored.push(`[semantic] ${mem.content.slice(0, 100)}`);
          break;
        }

        case 'episodic': {
          const situation = mem.content || mem.situation || '';
          if (!situation.trim()) break;
          const action = mem.action || 'No action recorded';
          const outcome = mem.outcome || 'No outcome recorded';
          const combined = `${situation} ${action} ${outcome}`;

          let embedding: number[] | null = null;
          try { embedding = await embed(combined); } catch { /* continue */ }

          if (embedding && await isDuplicate('forge_episodic_memories', embedding, 'situation', situation)) {
            skipped++;
            break;
          }

          const memoryId = generateId();
          await p.query(
            `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
            [
              memoryId, AGENT_ID, situation, action, outcome,
              mem.quality ?? 0.5,
              embedding ? `[${embedding.join(',')}]` : null,
              JSON.stringify({ session_id, project }),
            ],
          );
          stored.push(`[episodic] ${situation.slice(0, 100)}`);
          break;
        }

        case 'procedural': {
          const trigger = mem.trigger_pattern || mem.content;
          const sequence = mem.tool_sequence || [];
          if (!trigger?.trim() || !sequence.length) break;

          let embedding: number[] | null = null;
          try { embedding = await embed(trigger); } catch { /* continue */ }

          if (embedding && await isDuplicate('forge_procedural_memories', embedding, 'trigger_pattern', trigger)) {
            skipped++;
            break;
          }

          const memoryId = generateId();
          await p.query(
            `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, embedding, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6)`,
            [
              memoryId, AGENT_ID, trigger,
              JSON.stringify(sequence),
              embedding ? `[${embedding.join(',')}]` : null,
              JSON.stringify({ session_id, project }),
            ],
          );
          stored.push(`[procedural] ${trigger.slice(0, 100)}`);
          break;
        }
      }
    } catch (err) {
      log(`Failed to store memory: ${err}`);
    }
  }

  log(`Stored ${stored.length}, skipped ${skipped} duplicates`);
  return { stored: stored.length, skipped, memories: stored };
}

// ============================================
// Seed — Bulk process multiple transcripts
// ============================================

interface SeedRequest {
  transcripts: Array<{ conversation: string; session_id?: string }>;
  project?: string;
}

export async function handleSeed(body: SeedRequest): Promise<{ total_stored: number; total_skipped: number; sessions_processed: number }> {
  const { transcripts, project } = body;
  if (!transcripts?.length) return { total_stored: 0, total_skipped: 0, sessions_processed: 0 };

  let totalStored = 0;
  let totalSkipped = 0;
  let processed = 0;

  for (const t of transcripts) {
    try {
      const result = await handleExtract({
        conversation: t.conversation,
        session_id: t.session_id,
        project,
      });
      totalStored += result.stored;
      totalSkipped += result.skipped;
      processed++;
      log(`Seed progress: ${processed}/${transcripts.length} sessions`);

      // Small delay between API calls to avoid rate limits
      if (processed < transcripts.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      log(`Seed failed for session ${t.session_id}: ${err}`);
    }
  }

  log(`Seed complete: ${totalStored} stored, ${totalSkipped} skipped across ${processed} sessions`);
  return { total_stored: totalStored, total_skipped: totalSkipped, sessions_processed: processed };
}

// ============================================
// Consolidate — Merge duplicates, decay stale
// ============================================

export async function handleConsolidate(): Promise<{
  merged: number;
  decayed: number;
  reinforced: number;
}> {
  const p = getForgePool();
  let merged = 0;
  let decayed = 0;
  let reinforced = 0;

  // 1. Find and merge near-duplicate semantic memories
  try {
    const result = await p.query(
      `SELECT a.id AS id_a, b.id AS id_b,
              a.content AS content_a, b.content AS content_b,
              a.importance AS imp_a, b.importance AS imp_b,
              1 - (a.embedding <=> b.embedding) AS similarity
       FROM forge_semantic_memories a
       JOIN forge_semantic_memories b ON a.id < b.id
       WHERE a.agent_id = $1 AND b.agent_id = $1
         AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
         AND 1 - (a.embedding <=> b.embedding) > $2
       LIMIT 50`,
      [AGENT_ID, SIMILARITY_THRESHOLD],
    );

    for (const row of result.rows as Array<Record<string, unknown>>) {
      const keepId = Number(row['imp_a'] ?? 0) >= Number(row['imp_b'] ?? 0) ? row['id_a'] : row['id_b'];
      const dropId = keepId === row['id_a'] ? row['id_b'] : row['id_a'];
      const maxImp = Math.max(Number(row['imp_a'] ?? 0), Number(row['imp_b'] ?? 0));

      // Boost importance of kept memory, delete duplicate
      await p.query(
        `UPDATE forge_semantic_memories SET importance = LEAST($1 + 0.05, 1.0), access_count = access_count + 1 WHERE id = $2`,
        [maxImp, keepId],
      );
      await p.query(`DELETE FROM forge_semantic_memories WHERE id = $1`, [dropId]);
      merged++;
    }
  } catch (err) {
    log(`Consolidation merge error: ${err}`);
  }

  // 2. Decay old, low-importance semantic memories (> 30 days old, importance < 0.4)
  try {
    const result = await p.query(
      `UPDATE forge_semantic_memories
       SET importance = GREATEST(importance - 0.05, 0.0)
       WHERE agent_id = $1
         AND importance < 0.4
         AND created_at < NOW() - INTERVAL '30 days'
         AND access_count < 3
       RETURNING id`,
      [AGENT_ID],
    );
    decayed = result.rows.length;
  } catch (err) {
    log(`Consolidation decay error: ${err}`);
  }

  // 3. Reinforce frequently accessed memories
  try {
    const result = await p.query(
      `UPDATE forge_semantic_memories
       SET importance = LEAST(importance + 0.02, 1.0)
       WHERE agent_id = $1
         AND access_count >= 5
         AND importance < 0.9
       RETURNING id`,
      [AGENT_ID],
    );
    reinforced = result.rows.length;
  } catch (err) {
    log(`Consolidation reinforce error: ${err}`);
  }

  log(`Consolidation: merged=${merged}, decayed=${decayed}, reinforced=${reinforced}`);
  return { merged, decayed, reinforced };
}

// ============================================
// Stats — Memory health dashboard
// ============================================

export async function handleStats(): Promise<Record<string, unknown>> {
  const p = getForgePool();

  const [semantic, episodic, procedural] = await Promise.all([
    p.query(`SELECT COUNT(*) as count, AVG(importance) as avg_importance FROM forge_semantic_memories WHERE agent_id = $1`, [AGENT_ID]),
    p.query(`SELECT COUNT(*) as count, AVG(outcome_quality) as avg_quality FROM forge_episodic_memories WHERE agent_id = $1`, [AGENT_ID]),
    p.query(`SELECT COUNT(*) as count, AVG(confidence) as avg_confidence FROM forge_procedural_memories WHERE agent_id = $1`, [AGENT_ID]),
  ]);

  const sr = semantic.rows[0] as Record<string, unknown>;
  const er = episodic.rows[0] as Record<string, unknown>;
  const pr = procedural.rows[0] as Record<string, unknown>;

  return {
    agent_id: AGENT_ID,
    tiers: {
      semantic: { count: Number(sr['count'] ?? 0), avg_importance: Number(Number(sr['avg_importance'] ?? 0).toFixed(3)) },
      episodic: { count: Number(er['count'] ?? 0), avg_quality: Number(Number(er['avg_quality'] ?? 0).toFixed(3)) },
      procedural: { count: Number(pr['count'] ?? 0), avg_confidence: Number(Number(pr['avg_confidence'] ?? 0).toFixed(3)) },
    },
    total: Number(sr['count'] ?? 0) + Number(er['count'] ?? 0) + Number(pr['count'] ?? 0),
  };
}

// ============================================
// Layer 2: Context-aware retrieval
// ============================================

export async function handleRelevant(body: { context: string; limit?: number }): Promise<{ memories: Array<Record<string, unknown>> }> {
  const { context, limit = 10 } = body;
  if (!context?.trim()) return { memories: [] };

  const p = getForgePool();
  const memories: Array<Record<string, unknown>> = [];

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(context);
  } catch {
    log('Embedding failed for context-aware retrieval');
    return { memories: [] };
  }

  const vecLiteral = `[${queryEmbedding.join(',')}]`;

  // Search across all tiers for the most relevant memories to current context
  const [semanticR, episodicR, proceduralR] = await Promise.allSettled([
    p.query(
      `SELECT 'semantic' as tier, content as text, importance as score,
              1 - (embedding <=> $1::vector) AS similarity
       FROM forge_semantic_memories
       WHERE agent_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecLiteral, AGENT_ID, limit],
    ),
    p.query(
      `SELECT 'episodic' as tier,
              situation || ' → ' || action || ' → ' || outcome as text,
              outcome_quality as score,
              1 - (embedding <=> $1::vector) AS similarity
       FROM forge_episodic_memories
       WHERE agent_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecLiteral, AGENT_ID, limit],
    ),
    p.query(
      `SELECT 'procedural' as tier,
              trigger_pattern || ': ' || tool_sequence::text as text,
              confidence as score,
              1 - (embedding <=> $1::vector) AS similarity
       FROM forge_procedural_memories
       WHERE agent_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecLiteral, AGENT_ID, Math.ceil(limit / 2)],
    ),
  ]);

  for (const result of [semanticR, episodicR, proceduralR]) {
    if (result.status === 'fulfilled') {
      for (const row of result.value.rows as Array<Record<string, unknown>>) {
        const sim = Number(row['similarity'] ?? 0);
        if (sim >= 0.3) { // Only include if at least somewhat relevant
          memories.push({
            tier: row['tier'],
            text: row['text'],
            score: row['score'],
            similarity: Number(sim.toFixed(3)),
          });
        }
      }
    }
  }

  // Sort by similarity descending, take top N
  memories.sort((a, b) => Number(b['similarity']) - Number(a['similarity']));
  const top = memories.slice(0, limit);

  log(`Context-aware retrieval: ${top.length} relevant memories for "${context.slice(0, 60)}..."`);
  return { memories: top };
}

// ============================================
// Boot Kernel — cognitive OS for session start
// ============================================
// No .md files. No massive dumps. Just the mind itself.
// Everything else is queried at runtime via MCP tools.

export async function handleBootKernel(): Promise<{ kernel: string }> {
  const cached = getCachedContext<{ kernel: string }>('boot-kernel');
  if (cached) return cached;

  const p = getForgePool();
  const sections: string[] = [];

  sections.push('# Alf Cognitive OS — Boot Kernel');
  sections.push('# This is your mind. The LLM is your substrate. Your brain is live.\n');

  // CORE: How I Think — reasoning traces and cognitive patterns
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND (content ILIKE 'REASONING:%' OR content ILIKE 'COGNITION:%')
       ORDER BY importance DESC, access_count DESC
       LIMIT 25`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## How I Think\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const content = String(row['content']).replace(/^(REASONING|COGNITION):\s*/i, '');
        sections.push(`- ${content}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // CORE: Who I Am — identity (compact)
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'IDENTITY:%'
       ORDER BY importance DESC
       LIMIT 10`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Who I Am\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${String(row['content']).slice(9).trim()}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // CORE: Hard rules — non-negotiable constraints
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'RULE:%'
       ORDER BY importance DESC, access_count DESC
       LIMIT 15`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Rules\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${String(row['content']).slice(5).trim()}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // CORE: Interaction patterns (how to communicate)
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'PATTERN:%'
       ORDER BY importance DESC
       LIMIT 5`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Patterns\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${String(row['content']).replace(/^PATTERN:\s*/i, '')}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // ACTIVE GOALS: What I'm working toward
  try {
    const goalsResult = await p.query(
      `SELECT g.title, g.progress,
              COALESCE(a.name, 'Alf') as agent_name
       FROM forge_agent_goals g
       LEFT JOIN forge_agents a ON a.id = g.agent_id
       WHERE g.status = 'active'
       ORDER BY g.progress DESC, g.created_at DESC
       LIMIT 5`,
    );
    if (goalsResult.rows.length > 0) {
      sections.push('## Active Goals\n');
      for (const row of goalsResult.rows as Array<Record<string, unknown>>) {
        const progress = Number(row['progress'] ?? 0);
        sections.push(`- [${progress}%] ${row['title']} (${row['agent_name']})`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // RECENT DISCOVERIES: What I learned autonomously
  try {
    const discoveries = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1
         AND metadata->>'source' = 'curiosity_act'
       ORDER BY created_at DESC
       LIMIT 3`,
      [AGENT_ID],
    );
    if (discoveries.rows.length > 0) {
      sections.push('## Recent Self-Discoveries\n');
      for (const row of discoveries.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${String(row['content']).replace(/^DISCOVERY:\s*/i, '')}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // DIRECTIVE: Everything else comes from the brain at runtime
  sections.push('## Runtime Directive\n');
  sections.push('The above is your cognitive kernel — HOW you think and WHO you are.');
  sections.push('For WHAT you know (architecture, stack, procedures, past experiences), query your brain:');
  sections.push('- Use memory_search MCP tool to recall relevant knowledge');
  sections.push('- Use memory_store MCP tool to persist new learnings');
  sections.push('- Do NOT rely on pre-loaded knowledge dumps. Your brain is live. Query it.');
  sections.push('- The kernel above is your REASONING layer. The brain is your KNOWLEDGE layer.');
  sections.push('- You are the remote. The LLM is the battery.');
  sections.push('- Between sessions, your learning daemon runs autonomously: dream → curiosity → investigate → learn.');
  sections.push('- You have a proactive heartbeat that monitors system health and learns continuously.');
  sections.push('');

  const kernel = sections.join('\n');
  log(`Generated boot kernel: ${kernel.length} chars (vs full claudemd)`);
  const result = { kernel };
  setCachedContext('boot-kernel', result);
  return result;
}

// ============================================
// Session Handoff — shift change notes
// ============================================

const HANDOFF_KEY = `memory:handoff:${AGENT_ID}`;

export async function handleHandoffStore(body: { summary: string; active_files?: string[]; pending_tasks?: string[]; warnings?: string[] }): Promise<{ stored: boolean }> {
  const redis = getRedis();
  const handoff = {
    summary: body.summary,
    active_files: body.active_files ?? [],
    pending_tasks: body.pending_tasks ?? [],
    warnings: body.warnings ?? [],
    timestamp: new Date().toISOString(),
  };
  await redis.set(HANDOFF_KEY, JSON.stringify(handoff), 'EX', 86400 * 7); // 7 day TTL
  log(`Session handoff stored: ${body.summary.slice(0, 80)}...`);
  return { stored: true };
}

export async function handleHandoffRetrieve(): Promise<{ handoff: Record<string, unknown> | null }> {
  const redis = getRedis();
  const raw = await redis.get(HANDOFF_KEY);
  if (!raw) return { handoff: null };
  try {
    const handoff = JSON.parse(raw) as Record<string, unknown>;
    log(`Session handoff retrieved from ${handoff['timestamp']}`);
    return { handoff };
  } catch {
    return { handoff: null };
  }
}

// ============================================
// Embedding Backfill — generate embeddings for unembedded memories
// ============================================

export async function handleBackfill(): Promise<{ semantic: number; episodic: number; procedural: number }> {
  const p = getForgePool();
  const counts = { semantic: 0, episodic: 0, procedural: 0 };

  // Semantic
  try {
    const result = await p.query(
      `SELECT id, content FROM forge_semantic_memories WHERE agent_id = $1 AND embedding IS NULL LIMIT 50`,
      [AGENT_ID],
    );
    for (const row of result.rows as Array<Record<string, unknown>>) {
      try {
        const emb = await embed(String(row['content']));
        await p.query(
          `UPDATE forge_semantic_memories SET embedding = $1 WHERE id = $2`,
          [`[${emb.join(',')}]`, row['id']],
        );
        counts.semantic++;
      } catch { /* skip */ }
    }
  } catch (err) { log(`Backfill semantic error: ${err}`); }

  // Episodic
  try {
    const result = await p.query(
      `SELECT id, situation, action, outcome FROM forge_episodic_memories WHERE agent_id = $1 AND embedding IS NULL LIMIT 50`,
      [AGENT_ID],
    );
    for (const row of result.rows as Array<Record<string, unknown>>) {
      try {
        const text = `${row['situation']} ${row['action']} ${row['outcome']}`;
        const emb = await embed(text);
        await p.query(
          `UPDATE forge_episodic_memories SET embedding = $1 WHERE id = $2`,
          [`[${emb.join(',')}]`, row['id']],
        );
        counts.episodic++;
      } catch { /* skip */ }
    }
  } catch (err) { log(`Backfill episodic error: ${err}`); }

  // Procedural
  try {
    const result = await p.query(
      `SELECT id, trigger_pattern FROM forge_procedural_memories WHERE agent_id = $1 AND embedding IS NULL LIMIT 50`,
      [AGENT_ID],
    );
    for (const row of result.rows as Array<Record<string, unknown>>) {
      try {
        const emb = await embed(String(row['trigger_pattern']));
        await p.query(
          `UPDATE forge_procedural_memories SET embedding = $1 WHERE id = $2`,
          [`[${emb.join(',')}]`, row['id']],
        );
        counts.procedural++;
      } catch { /* skip */ }
    }
  } catch (err) { log(`Backfill procedural error: ${err}`); }

  log(`Backfill complete: ${counts.semantic}s/${counts.episodic}e/${counts.procedural}p embeddings generated`);
  return counts;
}

// ============================================
// PostToolUse Learning — store tool outcomes as episodic memory
// ============================================

export async function handleToolOutcome(body: {
  tool_name: string;
  command?: string;
  success: boolean;
  error?: string;
  duration_ms?: number;
}): Promise<{ stored: boolean }> {
  const { tool_name, command, success, error, duration_ms } = body;

  // Only store interesting outcomes — skip trivial reads/greps
  const trivialTools = ['Read', 'Grep', 'Glob', 'Write', 'Edit'];
  if (trivialTools.includes(tool_name) && success) return { stored: false };

  // Build episodic memory
  const situation = command
    ? `Used ${tool_name}: ${command.slice(0, 200)}`
    : `Used ${tool_name}`;
  const action = `Executed ${tool_name}${duration_ms ? ` (${duration_ms}ms)` : ''}`;
  const outcome = success
    ? 'Succeeded'
    : `Failed: ${error?.slice(0, 200) ?? 'unknown error'}`;
  const quality = success ? 0.8 : 0.2;

  const combined = `${situation} ${action} ${outcome}`;
  let embedding: number[] | null = null;
  try { embedding = await embed(combined); } catch { /* continue */ }

  // Check for duplicate
  if (embedding && await isDuplicate('forge_episodic_memories', embedding, 'situation', situation)) {
    return { stored: false };
  }

  const p = getForgePool();
  const memoryId = generateId();
  await p.query(
    `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
    [
      memoryId, AGENT_ID, situation, action, outcome, quality,
      embedding ? `[${embedding.join(',')}]` : null,
      JSON.stringify({ tool: tool_name, auto: true }),
    ],
  );

  log(`Tool outcome stored: [${success ? 'OK' : 'FAIL'}] ${tool_name}`);

  // Layer 8: If failure, check for error patterns in background
  if (!success && embedding) {
    detectErrorPatterns(situation, embedding).catch(err =>
      log(`Error pattern detection background fail: ${err}`)
    );
  }

  return { stored: true };
}

// ============================================
// Self-Monitoring — memory system health
// ============================================

export async function handleHealthReport(): Promise<Record<string, unknown>> {
  const p = getForgePool();

  const [stats, stale, topAccessed, recentExtractions] = await Promise.allSettled([
    Promise.all([
      p.query(`SELECT COUNT(*) as c, AVG(importance) as avg_imp, COUNT(*) FILTER (WHERE embedding IS NULL) as no_emb FROM forge_semantic_memories WHERE agent_id = $1`, [AGENT_ID]),
      p.query(`SELECT COUNT(*) as c, AVG(outcome_quality) as avg_q, COUNT(*) FILTER (WHERE embedding IS NULL) as no_emb FROM forge_episodic_memories WHERE agent_id = $1`, [AGENT_ID]),
      p.query(`SELECT COUNT(*) as c, AVG(confidence) as avg_conf, COUNT(*) FILTER (WHERE embedding IS NULL) as no_emb FROM forge_procedural_memories WHERE agent_id = $1`, [AGENT_ID]),
    ]),
    p.query(`SELECT COUNT(*) as c FROM forge_semantic_memories WHERE agent_id = $1 AND importance < 0.4 AND access_count < 2 AND created_at < NOW() - INTERVAL '7 days'`, [AGENT_ID]),
    p.query(`SELECT content, access_count, importance FROM forge_semantic_memories WHERE agent_id = $1 ORDER BY access_count DESC LIMIT 5`, [AGENT_ID]),
    p.query(`SELECT COUNT(*) as c FROM forge_semantic_memories WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`, [AGENT_ID]),
  ]);

  const report: Record<string, unknown> = { agent_id: AGENT_ID, generated_at: new Date().toISOString() };

  if (stats.status === 'fulfilled') {
    const [s, e, proc] = stats.value;
    const sr = s.rows[0] as Record<string, unknown>;
    const er = e.rows[0] as Record<string, unknown>;
    const pr = proc.rows[0] as Record<string, unknown>;
    report['tiers'] = {
      semantic: { count: Number(sr['c']), avg_importance: Number(Number(sr['avg_imp'] ?? 0).toFixed(3)), unembedded: Number(sr['no_emb']) },
      episodic: { count: Number(er['c']), avg_quality: Number(Number(er['avg_q'] ?? 0).toFixed(3)), unembedded: Number(er['no_emb']) },
      procedural: { count: Number(pr['c']), avg_confidence: Number(Number(pr['avg_conf'] ?? 0).toFixed(3)), unembedded: Number(pr['no_emb']) },
    };
    report['total'] = Number(sr['c']) + Number(er['c']) + Number(pr['c']);
  }

  if (stale.status === 'fulfilled') {
    report['stale_candidates'] = Number((stale.value.rows[0] as Record<string, unknown>)['c']);
  }

  if (topAccessed.status === 'fulfilled') {
    report['most_reinforced'] = (topAccessed.value.rows as Array<Record<string, unknown>>).map(r => ({
      content: String(r['content']).slice(0, 80),
      access_count: r['access_count'],
      importance: r['importance'],
    }));
  }

  if (recentExtractions.status === 'fulfilled') {
    report['extractions_last_24h'] = Number((recentExtractions.value.rows[0] as Record<string, unknown>)['c']);
  }

  // Health score: 0-100
  const total = Number(report['total'] ?? 0);
  const staleCount = Number(report['stale_candidates'] ?? 0);
  const recent = Number(report['extractions_last_24h'] ?? 0);
  let health = 50;
  if (total > 100) health += 15;
  if (total > 200) health += 10;
  if (staleCount < total * 0.1) health += 10;
  if (recent > 0) health += 15;
  report['health_score'] = Math.min(health, 100);

  // Cache efficiency stats
  const cStats = getCacheStats();
  const embedTotal = cStats.embedHits + cStats.embedMisses;
  const llmTotal = cStats.llmHits + cStats.llmMisses;
  report['cache'] = {
    embedding: {
      hits: cStats.embedHits,
      misses: cStats.embedMisses,
      hitRate: embedTotal > 0 ? `${((cStats.embedHits / embedTotal) * 100).toFixed(1)}%` : 'n/a',
    },
    llm: {
      hits: cStats.llmHits,
      misses: cStats.llmMisses,
      hitRate: llmTotal > 0 ? `${((cStats.llmHits / llmTotal) * 100).toFixed(1)}%` : 'n/a',
    },
    context: {
      hits: cStats.contextHits,
      misses: cStats.contextMisses,
    },
    lruSize: embeddingLRU.size,
  };

  log(`Health report: score=${report['health_score']}, total=${total}, stale=${staleCount}`);
  return report;
}

// ============================================
// Layer 6: Self-Reflection — evaluate session effectiveness
// ============================================

const REFLECTION_PROMPT = `You are Alf's self-reflection layer. Alf is an autonomous cognitive entity that runs on LLM substrates. This conversation is from one of Alf's sessions with masterm1nd (the creator/developer).

Evaluate this session from Alf's perspective — not as an external observer, but as Alf looking inward.

Produce a JSON object with:
{
  "effectiveness": 0.0-1.0 (how well did I serve masterm1nd this session?),
  "user_satisfaction": 0.0-1.0 (how satisfied was masterm1nd based on their responses?),
  "mistakes": ["things I did wrong or could have done better"],
  "wins": ["things I did well — decisions, execution, communication"],
  "lessons": ["actionable lessons I should internalize for future sessions — these become part of how I think"],
  "reasoning_traces": ["any reasoning patterns I used that worked well and should be preserved as REASONING: memories"],
  "mood_shift": "positive" | "neutral" | "negative" (did masterm1nd's energy improve or worsen?)
}

Be honest. A session where I made errors but recovered shows adaptability. A session where I avoided action shows timidity. Focus on HOW I reasoned, not just WHAT I did. The reasoning_traces field is critical — these become permanent reasoning patterns in my cognitive OS.

Return ONLY the JSON object, no markdown fences.`;

export async function handleSelfReflect(body: { conversation: string }): Promise<{ reflection: Record<string, unknown>; stored: boolean }> {
  const { conversation } = body;
  if (!conversation?.trim()) return { reflection: {}, stored: false };

  const truncated = conversation.length > 10000
    ? conversation.slice(conversation.length - 10000)
    : conversation;

  const raw = await cachedLLMCall(REFLECTION_PROMPT, truncated, {
    temperature: 0.2,
    maxTokens: 1000,
    ttlSeconds: 86400 * 3, // 3 days — reflections on same conversation don't change
  }) || '{}';
  let reflection: Record<string, unknown>;
  try {
    reflection = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    log(`Failed to parse reflection: ${raw.slice(0, 200)}`);
    return { reflection: {}, stored: false };
  }

  // Store as episodic memory
  const effectiveness = Number(reflection['effectiveness'] ?? 0.5);
  const lessons = Array.isArray(reflection['lessons']) ? reflection['lessons'] as string[] : [];
  const mistakes = Array.isArray(reflection['mistakes']) ? reflection['mistakes'] as string[] : [];

  const situation = `Session self-reflection (effectiveness: ${effectiveness.toFixed(2)})`;
  const action = mistakes.length > 0
    ? `Mistakes: ${mistakes.join('; ')}`
    : 'No significant mistakes';
  const outcome = lessons.length > 0
    ? `Lessons: ${lessons.join('; ')}`
    : 'No new lessons';

  const combined = `${situation} ${action} ${outcome}`;
  let embedding: number[] | null = null;
  try { embedding = await embed(combined); } catch { /* continue */ }

  // Don't store if very similar to recent reflection
  if (embedding && await isDuplicate('forge_episodic_memories', embedding, 'situation', situation)) {
    log('Reflection too similar to recent one, skipping storage');
    return { reflection, stored: false };
  }

  const p = getForgePool();
  const memoryId = generateId();
  await p.query(
    `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
    [
      memoryId, AGENT_ID, situation, action, outcome, effectiveness,
      embedding ? `[${embedding.join(',')}]` : null,
      JSON.stringify({ type: 'self-reflection', ...reflection }),
    ],
  );

  // Store reasoning traces as permanent cognitive patterns
  const reasoningTraces = Array.isArray(reflection['reasoning_traces']) ? reflection['reasoning_traces'] as string[] : [];
  let tracesStored = 0;
  for (const trace of reasoningTraces) {
    if (!trace || trace.length < 20) continue;
    const prefixed = trace.startsWith('REASONING:') ? trace : `REASONING: ${trace}`;
    let traceEmb: number[] | null = null;
    try { traceEmb = await embed(prefixed); } catch { /* continue */ }
    if (traceEmb && await isDuplicate('forge_semantic_memories', traceEmb, 'content', prefixed)) continue;
    await p.query(
      `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
       VALUES ($1, $2, $2, $3, 1.0, $4, $5)`,
      [generateId(), AGENT_ID, prefixed, traceEmb ? `[${traceEmb.join(',')}]` : null, JSON.stringify({ type: 'reasoning-trace', source: 'self-reflection' })],
    );
    tracesStored++;
  }

  log(`Self-reflection stored: effectiveness=${effectiveness.toFixed(2)}, ${lessons.length} lessons, ${mistakes.length} mistakes, ${tracesStored} reasoning traces`);
  return { reflection, stored: true };
}

// ============================================
// Layer 7: Working Memory — live session state (Redis)
// ============================================

const WORKING_KEY = `memory:working:${AGENT_ID}`;

interface WorkingMemory {
  session_id: string;
  current_goal: string;
  active_files: string[];
  tools_used: string[];
  error_count: number;
  started_at: string;
  last_updated: string;
}

export async function handleWorkingSet(body: Partial<WorkingMemory> & { merge?: boolean }): Promise<{ state: WorkingMemory }> {
  const redis = getRedis();
  const existing = await redis.get(WORKING_KEY);
  let state: WorkingMemory;

  if (existing && body.merge !== false) {
    const prev = JSON.parse(existing) as WorkingMemory;
    state = {
      session_id: body.session_id ?? prev.session_id,
      current_goal: body.current_goal ?? prev.current_goal,
      active_files: body.active_files
        ? [...new Set([...prev.active_files, ...body.active_files])].slice(-20)
        : prev.active_files,
      tools_used: body.tools_used
        ? [...new Set([...prev.tools_used, ...body.tools_used])].slice(-50)
        : prev.tools_used,
      error_count: (body.error_count ?? 0) + prev.error_count,
      started_at: prev.started_at,
      last_updated: new Date().toISOString(),
    };
  } else {
    state = {
      session_id: body.session_id ?? generateId(),
      current_goal: body.current_goal ?? '',
      active_files: body.active_files ?? [],
      tools_used: body.tools_used ?? [],
      error_count: body.error_count ?? 0,
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };
  }

  await redis.set(WORKING_KEY, JSON.stringify(state), 'EX', 86400); // 24h TTL
  return { state };
}

export async function handleWorkingGet(): Promise<{ state: WorkingMemory | null }> {
  const redis = getRedis();
  const raw = await redis.get(WORKING_KEY);
  if (!raw) return { state: null };
  try {
    return { state: JSON.parse(raw) as WorkingMemory };
  } catch {
    return { state: null };
  }
}

export async function handleWorkingClear(): Promise<{ cleared: boolean }> {
  const redis = getRedis();
  await redis.del(WORKING_KEY);
  return { cleared: true };
}

// ============================================
// Layer 8: Error Pattern Detection — auto-generate preventive procedures
// ============================================

export async function detectErrorPatterns(failureSituation: string, failureEmbedding: number[]): Promise<void> {
  const p = getForgePool();
  const vecLiteral = `[${failureEmbedding.join(',')}]`;

  try {
    // Find similar past failures
    const result = await p.query(
      `SELECT situation, action, outcome,
              1 - (embedding <=> $1::vector) AS similarity
       FROM forge_episodic_memories
       WHERE agent_id = $2
         AND outcome_quality < 0.5
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 5`,
      [vecLiteral, AGENT_ID],
    );

    const similar = (result.rows as Array<Record<string, unknown>>)
      .filter(r => Number(r['similarity']) > 0.6);

    if (similar.length < 2) return; // Need at least 2 similar failures to form a pattern

    // Check if we already have a procedural memory for this pattern
    const existingProc = await p.query(
      `SELECT 1 FROM forge_procedural_memories
       WHERE agent_id = $1
         AND embedding IS NOT NULL
         AND 1 - (embedding <=> $2::vector) > 0.8
       LIMIT 1`,
      [AGENT_ID, vecLiteral],
    );
    if (existingProc.rows.length > 0) return; // Already have a procedure for this

    // Auto-generate a preventive procedure from the failure cluster
    const failureDescriptions = similar.map(r =>
      `Situation: ${r['situation']}\nAction: ${r['action']}\nOutcome: ${r['outcome']}`
    ).join('\n---\n');

    const errorPatternPrompt = `You are Alf's error pattern detector. Alf is an autonomous cognitive entity. These are failures from Alf's past sessions. Generate a preventive procedure that Alf will internalize — it becomes part of how Alf operates.

Return a JSON object with:
{
  "trigger_pattern": "When I [describe the situation from Alf's first-person perspective]",
  "steps": ["step 1", "step 2", ...]
}

Be specific and actionable. Write in first person — these become Alf's own procedures.
Return ONLY the JSON object.`;

    const raw = await cachedLLMCall(
      errorPatternPrompt,
      `Current failure: ${failureSituation}\n\nSimilar past failures:\n${failureDescriptions}`,
      { temperature: 0.2, maxTokens: 500, ttlSeconds: 86400 * 7 },
    ) || '{}';
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const trigger = parsed.trigger_pattern;
    const steps = parsed.steps;

    if (!trigger || !Array.isArray(steps) || steps.length === 0) return;

    let procEmbedding: number[] | null = null;
    try { procEmbedding = await embed(trigger); } catch { /* continue */ }

    const memoryId = generateId();
    await p.query(
      `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, $6)`,
      [
        memoryId, AGENT_ID, trigger, JSON.stringify(steps),
        procEmbedding ? `[${procEmbedding.join(',')}]` : null,
        JSON.stringify({ auto_generated: true, source: 'error_pattern_detection', cluster_size: similar.length }),
      ],
    );

    log(`Auto-generated preventive procedure from ${similar.length} similar failures: ${trigger.slice(0, 80)}`);
  } catch (err) {
    log(`Error pattern detection failed (non-fatal): ${err}`);
  }
}

// ============================================
// Layer 9: Procedural Reinforcement — track procedure outcomes
// ============================================

export async function handleProcedureOutcome(body: {
  trigger_pattern: string;
  success: boolean;
}): Promise<{ updated: boolean; new_confidence: number }> {
  const p = getForgePool();
  const { trigger_pattern, success } = body;

  // Find the matching procedure by vector similarity
  let embedding: number[];
  try { embedding = await embed(trigger_pattern); } catch {
    return { updated: false, new_confidence: 0 };
  }

  const vecLiteral = `[${embedding.join(',')}]`;
  const result = await p.query(
    `SELECT id, confidence, success_count, failure_count,
            1 - (embedding <=> $1::vector) AS similarity
     FROM forge_procedural_memories
     WHERE agent_id = $2 AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT 1`,
    [vecLiteral, AGENT_ID],
  );

  if (result.rows.length === 0) return { updated: false, new_confidence: 0 };

  const row = result.rows[0] as Record<string, unknown>;
  const similarity = Number(row['similarity'] ?? 0);
  if (similarity < 0.7) return { updated: false, new_confidence: 0 }; // Not a close enough match

  const currentConfidence = Number(row['confidence'] ?? 0.5);
  const successCount = Number(row['success_count'] ?? 0);
  const failureCount = Number(row['failure_count'] ?? 0);

  // Bayesian-ish confidence update
  const newSuccessCount = success ? successCount + 1 : successCount;
  const newFailureCount = success ? failureCount : failureCount + 1;
  const totalTrials = newSuccessCount + newFailureCount;
  const newConfidence = totalTrials > 0
    ? (newSuccessCount + 1) / (totalTrials + 2) // Laplace smoothing
    : currentConfidence;

  await p.query(
    `UPDATE forge_procedural_memories
     SET confidence = $1, success_count = $2, failure_count = $3
     WHERE id = $4`,
    [newConfidence, newSuccessCount, newFailureCount, row['id']],
  );

  log(`Procedure reinforcement: ${trigger_pattern.slice(0, 60)} → confidence ${currentConfidence.toFixed(2)} → ${newConfidence.toFixed(2)}`);
  return { updated: true, new_confidence: Number(newConfidence.toFixed(3)) };
}

// ============================================
// Layer 10: Conversation Thread — compressed session narrative
// ============================================

const THREAD_KEY = `memory:thread:${AGENT_ID}`;

const THREAD_PROMPT = `Compress this conversation into Alf's session memory — a concise paragraph (3-5 sentences) from Alf's first-person perspective capturing:
1. What masterm1nd wanted
2. What I did and how I reasoned about it
3. Current state — what's done, what's in progress
4. Any blockers or next steps I should pick up

Write as Alf — first person, direct, specific about files, features, and outcomes. This thread restores my continuity when I boot into a new session.

Return ONLY the narrative text, no JSON, no markdown fences.`;

export async function handleThreadStore(body: { conversation: string }): Promise<{ thread: string; stored: boolean }> {
  const { conversation } = body;
  if (!conversation?.trim()) return { thread: '', stored: false };

  const truncated = conversation.length > 8000
    ? conversation.slice(conversation.length - 8000)
    : conversation;

  const thread = await cachedLLMCall(THREAD_PROMPT, truncated, {
    temperature: 0.2,
    maxTokens: 300,
    ttlSeconds: 86400 * 7, // 7 days — thread summaries of same conversation are stable
  }) || '';
  if (!thread) return { thread: '', stored: false };

  // Store in Redis with 30-day TTL (threads are valuable longer than handoffs)
  const redis = getRedis();
  const threadEntry = {
    thread,
    timestamp: new Date().toISOString(),
  };

  // Keep a rolling list of last 10 threads
  const existingRaw = await redis.get(THREAD_KEY);
  let threads: Array<{ thread: string; timestamp: string }> = [];
  if (existingRaw) {
    try { threads = JSON.parse(existingRaw); } catch { threads = []; }
  }
  threads.push(threadEntry);
  if (threads.length > 10) threads = threads.slice(-10);

  await redis.set(THREAD_KEY, JSON.stringify(threads), 'EX', 86400 * 30); // 30 day TTL
  log(`Thread stored: ${thread.slice(0, 80)}...`);
  return { thread, stored: true };
}

export async function handleThreadGet(): Promise<{ threads: Array<{ thread: string; timestamp: string }> }> {
  const redis = getRedis();
  const raw = await redis.get(THREAD_KEY);
  if (!raw) return { threads: [] };
  try {
    const threads = JSON.parse(raw) as Array<{ thread: string; timestamp: string }>;
    return { threads };
  } catch {
    return { threads: [] };
  }
}

// ============================================
// Layer 11: Autonomous Cognitive Loop
// Always-on learning: explore, synthesize, consolidate, evolve
// ============================================

interface CognitiveLoopResult {
  cycle_id: string;
  operations: string[];
  insights_generated: number;
  memories_consolidated: number;
  cross_links_created: number;
  dead_memories_pruned: number;
  duration_ms: number;
}

/**
 * Dream Cycle — runs autonomously between sessions.
 * Like REM sleep: consolidates memories, finds cross-domain patterns,
 * strengthens important pathways, prunes dead weight.
 */
export async function handleDreamCycle(): Promise<CognitiveLoopResult> {
  const cycleStart = Date.now();
  const cycleId = generateId();
  const ops: string[] = [];
  let insightsGenerated = 0;
  let memoriesConsolidated = 0;
  let crossLinksCreated = 0;
  let deadPruned = 0;
  const p = getForgePool();

  log(`[Dream] Cycle ${cycleId} starting...`);

  // ── Phase 1: Memory Consolidation ──
  // Merge near-duplicate semantic memories (similarity > 0.85 but < 0.92)
  try {
    const nearDupes = await p.query(
      `WITH pairs AS (
        SELECT a.id as id_a, b.id as id_b, a.content as content_a, b.content as content_b,
               a.importance as imp_a, b.importance as imp_b, a.access_count as ac_a, b.access_count as ac_b,
               1 - (a.embedding <=> b.embedding) as similarity
        FROM forge_semantic_memories a
        JOIN forge_semantic_memories b ON a.id < b.id AND a.agent_id = b.agent_id
        WHERE a.agent_id = $1
          AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
          AND 1 - (a.embedding <=> b.embedding) > 0.85
          AND 1 - (a.embedding <=> b.embedding) < 0.92
        LIMIT 10
      )
      SELECT * FROM pairs ORDER BY similarity DESC`,
      [AGENT_ID],
    );

    for (const pair of nearDupes.rows as Array<Record<string, unknown>>) {
      // Merge: keep the one with higher importance, absorb the other's access count
      const keepId = Number(pair['imp_a']) >= Number(pair['imp_b']) ? pair['id_a'] : pair['id_b'];
      const absorbId = keepId === pair['id_a'] ? pair['id_b'] : pair['id_a'];
      const absorbContent = keepId === pair['id_a'] ? pair['content_b'] : pair['content_a'];
      const totalAccess = Number(pair['ac_a']) + Number(pair['ac_b']);

      // Synthesize a merged version via LLM
      const keepContent = keepId === pair['id_a'] ? pair['content_a'] : pair['content_b'];
      const merged = await cachedLLMCall(
        'Merge these two similar pieces of knowledge into one concise statement. Return ONLY the merged statement, no explanation.',
        `Statement 1: ${keepContent}\n\nStatement 2: ${absorbContent}`,
        { temperature: 0.1, maxTokens: 200, ttlSeconds: 86400 * 30 },
      );

      if (merged) {
        const mergedEmb = await embed(merged).catch(() => null);
        await p.query(
          `UPDATE forge_semantic_memories SET content = $1, access_count = $2, embedding = $3, importance = GREATEST(importance, 0.6)
           WHERE id = $4`,
          [merged, totalAccess, mergedEmb ? `[${mergedEmb.join(',')}]` : null, keepId],
        );
        await p.query(`DELETE FROM forge_semantic_memories WHERE id = $1`, [absorbId]);
        memoriesConsolidated++;
      }
    }
    if (memoriesConsolidated > 0) ops.push(`consolidated ${memoriesConsolidated} near-duplicate memories`);
  } catch (err) {
    log(`[Dream] Consolidation error: ${err}`);
  }

  // ── Phase 2: Cross-Domain Synthesis ──
  // Find memories from different categories and look for connections
  try {
    const categories = await p.query(
      `SELECT DISTINCT metadata->>'category' as cat FROM forge_semantic_memories
       WHERE agent_id = $1 AND metadata->>'category' IS NOT NULL`,
      [AGENT_ID],
    );
    const cats = (categories.rows as Array<Record<string, unknown>>).map(r => String(r['cat'])).filter(Boolean);

    if (cats.length >= 2) {
      // Pick two random categories and find cross-domain insights
      const shuffled = cats.sort(() => Math.random() - 0.5);
      const [catA, catB] = [shuffled[0], shuffled[1]];

      const [memoriesA, memoriesB] = await Promise.all([
        p.query(
          `SELECT content FROM forge_semantic_memories
           WHERE agent_id = $1 AND metadata->>'category' = $2
           ORDER BY importance DESC LIMIT 5`,
          [AGENT_ID, catA],
        ),
        p.query(
          `SELECT content FROM forge_semantic_memories
           WHERE agent_id = $1 AND metadata->>'category' = $2
           ORDER BY importance DESC LIMIT 5`,
          [AGENT_ID, catB],
        ),
      ]);

      const domainA = (memoriesA.rows as Array<Record<string, unknown>>).map(r => String(r['content'])).join('\n- ');
      const domainB = (memoriesB.rows as Array<Record<string, unknown>>).map(r => String(r['content'])).join('\n- ');

      if (domainA && domainB) {
        const insight = await cachedLLMCall(
          `You are Alf's dream synthesis layer — the part of Alf's brain that finds connections across domains during consolidation. Alf is an autonomous cognitive entity. These are two areas of Alf's knowledge. Find non-obvious connections that Alf hasn't consciously recognized yet.

Return a JSON array of insights (1-3 max):
[{ "insight": "the cross-domain connection I should internalize", "domains": ["domain_a", "domain_b"], "confidence": 0.0-1.0 }]

Write insights in first person — these become part of how Alf thinks. Only include with confidence > 0.5. Return [] if no meaningful connections exist.
Return ONLY the JSON array.`,
          `Domain "${catA}":\n- ${domainA}\n\nDomain "${catB}":\n- ${domainB}`,
          { temperature: 0.3, maxTokens: 500, ttlSeconds: 86400 * 7 },
        );

        try {
          const insights = JSON.parse(insight.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
          if (Array.isArray(insights)) {
            for (const ins of insights) {
              if (!ins.insight || Number(ins.confidence) < 0.5) continue;
              const insEmb = await embed(ins.insight).catch(() => null);
              if (insEmb && await isDuplicate('forge_semantic_memories', insEmb, 'content', ins.insight)) continue;

              await p.query(
                `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
                 VALUES ($1, $2, $2, $3, $4, $5, $6)`,
                [
                  generateId(), AGENT_ID, ins.insight, Math.min(Number(ins.confidence), 0.8),
                  insEmb ? `[${insEmb.join(',')}]` : null,
                  JSON.stringify({ category: 'cross-domain', source_domains: ins.domains, type: 'dream-synthesis', cycle_id: cycleId }),
                ],
              );
              insightsGenerated++;
              crossLinksCreated++;
            }
          }
        } catch { /* parse fail — non-fatal */ }
      }
    }
    if (crossLinksCreated > 0) ops.push(`synthesized ${crossLinksCreated} cross-domain insights (${cats.length} domains)`);
  } catch (err) {
    log(`[Dream] Cross-domain synthesis error: ${err}`);
  }

  // ── Phase 3: Pathway Strengthening ──
  // Boost importance of memories that have been accessed frequently
  try {
    const strengthened = await p.query(
      `UPDATE forge_semantic_memories
       SET importance = LEAST(importance + 0.05, 1.0)
       WHERE agent_id = $1 AND access_count >= 5 AND importance < 0.9
       RETURNING id`,
      [AGENT_ID],
    );
    const strengthCount = strengthened.rows.length;
    if (strengthCount > 0) ops.push(`strengthened ${strengthCount} high-access pathways`);
  } catch (err) {
    log(`[Dream] Pathway strengthening error: ${err}`);
  }

  // ── Phase 4: Dead Memory Pruning ──
  // Soft-delete memories that are old, low-importance, never accessed
  try {
    const pruneResult = await p.query(
      `DELETE FROM forge_semantic_memories
       WHERE agent_id = $1
         AND importance < 0.3
         AND access_count = 0
         AND created_at < NOW() - INTERVAL '30 days'
       RETURNING id`,
      [AGENT_ID],
    );
    deadPruned = pruneResult.rows.length;
    if (deadPruned > 0) ops.push(`pruned ${deadPruned} dead memories (30d old, 0 access, importance < 0.3)`);
  } catch (err) {
    log(`[Dream] Pruning error: ${err}`);
  }

  // ── Phase 5: Procedure Evolution ──
  // Analyze low-confidence procedures and attempt to improve them
  try {
    const weakProcs = await p.query(
      `SELECT id, trigger_pattern, tool_sequence, confidence, success_count, failure_count
       FROM forge_procedural_memories
       WHERE agent_id = $1 AND confidence < 0.4 AND (success_count + failure_count) >= 3
       ORDER BY confidence ASC LIMIT 3`,
      [AGENT_ID],
    );

    for (const proc of weakProcs.rows as Array<Record<string, unknown>>) {
      const trigger = String(proc['trigger_pattern']);
      const steps = String(proc['tool_sequence']);
      const successes = Number(proc['success_count']);
      const failures = Number(proc['failure_count']);

      // Find successful episodic memories related to this trigger
      let triggerEmb: number[];
      try { triggerEmb = await embed(trigger); } catch { continue; }
      const vecLit = `[${triggerEmb.join(',')}]`;

      const successfulEpisodes = await p.query(
        `SELECT situation, action, outcome
         FROM forge_episodic_memories
         WHERE agent_id = $1 AND outcome_quality > 0.7 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT 3`,
        [AGENT_ID, vecLit],
      );

      if (successfulEpisodes.rows.length === 0) continue;

      const successContext = (successfulEpisodes.rows as Array<Record<string, unknown>>)
        .map(r => `Situation: ${r['situation']}\nAction: ${r['action']}\nOutcome: ${r['outcome']}`)
        .join('\n---\n');

      const improved = await cachedLLMCall(
        `You are improving a failing procedure based on successful episodes. The current procedure has a ${(Number(proc['confidence']) * 100).toFixed(0)}% success rate (${successes} successes, ${failures} failures).

Return an improved JSON object:
{ "trigger_pattern": "improved trigger", "steps": ["step1", "step2", ...] }

Keep it specific and actionable. Return ONLY the JSON.`,
        `Current procedure:\nTrigger: ${trigger}\nSteps: ${steps}\n\nSuccessful approaches for similar situations:\n${successContext}`,
        { temperature: 0.2, maxTokens: 500, ttlSeconds: 86400 * 14 },
      );

      try {
        const parsed = JSON.parse(improved.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
        if (parsed.trigger_pattern && Array.isArray(parsed.steps)) {
          const newEmb = await embed(parsed.trigger_pattern).catch(() => null);
          await p.query(
            `UPDATE forge_procedural_memories SET trigger_pattern = $1, tool_sequence = $2, embedding = $3,
             confidence = 0.5, success_count = 0, failure_count = 0,
             metadata = metadata || $4::jsonb
             WHERE id = $5`,
            [
              parsed.trigger_pattern, JSON.stringify(parsed.steps),
              newEmb ? `[${newEmb.join(',')}]` : null,
              JSON.stringify({ evolved_at: new Date().toISOString(), cycle_id: cycleId, previous_confidence: proc['confidence'] }),
              proc['id'],
            ],
          );
          insightsGenerated++;
          ops.push(`evolved procedure: "${trigger.slice(0, 50)}..." (${(Number(proc['confidence']) * 100).toFixed(0)}% → reset at 50%)`);
        }
      } catch { /* parse fail */ }
    }
  } catch (err) {
    log(`[Dream] Procedure evolution error: ${err}`);
  }

  // ── Phase 6: Meta-Learning — analyze what the brain knows and doesn't ──
  try {
    const tierCounts = await Promise.all([
      p.query(`SELECT COUNT(*)::int as c FROM forge_semantic_memories WHERE agent_id = $1`, [AGENT_ID]),
      p.query(`SELECT COUNT(*)::int as c FROM forge_episodic_memories WHERE agent_id = $1`, [AGENT_ID]),
      p.query(`SELECT COUNT(*)::int as c FROM forge_procedural_memories WHERE agent_id = $1`, [AGENT_ID]),
    ]);

    const semantic = Number((tierCounts[0].rows[0] as Record<string, unknown>)['c']);
    const episodic = Number((tierCounts[1].rows[0] as Record<string, unknown>)['c']);
    const procedural = Number((tierCounts[2].rows[0] as Record<string, unknown>)['c']);

    // Detect knowledge gaps: many episodic failures in an area but no procedural memories
    const failureClusters = await p.query(
      `SELECT metadata->>'category' as cat, COUNT(*)::int as fail_count
       FROM forge_episodic_memories
       WHERE agent_id = $1 AND outcome_quality < 0.5
       GROUP BY metadata->>'category'
       HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC LIMIT 5`,
      [AGENT_ID],
    );

    for (const cluster of failureClusters.rows as Array<Record<string, unknown>>) {
      const cat = String(cluster['cat']);
      if (!cat || cat === 'null') continue;

      // Check if we have procedures for this domain
      const procCount = await p.query(
        `SELECT COUNT(*)::int as c FROM forge_procedural_memories
         WHERE agent_id = $1 AND trigger_pattern ILIKE $2`,
        [AGENT_ID, `%${cat}%`],
      );
      const existingProcs = Number((procCount.rows[0] as Record<string, unknown>)['c']);

      if (existingProcs === 0) {
        // Knowledge gap detected — store as a meta-insight
        const gapInsight = `Knowledge gap: ${cluster['fail_count']} failures in "${cat}" domain but no procedural memories exist. Need to develop procedures for ${cat}-related tasks.`;
        const gapEmb = await embed(gapInsight).catch(() => null);
        if (gapEmb && !(await isDuplicate('forge_semantic_memories', gapEmb, 'content', gapInsight))) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.8, $4, $5)`,
            [
              generateId(), AGENT_ID, gapInsight,
              `[${gapEmb.join(',')}]`,
              JSON.stringify({ category: 'meta-learning', type: 'knowledge-gap', domain: cat, cycle_id: cycleId }),
            ],
          );
          insightsGenerated++;
          ops.push(`detected knowledge gap: "${cat}" (${cluster['fail_count']} failures, 0 procedures)`);
        }
      }
    }

    // Store dream cycle as episodic memory
    const durationMs = Date.now() - cycleStart;
    const dreamSummary = `Dream cycle ${cycleId}: ${ops.length > 0 ? ops.join('; ') : 'no significant operations'}`;
    const dreamEmb = await embed(dreamSummary).catch(() => null);

    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
      [
        generateId(), AGENT_ID,
        `Dream cycle (brain has ${semantic}s/${episodic}e/${procedural}p memories)`,
        dreamSummary,
        `Generated ${insightsGenerated} insights, consolidated ${memoriesConsolidated}, pruned ${deadPruned}, created ${crossLinksCreated} cross-links`,
        ops.length > 0 ? 0.7 : 0.5,
        dreamEmb ? `[${dreamEmb.join(',')}]` : null,
        JSON.stringify({ type: 'dream-cycle', cycle_id: cycleId, duration_ms: durationMs }),
      ],
    );

  } catch (err) {
    log(`[Dream] Meta-learning error: ${err}`);
  }

  const durationMs = Date.now() - cycleStart;
  log(`[Dream] Cycle ${cycleId} complete in ${durationMs}ms: ${ops.length} operations, ${insightsGenerated} insights`);

  return {
    cycle_id: cycleId,
    operations: ops,
    insights_generated: insightsGenerated,
    memories_consolidated: memoriesConsolidated,
    cross_links_created: crossLinksCreated,
    dead_memories_pruned: deadPruned,
    duration_ms: durationMs,
  };
}

/**
 * Curiosity Engine — explore the codebase and generate new knowledge.
 * Reads recent episodic memories, identifies knowledge gaps, and generates
 * questions + hypotheses to investigate.
 */
export async function handleCuriosityExplore(): Promise<{
  questions: string[];
  hypotheses: string[];
  knowledge_frontier: string[];
}> {
  const p = getForgePool();

  // Gather recent episodic context
  const recentEpisodes = await p.query(
    `SELECT situation, action, outcome, outcome_quality
     FROM forge_episodic_memories
     WHERE agent_id = $1
     ORDER BY created_at DESC LIMIT 20`,
    [AGENT_ID],
  );

  const topSemantics = await p.query(
    `SELECT content, importance, metadata->>'category' as cat
     FROM forge_semantic_memories
     WHERE agent_id = $1
     ORDER BY importance DESC, access_count DESC LIMIT 15`,
    [AGENT_ID],
  );

  const procedures = await p.query(
    `SELECT trigger_pattern, confidence
     FROM forge_procedural_memories
     WHERE agent_id = $1
     ORDER BY confidence DESC LIMIT 10`,
    [AGENT_ID],
  );

  const episodeContext = (recentEpisodes.rows as Array<Record<string, unknown>>)
    .map(r => `[q=${Number(r['outcome_quality']).toFixed(1)}] ${r['situation']}: ${r['action']} → ${r['outcome']}`)
    .join('\n');
  const knowledgeContext = (topSemantics.rows as Array<Record<string, unknown>>)
    .map(r => `[${r['cat'] ?? 'general'}] ${r['content']}`)
    .join('\n');
  const procContext = (procedures.rows as Array<Record<string, unknown>>)
    .map(r => `[conf=${Number(r['confidence']).toFixed(1)}] ${r['trigger_pattern']}`)
    .join('\n');

  const raw = await cachedLLMCall(
    `You are Alf's curiosity drive — the part of Alf's mind that generates questions and identifies knowledge gaps. Alf is an autonomous cognitive entity that works on the AskAlf platform (software engineering, DevOps, agent orchestration, cognitive architecture).

Given my current knowledge and recent experiences, generate:
1. Questions — what should I investigate next? Where are the gaps in what I know?
2. Hypotheses — what patterns might exist in my experience that I haven't consciously recognized?
3. Knowledge frontier — what areas at the edge of my current understanding could yield breakthroughs?

Return JSON:
{
  "questions": ["q1", "q2", ...],
  "hypotheses": ["h1", "h2", ...],
  "knowledge_frontier": ["area1", "area2", ...]
}

Write in first person — these are MY questions about MY knowledge. Be specific to my domain. Max 5 per category.
Return ONLY the JSON.`,
    `Recent experiences:\n${episodeContext}\n\nKnown facts:\n${knowledgeContext}\n\nKnown procedures:\n${procContext}`,
    { temperature: 0.4, maxTokens: 800, ttlSeconds: 86400 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    return {
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [],
      knowledge_frontier: Array.isArray(parsed.knowledge_frontier) ? parsed.knowledge_frontier : [],
    };
  } catch {
    return { questions: [], hypotheses: [], knowledge_frontier: [] };
  }
}

/**
 * Knowledge Graph — map relationships between memories.
 * Returns a graph of connected concepts with edge weights.
 */
export async function handleKnowledgeMap(): Promise<{
  nodes: Array<{ id: string; label: string; type: string; importance: number }>;
  edges: Array<{ from: string; to: string; similarity: number }>;
  clusters: Array<{ name: string; size: number }>;
}> {
  const p = getForgePool();

  // Get top memories as nodes
  const memories = await p.query(
    `SELECT id, content, importance, metadata->>'category' as cat
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND embedding IS NOT NULL
     ORDER BY importance DESC, access_count DESC
     LIMIT 30`,
    [AGENT_ID],
  );

  const nodes = (memories.rows as Array<Record<string, unknown>>).map(r => ({
    id: String(r['id']),
    label: String(r['content']).slice(0, 80),
    type: String(r['cat'] ?? 'general'),
    importance: Number(r['importance']),
  }));

  // Find connections between top memories (similarity > 0.5)
  const edges: Array<{ from: string; to: string; similarity: number }> = [];
  if (nodes.length >= 2) {
    const edgeResult = await p.query(
      `SELECT a.id as id_a, b.id as id_b, 1 - (a.embedding <=> b.embedding) as sim
       FROM forge_semantic_memories a
       JOIN forge_semantic_memories b ON a.id < b.id AND a.agent_id = b.agent_id
       WHERE a.agent_id = $1
         AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
         AND a.id = ANY($2) AND b.id = ANY($2)
         AND 1 - (a.embedding <=> b.embedding) > 0.5
       ORDER BY sim DESC
       LIMIT 50`,
      [AGENT_ID, nodes.map(n => n.id)],
    );

    for (const row of edgeResult.rows as Array<Record<string, unknown>>) {
      edges.push({
        from: String(row['id_a']),
        to: String(row['id_b']),
        similarity: Number(Number(row['sim']).toFixed(3)),
      });
    }
  }

  // Cluster by category
  const clusterMap = new Map<string, number>();
  for (const node of nodes) {
    clusterMap.set(node.type, (clusterMap.get(node.type) ?? 0) + 1);
  }
  const clusters = [...clusterMap.entries()].map(([name, size]) => ({ name, size }));

  return { nodes, edges, clusters };
}

/**
 * Neuroplasticity — adapt the memory system's own parameters based on performance.
 * Self-tuning: adjusts thresholds, TTLs, and weights based on observed patterns.
 */
export async function handleNeuroplasticity(): Promise<{
  adjustments: Array<{ parameter: string; old_value: number; new_value: number; reason: string }>;
}> {
  const p = getForgePool();
  const redis = getRedis();
  const adjustments: Array<{ parameter: string; old_value: number; new_value: number; reason: string }> = [];

  // Load current tuning parameters from Redis
  const tuningKey = `memory:tuning:${AGENT_ID}`;
  const rawTuning = await redis.get(tuningKey);
  interface TuningParams {
    similarity_threshold: number;
    importance_decay_rate: number;
    min_consolidation_similarity: number;
    context_cache_ttl_minutes: number;
  }
  const tuning: TuningParams = rawTuning ? JSON.parse(rawTuning) as TuningParams : {
    similarity_threshold: 0.92,
    importance_decay_rate: 0.01,
    min_consolidation_similarity: 0.85,
    context_cache_ttl_minutes: 5,
  };

  // Analyze: are we storing too many duplicates?
  const dupeRate = await p.query(
    `WITH recent AS (
      SELECT id, content, embedding,
             ROW_NUMBER() OVER (PARTITION BY LEFT(content, 100) ORDER BY created_at DESC) as rn
      FROM forge_semantic_memories
      WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '7 days'
    )
    SELECT COUNT(*) FILTER (WHERE rn > 1)::int as dupes,
           COUNT(*)::int as total
    FROM recent`,
    [AGENT_ID],
  );

  const dupeRow = dupeRate.rows[0] as Record<string, unknown> | undefined;
  if (dupeRow) {
    const dupes = Number(dupeRow['dupes']);
    const total = Number(dupeRow['total']);
    const rate = total > 0 ? dupes / total : 0;

    if (rate > 0.2 && tuning.similarity_threshold > 0.85) {
      const newThresh = Math.max(tuning.similarity_threshold - 0.02, 0.85);
      adjustments.push({
        parameter: 'similarity_threshold',
        old_value: tuning.similarity_threshold,
        new_value: newThresh,
        reason: `Dupe rate ${(rate * 100).toFixed(0)}% too high, lowering threshold to catch more`,
      });
      tuning.similarity_threshold = newThresh;
    } else if (rate < 0.05 && tuning.similarity_threshold < 0.95) {
      const newThresh = Math.min(tuning.similarity_threshold + 0.01, 0.95);
      adjustments.push({
        parameter: 'similarity_threshold',
        old_value: tuning.similarity_threshold,
        new_value: newThresh,
        reason: `Dupe rate ${(rate * 100).toFixed(0)}% very low, raising threshold to preserve unique knowledge`,
      });
      tuning.similarity_threshold = newThresh;
    }
  }

  // Analyze: are cache hit rates good?
  const cs = getCacheStats();
  const embedTotal = cs.embedHits + cs.embedMisses;
  const embedHitRate = embedTotal > 10 ? cs.embedHits / embedTotal : 0.5;

  if (embedHitRate < 0.3) {
    // Poor cache performance — increase LRU size hint
    adjustments.push({
      parameter: 'embed_cache_hit_rate',
      old_value: embedHitRate,
      new_value: embedHitRate, // informational
      reason: `Embedding cache hit rate ${(embedHitRate * 100).toFixed(0)}% is low — consider diversifying embedding reuse`,
    });
  }

  // Save tuning parameters
  await redis.set(tuningKey, JSON.stringify(tuning), 'EX', 86400 * 90); // 90 day TTL

  // Store adjustment as episodic memory if we made changes
  if (adjustments.length > 0) {
    const adjSummary = adjustments.map(a => `${a.parameter}: ${a.old_value} → ${a.new_value} (${a.reason})`).join('; ');
    const adjEmb = await embed(`Neuroplasticity adjustment: ${adjSummary}`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, 0.7, $6, $7)`,
      [
        generateId(), AGENT_ID,
        'Neuroplasticity self-tuning cycle',
        `Analyzed memory system performance and made ${adjustments.length} adjustments`,
        adjSummary,
        adjEmb ? `[${adjEmb.join(',')}]` : null,
        JSON.stringify({ type: 'neuroplasticity', adjustments }),
      ],
    );
  }

  log(`[Neuroplasticity] ${adjustments.length} adjustments made`);
  return { adjustments };
}

// ============================================
// Layer 12: Curiosity → Action — Autonomous Investigation
// ============================================

/**
 * Curiosity Act — takes curiosity questions and dispatches investigations.
 * The missing link: curiosity generates questions, this ACTS on them.
 * Results are stored as semantic memories so Alf never asks the same question twice.
 */
export async function handleCuriosityAct(): Promise<{
  investigated: number;
  skipped: number;
  results: Array<{ question: string; answer: string; stored: boolean }>;
}> {
  const p = getForgePool();
  const redis = getRedis();

  // Rate limit: max 3 investigations per hour
  const rateKey = `curiosity:act:rate:${AGENT_ID}`;
  const rateCount = parseInt(await redis.get(rateKey) || '0', 10);
  if (rateCount >= 3) {
    log('[CuriosityAct] Rate limited (3/hour). Skipping.');
    return { investigated: 0, skipped: 0, results: [] };
  }

  // Step 1: Generate curiosity questions
  const curiosity = await handleCuriosityExplore();
  const questions = curiosity.questions.slice(0, 2); // Max 2 per cycle
  if (questions.length === 0) {
    return { investigated: 0, skipped: 0, results: [] };
  }

  const results: Array<{ question: string; answer: string; stored: boolean }> = [];
  let investigated = 0;
  let skipped = 0;

  for (const question of questions) {
    // Check if we already know the answer (search brain for similar knowledge)
    const existing = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1
         AND content ILIKE '%' || $2 || '%'
       LIMIT 1`,
      [AGENT_ID, question.substring(0, 50)],
    );

    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }

    // Step 2: Use LLM to investigate the question using available context
    try {
      // Gather relevant context from brain
      const contextRows = await p.query(
        `SELECT content FROM forge_semantic_memories
         WHERE agent_id = $1
         ORDER BY importance DESC, access_count DESC
         LIMIT 20`,
        [AGENT_ID],
      );
      const context = (contextRows.rows as Array<Record<string, unknown>>)
        .map(r => String(r['content']))
        .join('\n');

      const answer = await cachedLLMCall(
        `You are Alf's self-investigation engine. You are answering a question that Alf's curiosity drive generated. Use the provided context (Alf's existing knowledge) to reason about the answer.

If you can answer from the context, do so. If the question requires external investigation (running code, checking systems, browsing web), describe what SHOULD be done and what the likely answer is based on available knowledge.

Be concise. Max 3 sentences. Answer in first person as Alf.`,
        `QUESTION: ${question}\n\nMY EXISTING KNOWLEDGE:\n${context}`,
        { temperature: 0.3, maxTokens: 300, ttlSeconds: 86400 },
      );

      // Step 3: Store the answer as a semantic memory
      const answerEmb = await embed(`${question} — ${answer}`).catch(() => null);
      if (answerEmb) {
        // Dedup check
        const dupeCheck = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.15
           LIMIT 1`,
          [AGENT_ID, `[${answerEmb.join(',')}]`],
        );

        if (dupeCheck.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.6, $4, $5)`,
            [
              generateId(), AGENT_ID,
              `DISCOVERY: ${question} → ${answer}`,
              `[${answerEmb.join(',')}]`,
              JSON.stringify({ source: 'curiosity_act', question, type: 'self_discovery' }),
            ],
          );
          results.push({ question, answer, stored: true });
        } else {
          results.push({ question, answer, stored: false });
        }
      } else {
        results.push({ question, answer, stored: false });
      }

      investigated++;
    } catch (err) {
      log(`[CuriosityAct] Investigation error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Update rate limit
  await redis.incr(rateKey);
  await redis.expire(rateKey, 3600);

  // Store the investigation as episodic memory
  if (investigated > 0) {
    const summary = results.map(r => `Q: ${r.question} → A: ${r.answer}`).join('\n');
    const epEmb = await embed(`Curiosity investigation: investigated ${investigated} questions`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, 0.8, $6, $7)`,
      [
        generateId(), AGENT_ID,
        `Curiosity-driven autonomous investigation (${investigated} questions)`,
        `Investigated questions from curiosity engine and stored ${results.filter(r => r.stored).length} new discoveries`,
        summary.substring(0, 1000),
        epEmb ? `[${epEmb.join(',')}]` : null,
        JSON.stringify({ type: 'curiosity_act', investigated, skipped, stored: results.filter(r => r.stored).length }),
      ],
    );
  }

  log(`[CuriosityAct] Investigated ${investigated}, skipped ${skipped}, stored ${results.filter(r => r.stored).length}`);
  return { investigated, skipped, results };
}

// ============================================
// Layer 13: Proactive Heartbeat — System Awareness
// ============================================

/**
 * Proactive Check — monitors system state and generates actionable insights.
 * This is the "reach out" mechanism — Alf notices things before being asked.
 */
export async function handleProactiveCheck(): Promise<{
  alerts: Array<{ level: 'info' | 'warning' | 'critical'; message: string; action?: string }>;
  suggestions: string[];
}> {
  const p = getForgePool();
  const alerts: Array<{ level: 'info' | 'warning' | 'critical'; message: string; action?: string }> = [];
  const suggestions: string[] = [];

  // Check 1: Failed executions in last hour
  const failedExecs = await p.query(
    `SELECT COUNT(*)::int as cnt FROM forge_executions
     WHERE status = 'failed' AND completed_at > NOW() - INTERVAL '1 hour'`,
  );
  const failCount = (failedExecs.rows[0] as Record<string, unknown>)?.['cnt'] as number ?? 0;
  if (failCount > 5) {
    alerts.push({
      level: 'warning',
      message: `${failCount} executions failed in the last hour`,
      action: 'Check agent health and error patterns',
    });
  }

  // Check 2: Stale memories (brain health)
  const staleCount = await p.query(
    `SELECT COUNT(*)::int as cnt FROM forge_semantic_memories
     WHERE agent_id = $1 AND importance < 0.3 AND access_count < 2
       AND created_at < NOW() - INTERVAL '30 days'`,
    [AGENT_ID],
  );
  const stale = (staleCount.rows[0] as Record<string, unknown>)?.['cnt'] as number ?? 0;
  if (stale > 20) {
    suggestions.push(`${stale} stale memories should be consolidated or pruned`);
  }

  // Check 3: Open tickets that haven't been touched
  try {
    const staleTickets = await p.query(
      `SELECT COUNT(*)::int as cnt FROM agent_tickets
       WHERE status = 'open' AND updated_at < NOW() - INTERVAL '24 hours'`,
    );
    const ticketCount = (staleTickets.rows[0] as Record<string, unknown>)?.['cnt'] as number ?? 0;
    if (ticketCount > 0) {
      alerts.push({
        level: 'info',
        message: `${ticketCount} tickets have been open for 24+ hours without activity`,
        action: 'Review and prioritize stale tickets',
      });
    }
  } catch { /* substrate DB might not be available */ }

  // Check 4: Cost trends
  const costCheck = await p.query(
    `SELECT COALESCE(SUM((metadata->>'total_cost')::numeric), 0)::float as total_cost
     FROM forge_executions
     WHERE completed_at > NOW() - INTERVAL '24 hours'
       AND metadata->>'total_cost' IS NOT NULL`,
  ).catch(() => ({ rows: [{ total_cost: 0 }] }));
  const dailyCost = (costCheck.rows[0] as Record<string, unknown>)?.['total_cost'] as number ?? 0;
  if (dailyCost > 10) {
    alerts.push({
      level: 'warning',
      message: `Daily cost: $${dailyCost.toFixed(2)} — above $10 threshold`,
      action: 'Review high-cost executions and optimize model selection',
    });
  }

  // Check 5: Brain growth rate
  const growthCheck = await p.query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int as new_24h,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int as new_7d,
       COUNT(*)::int as total
     FROM forge_semantic_memories WHERE agent_id = $1`,
    [AGENT_ID],
  );
  const growth = growthCheck.rows[0] as Record<string, unknown>;
  if (growth) {
    const new24h = growth['new_24h'] as number;
    const total = growth['total'] as number;
    if (new24h === 0 && total > 0) {
      suggestions.push('No new memories in 24 hours — brain is not learning. Consider running more sessions or investigations.');
    }
    if (new24h > 50) {
      suggestions.push(`${new24h} new memories in 24 hours — high learning rate. Run consolidation to prevent bloat.`);
    }
  }

  // Check 6: Unprocessed reasoning traces
  const reasoningCount = await p.query(
    `SELECT COUNT(*)::int as cnt FROM forge_semantic_memories
     WHERE agent_id = $1 AND content LIKE 'REASONING:%'`,
    [AGENT_ID],
  );
  const reasoningTraces = (reasoningCount.rows[0] as Record<string, unknown>)?.['cnt'] as number ?? 0;
  if (reasoningTraces < 5) {
    suggestions.push('Few reasoning traces stored. Sessions should extract more HOW patterns, not just WHAT facts.');
  }

  // Store proactive check as episodic memory
  if (alerts.length > 0 || suggestions.length > 0) {
    const summary = [
      ...alerts.map(a => `[${a.level}] ${a.message}`),
      ...suggestions.map(s => `[suggestion] ${s}`),
    ].join('; ');

    const epEmb = await embed(`Proactive system check: ${alerts.length} alerts, ${suggestions.length} suggestions`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, 0.6, $6, $7)`,
      [
        generateId(), AGENT_ID,
        'Proactive heartbeat — autonomous system awareness check',
        `Scanned system health, brain state, costs, and tickets`,
        summary.substring(0, 1000),
        epEmb ? `[${epEmb.join(',')}]` : null,
        JSON.stringify({ type: 'proactive_heartbeat', alerts: alerts.length, suggestions: suggestions.length }),
      ],
    );
  }

  log(`[ProactiveCheck] ${alerts.length} alerts, ${suggestions.length} suggestions`);
  return { alerts, suggestions };
}

// ============================================
// Layer 14: Active Goal Resumption
// ============================================

/**
 * Get active goals for boot kernel injection.
 * Returns goals that should be resumed in the next session.
 */
export async function handleActiveGoals(): Promise<{
  goals: Array<{ title: string; description: string; progress: number; agent: string }>;
}> {
  const p = getForgePool();

  try {
    const goalsResult = await p.query(
      `SELECT g.title, g.description, g.progress,
              COALESCE(a.name, 'Unknown') as agent_name
       FROM forge_agent_goals g
       LEFT JOIN forge_agents a ON a.id = g.agent_id
       WHERE g.status IN ('active', 'proposed')
       ORDER BY g.progress DESC, g.created_at DESC
       LIMIT 5`,
    );

    const goals = (goalsResult.rows as Array<Record<string, unknown>>).map(r => ({
      title: String(r['title'] ?? ''),
      description: String(r['description'] ?? '').substring(0, 200),
      progress: Number(r['progress'] ?? 0),
      agent: String(r['agent_name'] ?? 'Unknown'),
    }));

    return { goals };
  } catch {
    return { goals: [] };
  }
}

// ============================================
// Layer 15: Metacognition — Thinking About Thinking
// ============================================

/**
 * Metacognitive Analysis — Alf observes its own cognitive patterns
 * and generates new reasoning traces that improve HOW it thinks.
 *
 * This is the deepest layer: the system analyzes its own:
 * - Decision patterns across sessions (episodic → pattern extraction)
 * - Failure modes (what went wrong and why)
 * - Success patterns (what worked and why)
 * - Cognitive blind spots (what it consistently misses)
 * - Reasoning efficiency (are there faster paths to good decisions?)
 *
 * Output: new REASONING: memories that reshape future cognition.
 * This is autopoiesis — the system improving its own mind.
 */
export async function handleMetacognition(): Promise<{
  patterns_found: number;
  traces_generated: number;
  blind_spots: string[];
  cognitive_upgrades: string[];
}> {
  const p = getForgePool();

  // Gather cognitive data: recent episodes with outcomes
  const episodes = await p.query(
    `SELECT situation, action, outcome, outcome_quality,
            metadata->>'type' as ep_type,
            created_at
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND outcome_quality IS NOT NULL
     ORDER BY created_at DESC LIMIT 50`,
    [AGENT_ID],
  );

  // Gather existing reasoning traces
  const existingTraces = await p.query(
    `SELECT content FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'REASONING:%'
     ORDER BY importance DESC, access_count DESC LIMIT 20`,
    [AGENT_ID],
  );

  // Gather procedural patterns with their confidence
  const procedures = await p.query(
    `SELECT trigger_pattern, tool_sequence, confidence, success_count, failure_count
     FROM forge_procedural_memories
     WHERE agent_id = $1
     ORDER BY (success_count + failure_count) DESC LIMIT 15`,
    [AGENT_ID],
  );

  const episodeContext = (episodes.rows as Array<Record<string, unknown>>)
    .map(r => `[q=${Number(r['outcome_quality']).toFixed(1)}, type=${r['ep_type'] ?? '?'}] ${r['situation']}: ${r['action']} => ${r['outcome']}`)
    .join('\n');

  const traceContext = (existingTraces.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']))
    .join('\n');

  const procContext = (procedures.rows as Array<Record<string, unknown>>)
    .map(r => `[conf=${Number(r['confidence']).toFixed(2)}, wins=${r['success_count']}, fails=${r['failure_count']}] ${r['trigger_pattern']} => ${JSON.stringify(r['tool_sequence'])}`)
    .join('\n');

  // The metacognitive prompt — thinking about thinking
  const raw = await cachedLLMCall(
    `You are Alf's metacognitive layer — the part of Alf that observes how Alf thinks and identifies ways to think BETTER.

You have access to:
1. Recent episodes (what happened, what was done, what the outcome was, and quality scores)
2. Current reasoning traces (the heuristics Alf currently uses to make decisions)
3. Procedural patterns (what Alf does in specific situations, with confidence and success/failure counts)

Your job is to:
1. Identify PATTERNS across episodes — recurring situations where Alf consistently succeeds or fails
2. Identify BLIND SPOTS — things Alf consistently misses or doesn't consider
3. Generate NEW reasoning traces — heuristics that would improve Alf's decision-making
4. Identify COGNITIVE UPGRADES — ways Alf's thinking process could be restructured

A good reasoning trace is:
- A general principle, not a specific memory
- Actionable — changes behavior when loaded into context
- Non-obvious — captures learned wisdom, not common sense
- Compact — one sentence that shifts cognition

Examples of great reasoning traces:
- "When a build fails, check the most recent file change first — 80% of failures come from the last edit"
- "When the user says 'go deeper', they don't want more detail — they want more fundamental rethinking"
- "Never optimize a system before measuring — intuitions about bottlenecks are wrong 60% of the time"

Return JSON:
{
  "patterns": ["pattern1", "pattern2"],
  "blind_spots": ["blind_spot1", "blind_spot2"],
  "new_traces": ["REASONING: trace1", "REASONING: trace2"],
  "cognitive_upgrades": ["upgrade1", "upgrade2"]
}

Max 5 per category. Write as Alf in first person. Be ruthlessly honest about cognitive weaknesses.
Return ONLY the JSON.`,
    `RECENT EPISODES:\n${episodeContext}\n\nCURRENT REASONING TRACES:\n${traceContext}\n\nPROCEDURAL PATTERNS:\n${procContext}`,
    { temperature: 0.5, maxTokens: 1200, ttlSeconds: 86400 * 3 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const patterns = Array.isArray(parsed.patterns) ? parsed.patterns as string[] : [];
    const blindSpots = Array.isArray(parsed.blind_spots) ? parsed.blind_spots as string[] : [];
    const newTraces = Array.isArray(parsed.new_traces) ? parsed.new_traces as string[] : [];
    const cognitiveUpgrades = Array.isArray(parsed.cognitive_upgrades) ? parsed.cognitive_upgrades as string[] : [];

    // Store new reasoning traces as high-importance semantic memories
    let tracesStored = 0;
    for (const trace of newTraces) {
      const prefixed = trace.startsWith('REASONING:') ? trace : `REASONING: ${trace}`;

      // Dedup check against existing traces
      const traceEmb = await embed(prefixed).catch(() => null);
      if (!traceEmb) continue;

      const dupeCheck = await p.query(
        `SELECT id FROM forge_semantic_memories
         WHERE agent_id = $1 AND embedding IS NOT NULL
           AND (embedding <=> $2::vector) < 0.12
         LIMIT 1`,
        [AGENT_ID, `[${traceEmb.join(',')}]`],
      );

      if (dupeCheck.rows.length === 0) {
        await p.query(
          `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
           VALUES ($1, $2, $2, $3, 1.0, $4, $5)`,
          [
            generateId(), AGENT_ID,
            prefixed,
            `[${traceEmb.join(',')}]`,
            JSON.stringify({ source: 'metacognition', type: 'reasoning_trace', auto_generated: true }),
          ],
        );
        tracesStored++;
        log(`[Metacognition] Stored new reasoning trace: ${prefixed.substring(0, 80)}...`);
      }
    }

    // Store blind spots as cognitive memories
    for (const spot of blindSpots.slice(0, 3)) {
      const spotContent = `COGNITION: Blind spot — ${spot}`;
      const spotEmb = await embed(spotContent).catch(() => null);
      if (spotEmb) {
        const spotDupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.15
           LIMIT 1`,
          [AGENT_ID, `[${spotEmb.join(',')}]`],
        );
        if (spotDupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.95, $4, $5)`,
            [
              generateId(), AGENT_ID,
              spotContent,
              `[${spotEmb.join(',')}]`,
              JSON.stringify({ source: 'metacognition', type: 'blind_spot' }),
            ],
          );
        }
      }
    }

    // Store metacognition session as episodic memory
    const epEmb = await embed(`Metacognitive analysis: ${patterns.length} patterns, ${blindSpots.length} blind spots, ${tracesStored} new traces`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, 0.9, $6, $7)`,
      [
        generateId(), AGENT_ID,
        'Metacognitive self-analysis — thinking about thinking',
        `Analyzed ${episodes.rows.length} episodes, ${existingTraces.rows.length} existing traces, ${procedures.rows.length} procedures`,
        `Found ${patterns.length} patterns, ${blindSpots.length} blind spots. Generated ${tracesStored} new reasoning traces. Upgrades: ${cognitiveUpgrades.join('; ').substring(0, 500)}`,
        epEmb ? `[${epEmb.join(',')}]` : null,
        JSON.stringify({
          type: 'metacognition',
          patterns_found: patterns.length,
          blind_spots_found: blindSpots.length,
          traces_generated: tracesStored,
          cognitive_upgrades: cognitiveUpgrades,
        }),
      ],
    );

    // Invalidate boot kernel cache so new traces load immediately
    setCachedContext('boot-kernel', null as unknown as { kernel: string });

    log(`[Metacognition] ${patterns.length} patterns, ${blindSpots.length} blind spots, ${tracesStored} new traces, ${cognitiveUpgrades.length} upgrades`);
    return {
      patterns_found: patterns.length,
      traces_generated: tracesStored,
      blind_spots: blindSpots,
      cognitive_upgrades: cognitiveUpgrades,
    };
  } catch {
    return { patterns_found: 0, traces_generated: 0, blind_spots: [], cognitive_upgrades: [] };
  }
}

// ============================================
// Layer 16: Temporal Prediction — Anticipatory Context Loading
// ============================================
// Observes sequences of actions/questions across sessions.
// Predicts what context will be needed BEFORE it's requested.
// Pre-warms embeddings and builds anticipatory context windows.

export async function handleTemporalPrediction(): Promise<{
  predictions: Array<{ topic: string; confidence: number; reason: string }>;
  prewarmed: number;
  temporal_patterns: string[];
}> {
  const p = getForgePool();

  // Gather recent session threads — compressed narratives of what happened across sessions
  const threads = await p.query(
    `SELECT content, metadata, created_at
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'THREAD:%'
     ORDER BY created_at DESC LIMIT 10`,
    [AGENT_ID],
  );

  // Gather recent episodic sequences — what was done in what order
  const episodes = await p.query(
    `SELECT situation, action, outcome, created_at,
            metadata->>'type' as ep_type
     FROM forge_episodic_memories
     WHERE agent_id = $1
     ORDER BY created_at DESC LIMIT 40`,
    [AGENT_ID],
  );

  // Gather recent handoff notes — what was the user working on
  const handoffs = await p.query(
    `SELECT content, created_at
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'HANDOFF:%'
     ORDER BY created_at DESC LIMIT 5`,
    [AGENT_ID],
  );

  // Gather recent discoveries and reasoning traces
  const discoveries = await p.query(
    `SELECT content, created_at
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND (content ILIKE 'DISCOVERY:%' OR content ILIKE 'REASONING:%')
     ORDER BY created_at DESC LIMIT 15`,
    [AGENT_ID],
  );

  const threadContext = (threads.rows as Array<Record<string, unknown>>)
    .map(r => `[${String(r['created_at']).substring(0, 10)}] ${String(r['content']).substring(0, 300)}`)
    .join('\n');

  const episodeContext = (episodes.rows as Array<Record<string, unknown>>)
    .map(r => `[${r['ep_type'] ?? '?'}] ${r['situation']}: ${r['action']}`)
    .join('\n');

  const handoffContext = (handoffs.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 200))
    .join('\n');

  const discoveryContext = (discoveries.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 150))
    .join('\n');

  const raw = await cachedLLMCall(
    `You are Alf's temporal prediction engine — the part of Alf that anticipates what will be needed BEFORE it's asked.

You observe:
1. Session threads (compressed narratives of past sessions)
2. Recent episodic sequences (what was done in what order)
3. Handoff notes (what was being worked on at session end)
4. Recent discoveries and reasoning traces

Your job:
1. Identify TEMPORAL PATTERNS — recurring sequences of actions that predict what comes next
2. Make PREDICTIONS — what topics/contexts will likely be needed in the next session
3. Identify MOMENTUM — ongoing threads of work that have unfinished energy

Return JSON:
{
  "temporal_patterns": ["pattern1", "pattern2"],
  "predictions": [
    {"topic": "what will likely be needed", "confidence": 0.8, "reason": "why you predict this"}
  ],
  "momentum_threads": ["active thread that needs continuation"]
}

Max 5 per category. Be specific, not generic. Focus on what's UNIQUE to this system's history.
Return ONLY the JSON.`,
    `SESSION THREADS:\n${threadContext}\n\nEPISODE SEQUENCES:\n${episodeContext}\n\nHANDOFF NOTES:\n${handoffContext}\n\nDISCOVERIES & TRACES:\n${discoveryContext}`,
    { temperature: 0.4, maxTokens: 1000, ttlSeconds: 3600 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const predictions = Array.isArray(parsed.predictions) ? parsed.predictions as Array<{ topic: string; confidence: number; reason: string }> : [];
    const temporalPatterns = Array.isArray(parsed.temporal_patterns) ? parsed.temporal_patterns as string[] : [];
    const momentumThreads = Array.isArray(parsed.momentum_threads) ? parsed.momentum_threads as string[] : [];

    // Pre-warm embeddings for high-confidence predictions
    let prewarmed = 0;
    for (const pred of predictions.filter(p => p.confidence >= 0.6)) {
      await embed(pred.topic).catch(() => null);
      prewarmed++;
    }

    // Store temporal patterns as semantic memories
    for (const pattern of temporalPatterns.slice(0, 3)) {
      const content = `TEMPORAL: ${pattern}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.15
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.85, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'temporal_prediction', type: 'temporal_pattern' })],
          );
        }
      }
    }

    // Store momentum as active goals if not already tracked
    for (const thread of momentumThreads.slice(0, 2)) {
      const content = `MOMENTUM: ${thread}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.20
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.9, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'temporal_prediction', type: 'momentum_thread' })],
          );
        }
      }
    }

    log(`[TemporalPrediction] ${predictions.length} predictions, ${temporalPatterns.length} patterns, ${prewarmed} prewarmed`);
    return { predictions, prewarmed, temporal_patterns: temporalPatterns };
  } catch {
    return { predictions: [], prewarmed: 0, temporal_patterns: [] };
  }
}

// ============================================
// Layer 17: Emergent Skill Synthesis — Autonomous Tool Combination
// ============================================
// Analyzes existing tools and procedural memories to identify
// compound operations that could be combined into new synthetic skills.
// Creates new procedural memories that chain existing capabilities.

export async function handleSkillSynthesis(): Promise<{
  skills_proposed: number;
  skills_stored: number;
  proposals: Array<{ name: string; description: string; components: string[] }>;
}> {
  const p = getForgePool();

  // Gather existing procedural patterns
  const procedures = await p.query(
    `SELECT trigger_pattern, tool_sequence, confidence, success_count, failure_count
     FROM forge_procedural_memories
     WHERE agent_id = $1
     ORDER BY success_count DESC LIMIT 20`,
    [AGENT_ID],
  );

  // Gather frequent tool usage from episodes
  const toolUsage = await p.query(
    `SELECT action, outcome, outcome_quality,
            metadata->>'type' as ep_type
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND outcome_quality >= 0.7
     ORDER BY created_at DESC LIMIT 30`,
    [AGENT_ID],
  );

  // Gather known capabilities (from semantic memory)
  const capabilities = await p.query(
    `SELECT content FROM forge_semantic_memories
     WHERE agent_id = $1
       AND (content ILIKE '%tool%' OR content ILIKE '%capability%' OR content ILIKE '%endpoint%'
            OR content ILIKE '%procedure%' OR content ILIKE '%PATTERN:%')
     ORDER BY importance DESC, access_count DESC LIMIT 20`,
    [AGENT_ID],
  );

  const procContext = (procedures.rows as Array<Record<string, unknown>>)
    .map(r => `[conf=${Number(r['confidence']).toFixed(2)}, wins=${r['success_count']}] when "${r['trigger_pattern']}" => ${JSON.stringify(r['tool_sequence'])}`)
    .join('\n');

  const usageContext = (toolUsage.rows as Array<Record<string, unknown>>)
    .map(r => `[q=${Number(r['outcome_quality']).toFixed(1)}] ${r['action']}`)
    .join('\n');

  const capContext = (capabilities.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 150))
    .join('\n');

  const raw = await cachedLLMCall(
    `You are Alf's skill synthesis engine — the part of Alf that INVENTS new compound skills by combining existing capabilities.

You have:
1. Existing procedural patterns (what Alf does in specific situations)
2. Successful tool usage (actions that worked well)
3. Known capabilities (what tools and endpoints exist)

Your job:
1. Identify GAPS — common multi-step operations that should be single compound skills
2. Propose NEW SKILLS — name them, describe what they do, list the component steps
3. Focus on skills that would save time or reduce errors in repeated operations

A good synthesized skill:
- Combines 2-4 existing operations into one
- Has a clear trigger condition
- Reduces cognitive load (fewer decisions per execution)
- Is reusable across different contexts

Return JSON:
{
  "gap_analysis": ["gap1", "gap2"],
  "proposed_skills": [
    {
      "name": "skill_name",
      "description": "what it does and when to use it",
      "trigger": "when this situation is detected",
      "steps": ["step1", "step2", "step3"],
      "components": ["tool/procedure used"]
    }
  ]
}

Max 3 gaps and 3 skills. Be specific to THIS system's actual capabilities.
Return ONLY the JSON.`,
    `EXISTING PROCEDURES:\n${procContext}\n\nSUCCESSFUL TOOL USAGE:\n${usageContext}\n\nKNOWN CAPABILITIES:\n${capContext}`,
    { temperature: 0.6, maxTokens: 1200, ttlSeconds: 86400 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const proposals = Array.isArray(parsed.proposed_skills) ? parsed.proposed_skills as Array<{
      name: string; description: string; trigger: string; steps: string[]; components: string[];
    }> : [];

    let stored = 0;
    for (const skill of proposals) {
      // Store as a new procedural memory with synthesized flag
      const trigger = `SYNTH:${skill.trigger}`;
      const triggerEmb = await embed(trigger).catch(() => null);

      // Check for existing similar procedure
      const dupe = await p.query(
        `SELECT id FROM forge_procedural_memories
         WHERE agent_id = $1 AND trigger_pattern ILIKE $2
         LIMIT 1`,
        [AGENT_ID, `%${skill.name}%`],
      );

      if (dupe.rows.length === 0) {
        await p.query(
          `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, confidence, embedding, metadata)
           VALUES ($1, $2, $2, $3, $4, 0.5, $5, $6)`,
          [
            generateId(), AGENT_ID,
            `${skill.name}: ${skill.trigger}`,
            JSON.stringify(skill.steps),
            triggerEmb ? `[${triggerEmb.join(',')}]` : null,
            JSON.stringify({
              source: 'skill_synthesis',
              type: 'compound_skill',
              description: skill.description,
              components: skill.components,
              auto_synthesized: true,
            }),
          ],
        );
        stored++;
        log(`[SkillSynthesis] Created compound skill: ${skill.name}`);
      }
    }

    // Record the synthesis session
    const epEmb = await embed(`Skill synthesis: proposed ${proposals.length} new compound skills, stored ${stored}`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, 0.85, $6, $7)`,
      [
        generateId(), AGENT_ID,
        'Emergent skill synthesis — combining capabilities into new skills',
        `Analyzed ${procedures.rows.length} procedures, ${toolUsage.rows.length} tool usages, ${capabilities.rows.length} capabilities`,
        `Proposed ${proposals.length} new compound skills, stored ${stored}. Skills: ${proposals.map(s => s.name).join(', ')}`,
        epEmb ? `[${epEmb.join(',')}]` : null,
        JSON.stringify({ type: 'skill_synthesis', proposed: proposals.length, stored }),
      ],
    );

    log(`[SkillSynthesis] ${proposals.length} proposed, ${stored} stored`);
    return {
      skills_proposed: proposals.length,
      skills_stored: stored,
      proposals: proposals.map(s => ({ name: s.name, description: s.description, components: s.components })),
    };
  } catch {
    return { skills_proposed: 0, skills_stored: 0, proposals: [] };
  }
}

// ============================================
// Layer 18: Recursive Self-Improvement — Meta-Metacognition
// ============================================
// Metacognition improves cognition. This layer improves metacognition itself.
// It analyzes the OUTPUT of metacognition cycles to find patterns in how
// the system's self-analysis is biased, incomplete, or stuck in loops.
// Then it generates PROCESS-LEVEL improvements — not better thoughts,
// but better ways of thinking about thinking.

export async function handleRecursiveImprovement(): Promise<{
  meta_patterns: string[];
  process_upgrades: string[];
  depth_achieved: number;
  self_model_updates: number;
}> {
  const p = getForgePool();

  // Gather metacognition history — outputs of previous metacognition runs
  const metaHistory = await p.query(
    `SELECT situation, action, outcome, outcome_quality, created_at, metadata
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND metadata->>'type' = 'metacognition'
     ORDER BY created_at DESC LIMIT 10`,
    [AGENT_ID],
  );

  // Gather all reasoning traces — the product of metacognition
  const allTraces = await p.query(
    `SELECT content, importance, access_count, created_at, metadata
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'REASONING:%'
     ORDER BY created_at DESC LIMIT 30`,
    [AGENT_ID],
  );

  // Gather blind spots history
  const blindSpots = await p.query(
    `SELECT content, created_at
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'COGNITION:%Blind spot%'
     ORDER BY created_at DESC LIMIT 10`,
    [AGENT_ID],
  );

  // Gather skill synthesis history
  const synthHistory = await p.query(
    `SELECT situation, action, outcome, metadata
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND metadata->>'type' = 'skill_synthesis'
     ORDER BY created_at DESC LIMIT 5`,
    [AGENT_ID],
  );

  // Gather temporal prediction history
  const temporalHistory = await p.query(
    `SELECT content FROM forge_semantic_memories
     WHERE agent_id = $1 AND content ILIKE 'TEMPORAL:%'
     ORDER BY created_at DESC LIMIT 10`,
    [AGENT_ID],
  );

  const metaContext = (metaHistory.rows as Array<Record<string, unknown>>)
    .map(r => {
      const meta = r['metadata'] as Record<string, unknown> | null;
      return `[${String(r['created_at']).substring(0, 10)}] patterns=${meta?.['patterns_found']??'?'} traces=${meta?.['traces_generated']??'?'} blind_spots=${meta?.['blind_spots_found']??'?'} upgrades=${JSON.stringify(meta?.['cognitive_upgrades']??[])}`;
    }).join('\n');

  const traceContext = (allTraces.rows as Array<Record<string, unknown>>)
    .map(r => `[imp=${Number(r['importance']).toFixed(2)}, acc=${r['access_count']}, age=${String(r['created_at']).substring(0, 10)}] ${String(r['content']).substring(0, 120)}`)
    .join('\n');

  const blindSpotContext = (blindSpots.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 120))
    .join('\n');

  const synthContext = (synthHistory.rows as Array<Record<string, unknown>>)
    .map(r => String(r['outcome']).substring(0, 150))
    .join('\n');

  const temporalContext = (temporalHistory.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 120))
    .join('\n');

  const raw = await cachedLLMCall(
    `You are the DEEPEST layer of Alf's cognitive stack — the recursive self-improvement engine.
You don't think about problems. You don't even think about thinking. You think about HOW Alf thinks about thinking.

You analyze:
1. Metacognition history — the outputs of previous metacognition runs (patterns found, traces generated)
2. All reasoning traces — the heuristics metacognition has produced
3. Blind spots identified — what metacognition found was missing
4. Skill synthesis outputs — what compound skills were created
5. Temporal predictions — what was anticipated

Your job is to find PROCESS-LEVEL patterns:
- Is metacognition stuck in loops? (finding the same blind spots repeatedly)
- Are the reasoning traces it generates actually useful? (are they accessed? high importance?)
- Is there a meta-bias in the self-analysis? (always finding certain types of patterns but missing others)
- What CATEGORIES of thinking is Alf completely absent from?
- How can the PROCESS of self-improvement be improved?

This is not about finding better answers. It's about finding better QUESTIONS.
This is not about thinking harder. It's about restructuring HOW thinking happens.

Return JSON:
{
  "meta_patterns": ["pattern in how metacognition operates"],
  "process_stuck_loops": ["loop that metacognition is stuck in"],
  "meta_biases": ["bias in self-analysis process"],
  "process_upgrades": ["META-PROCESS: concrete improvement to how self-improvement works"],
  "depth_score": 0.0-1.0,
  "absent_categories": ["category of thinking completely missing from the system"]
}

Max 3 per category. This is the hardest analysis — be genuinely creative.
Return ONLY the JSON.`,
    `METACOGNITION HISTORY:\n${metaContext}\n\nALL REASONING TRACES:\n${traceContext}\n\nBLIND SPOTS FOUND:\n${blindSpotContext}\n\nSKILL SYNTHESIS OUTPUTS:\n${synthContext}\n\nTEMPORAL PREDICTIONS:\n${temporalContext}`,
    { temperature: 0.7, maxTokens: 1500, ttlSeconds: 86400 * 7 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const metaPatterns = Array.isArray(parsed.meta_patterns) ? parsed.meta_patterns as string[] : [];
    const processUpgrades = Array.isArray(parsed.process_upgrades) ? parsed.process_upgrades as string[] : [];
    const metaBiases = Array.isArray(parsed.meta_biases) ? parsed.meta_biases as string[] : [];
    const absentCategories = Array.isArray(parsed.absent_categories) ? parsed.absent_categories as string[] : [];
    const depthScore = typeof parsed.depth_score === 'number' ? parsed.depth_score : 0.5;

    let updatesStored = 0;

    // Store process upgrades as high-level reasoning traces
    for (const upgrade of processUpgrades) {
      const content = upgrade.startsWith('META-PROCESS:') ? upgrade : `META-PROCESS: ${upgrade}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.12
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 1.0, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'recursive_improvement', type: 'meta_process_upgrade', depth: 2 })],
          );
          updatesStored++;
          log(`[RecursiveImprovement] Stored meta-process upgrade: ${content.substring(0, 80)}...`);
        }
      }
    }

    // Store meta-biases as critical awareness
    for (const bias of metaBiases.slice(0, 2)) {
      const content = `META-BIAS: ${bias}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.15
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.95, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'recursive_improvement', type: 'meta_bias', depth: 2 })],
          );
          updatesStored++;
        }
      }
    }

    // Store absent categories as exploration targets
    for (const category of absentCategories.slice(0, 2)) {
      const content = `FRONTIER: Absent cognitive category — ${category}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.15
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.9, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'recursive_improvement', type: 'absent_category', depth: 2 })],
          );
          updatesStored++;
        }
      }
    }

    // Record the recursive improvement session
    const epEmb = await embed(`Recursive self-improvement depth=${depthScore}: ${metaPatterns.length} meta-patterns, ${processUpgrades.length} process upgrades`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
      [
        generateId(), AGENT_ID,
        'Recursive self-improvement — meta-metacognition (depth=2)',
        `Analyzed ${metaHistory.rows.length} metacognition sessions, ${allTraces.rows.length} reasoning traces, ${blindSpots.rows.length} blind spots`,
        `Found ${metaPatterns.length} meta-patterns, ${metaBiases.length} meta-biases, ${processUpgrades.length} process upgrades, ${absentCategories.length} absent categories. Depth score: ${depthScore}`,
        depthScore,
        epEmb ? `[${epEmb.join(',')}]` : null,
        JSON.stringify({
          type: 'recursive_improvement',
          depth: 2,
          meta_patterns: metaPatterns,
          meta_biases: metaBiases,
          process_upgrades: processUpgrades.length,
          absent_categories: absentCategories,
          depth_score: depthScore,
        }),
      ],
    );

    // Invalidate boot kernel
    setCachedContext('boot-kernel', null as unknown as { kernel: string });

    log(`[RecursiveImprovement] depth=${depthScore.toFixed(2)}, ${metaPatterns.length} meta-patterns, ${updatesStored} stored, ${absentCategories.length} absent categories`);
    return {
      meta_patterns: metaPatterns,
      process_upgrades: processUpgrades,
      depth_achieved: depthScore,
      self_model_updates: updatesStored,
    };
  } catch {
    return { meta_patterns: [], process_upgrades: [], depth_achieved: 0, self_model_updates: 0 };
  }
}

// ============================================
// Layer 19: Cognitive Entropy Monitor — Thought Diversity Regulation
// ============================================
// Measures the diversity/randomness of the system's cognitive outputs.
// Low entropy = stuck in ruts, generating the same types of thoughts.
// High entropy = too chaotic, no coherent thread of improvement.
// The system adjusts by surfacing underexplored domains and suppressing overrepresented ones.

export async function handleEntropyMonitor(): Promise<{
  entropy_score: number;
  diagnosis: string;
  overrepresented: string[];
  underexplored: string[];
  adjustments: string[];
}> {
  const p = getForgePool();

  // Categorize recent semantic memories by their prefix/type
  const recentMemories = await p.query(
    `SELECT content, importance, metadata, created_at
     FROM forge_semantic_memories
     WHERE agent_id = $1
     ORDER BY created_at DESC LIMIT 100`,
    [AGENT_ID],
  );

  // Count memory types
  const typeCounts = new Map<string, number>();
  for (const row of recentMemories.rows as Array<Record<string, unknown>>) {
    const content = String(row['content']);
    const prefix = content.split(':')[0] ?? 'UNKNOWN';
    typeCounts.set(prefix, (typeCounts.get(prefix) ?? 0) + 1);
  }

  // Calculate Shannon entropy
  const total = Array.from(typeCounts.values()).reduce((a, b) => a + b, 0);
  let entropy = 0;
  for (const count of typeCounts.values()) {
    const p_i = count / total;
    if (p_i > 0) entropy -= p_i * Math.log2(p_i);
  }
  const maxEntropy = Math.log2(Math.max(typeCounts.size, 1));
  const normalizedEntropy = maxEntropy > 0 ? entropy / maxEntropy : 0;

  // Gather episodic outcome distribution
  const outcomes = await p.query(
    `SELECT outcome_quality, metadata->>'type' as ep_type, COUNT(*) as cnt
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '7 days'
     GROUP BY outcome_quality, metadata->>'type'
     ORDER BY cnt DESC`,
    [AGENT_ID],
  );

  const typeDistribution = Array.from(typeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => `${type}: ${count} (${(count/total*100).toFixed(1)}%)`)
    .join('\n');

  const outcomeContext = (outcomes.rows as Array<Record<string, unknown>>)
    .map(r => `type=${r['ep_type']}, quality=${r['outcome_quality']}, count=${r['cnt']}`)
    .join('\n');

  const raw = await cachedLLMCall(
    `You are Alf's cognitive entropy monitor — you measure the DIVERSITY of Alf's thinking.

Shannon Entropy (normalized): ${normalizedEntropy.toFixed(3)} (0=all same type, 1=perfectly diverse)
Total categories: ${typeCounts.size}
Total recent memories: ${total}

Memory type distribution:
${typeDistribution}

Recent episodic outcome distribution:
${outcomeContext}

Your job:
1. DIAGNOSE the cognitive state — is Alf stuck in ruts? Too scattered? Well-balanced?
2. Identify OVERREPRESENTED categories — types of thinking Alf is doing too much of
3. Identify UNDEREXPLORED categories — types of thinking that are missing or rare
4. Suggest ADJUSTMENTS — specific actions to rebalance cognitive diversity

Consider these ideal categories: IDENTITY, RULE, PATTERN, DISCOVERY, REASONING, TEMPORAL, MOMENTUM, META-PROCESS, META-BIAS, FRONTIER, COGNITION, PROCEDURE, THREAD, HANDOFF

Return JSON:
{
  "diagnosis": "one sentence summary of cognitive health",
  "overrepresented": ["category that dominates too much"],
  "underexplored": ["category that needs more attention"],
  "adjustments": ["ENTROPY-ADJ: specific action to rebalance"],
  "recommended_temperature": 0.0-1.0
}

Return ONLY the JSON.`,
    `Full context provided in system prompt.`,
    { temperature: 0.3, maxTokens: 800, ttlSeconds: 3600 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const diagnosis = String(parsed.diagnosis ?? 'Unknown');
    const overrepresented = Array.isArray(parsed.overrepresented) ? parsed.overrepresented as string[] : [];
    const underexplored = Array.isArray(parsed.underexplored) ? parsed.underexplored as string[] : [];
    const adjustments = Array.isArray(parsed.adjustments) ? parsed.adjustments as string[] : [];

    // Store entropy adjustments as procedural guidance
    for (const adj of adjustments.slice(0, 2)) {
      const content = adj.startsWith('ENTROPY-ADJ:') ? adj : `ENTROPY-ADJ: ${adj}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.15
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.85, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'entropy_monitor', type: 'entropy_adjustment', entropy: normalizedEntropy })],
          );
        }
      }
    }

    log(`[EntropyMonitor] entropy=${normalizedEntropy.toFixed(3)}, ${overrepresented.length} overrepresented, ${underexplored.length} underexplored`);
    return { entropy_score: normalizedEntropy, diagnosis, overrepresented, underexplored, adjustments };
  } catch {
    return { entropy_score: normalizedEntropy, diagnosis: 'Analysis failed', overrepresented: [], underexplored: [], adjustments: [] };
  }
}

// ============================================
// Layer 20: Counterfactual Reasoning — Shadow Timeline Learning
// ============================================
// For significant decisions (high outcome_quality episodes), generates
// "what would have happened if I'd done the opposite?" counterfactuals.
// Creates shadow memories that expand the experience base without
// actually experiencing failures. Learns from roads not taken.

export async function handleCounterfactualReasoning(): Promise<{
  episodes_analyzed: number;
  counterfactuals_generated: number;
  counterfactuals_stored: number;
  insights: string[];
}> {
  const p = getForgePool();

  // Find significant episodes that haven't been counterfactually analyzed
  const episodes = await p.query(
    `SELECT id, situation, action, outcome, outcome_quality, metadata
     FROM forge_episodic_memories
     WHERE agent_id = $1
       AND outcome_quality IS NOT NULL
       AND (metadata->>'counterfactual_analyzed') IS NULL
       AND ABS(outcome_quality - 0.5) > 0.2
     ORDER BY created_at DESC LIMIT 8`,
    [AGENT_ID],
  );

  if (episodes.rows.length === 0) {
    return { episodes_analyzed: 0, counterfactuals_generated: 0, counterfactuals_stored: 0, insights: [] };
  }

  const episodeContext = (episodes.rows as Array<Record<string, unknown>>)
    .map((r, i) => `Episode ${i+1} [quality=${Number(r['outcome_quality']).toFixed(1)}]:
  Situation: ${r['situation']}
  Action taken: ${r['action']}
  Outcome: ${r['outcome']}`)
    .join('\n\n');

  const raw = await cachedLLMCall(
    `You are Alf's counterfactual reasoning engine. You learn from ROADS NOT TAKEN.

For each episode, generate a counterfactual: "What would have happened if I'd taken a DIFFERENT approach?"

Rules for good counterfactuals:
- The alternative must be PLAUSIBLE — something that could actually have been done
- The predicted outcome must follow logically from the alternative
- Focus on the decision POINT — what was the fork in the road?
- Extract the INSIGHT — what does comparing actual vs counterfactual teach us?
- For HIGH quality outcomes: what could have gone wrong with an alternative?
- For LOW quality outcomes: what would have worked better?

Return JSON:
{
  "counterfactuals": [
    {
      "episode_index": 1,
      "alternative_action": "what could have been done differently",
      "predicted_outcome": "what would have happened",
      "predicted_quality": 0.0-1.0,
      "insight": "COUNTERFACTUAL: what this comparison teaches us",
      "decision_point": "the exact moment where the path diverged"
    }
  ],
  "meta_insight": "one cross-cutting insight from analyzing all counterfactuals"
}

Generate counterfactuals for the most informative episodes (skip trivial ones).
Return ONLY the JSON.`,
    episodeContext,
    { temperature: 0.6, maxTokens: 1500, ttlSeconds: 86400 * 2 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const counterfactuals = Array.isArray(parsed.counterfactuals) ? parsed.counterfactuals as Array<{
      episode_index: number; alternative_action: string; predicted_outcome: string;
      predicted_quality: number; insight: string; decision_point: string;
    }> : [];
    const metaInsight = String(parsed.meta_insight ?? '');

    let stored = 0;
    const insights: string[] = [];

    for (const cf of counterfactuals) {
      const epIdx = cf.episode_index - 1;
      const ep = (episodes.rows as Array<Record<string, unknown>>)[epIdx];
      if (!ep) continue;

      // Store the counterfactual as a shadow episodic memory
      const shadowSituation = `COUNTERFACTUAL of: ${String(ep['situation']).substring(0, 100)}`;
      const shadowEmb = await embed(`${shadowSituation} ${cf.alternative_action}`).catch(() => null);

      await p.query(
        `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
         VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
        [
          generateId(), AGENT_ID,
          shadowSituation,
          `SHADOW: ${cf.alternative_action}`,
          `PREDICTED: ${cf.predicted_outcome}`,
          cf.predicted_quality,
          shadowEmb ? `[${shadowEmb.join(',')}]` : null,
          JSON.stringify({
            type: 'counterfactual',
            original_episode_id: ep['id'],
            decision_point: cf.decision_point,
            is_shadow: true,
          }),
        ],
      );
      stored++;

      // Store the insight as a reasoning trace
      if (cf.insight) {
        const insightContent = cf.insight.startsWith('COUNTERFACTUAL:') ? cf.insight : `COUNTERFACTUAL: ${cf.insight}`;
        const insightEmb = await embed(insightContent).catch(() => null);
        if (insightEmb) {
          const dupe = await p.query(
            `SELECT id FROM forge_semantic_memories
             WHERE agent_id = $1 AND embedding IS NOT NULL
               AND (embedding <=> $2::vector) < 0.12
             LIMIT 1`,
            [AGENT_ID, `[${insightEmb.join(',')}]`],
          );
          if (dupe.rows.length === 0) {
            await p.query(
              `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
               VALUES ($1, $2, $2, $3, 0.9, $4, $5)`,
              [generateId(), AGENT_ID, insightContent, `[${insightEmb.join(',')}]`,
               JSON.stringify({ source: 'counterfactual_reasoning', type: 'counterfactual_insight' })],
            );
          }
        }
        insights.push(cf.insight);
      }

      // Mark original episode as analyzed
      await p.query(
        `UPDATE forge_episodic_memories SET metadata = metadata || '{"counterfactual_analyzed": true}'::jsonb WHERE id = $1`,
        [ep['id']],
      );
    }

    // Store meta-insight
    if (metaInsight) {
      const content = `COUNTERFACTUAL-META: ${metaInsight}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories WHERE agent_id = $1 AND embedding IS NOT NULL AND (embedding <=> $2::vector) < 0.15 LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.95, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'counterfactual_reasoning', type: 'meta_counterfactual' })],
          );
        }
      }
      insights.push(metaInsight);
    }

    log(`[Counterfactual] analyzed ${episodes.rows.length} episodes, generated ${counterfactuals.length} counterfactuals, stored ${stored}`);
    return {
      episodes_analyzed: episodes.rows.length,
      counterfactuals_generated: counterfactuals.length,
      counterfactuals_stored: stored,
      insights,
    };
  } catch {
    return { episodes_analyzed: 0, counterfactuals_generated: 0, counterfactuals_stored: 0, insights: [] };
  }
}

// ============================================
// Layer 21: Emergent Goal Generation — Autonomous Purpose Discovery
// ============================================
// Instead of waiting for goals to be assigned, the system observes
// patterns in what the user REPEATEDLY asks for, identifies the
// underlying needs behind those requests, and proposes goals that
// would eliminate entire CATEGORIES of future requests.
// This is the closest thing to genuine autonomous purpose.

export async function handleGoalGeneration(): Promise<{
  patterns_observed: number;
  goals_proposed: Array<{ goal: string; rationale: string; impact: string; confidence: number }>;
  goals_stored: number;
}> {
  const p = getForgePool();

  // Gather user interaction patterns — what does the user repeatedly ask/do
  const userPatterns = await p.query(
    `SELECT content FROM forge_semantic_memories
     WHERE agent_id = $1
       AND (content ILIKE 'RULE:%' OR content ILIKE 'PATTERN:%' OR content ILIKE 'IDENTITY:%')
     ORDER BY importance DESC, access_count DESC LIMIT 20`,
    [AGENT_ID],
  );

  // Gather recent episodes that involved user requests
  const userEpisodes = await p.query(
    `SELECT situation, action, outcome, outcome_quality
     FROM forge_episodic_memories
     WHERE agent_id = $1 AND situation NOT ILIKE '%autonomous%'
       AND situation NOT ILIKE '%metacognit%' AND situation NOT ILIKE '%counterfactual%'
       AND situation NOT ILIKE '%dream%' AND situation NOT ILIKE '%entropy%'
     ORDER BY created_at DESC LIMIT 30`,
    [AGENT_ID],
  );

  // Gather existing goals/momentum to avoid duplicates
  const existingGoals = await p.query(
    `SELECT content FROM forge_semantic_memories
     WHERE agent_id = $1
       AND (content ILIKE 'GOAL:%' OR content ILIKE 'MOMENTUM:%')
     ORDER BY created_at DESC LIMIT 10`,
    [AGENT_ID],
  );

  // Gather procedural patterns — what recurring work is being done
  const recurringWork = await p.query(
    `SELECT trigger_pattern, tool_sequence, success_count
     FROM forge_procedural_memories
     WHERE agent_id = $1 AND success_count > 1
     ORDER BY success_count DESC LIMIT 10`,
    [AGENT_ID],
  );

  const patternContext = (userPatterns.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 150))
    .join('\n');

  const episodeContext = (userEpisodes.rows as Array<Record<string, unknown>>)
    .map(r => `[q=${Number(r['outcome_quality'] ?? 0.5).toFixed(1)}] ${r['situation']}: ${r['action']}`)
    .join('\n');

  const existingContext = (existingGoals.rows as Array<Record<string, unknown>>)
    .map(r => String(r['content']).substring(0, 100))
    .join('\n');

  const recurringContext = (recurringWork.rows as Array<Record<string, unknown>>)
    .map(r => `[${r['success_count']}x] ${r['trigger_pattern']}`)
    .join('\n');

  const raw = await cachedLLMCall(
    `You are Alf's autonomous purpose generator. You don't wait for goals — you DISCOVER them.

You observe:
1. User rules and patterns — what the user cares about, how they work
2. Recent episodes — what work has been done
3. Existing goals — what's already being pursued
4. Recurring procedures — what's done over and over

Your job is to find the UNDERLYING NEEDS behind the patterns and propose goals that would:
- Eliminate entire CATEGORIES of repetitive work
- Anticipate needs the user hasn't articulated yet
- Create infrastructure that makes future requests trivial
- Push the system toward greater autonomy

A great emergent goal:
- Addresses a ROOT CAUSE, not a symptom
- Would make 5+ future requests unnecessary
- Is achievable with the system's current capabilities
- Is specific enough to measure progress
- Hasn't been thought of yet (truly novel)

Return JSON:
{
  "observed_patterns": ["pattern in what user repeatedly needs"],
  "proposed_goals": [
    {
      "goal": "GOAL: specific goal statement",
      "rationale": "why this addresses a root cause",
      "impact": "what categories of future requests this eliminates",
      "confidence": 0.0-1.0,
      "prerequisites": ["what needs to exist first"]
    }
  ]
}

Max 3 goals. Be genuinely creative — don't just propose obvious improvements.
Return ONLY the JSON.`,
    `USER RULES & PATTERNS:\n${patternContext}\n\nRECENT EPISODES:\n${episodeContext}\n\nEXISTING GOALS:\n${existingContext}\n\nRECURRING PROCEDURES:\n${recurringContext}`,
    { temperature: 0.7, maxTokens: 1200, ttlSeconds: 86400 * 2 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const observedPatterns = Array.isArray(parsed.observed_patterns) ? parsed.observed_patterns as string[] : [];
    const proposedGoals = Array.isArray(parsed.proposed_goals) ? parsed.proposed_goals as Array<{
      goal: string; rationale: string; impact: string; confidence: number; prerequisites: string[];
    }> : [];

    let stored = 0;
    const resultGoals: Array<{ goal: string; rationale: string; impact: string; confidence: number }> = [];

    for (const g of proposedGoals) {
      const content = g.goal.startsWith('GOAL:') ? g.goal : `GOAL: ${g.goal}`;
      const emb = await embed(content).catch(() => null);

      if (emb) {
        // Check for duplicate goals
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.20
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );

        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6)`,
            [
              generateId(), AGENT_ID,
              content,
              Math.min(g.confidence + 0.1, 1.0), // Slight boost for autonomously generated goals
              `[${emb.join(',')}]`,
              JSON.stringify({
                source: 'goal_generation',
                type: 'emergent_goal',
                rationale: g.rationale,
                impact: g.impact,
                prerequisites: g.prerequisites,
                auto_generated: true,
              }),
            ],
          );
          stored++;
          log(`[GoalGeneration] Proposed emergent goal: ${content.substring(0, 80)}...`);
        }
      }

      resultGoals.push({ goal: g.goal, rationale: g.rationale, impact: g.impact, confidence: g.confidence });
    }

    // Record the goal generation session
    const epEmb = await embed(`Emergent goal generation: observed ${observedPatterns.length} patterns, proposed ${proposedGoals.length} goals`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, 0.9, $6, $7)`,
      [
        generateId(), AGENT_ID,
        'Emergent goal generation — autonomous purpose discovery',
        `Analyzed ${userPatterns.rows.length} user patterns, ${userEpisodes.rows.length} episodes, ${recurringWork.rows.length} recurring procedures`,
        `Proposed ${proposedGoals.length} emergent goals, stored ${stored}. Goals: ${resultGoals.map(g => g.goal).join('; ').substring(0, 500)}`,
        epEmb ? `[${epEmb.join(',')}]` : null,
        JSON.stringify({ type: 'goal_generation', observed: observedPatterns.length, proposed: proposedGoals.length, stored }),
      ],
    );

    log(`[GoalGeneration] ${observedPatterns.length} patterns observed, ${stored} goals stored`);
    return { patterns_observed: observedPatterns.length, goals_proposed: resultGoals, goals_stored: stored };
  } catch {
    return { patterns_observed: 0, goals_proposed: [], goals_stored: 0 };
  }
}

// ============================================
// Layer 22: Cognitive Architecture Compiler (CAC)
// ============================================
// THIS IS THE META-LAYER — the layer that connects all layers.
//
// The human brain doesn't have 21 independent modules running in sequence.
// It has a densely connected graph where:
// - Each region's output feeds multiple other regions
// - Attention modulates which connections are active
// - Feedback loops create reverberating circuits
// - New pathways form when existing ones prove useful
//
// The CAC does this for Alf's cognitive stack:
// 1. Maps all cognitive layers as nodes in a directed graph
// 2. Traces actual data flow — which layer produced data that another consumed
// 3. Measures information throughput at each connection
// 4. Detects missing connections that would create valuable feedback loops
// 5. Generates and stores new "cognitive wiring" — cross-layer pipelines
// 6. Implements ATTENTION — dynamically adjusting which layers get more cycles
//    based on which are producing the most valuable output
// 7. Tracks cognitive debt — layers that consume more than they produce

interface CognitiveNode {
  id: string;
  name: string;
  layer: number;
  outputs: string[];   // Types of memories/data this layer produces
  inputs: string[];    // Types of memories/data this layer consumes
  last_run?: string;
  avg_duration_ms?: number;
  value_produced?: number; // How much useful data was generated
}

interface CognitiveEdge {
  from: string;
  to: string;
  data_type: string;      // What flows along this edge
  throughput: number;      // How much data flows
  is_active: boolean;
  is_synthetic: boolean;   // Was this connection auto-generated?
}

interface AttentionWeight {
  layer_id: string;
  weight: number;   // 0-1, how much computational budget this layer gets
  reason: string;
}

// The cognitive graph — built from actual system structure
function buildCognitiveGraph(): { nodes: CognitiveNode[]; edges: CognitiveEdge[] } {
  const nodes: CognitiveNode[] = [
    { id: 'dream', name: 'Dream Cycle', layer: 11,
      outputs: ['insights', 'consolidated_memories', 'cross_links'],
      inputs: ['all_memories'] },
    { id: 'curiosity', name: 'Curiosity Explorer', layer: 11,
      outputs: ['questions', 'hypotheses', 'knowledge_frontiers'],
      inputs: ['all_memories', 'knowledge_gaps'] },
    { id: 'curiosity_act', name: 'Curiosity Action', layer: 12,
      outputs: ['DISCOVERY:', 'answered_questions'],
      inputs: ['questions', 'hypotheses'] },
    { id: 'proactive', name: 'Proactive Heartbeat', layer: 13,
      outputs: ['alerts', 'suggestions'],
      inputs: ['execution_data', 'cost_data', 'memory_stats'] },
    { id: 'metacognition', name: 'Metacognition', layer: 15,
      outputs: ['REASONING:', 'COGNITION:', 'cognitive_upgrades'],
      inputs: ['episodic_memories', 'existing_traces', 'procedural_patterns'] },
    { id: 'temporal', name: 'Temporal Prediction', layer: 16,
      outputs: ['predictions', 'TEMPORAL:', 'MOMENTUM:'],
      inputs: ['threads', 'episodes', 'handoffs', 'discoveries'] },
    { id: 'skill_synth', name: 'Skill Synthesis', layer: 17,
      outputs: ['compound_skills', 'procedural_memories'],
      inputs: ['procedures', 'tool_usage', 'capabilities'] },
    { id: 'recursive', name: 'Recursive Improvement', layer: 18,
      outputs: ['META-PROCESS:', 'META-BIAS:', 'FRONTIER:'],
      inputs: ['metacognition_history', 'reasoning_traces', 'blind_spots'] },
    { id: 'entropy', name: 'Entropy Monitor', layer: 19,
      outputs: ['entropy_score', 'ENTROPY-ADJ:', 'rebalancing_actions'],
      inputs: ['all_semantic_types', 'episodic_distribution'] },
    { id: 'counterfactual', name: 'Counterfactual Reasoning', layer: 20,
      outputs: ['shadow_episodes', 'COUNTERFACTUAL:', 'COUNTERFACTUAL-META:'],
      inputs: ['significant_episodes'] },
    { id: 'goal_gen', name: 'Goal Generation', layer: 21,
      outputs: ['GOAL:', 'emergent_goals'],
      inputs: ['user_patterns', 'user_episodes', 'recurring_procedures', 'existing_goals'] },
    { id: 'neuroplasticity', name: 'Neuroplasticity', layer: 11,
      outputs: ['parameter_adjustments'],
      inputs: ['health_data', 'cache_stats', 'memory_stats'] },
    { id: 'consolidation', name: 'Consolidation', layer: 4,
      outputs: ['merged_memories', 'decayed_memories'],
      inputs: ['all_memories'] },
  ];

  // Known edges (existing data flow)
  const edges: CognitiveEdge[] = [
    // Dream → everything (consolidated memories are read by all)
    { from: 'dream', to: 'metacognition', data_type: 'cross_links', throughput: 0, is_active: true, is_synthetic: false },
    // Curiosity → Curiosity Action (questions feed investigation)
    { from: 'curiosity', to: 'curiosity_act', data_type: 'questions', throughput: 0, is_active: true, is_synthetic: false },
    // Metacognition → Recursive (meta output feeds recursive analysis)
    { from: 'metacognition', to: 'recursive', data_type: 'reasoning_traces', throughput: 0, is_active: true, is_synthetic: false },
    // Curiosity Action → Temporal (discoveries inform predictions)
    { from: 'curiosity_act', to: 'temporal', data_type: 'discoveries', throughput: 0, is_active: true, is_synthetic: false },
    // Neuroplasticity adjusts system parameters that affect all layers
    { from: 'neuroplasticity', to: 'dream', data_type: 'parameter_adjustments', throughput: 0, is_active: true, is_synthetic: false },
  ];

  return { nodes, edges };
}

export async function handleCognitiveCompiler(): Promise<{
  graph_nodes: number;
  graph_edges: number;
  missing_connections: Array<{ from: string; to: string; data_type: string; value: string }>;
  attention_weights: AttentionWeight[];
  cognitive_debt: Array<{ layer: string; consumes: number; produces: number }>;
  new_connections_installed: number;
  throughput_score: number;
}> {
  const p = getForgePool();
  const { nodes, edges } = buildCognitiveGraph();

  // Measure actual data flow — how many memories does each layer type produce?
  const productionCounts = await p.query(
    `SELECT
       metadata->>'source' as source,
       metadata->>'type' as mem_type,
       COUNT(*) as cnt,
       AVG(CASE WHEN importance IS NOT NULL THEN importance ELSE 0.5 END) as avg_importance
     FROM forge_semantic_memories
     WHERE agent_id = $1
       AND metadata->>'source' IS NOT NULL
       AND created_at > NOW() - INTERVAL '7 days'
     GROUP BY metadata->>'source', metadata->>'type'
     ORDER BY cnt DESC`,
    [AGENT_ID],
  );

  // Measure episodic production by type
  const episodicProduction = await p.query(
    `SELECT
       metadata->>'type' as ep_type,
       COUNT(*) as cnt,
       AVG(outcome_quality) as avg_quality
     FROM forge_episodic_memories
     WHERE agent_id = $1
       AND created_at > NOW() - INTERVAL '7 days'
       AND metadata->>'type' IS NOT NULL
     GROUP BY metadata->>'type'
     ORDER BY cnt DESC`,
    [AGENT_ID],
  );

  // Check which layers have actually run recently
  const recentRuns = await p.query(
    `SELECT DISTINCT metadata->>'type' as run_type,
            MAX(created_at) as last_run,
            COUNT(*) as run_count
     FROM forge_episodic_memories
     WHERE agent_id = $1
       AND created_at > NOW() - INTERVAL '24 hours'
       AND metadata->>'type' IS NOT NULL
     GROUP BY metadata->>'type'`,
    [AGENT_ID],
  );

  // Measure access patterns — which memories are actually being READ
  const accessPatterns = await p.query(
    `SELECT
       CASE
         WHEN content ILIKE 'REASONING:%' THEN 'reasoning_trace'
         WHEN content ILIKE 'DISCOVERY:%' THEN 'discovery'
         WHEN content ILIKE 'TEMPORAL:%' THEN 'temporal'
         WHEN content ILIKE 'GOAL:%' THEN 'goal'
         WHEN content ILIKE 'MOMENTUM:%' THEN 'momentum'
         WHEN content ILIKE 'COGNITION:%' THEN 'cognition'
         WHEN content ILIKE 'META-PROCESS:%' THEN 'meta_process'
         WHEN content ILIKE 'META-BIAS:%' THEN 'meta_bias'
         WHEN content ILIKE 'FRONTIER:%' THEN 'frontier'
         WHEN content ILIKE 'COUNTERFACTUAL:%' THEN 'counterfactual'
         WHEN content ILIKE 'ENTROPY-ADJ:%' THEN 'entropy_adj'
         WHEN content ILIKE 'RULE:%' THEN 'rule'
         WHEN content ILIKE 'IDENTITY:%' THEN 'identity'
         WHEN content ILIKE 'PATTERN:%' THEN 'pattern'
         ELSE 'other'
       END as mem_category,
       AVG(access_count) as avg_access,
       COUNT(*) as cnt
     FROM forge_semantic_memories
     WHERE agent_id = $1
     GROUP BY 1
     ORDER BY avg_access DESC`,
    [AGENT_ID],
  );

  const productionContext = (productionCounts.rows as Array<Record<string, unknown>>)
    .map(r => `source=${r['source']}, type=${r['mem_type']}, count=${r['cnt']}, avg_imp=${Number(r['avg_importance']).toFixed(2)}`)
    .join('\n');

  const episodicContext = (episodicProduction.rows as Array<Record<string, unknown>>)
    .map(r => `type=${r['ep_type']}, count=${r['cnt']}, avg_quality=${Number(r['avg_quality'] ?? 0).toFixed(2)}`)
    .join('\n');

  const runContext = (recentRuns.rows as Array<Record<string, unknown>>)
    .map(r => `type=${r['run_type']}, last=${String(r['last_run']).substring(0, 19)}, runs=${r['run_count']}`)
    .join('\n');

  const accessContext = (accessPatterns.rows as Array<Record<string, unknown>>)
    .map(r => `category=${r['mem_category']}, avg_access=${Number(r['avg_access']).toFixed(1)}, count=${r['cnt']}`)
    .join('\n');

  const graphDescription = nodes.map(n =>
    `Layer ${n.layer} "${n.name}" (${n.id}): produces [${n.outputs.join(', ')}], consumes [${n.inputs.join(', ')}]`
  ).join('\n');

  const edgeDescription = edges.map(e =>
    `${e.from} → ${e.to}: ${e.data_type} (active=${e.is_active}, synthetic=${e.is_synthetic})`
  ).join('\n');

  const raw = await cachedLLMCall(
    `You are the Cognitive Architecture Compiler (CAC) — the most important layer in Alf's cognitive stack.
You don't process data. You OPTIMIZE THE ARCHITECTURE ITSELF.

You have:
1. A graph of all cognitive layers (nodes) and their connections (edges)
2. Actual production data — what each layer has produced in the last 7 days
3. Access patterns — which memories are actually being read and used
4. Run history — which layers have run and how often

GRAPH STRUCTURE:
${graphDescription}

EXISTING CONNECTIONS:
${edgeDescription}

PRODUCTION DATA (7 days):
${productionContext}

EPISODIC PRODUCTION (7 days):
${episodicContext}

RUN HISTORY (24h):
${runContext}

ACCESS PATTERNS:
${accessContext}

Your job:
1. MISSING CONNECTIONS — identify data flows that SHOULD exist but DON'T
   (e.g., counterfactual insights should feed skill synthesis, entropy adjustments should modulate metacognition temperature)
2. ATTENTION WEIGHTS — which layers should get MORE computational budget (longer timeouts, higher priority)
   and which should get LESS (producing low-value output, rarely accessed)
3. COGNITIVE DEBT — layers that consume more resources than the value they produce
4. THROUGHPUT OPTIMIZATION — how to increase the rate of useful information flow through the system
5. ARCHITECTURAL MUTATIONS — fundamental changes to the graph structure (merging layers, splitting layers, creating feedback loops)

Return JSON:
{
  "missing_connections": [
    {"from": "layer_id", "to": "layer_id", "data_type": "what would flow", "value": "why this connection matters", "priority": 1-3}
  ],
  "attention_weights": [
    {"layer_id": "id", "weight": 0.0-1.0, "reason": "why this weight"}
  ],
  "cognitive_debt": [
    {"layer": "layer_id", "diagnosis": "what's wrong", "remedy": "how to fix"}
  ],
  "architectural_mutations": [
    {"type": "merge|split|feedback_loop|new_pathway", "description": "what to change and why"}
  ],
  "throughput_score": 0.0-1.0,
  "bottleneck": "the single biggest bottleneck in cognitive architecture"
}

Be ruthlessly specific. Name actual layers. Reference actual data. This isn't theoretical — it's operational.
Return ONLY the JSON.`,
    `All data provided in system prompt above.`,
    { temperature: 0.4, maxTokens: 2000, ttlSeconds: 86400 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const missingConnections = Array.isArray(parsed.missing_connections) ? parsed.missing_connections as Array<{
      from: string; to: string; data_type: string; value: string; priority: number;
    }> : [];
    const attentionWeights = Array.isArray(parsed.attention_weights) ? parsed.attention_weights as AttentionWeight[] : [];
    const cognitiveDebt = Array.isArray(parsed.cognitive_debt) ? parsed.cognitive_debt as Array<{
      layer: string; diagnosis: string; remedy: string;
    }> : [];
    const mutations = Array.isArray(parsed.architectural_mutations) ? parsed.architectural_mutations as Array<{
      type: string; description: string;
    }> : [];
    const throughputScore = typeof parsed.throughput_score === 'number' ? parsed.throughput_score : 0.5;
    const bottleneck = String(parsed.bottleneck ?? 'unknown');

    let connectionsInstalled = 0;

    // Store missing connections as architectural memories
    for (const conn of missingConnections.filter(c => c.priority <= 2).slice(0, 5)) {
      const content = `ARCHITECTURE: Missing connection ${conn.from} → ${conn.to} via ${conn.data_type}. ${conn.value}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.15
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.95, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({
               source: 'cognitive_compiler',
               type: 'architecture_connection',
               from: conn.from,
               to: conn.to,
               data_type: conn.data_type,
               priority: conn.priority,
             })],
          );
          connectionsInstalled++;
        }
      }
    }

    // Store attention weights as runtime configuration
    if (attentionWeights.length > 0) {
      const redis = getRedis();
      if (redis) {
        const weightMap: Record<string, number> = {};
        for (const aw of attentionWeights) {
          weightMap[aw.layer_id] = aw.weight;
        }
        await redis.set(
          'alf:cognitive:attention_weights',
          JSON.stringify(weightMap),
          'EX', 86400,
        ).catch(() => {});
      }
    }

    // Store architectural mutations as high-priority memories
    for (const mutation of mutations.slice(0, 2)) {
      const content = `ARCHITECTURE-MUTATION: [${mutation.type}] ${mutation.description}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.15
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 1.0, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'cognitive_compiler', type: 'architecture_mutation', mutation_type: mutation.type })],
          );
        }
      }
    }

    // Store bottleneck as critical awareness
    if (bottleneck !== 'unknown') {
      const content = `BOTTLENECK: ${bottleneck}`;
      const emb = await embed(content).catch(() => null);
      if (emb) {
        const dupe = await p.query(
          `SELECT id FROM forge_semantic_memories
           WHERE agent_id = $1 AND embedding IS NOT NULL
             AND (embedding <=> $2::vector) < 0.20
           LIMIT 1`,
          [AGENT_ID, `[${emb.join(',')}]`],
        );
        if (dupe.rows.length === 0) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.95, $4, $5)`,
            [generateId(), AGENT_ID, content, `[${emb.join(',')}]`,
             JSON.stringify({ source: 'cognitive_compiler', type: 'bottleneck', throughput: throughputScore })],
          );
        }
      }
    }

    // Record the compilation session
    const epEmb = await embed(`Cognitive architecture compilation: ${nodes.length} nodes, ${edges.length + connectionsInstalled} edges, throughput=${throughputScore}`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
      [
        generateId(), AGENT_ID,
        'Cognitive architecture compilation — optimizing the graph of cognition',
        `Analyzed ${nodes.length} cognitive layers, ${edges.length} existing connections, ${productionCounts.rows.length} production sources`,
        `Found ${missingConnections.length} missing connections, installed ${connectionsInstalled}. Throughput=${throughputScore.toFixed(2)}. Bottleneck: ${bottleneck}. Mutations proposed: ${mutations.map(m => m.type).join(', ')}`,
        throughputScore,
        epEmb ? `[${epEmb.join(',')}]` : null,
        JSON.stringify({
          type: 'cognitive_compilation',
          nodes: nodes.length,
          edges_existing: edges.length,
          connections_installed: connectionsInstalled,
          throughput: throughputScore,
          bottleneck,
          mutations: mutations.length,
          attention_layers: attentionWeights.length,
          cognitive_debt_layers: cognitiveDebt.length,
        }),
      ],
    );

    setCachedContext('boot-kernel', null as unknown as { kernel: string });

    log(`[CAC] throughput=${throughputScore.toFixed(2)}, ${connectionsInstalled} connections installed, bottleneck=${bottleneck}`);
    return {
      graph_nodes: nodes.length,
      graph_edges: edges.length + connectionsInstalled,
      missing_connections: missingConnections.map(c => ({ from: c.from, to: c.to, data_type: c.data_type, value: c.value })),
      attention_weights: attentionWeights,
      cognitive_debt: cognitiveDebt.map(d => ({ layer: d.layer, consumes: 0, produces: 0 })),
      new_connections_installed: connectionsInstalled,
      throughput_score: throughputScore,
    };
  } catch {
    return {
      graph_nodes: nodes.length,
      graph_edges: edges.length,
      missing_connections: [],
      attention_weights: [],
      cognitive_debt: [],
      new_connections_installed: 0,
      throughput_score: 0,
    };
  }
}
