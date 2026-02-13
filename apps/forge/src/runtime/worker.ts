/**
 * Forge Execution Worker
 * Wires together provider adapters, tool registry, and the execution engine.
 * Provides `runDirectCliExecution()` for CLI-based agent execution (Phase 7).
 * Also retains `runExecution()` for SDK-based execution as fallback.
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, access, copyFile, mkdir, unlink } from 'fs/promises';
import { loadConfig, type ForgeConfig } from '../config.js';
import { AnthropicAdapter } from '../providers/adapters/anthropic.js';
import type { IProviderAdapter } from '../providers/interface.js';
import { ToolRegistry } from '../tools/registry.js';
import { executeTools, type ToolCall as ExecutorToolCall } from '../tools/executor.js';
import { execute, type ExecutionContext, type ExecutionDeps } from './engine.js';
import { executeBatch, type BatchAgentExecution, type BatchExecutionResult } from './batch-engine.js';
import { query } from '../database.js';

// Built-in tools
import { apiCall } from '../tools/built-in/api-call.js';
import { codeExec } from '../tools/built-in/code-exec.js';
import { webBrowse } from '../tools/built-in/web-browse.js';
import { shellExec } from '../tools/built-in/shell-exec.js';
import { fileOps } from '../tools/built-in/file-ops.js';
import { dbQuery } from '../tools/built-in/db-query.js';
import { dockerApi } from '../tools/built-in/docker-api.js';
import { substrateDbQuery } from '../tools/built-in/substrate-db-query.js';
import { ticketOps } from '../tools/built-in/ticket-ops.js';
import { findingOps } from '../tools/built-in/finding-ops.js';
import { interventionOps } from '../tools/built-in/intervention-ops.js';
import { gitOps } from '../tools/built-in/git-ops.js';
import { deployOps } from '../tools/built-in/deploy-ops.js';
import { securityScan } from '../tools/built-in/security-scan.js';
import { codeAnalysis } from '../tools/built-in/code-analysis.js';

// ============================================
// State
// ============================================

let config: ForgeConfig;
let provider: IProviderAdapter;
let registry: ToolRegistry;
let initialized = false;

// ============================================
// Initialization
// ============================================

/**
 * Initialize the execution worker.
 * Sets up the provider adapter, tool registry, and registers built-in tools.
 * Called once on server startup.
 */
export async function initializeWorker(): Promise<void> {
  if (initialized) return;

  config = loadConfig();

  // Initialize Anthropic provider (primary provider with optional fallback key)
  provider = new AnthropicAdapter();
  await provider.initialize({
    apiKey: config.anthropicApiKey,
    apiKeyFallback: config.anthropicApiKeyFallback,
  });

  // Initialize tool registry
  registry = new ToolRegistry();

  // Register built-in tool implementations
  registerBuiltInTools(registry);

  // Load tool metadata from database (updates schemas, preserves execute functions)
  try {
    await registry.loadFromDatabase();
  } catch (err) {
    console.warn('[Worker] Could not load tools from database:', err);
  }

  initialized = true;
  console.log(`[Worker] Execution worker initialized with ${registry.size} tools`);
}

// ============================================
// Built-in Tool Registration
// ============================================

