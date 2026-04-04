-- Migration 029: Remove unused consciousness tables (migration 013, never wired up)

DROP TABLE IF EXISTS forge_cognitive_state CASCADE;
DROP TABLE IF EXISTS forge_predictions CASCADE;
DROP TABLE IF EXISTS forge_experiences CASCADE;
