-- Migration 005: Seed existing data with multi-tenancy defaults
-- Sets visibility='public' for all existing data (backwards compatibility)
-- NULL owner_id = system/public data accessible to everyone

BEGIN;

-- Procedural shards: Set visibility to 'public' for existing shards
UPDATE procedural_shards
SET visibility = 'public'
WHERE visibility IS NULL;

-- Reasoning traces: Set visibility to 'public' for existing traces
UPDATE reasoning_traces
SET visibility = 'public'
WHERE visibility IS NULL;

-- Episodes: Set visibility to 'public' for existing episodes
UPDATE episodes
SET visibility = 'public'
WHERE visibility IS NULL;

-- Knowledge facts: Set visibility to 'public' for existing facts
UPDATE knowledge_facts
SET visibility = 'public'
WHERE visibility IS NULL;

-- Knowledge relations: Set visibility to 'public' for existing relations
UPDATE knowledge_relations
SET visibility = 'public'
WHERE visibility IS NULL;

-- Working contexts: Set visibility to 'public' for existing contexts
UPDATE working_contexts
SET visibility = 'public'
WHERE visibility IS NULL;

-- Create a system tenant if it doesn't exist
-- This tenant represents system-level/public resources
INSERT INTO tenants (id, name, tier, created_at, updated_at)
VALUES ('tenant_system', 'System', 'system', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Log migration completion
DO $$
DECLARE
  shards_updated INTEGER;
  traces_updated INTEGER;
  episodes_updated INTEGER;
  facts_updated INTEGER;
  relations_updated INTEGER;
  contexts_updated INTEGER;
BEGIN
  SELECT COUNT(*) INTO shards_updated FROM procedural_shards WHERE visibility = 'public' AND owner_id IS NULL;
  SELECT COUNT(*) INTO traces_updated FROM reasoning_traces WHERE visibility = 'public' AND owner_id IS NULL;
  SELECT COUNT(*) INTO episodes_updated FROM episodes WHERE visibility = 'public' AND owner_id IS NULL;
  SELECT COUNT(*) INTO facts_updated FROM knowledge_facts WHERE visibility = 'public' AND owner_id IS NULL;
  SELECT COUNT(*) INTO relations_updated FROM knowledge_relations WHERE visibility = 'public' AND owner_id IS NULL;
  SELECT COUNT(*) INTO contexts_updated FROM working_contexts WHERE visibility = 'public' AND owner_id IS NULL;

  RAISE NOTICE 'Migration 005 complete: % shards, % traces, % episodes, % facts, % relations, % contexts now public',
    shards_updated, traces_updated, episodes_updated, facts_updated, relations_updated, contexts_updated;
END $$;

COMMIT;
