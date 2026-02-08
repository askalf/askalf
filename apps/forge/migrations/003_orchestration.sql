-- Forge Orchestration
-- Workflows, workflow runs, checkpoints
-- Apply: psql -U substrate -d forge -f 003_orchestration.sql

-- ============================================
-- WORKFLOWS (DAG definitions)
-- ============================================

CREATE TABLE IF NOT EXISTS forge_workflows (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  definition JSONB NOT NULL DEFAULT '{"nodes": [], "edges": []}',
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  is_public BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(owner_id, slug)
);

CREATE INDEX idx_forge_workflows_owner ON forge_workflows(owner_id);
CREATE INDEX idx_forge_workflows_status ON forge_workflows(status);

-- ============================================
-- WORKFLOW RUNS
-- ============================================

CREATE TABLE IF NOT EXISTS forge_workflow_runs (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES forge_workflows(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled', 'paused')),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,
  node_states JSONB NOT NULL DEFAULT '{}',
  shared_context JSONB NOT NULL DEFAULT '{}',
  current_node TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_workflow_runs_workflow ON forge_workflow_runs(workflow_id);
CREATE INDEX idx_forge_workflow_runs_owner ON forge_workflow_runs(owner_id);
CREATE INDEX idx_forge_workflow_runs_status ON forge_workflow_runs(status);

-- ============================================
-- CHECKPOINTS (human-in-the-loop)
-- ============================================

CREATE TABLE IF NOT EXISTS forge_checkpoints (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT REFERENCES forge_workflow_runs(id) ON DELETE CASCADE,
  execution_id TEXT REFERENCES forge_executions(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('approval', 'review', 'input', 'confirmation')),
  title TEXT NOT NULL,
  description TEXT,
  context JSONB NOT NULL DEFAULT '{}',
  response JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'responded', 'timeout')),
  timeout_at TIMESTAMPTZ,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_checkpoints_owner ON forge_checkpoints(owner_id);
CREATE INDEX idx_forge_checkpoints_status ON forge_checkpoints(status) WHERE status = 'pending';
CREATE INDEX idx_forge_checkpoints_workflow_run ON forge_checkpoints(workflow_run_id);

-- Triggers
CREATE TRIGGER trg_forge_workflows_updated
  BEFORE UPDATE ON forge_workflows
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();
