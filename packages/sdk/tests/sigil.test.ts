import { describe, it, expect } from 'vitest';
import { parseHumanCommand, validateSigil } from '../../sigil/src/index.js';

describe('sigil utilities', () => {
  it('parses human command to surface SIGIL', () => {
    const parsed = parseHumanCommand('/remember #critical rotate keys monthly');
    expect(parsed).toBeTruthy();
    expect(parsed?.surface.startsWith('[KNO.SET')).toBe(true);
    expect(validateSigil(parsed!.surface).valid).toBe(true);
  });

  it('rejects invalid SIGIL structure', () => {
    const invalid = validateSigil('not-sigil');
    expect(invalid.valid).toBe(false);
  });
});