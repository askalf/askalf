-- 028_ticket_resolution.sql
-- Add dedicated resolution column to agent_tickets.
-- Previously resolution was stored in metadata jsonb which made it hard to query.

ALTER TABLE agent_tickets ADD COLUMN IF NOT EXISTS resolution TEXT;

-- Migrate existing resolutions from metadata jsonb into the new column
UPDATE agent_tickets
SET resolution = metadata->>'resolution'
WHERE metadata->>'resolution' IS NOT NULL
  AND resolution IS NULL;
