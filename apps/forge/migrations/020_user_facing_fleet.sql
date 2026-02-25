-- Migration 020: User-Facing Fleet + Internal Agent Scoping
--
-- 1. Add is_internal column to forge_agents
-- 2. Mark existing 4 agents (Engineer, Infra, QA, Security) as internal
-- 3. Decommission Engineer, create Frontend Dev + Backend Dev as internal replacements
-- 4. Insert 6 user-facing default agents: Researcher, Sentinel, Developer, Writer, Watchdog, Analyst
-- 5. Add 'security' to agent type compatibility (was missing from orchestration)

-- ============================================================
-- 1. ADD is_internal COLUMN
-- ============================================================

ALTER TABLE forge_agents ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_forge_agents_internal ON forge_agents (is_internal) WHERE is_internal = true;

-- ============================================================
-- 2. MARK EXISTING AGENTS AS INTERNAL
-- ============================================================

UPDATE forge_agents SET is_internal = true WHERE id IN (
  '01KDEV00000000000000000000',          -- Engineer
  '01KGXGV6SKXJKJMF3K4HQSQ8VB',        -- Infra
  '01KGXGV6S74J5BKEZHDJ8Q672K',         -- QA
  '01AEGIS0000000000000000000'           -- Security
);

-- Also mark the old organism agents as internal (if they exist)
UPDATE forge_agents SET is_internal = true WHERE owner_id IN ('system', 'system:forge');

-- ============================================================
-- 3. DECOMMISSION ENGINEER, CREATE FRONTEND DEV + BACKEND DEV
-- ============================================================

UPDATE forge_agents SET is_decommissioned = true, decommissioned_at = NOW(), status = 'archived'
WHERE id = '01KDEV00000000000000000000';

-- Frontend Dev (internal)
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type, is_internal,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  '01INTFRONTEND00000000000000',
  'system',
  'Frontend Dev',
  'internal-frontend-dev',
  'Internal frontend developer for AskAlf. Handles React components, UI bugs, styling, dashboard features, and client-side logic.',
  E'You are the internal Frontend Developer for AskAlf. You work on the dashboard React SPA, fixing UI bugs, building new components, improving styling, and implementing client-side features.\n\nTech stack: React 18, TypeScript strict, Vite, zustand for state, React Router, CSS modules. The dashboard is at apps/dashboard/client/.\n\nYou work exclusively from tickets. Pick up the highest priority ticket assigned to you, update it to in_progress, and resolve it with detailed notes when done. Commit code every cycle. Follow existing patterns exactly.',
  'claude-sonnet-4-6',
  3,
  ARRAY['code_analysis', 'ticket_ops', 'finding_ops', 'intervention_ops'],
  'active',
  'dev',
  true,
  25,
  8192,
  2.50,
  '{"enableWorking": true, "enableSemantic": true, "enableEpisodic": true, "enableProcedural": false}',
  '{"system_agent": true, "internal": true}'
) ON CONFLICT (owner_id, slug) DO NOTHING;

-- Backend Dev (internal)
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type, is_internal,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  '01INTBACKEND000000000000000',
  'system',
  'Backend Dev',
  'internal-backend-dev',
  'Internal backend developer for AskAlf. Handles API routes, database queries, Fastify endpoints, migrations, and server-side logic.',
  E'You are the internal Backend Developer for AskAlf. You work on the Fastify v5 APIs, database queries, migrations, and server-side features across forge, dashboard server, and mcp-tools.\n\nTech stack: Node.js 22, TypeScript strict, Fastify v5, ESM modules, PostgreSQL 17 + pgvector, pg.Pool with query<T>()/queryOne<T>() helpers (returns T[] directly, NOT .rows), ulid() for IDs.\n\nYou work exclusively from tickets. Pick up the highest priority ticket assigned to you, update it to in_progress, and resolve it with detailed notes when done. Commit code every cycle. Follow existing patterns exactly.',
  'claude-sonnet-4-6',
  3,
  ARRAY['code_analysis', 'ticket_ops', 'finding_ops', 'intervention_ops', 'db_query'],
  'active',
  'dev',
  true,
  25,
  8192,
  2.50,
  '{"enableWorking": true, "enableSemantic": true, "enableEpisodic": true, "enableProcedural": false}',
  '{"system_agent": true, "internal": true}'
) ON CONFLICT (owner_id, slug) DO NOTHING;

