-- Migration 029: Performance indexes for reports feed
-- Supports the unified reports feed (findings + resolved tickets) and knowledge promotion

CREATE INDEX IF NOT EXISTS idx_agent_findings_created_at ON agent_findings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_findings_agent_name ON agent_findings(agent_name);
CREATE INDEX IF NOT EXISTS idx_agent_findings_category ON agent_findings(category);
CREATE INDEX IF NOT EXISTS idx_agent_tickets_resolved ON agent_tickets(updated_at DESC)
  WHERE status = 'resolved' AND resolution IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_facts_promoted_finding ON knowledge_facts(subject)
  WHERE subject LIKE 'finding:%' AND predicate = 'promoted_from';
