-- 063: Relax foreign key constraints on memory tables
-- Memory stores should succeed even if the agent is deleted or not registered.
-- The agent_id is kept for grouping/filtering but doesn't need referential integrity.

ALTER TABLE forge_procedural_memories DROP CONSTRAINT IF EXISTS forge_procedural_memories_agent_id_fkey;
ALTER TABLE forge_semantic_memories DROP CONSTRAINT IF EXISTS forge_semantic_memories_agent_id_fkey;
ALTER TABLE forge_episodic_memories DROP CONSTRAINT IF EXISTS forge_episodic_memories_agent_id_fkey;
