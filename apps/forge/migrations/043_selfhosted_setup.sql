-- Self-hosted setup: ensure required tables exist for single-user mode
-- The actual user seeding happens in code (forge startup) using env vars

-- Add selfhosted flag to track mode
ALTER TABLE forge_dispatcher_config ADD COLUMN IF NOT EXISTS selfhosted BOOLEAN DEFAULT false;