function registerBuiltInTools(reg: ToolRegistry): void {
  reg.register({
    name: 'api_call',
    displayName: 'API Call',
    description: 'Make HTTP requests to REST APIs. Supports GET, POST, PUT, DELETE, PATCH.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to call' },
        method: { type: 'string', description: 'HTTP method (GET, POST, PUT, DELETE, PATCH)' },
        headers: { type: 'object', description: 'Optional request headers' },
        body: { description: 'Optional request body (auto-serialized to JSON)' },
      },
      required: ['url', 'method'],
    },
    execute: (input) => apiCall(input as unknown as Parameters<typeof apiCall>[0]),
  });

  reg.register({
    name: 'code_exec',
    displayName: 'Code Execute',
    description: 'Execute JavaScript code in a sandboxed environment. Captures console output.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
        language: { type: 'string', description: 'Programming language (only javascript supported)' },
      },
      required: ['code'],
    },
    execute: (input) => codeExec(input as unknown as Parameters<typeof codeExec>[0]),
  });

  reg.register({
    name: 'web_browse',
    displayName: 'Web Browse',
    description: 'Fetch a URL and extract its text content. Supports basic CSS selector filtering.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
        selector: { type: 'string', description: 'Optional CSS tag selector to filter content' },
        maxLength: { type: 'number', description: 'Max content length (default 5000)' },
      },
      required: ['url'],
    },
    execute: (input) => webBrowse(input as unknown as Parameters<typeof webBrowse>[0]),
  });

  reg.register({
    name: 'shell_exec',
    displayName: 'Shell Execute',
    description: 'Execute shell commands. Blocks dangerous patterns. 30s default timeout.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        cwd: { type: 'string', description: 'Working directory (default /app)' },
        timeout: { type: 'number', description: 'Timeout in ms (max 60000)' },
      },
      required: ['command'],
    },
    execute: (input) => shellExec(input as unknown as Parameters<typeof shellExec>[0]),
  });

  reg.register({
    name: 'file_ops',
    displayName: 'File Operations',
    description: 'Read, write, list, or check existence of files. Restricted to workspace root.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['read', 'write', 'list', 'exists'],
          description: 'Operation to perform',
        },
        path: { type: 'string', description: 'File or directory path (relative to workspace)' },
        content: { type: 'string', description: 'Content to write (for write operation)' },
      },
      required: ['operation', 'path'],
    },
    execute: (input) => fileOps(input as unknown as Parameters<typeof fileOps>[0]),
  });

  reg.register({
    name: 'db_query',
    displayName: 'Database Query',
    description: 'Execute read-only SQL queries against the forge database. SELECT, WITH, EXPLAIN only.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL query (SELECT only)' },
        params: { type: 'array', description: 'Parameterized query values' },
      },
      required: ['sql'],
    },
    execute: (input) => dbQuery(input as unknown as Parameters<typeof dbQuery>[0]),
  });

  reg.register({
    name: 'docker_api',
    displayName: 'Docker API',
    description: 'Interact with Docker containers: list, inspect, logs, stats, exec commands, view processes.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'inspect', 'logs', 'stats', 'exec', 'top'],
          description: 'Docker action to perform',
        },
        container: { type: 'string', description: 'Container name or ID (required for all except list)' },
        command: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command to exec in container (for exec action)',
        },
        tail: { type: 'number', description: 'Number of log lines to return (default 100)' },
      },
      required: ['action'],
    },
    execute: (input) => dockerApi(input as unknown as Parameters<typeof dockerApi>[0]),
  });

  reg.register({
    name: 'substrate_db_query',
    displayName: 'Substrate DB Query',
    description: 'Execute read-only SQL queries against the main substrate database (users, shards, chat, sessions).',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL query (SELECT only)' },
        params: { type: 'array', description: 'Parameterized query values' },
      },
      required: ['sql'],
    },
    execute: (input) => substrateDbQuery(input as unknown as Parameters<typeof substrateDbQuery>[0]),
  });

  // --- Autonomous Operation Tools ---
  // These tools let agents create tickets, report findings, and request interventions
  // so the fleet can operate fully autonomously 24/7.

  reg.register({
    name: 'ticket_ops',
    displayName: 'Ticket Operations',
    description: 'Create, update, assign, list, get tickets, and view audit history. Use this to track all work — open tickets for new tasks, update status as you work, close when done, and assign work to other agents. Use audit_history to see the full immutable trail of changes for any ticket.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'assign', 'list', 'get', 'audit_history'],
          description: 'Operation to perform',
        },
        title: { type: 'string', description: 'Ticket title (required for create)' },
        description: { type: 'string', description: 'Detailed ticket description' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Ticket priority' },
        category: { type: 'string', description: 'Category (task, bug, feature, maintenance, security)' },
        assigned_to: { type: 'string', description: 'Agent name to assign to' },
        agent_id: { type: 'string', description: 'Your agent ID' },
        agent_name: { type: 'string', description: 'Your agent name' },
        ticket_id: { type: 'string', description: 'Ticket ID (for update/assign/get)' },
        status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'], description: 'Ticket status' },
        resolution: { type: 'string', description: 'Resolution note — what was done to resolve this ticket (use when setting status to resolved)' },
        filter_status: { type: 'string', description: 'Filter by status (for list)' },
        filter_assigned_to: { type: 'string', description: 'Filter by assigned agent (for list)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
      required: ['action'],
    },
    execute: (input) => ticketOps(input as unknown as Parameters<typeof ticketOps>[0]),
  });

  reg.register({
    name: 'finding_ops',
    displayName: 'Finding Operations',
    description: 'Report findings, insights, issues, and observations. Use this to log anything noteworthy: security issues, performance problems, bugs discovered, optimization opportunities, or status reports.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'get'],
          description: 'Operation to perform',
        },
        finding: { type: 'string', description: 'The finding/observation text (required for create)' },
        severity: { type: 'string', enum: ['info', 'warning', 'critical'], description: 'Severity level' },
        category: { type: 'string', description: 'Category (security, performance, bug, optimization, status)' },
        agent_id: { type: 'string', description: 'Your agent ID' },
        agent_name: { type: 'string', description: 'Your agent name (required for create)' },
        execution_id: { type: 'string', description: 'Current execution ID' },
        metadata: { type: 'object', description: 'Additional structured data' },
        finding_id: { type: 'string', description: 'Finding ID (for get)' },
        filter_severity: { type: 'string', description: 'Filter by severity (for list)' },
        filter_agent_id: { type: 'string', description: 'Filter by agent ID (for list)' },
        filter_category: { type: 'string', description: 'Filter by category (for list)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
      required: ['action'],
    },
    execute: (input) => findingOps(input as unknown as Parameters<typeof findingOps>[0]),
  });

  reg.register({
    name: 'intervention_ops',
    displayName: 'Intervention Operations',
    description: 'Request human intervention when you need approval, hit a blocker, encounter an error you cannot resolve, or need a decision from a human operator. Also check status of previous intervention requests.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'get', 'check'],
          description: 'Operation to perform',
        },
        agent_id: { type: 'string', description: 'Your agent ID' },
        agent_name: { type: 'string', description: 'Your agent name (required for create)' },
        agent_type: { type: 'string', description: 'Your agent type (ops, dev, etc.)' },
        task_id: { type: 'string', description: 'Related task/execution ID' },
        type: { type: 'string', enum: ['approval', 'escalation', 'feedback', 'error', 'resource'], description: 'Intervention type' },
        title: { type: 'string', description: 'Brief title (required for create)' },
        description: { type: 'string', description: 'Detailed description of what you need' },
        context: { type: 'string', description: 'Relevant context or data' },
        proposed_action: { type: 'string', description: 'What you propose to do (for approval requests)' },
        intervention_id: { type: 'string', description: 'Intervention ID (for get/check)' },
        filter_status: { type: 'string', description: 'Filter by status (for list)' },
        filter_agent_id: { type: 'string', description: 'Filter by agent (for list)' },
        limit: { type: 'number', description: 'Max results (default 20, max 50)' },
      },
      required: ['action'],
    },
    execute: (input) => interventionOps(input as unknown as Parameters<typeof interventionOps>[0]),
  });

  // --- Productivity Tools ---
  // Real tools for real work: git, deploy, security, code analysis

  reg.register({
    name: 'git_ops',
    displayName: 'Git Operations',
    description: 'Git operations for source code management. Create branches, commit code, view diffs/logs, and request merges. All work happens on agent/* branches — merging to main requires human approval.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'diff', 'log', 'branch_list', 'branch_create', 'checkout', 'add', 'commit', 'merge_to_main'],
          description: 'Git action to perform',
        },
        branch_name: { type: 'string', description: 'Branch name (auto-prefixed with agent/<name>/ for branch_create)' },
        paths: { type: 'array', items: { type: 'string' }, description: 'File paths to add (for add action)' },
        message: { type: 'string', description: 'Commit message (for commit action)' },
        max_count: { type: 'number', description: 'Max log entries (default 20, max 50)' },
        cached: { type: 'boolean', description: 'Show staged changes (for diff action)' },
        file_path: { type: 'string', description: 'Specific file to diff' },
        agent_name: { type: 'string', description: 'Your agent name (required for branch_create, commit, merge_to_main)' },
        agent_id: { type: 'string', description: 'Your agent ID' },
      },
      required: ['action'],
    },
    execute: (input) => gitOps(input as unknown as Parameters<typeof gitOps>[0]),
  });

  reg.register({
    name: 'deploy_ops',
    displayName: 'Deploy Operations',
    description: 'Deployment operations: check container status, view logs, restart services, trigger builds. Critical actions (restart, build) require human approval via intervention gating.',
    type: 'built_in',
    riskLevel: 'critical',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'logs', 'restart', 'build'],
          description: 'Deploy action to perform',
        },
        service: { type: 'string', description: 'Service name (api, dashboard, forge, worker, scheduler, nginx, mcp, self)' },
        tail: { type: 'number', description: 'Number of log lines (default 100, max 200)' },
        intervention_id: { type: 'string', description: 'Approved intervention ID (required for restart/build execution)' },
        agent_name: { type: 'string', description: 'Your agent name (required for restart, build)' },
        agent_id: { type: 'string', description: 'Your agent ID' },
      },
      required: ['action'],
    },
    execute: (input) => deployOps(input as unknown as Parameters<typeof deployOps>[0]),
  });

  reg.register({
    name: 'security_scan',
    displayName: 'Security Scan',
    description: 'Security analysis: npm audit, dependency checks, file permission scanning, environment variable leak detection, Docker container security inspection.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['npm_audit', 'dependency_check', 'file_permissions', 'env_leak_check', 'docker_security'],
          description: 'Security scan action to perform',
        },
        package_dir: { type: 'string', description: 'Package directory relative to repo root (for npm_audit, dependency_check)' },
        scan_path: { type: 'string', description: 'Path to scan relative to repo root (for file_permissions, env_leak_check)' },
        container: { type: 'string', description: 'Filter to specific container (for docker_security)' },
      },
      required: ['action'],
    },
    execute: (input) => securityScan(input as unknown as Parameters<typeof securityScan>[0]),
  });

  reg.register({
    name: 'code_analysis',
    displayName: 'Code Analysis',
    description: 'Static code analysis: TypeScript type checking, dead code detection, import dependency tracing, function complexity metrics, TODO/FIXME scanning.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['typecheck', 'dead_code', 'import_analysis', 'complexity', 'todo_scan'],
          description: 'Analysis action to perform',
        },
        package_dir: { type: 'string', description: 'Package directory relative to repo root (for typecheck)' },
        file_path: { type: 'string', description: 'Specific file to analyze (for import_analysis, complexity)' },
        scan_path: { type: 'string', description: 'Path to scan relative to repo root' },
      },
      required: ['action'],
    },
    execute: (input) => codeAnalysis(input as unknown as Parameters<typeof codeAnalysis>[0]),
  });
}

