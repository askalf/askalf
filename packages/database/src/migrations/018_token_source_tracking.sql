-- Migration 018: Add token source tracking to chat_messages
-- Tracks whether tokens came from BYOK keys or bundle credits

-- Add token_source column to track where tokens came from
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS token_source VARCHAR(20) DEFAULT 'unknown';

-- Create index for efficient filtering
CREATE INDEX IF NOT EXISTS idx_chat_messages_token_source ON chat_messages(token_source);

-- Update existing messages to have a reasonable default
-- Messages with shard_id likely used shards (no token cost)
-- Others are unknown since we can't retroactively determine source
UPDATE chat_messages
SET token_source = CASE
    WHEN shard_id IS NOT NULL THEN 'shard'
    ELSE 'unknown'
END
WHERE token_source IS NULL OR token_source = 'unknown';

COMMENT ON COLUMN chat_messages.token_source IS 'Source of tokens: byok, bundle, free_tier, shard, or unknown';
