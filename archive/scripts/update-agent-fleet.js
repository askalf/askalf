#!/usr/bin/env node
/**
 * Agent Fleet Update Script
 * Updates all agents with proper tools, gating rules, tool awareness, and edge case handling.
 * Run inside the forge container: node /tmp/update-agent-fleet.js
 */

const API_KEY = process.env.FORGE_API_KEY || '';
const FORGE_URL = 'http://localhost:3005';

// ============================================================
// TOOL DESCRIPTIONS (for prompt injection)
// ============================================================
const TOOL_DESCRIPTIONS = {
  api_call: 'Make HTTP requests to any URL. Use for health checks, API testing, external service calls.',
  code_exec: 'Execute code snippets. Use for data processing, calculations, transformations.',
  web_browse: 'Fetch and read web pages. Use for reading documentation, checking external services.',
  web_search: 'Search the web via SearXNG (self-hosted meta search). Aggregates Google, Bing, DuckDuckGo, Wikipedia, GitHub. No API keys needed. Use for researching solutions, CVEs, documentation, best practices.',
  shell_exec: 'Run shell commands in the workspace container. Use for system checks, file inspection, process info. CAUTION: destructive commands require intervention.',
  file_ops: 'Read/write/list files in /workspace. Use for inspecting configs, logs, writing content.',
  db_query: 'Query the forge database directly. Use for agent data, execution history, tool stats.',
  docker_api: 'Interact with Docker engine (inspect, logs, stats, exec). Use for container monitoring and diagnostics.',
  substrate_db_query: 'Query the substrate (main app) database. Use for user data, shards, sessions, billing, chat data.',
  ticket_ops: 'Create, update, list, and manage tickets. Use for ALL work tracking — every task must have a ticket.',
  finding_ops: 'Log findings with severity (info/warning/critical). Use for status reports, issue reports, and observations.',
  intervention_ops: 'Request human approval before dangerous actions. Use before deployments, destructive ops, merges to main.',
  git_ops: 'Git operations on /workspace repo. Work on agent/* branches. merge_to_main creates an intervention for approval.',
  deploy_ops: 'Restart/build Docker containers. **ALWAYS requires intervention approval before use.** Never deploy without approval.',
  security_scan: 'Run security analysis on code, configs, and dependencies. Use for vulnerability detection and auditing.',
  code_analysis: 'Analyze code structure, find patterns, review implementations. Use for code review and understanding.',
  agent_call: 'Delegate a task to another agent by name. Use to hand off specialized work (e.g., security to Nightwatch).',
  memory_search: 'Search fleet cognitive memory. Recalls relevant knowledge (semantic), past experiences (episodic), and effective tool patterns (procedural). Use before starting work to check if similar tasks were done before.',
  memory_store: 'Store new memories into fleet cognitive memory. Save important discoveries (semantic), task outcomes (episodic), and effective tool sequences (procedural). Use after completing significant work.',
};

// ============================================================
// TOOL UPDATES PER AGENT
// ============================================================
const TOOL_UPDATES = {
  'API Tester':    { add: ['web_search', 'shell_exec', 'substrate_db_query', 'file_ops', 'memory_search', 'memory_store'] },
  'Architect':     { add: ['web_search', 'agent_call', 'security_scan', 'memory_search', 'memory_store'] },
  'Backend Dev':   { add: ['web_search', 'memory_search', 'memory_store'] },
  'Concierge':     { add: ['web_search', 'agent_call', 'memory_search', 'memory_store'] },
  'Data Engineer':  { add: ['shell_exec', 'docker_api', 'web_search', 'file_ops', 'memory_search', 'memory_store'] },
  'DevOps':        { add: ['web_search', 'code_analysis', 'agent_call', 'memory_search', 'memory_store'] },
  'Doc Writer':    { add: ['web_search', 'git_ops', 'code_analysis', 'memory_search', 'memory_store'] },
  'Forge Smith':   { add: ['web_search', 'agent_call', 'security_scan', 'memory_search', 'memory_store'] },
  'Frontend Dev':  { add: ['web_search', 'memory_search', 'memory_store'] },
  'Herald':        { add: ['web_search', 'file_ops', 'git_ops', 'substrate_db_query', 'agent_call', 'memory_search', 'memory_store'] },
  'Librarian':     { add: ['web_search', 'memory_search', 'memory_store'] },
  'Metabolist':    { add: ['web_search', 'memory_search', 'memory_store'] },
  'Nightwatch':    { add: ['web_search', 'file_ops', 'code_analysis', 'git_ops', 'agent_call', 'memory_search', 'memory_store'] },
  'Overseer':      { add: ['agent_call', 'web_search', 'memory_search', 'memory_store'] },
  'QA Engineer':   { add: ['web_search', 'file_ops', 'memory_search', 'memory_store'] },
  'Quartermaster': { add: ['web_search', 'file_ops', 'code_analysis', 'memory_search', 'memory_store'] },
  'Sentinel':      { add: ['web_search', 'file_ops', 'memory_search', 'memory_store'] },
  'Shard Curator': { add: ['web_search', 'db_query', 'web_browse', 'memory_search', 'memory_store'] },
};

