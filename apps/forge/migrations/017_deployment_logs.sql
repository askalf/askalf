-- Deployment logging table for deploy_ops health-checked deployments
CREATE TABLE IF NOT EXISTS deployment_logs (
  id TEXT PRIMARY KEY,
  service TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  health_result JSONB,
  latency_ms INTEGER,
  agent_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deployment_logs_service ON deployment_logs (service);
CREATE INDEX idx_deployment_logs_created_at ON deployment_logs (created_at DESC);
