-- Multi-tenant workspaces: Alf Personal / Alf Business
-- Users can have multiple tenants (workspaces) with isolated agents, memory, and budgets

-- Expand tenants table with workspace features
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS icon TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS use_case TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS budget_limit_daily NUMERIC(10,2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS budget_limit_monthly NUMERIC(10,2);

-- Tenant members (who belongs to which workspace)
CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner',  -- owner, admin, member, viewer
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, user_id)
);

-- Link existing admin to existing tenant
INSERT INTO tenant_members (tenant_id, user_id, role)
SELECT 'selfhosted', 'selfhosted-admin', 'owner'
WHERE NOT EXISTS (SELECT 1 FROM tenant_members WHERE tenant_id = 'selfhosted' AND user_id = 'selfhosted-admin');

-- Add tenant_id to forge_agents (nullable for migration, default to existing tenant)
ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE forge_agents SET tenant_id = 'selfhosted' WHERE tenant_id IS NULL;

-- Add tenant_id to forge_executions
ALTER TABLE forge_executions ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE forge_executions SET tenant_id = 'selfhosted' WHERE tenant_id IS NULL;

-- Add tenant_id to memory tables
ALTER TABLE forge_semantic_memories ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE forge_semantic_memories SET tenant_id = 'selfhosted' WHERE tenant_id IS NULL;

ALTER TABLE forge_episodic_memories ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE forge_episodic_memories SET tenant_id = 'selfhosted' WHERE tenant_id IS NULL;

ALTER TABLE forge_procedural_memories ADD COLUMN IF NOT EXISTS tenant_id TEXT;
UPDATE forge_procedural_memories SET tenant_id = 'selfhosted' WHERE tenant_id IS NULL;

-- Indexes for tenant-scoped queries
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON forge_agents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_executions_tenant ON forge_executions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_semantic_tenant ON forge_semantic_memories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_episodic_tenant ON forge_episodic_memories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_procedural_tenant ON forge_procedural_memories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_members_user ON tenant_members(user_id);