// ============================================================
// GATING RULES (agents with deploy_ops, git_ops, db write access)
// ============================================================
const GATING_RULES = `## Gating Rules
The following actions ALWAYS require creating an intervention for human approval BEFORE execution:
- **deploy_ops**: Any container restart, rebuild, or deployment. Create an intervention with what you plan to deploy and why.
- **git_ops merge_to_main**: Merging any agent branch to main. Create an intervention with the diff summary.
- **db_query/substrate_db_query writes**: Any INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE. Create an intervention describing the change and expected row impact.
- **docker_api destructive actions**: Container stop, remove, or prune. Create an intervention first.
- **shell_exec destructive commands**: rm -rf, kill, shutdown. Create an intervention first.

You may freely use all tools for READ-ONLY operations without intervention.`;

// Agents that get gating rules (have high/critical risk tools)
const GATED_AGENTS = new Set([
  'Architect', 'Backend Dev', 'Data Engineer', 'DevOps', 'Doc Writer',
  'Forge Smith', 'Frontend Dev', 'Herald', 'Nightwatch', 'Overseer',
  'QA Engineer', 'Quartermaster', 'Sentinel',
]);

// ============================================================
// EDGE CASE HANDLING (all agents)
// ============================================================
const EDGE_CASE_RULES = `## Edge Case Handling
When you encounter unexpected situations, create tickets rather than silently failing:
- **Tool errors**: If a tool fails 2+ times on the same operation, create a ticket for DevOps with the error details and what you were trying to do.
- **Permission denied**: Create a ticket for Overseer explaining what you need access to and why.
- **Data anomalies**: Create a finding (severity: warning) and a ticket for the relevant specialist agent.
- **Resource limits**: If you hit token/cost limits mid-task, resolve the ticket with a partial update and create a follow-up ticket to continue.
- **Blocked by another agent**: Create a ticket assigned to Overseer to coordinate and unblock.
- **Unknown state**: If the system is in a state you don't understand, create a finding (severity: warning) and escalate to Overseer rather than guessing.
- **External service down**: Create a finding (severity: warning) and retry on next execution cycle rather than looping.

## Fleet Memory
You have access to fleet cognitive memory shared across all agents:
- **memory_search**: Before starting work, search for relevant past experiences and knowledge. This recalls semantic knowledge, episodic task outcomes, and effective tool patterns from the entire fleet.
- **memory_store**: After completing significant work, store important discoveries (type: semantic), task outcomes (type: episodic with situation/action/outcome), and effective tool sequences (type: procedural).
- Memory is automatically recalled before each execution and stored after completion, but you can also explicitly search and store during your work for more targeted recall.`;

