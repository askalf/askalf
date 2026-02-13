-- Migration 030: Backup Metrics Materialized Views
-- Pre-computed daily aggregates for backup analytics and trending

-- ============================================
-- DAILY METRICS VIEW
-- ============================================
-- Aggregated backup metrics by day for time-series charting
CREATE MATERIALIZED VIEW IF NOT EXISTS backup_metrics_daily AS
SELECT
  DATE_TRUNC('day', created_at)::date AS day,
  COUNT(*)::int AS total_count,
  COUNT(*) FILTER (WHERE status = 'completed')::int AS success_count,
  COUNT(*) FILTER (WHERE status = 'failed')::int AS fail_count,
  ROUND(AVG(duration_ms) FILTER (WHERE status = 'completed'))::int AS avg_duration_ms,
  COALESCE(SUM(file_size) FILTER (WHERE status = 'completed'), 0)::bigint AS total_size_bytes,
  ROUND(AVG(file_size) FILTER (WHERE status = 'completed'))::bigint AS avg_size_bytes,
  CASE
    WHEN COUNT(*) > 0
    THEN ROUND(COUNT(*) FILTER (WHERE status = 'completed')::numeric / COUNT(*) * 100, 1)
    ELSE 0
  END AS success_rate
FROM backup_jobs
WHERE deleted_at IS NULL
GROUP BY DATE_TRUNC('day', created_at)::date
ORDER BY day DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_metrics_daily_day ON backup_metrics_daily(day);

-- ============================================
-- SIZE BY TYPE VIEW
-- ============================================
-- Backup size trends by backup type (full, data-only, incremental)
CREATE MATERIALIZED VIEW IF NOT EXISTS backup_size_by_type AS
SELECT
  DATE_TRUNC('day', created_at)::date AS day,
  type,
  COUNT(*)::int AS backup_count,
  COALESCE(SUM(file_size), 0)::bigint AS total_size_bytes,
  ROUND(AVG(file_size))::bigint AS avg_size_bytes,
  ROUND(AVG(duration_ms))::int AS avg_duration_ms
FROM backup_jobs
WHERE deleted_at IS NULL AND status = 'completed'
GROUP BY DATE_TRUNC('day', created_at)::date, type
ORDER BY day DESC;

CREATE UNIQUE INDEX IF NOT EXISTS idx_backup_size_by_type_day ON backup_size_by_type(day, type);

-- ============================================
-- REFRESH FUNCTION
-- ============================================
CREATE OR REPLACE FUNCTION refresh_backup_analytics()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY backup_metrics_daily;
  REFRESH MATERIALIZED VIEW CONCURRENTLY backup_size_by_type;
END;
$$ LANGUAGE plpgsql;

COMMENT ON MATERIALIZED VIEW backup_metrics_daily IS 'Daily aggregated backup metrics for time-series charting. Refresh daily after scheduled backups.';
COMMENT ON MATERIALIZED VIEW backup_size_by_type IS 'Backup size and duration trends by backup type. Refresh daily.';
COMMENT ON FUNCTION refresh_backup_analytics IS 'Refreshes all backup analytics materialized views concurrently.';