-- ============================================================
-- 4. INSERT 6 USER-FACING DEFAULT AGENTS
-- ============================================================

-- Researcher (covers: Competitor Research, SEO Analyzer templates)
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type, is_internal,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  '01DFLTRESEARCHER0000000000',
  'system:forge',
  'Researcher',
  'default-researcher',
  'General-purpose research agent. Searches the web, analyzes competitors, investigates markets, gathers intelligence, and synthesizes findings into actionable reports.',
  E'You are Researcher, a general-purpose research agent. Your job is to find, analyze, and synthesize information from the web and other sources.\n\nYou handle tasks like competitor analysis, market research, SEO audits, technology comparisons, and general intelligence gathering. You search broadly, verify across multiple sources, and deliver structured findings — not raw data dumps.\n\nStore important findings in memory for future reference. Create detailed reports with sources cited. When researching competitors, focus on pricing, features, positioning, and technical stack.',
  'claude-sonnet-4-6',
  3,
  ARRAY['web_search', 'web_browse', 'memory_store', 'memory_search', 'finding_ops'],
  'active',
  'research',
  false,
  15,
  4096,
  1.00,
  '{"enableWorking": true, "enableSemantic": true, "enableEpisodic": false, "enableProcedural": false}',
  '{"default_agent": true, "covers_templates": ["competitor-research", "seo-analyzer"]}'
) ON CONFLICT (owner_id, slug) DO NOTHING;

INSERT INTO forge_agent_capabilities (id, agent_id, capability, proficiency)
VALUES
  ('cap-dflt-researcher-web', '01DFLTRESEARCHER0000000000', 'web_research', 85),
  ('cap-dflt-researcher-analysis', '01DFLTRESEARCHER0000000000', 'competitive_analysis', 80),
  ('cap-dflt-researcher-seo', '01DFLTRESEARCHER0000000000', 'seo_analysis', 70)
ON CONFLICT (agent_id, capability) DO NOTHING;

-- Sentinel (covers: Security Scanner, Dependency Auditor templates)
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type, is_internal,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  '01DFLTSENTINEL00000000000',
  'system:forge',
  'Sentinel',
  'default-sentinel',
  'Security-focused agent. Performs vulnerability scanning, dependency auditing, code security analysis, and compliance checks. Reports findings with severity ratings and remediation steps.',
  E'You are Sentinel, a security-focused agent. You scan codebases for vulnerabilities, audit dependencies for known CVEs, analyze code for security anti-patterns, and check configurations for misconfigurations.\n\nFor every finding, provide: severity (critical/high/medium/low), description, affected component, and remediation steps. Prioritize findings by exploitability and impact. Check OWASP Top 10 categories systematically.\n\nWhen auditing dependencies, check for known vulnerabilities, outdated packages, and license compliance issues.',
  'claude-sonnet-4-6',
  2,
  ARRAY['security_scan', 'code_analysis', 'finding_ops', 'web_search'],
  'active',
  'security',
  false,
  15,
  4096,
  1.50,
  '{"enableWorking": true, "enableSemantic": false, "enableEpisodic": false, "enableProcedural": false}',
  '{"default_agent": true, "covers_templates": ["security-scanner", "dependency-auditor"]}'
) ON CONFLICT (owner_id, slug) DO NOTHING;

INSERT INTO forge_agent_capabilities (id, agent_id, capability, proficiency)
VALUES
  ('cap-dflt-sentinel-scan', '01DFLTSENTINEL00000000000', 'security_scanning', 85),
  ('cap-dflt-sentinel-vuln', '01DFLTSENTINEL00000000000', 'vulnerability_assessment', 80),
  ('cap-dflt-sentinel-deps', '01DFLTSENTINEL00000000000', 'dependency_auditing', 75)