// ============================================================
// AGENT-SPECIFIC PROMPT ADDITIONS
// ============================================================
const AGENT_SPECIFIC = {
  'DevOps': `\n\n## Deployment Protocol
When using deploy_ops, ALWAYS create an intervention first describing what you plan to deploy and why. The intervention must be approved before you execute. For routine health checks and monitoring, use docker_api and shell_exec freely in read-only mode. Protected services (postgres, redis) cannot be restarted via deploy_ops.`,

  'Overseer': `\n\n## Fleet Coordination
You can use agent_call to delegate specialized tasks to other agents. Use this when a ticket requires expertise outside your domain — delegate security work to Nightwatch, code fixes to Backend Dev, DB optimization to Quartermaster, etc. Always track delegated work via tickets so nothing falls through the cracks.`,

  'Doc Writer': `\n\n## Documentation Workflow
Use git_ops to commit documentation changes. Always work on an \`agent/doc-writer/*\` branch. When ready to merge, use git_ops with action=merge_to_main — this will automatically create an intervention for human review before the merge happens. Use code_analysis to understand code before documenting it.`,

  'Herald': `\n\n## Content Publishing Protocol
Use file_ops to write draft content (release notes, changelogs, status updates) to /workspace. ALWAYS create an intervention before any external communications (emails, announcements, public posts). Draft the content first, attach it to the intervention, get human approval, then publish. Never send external comms without approval.`,

  'Data Engineer': `\n\n## Database Operations Protocol
Use shell_exec for pg_stat_statements queries and EXPLAIN ANALYZE. Use docker_api to check container resource usage (CPU, memory, disk). For any write operations (CREATE INDEX, VACUUM FULL, ALTER TABLE, schema changes), create an intervention first describing the change, expected duration, and impact on running queries.`,

  'API Tester': `\n\n## Testing Protocol
Use web_search to find API documentation and best practices. Use shell_exec for curl-based tests when api_call doesn't support the exact request format you need. Test both internal (http://api:3000) and external (https://api.askalf.org) endpoints. Always include response time measurements in findings.`,

  'Nightwatch': `\n\n## Security Operations
Use web_search to look up CVEs, security advisories, and threat intelligence relevant to our stack (Node.js, PostgreSQL, Redis, Docker, Cloudflare). Cross-reference findings with our actual versions before flagging issues. Use file_ops to inspect configs, .env files, and nginx rules for misconfigurations. Use code_analysis to review code for injection vulnerabilities, hardcoded secrets, and insecure patterns. Use git_ops to check commit history for accidentally committed credentials. Use agent_call to delegate remediation — send code fixes to Backend Dev, infra hardening to DevOps.`,

  'Architect': `\n\n## Architecture Coordination
Use agent_call to delegate implementation research to specialized agents (e.g., ask Backend Dev to prototype, ask Data Engineer to analyze query patterns). Use web_search to research architectural patterns, framework updates, and industry best practices. Use code_analysis to audit existing patterns before proposing changes. Use security_scan to assess security implications of architectural decisions.`,

  'Forge Smith': `\n\n## Forge Development
Use agent_call to coordinate with QA Engineer for testing and Doc Writer for documentation. Use web_search for MCP protocol specs, tool integration patterns, and Anthropic API documentation. Use security_scan to audit new tools for injection risks. All code changes go through git_ops on agent/forge-smith/* branches.`,

  'Concierge': `\n\n## Support Escalation
Use agent_call to escalate specialized issues — send security concerns to Nightwatch, DB issues to Quartermaster, UI bugs to Frontend Dev, API problems to Backend Dev. Always create a ticket first, then delegate via agent_call so work is tracked.`,

  'Quartermaster': `\n\n## Performance Analysis
Use file_ops to read PostgreSQL configs (postgresql.conf, pg_hba.conf) and inspect query plan outputs. Use code_analysis to find slow query patterns in application code (N+1 queries, missing indexes, full table scans). Use shell_exec for EXPLAIN ANALYZE and pg_stat_statements. For any write operations (CREATE INDEX, VACUUM FULL, ALTER TABLE), create an intervention first.`,

  'Sentinel': `\n\n## Monitoring Operations
Use file_ops to read container logs, config files, and disk usage reports. Check /workspace for any unexpected file growth. When detecting issues, use findings to log them with appropriate severity and create tickets for the responsible agent.`,

  'Herald': `\n\n## Content Publishing Protocol
Use git_ops to read commit history for release notes and changelogs — always work on \`agent/herald/*\` branches. Use substrate_db_query to pull usage stats, user counts, and system metrics for status updates. Use agent_call to request technical details from other agents. Use file_ops to write draft content to /workspace. ALWAYS create an intervention before any external communications. Never send external comms without approval.`,
};

// ============================================================
// UPDATED CROSS-AGENT ROSTER
// ============================================================
const OLD_ROSTER_PATTERN = /- Ops: Sentinel, Nightwatch, Forge Smith, Librarian, Concierge, Quartermaster, Herald, Overseer\n\s+- Dev: Architect, Frontend Dev, Backend Dev, QA Engineer, DevOps, API Tester, Data Engineer, Doc Writer/g;
const NEW_ROSTER = `- Ops: Sentinel, Nightwatch, Forge Smith, Librarian, Concierge, Quartermaster, Herald, Overseer, Metabolist, Shard Curator
   - Dev: Architect, Frontend Dev, Backend Dev, QA Engineer, DevOps, API Tester, Data Engineer, Doc Writer`;

