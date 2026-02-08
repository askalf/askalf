-- SUBSTRATE v1: Working Memory Enhancements
-- Adds embedding, importance, and summary columns for context liquidation

-- Add embedding column for similarity search
ALTER TABLE working_contexts ADD COLUMN IF NOT EXISTS embedding VECTOR(1536);

-- Add importance score for retention priority
ALTER TABLE working_contexts ADD COLUMN IF NOT EXISTS importance REAL DEFAULT 0.5;

-- Add summary column for compressed context
ALTER TABLE working_contexts ADD COLUMN IF NOT EXISTS summary TEXT;

-- Create index for embedding similarity search
CREATE INDEX IF NOT EXISTS idx_working_embedding ON working_contexts USING hnsw (embedding vector_cosine_ops);

-- Create index for importance-based queries
CREATE INDEX IF NOT EXISTS idx_working_importance ON working_contexts(importance DESC);
