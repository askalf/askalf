-- Soft delete for agents
-- Adds deleted_at column; queries must filter WHERE deleted_at IS NULL
-- Existing archived rows keep deleted_at NULL (archived != deleted)

ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_forge_agents_deleted_at ON forge_agents(deleted_at) WHERE deleted_at IS NULL;
