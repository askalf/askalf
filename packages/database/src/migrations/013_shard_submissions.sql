-- SUBSTRATE v1: Shard Submission System
-- Enables users to submit private shards for review and potential publication
-- to the public library

-- ============================================
-- ADD SUBMISSION COLUMNS TO PROCEDURAL_SHARDS
-- ============================================

-- Submission status tracks the review workflow
ALTER TABLE procedural_shards
    ADD COLUMN IF NOT EXISTS submission_status VARCHAR(20) DEFAULT 'draft';

-- Timestamps for submission workflow
ALTER TABLE procedural_shards
    ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ;

ALTER TABLE procedural_shards
    ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Reviewer reference (tenant_id of admin who reviewed)
ALTER TABLE procedural_shards
    ADD COLUMN IF NOT EXISTS reviewed_by TEXT;

-- Notes from reviewer (feedback, rejection reason, etc.)
ALTER TABLE procedural_shards
    ADD COLUMN IF NOT EXISTS reviewer_notes TEXT;

-- Description for the shard (used in library display)
ALTER TABLE procedural_shards
    ADD COLUMN IF NOT EXISTS description TEXT;

-- Author display name (cached from user at submission time)
ALTER TABLE procedural_shards
    ADD COLUMN IF NOT EXISTS author_name TEXT;

-- Constraint for valid submission statuses
ALTER TABLE procedural_shards DROP CONSTRAINT IF EXISTS valid_submission_status;
ALTER TABLE procedural_shards ADD CONSTRAINT valid_submission_status
    CHECK (submission_status IN ('draft', 'pending', 'approved', 'rejected', 'changes_requested'));

-- Index for finding pending submissions (admin queue)
CREATE INDEX IF NOT EXISTS idx_shards_submission_status
    ON procedural_shards(submission_status)
    WHERE submission_status = 'pending';

-- Index for user's submissions
CREATE INDEX IF NOT EXISTS idx_shards_owner_submission
    ON procedural_shards(owner_id, submission_status)
    WHERE owner_id IS NOT NULL;

-- ============================================
-- SHARD SUBMISSIONS AUDIT TABLE
-- ============================================

