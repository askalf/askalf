-- Migration 016: Change Proposals (ADR-001 Phase 1)
-- Agent code review pipeline: proposals + reviews tables

-- ============================================
-- forge_change_proposals
-- ============================================

CREATE TABLE IF NOT EXISTS forge_change_proposals (
  id              TEXT PRIMARY KEY,
  proposal_type   TEXT NOT NULL CHECK (proposal_type IN ('prompt_revision', 'code_change', 'config_change', 'schema_change')),
  title           TEXT NOT NULL,
  description     TEXT,
  author_agent_id TEXT NOT NULL REFERENCES forge_agents(id),

  -- Change content (populated based on proposal_type)
  prompt_revision_id TEXT REFERENCES forge_prompt_revisions(id),
  file_changes    JSONB DEFAULT '[]',
  config_changes  JSONB DEFAULT '{}',

  -- Target
  target_agent_id TEXT REFERENCES forge_agents(id),
  target_branch   TEXT DEFAULT 'main',

  -- Workflow state
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'approved', 'rejected', 'revision_requested', 'applied', 'closed')),
  required_reviews INTEGER NOT NULL DEFAULT 1,
  risk_level      TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),

  -- Execution context
  execution_id    TEXT REFERENCES forge_executions(id),
  checkpoint_id   TEXT REFERENCES forge_checkpoints(id),

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at      TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON forge_change_proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_author ON forge_change_proposals(author_agent_id);
CREATE INDEX IF NOT EXISTS idx_proposals_target ON forge_change_proposals(target_agent_id);
CREATE INDEX IF NOT EXISTS idx_proposals_type ON forge_change_proposals(proposal_type);

-- ============================================
-- forge_proposal_reviews
-- ============================================

CREATE TABLE IF NOT EXISTS forge_proposal_reviews (
  id                TEXT PRIMARY KEY,
  proposal_id       TEXT NOT NULL REFERENCES forge_change_proposals(id),
  reviewer_agent_id TEXT NOT NULL REFERENCES forge_agents(id),

  verdict           TEXT NOT NULL CHECK (verdict IN ('approve', 'reject', 'request_changes', 'comment')),
  comment           TEXT,
  suggestions       JSONB DEFAULT '[]',

  -- Automated analysis results
  analysis          JSONB DEFAULT '{}',

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reviews_proposal ON forge_proposal_reviews(proposal_id);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer ON forge_proposal_reviews(reviewer_agent_id);
