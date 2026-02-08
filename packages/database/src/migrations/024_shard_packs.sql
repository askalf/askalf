-- Migration 024: Shard Packs
-- Curated knowledge pack system for sharing and installing bundles of shards

-- Pack definitions
CREATE TABLE IF NOT EXISTS shard_packs (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  slug VARCHAR(128) NOT NULL UNIQUE,
  description TEXT,
  category VARCHAR(64),
  version INTEGER DEFAULT 1,
  shard_count INTEGER DEFAULT 0,
  total_estimated_tokens INTEGER DEFAULT 0,
  author VARCHAR(128) DEFAULT 'ALF',
  is_featured BOOLEAN DEFAULT FALSE,
  is_public BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Shards within a pack (references by shard name for portability)
CREATE TABLE IF NOT EXISTS shard_pack_items (
  id VARCHAR(64) PRIMARY KEY,
  pack_id VARCHAR(64) NOT NULL REFERENCES shard_packs(id) ON DELETE CASCADE,
  shard_name VARCHAR(256) NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shard_pack_items_pack ON shard_pack_items(pack_id);

-- Track which tenants have installed which packs
CREATE TABLE IF NOT EXISTS shard_pack_installs (
  id VARCHAR(64) PRIMARY KEY,
  pack_id VARCHAR(64) NOT NULL REFERENCES shard_packs(id),
  tenant_id VARCHAR(64) NOT NULL,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pack_id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_shard_pack_installs_tenant ON shard_pack_installs(tenant_id);

-- Seed featured packs from existing shard categories
INSERT INTO shard_packs (id, name, slug, description, category, is_featured) VALUES
  ('pack_science', 'Science Essentials', 'science-essentials',
   'Core science knowledge: physics, chemistry, biology fundamentals and common questions.',
   'science', true),
  ('pack_math', 'Math & Conversions', 'math-conversions',
   'Mathematical operations, unit conversions, and everyday calculations.',
   'math', true),
  ('pack_tech', 'Tech Foundations', 'tech-foundations',
   'Technology concepts: programming basics, cloud computing, networking, and cybersecurity.',
   'technology', true),
  ('pack_health', 'Health & Wellness', 'health-wellness',
   'Health fundamentals: vital signs, nutrition basics, common medical questions.',
   'health', true),
  ('pack_geo', 'World Geography', 'world-geography',
   'Countries, capitals, populations, and geographic facts.',
   'geography', true),
  ('pack_history', 'History Highlights', 'history-highlights',
   'Key historical events, inventions, and figures.',
   'history', true),
  ('pack_finance', 'Personal Finance', 'personal-finance',
   'Financial literacy: interest, taxes, investing basics, and money management.',
   'finance', true),
  ('pack_language', 'Language & Grammar', 'language-grammar',
   'Grammar rules, vocabulary, writing tips, and language concepts.',
   'language', true)
ON CONFLICT (id) DO NOTHING;

-- Populate pack items from existing promoted shards
INSERT INTO shard_pack_items (id, pack_id, shard_name, display_order)
SELECT
  'spi_' || SUBSTRING(ps.id FROM 1 FOR 20) || '_' || ROW_NUMBER() OVER (PARTITION BY ps.category ORDER BY ps.confidence DESC),
  CASE ps.category
    WHEN 'science' THEN 'pack_science'
    WHEN 'math' THEN 'pack_math'
    WHEN 'conversion' THEN 'pack_math'
    WHEN 'technology' THEN 'pack_tech'
    WHEN 'programming' THEN 'pack_tech'
    WHEN 'health' THEN 'pack_health'
    WHEN 'geography' THEN 'pack_geo'
    WHEN 'history' THEN 'pack_history'
    WHEN 'finance' THEN 'pack_finance'
    WHEN 'language' THEN 'pack_language'
  END,
  ps.name,
  ROW_NUMBER() OVER (PARTITION BY ps.category ORDER BY ps.confidence DESC)
FROM procedural_shards ps
WHERE ps.lifecycle = 'promoted'
  AND ps.category IN ('science', 'math', 'conversion', 'technology', 'programming', 'health', 'geography', 'history', 'finance', 'language')
ON CONFLICT (id) DO NOTHING;

-- Update shard counts on packs
UPDATE shard_packs SET
  shard_count = (SELECT COUNT(*) FROM shard_pack_items WHERE pack_id = shard_packs.id),
  total_estimated_tokens = COALESCE((
    SELECT SUM(ps.estimated_tokens)
    FROM shard_pack_items spi
    JOIN procedural_shards ps ON ps.name = spi.shard_name AND ps.lifecycle = 'promoted'
    WHERE spi.pack_id = shard_packs.id
  ), 0);