// ============================================
// Run Execution
// ============================================

/**
 * Run an agent execution asynchronously.
 * Called from the POST /executions route after creating the execution record.
 * The engine will update the existing record from 'pending' to 'running' to 'completed'.
 */
export async function runExecution(
  executionId: string,
  agentId: string,
  input: string,
  ownerId: string,
  sessionId?: string,
): Promise<void> {
  if (!initialized) {
    await initializeWorker();
  }

  const ctx: ExecutionContext = {
    agentId,
    sessionId,
    input,
    ownerId,
    executionId,
  };

  const deps: ExecutionDeps = {
    provider,
    executeTool: async (toolCalls, execId) => {
      const calls: ExecutorToolCall[] = toolCalls.map((tc) => ({
        name: tc.name,
        input: tc.input,
      }));
      return executeTools(calls, registry, execId);
    },
    config,
  };

  try {
    const result = await execute(ctx, deps);
    console.log(
      `[Worker] Execution ${executionId} completed: ${result.iterations} iterations, $${result.cost.toFixed(4)} cost`,
    );
  } catch (err) {
    console.error(`[Worker] Execution ${executionId} failed:`, err);
  }
}

/**
 * Run multiple agent executions as a batch (50% cost reduction).
 * Uses the Anthropic Batches API — results typically available within minutes.
 * Called from the scheduler or batch endpoint.
 */
