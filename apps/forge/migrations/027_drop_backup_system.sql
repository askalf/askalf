-- Migration 027: Remove backup system (replaced by computer-level backups)

DROP MATERIALIZED VIEW IF EXISTS backup_metrics_daily CASCADE;
DROP MATERIALIZED VIEW IF EXISTS backup_size_by_type CASCADE;
DROP FUNCTION IF EXISTS refresh_backup_analytics();
DROP FUNCTION IF EXISTS get_backup_stats(INTEGER);
DROP FUNCTION IF EXISTS update_backup_job(TEXT, VARCHAR, TEXT, BIGINT, JSONB, TEXT, JSONB);
DROP FUNCTION IF EXISTS create_backup_job(VARCHAR, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS update_backup_jobs_timestamp();
DROP TABLE IF EXISTS backup_jobs CASCADE;
DROP TABLE IF EXISTS backup_config CASCADE;
