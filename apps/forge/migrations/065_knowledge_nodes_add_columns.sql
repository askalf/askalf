-- Add missing columns to forge_knowledge_nodes that collective-memory.ts expects
ALTER TABLE forge_knowledge_nodes ADD COLUMN IF NOT EXISTS access_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE forge_knowledge_nodes ADD COLUMN IF NOT EXISTS confidence NUMERIC(4,2) NOT NULL DEFAULT 0.5;
ALTER TABLE forge_knowledge_nodes ADD COLUMN IF NOT EXISTS content TEXT;