export async function runBatchExecution(
  agents: BatchAgentExecution[],
): Promise<BatchExecutionResult[]> {
  if (!initialized) {
    await initializeWorker();
  }

  const toolExecutor = async (
    toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
    execId: string,
  ) => {
    const calls: ExecutorToolCall[] = toolCalls.map((tc) => ({
      name: tc.name,
      input: tc.input,
    }));
    return executeTools(calls, registry, execId);
  };

  return executeBatch(agents, provider, toolExecutor, config);
}

/**
 * Get the initialized tool registry. Used by other modules that need tool info.
 */
export function getRegistry(): ToolRegistry {
  return registry;
}

// ============================================
// CLI Execution (Phase 7 — Direct CLI Spawn)
// ============================================

let cliEnvironmentReady = false;
let cliConcurrent = 0;
const cliQueue: Array<() => void> = [];

const MCP_CONFIG_PATH = '/tmp/claude-home/mcp.json';
const CLAUDE_DIR = '/tmp/claude-home/.claude';
const WORKSPACE_DIR = '/tmp/agent-workspace';

/**
 * One-time CLI environment setup.
 * Creates credential files, settings.json, and MCP config.
 */
async function setupCliEnvironment(): Promise<void> {
  if (cliEnvironmentReady) return;

  const cfg = config ?? loadConfig();

  // Create directories
  await mkdir(`${CLAUDE_DIR}/debug`, { recursive: true });
  await mkdir(`${CLAUDE_DIR}/cache`, { recursive: true });
  await mkdir(WORKSPACE_DIR, { recursive: true });

  // Copy OAuth credentials if available
  try {
    await access('/tmp/claude-credentials.json');
    await copyFile('/tmp/claude-credentials.json', `${CLAUDE_DIR}/.credentials.json`);
    console.log('[CLI] OAuth credentials installed');
  } catch {
    console.warn('[CLI] No OAuth credentials found at /tmp/claude-credentials.json');
  }

  // Write settings.json — auto-accept all permissions
  const settings = {
    permissions: {
      allow: [
        'Bash(*)', 'Read(*)', 'Write(*)', 'Edit(*)',
        'Glob(*)', 'Grep(*)', 'WebFetch(*)', 'WebSearch(*)',
        'NotebookEdit(*)', 'Task(*)',
      ],
      deny: [],
    },
    hasCompletedOnboarding: true,
  };
  await writeFile(`${CLAUDE_DIR}/settings.json`, JSON.stringify(settings, null, 2));
  console.log('[CLI] Settings.json written');

  // Write MCP config with streamable HTTP transport
  const mcpConfig = {
    mcpServers: {
      'mcp-tools': {
        type: 'http',
        url: 'http://mcp-tools:3010/mcp',
      },
      'mcp-alf': {
        type: 'http',
        url: 'http://mcp-alf:3013/mcp',
      },
    },
  };
  await writeFile(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2));
  console.log('[CLI] MCP config written');

  cliEnvironmentReady = true;
}

