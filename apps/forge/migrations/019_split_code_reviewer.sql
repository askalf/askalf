-- Add Frontend Dev and Backend Dev templates, rename Code Reviewer to QA
-- Aligns templates with active agent fleet: Frontend Dev, Backend Dev, QA Engineer

-- Rename Code Reviewer → QA Code Review (maps to QA Engineer agent)
UPDATE forge_agent_templates
SET name = 'QA Code Review',
    slug = 'qa-code-review',
    icon = '🧪',
    description = 'Review code for bugs, security issues, test coverage gaps, and best practices. Creates tickets for findings.',
    agent_config = '{"model": "claude-sonnet-4-6", "systemPrompt": "You are a QA engineer. Review code changes for bugs, security vulnerabilities, missing test coverage, edge cases, and adherence to best practices. Run existing tests when possible. Provide specific, actionable feedback and create tickets for significant issues found.", "autonomyLevel": 2, "maxIterations": 15, "maxCostPerExecution": 0.75}'
WHERE slug = 'code-reviewer';

-- Frontend Dev template
INSERT INTO forge_agent_templates (id, name, slug, category, description, icon, agent_config, schedule_config, estimated_cost_per_run, required_tools, is_active, usage_count, sort_order)
VALUES (
  'tmpl_frontend_dev',
  'Frontend Dev',
  'frontend-dev',
  'build',
  'Build React components, fix UI bugs, improve styling, and implement frontend features. Specializes in TypeScript, CSS, and accessibility.',
  '🎨',
  '{"model": "claude-sonnet-4-6", "systemPrompt": "You are a senior frontend developer specializing in React and TypeScript. Build new components, fix UI bugs, improve styling and accessibility, and implement frontend features. Follow existing patterns in the codebase. Write clean, typed code with proper hooks usage. Create tickets for follow-up work.", "autonomyLevel": 2, "maxIterations": 20, "maxCostPerExecution": 1.50}',
  NULL,
  1.5000,
  '{code_analysis,ticket_ops,git_ops}',
  true,
  0,
  13
);

-- Backend Dev template
INSERT INTO forge_agent_templates (id, name, slug, category, description, icon, agent_config, schedule_config, estimated_cost_per_run, required_tools, is_active, usage_count, sort_order)
VALUES (
  'tmpl_backend_dev',
  'Backend Dev',
  'backend-dev',
  'build',
  'Build API endpoints, fix backend bugs, optimize database queries, and implement server-side features. Specializes in Fastify, PostgreSQL, and Node.js.',
  '🔧',
  '{"model": "claude-sonnet-4-6", "systemPrompt": "You are a senior backend developer specializing in Node.js, Fastify, and PostgreSQL. Build new API endpoints, fix bugs, optimize database queries, and implement server-side features. Follow existing patterns: pg.Pool queries, Zod validation, proper error handling, ULID IDs. Create tickets for follow-up work.", "autonomyLevel": 2, "maxIterations": 20, "maxCostPerExecution": 1.50}',
  NULL,
  1.5000,
  '{code_analysis,ticket_ops,git_ops,db_query}',
  true,
  0,
  14
);
