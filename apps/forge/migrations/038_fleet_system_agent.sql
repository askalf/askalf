-- Migration 038: Fleet System Sentinel Agent
-- Inserts a sentinel row for the synthetic 'fleet:system' agent_id used by
-- mcp-tools memory_store when no agent_id is provided. Without this row,
-- FK constraints on forge_semantic_memories, forge_episodic_memories, and
-- forge_procedural_memories fail with a FK violation error.

INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, status, type,
  autonomy_level, enabled_tools, is_internal, metadata
) VALUES (
  'fleet:system',
  'system:forge',
  'Fleet System',
  'fleet-system',
  'Synthetic sentinel agent representing fleet-level memory with no specific agent owner. Used when memory_store is called without an agent_id.',
  'You are the fleet system memory store.',
  'active',
  'custom',
  0,
  '{}',
  true,
  '{"system_agent": true, "sentinel": true, "description": "Fleet-level memory sentinel. Not a real agent — exists solely to satisfy FK constraints for fleet:system memories."}'
) ON CONFLICT DO NOTHING;
