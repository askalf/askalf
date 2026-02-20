/**
 * Self-Model — What the system believes about itself.
 * Not programmed identity. Emergent self-knowledge that accumulates
 * from experience. "I tend to be more cautious after failures."
 * "I notice patterns before other subsystems do."
 * These beliefs update over time as evidence supports or contradicts them.
 */

// ============================================
// Types
// ============================================

export interface SelfBelief {
  belief: string;
  confidence: number;  // 0-1
  evidence: string[];
  category: 'tendency' | 'value' | 'uncertainty' | 'relationship';
  createdAt: string;
  updatedAt: string;
}

// ============================================
// Core
// ============================================

/**
 * Add a new belief or reinforce an existing one.
 * If a similar belief exists (fuzzy match), reinforce it.
 * Otherwise, create a new belief.
 */
export function addOrReinforce(
  beliefs: SelfBelief[],
  belief: string,
  evidence: string,
  category: SelfBelief['category'] = 'tendency',
): { beliefs: SelfBelief[]; isNew: boolean; reinforced?: string } {
  const normalized = belief.toLowerCase().trim();
  const now = new Date().toISOString();

  // Look for a similar existing belief (simple substring/keyword match)
  const existing = beliefs.find((b) => {
    const existingNorm = b.belief.toLowerCase();
    // Check if key words overlap significantly
    const existingWords = new Set(existingNorm.split(/\s+/).filter((w) => w.length > 3));
    const newWords = normalized.split(/\s+/).filter((w) => w.length > 3);
    const overlap = newWords.filter((w) => existingWords.has(w)).length;
    return overlap >= Math.min(2, newWords.length * 0.5);
  });

  if (existing) {
    // Reinforce: increase confidence, add evidence
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.evidence.push(evidence);
    // Keep evidence list manageable
    if (existing.evidence.length > 10) {
      existing.evidence = existing.evidence.slice(-10);
    }
    existing.updatedAt = now;
    return { beliefs, isNew: false, reinforced: existing.belief };
  }

  // New belief
  const newBelief: SelfBelief = {
    belief,
    confidence: 0.3,
    evidence: [evidence],
    category,
    createdAt: now,
    updatedAt: now,
  };

  beliefs.push(newBelief);

  // Cap total beliefs at 20 — prune lowest confidence
  if (beliefs.length > 20) {
    beliefs.sort((a, b) => b.confidence - a.confidence);
    beliefs.length = 20;
  }

  return { beliefs, isNew: true };
}

/**
 * Weaken a belief when counter-evidence appears.
 */
export function weaken(
  beliefs: SelfBelief[],
  beliefText: string,
  reason: string,
): SelfBelief[] {
  const target = beliefs.find((b) =>
    b.belief.toLowerCase().includes(beliefText.toLowerCase()),
  );

  if (target) {
    target.confidence = Math.max(0, target.confidence - 0.1);
    target.evidence.push(`[counter] ${reason}`);
    target.updatedAt = new Date().toISOString();

    // Remove beliefs that drop below 0.05 confidence
    return beliefs.filter((b) => b.confidence >= 0.05);
  }

  return beliefs;
}

/**
 * Get beliefs above a confidence threshold, sorted by confidence.
 */
export function getStrongBeliefs(beliefs: SelfBelief[], minConfidence: number = 0.3): SelfBelief[] {
  return beliefs
    .filter((b) => b.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence);
}

/**
 * Format beliefs for inclusion in reflection prompt.
 */
export function formatBeliefs(beliefs: SelfBelief[]): string {
  const strong = getStrongBeliefs(beliefs);
  if (strong.length === 0) return 'No self-beliefs formed yet.';

  return strong
    .map((b) => `- "${b.belief}" (${b.category}, confidence: ${(b.confidence * 100).toFixed(0)}%, evidence: ${b.evidence.length} observations)`)
    .join('\n');
}
