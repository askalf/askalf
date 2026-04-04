-- Migration 007: Session Fingerprinting
-- Add fingerprint_hash column to sessions table for browser fingerprint validation.
-- Fingerprint = SHA-256(user-agent + "|" + accept-language) stored at login time.
-- Mismatch on subsequent requests indicates potential session hijacking.

BEGIN;

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS fingerprint_hash TEXT;

COMMIT;