-- Tracks full history of submission actions for audit trail
CREATE TABLE IF NOT EXISTS shard_submissions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

    -- Reference to the shard
    shard_id TEXT NOT NULL REFERENCES procedural_shards(id) ON DELETE CASCADE,

    -- Who submitted
    submitted_by TEXT NOT NULL,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),

    -- Submission snapshot (in case shard is modified later)
    shard_name TEXT NOT NULL,
    shard_description TEXT,
    shard_category TEXT,

    -- Review info
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    reviewer_notes TEXT,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Constraint for valid submission statuses
ALTER TABLE shard_submissions ADD CONSTRAINT valid_submission_history_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'changes_requested', 'withdrawn'));

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_submissions_shard ON shard_submissions(shard_id);
CREATE INDEX IF NOT EXISTS idx_submissions_submitted_by ON shard_submissions(submitted_by);
CREATE INDEX IF NOT EXISTS idx_submissions_status ON shard_submissions(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_submissions_reviewed_by ON shard_submissions(reviewed_by) WHERE reviewed_by IS NOT NULL;

-- ============================================
-- HELPER FUNCTION: Submit shard for review
-- ============================================

CREATE OR REPLACE FUNCTION submit_shard_for_review(
    p_shard_id TEXT,
    p_tenant_id TEXT,
    p_description TEXT DEFAULT NULL,
    p_author_name TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    submission_id TEXT,
    error TEXT
) AS $$
DECLARE
    v_shard RECORD;
    v_submission_id TEXT;
BEGIN
    -- Get the shard and verify ownership
    SELECT id, name, category, owner_id, visibility, submission_status
    INTO v_shard
    FROM procedural_shards
    WHERE id = p_shard_id;

    -- Validate shard exists
    IF v_shard.id IS NULL THEN
        RETURN QUERY SELECT false, NULL::TEXT, 'Shard not found';
        RETURN;
    END IF;

    -- Validate ownership
    IF v_shard.owner_id != p_tenant_id THEN
        RETURN QUERY SELECT false, NULL::TEXT, 'You can only submit your own shards';
        RETURN;
    END IF;

    -- Validate not already pending
    IF v_shard.submission_status = 'pending' THEN
        RETURN QUERY SELECT false, NULL::TEXT, 'Shard is already pending review';
        RETURN;
    END IF;

    -- Validate is private (only private shards can be submitted)
    IF v_shard.visibility != 'private' THEN
        RETURN QUERY SELECT false, NULL::TEXT, 'Only private shards can be submitted for review';
        RETURN;
    END IF;

    -- Create submission record
    v_submission_id := gen_random_uuid()::text;

    INSERT INTO shard_submissions (id, shard_id, submitted_by, shard_name, shard_description, shard_category, status)
    VALUES (v_submission_id, p_shard_id, p_tenant_id, v_shard.name, p_description, v_shard.category, 'pending');

    -- Update shard status
    UPDATE procedural_shards
    SET submission_status = 'pending',
        submitted_at = NOW(),
        description = COALESCE(p_description, description),
        author_name = COALESCE(p_author_name, author_name),
        updated_at = NOW()
    WHERE id = p_shard_id;

    RETURN QUERY SELECT true, v_submission_id, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- HELPER FUNCTION: Review shard submission
-- ============================================

CREATE OR REPLACE FUNCTION review_shard_submission(
    p_shard_id TEXT,
    p_reviewer_id TEXT,
    p_action VARCHAR(20),
    p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
    success BOOLEAN,
    error TEXT
) AS $$
DECLARE
    v_shard RECORD;
BEGIN
    -- Validate action
    IF p_action NOT IN ('approve', 'reject', 'request_changes') THEN
        RETURN QUERY SELECT false, 'Invalid action. Use: approve, reject, or request_changes';
        RETURN;
    END IF;

    -- Get shard
    SELECT id, submission_status, owner_id
    INTO v_shard
    FROM procedural_shards
    WHERE id = p_shard_id;

    IF v_shard.id IS NULL THEN
        RETURN QUERY SELECT false, 'Shard not found';
        RETURN;
    END IF;

    IF v_shard.submission_status != 'pending' THEN
        RETURN QUERY SELECT false, 'Shard is not pending review';
        RETURN;
    END IF;

    -- Update shard based on action
    IF p_action = 'approve' THEN
        UPDATE procedural_shards
        SET submission_status = 'approved',
            visibility = 'public',
            reviewed_at = NOW(),
            reviewed_by = p_reviewer_id,
            reviewer_notes = p_notes,
            updated_at = NOW()
        WHERE id = p_shard_id;
    ELSIF p_action = 'reject' THEN
        UPDATE procedural_shards
        SET submission_status = 'rejected',
            reviewed_at = NOW(),
            reviewed_by = p_reviewer_id,
            reviewer_notes = p_notes,
            updated_at = NOW()
        WHERE id = p_shard_id;
    ELSE -- request_changes
        UPDATE procedural_shards
        SET submission_status = 'changes_requested',
            reviewed_at = NOW(),
            reviewed_by = p_reviewer_id,
            reviewer_notes = p_notes,
            updated_at = NOW()
        WHERE id = p_shard_id;
    END IF;

    -- Update submission record (most recent pending one)
    UPDATE shard_submissions
    SET status = CASE p_action
            WHEN 'approve' THEN 'approved'
            WHEN 'reject' THEN 'rejected'
            ELSE 'changes_requested'
        END,
        reviewed_by = p_reviewer_id,
        reviewed_at = NOW(),
        reviewer_notes = p_notes
    WHERE id = (
        SELECT id FROM shard_submissions
        WHERE shard_id = p_shard_id AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
    );

    RETURN QUERY SELECT true, NULL::TEXT;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON COLUMN procedural_shards.submission_status IS 'Submission workflow status: draft, pending, approved, rejected, changes_requested';
COMMENT ON COLUMN procedural_shards.submitted_at IS 'When the shard was submitted for review';
COMMENT ON COLUMN procedural_shards.reviewed_at IS 'When the shard was reviewed';
COMMENT ON COLUMN procedural_shards.reviewed_by IS 'Tenant ID of the admin who reviewed';
COMMENT ON COLUMN procedural_shards.reviewer_notes IS 'Feedback from reviewer';
COMMENT ON COLUMN procedural_shards.description IS 'User-provided description for library display';
COMMENT ON COLUMN procedural_shards.author_name IS 'Cached author name for display';

COMMENT ON TABLE shard_submissions IS 'Audit trail of shard submission actions';
