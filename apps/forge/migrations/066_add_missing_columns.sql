-- Add tenant_id to forge_semantic_memories (used by dream-cycle, federation, natural-selection, reputation, watcher)
ALTER TABLE forge_semantic_memories ADD COLUMN IF NOT EXISTS tenant_id TEXT DEFAULT 'selfhosted';

-- Add budget columns to tenants (used by budget enforcement)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS budget_limit_daily NUMERIC(10,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS budget_limit_monthly NUMERIC(10,2);
