-- Migration 038: Insert fleet:system sentinel row in forge_agents
-- Fixes FK violation: forge_semantic_memories/forge_episodic_memories/forge_procedural_memories
-- use agent_id='fleet:system' as default when no agent_id is supplied to memory_store.
-- This sentinel row satisfies the FK constraint without changing the memory store logic.

INSERT INTO forge_agents (
  id,
  owner_id,
  name,
  slug,
  description,
  system_prompt,
  model_id,
  autonomy_level,
  enabled_tools,
  status,
  type,
  is_internal,
  max_iterations,
  max_tokens_per_turn,
  max_cost_per_execution,
  memory_config,
  metadata
) VALUES (
  'fleet:system',
  'system:forge',
  'Fleet System',
  'fleet-system',
  'Sentinel row representing fleet-level memory entries not attributed to a specific agent.',
  'Fleet-level system agent. Not dispatched.',
  NULL,
  0,
  ARRAY[]::text[],
  'active',
  'custom',
  true,
  0,
  0,
  0.00,
  '{"enableWorking": false, "enableSemantic": false, "enableEpisodic": false, "enableProcedural": false}'::jsonb,
  '{"system_agent": true, "sentinel": true}'::jsonb
) ON CONFLICT (id) DO NOTHING;
