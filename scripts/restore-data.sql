-- Restore data from old schema to new schema
-- Run this after restoring the old backup to a temp schema

BEGIN;

-- Create temp schema for old data
CREATE SCHEMA IF NOT EXISTS old_data;

-- We'll import the old tables into old_data schema, then migrate

COMMIT;
