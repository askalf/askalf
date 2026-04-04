-- Covering indexes for /api/v1/admin/costs/summary aggregation queries
-- The single-column idx_forge_cost_events_created index forces a heap fetch
-- for every matched row (to get agent_id, model, cost, input_tokens, output_tokens).
-- These covering indexes enable index-only scans and eliminate that bottleneck.

-- Covering index for forge_cost_events — serves all 4 sub-queries in /admin/costs/summary
-- (byAgent, byDay, byModel, totals all filter by created_at and aggregate cost/token columns)
CREATE INDEX IF NOT EXISTS idx_forge_cost_events_agg_covering
  ON forge_cost_events (created_at DESC)
  INCLUDE (agent_id, model, cost, input_tokens, output_tokens, execution_id);

-- Covering index for forge_executions — serves /api/v1/admin/agents exec-stats sub-query
-- (filters by created_at > 7 days, groups by agent_id, aggregates on status + completed_at)
CREATE INDEX IF NOT EXISTS idx_forge_executions_agg_covering
  ON forge_executions (created_at DESC)
  INCLUDE (agent_id, status, completed_at);

-- Update table statistics so planner picks the new indexes immediately
ANALYZE forge_cost_events;
ANALYZE forge_executions;