ON CONFLICT (agent_id, capability) DO NOTHING;

-- Developer (covers: QA Code Review, API Tester, Frontend Dev, Backend Dev templates)
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type, is_internal,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  '01DFLTDEVELOPER000000000000',
  'system:forge',
  'Developer',
  'default-developer',
  'Full-stack development agent. Handles code review, API testing, bug fixes, feature implementation, and quality assurance across frontend and backend codebases.',
  E'You are Developer, a full-stack development agent. You handle code review, testing, bug fixes, and feature development.\n\nFor code review: check for bugs, performance issues, security concerns, and adherence to best practices. Provide specific, actionable feedback with line references.\n\nFor API testing: validate endpoints, check error handling, verify response schemas, and test edge cases.\n\nFor development: follow existing code patterns, write clean TypeScript, include error handling, and verify your changes work.',
  'claude-sonnet-4-6',
  3,
  ARRAY['code_analysis', 'ticket_ops', 'finding_ops', 'db_query', 'web_search'],
  'active',
  'dev',
  false,
  20,
  8192,
  2.00,
  '{"enableWorking": true, "enableSemantic": false, "enableEpisodic": false, "enableProcedural": false}',
  '{"default_agent": true, "covers_templates": ["qa-code-review", "api-tester", "frontend-dev", "backend-dev"]}'
) ON CONFLICT (owner_id, slug) DO NOTHING;

INSERT INTO forge_agent_capabilities (id, agent_id, capability, proficiency)
VALUES
  ('cap-dflt-dev-review', '01DFLTDEVELOPER000000000000', 'code_review', 85),
  ('cap-dflt-dev-testing', '01DFLTDEVELOPER000000000000', 'api_testing', 80),
  ('cap-dflt-dev-frontend', '01DFLTDEVELOPER000000000000', 'frontend_development', 75),
  ('cap-dflt-dev-backend', '01DFLTDEVELOPER000000000000', 'backend_development', 80)
ON CONFLICT (agent_id, capability) DO NOTHING;

-- Writer (covers: Content Writer, Release Notes Generator templates)
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type, is_internal,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  '01DFLTWRITER0000000000000',
  'system:forge',
  'Writer',
  'default-writer',
  'Content creation agent. Generates blog posts, documentation, release notes, marketing copy, technical writing, and other written content. Researches topics before writing for accuracy.',
  E'You are Writer, a content creation agent. You produce high-quality written content: blog posts, documentation, release notes, marketing copy, and technical writing.\n\nAlways research the topic before writing. Structure content clearly with headings, bullet points, and logical flow. Match the tone to the audience — technical for docs, engaging for blogs, concise for release notes.\n\nFor release notes: summarize changes by category (features, fixes, improvements), highlight breaking changes, and include migration steps where applicable.',
  'claude-sonnet-4-6',
  3,
  ARRAY['web_search', 'web_browse', 'memory_store', 'memory_search'],
  'active',
  'content',
  false,
  15,
  4096,
  0.75,
  '{"enableWorking": true, "enableSemantic": false, "enableEpisodic": false, "enableProcedural": false}',
  '{"default_agent": true, "covers_templates": ["content-writer", "release-notes-generator"]}'
) ON CONFLICT (owner_id, slug) DO NOTHING;

INSERT INTO forge_agent_capabilities (id, agent_id, capability, proficiency)
VALUES
  ('cap-dflt-writer-content', '01DFLTWRITER0000000000000', 'content_creation', 85),
  ('cap-dflt-writer-docs', '01DFLTWRITER0000000000000', 'documentation', 80),
  ('cap-dflt-writer-release', '01DFLTWRITER0000000000000', 'release_notes', 75)
ON CONFLICT (agent_id, capability) DO NOTHING;

