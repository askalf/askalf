-- Migration 035: Agent Economy
-- Credit system, bounty marketplace, reputation tracking.

CREATE TABLE IF NOT EXISTS forge_agent_wallets (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE REFERENCES forge_agents(id) ON DELETE CASCADE,
  balance NUMERIC(10,4) DEFAULT 0,
  total_earned NUMERIC(10,4) DEFAULT 0,
  total_spent NUMERIC(10,4) DEFAULT 0,
  daily_spend_limit NUMERIC(10,4) DEFAULT 1.00,
  daily_spent NUMERIC(10,4) DEFAULT 0,
  daily_reset_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 day',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forge_agent_wallets_agent ON forge_agent_wallets(agent_id);

CREATE TABLE IF NOT EXISTS forge_agent_transactions (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT REFERENCES forge_agents(id),
  to_agent_id TEXT REFERENCES forge_agents(id),
  amount NUMERIC(10,6) NOT NULL,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'grant','payment','refund','penalty','reward'
  )),
  execution_id TEXT,
  bounty_id TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forge_agent_transactions_from ON forge_agent_transactions(from_agent_id);
CREATE INDEX IF NOT EXISTS idx_forge_agent_transactions_to ON forge_agent_transactions(to_agent_id);
CREATE INDEX IF NOT EXISTS idx_forge_agent_transactions_bounty ON forge_agent_transactions(bounty_id);

CREATE TABLE IF NOT EXISTS forge_bounties (
  id TEXT PRIMARY KEY,
  poster_agent_id TEXT NOT NULL REFERENCES forge_agents(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  required_capabilities TEXT[] DEFAULT '{}',
  reward_amount NUMERIC(10,4) NOT NULL,
  status TEXT DEFAULT 'open' CHECK (status IN (
    'open','assigned','in_progress','completed','failed','cancelled'
  )),
  assigned_agent_id TEXT REFERENCES forge_agents(id),
  execution_id TEXT,
  quality_score NUMERIC(3,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forge_bounties_status ON forge_bounties(status);
CREATE INDEX IF NOT EXISTS idx_forge_bounties_poster ON forge_bounties(poster_agent_id);
CREATE INDEX IF NOT EXISTS idx_forge_bounties_assigned ON forge_bounties(assigned_agent_id);

CREATE TABLE IF NOT EXISTS forge_agent_reputation (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE REFERENCES forge_agents(id) ON DELETE CASCADE,
  reputation_score NUMERIC(5,2) DEFAULT 50.00,
  total_completed INTEGER DEFAULT 0,
  total_failed INTEGER DEFAULT 0,
  reliability_score NUMERIC(3,2) DEFAULT 0.50,
  quality_score NUMERIC(3,2) DEFAULT 0.50,
  efficiency_score NUMERIC(3,2) DEFAULT 0.50,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forge_agent_reputation_agent ON forge_agent_reputation(agent_id);
CREATE INDEX IF NOT EXISTS idx_forge_agent_reputation_score ON forge_agent_reputation(reputation_score DESC);
