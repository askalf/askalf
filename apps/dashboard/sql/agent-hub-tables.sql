-- Agent Hub tables for substrate database
-- Run via: docker exec sprayberry-labs-postgres psql -U substrate -d substrate -f /tmp/agent-hub-tables.sql
-- Or paste into: docker exec -it sprayberry-labs-postgres psql -U substrate -d substrate

CREATE TABLE IF NOT EXISTS agent_interventions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL DEFAULT '',
  agent_type TEXT NOT NULL DEFAULT 'custom',
  task_id TEXT,
  type TEXT NOT NULL DEFAULT 'approval',
  title TEXT NOT NULL,
  description TEXT,
  context JSONB DEFAULT '{}',
  proposed_action TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied', 'resolved')),
  human_response TEXT,
  responded_by TEXT,
  responded_at TIMESTAMPTZ,
  autonomy_delta NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interventions_agent_id ON agent_interventions(agent_id);
CREATE INDEX IF NOT EXISTS idx_interventions_status ON agent_interventions(status);
CREATE INDEX IF NOT EXISTS idx_interventions_task_id ON agent_interventions(task_id);
CREATE INDEX IF NOT EXISTS idx_interventions_created_at ON agent_interventions(created_at DESC);

CREATE TABLE IF NOT EXISTS agent_tickets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  priority TEXT NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  category TEXT,
  created_by TEXT,
  assigned_to TEXT,
  agent_id TEXT,
  agent_name TEXT,
  is_agent_ticket BOOLEAN DEFAULT false,
  source TEXT NOT NULL DEFAULT 'human'
    CHECK (source IN ('human', 'agent')),
  task_id TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status ON agent_tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_source ON agent_tickets(source);
CREATE INDEX IF NOT EXISTS idx_tickets_assigned_to ON agent_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_agent_id ON agent_tickets(agent_id);
CREATE INDEX IF NOT EXISTS idx_tickets_created_at ON agent_tickets(created_at DESC);

CREATE TABLE IF NOT EXISTS agent_schedules (
  agent_id TEXT PRIMARY KEY,
  schedule_type TEXT NOT NULL DEFAULT 'manual'
    CHECK (schedule_type IN ('manual', 'scheduled', 'continuous')),
  schedule_interval_minutes INTEGER,
  next_run_at TIMESTAMPTZ,
  is_continuous BOOLEAN DEFAULT false,
  last_run_at TIMESTAMPTZ,
  tenant_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_schedules_tenant ON agent_schedules(tenant_id);
