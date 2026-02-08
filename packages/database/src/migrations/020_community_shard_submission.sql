-- Migration 020: Community shard submission workflow
-- Adds community_status field for user-submitted shards approval process

-- Add community_status column for submission workflow
-- NULL = not applicable (ALF Public or Private)
-- 'draft' = user is working on it
-- 'submitted' = user submitted for review
-- 'approved' = approved for Community Public
-- 'rejected' = rejected from Community Public
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS community_status VARCHAR(20) DEFAULT NULL;

-- Add submitted_at timestamp
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT NULL;

-- Add reviewed_at timestamp
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ DEFAULT NULL;

-- Add reviewer_notes for feedback
ALTER TABLE procedural_shards
ADD COLUMN IF NOT EXISTS reviewer_notes TEXT DEFAULT NULL;

-- Index for finding submitted shards pending review
CREATE INDEX IF NOT EXISTS idx_procedural_shards_community_status
ON procedural_shards(community_status)
WHERE community_status IS NOT NULL;

-- Update existing user-owned public shards to 'approved' (they're already public)
UPDATE procedural_shards
SET community_status = 'approved', reviewed_at = NOW()
WHERE owner_id IS NOT NULL AND visibility = 'public';

-- Comment explaining the visibility model
COMMENT ON COLUMN procedural_shards.community_status IS
'Submission workflow for community shards:
- NULL: ALF Public (owner_id=NULL) or Private (not shared)
- draft: User working on shard, not yet submitted
- submitted: Pending admin review
- approved: Approved for Community Public visibility
- rejected: Rejected from Community Public';

COMMENT ON COLUMN procedural_shards.visibility IS
'Simplified visibility model:
- public: Visible to all (ALF Public if owner_id=NULL, Community Public if owner_id set + approved)
- private: Visible only to owner
- organization: Visible to org members (future use)';