/**
 * Semaphore: acquire a CLI execution slot.
 * Blocks if MAX_CLI_CONCURRENCY is reached.
 */
function acquireCliSlot(): Promise<void> {
  const cfg = config ?? loadConfig();
  if (cliConcurrent < cfg.maxCliConcurrency) {
    cliConcurrent++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    cliQueue.push(() => {
      cliConcurrent++;
      resolve();
    });
  });
}

/** Release a CLI execution slot. */
function releaseCliSlot(): void {
  cliConcurrent--;
  if (cliQueue.length > 0) {
    const next = cliQueue.shift()!;
    next();
  }
}

/**
 * Refresh OAuth credentials before execution.
 * Copies fresher token from mount if available.
 */
async function refreshCredentials(): Promise<void> {
  const credsPath = `${CLAUDE_DIR}/.credentials.json`;
  try {
    await access('/tmp/claude-credentials.json');
    const mountRaw = await readFile('/tmp/claude-credentials.json', 'utf8');
    const mountCreds = JSON.parse(mountRaw);
    let currentExpiry = 0;
    try {
      const curRaw = await readFile(credsPath, 'utf8');
      const cur = JSON.parse(curRaw);
      currentExpiry = cur.claudeAiOauth?.expiresAt || 0;
    } catch { /* no current file */ }
    if ((mountCreds.claudeAiOauth?.expiresAt || 0) > currentExpiry) {
      await copyFile('/tmp/claude-credentials.json', credsPath);
      console.log('[CLI] Refreshed credentials from mount');
    }
  } catch { /* mount may not exist */ }
}

