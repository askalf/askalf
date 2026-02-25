-- Migration 033: Add source column to waitlist table
-- Tracks which product/site the signup came from (e.g., 'claw-replay', 'askalf')

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'askalf';
