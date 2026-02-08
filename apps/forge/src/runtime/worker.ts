/**
 * Forge Execution Worker
 * Wires together provider adapters, tool registry, and the execution engine.
 * Provides `runExecution()` which is called asynchronously when POST /executions fires.
 */

import { loadConfig, type ForgeConfig } from '../config.js';
import { AnthropicAdapter } from '../providers/adapters/anthropic.js';
import type { IProviderAdapter } from '../providers/interface.js';
import { ToolRegistry } from '../tools/registry.js';
import { executeTools, type ToolCall as ExecutorToolCall } from '../tools/executor.js';
import { execute, type ExecutionContext, type ExecutionDeps } from './engine.js';
import { executeBatch, type BatchAgentExecution, type BatchExecutionResult } from './batch-engine.js';

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