/**
 * Execute Claude Code CLI with the given arguments.
 * Returns exit code, stdout, and stderr.
 */
function executeClaudeCode(
  args: string[],
  cwd = '/workspace',
  timeout = 900_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // Write prompt to temp file to avoid shell escaping issues
    const promptIdx = args.indexOf('-p');
    let promptFile: string | null = null;
    const filteredArgs = [...args];

    const run = async () => {
      if (promptIdx >= 0 && promptIdx + 1 < args.length) {
        promptFile = `/tmp/prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
        await writeFile(promptFile, filteredArgs[promptIdx + 1]!);
        filteredArgs.splice(promptIdx, 2); // remove -p and prompt
      }

      const escapedArgs = filteredArgs.map(a => "'" + a.replace(/'/g, "'\\''") + "'").join(' ');
      const shellCmd = promptFile
        ? `claude -p "$(cat '${promptFile}')" ${escapedArgs}`
        : `claude ${escapedArgs}`;

      const proc = spawn('sh', ['-c', shellCmd], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: '', // Force OAuth subscription
          HOME: '/tmp/claude-home',
        },
      });

      let stdout = '';
      let stderr = '';
      let killed = false;

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderr += text;
        // Log first few lines in real-time for diagnostics
        const lines = text.trim().split('\n');
        for (const line of lines.slice(0, 3)) {
          if (line.trim()) console.log(`[CLI:stderr] ${line.substring(0, 200)}`);
        }
      });

      const cleanup = async () => {
        if (promptFile) {
          try { await unlink(promptFile); } catch { /* ignore */ }
        }
      };

      const killTree = () => {
        killed = true;
        try {
          proc.kill('SIGTERM');
          try {
            execSync(`kill -TERM $(pgrep -P ${proc.pid}) 2>/dev/null || true`, { stdio: 'ignore' });
          } catch { /* no children or already dead */ }
        } catch { /* already dead */ }
        setTimeout(() => {
          try { proc.kill('SIGKILL'); } catch { /* already dead */ }
        }, 5000);
      };

      proc.on('close', async (code) => {
        await cleanup();
        const cleanStdout = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
        resolve({
          exitCode: killed ? 124 : (code ?? 1),
          stdout: cleanStdout,
          stderr: stderr.trim(),
        });
      });

      proc.on('error', async (err) => {
        await cleanup();
        resolve({ exitCode: 1, stdout: '', stderr: err.message });
      });

      setTimeout(killTree, timeout);
    };

    run().catch((err) => {
      resolve({ exitCode: 1, stdout: '', stderr: `Setup error: ${err}` });
    });
  });
}

/**
 * Parse Claude Code CLI JSON output.
 */
function parseCliOutput(stdout: string, stderr: string, exitCode: number): {
  output: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
  isError: boolean;
} {
  let output = stdout;
  let costUsd = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let numTurns = 0;
  let isError = false;

  try {
    let jsonStr = stdout;
    // Remove control characters except newline
    jsonStr = jsonStr.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
    // Extract JSON object
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    output = (parsed['result'] as string) ?? stdout;
    costUsd = (parsed['total_cost_usd'] as number) ?? 0;
    numTurns = (parsed['num_turns'] as number) ?? 0;

    const usage = parsed['usage'] as Record<string, number> | undefined;
    if (usage) {
      inputTokens = usage['input_tokens'] ?? 0;
      outputTokens = usage['output_tokens'] ?? 0;
    }

    // Only mark as error if explicitly errored AND no useful output
    if (parsed['is_error'] === true && outputTokens === 0) {
      isError = true;
    } else if (!parsed['type'] && exitCode !== 0) {
      isError = true;
    }
  } catch {
    console.error(`[CLI] JSON parse failed for stdout (first 200): ${stdout.substring(0, 200)}`);
    if (stderr) console.error(`[CLI] stderr (first 500): ${stderr.substring(0, 500)}`);
    if (exitCode !== 0) isError = true;
  }

  return { output, costUsd, inputTokens, outputTokens, numTurns, isError };
}

/**
 * Run an agent execution via Claude Code CLI (Phase 7).
 * Spawns the CLI as a child process with OAuth credentials and MCP tools.
 * This is the primary execution path — agents use Claude Max subscription.
 */
export async function runDirectCliExecution(
  executionId: string,
  agentId: string,
  input: string,
  ownerId: string,
  options?: {
    modelId?: string;
    systemPrompt?: string;
    sessionId?: string;
    maxBudgetUsd?: string;
  },
): Promise<void> {
  if (!initialized) {
    await initializeWorker();
  }

  const cfg = config ?? loadConfig();

  // One-time CLI environment setup
  await setupCliEnvironment();

  // Wait for concurrency slot
  await acquireCliSlot();

  const startTime = Date.now();
  console.log(`[CLI] Processing execution ${executionId} for agent ${agentId}`);

  try {
    // Update execution status to running
    await query(
      `UPDATE forge_executions SET status = 'running', started_at = NOW() WHERE id = $1`,
      [executionId],
    );

    // Refresh OAuth credentials
    await refreshCredentials();

    // Copy agent's system prompt as CLAUDE.md in workspace
    if (options?.systemPrompt) {
      try {
        await writeFile(`${WORKSPACE_DIR}/CLAUDE.md`, options.systemPrompt);
      } catch {
        console.warn('[CLI] Could not write CLAUDE.md to workspace');
      }
    }

    // Build CLI arguments
    const args: string[] = [
      '-p', input,
      '--output-format', 'json',
      '--max-turns', String(cfg.cliMaxTurns),
      '--max-budget-usd', options?.maxBudgetUsd ?? cfg.cliBudgetUsd,
      '--dangerously-skip-permissions',
      '--add-dir', '/workspace',
      '--mcp-config', MCP_CONFIG_PATH,
    ];

    // Use agent's configured model
    if (options?.modelId) {
      args.push('--model', options.modelId);
      console.log(`[CLI] Using model: ${options.modelId}`);
    }

    // Execute CLI
    const result = await executeClaudeCode(args, WORKSPACE_DIR, cfg.cliTimeout);
    const durationMs = Date.now() - startTime;

    // Parse result
    const parsed = parseCliOutput(result.stdout, result.stderr, result.exitCode);

    console.log(
      `[CLI] Execution ${executionId} ${parsed.isError ? 'FAILED' : 'completed'} ` +
      `in ${durationMs}ms — cost=$${parsed.costUsd.toFixed(4)} ` +
      `tokens=${parsed.inputTokens}/${parsed.outputTokens} turns=${parsed.numTurns}`,
    );

    // Update execution record
    await query(
      `UPDATE forge_executions
       SET status = $1,
           output = $2,
           error = $3,
           cost = $4,
           input_tokens = $5,
           output_tokens = $6,
           total_tokens = $7,
           iterations = $8,
           duration_ms = $9,
           completed_at = NOW()
       WHERE id = $10`,
      [
        parsed.isError ? 'failed' : 'completed',
        parsed.output,
        parsed.isError ? (result.stderr || 'CLI execution failed') : null,
        parsed.costUsd,
        parsed.inputTokens,
        parsed.outputTokens,
        parsed.inputTokens + parsed.outputTokens,
        parsed.numTurns,
        durationMs,
        executionId,
      ],
    );
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[CLI] Execution ${executionId} error: ${errorMsg}`);

    await query(
      `UPDATE forge_executions
       SET status = 'failed', error = $1, duration_ms = $2, completed_at = NOW()
       WHERE id = $3`,
      [errorMsg, durationMs, executionId],
    ).catch(() => {});
  } finally {
    releaseCliSlot();
  }
}
