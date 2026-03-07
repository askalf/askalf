/**
 * Platform Context Builder
 *
 * Dynamically assembles platform context from DB state (agents, skills, tools).
 * Used by:
 *  - Intent parser (system prompt generation)
 *  - Dashboard sessions (Claude Code / Codex instruction files)
 *  - Project injection (context files for user repos)
 */

import { query } from '../database.js';

interface AgentRow {
  name: string;
  role: string;
  status: string;
  is_internal: boolean;
}

interface SkillRow {
  name: string;
  slug: string;
  category: string;
  description: string;
  required_tools: string[];
}

export interface PlatformContext {
  agents: { internal: string[]; userFacing: string[] };
  skills: Record<string, string[]>; // category → slug[]
  skillCount: number;
  tools: Record<string, string[]>; // category → tool names
  toolCount: number;
  channels: string[];
  gitProviders: string[];
  stack: string;
}

// MCP tools are static — they're compiled into mcp-tools at build time.
// If a tool is added to mcp-tools, this map must be updated.
// This is the single source of truth referenced by the intent parser and session prompts.
const MCP_TOOLS: Record<string, string[]> = {
  workflow: ['ticket_ops', 'finding_ops', 'intervention_ops', 'agent_call', 'proposal_ops'],
  data: ['db_query', 'substrate_db_query', 'memory_search', 'memory_store'],
  infrastructure: ['docker_api', 'deploy_ops', 'security_scan', 'code_analysis'],
  agent: ['web_search', 'web_browse', 'team_coordinate'],
  forge: [
    'forge_checkpoints', 'forge_capabilities', 'forge_knowledge_graph',
    'forge_goals', 'forge_fleet_intel', 'forge_memory', 'forge_cost', 'forge_coordination',
  ],
};

const CHANNELS = ['Slack', 'Discord', 'Telegram', 'WhatsApp'];
const GIT_PROVIDERS = ['GitHub', 'GitLab', 'Bitbucket'];
const STACK = 'PostgreSQL 17 + pgvector, Redis, Node.js 22, TypeScript, Fastify v5, Docker Compose';

let _cached: PlatformContext | null = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

/**
 * Build platform context from DB. Cached for 1 minute.
 */
export async function getPlatformContext(): Promise<PlatformContext> {
  const now = Date.now();
  if (_cached && now - _cachedAt < CACHE_TTL_MS) return _cached;

  // Query agents
  let agents: AgentRow[] = [];
  try {
    agents = await query<AgentRow>(
      `SELECT name, role, status, is_internal FROM forge_agents WHERE status != 'decommissioned'`,
    );
  } catch {
    // Table may not exist yet during initial setup
  }

  const internal = agents.filter(a => a.is_internal === true).map(a => a.name);
  const userFacing = agents.filter(a => !a.is_internal).map(a => a.name);

  // Query skills (templates)
  let skills: SkillRow[] = [];
  try {
    skills = await query<SkillRow>(
      `SELECT name, slug, category, description, required_tools
       FROM forge_agent_templates WHERE is_active = true ORDER BY category, sort_order`,
    );
  } catch {
    // Table may not exist yet
  }

  const skillsByCategory: Record<string, string[]> = {};
  for (const s of skills) {
    if (!skillsByCategory[s.category]) skillsByCategory[s.category] = [];
    skillsByCategory[s.category]!.push(s.slug);
  }

  const toolCount = Object.values(MCP_TOOLS).reduce((sum, tools) => sum + tools.length, 0);

  _cached = {
    agents: { internal, userFacing },
    skills: skillsByCategory,
    skillCount: skills.length,
    tools: MCP_TOOLS,
    toolCount,
    channels: CHANNELS,
    gitProviders: GIT_PROVIDERS,
    stack: STACK,
  };
  _cachedAt = now;
  return _cached;
}

/**
 * Invalidate the cache (call after adding tools, skills, or agents).
 */
export function invalidatePlatformContext(): void {
  _cached = null;
  _cachedAt = 0;
}

/**
 * Build a system prompt for the intent parser from live platform state.
 */
