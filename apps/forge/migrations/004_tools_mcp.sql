-- Forge Tools & MCP
-- Tool registry, MCP servers, tool execution log
-- Apply: psql -U substrate -d forge -f 004_tools_mcp.sql

-- ============================================
-- TOOL REGISTRY
-- ============================================

CREATE TABLE IF NOT EXISTS forge_tools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('built_in', 'mcp', 'custom', 'api')),
  risk_level TEXT NOT NULL DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  input_schema JSONB NOT NULL DEFAULT '{}',
  output_schema JSONB NOT NULL DEFAULT '{}',
  config JSONB NOT NULL DEFAULT '{}',
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- MCP SERVERS
-- ============================================

CREATE TABLE IF NOT EXISTS forge_mcp_servers (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  transport_type TEXT NOT NULL CHECK (transport_type IN ('stdio', 'sse', 'streamable_http')),
  connection_config JSONB NOT NULL DEFAULT '{}',
  discovered_tools JSONB NOT NULL DEFAULT '[]',
  health_status TEXT NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('healthy', 'degraded', 'down', 'unknown')),
  last_health_check TIMESTAMPTZ,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_mcp_servers_owner ON forge_mcp_servers(owner_id);

-- ============================================
-- TOOL EXECUTION LOG
-- ============================================

CREATE TABLE IF NOT EXISTS forge_tool_executions (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL REFERENCES forge_executions(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_type TEXT NOT NULL,
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed', 'denied')),
  duration_ms INTEGER,
  error TEXT,
  approval_required BOOLEAN NOT NULL DEFAULT false,
  approved_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forge_tool_exec_execution ON forge_tool_executions(execution_id);
CREATE INDEX idx_forge_tool_exec_tool ON forge_tool_executions(tool_name);

-- Triggers
CREATE TRIGGER trg_forge_tools_updated
  BEFORE UPDATE ON forge_tools
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();

CREATE TRIGGER trg_forge_mcp_servers_updated
  BEFORE UPDATE ON forge_mcp_servers
  FOR EACH ROW EXECUTE FUNCTION forge_update_timestamp();

-- ============================================
-- SEED BUILT-IN TOOLS
-- ============================================

INSERT INTO forge_tools (id, name, display_name, description, type, risk_level, input_schema, requires_approval)
VALUES
  ('tool_web_browse', 'web_browse', 'Web Browse', 'Fetch and extract content from web pages', 'built_in', 'low',
   '{"type": "object", "properties": {"url": {"type": "string"}, "selector": {"type": "string"}}, "required": ["url"]}', false),
  ('tool_web_search', 'web_search', 'Web Search', 'Search the web for information', 'built_in', 'low',
   '{"type": "object", "properties": {"query": {"type": "string"}, "maxResults": {"type": "integer"}}, "required": ["query"]}', false),
  ('tool_code_exec', 'code_exec', 'Code Execute', 'Execute JavaScript code in a sandboxed environment', 'built_in', 'medium',
   '{"type": "object", "properties": {"code": {"type": "string"}, "language": {"type": "string"}}, "required": ["code"]}', false),
  ('tool_api_call', 'api_call', 'API Call', 'Make HTTP requests to external APIs', 'built_in', 'medium',
   '{"type": "object", "properties": {"url": {"type": "string"}, "method": {"type": "string"}, "headers": {"type": "object"}, "body": {"type": "object"}}, "required": ["url", "method"]}', false),
  ('tool_memory_search', 'memory_search', 'Memory Search', 'Search agent semantic and episodic memory', 'built_in', 'low',
   '{"type": "object", "properties": {"query": {"type": "string"}, "memoryType": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["query"]}', false),
  ('tool_memory_store', 'memory_store', 'Memory Store', 'Store information in agent semantic memory', 'built_in', 'low',
   '{"type": "object", "properties": {"content": {"type": "string"}, "importance": {"type": "number"}}, "required": ["content"]}', false),
  ('tool_agent_call', 'agent_call', 'Agent Call', 'Invoke another agent as a sub-agent', 'built_in', 'medium',
   '{"type": "object", "properties": {"agentId": {"type": "string"}, "input": {"type": "string"}}, "required": ["agentId", "input"]}', false),
  ('tool_ticket_ops', 'ticket_ops', 'Ticket Ops', 'Create, update, and query agent tickets', 'built_in', 'low', '{}', false),
  ('tool_finding_ops', 'finding_ops', 'Finding Ops', 'Record and query agent investigation findings', 'built_in', 'low', '{}', false),
  ('tool_intervention_ops', 'intervention_ops', 'Intervention Ops', 'Create and manage intervention requests', 'built_in', 'medium', '{}', false),
  ('tool_proposal_ops', 'proposal_ops', 'Proposal Ops', 'Create and manage change proposals', 'built_in', 'medium', '{}', false),
  ('tool_team_coordinate', 'team_coordinate', 'Team Coordinate', 'Coordinate tasks across fleet agents', 'built_in', 'medium', '{}', false),
  ('tool_docker_api', 'docker_api', 'Docker API', 'Manage Docker containers and images', 'built_in', 'high', '{}', true),
  ('tool_deploy_ops', 'deploy_ops', 'Deploy Ops', 'Deploy applications and manage deployments', 'built_in', 'high', '{}', true),
  ('tool_security_scan', 'security_scan', 'Security Scan', 'Run security scans on code and infrastructure', 'built_in', 'medium', '{}', false),
  ('tool_code_analysis', 'code_analysis', 'Code Analysis', 'Analyze code quality, complexity, and patterns', 'built_in', 'low', '{}', false),
  ('tool_db_query', 'db_query', 'Database Query', 'Execute read-only database queries', 'built_in', 'medium', '{}', false),
  ('tool_substrate_db_query', 'substrate_db_query', 'Substrate DB Query', 'Query the substrate platform database', 'built_in', 'high', '{}', true),
  ('tool_forge_checkpoints', 'forge_checkpoints', 'Forge Checkpoints', 'Create and manage execution checkpoints', 'built_in', 'low', '{}', false),
  ('tool_forge_capabilities', 'forge_capabilities', 'Forge Capabilities', 'Query and manage agent capabilities', 'built_in', 'low', '{}', false),
  ('tool_forge_knowledge_graph', 'forge_knowledge_graph', 'Knowledge Graph', 'Query and build the knowledge graph', 'built_in', 'low', '{}', false),
  ('tool_forge_goals', 'forge_goals', 'Forge Goals', 'Create and manage agent goals', 'built_in', 'low', '{}', false),
  ('tool_forge_fleet_intel', 'forge_fleet_intel', 'Fleet Intel', 'Query fleet agent status and metrics', 'built_in', 'low', '{}', false),
  ('tool_forge_memory', 'forge_memory', 'Forge Memory', 'Advanced memory operations for the forge system', 'built_in', 'low', '{}', false),
  ('tool_forge_cost', 'forge_cost', 'Forge Cost', 'Track and query agent execution costs', 'built_in', 'low', '{}', false),
  ('tool_forge_coordination', 'forge_coordination', 'Forge Coordination', 'Multi-agent coordination and messaging', 'built_in', 'medium', '{}', false)
ON CONFLICT (name) DO NOTHING;
