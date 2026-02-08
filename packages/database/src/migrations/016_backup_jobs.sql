-- Migration 016: Backup Jobs Tracking System
-- Enables centralized backup management with job tracking and configuration

-- ============================================
-- BACKUP JOBS TABLE
-- ============================================
-- Tracks all backup operations (manual and scheduled)
CREATE TABLE IF NOT EXISTS backup_jobs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Job classification
  type VARCHAR(20) NOT NULL DEFAULT 'full',
  -- Types: full, data-only, incremental

  trigger VARCHAR(20) NOT NULL DEFAULT 'scheduled',
  -- Triggers: scheduled, manual, restore

  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  -- Status: pending, running, completed, failed, cancelled

  -- Timing
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,

  -- File info
  file_path TEXT,
  file_size BIGINT,
  compressed BOOLEAN DEFAULT true,
  encrypted BOOLEAN DEFAULT false,

  -- Manifest (domain counts, table details)
  manifest JSONB DEFAULT '{}',
  -- { tables: { users: 150, tenants: 10, ... }, domains: { identity: 160, billing: 50 } }

  -- Error tracking
  error_message TEXT,
  error_details JSONB,

  -- Audit
  triggered_by TEXT,  -- user_id or 'system'
  deleted_at TIMESTAMPTZ,  -- soft delete

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for backup job queries
CREATE INDEX IF NOT EXISTS idx_backup_jobs_status ON backup_jobs(status);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_type ON backup_jobs(type);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_created ON backup_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_trigger ON backup_jobs(trigger);
CREATE INDEX IF NOT EXISTS idx_backup_jobs_active ON backup_jobs(status)
  WHERE status IN ('pending', 'running');

-- ============================================
-- BACKUP CONFIG TABLE
-- ============================================
-- Singleton configuration for backup system
CREATE TABLE IF NOT EXISTS backup_config (
  id TEXT PRIMARY KEY DEFAULT 'default',

  -- Schedule (cron format)
  schedule_enabled BOOLEAN DEFAULT true,
  schedule_cron VARCHAR(50) DEFAULT '0 4 * * *',  -- 4 AM daily

  -- Retention policies
  retention_days INTEGER DEFAULT 30,
  retention_weeks INTEGER DEFAULT 4,
  retention_months INTEGER DEFAULT 6,

  -- Options
  compression_enabled BOOLEAN DEFAULT true,
  encryption_enabled BOOLEAN DEFAULT false,

  -- Notifications
  notify_on_failure BOOLEAN DEFAULT true,
  notify_on_success BOOLEAN DEFAULT false,
  notify_email TEXT,

  -- Timestamps
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

-- Insert default configuration
INSERT INTO backup_config (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Create a new backup job
CREATE OR REPLACE FUNCTION create_backup_job(
  p_type VARCHAR(20) DEFAULT 'full',
  p_trigger VARCHAR(20) DEFAULT 'manual',
  p_triggered_by TEXT DEFAULT 'system'
) RETURNS TEXT AS $$
DECLARE
  v_job_id TEXT;
BEGIN
  INSERT INTO backup_jobs (type, trigger, status, triggered_by)
  VALUES (p_type, p_trigger, 'pending', p_triggered_by)
  RETURNING id INTO v_job_id;

  RETURN v_job_id;
END;
$$ LANGUAGE plpgsql;

-- Update backup job status
CREATE OR REPLACE FUNCTION update_backup_job(
  p_job_id TEXT,
  p_status VARCHAR(20),
  p_file_path TEXT DEFAULT NULL,
  p_file_size BIGINT DEFAULT NULL,
  p_manifest JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL,
  p_error_details JSONB DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
  v_started_at TIMESTAMPTZ;
  v_duration_ms INTEGER;
BEGIN
  -- Get current started_at for duration calculation
  SELECT started_at INTO v_started_at FROM backup_jobs WHERE id = p_job_id;

  -- Calculate duration if completing
  IF p_status IN ('completed', 'failed', 'cancelled') AND v_started_at IS NOT NULL THEN
    v_duration_ms := EXTRACT(EPOCH FROM (NOW() - v_started_at)) * 1000;
  END IF;

  UPDATE backup_jobs SET
    status = p_status,
    started_at = CASE
      WHEN p_status = 'running' AND started_at IS NULL THEN NOW()
      ELSE started_at
    END,
    completed_at = CASE
      WHEN p_status IN ('completed', 'failed', 'cancelled') THEN NOW()
      ELSE completed_at
    END,
    duration_ms = COALESCE(v_duration_ms, duration_ms),
    file_path = COALESCE(p_file_path, file_path),
    file_size = COALESCE(p_file_size, file_size),
    manifest = COALESCE(p_manifest, manifest),
    error_message = COALESCE(p_error_message, error_message),
    error_details = COALESCE(p_error_details, error_details),
    updated_at = NOW()
  WHERE id = p_job_id;

  RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Get backup statistics
CREATE OR REPLACE FUNCTION get_backup_stats(
  p_days INTEGER DEFAULT 30
) RETURNS TABLE(
  total_backups BIGINT,
  successful_backups BIGINT,
  failed_backups BIGINT,
  total_size_bytes BIGINT,
  avg_duration_ms NUMERIC,
  last_successful_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COUNT(*)::BIGINT as total_backups,
    COUNT(*) FILTER (WHERE bj.status = 'completed')::BIGINT as successful_backups,
    COUNT(*) FILTER (WHERE bj.status = 'failed')::BIGINT as failed_backups,
    COALESCE(SUM(bj.file_size) FILTER (WHERE bj.status = 'completed'), 0)::BIGINT as total_size_bytes,
    AVG(bj.duration_ms) FILTER (WHERE bj.status = 'completed') as avg_duration_ms,
    MAX(bj.completed_at) FILTER (WHERE bj.status = 'completed') as last_successful_at,
    MAX(bj.completed_at) FILTER (WHERE bj.status = 'failed') as last_failed_at
  FROM backup_jobs bj
  WHERE bj.created_at > NOW() - (p_days || ' days')::INTERVAL
    AND bj.deleted_at IS NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_backup_jobs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS backup_jobs_updated_at ON backup_jobs;
CREATE TRIGGER backup_jobs_updated_at
  BEFORE UPDATE ON backup_jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_backup_jobs_timestamp();

-- Add comments
COMMENT ON TABLE backup_jobs IS 'Tracks all backup operations with status, timing, and manifest';
COMMENT ON TABLE backup_config IS 'Singleton configuration for backup schedule and retention';
COMMENT ON FUNCTION create_backup_job IS 'Creates a new backup job record';
COMMENT ON FUNCTION update_backup_job IS 'Updates backup job status and metadata';
COMMENT ON FUNCTION get_backup_stats IS 'Returns backup statistics for the specified period';
