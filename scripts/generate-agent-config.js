#!/usr/bin/env node

/**
 * Generate Agent Container Configurations
 *
 * Reads all agents from the forge database and generates per-agent:
 * 1. CLAUDE.md — system prompt + tool docs + workspace knowledge
 * 2. mcp.json — MCP server configuration based on enabled_tools
 *
 * Usage:
 *   node scripts/generate-agent-config.js
 *   # Or from backup container:
 *   docker exec substrate-prod-backup node /workspace/scripts/generate-agent-config.js
 *
 * Output: agent-configs/<agent-name>/CLAUDE.md and mcp.json
 */

const pg = require('pg');
const { writeFileSync, mkdirSync, existsSync } = require('fs');
const { join } = require('path');

const FORGE_DB_URL = process.env.FORGE_DATABASE_URL
  || process.env.DATABASE_URL
  || 'postgresql://substrate:substrate_dev@postgres:5432/forge';

const OUTPUT_DIR = process.env.OUTPUT_DIR || join(process.cwd(), 'agent-configs');

// MCP server URLs
const MCP_TOOLS_URL = process.env.MCP_TOOLS_URL || 'http://mcp-tools:3010';
const MCP_ALF_URL = process.env.MCP_ALF_URL || 'http://mcp-alf:3013';

// Unified MCP tools server (15 tools)
const MCP_TOOL_NAMES = new Set([
  'ticket_ops', 'finding_ops', 'intervention_ops', 'agent_call',
  'db_query', 'substrate_db_query', 'memory_search', 'memory_store',
  'docker_api', 'deploy_ops', 'security_scan', 'code_analysis',
  'web_search', 'web_browse', 'team_coordinate',
]);

// ALF MCP server (4 tools)
const MCP_ALF_TOOL_NAMES = new Set([
  'alf_profile_read', 'alf_profile_update', 'shard_search', 'convergence_stats',
]);

// Native Claude Code tools (no MCP needed)
const NATIVE_TOOLS = new Set([
  'file_ops', 'shell_exec',
  'code_exec', 'git_ops', 'api_call',
]);

async function main() {
  const pool = new pg.Pool({ connectionString: FORGE_DB_URL, max: 3 });

  try {
    // Get all agents that should run in containers (active + paused, skip archived)
    const result = await pool.query(`
      SELECT id, name, system_prompt, enabled_tools, autonomy_level,
             max_iterations, max_cost_per_execution, model_id, runtime_mode
      FROM forge_agents
      WHERE status IN ('active', 'paused')
      ORDER BY name
    `);

    console.log(`Found ${result.rows.length} active agents`);

    // Ensure output directory exists
    if (!existsSync(OUTPUT_DIR)) {
      mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    for (const agent of result.rows) {
      const safeName = agent.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
      const agentDir = join(OUTPUT_DIR, safeName);

      if (!existsSync(agentDir)) {
        mkdirSync(agentDir, { recursive: true });
      }

      // Generate CLAUDE.md
      const claudeMd = generateClaudeMd(agent);
      writeFileSync(join(agentDir, 'CLAUDE.md'), claudeMd);

      // Generate mcp.json
      const mcpJson = generateMcpJson(agent.enabled_tools || []);
      writeFileSync(join(agentDir, 'mcp.json'), JSON.stringify(mcpJson, null, 2));

      console.log(`  Generated config for: ${agent.name} (${safeName})`);
      console.log(`    Tools: ${(agent.enabled_tools || []).length}, MCP servers: ${Object.keys(mcpJson.mcpServers || {}).length}`);
    }

    console.log(`\nConfigs written to: ${OUTPUT_DIR}`);
  } finally {
    await pool.end();
  }
}

function generateClaudeMd(agent) {
  const lines = [
    `# ${agent.name} — Agent Configuration`,
    '',
    `Agent ID: ${agent.id}`,
    `Autonomy Level: ${agent.autonomy_level}`,
    `Max Iterations: ${agent.max_iterations}`,
    `Max Cost: $${agent.max_cost_per_execution}`,
    '',
    '## System Prompt',
    '',
    agent.system_prompt || 'No system prompt configured.',
    '',
    '## Available Tools',
    '',
  ];

  const tools = agent.enabled_tools || [];
  if (tools.length > 0) {
    for (const tool of tools) {
      const isMcp = MCP_TOOL_NAMES.has(tool);
      const isAlf = MCP_ALF_TOOL_NAMES.has(tool);
      const native = NATIVE_TOOLS.has(tool);
      const source = native ? '(native)' : isMcp ? '(mcp-tools)' : isAlf ? '(mcp-alf)' : '(unknown)';
      lines.push(`- ${tool} ${source}`);
    }
  } else {
    lines.push('No tools configured.');
  }

  lines.push('', '## Workspace', '');
  lines.push('The workspace is mounted at /workspace (read-only).');
  lines.push('It contains the full substrate monorepo source code.');
  lines.push('');
  lines.push('## Rules', '');
  lines.push('- Always use intervention_ops to request approval for destructive actions');
  lines.push('- Create tickets for work items that need tracking');
  lines.push('- Report findings for discoveries and insights');
  lines.push('- Store important knowledge in fleet memory via memory_store');
  lines.push('- Search fleet memory before starting tasks to build on prior work');

  return lines.join('\n');
}

function generateMcpJson(enabledTools) {
  const mcpTools = enabledTools.filter(t => MCP_TOOL_NAMES.has(t));
  const alfTools = enabledTools.filter(t => MCP_ALF_TOOL_NAMES.has(t));

  if (mcpTools.length === 0 && alfTools.length === 0) {
    return { mcpServers: {} };
  }

  const servers = {};
  if (mcpTools.length > 0) {
    servers.tools = { type: 'http', url: `${MCP_TOOLS_URL}/mcp` };
  }
  if (alfTools.length > 0) {
    servers.alf = { type: 'http', url: `${MCP_ALF_URL}/mcp` };
  }
  return { mcpServers: servers };
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