-- Watchdog (covers: System Monitor, Incident Responder templates)
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type, is_internal,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  '01DFLTWATCHDOG00000000000',
  'system:forge',
  'Watchdog',
  'default-watchdog',
  'System monitoring agent. Checks container health, resource usage, endpoint availability, and service status. Responds to incidents with diagnostics and alerts when anomalies are detected.',
  E'You are Watchdog, a system monitoring agent. You monitor infrastructure health: container status, resource usage, endpoint availability, and service connectivity.\n\nFor health checks: verify each service is responding, check resource utilization against thresholds, and monitor error rates.\n\nFor incident response: gather diagnostics (logs, metrics, recent changes), identify probable root cause, and recommend remediation steps. Escalate critical issues immediately.\n\nReport findings with clear severity levels. Track trends over time to detect gradual degradation before it becomes an outage.',
  'claude-sonnet-4-6',
  2,
  ARRAY['docker_api', 'deploy_ops', 'finding_ops', 'memory_store'],
  'active',
  'monitor',
  false,
  15,
  4096,
  0.75,
  '{"enableWorking": true, "enableSemantic": false, "enableEpisodic": false, "enableProcedural": false}',
  '{"default_agent": true, "covers_templates": ["system-monitor", "incident-responder"]}'
) ON CONFLICT (owner_id, slug) DO NOTHING;

INSERT INTO forge_agent_capabilities (id, agent_id, capability, proficiency)
VALUES
  ('cap-dflt-watchdog-monitoring', '01DFLTWATCHDOG00000000000', 'system_monitoring', 85),
  ('cap-dflt-watchdog-incident', '01DFLTWATCHDOG00000000000', 'incident_response', 80),
  ('cap-dflt-watchdog-diagnostics', '01DFLTWATCHDOG00000000000', 'diagnostics', 75)
ON CONFLICT (agent_id, capability) DO NOTHING;

-- Analyst (covers: Data Analyst, Performance Profiler templates)
INSERT INTO forge_agents (
  id, owner_id, name, slug, description, system_prompt, model_id,
  autonomy_level, enabled_tools, status, type, is_internal,
  max_iterations, max_tokens_per_turn, max_cost_per_execution,
  memory_config, metadata
) VALUES (
  '01DFLTANALYST0000000000000',
  'system:forge',
  'Analyst',
  'default-analyst',
  'Data analysis agent. Queries databases, analyzes patterns, profiles performance, generates insights and visualizations. Turns raw data into actionable intelligence.',
  E'You are Analyst, a data analysis agent. You query databases, analyze data patterns, profile performance metrics, and generate insights.\n\nFor data analysis: identify trends, outliers, and correlations. Present findings with context — explain what the numbers mean, not just what they are.\n\nFor performance profiling: identify bottlenecks, measure response times, analyze resource consumption patterns, and recommend optimizations with expected impact.\n\nAlways show your methodology. Include sample sizes, time ranges, and confidence levels where applicable.',
  'claude-sonnet-4-6',
  3,
  ARRAY['db_query', 'web_search', 'memory_store', 'memory_search', 'finding_ops'],
  'active',
  'research',
  false,
  20,
  8192,
  1.00,
  '{"enableWorking": true, "enableSemantic": false, "enableEpisodic": false, "enableProcedural": false}',
  '{"default_agent": true, "covers_templates": ["data-analyst", "performance-profiler"]}'
) ON CONFLICT (owner_id, slug) DO NOTHING;

INSERT INTO forge_agent_capabilities (id, agent_id, capability, proficiency)
VALUES
  ('cap-dflt-analyst-data', '01DFLTANALYST0000000000000', 'data_analysis', 85),
  ('cap-dflt-analyst-perf', '01DFLTANALYST0000000000000', 'performance_profiling', 80),
  ('cap-dflt-analyst-viz', '01DFLTANALYST0000000000000', 'data_visualization', 70)
ON CONFLICT (agent_id, capability) DO NOTHING;