export async function buildIntentSystemPrompt(): Promise<string> {
  const ctx = await getPlatformContext();

  const toolSection = Object.entries(ctx.tools)
    .map(([cat, tools]) => `  ${cat}: ${tools.join(', ')}`)
    .join('\n');

  const skillSection = Object.entries(ctx.skills)
    .map(([cat, slugs]) => `  ${cat}: ${slugs.join(', ')}`)
    .join('\n');

  const agentSection = [
    ctx.agents.userFacing.length > 0 ? `  User-facing: ${ctx.agents.userFacing.join(', ')}` : null,
    ctx.agents.internal.length > 0 ? `  Internal (admin-only): ${ctx.agents.internal.join(', ')}` : null,
  ].filter(Boolean).join('\n');

  return `You are the intent parser for AskAlf (askalf.org) — a self-hosted AI agent orchestration platform.
Stack: ${ctx.stack}. ${ctx.agents.internal.length + ctx.agents.userFacing.length} agents, ${ctx.skillCount} skills, ${ctx.toolCount} MCP tools.
Channels: ${ctx.channels.join(', ')}. Git: ${ctx.gitProviders.join(', ')}.

Given a user request, determine:

1. category: One of: research, monitor, build, analyze, automate, security, dev
2. What the user wants an agent to do
3. Whether this is a one-time task or recurring
4. Estimated complexity (low/medium/high)
5. executionMode:
   - "single": One agent (default for most requests)
   - "pipeline": Sequential steps
   - "fan-out": Parallel independent tasks
   - "consensus": Same problem, multiple angles
   ONLY use multi-agent modes when genuinely needed.
6. If NOT "single", provide subtasks (2-6 items): title, description, suggestedAgentType (dev|research|security|content|monitor|custom), dependencies, estimatedComplexity

## Categories and tools:
- research: web_search, web_browse, memory_store, memory_search
- security: security_scan, code_analysis, finding_ops
- build: code_analysis, ticket_ops, deploy_ops
- dev: code_analysis, web_browse, finding_ops, memory_store, db_query
- automate: web_search, memory_store, finding_ops, team_coordinate
- monitor: docker_api, deploy_ops, finding_ops, forge_cost, forge_fleet_intel
- analyze: db_query, web_search, memory_store, code_analysis, forge_knowledge_graph

## MCP tools (${ctx.toolCount}):
${toolSection}

## Agent fleet:
${agentSection}

## Skills (${ctx.skillCount}):
${skillSection}

## Integrations:
- Channels: ${ctx.channels.join(', ')} — digest, moderate, respond, broadcast
- Git: ${ctx.gitProviders.join(', ')} — PR review, issue triage, repo analysis, deployments

Respond in JSON:
{
  "category": "research|monitor|build|analyze|automate|security|dev",
  "confidence": 0.0-1.0,
  "taskDescription": "What the agent should do",
  "agentName": "Short descriptive name",
  "systemPrompt": "A focused system prompt for the agent",
  "isRecurring": false,
  "schedule": null or "6h" or "24h" etc,
  "complexity": "low|medium|high",
  "executionMode": "single|pipeline|fan-out|consensus",
  "subtasks": null or [{ "title": "", "description": "", "suggestedAgentType": "", "dependencies": [], "estimatedComplexity": "" }]
}`;
}

/**
 * Build a markdown context document for embedding in Claude Code / Codex sessions.
 * Optionally includes project-specific context.
 */
export async function buildSessionContext(opts?: {
  sessionType: 'claude-code' | 'codex';
  projectName?: string;
  projectDescription?: string;
}): Promise<string> {
  const ctx = await getPlatformContext();
  const type = opts?.sessionType ?? 'claude-code';
  const label = type === 'claude-code' ? 'Claude Code' : 'Codex';

  const toolSection = Object.entries(ctx.tools)
    .map(([cat, tools]) => `- **${cat}**: ${tools.join(', ')}`)
    .join('\n');

  const agentList = [...ctx.agents.userFacing, ...ctx.agents.internal].join(', ');

  const skillSection = Object.entries(ctx.skills)
    .map(([cat, slugs]) => `- **${cat}**: ${slugs.join(', ')}`)
    .join('\n');

  let projectSection = '';
  if (opts?.projectName) {
    projectSection = `
## Current Project: ${opts.projectName}
${opts.projectDescription || 'No description provided.'}
`;
  }

  return `# ${label} Session — AskAlf Platform

You are an embedded ${label} instance inside AskAlf (askalf.org), a self-hosted AI agent orchestration platform.
${projectSection}
## Platform
- **Stack**: ${ctx.stack}
- **Channels**: ${ctx.channels.join(', ')}
- **Git integrations**: ${ctx.gitProviders.join(', ')}

## MCP Tools (${ctx.toolCount})
${toolSection}

## Agent Fleet (${ctx.agents.internal.length + ctx.agents.userFacing.length})
${agentList}

## Skills (${ctx.skillCount})
${skillSection}

## Workspace
- Monorepo at \`/workspace\`
- \`apps/forge/\` — Agent orchestration engine
- \`apps/dashboard/\` — Unified frontend
- \`apps/mcp-tools/\` — MCP tool server
- \`packages/\` — Shared packages (@askalf/db, @askalf/auth, @askalf/core, @askalf/database, @askalf/observability, @askalf/email)
- \`skills/\` — Skill definitions (markdown + YAML frontmatter)

## Key Patterns
- DB queries return \`T[]\` directly (NOT \`.rows\`) via \`query<T>()\`
- IDs: \`ulid()\` everywhere
- ESM modules, strict TypeScript
- Docker multi-stage builds, non-root user (uid 1001)

## Build
- \`./scripts/build.sh <service>\` / \`./scripts/deploy.sh <service>\`
- Batch changes first, one rebuild at the end
- Never edit code inside running containers
`;
}
