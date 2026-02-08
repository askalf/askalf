-- Migration 023: Add beta_invite_sent_at to waitlist table
-- Tracks which waitlist members have been sent a beta invite

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS beta_invite_sent_at TIMESTAMPTZ;