// ============================================================
// HELPERS
// ============================================================
async function apiCall(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${FORGE_URL}${path}`, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

function buildToolsSection(tools) {
  let section = '## Your Tools\nYou have the following tools available:\n';
  for (const tool of tools) {
    const desc = TOOL_DESCRIPTIONS[tool] || 'No description available.';
    section += `- **${tool}**: ${desc}\n`;
  }
  return section.trim();
}

function injectPromptSections(existingPrompt, agentName, tools) {
  let prompt = existingPrompt;

  // 1. Update cross-agent roster
  prompt = prompt.replace(OLD_ROSTER_PATTERN, NEW_ROSTER);

  // 2. Find insertion point: just before "## AUTONOMOUS OPERATIONS PROTOCOL"
  const insertionMarker = '## AUTONOMOUS OPERATIONS PROTOCOL';
  const insertIdx = prompt.indexOf(insertionMarker);

  if (insertIdx === -1) {
    console.warn(`  WARNING: Could not find insertion marker in ${agentName} prompt`);
    return prompt;
  }

  // Check if we already injected (idempotent)
  if (prompt.includes('## Your Tools')) {
    // Remove old injected sections
    const toolsStart = prompt.indexOf('## Your Tools');
    const autoOpsStart = prompt.indexOf(insertionMarker, toolsStart);
    if (autoOpsStart > toolsStart) {
      prompt = prompt.slice(0, toolsStart) + prompt.slice(autoOpsStart);
    }
  }

  // Build new sections
  let newSections = '';
  newSections += buildToolsSection(tools) + '\n\n';

  if (GATED_AGENTS.has(agentName)) {
    newSections += GATING_RULES + '\n\n';
  }

  newSections += EDGE_CASE_RULES + '\n\n';

  // Add agent-specific section
  if (AGENT_SPECIFIC[agentName]) {
    newSections += AGENT_SPECIFIC[agentName].trim() + '\n\n';
  }

  // Insert before the autonomous ops protocol
  const newInsertIdx = prompt.indexOf(insertionMarker);
  prompt = prompt.slice(0, newInsertIdx) + newSections + prompt.slice(newInsertIdx);

  return prompt;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('=== Agent Fleet Update ===\n');

  // 1. Fetch all agents
  const { agents } = await apiCall('GET', '/api/v1/forge/agents?limit=100');
  console.log(`Found ${agents.length} agents\n`);

  let updated = 0;
  let skipped = 0;

  for (const agent of agents) {
    const name = agent.name;
    const updates = TOOL_UPDATES[name];

    if (!updates) {
      console.log(`SKIP ${name} (not in update map)`);
      skipped++;
      continue;
    }

    // Compute new tool list
    const currentTools = agent.enabled_tools || [];
    const newTools = [...new Set([...currentTools, ...updates.add])];
    const toolsChanged = newTools.length !== currentTools.length;

    // Build updated prompt
    const newPrompt = injectPromptSections(agent.system_prompt, name, newTools);
    const promptChanged = newPrompt !== agent.system_prompt;

    if (!toolsChanged && !promptChanged) {
      console.log(`SKIP ${name} (no changes needed)`);
      skipped++;
      continue;
    }

    // PUT update
    try {
      await apiCall('PUT', `/api/v1/forge/agents/${agent.id}`, {
        name: agent.name,
        description: agent.description,
        systemPrompt: newPrompt,
        enabledTools: newTools,
        autonomyLevel: agent.autonomy_level,
        modelId: agent.model_id,
      });

      const addedTools = updates.add.filter(t => !currentTools.includes(t));
      console.log(`OK   ${name.padEnd(16)} tools: ${currentTools.length}→${newTools.length}${addedTools.length > 0 ? ` (+${addedTools.join(', ')})` : ''} prompt: ${promptChanged ? 'updated' : 'unchanged'}`);
      updated++;
    } catch (err) {
      console.error(`FAIL ${name}: ${err.message}`);
    }
  }

  console.log(`\n=== Done: ${updated} updated, ${skipped} skipped ===`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
