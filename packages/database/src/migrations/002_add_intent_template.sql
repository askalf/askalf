-- SUBSTRATE v1: Add Intent Template for proper clustering
-- This replaces pattern_hash as the primary clustering mechanism

-- Add intent_template column to reasoning_traces
ALTER TABLE reasoning_traces
ADD COLUMN IF NOT EXISTS intent_template TEXT;

-- Add index for clustering by intent template
CREATE INDEX IF NOT EXISTS idx_traces_intent_template
ON reasoning_traces(intent_template)
WHERE synthesized = false;

-- Add intent_template column to procedural_shards
-- Shards are now identified by intent template, not pattern hash
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS intent_template TEXT;

-- Add index for shard lookup by intent template
CREATE INDEX IF NOT EXISTS idx_shards_intent_template
ON procedural_shards(intent_template);

-- Add parameters column to store extracted parameters
ALTER TABLE reasoning_traces
ADD COLUMN IF NOT EXISTS intent_parameters JSONB DEFAULT '{}';

-- Comment explaining the change
COMMENT ON COLUMN reasoning_traces.intent_template IS
'Abstract template like "convert {amount} {from} to {to}" - used for clustering traces into shards';

COMMENT ON COLUMN reasoning_traces.pattern_hash IS
'DEPRECATED: Use intent_template instead. Kept for backwards compatibility.';
