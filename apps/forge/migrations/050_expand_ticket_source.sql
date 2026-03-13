-- Expand agent_tickets source constraint to include all valid sources
ALTER TABLE agent_tickets DROP CONSTRAINT IF EXISTS agent_tickets_source_check;
ALTER TABLE agent_tickets ADD CONSTRAINT agent_tickets_source_check
  CHECK (source = ANY (ARRAY['human','agent','reactive','system','auto_from_finding','autonomy-loop','nl_dispatch','monitoring']));
