-- 025: Add onboarding tracking to users
-- NULL = not onboarded, timestamp = when wizard was completed

ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

-- Mark all existing users as already onboarded (only new signups go through wizard)
UPDATE users SET onboarding_completed_at = created_at WHERE onboarding_completed_at IS NULL;
