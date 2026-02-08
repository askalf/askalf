-- Migration 021: Shard Knowledge Types & TTL
-- Adds knowledge classification, expiration, and verification tracking
-- to support the shard evolution system (Layer 1)

-- Knowledge type classification
-- immutable: facts that never change (math, physics constants, conversions)
-- temporal: facts that change over time (API docs, pricing, versions)
-- contextual: subjective/opinion-based (never auto-promote)
-- procedural: how-to knowledge that may need version updates
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS knowledge_type VARCHAR(20) DEFAULT 'procedural';

-- TTL / expiration for temporal knowledge
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ DEFAULT NULL;

-- Verification tracking
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NULL;

ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS verification_count INTEGER DEFAULT 0;

ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS verification_status VARCHAR(20) DEFAULT 'unverified';

-- Source provenance tracking
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS source_url TEXT DEFAULT NULL;

ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS source_type VARCHAR(30) DEFAULT NULL;

-- Category for domain grouping (math, science, programming, etc.)
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS category VARCHAR(64) DEFAULT NULL;

-- Add constraint for knowledge_type
-- Note: Using DO block since ALTER TABLE ADD CONSTRAINT IF NOT EXISTS isn't available
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_knowledge_type'
  ) THEN
    ALTER TABLE procedural_shards
    ADD CONSTRAINT valid_knowledge_type CHECK (
      knowledge_type IN ('immutable', 'temporal', 'contextual', 'procedural')
    );
  END IF;
END $$;

-- Add constraint for verification_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'valid_verification_status'
  ) THEN
    ALTER TABLE procedural_shards
    ADD CONSTRAINT valid_verification_status CHECK (
      verification_status IN ('unverified', 'verified', 'expired', 'challenged', 'failed')
    );
  END IF;
END $$;

-- Indexes for knowledge type queries
CREATE INDEX IF NOT EXISTS idx_shards_knowledge_type
ON procedural_shards(knowledge_type);

CREATE INDEX IF NOT EXISTS idx_shards_expires_at
ON procedural_shards(expires_at)
WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shards_verification_status
ON procedural_shards(verification_status);

CREATE INDEX IF NOT EXISTS idx_shards_category
ON procedural_shards(category)
WHERE category IS NOT NULL;

-- Index for finding expired temporal shards needing verification
CREATE INDEX IF NOT EXISTS idx_shards_needs_verification
ON procedural_shards(expires_at, verification_status)
WHERE knowledge_type = 'temporal'
  AND lifecycle = 'promoted'
  AND expires_at IS NOT NULL;

-- Comments
COMMENT ON COLUMN procedural_shards.knowledge_type IS
'Classification of knowledge durability:
- immutable: Never changes (math, constants). No TTL, no decay.
- temporal: Changes over time (APIs, pricing). Has TTL, needs verification.
- contextual: Subjective/opinion. Never auto-promoted.
- procedural: How-to knowledge. May need version updates.';

COMMENT ON COLUMN procedural_shards.expires_at IS
'When temporal knowledge should be re-verified. NULL for immutable/contextual.';

COMMENT ON COLUMN procedural_shards.verification_status IS
'Current verification state:
- unverified: Default, never checked
- verified: Passed verification challenge
- expired: Past expires_at, needs re-verification
- challenged: Currently being re-verified
- failed: Failed verification, should not be served';

COMMENT ON COLUMN procedural_shards.source_url IS
'Original source URL for temporal knowledge (for re-verification)';

COMMENT ON COLUMN procedural_shards.source_type IS
'Source classification: documentation, api, user_input, crystallized, manual';

COMMENT ON COLUMN procedural_shards.category IS
'Domain category: math, science, programming, cooking, general, etc.';

-- ============================================
-- BACKFILL: Classify existing shards by name heuristics
-- ============================================

-- Immutable knowledge: math, conversions, constants, physics
UPDATE procedural_shards
SET knowledge_type = 'immutable',
    verification_status = 'verified'
WHERE knowledge_type = 'procedural'
  AND (
    LOWER(name) ~ '(convert|calculator|math|formula|constant|unit|celsius|fahrenheit|kilometer|pound|kilogram|currency-convert)'
    OR LOWER(name) ~ '(pi-value|speed-of-light|boiling-point|freezing-point|gravity|avogadro)'
    OR LOWER(name) ~ '(binary-to|decimal-to|hex-to|octal-to|ascii)'
  );

-- Temporal knowledge: APIs, versions, pricing, documentation, dates
UPDATE procedural_shards
SET knowledge_type = 'temporal',
    expires_at = NOW() + INTERVAL '30 days'
WHERE knowledge_type = 'procedural'
  AND (
    LOWER(name) ~ '(api-version|api-doc|pricing|current-version|latest-release|changelog)'
    OR LOWER(name) ~ '(deprecat|end-of-life|support-end|release-date)'
    OR LOWER(name) ~ '(weather|stock|market-data|exchange-rate)'
  );

-- Contextual knowledge: opinions, preferences, subjective assessments
UPDATE procedural_shards
SET knowledge_type = 'contextual'
WHERE knowledge_type = 'procedural'
  AND (
    LOWER(name) ~ '(opinion|recommend|best-practice|preference|comparison|review|rating)'
    OR LOWER(name) ~ '(should-i|which-is-better|pros-cons)'
  );

-- Set category based on name patterns
UPDATE procedural_shards SET category = 'math'
WHERE category IS NULL AND LOWER(name) ~ '(math|calculator|formula|equation|algebra|calculus|geometry|trig)';

UPDATE procedural_shards SET category = 'science'
WHERE category IS NULL AND LOWER(name) ~ '(physics|chemistry|biology|science|element|molecule|atom)';

UPDATE procedural_shards SET category = 'programming'
WHERE category IS NULL AND LOWER(name) ~ '(code|program|function|api|database|sql|regex|http|json|git)';

UPDATE procedural_shards SET category = 'conversion'
WHERE category IS NULL AND LOWER(name) ~ '(convert|unit|celsius|fahrenheit|kilometer|pound|kilogram|meter|mile|gallon|liter)';

UPDATE procedural_shards SET category = 'general'
WHERE category IS NULL AND lifecycle = 'promoted';
