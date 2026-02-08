import { createHash } from 'crypto';

/**
 * Generate a pattern hash for a trace input/output pair
 * Used for fast pattern matching and deduplication
 */
export function generatePatternHash(input: string, output: string): string {
  const normalized = normalizeForHashing(`${input}::${output}`);
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Generate a content hash for any string
 */
export function generateContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Normalize text for consistent hashing
 * - Lowercase
 * - Collapse whitespace
 * - Remove punctuation
 */
function normalizeForHashing(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}

/**
 * Check if two strings are similar enough to be considered the same pattern
 * Simple Jaccard similarity on word sets
 */
export function calculateSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeForHashing(a).split(' '));
  const setB = new Set(normalizeForHashing(b).split(' '));

  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);

  if (union.size === 0) return 1;
  return intersection.size / union.size;
}
