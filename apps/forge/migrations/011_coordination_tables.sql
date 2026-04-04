-- Migration 011: Coordination Tables
-- These tables back the coordination admin routes and TeamManager sessions.
-- They were referenced in code but never had a CREATE TABLE migration.

CREATE TABLE IF NOT EXISTS coordination_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  pattern TEXT NOT NULL CHECK (pattern IN ('pipeline', 'fan-out', 'consensus')),
  lead_agent_id TEXT NOT NULL,
  lead_agent_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'cancelled')),
  summary TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coordination_tasks (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES coordination_sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  assigned_agent TEXT NOT NULL,
  assigned_agent_id TEXT,
  dependencies TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  result TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_coordination_tasks_session_id ON coordination_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_coordination_tasks_status ON coordination_tasks(status);
CREATE INDEX IF NOT EXISTS idx_coordination_sessions_status ON coordination_sessions(status);
CREATE INDEX IF NOT EXISTS idx_coordination_sessions_lead_agent ON coordination_sessions(lead_agent_id);
