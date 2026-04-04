-- Marketplace: community tool/skill registry
CREATE TABLE IF NOT EXISTS marketplace_packages (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  long_description TEXT,
  author_name TEXT NOT NULL,
  author_url TEXT,
  package_type TEXT NOT NULL CHECK (package_type IN ('mcp_server', 'skill_template', 'tool_bundle')),
  version TEXT NOT NULL DEFAULT '1.0.0',
  icon_url TEXT,
  repository_url TEXT,
  install_config JSONB NOT NULL DEFAULT '{}',
  required_env_vars TEXT[] DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  avg_rating NUMERIC(3,2) DEFAULT 0,
  install_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  is_featured BOOLEAN DEFAULT false,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'deprecated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_packages_slug ON marketplace_packages(slug);
CREATE INDEX IF NOT EXISTS idx_marketplace_packages_type ON marketplace_packages(package_type);
CREATE INDEX IF NOT EXISTS idx_marketplace_packages_featured ON marketplace_packages(is_featured) WHERE is_featured = true;
CREATE INDEX IF NOT EXISTS idx_marketplace_packages_tags ON marketplace_packages USING GIN(tags);

CREATE TABLE IF NOT EXISTS marketplace_ratings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  package_id TEXT NOT NULL REFERENCES marketplace_packages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(package_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_marketplace_ratings_package ON marketplace_ratings(package_id);

CREATE TABLE IF NOT EXISTS marketplace_installs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  package_id TEXT NOT NULL REFERENCES marketplace_packages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  installed_resource_id TEXT,
  installed_resource_type TEXT CHECK (installed_resource_type IN ('mcp_server', 'agent', 'tool')),
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_installs_user ON marketplace_installs(user_id);

-- Seed featured packages from built-in tools
INSERT INTO marketplace_packages (slug, name, description, author_name, package_type, tags, is_verified, is_featured, install_config)
VALUES
  ('ticket-ops', 'Ticket Ops', 'Create, update, and query agent investigation tickets', 'AskAlf', 'tool_bundle',
   ARRAY['workflow', 'tickets', 'core'], true, true, '{"tool_name": "ticket_ops"}'),
  ('finding-ops', 'Finding Ops', 'Record and query agent investigation findings', 'AskAlf', 'tool_bundle',
   ARRAY['workflow', 'findings', 'core'], true, true, '{"tool_name": "finding_ops"}'),
  ('docker-api', 'Docker API', 'Manage Docker containers, images, and infrastructure', 'AskAlf', 'tool_bundle',
   ARRAY['infra', 'docker', 'devops'], true, true, '{"tool_name": "docker_api"}'),
  ('deploy-ops', 'Deploy Ops', 'Deploy applications and manage deployment pipelines', 'AskAlf', 'tool_bundle',
   ARRAY['infra', 'deploy', 'devops'], true, true, '{"tool_name": "deploy_ops"}'),
  ('security-scan', 'Security Scan', 'Run security scans on code and infrastructure', 'AskAlf', 'tool_bundle',
   ARRAY['security', 'scanning', 'audit'], true, true, '{"tool_name": "security_scan"}'),
  ('code-analysis', 'Code Analysis', 'Analyze code quality, complexity, and patterns', 'AskAlf', 'tool_bundle',
   ARRAY['dev', 'quality', 'analysis'], true, true, '{"tool_name": "code_analysis"}'),
  ('knowledge-graph', 'Knowledge Graph', 'Build and query the agent knowledge graph', 'AskAlf', 'tool_bundle',
   ARRAY['memory', 'knowledge', 'graph'], true, true, '{"tool_name": "forge_knowledge_graph"}'),
  ('fleet-intel', 'Fleet Intel', 'Query fleet agent status, metrics, and health', 'AskAlf', 'tool_bundle',
   ARRAY['fleet', 'monitoring', 'agents'], true, true, '{"tool_name": "forge_fleet_intel"}'),
  ('web-search', 'Web Search', 'Search the web for information using SearXNG', 'AskAlf', 'tool_bundle',
   ARRAY['web', 'search', 'research'], true, true, '{"tool_name": "web_search"}'),
  ('web-browse', 'Web Browse', 'Fetch and extract content from web pages', 'AskAlf', 'tool_bundle',
   ARRAY['web', 'browse', 'scraping'], true, true, '{"tool_name": "web_browse"}'),
  ('db-query', 'Database Query', 'Execute read-only database queries', 'AskAlf', 'tool_bundle',
   ARRAY['data', 'database', 'sql'], true, true, '{"tool_name": "db_query"}'),
  ('team-coordinate', 'Team Coordinate', 'Coordinate tasks across fleet agents', 'AskAlf', 'tool_bundle',
   ARRAY['fleet', 'coordination', 'multi-agent'], true, true, '{"tool_name": "team_coordinate"}')
ON CONFLICT (slug) DO NOTHING;
