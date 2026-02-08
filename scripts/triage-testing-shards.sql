-- Triage 39 testing-lifecycle shards
-- Phase 1: Archive duplicates and useless shards (12)
-- Phase 2: Fix and promote valuable shards (9)

-- ═══════════════════════════════════════════════════
-- PHASE 1: ARCHIVE (duplicates of promoted shards + useless cognitive stubs)
-- ═══════════════════════════════════════════════════

UPDATE procedural_shards SET lifecycle = 'archived'
WHERE lifecycle = 'testing' AND name IN (
  -- Duplicates of basic-arithmetic (already promoted, handles +, -, *, /)
  'addition-calculator',
  'multiply-two-numbers',
  'subtraction-calculator',
  'division-question-parser',
  -- Duplicates of percentage-calculator (already promoted)
  'calculate-percentage',
  'percentage-of-number-calculator',
  -- Duplicate of square-root-calculator (already promoted)
  'extract-and-compute-square-root',
  -- Useless cognitive stubs (return hardcoded strings regardless of input)
  'latent-value-detector',
  'silence-interpretation-analyzer',
  'surface-intent-divergence',
  'tone-shift-detector',
  -- Hardcoded username "Thomas", not useful
  'friendly-greeting-response'
);

-- ═══════════════════════════════════════════════════
-- PHASE 2: FIX AND PROMOTE (9 valuable shards)
-- ═══════════════════════════════════════════════════

-- 1. sun-temperature-info - already great, promote as-is
UPDATE procedural_shards SET lifecycle = 'promoted'
WHERE name = 'sun-temperature-info' AND lifecycle = 'testing';

-- 2. check-if-number-is-prime - fix to handle more natural phrasing
UPDATE procedural_shards SET lifecycle = 'promoted', logic = '
function execute(input) {
  const m = input.match(/(\d+)/);
  if (!m) return "Could not parse a number from input";
  const num = parseInt(m[1], 10);
  if (num < 2) return num + " is not a prime number (primes start at 2).";
  for (let i = 2; i <= Math.sqrt(num); i++) {
    if (num % i === 0) return num + " is not prime. It is divisible by " + i + ".";
  }
  return num + " is a prime number.";
}
' WHERE name = 'check-if-number-is-prime' AND lifecycle = 'testing';

-- 3. power-calculation - fix to handle "X^Y", "X raised to Y", "X to the power of Y"
UPDATE procedural_shards SET lifecycle = 'promoted', logic = '
function execute(input) {
  let m = input.match(/(\d+)\s*(?:to the power of|\^|raised to(?: the)?)\s*(\d+)/i);
  if (!m) return "Could not parse base and exponent from input";
  const base = parseInt(m[1]);
  const exp = parseInt(m[2]);
  if (exp > 1000) return "Exponent too large";
  const result = Math.pow(base, exp);
  return result.toString();
}
' WHERE name = 'power-calculation' AND lifecycle = 'testing';

-- 4. explain-concept-simply - promote as-is (good content, good patterns)
UPDATE procedural_shards SET lifecycle = 'promoted'
WHERE name = 'explain-concept-simply' AND lifecycle = 'testing';

-- 5. haiku-generator - promote as-is (fun demo value)
UPDATE procedural_shards SET lifecycle = 'promoted'
WHERE name = 'haiku-generator' AND lifecycle = 'testing';

-- 6. email-validator - promote as-is (useful utility)
UPDATE procedural_shards SET lifecycle = 'promoted'
WHERE name = 'email-validator' AND lifecycle = 'testing';

-- 7. modulus-question-parser - fix regex for natural language
UPDATE procedural_shards SET lifecycle = 'promoted', logic = '
function execute(input) {
  let m = input.match(/(\d+)\s*(?:mod|modulo|%)\s*(\d+)/i);
  if (!m) { m = input.match(/(?:modulus|remainder)\s+(?:of\s+)?(\d+)\s+(?:and|divided by|by)\s+(\d+)/i); }
  if (!m) return "Could not parse two numbers from input";
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (b === 0) return "Cannot divide by zero";
  return (a % b).toString();
}
' WHERE name = 'modulus-question-parser' AND lifecycle = 'testing';

-- 8. convert-string-to-uppercase - fix for natural language
UPDATE procedural_shards SET lifecycle = 'promoted', logic = '
function execute(input) {
  let m = input.match(/["'']([^"'']+)["'']/);
  if (m) return m[1].toUpperCase();
  m = input.match(/(?:convert|change|make|transform)\s+(.+?)\s+to\s+uppercase/i);
  if (m) return m[1].replace(/["'']/g, "").toUpperCase();
  m = input.match(/uppercase\s+(?:of\s+)?(.+)/i);
  if (m) return m[1].replace(/["'']/g, "").toUpperCase();
  return input.toUpperCase();
}
' WHERE name = 'convert-string-to-uppercase' AND lifecycle = 'testing';

-- 9. absolute-value-calculator - fix for natural language
UPDATE procedural_shards SET lifecycle = 'promoted', logic = '
function execute(input) {
  const m = input.match(/(-?\d+\.?\d*)/);
  if (!m) return "Could not parse a number from input";
  const num = parseFloat(m[1]);
  const result = Math.abs(num);
  return result % 1 === 0 ? result.toString() : result.toFixed(2);
}
' WHERE name = 'absolute-value-calculator' AND lifecycle = 'testing';

-- ═══════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════

SELECT lifecycle, COUNT(*) as count FROM procedural_shards GROUP BY lifecycle ORDER BY lifecycle;
