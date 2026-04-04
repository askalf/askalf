-- Report schedules and generated reports for daily/weekly summaries
-- Supports Discord webhook and email delivery

CREATE TABLE IF NOT EXISTS report_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'daily',  -- daily, weekly, monthly
  schedule_cron TEXT,                         -- optional cron expression
  schedule_hour INTEGER DEFAULT 9,            -- hour of day (0-23 UTC)
  schedule_day_of_week INTEGER DEFAULT 1,     -- 0=Sun, 1=Mon (for weekly)
  include_sections TEXT[] DEFAULT ARRAY['metrics', 'activity', 'findings', 'cost'],
  recipients JSONB DEFAULT '[]',              -- [{type: 'discord_webhook', url: '...'}, {type: 'email', address: '...'}]
  is_enabled BOOLEAN DEFAULT true,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_reports (
  id TEXT PRIMARY KEY,
  schedule_id TEXT REFERENCES report_schedules(id) ON DELETE SET NULL,
  report_type TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  content JSONB NOT NULL DEFAULT '{}',
  summary_text TEXT,
  metrics_snapshot JSONB DEFAULT '{}',
  delivery_status JSONB DEFAULT '[]',          -- [{recipient: '...', sent: true/false, error: '...'}]
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_enabled ON report_schedules(is_enabled) WHERE is_enabled = true;
CREATE INDEX IF NOT EXISTS idx_generated_reports_created ON generated_reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_generated_reports_schedule ON generated_reports(schedule_id);
