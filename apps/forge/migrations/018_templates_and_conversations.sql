-- 018: Templates & Conversations
-- Three-layer platform: template catalog, chat conversations, user preferences

-- Template catalog (curated agent blueprints)
CREATE TABLE IF NOT EXISTS forge_agent_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  icon TEXT,
  agent_config JSONB NOT NULL,
  schedule_config JSONB,
  estimated_cost_per_run NUMERIC(10,4),
  required_tools TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  usage_count INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Layer 1 conversations
CREATE TABLE IF NOT EXISTS forge_conversations (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_forge_conversations_owner ON forge_conversations(owner_id);

-- Conversation messages
CREATE TABLE IF NOT EXISTS forge_conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES forge_conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  execution_id TEXT,
  intent JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_conv_messages_conv ON forge_conversation_messages(conversation_id);

-- User layer preferences
CREATE TABLE IF NOT EXISTS forge_user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  preferred_layer TEXT DEFAULT 'chat' CHECK (preferred_layer IN ('chat', 'builder', 'developer')),
  onboarding_completed BOOLEAN DEFAULT false,
  budget_limit_daily NUMERIC(10,4),
  budget_limit_monthly NUMERIC(10,4),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed templates
INSERT INTO forge_agent_templates (id, name, slug, category, description, icon, agent_config, schedule_config, estimated_cost_per_run, required_tools, sort_order)
VALUES
  ('tmpl_competitor_research', 'Competitor Research', 'competitor-research', 'research',
   'Research competitors, analyze their products, pricing, and market positioning. Delivers structured reports.',
   '🔍',
   '{"systemPrompt": "You are a competitive research analyst. Thoroughly research the specified competitors using web search and browsing. Analyze their products, pricing, features, market positioning, and recent news. Deliver a structured report with actionable insights.", "model": "claude-sonnet-4-6", "autonomyLevel": 3, "maxIterations": 15, "maxCostPerExecution": 0.50}',
   NULL, 0.50, '{web_search,web_browse,memory_store}', 1),

  ('tmpl_security_scanner', 'Security Scanner', 'security-scanner', 'security',
   'Scan your codebase for security vulnerabilities, misconfigurations, and compliance issues.',
   '🛡️',
   '{"systemPrompt": "You are a security scanning agent. Analyze the codebase for vulnerabilities (OWASP Top 10), misconfigurations, exposed secrets, and compliance issues. Create findings for each issue with severity, description, and remediation steps.", "model": "claude-sonnet-4-6", "autonomyLevel": 3, "maxIterations": 20, "maxCostPerExecution": 1.00}',
   '{"interval": "24h"}', 1.00, '{security_scan,code_analysis,finding_ops}', 2),

  ('tmpl_code_reviewer', 'Code Reviewer', 'code-reviewer', 'build',
   'Review code changes for quality, bugs, performance issues, and best practices.',
   '📝',
   '{"systemPrompt": "You are a senior code reviewer. Analyze code changes for bugs, security issues, performance problems, and adherence to best practices. Provide constructive feedback with specific suggestions for improvement. Create tickets for significant issues.", "model": "claude-sonnet-4-6", "autonomyLevel": 2, "maxIterations": 15, "maxCostPerExecution": 0.75}',
   NULL, 0.75, '{code_analysis,ticket_ops,git_ops}', 3),

  ('tmpl_content_writer', 'Content Writer', 'content-writer', 'automate',
   'Generate blog posts, documentation, marketing copy, or other written content.',
   '✍️',
   '{"systemPrompt": "You are a professional content writer. Research the topic thoroughly using web search, then produce high-quality written content. Match the specified tone, audience, and format. Store completed content in memory for future reference.", "model": "claude-sonnet-4-6", "autonomyLevel": 2, "maxIterations": 10, "maxCostPerExecution": 0.30}',
   NULL, 0.30, '{web_search,memory_store}', 4),

  ('tmpl_system_monitor', 'System Monitor', 'system-monitor', 'monitor',
   'Monitor system health, container status, and resource usage. Alert on anomalies.',
   '📊',
   '{"systemPrompt": "You are a system monitoring agent. Check Docker container health, resource usage, deployment status, and system metrics. Create findings for any anomalies, degraded services, or resource constraints. Escalate critical issues.", "model": "claude-haiku-4-5-20251001", "autonomyLevel": 3, "maxIterations": 10, "maxCostPerExecution": 0.40}',
   '{"interval": "6h"}', 0.40, '{docker_api,deploy_ops,finding_ops}', 5),

  ('tmpl_data_analyst', 'Data Analyst', 'data-analyst', 'analyze',
   'Query databases, analyze data patterns, and generate insights with visualizations.',
   '📈',
   '{"systemPrompt": "You are a data analyst agent. Query databases to extract relevant data, identify patterns and trends, and generate actionable insights. Store analysis results in memory. Present findings in a clear, structured format with key metrics highlighted.", "model": "claude-sonnet-4-6", "autonomyLevel": 2, "maxIterations": 15, "maxCostPerExecution": 0.60}',
   NULL, 0.60, '{db_query,web_search,memory_store}', 6)
ON CONFLICT (id) DO NOTHING;
