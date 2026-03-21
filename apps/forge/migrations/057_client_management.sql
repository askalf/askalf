-- Revenue Mode: Client management for agencies/freelancers
-- Track clients, billable work, and generate invoices from agent executions.

CREATE TABLE IF NOT EXISTS forge_clients (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  company TEXT,
  billing_rate_hourly NUMERIC(10,2),       -- $/hr for billable work
  billing_markup NUMERIC(4,2) DEFAULT 1.0, -- multiplier on AI costs (1.5 = 50% markup)
  notes TEXT,
  status TEXT DEFAULT 'active',            -- active, paused, archived
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS forge_client_projects (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES forge_clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  budget_cap NUMERIC(10,2),              -- max total spend
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Link executions to client projects for billing
ALTER TABLE forge_executions ADD COLUMN IF NOT EXISTS client_project_id TEXT;
ALTER TABLE forge_executions ADD COLUMN IF NOT EXISTS is_billable BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS forge_invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES forge_clients(id),
  project_id TEXT REFERENCES forge_client_projects(id),
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_ai_cost NUMERIC(10,4) DEFAULT 0,
  total_billable NUMERIC(10,2) DEFAULT 0,
  execution_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft',           -- draft, sent, paid, void
  notes TEXT,
  line_items JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clients_owner ON forge_clients(owner_id);
CREATE INDEX IF NOT EXISTS idx_client_projects_client ON forge_client_projects(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_client ON forge_invoices(client_id);
CREATE INDEX IF NOT EXISTS idx_executions_client_project ON forge_executions(client_project_id) WHERE client_project_id IS NOT NULL;
