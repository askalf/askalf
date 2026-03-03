-- Migration 036: Agent-to-Agent Relationships
-- Persistent relationships with trust scores, and durable message storage.

CREATE TABLE IF NOT EXISTS forge_agent_relationships (
  id TEXT PRIMARY KEY,
  agent_a_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  agent_b_id TEXT NOT NULL REFERENCES forge_agents(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN (
    'peer','supervisor','subordinate','mentor','collaborator'
  )),
  trust_score NUMERIC(3,2) DEFAULT 0.50,
  interaction_count INTEGER DEFAULT 0,
  last_interaction TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(agent_a_id, agent_b_id)
);

CREATE INDEX IF NOT EXISTS idx_forge_agent_relationships_a ON forge_agent_relationships(agent_a_id);
CREATE INDEX IF NOT EXISTS idx_forge_agent_relationships_b ON forge_agent_relationships(agent_b_id);

CREATE TABLE IF NOT EXISTS forge_agent_messages (
  id TEXT PRIMARY KEY,
  from_agent_id TEXT NOT NULL REFERENCES forge_agents(id),
  to_agent_id TEXT NOT NULL REFERENCES forge_agents(id),
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  in_reply_to TEXT REFERENCES forge_agent_messages(id),
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_forge_agent_messages_to ON forge_agent_messages(to_agent_id, read_at);
CREATE INDEX IF NOT EXISTS idx_forge_agent_messages_from ON forge_agent_messages(from_agent_id);
CREATE INDEX IF NOT EXISTS idx_forge_agent_messages_reply ON forge_agent_messages(in_reply_to);
