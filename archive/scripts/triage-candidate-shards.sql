-- Triage 46 candidate-lifecycle shards
-- Phase 1: Archive 42 (15 duplicates + 25 cognitive stubs + 2 too-broad)
-- Phase 2: Fix and promote 4 useful utilities

-- ═══════════════════════════════════════════════════
-- PHASE 1A: ARCHIVE DUPLICATES (15)
-- ═══════════════════════════════════════════════════

UPDATE procedural_shards SET lifecycle = 'archived'
WHERE lifecycle = 'candidate' AND name IN (
  -- Duplicates of basic-arithmetic (handles +, -, *, /)
  'division-calculator',
  'multiply-two-numbers-from-natural-language',
  'multiply-two-numbers-from-question',
  'natural-language-division-parser',
  'natural-language-subtraction-parser',
  'simple-addition-question-parser',
  -- Duplicates of convert-string-to-uppercase (already promoted)
  'convert-text-to-uppercase',
  'convert-to-uppercase',
  'uppercase-string-request',
  -- Duplicate of title-case / lowercase (testing)
  'convert-string-to-lowercase',
  -- Duplicates of reverse-string-procedure (already promoted)
  'reverse-string',
  'reverse-string-in-request',
  'string-reversal',
  -- Duplicates of email-validator (already promoted)
  'extract-email-from-text',
  'extract-email-from-text-request'
);

-- ═══════════════════════════════════════════════════
-- PHASE 1B: ARCHIVE COGNITIVE/PHILOSOPHICAL STUBS (25)
-- These return hardcoded wisdom phrases, not useful for demo
-- ═══════════════════════════════════════════════════

UPDATE procedural_shards SET lifecycle = 'archived'
WHERE lifecycle = 'candidate' AND name IN (
  'assumption-clarification',
  'belief-update-response',
  'blind-spot-acknowledgment',
  'communication-wisdom-transformer',
  'confidence-correctness-distinction',
  'consistency-beats-intensity-normalizer',
  'detect-overconfidence-bias',
  'irreversibility-warning-transformer',
  'knowledge-boundary-reflection',
  'life-lesson-extractor',
  'map-familiarity-to-pattern-matching',
  'overconfidence-detector',
  'paraphrase-repeated-requests-to-priority',
  'precedence-effective-paraphrase',
  'principle-reframer',
  'reframe-uncertainty-as-data',
  'repeated-mistake-pattern-analyzer',
  'resistance-insight-responder',
  'rushed-failure-to-wisdom-transformer',
  'success-patience-insight-extractor',
  'temporal-relevance-summarizer',
  'temporal-truth-generalizer',
  'transform-negative-to-positive-wisdom',
  'uncertainty-acknowledgment-responder',
  'underconfidence-detector'
);

-- ═══════════════════════════════════════════════════
-- PHASE 1C: ARCHIVE TOO-BROAD (2)
-- ═══════════════════════════════════════════════════

UPDATE procedural_shards SET lifecycle = 'archived'
WHERE lifecycle = 'candidate' AND name IN (
  -- Patterns: "smallest", "minimum", "min of", "least" — match way too much
  'find-minimum-number',
  -- find-longest-word already in testing, patterns too broad for candidate
  'find-longest-word'
);

-- ═══════════════════════════════════════════════════
-- PHASE 2: FIX AND PROMOTE (4 useful utilities)
-- ═══════════════════════════════════════════════════

-- 1. find-maximum-number - tighten patterns, fix logic
UPDATE procedural_shards SET lifecycle = 'promoted',
patterns = '["(?:biggest|largest|maximum|max) (?:number|value) (?:in|of|from|among)", "find (?:the )?(?:max|maximum|largest|biggest)", "what is the (?:max|maximum|largest|biggest) (?:in|of|from)"]',
logic = '
function execute(input) {
  const nums = input.match(/-?\d+\.?\d*/g);
  if (!nums || nums.length === 0) return "No numbers found in input";
  const values = nums.map(Number);
  const max = Math.max(...values);
  return "The maximum value is " + max + ".";
}
' WHERE name = 'find-maximum-number' AND lifecycle = 'candidate';

-- 2. median-of-numbers - clean up
UPDATE procedural_shards SET lifecycle = 'promoted',
logic = '
function execute(input) {
  const matches = input.match(/-?\d+\.?\d*/g);
  if (!matches || matches.length === 0) return "No numbers found in input";
  const nums = matches.map(Number).sort((a, b) => a - b);
  const mid = Math.floor(nums.length / 2);
  const median = nums.length % 2 === 0
    ? (nums[mid - 1] + nums[mid]) / 2
    : nums[mid];
  return "The median is " + median + ".";
}
' WHERE name = 'median-of-numbers-from-natural-language-request' AND lifecycle = 'candidate';

-- 3. remove-duplicates-from-list - clean up
UPDATE procedural_shards SET lifecycle = 'promoted',
logic = '
function execute(input) {
  const m = input.match(/(?:remove duplicates|deduplicate|get unique|unique values?)\s*(?:from|of|in|:)?\s*(.+)/i);
  if (!m) return "Could not parse list from input";
  const items = m[1].split(/[,;]+/).map(function(s) { return s.trim(); }).filter(Boolean);
  const unique = [];
  const seen = {};
  for (var i = 0; i < items.length; i++) {
    var lower = items[i].toLowerCase();
    if (!seen[lower]) { seen[lower] = true; unique.push(items[i]); }
  }
  return unique.join(", ");
}
' WHERE name = 'remove-duplicates-from-list' AND lifecycle = 'candidate';

-- 4. sort-numbers-ascending - tighten patterns, fix logic
UPDATE procedural_shards SET lifecycle = 'promoted',
patterns = '["(?:sort|arrange|put|order).*(?:numbers?|values?|list).*(?:ascending|order|smallest|least)", "sort.*ascending", "arrange.*order"]',
logic = '
function execute(input) {
  const nums = input.match(/-?\d+\.?\d*/g);
  if (!nums || nums.length === 0) return "No numbers found in input";
  const sorted = nums.map(Number).sort((a, b) => a - b);
  return sorted.join(", ");
}
' WHERE name = 'sort-numbers-ascending' AND lifecycle = 'candidate';

-- ═══════════════════════════════════════════════════
-- VERIFICATION
-- ═══════════════════════════════════════════════════

SELECT lifecycle, COUNT(*) as count FROM procedural_shards GROUP BY lifecycle ORDER BY lifecycle;
