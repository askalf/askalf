import { describe, it, expect } from 'vitest';
import {
  generatePatternHash,
  generateContentHash,
  calculateSimilarity,
} from '../../packages/core/src/utils/hash.js';

describe('generatePatternHash', () => {
  it('returns a 16-character hex string', () => {
    const hash = generatePatternHash('hello', 'world');
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic — same inputs always yield the same hash', () => {
    const a = generatePatternHash('What is TypeScript?', 'A typed superset of JS');
    const b = generatePatternHash('What is TypeScript?', 'A typed superset of JS');
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = generatePatternHash('input A', 'output A');
    const b = generatePatternHash('input B', 'output B');
    expect(a).not.toBe(b);
  });

  it('is case-insensitive — normalizes before hashing', () => {
    const a = generatePatternHash('Hello', 'World');
    const b = generatePatternHash('HELLO', 'WORLD');
    expect(a).toBe(b);
  });

  it('collapses whitespace before hashing', () => {
    const a = generatePatternHash('hello  world', 'foo');
    const b = generatePatternHash('hello world', 'foo');
    expect(a).toBe(b);
  });

  it('strips punctuation before hashing', () => {
    const a = generatePatternHash('hello, world!', 'foo.');
    const b = generatePatternHash('hello world', 'foo');
    expect(a).toBe(b);
  });

  it('treats empty strings as valid inputs', () => {
    const hash = generatePatternHash('', '');
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('order matters — (A, B) != (B, A)', () => {
    const ab = generatePatternHash('alpha', 'beta');
    const ba = generatePatternHash('beta', 'alpha');
    // After normalization both sides differ due to "::" separator position
    expect(ab).not.toBe(ba);
  });
});

describe('generateContentHash', () => {
  it('returns a 64-character hex string (full SHA-256)', () => {
    const hash = generateContentHash('hello world');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    const a = generateContentHash('consistent input');
    const b = generateContentHash('consistent input');
    expect(a).toBe(b);
  });

  it('produces different hashes for different content', () => {
    const a = generateContentHash('content A');
    const b = generateContentHash('content B');
    expect(a).not.toBe(b);
  });

  it('is case-sensitive (no normalization unlike generatePatternHash)', () => {
    const lower = generateContentHash('hello');
    const upper = generateContentHash('HELLO');
    // generateContentHash does NOT normalize — content is raw
    expect(lower).not.toBe(upper);
  });

  it('handles empty string', () => {
    const hash = generateContentHash('');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('handles unicode content', () => {
    const hash = generateContentHash('こんにちは世界');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe('calculateSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(calculateSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 1 for two empty strings (empty union edge case)', () => {
    expect(calculateSimilarity('', '')).toBe(1);
  });

  it('returns 0 for completely disjoint word sets', () => {
    const score = calculateSimilarity('alpha beta gamma', 'delta epsilon zeta');
    expect(score).toBe(0);
  });

  it('returns a value between 0 and 1 for partial overlap', () => {
    const score = calculateSimilarity('the quick brown fox', 'the slow brown dog');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('has the correct Jaccard value for a known case', () => {
    // After normalization: 'a b' and 'a c'
    // intersection: {a}, union: {a, b, c} → score = 1/3
    const score = calculateSimilarity('a b', 'a c');
    expect(score).toBeCloseTo(1 / 3, 5);
  });

  it('is symmetric — similarity(A, B) == similarity(B, A)', () => {
    const ab = calculateSimilarity('hello world foo', 'world bar baz');
    const ba = calculateSimilarity('world bar baz', 'hello world foo');
    expect(ab).toBe(ba);
  });

  it('is case-insensitive', () => {
    const lower = calculateSimilarity('hello world', 'hello world');
    const mixed = calculateSimilarity('Hello World', 'HELLO WORLD');
    expect(lower).toBe(mixed);
  });

  it('ignores punctuation', () => {
    const withPunct = calculateSimilarity('hello, world!', 'hello world.');
    const withoutPunct = calculateSimilarity('hello world', 'hello world');
    expect(withPunct).toBe(withoutPunct);
  });

  it('treats repeated words as one (Set deduplication)', () => {
    // 'a a b' normalized and split → Set {a, b}
    // 'a b' → Set {a, b}
    // Both sets equal → similarity = 1
    const score = calculateSimilarity('a a b', 'a b');
    expect(score).toBe(1);
  });
});
