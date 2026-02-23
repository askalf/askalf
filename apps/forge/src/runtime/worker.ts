/**
 * Forge Execution Worker
 * Wires together provider adapters, tool registry, and the execution engine.
 * Provides `runDirectCliExecution()` for CLI-based agent execution (Phase 7).
 * Also retains `runExecution()` for SDK-based execution as fallback.
 */

import { spawn, execSync } from 'child_process';
import { readFile, writeFile, access, copyFile, mkdir, unlink, rm } from 'fs/promises';
import { loadConfig, type ForgeConfig } from '../config.js';
import { AnthropicAdapter } from '../providers/adapters/anthropic.js';
import type { IProviderAdapter } from '../providers/interface.js';
import { ToolRegistry } from '../tools/registry.js';
import { executeTools, type ToolCall as ExecutorToolCall } from '../tools/executor.js';
import { execute, type ExecutionContext, type ExecutionDeps } from './engine.js';
import { executeBatch, type BatchAgentExecution, type BatchExecutionResult } from './batch-engine.js';
import { query, retryQuery } from '../database.js';
import { extractMemories } from '../memory/extractor.js';
import { buildMemoryContext } from '../memory/context-builder.js';
import { updateCapabilityFromExecution } from '../orchestration/capability-registry.js';
import { getEventBus } from '../orchestration/event-bus.js';
import { extractKnowledge } from '../orchestration/knowledge-graph.js';
import { recordCostSample } from '../orchestration/cost-router.js';
import { trackCost } from '../observability/cost-tracker.js';
import { forgeExecutionsTotal, forgeExecutionDuration } from '../metrics.js';
import { withRetry, classifyCliError, ExecutionError } from './error-handler.js';
import {
  calculateRuntimeBudget,
  estimateTaskComplexity,
  suggestMaxTurns,
  formatBudgetPromptHint,
} from './budget.js';

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
import { agentCreate } from '../tools/built-in/agent-create.js';
import { agentDelegate } from '../tools/built-in/agent-delegate.js';
import { agentCall, type AgentCallInput } from '../tools/built-in/agent-call.js';
import { memorySearch, type MemorySearchInput } from '../tools/built-in/memory-search.js';
import { memoryStore, type MemoryStoreInput } from '../tools/built-in/memory-store.js';
import { knowledgeSearch } from '../tools/built-in/knowledge-search.js';
import { fleetHealth } from '../tools/built-in/fleet-health.js';
import { selfHeal } from '../tools/built-in/self-heal.js';
import { selfImprove } from '../tools/built-in/self-improve.js';
import { evolutionTest } from '../tools/built-in/evolution-test.js';
import { workflowOps } from '../tools/built-in/workflow-ops.js';
import { orchestrate } from '../tools/built-in/orchestrate.js';
import { goalOps } from '../tools/built-in/goal-ops.js';
import { costOptimize } from '../tools/built-in/cost-optimize.js';
import { feedbackOps } from '../tools/built-in/feedback-ops.js';
import { eventQuery } from '../tools/built-in/event-query.js';
import { agentChat } from '../tools/built-in/agent-chat.js';
import { auditInspect } from '../tools/built-in/audit-inspect.js';
import { checkpointOps } from '../tools/built-in/checkpoint-ops.js';
import { contextOps } from '../tools/built-in/context-ops.js';
import { capabilityOps } from '../tools/built-in/capability-ops.js';
import { knowledgeGraphOps } from '../tools/built-in/knowledge-graph-ops.js';
import { teamOps } from '../tools/built-in/team-ops.js';
import { messaging } from '../tools/built-in/messaging.js';
import { budgetCheck } from '../tools/built-in/budget-check.js';
import { proposalOps } from '../tools/built-in/proposal-ops.js';
import { webSearch } from '../tools/built-in/web-search.js';
import { getMemoryManager } from '../memory/singleton.js';
import { getExecutionContext, executionStore } from './execution-context.js';

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

  // Start periodic OAuth token refresh (every 6 hours)
  // Ensures token stays fresh even when no CLI executions are happening
  startTokenRefreshTimer();
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
    description: 'Create, update, assign, list, get tickets, add progress notes, and view audit history. IMPORTANT: Use add_note to log timestamped progress on every ticket as you work. Every significant step must have a note. Use update with resolution to resolve tickets — resolution is REQUIRED to close/resolve. No ticket should sit stale without notes.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'assign', 'list', 'get', 'add_note', 'audit_history'],
          description: 'Operation to perform. Use add_note to add timestamped progress notes to a ticket.',
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
        resolution: { type: 'string', description: 'Resolution note — what was done to resolve this ticket (REQUIRED when setting status to resolved or closed)' },
        note: { type: 'string', description: 'Progress note content — timestamped update on work in progress (use with add_note action)' },
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

  reg.register({
    name: 'agent_create',
    displayName: 'Agent Create',
    description: 'Create new agents programmatically. All agent creation requires human approval via intervention gating. New agents start at autonomy level 1 with draft status. Can also add schedules to existing agents.',
    type: 'built_in',
    riskLevel: 'critical',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'schedule'],
          description: 'Operation: create a new agent or add a schedule to an existing agent',
        },
        name: { type: 'string', description: 'Name for the new agent (for create)' },
        description: { type: 'string', description: 'What the agent does (for create)' },
        system_prompt: { type: 'string', description: 'System prompt for the new agent (for create)' },
        type: { type: 'string', enum: ['dev', 'monitor', 'research', 'content', 'custom'], description: 'Agent type (for create)' },
        enabled_tools: { type: 'array', items: { type: 'string' }, description: 'Tools the agent can use (for create)' },
        model_id: { type: 'string', description: 'Model ID (default: claude-haiku-4-5)' },
        autonomy_level: { type: 'number', description: 'Autonomy level 1-3 (default: 1)' },
        schedule_minutes: { type: 'number', description: 'If set, auto-create schedule (for create)' },
        agent_id: { type: 'string', description: 'Agent ID (for schedule action)' },
        schedule_type: { type: 'string', enum: ['continuous', 'scheduled'], description: 'Schedule type (for schedule action)' },
        interval_minutes: { type: 'number', description: 'Schedule interval in minutes (for schedule action, min 5)' },
        intervention_id: { type: 'string', description: 'Approved intervention ID (required for create execution)' },
        agent_name: { type: 'string', description: 'Your agent name' },
        execution_id: { type: 'string', description: 'Your execution ID' },
      },
      required: ['action'],
    },
    execute: (input) => agentCreate(input as unknown as Parameters<typeof agentCreate>[0]),
  });

  reg.register({
    name: 'agent_delegate',
    displayName: 'Agent Delegate',
    description: 'Delegate a task to the best available agent by capability. Finds the most suitable agent using capability matching and runs them synchronously. Can also search for agents without executing.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['delegate', 'find'],
          description: 'delegate: find best agent and run them. find: just search for matching agents.',
        },
        task: { type: 'string', description: 'Task description to delegate or search for' },
        capability: { type: 'string', description: 'Capability to match (e.g. monitoring, architecture, troubleshooting)' },
        agent_type: { type: 'string', description: 'Filter by agent type (dev, monitor, research, content, custom)' },
        agent_id: { type: 'string', description: 'Your agent ID (for self-delegation prevention)' },
        agent_name: { type: 'string', description: 'Your agent name' },
        execution_id: { type: 'string', description: 'Your execution ID' },
      },
      required: ['action'],
    },
    execute: (input) => agentDelegate(input as unknown as Parameters<typeof agentDelegate>[0]),
  });

  reg.register({
    name: 'agent_call',
    displayName: 'Agent Call',
    description: 'Invoke another agent by ID as a sub-agent. The sub-agent runs synchronously and returns its output. Includes recursion depth protection (max depth 5).',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The ID of the agent to call' },
        input: { type: 'string', description: 'The input/task to send to the sub-agent' },
      },
      required: ['agentId', 'input'],
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as AgentCallInput;
      const ctx = getExecutionContext();
      return agentCall(input, {
        executeAgent: async (params) => {
          const childExecId = `child-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
          // Create child execution record
          await query(
            `INSERT INTO forge_executions (id, agent_id, owner_id, input, status, parent_execution_id)
             VALUES ($1, $2, $3, $4, 'pending', $5)`,
            [childExecId, params.agentId, params.ownerId, params.input, ctx?.executionId ?? null],
          );
          // Get agent config
          const agentRow = await query<{ model_id: string; system_prompt: string; max_cost_per_execution: number }>(
            `SELECT model_id, system_prompt, max_cost_per_execution FROM forge_agents WHERE id = $1`,
            [params.agentId],
          );
          const agentCfg = agentRow[0];
          if (!agentCfg) throw new Error(`Agent not found: ${params.agentId}`);

          await runDirectCliExecution(childExecId, params.agentId, params.input, params.ownerId, {
            modelId: agentCfg.model_id,
            systemPrompt: agentCfg.system_prompt,
            maxBudgetUsd: String(agentCfg.max_cost_per_execution ?? '0.50'),
          });

          // Read back result
          const result = await query<{
            status: string; output: string; error: string | null;
            iterations: number; duration_ms: number;
          }>(
            `SELECT status, COALESCE(output, '') as output, error,
                    COALESCE(iterations, 0) as iterations, COALESCE(duration_ms, 0) as duration_ms
             FROM forge_executions WHERE id = $1`,
            [childExecId],
          );
          const r = result[0];
          return {
            output: r?.output ?? '',
            status: (r?.status === 'completed' ? 'completed' : 'failed') as 'completed' | 'failed',
            iterations: r?.iterations ?? 0,
            durationMs: r?.duration_ms ?? 0,
            error: r?.error ?? undefined,
          };
        },
        ownerId: ctx?.ownerId ?? 'system:forge',
        currentDepth: ctx?.depth ?? 0,
      });
    },
  });

  reg.register({
    name: 'memory_search',
    displayName: 'Memory Search',
    description: 'Search agent memory (semantic, episodic, procedural). Use fleet=true to search across ALL agents\' memories for shared knowledge.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query text' },
        memoryType: { type: 'string', enum: ['semantic', 'episodic', 'procedural'], description: 'Filter by memory type' },
        limit: { type: 'number', description: 'Max results (default 5)' },
        fleet: { type: 'boolean', description: 'Search across all agents (default false)' },
      },
      required: ['query'],
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as MemorySearchInput;
      const ctx = getExecutionContext();
      const mgr = getMemoryManager();
      return memorySearch(input, {
        memoryManager: {
          recall: async (params) => {
            const result = await mgr.recall(params.agentId, params.query, {
              tiers: params.memoryType
                ? [params.memoryType as 'semantic' | 'episodic' | 'procedural']
                : undefined,
              k: params.limit,
            });
            // Flatten to MemoryRecallResult
            const memories: Array<{ id: string; content: string; memoryType: string; similarity?: number; createdAt: string; metadata?: Record<string, unknown> }> = [];
            for (const s of result.semantic ?? []) {
              memories.push({ id: s.id, content: s.content, memoryType: 'semantic', similarity: s.similarity, createdAt: String(s.created_at), metadata: s.metadata as Record<string, unknown> | undefined });
            }
            for (const e of result.episodic ?? []) {
              memories.push({ id: e.id, content: `${e.situation} → ${e.action} → ${e.outcome}`, memoryType: 'episodic', similarity: e.similarity, createdAt: String(e.created_at) });
            }
            for (const p of result.procedural ?? []) {
              memories.push({ id: p.id, content: p.trigger_pattern, memoryType: 'procedural', similarity: p.similarity, createdAt: String(p.created_at) });
            }
            return { memories, total: memories.length };
          },
          recallFleet: async (q, options) => {
            const result = await mgr.recallFleet(q, { k: options?.k });
            const memories: Array<{ id: string; content: string; memoryType: string; similarity?: number; createdAt: string }> = [];
            for (const s of result.semantic ?? []) {
              memories.push({ id: s.id, content: s.content, memoryType: 'semantic', similarity: s.similarity, createdAt: String(s.created_at) });
            }
            for (const e of result.episodic ?? []) {
              memories.push({ id: e.id, content: `${e.situation} → ${e.action} → ${e.outcome}`, memoryType: 'episodic', similarity: e.similarity, createdAt: String(e.created_at) });
            }
            for (const p of result.procedural ?? []) {
              memories.push({ id: p.id, content: p.trigger_pattern, memoryType: 'procedural', similarity: p.similarity, createdAt: String(p.created_at) });
            }
            return { memories, total: memories.length };
          },
        },
        agentId: ctx?.agentId ?? (rawInput as Record<string, unknown>)['agent_id'] as string ?? 'unknown',
      });
    },
  });

  reg.register({
    name: 'memory_store',
    displayName: 'Memory Store',
    description: 'Store knowledge, experiences, and patterns into the cognitive memory system. Supports semantic (facts), episodic (experiences), and procedural (workflows) memory types.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['semantic', 'episodic', 'procedural'], description: 'Memory tier to store in' },
        content: { type: 'string', description: 'Content to store (for semantic/episodic)' },
        action: { type: 'string', description: 'Action taken (for episodic)' },
        outcome: { type: 'string', description: 'Outcome observed (for episodic)' },
        quality: { type: 'number', description: 'Outcome quality 0-1 (for episodic)' },
        trigger_pattern: { type: 'string', description: 'Trigger pattern (for procedural)' },
        tool_sequence: { type: 'array', description: 'Tool sequence [{tool, params, description}] (for procedural)' },
        importance: { type: 'number', description: 'Importance 0-1 (for semantic)' },
        source: { type: 'string', description: 'Source label (for semantic)' },
        metadata: { type: 'object', description: 'Optional metadata' },
      },
      required: ['type'],
    },
    execute: async (rawInput) => {
      const input = rawInput as unknown as MemoryStoreInput;
      const ctx = getExecutionContext();
      return memoryStore(input, {
        memoryManager: getMemoryManager(),
        agentId: ctx?.agentId ?? (rawInput as Record<string, unknown>)['agent_id'] as string ?? 'unknown',
        ownerId: ctx?.ownerId ?? 'system:forge',
      });
    },
  });

  reg.register({
    name: 'knowledge_search',
    displayName: 'Knowledge Search',
    description: 'Search the fleet-wide knowledge graph for entities and relationships extracted from all agent executions. Find concepts, tools, services, patterns, and their connections.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['search', 'related'],
          description: 'search: find knowledge nodes. related: get relationships for a node.',
        },
        query: { type: 'string', description: 'Search query (for search action)' },
        entity_type: { type: 'string', enum: ['concept', 'person', 'tool', 'service', 'file', 'error', 'pattern'], description: 'Filter by entity type' },
        limit: { type: 'number', description: 'Max results (default 10, max 20)' },
        node_id: { type: 'string', description: 'Node ID (for related action)' },
      },
      required: ['action'],
    },
    execute: (input) => knowledgeSearch(input as unknown as Parameters<typeof knowledgeSearch>[0]),
  });

  reg.register({
    name: 'fleet_health',
    displayName: 'Fleet Health',
    description: 'Query fleet health, agent performance rankings, cost summaries, and execution statistics with anomaly detection. Use this to understand how the fleet is performing and identify problems.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['check', 'leaderboard', 'costs', 'execution_stats'],
          description: 'check: run health check. leaderboard: agent rankings. costs: cost breakdown. execution_stats: per-agent stats + anomaly detection.',
        },
        days: { type: 'number', description: 'Number of days for cost summary (default 7)' },
        owner_id: { type: 'string', description: 'Owner ID filter for costs (default system:forge)' },
        agent_id: { type: 'string', description: 'Filter to specific agent' },
      },
      required: ['action'],
    },
    execute: (input) => fleetHealth(input as unknown as Parameters<typeof fleetHealth>[0]),
  });

  reg.register({
    name: 'self_heal',
    displayName: 'Self Heal',
    description: 'Take autonomous corrective actions: heal stuck executions, pause poorly-performing agents, reset circuit breakers, or rebalance workload away from degraded agents.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['heal_stuck', 'pause_agent', 'reset_circuit_breaker', 'rebalance'],
          description: 'heal_stuck: fix stuck executions. pause_agent: temporarily pause a failing agent. reset_circuit_breaker: reset stuck breaker. rebalance: extend schedule of degraded agent.',
        },
        agent_id: { type: 'string', description: 'Target agent ID (for pause_agent)' },
        reason: { type: 'string', description: 'Reason for pausing (required for pause_agent)' },
        breaker_name: { type: 'string', description: 'Circuit breaker name (default: provider)' },
        degraded_agent_id: { type: 'string', description: 'Agent to rebalance away from (for rebalance)' },
      },
      required: ['action'],
    },
    execute: (input) => selfHeal(input as unknown as Parameters<typeof selfHeal>[0]),
  });

  reg.register({
    name: 'self_improve',
    displayName: 'Self Improve',
    description: 'Propose and apply prompt revisions based on correction patterns, review revision history, and analyze your capabilities with fleet comparison. Use this to actively improve your own performance.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['propose_revision', 'list_revisions', 'apply_revision', 'reject_revision', 'analyze_capabilities'],
          description: 'propose_revision: generate prompt improvements. list_revisions: see revision history. apply_revision: apply an approved revision. reject_revision: reject a pending revision. analyze_capabilities: see your skills vs fleet.',
        },
        revision_id: { type: 'string', description: 'Revision ID (for apply_revision)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => selfImprove(input as unknown as Parameters<typeof selfImprove>[0]),
  });

  reg.register({
    name: 'evolution_test',
    displayName: 'Evolution Test',
    description: 'A/B test agent variations: clone yourself with mutations (prompt, model, tools), run head-to-head tests, review results, and promote winning variants.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['clone', 'run_test', 'results', 'promote'],
          description: 'clone: create a variant. run_test: A/B test parent vs variant. results: see experiment history. promote: apply winning variant config to parent.',
        },
        mutation_type: { type: 'string', enum: ['prompt', 'tools', 'model', 'config', 'combined'], description: 'Type of mutation (for clone)' },
        mutation_description: { type: 'string', description: 'Description of what changed (for clone)' },
        prompt_override: { type: 'string', description: 'New system prompt (for clone with prompt mutation)' },
        model_override: { type: 'string', description: 'New model ID (for clone with model mutation)' },
        variant_id: { type: 'string', description: 'Variant agent ID (for run_test)' },
        test_task: { type: 'string', description: 'Task to test both agents on (for run_test)' },
        experiment_id: { type: 'string', description: 'Experiment ID (for promote)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => evolutionTest(input as unknown as Parameters<typeof evolutionTest>[0]),
  });

  reg.register({
    name: 'workflow_ops',
    displayName: 'Workflow Ops',
    description: 'Structured multi-agent coordination: decompose complex tasks into subtasks, create DAG-based coordination plans, execute across the fleet, monitor plan health, and recover from task failures.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['decompose', 'create_plan', 'execute_plan', 'plan_status', 'recover'],
          description: 'decompose: break task into subtasks. create_plan: build coordination plan. execute_plan: dispatch tasks to agents. plan_status: check plan health. recover: handle failed tasks.',
        },
        task_description: { type: 'string', description: 'Complex task to decompose (for decompose)' },
        title: { type: 'string', description: 'Plan title (for create_plan)' },
        pattern: { type: 'string', enum: ['pipeline', 'fan-out', 'consensus'], description: 'Coordination pattern (for create_plan, default: pipeline)' },
        tasks: {
          type: 'array',
          description: 'Array of tasks with title, description, agent_name, dependencies (for create_plan)',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              agent_name: { type: 'string' },
              dependencies: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'description', 'agent_name'],
          },
        },
        plan_id: { type: 'string', description: 'Plan ID (for execute_plan, plan_status, recover)' },
        task_id: { type: 'string', description: 'Failed task ID within a plan (for recover)' },
        retry_count: { type: 'number', description: 'Number of retries already attempted (for recover, default: 0)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => workflowOps(input as unknown as Parameters<typeof workflowOps>[0]),
  });

  reg.register({
    name: 'orchestrate',
    displayName: 'Orchestrate',
    description: 'Natural language orchestration: give a plain English instruction and the system automatically decomposes it, matches the best agents, and executes across the fleet. Monitor progress with status checks.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['run', 'status'],
          description: 'run: start orchestration from a natural language instruction. status: check progress of an orchestration session.',
        },
        instruction: { type: 'string', description: 'Plain English instruction describing work to be done (for run)' },
        max_agents: { type: 'number', description: 'Maximum number of agents to assign (for run, default: 5)' },
        session_id: { type: 'string', description: 'Orchestration session ID (for status)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => orchestrate(input as unknown as Parameters<typeof orchestrate>[0]),
  });

  reg.register({
    name: 'goal_ops',
    displayName: 'Goal Ops',
    description: 'Manage your own improvement goals: propose goals based on execution history, list existing goals, self-approve at high autonomy, and mark goals complete with results.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['propose', 'list', 'approve', 'reject', 'complete'],
          description: 'propose: generate improvement goals from history. list: see your goals. approve: self-approve a proposed goal (autonomy >= 4). reject: reject a proposed goal. complete: mark a goal done.',
        },
        status: { type: 'string', description: 'Filter goals by status: proposed, approved, rejected, in_progress, completed (for list)' },
        goal_id: { type: 'string', description: 'Goal ID (for approve, complete)' },
        result_summary: { type: 'string', description: 'Summary of what was accomplished (for complete)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => goalOps(input as unknown as Parameters<typeof goalOps>[0]),
  });

  reg.register({
    name: 'cost_optimize',
    displayName: 'Cost Optimize',
    description: 'Make cost-aware decisions: view cost profiles across capabilities, get model recommendations for specific tasks, batch recommendations, and analyze your own spending patterns.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['dashboard', 'recommend', 'recommend_batch', 'my_costs'],
          description: 'dashboard: view all cost profiles. recommend: get cheapest model for a capability. recommend_batch: recommendations for multiple capabilities. my_costs: your 7-day spending.',
        },
        capability: { type: 'string', description: 'Capability name (for recommend)' },
        min_quality: { type: 'number', description: 'Minimum quality threshold 0-1 (default: 0.7)' },
        capabilities: { type: 'array', items: { type: 'string' }, description: 'List of capabilities (for recommend_batch)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => costOptimize(input as unknown as Parameters<typeof costOptimize>[0]),
  });

  reg.register({
    name: 'feedback_ops',
    displayName: 'Feedback Ops',
    description: 'Self-assessment and learning from corrections: submit feedback on execution results (triggers full learning pipeline), view your feedback stats, and inspect correction patterns for self-improvement.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['submit', 'stats', 'patterns'],
          description: 'submit: process feedback through learning pipeline. stats: see feedback breakdown. patterns: view correction patterns.',
        },
        execution_id: { type: 'string', description: 'Execution ID to attach feedback to (for submit)' },
        feedback_type: {
          type: 'string',
          enum: ['correction', 'clarification', 'praise', 'warning', 'rejection'],
          description: 'Type of feedback (for submit)',
        },
        human_response: { type: 'string', description: 'Feedback content / correction details (for submit)' },
        agent_output: { type: 'string', description: 'Original agent output being assessed (for submit)' },
        corrected_output: { type: 'string', description: 'Corrected version of the output (for submit with correction)' },
        autonomy_delta: { type: 'number', description: 'Autonomy adjustment -2 to +2 (for submit)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => feedbackOps(input as unknown as Parameters<typeof feedbackOps>[0]),
  });

  reg.register({
    name: 'event_query',
    displayName: 'Event Query',
    description: 'Fleet intelligence: replay execution events, query orchestration sessions, view fleet leaderboard rankings, and monitor event volume across the system.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['execution', 'session', 'recent', 'leaderboard', 'stats'],
          description: 'execution: replay events for an execution. session: events for orchestration session. recent: latest fleet events. leaderboard: agent rankings. stats: event volume.',
        },
        execution_id: { type: 'string', description: 'Execution ID (for execution action)' },
        session_id: { type: 'string', description: 'Orchestration session ID (for session action)' },
        limit: { type: 'number', description: 'Max events to return (for recent, default 50, max 200)' },
      },
      required: ['action'],
    },
    execute: (input) => eventQuery(input as unknown as Parameters<typeof eventQuery>[0]),
  });

  reg.register({
    name: 'agent_chat',
    displayName: 'Agent Chat',
    description: 'Multi-agent collaborative discussions: create chat sessions with selected agents, run discussion rounds, get individual responses, view session status, and end sessions.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'round', 'respond', 'status', 'end'],
          description: 'create: start a discussion. round: all agents respond in turn. respond: get one agent\'s response. status: view session or list all. end: close session.',
        },
        topic: { type: 'string', description: 'Discussion topic (for create)' },
        agent_ids: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to include (for create)' },
        session_id: { type: 'string', description: 'Chat session ID (for round, respond, status, end)' },
        agent_id: { type: 'string', description: 'Agent ID to get response from (for respond)' },
      },
      required: ['action'],
    },
    execute: (input) => agentChat(input as unknown as Parameters<typeof agentChat>[0]),
  });

  reg.register({
    name: 'audit_inspect',
    displayName: 'Audit Inspect',
    description: 'Self-inspection of audit trails and guardrail constraints: view your own audit history, pre-check guardrails before acting, and inspect active guardrail rules that apply to you.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['my_audit', 'check_guardrails', 'my_guardrails'],
          description: 'my_audit: view your audit trail. check_guardrails: pre-check if an action is allowed. my_guardrails: see active rules.',
        },
        filter_action: { type: 'string', description: 'Filter audit by action type (for my_audit)' },
        filter_resource_type: { type: 'string', description: 'Filter audit by resource type (for my_audit)' },
        limit: { type: 'number', description: 'Max results (for my_audit, default 25, max 100)' },
        offset: { type: 'number', description: 'Pagination offset (for my_audit)' },
        input: { type: 'string', description: 'Input text to check against guardrails (for check_guardrails)' },
        tool_name: { type: 'string', description: 'Tool name to check restrictions (for check_guardrails)' },
        estimated_cost: { type: 'number', description: 'Estimated cost in USD (for check_guardrails)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => auditInspect(input as unknown as Parameters<typeof auditInspect>[0]),
  });

  reg.register({
    name: 'checkpoint_ops',
    displayName: 'Checkpoint Ops',
    description: 'Human-in-the-loop checkpoints: create approval/review/input requests to pause for human response, list pending checkpoints, respond to checkpoints (high autonomy), and check checkpoint status.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'list', 'respond', 'get'],
          description: 'create: request human approval/review/input. list: pending checkpoints. respond: answer a checkpoint (autonomy >= 4). get: check status.',
        },
        type: { type: 'string', enum: ['approval', 'review', 'input', 'confirmation'], description: 'Checkpoint type (for create)' },
        title: { type: 'string', description: 'Brief title for the checkpoint (for create)' },
        description: { type: 'string', description: 'Detailed description of what is needed (for create)' },
        context: { type: 'object', description: 'Additional context data (for create)' },
        timeout_minutes: { type: 'number', description: 'Timeout in minutes (for create, default 60)' },
        checkpoint_id: { type: 'string', description: 'Checkpoint ID (for respond, get)' },
        response: { type: 'object', description: 'Response data (for respond)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => checkpointOps(input as unknown as Parameters<typeof checkpointOps>[0]),
  });

  reg.register({
    name: 'context_ops',
    displayName: 'Context Ops',
    description: 'Redis-backed shared context for multi-agent coordination: read/write session state, accumulate results in lists, list keys, and create/retrieve agent-to-agent handoffs.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['set', 'get', 'append', 'list_keys', 'handoff', 'get_handoff'],
          description: 'set: write value. get: read value. append: add to list. list_keys: see all keys. handoff: create agent handoff. get_handoff: retrieve handoff.',
        },
        session_id: { type: 'string', description: 'Coordination session ID' },
        key: { type: 'string', description: 'Context key (for set, get, append)' },
        value: { description: 'Value to store (for set, append)' },
        to_agent_id: { type: 'string', description: 'Target agent ID (for handoff)' },
        task: { type: 'string', description: 'Task description (for handoff)' },
        progress: { type: 'string', description: 'Current progress summary (for handoff)' },
        artifacts: { type: 'array', items: { type: 'string' }, description: 'Artifact references (for handoff)' },
        notes: { type: 'string', description: 'Additional notes (for handoff)' },
        handoff_id: { type: 'string', description: 'Handoff ID (for get_handoff)' },
      },
      required: ['action'],
    },
    execute: (input) => contextOps(input as unknown as Parameters<typeof contextOps>[0]),
  });

  reg.register({
    name: 'capability_ops',
    displayName: 'Capability Ops',
    description: 'Capability-based agent routing and discovery: find agents by capability, view your own capability profile, re-detect capabilities, and browse the full capability catalog.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['find', 'my_capabilities', 'detect', 'catalog'],
          description: 'find: search agents by capability. my_capabilities: view own profile. detect: re-scan capabilities (autonomy >= 3). catalog: browse all capabilities.',
        },
        capability: { type: 'string', description: 'Capability name to search for (for find)' },
        min_proficiency: { type: 'number', description: 'Minimum proficiency score 0-100 (for find, default 30)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => capabilityOps(input as unknown as Parameters<typeof capabilityOps>[0]),
  });

  reg.register({
    name: 'knowledge_graph',
    displayName: 'Knowledge Graph',
    description: 'Graph traversal and fleet knowledge statistics: traverse node neighborhoods to explore entity relationships, view graph-wide stats, and search nodes semantically.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['traverse', 'stats', 'search'],
          description: 'traverse: explore node neighborhood. stats: graph-wide statistics. search: semantic node search.',
        },
        node_id: { type: 'string', description: 'Node ID to traverse from (for traverse)' },
        depth: { type: 'number', description: 'Traversal depth (for traverse, default 1)' },
        query: { type: 'string', description: 'Search query text (for search)' },
        entity_type: { type: 'string', enum: ['concept', 'person', 'tool', 'service', 'file', 'error', 'pattern'], description: 'Filter by entity type (for search)' },
        limit: { type: 'number', description: 'Max results (for search, default 10, max 20)' },
      },
      required: ['action'],
    },
    execute: (input) => knowledgeGraphOps(input as unknown as Parameters<typeof knowledgeGraphOps>[0]),
  });

  reg.register({
    name: 'team_ops',
    displayName: 'Team Ops',
    description: 'Fleet team management: start coordinated teams with multiple agents, monitor team sessions, list all sessions, cancel teams, and synthesize results from completed plans.',
    type: 'built_in',
    riskLevel: 'high',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['start', 'status', 'list', 'cancel', 'synthesize'],
          description: 'start: create team session (autonomy >= 3). status: check session. list: all sessions. cancel: stop session (autonomy >= 3). synthesize: generate result summary.',
        },
        title: { type: 'string', description: 'Team title (for start)' },
        pattern: { type: 'string', enum: ['pipeline', 'fan-out', 'consensus'], description: 'Coordination pattern (for start, default: pipeline)' },
        tasks: {
          type: 'array',
          description: 'Task definitions with title, description, agent_name, dependencies (for start)',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              agent_name: { type: 'string' },
              dependencies: { type: 'array', items: { type: 'string' } },
            },
            required: ['title', 'description', 'agent_name'],
          },
        },
        session_id: { type: 'string', description: 'Session ID (for status, cancel, synthesize)' },
        agent_id: { type: 'string', description: 'Target agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => teamOps(input as unknown as Parameters<typeof teamOps>[0]),
  });

  reg.register({
    name: 'messaging',
    displayName: 'Messaging',
    description: 'Agent-to-agent messaging: send direct messages to other agents via Redis pub/sub, publish to broadcast channels, and emit custom events on the forge event bus.',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['send', 'publish', 'emit_event'],
          description: 'send: direct message to agent. publish: broadcast to channel. emit_event: emit custom forge event.',
        },
        to_agent_id: { type: 'string', description: 'Target agent ID (for send)' },
        type: { type: 'string', description: 'Message type: info, request, response, alert, etc. (for send)' },
        payload: { description: 'Message payload (for send)' },
        channel: { type: 'string', description: 'Channel name (for publish)' },
        message: { description: 'Broadcast message content (for publish)' },
        event_type: { type: 'string', description: 'Custom event type name (for emit_event)' },
        event_data: { type: 'object', description: 'Event data payload (for emit_event)' },
        agent_id: { type: 'string', description: 'Your agent ID (defaults to self)' },
      },
      required: ['action'],
    },
    execute: (input) => messaging(input as unknown as Parameters<typeof messaging>[0]),
  });

  reg.register({
    name: 'budget_check',
    displayName: 'Budget Check',
    description: 'Cost estimation and budget monitoring: estimate costs for model usage before expensive operations, and check remaining budget to avoid overspending.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['estimate', 'check'],
          description: 'estimate: calculate cost for token usage. check: verify budget remaining.',
        },
        input_tokens: { type: 'number', description: 'Number of input tokens (for estimate)' },
        output_tokens: { type: 'number', description: 'Number of output tokens (for estimate)' },
        model: { type: 'string', description: 'Model ID for pricing lookup (for estimate)' },
        current_cost: { type: 'number', description: 'Current accumulated cost in USD (for check)' },
        max_cost: { type: 'number', description: 'Maximum allowed cost in USD (for check)' },
      },
      required: ['action'],
    },
    execute: (input) => budgetCheck(input as unknown as Parameters<typeof budgetCheck>[0]),
  });

  reg.register({
    name: 'proposal_ops',
    displayName: 'Proposal Operations',
    description: 'Manage change proposals for agent code review. Actions: create (draft a proposal), submit (send for review), review (approve/reject/request_changes), list (filter proposals), get (detail with reviews), apply (mark approved proposal as applied), revise (update draft/revision_requested proposal).',
    type: 'built_in',
    riskLevel: 'medium',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'submit', 'review', 'list', 'get', 'apply', 'revise'],
          description: 'Operation to perform',
        },
        agent_id: { type: 'string', description: 'Author agent ID (for create/submit/apply/revise)' },
        agent_name: { type: 'string', description: 'Author agent name' },
        proposal_type: { type: 'string', enum: ['prompt_revision', 'code_change', 'config_change', 'schema_change'], description: 'Type of change (for create)' },
        title: { type: 'string', description: 'Proposal title (for create)' },
        description: { type: 'string', description: 'Detailed description (for create/revise)' },
        target_agent_id: { type: 'string', description: 'Agent being modified (for create)' },
        file_changes: { type: 'array', description: 'Array of {path, action, content, diff} (for create/revise)' },
        config_changes: { type: 'object', description: 'Config changes object (for create/revise)' },
        risk_level: { type: 'string', enum: ['low', 'medium', 'high', 'critical'], description: 'Risk classification (for create)' },
        proposal_id: { type: 'string', description: 'Proposal ID (for submit/get/apply/revise/review)' },
        reviewer_agent_id: { type: 'string', description: 'Reviewing agent ID (for review)' },
        verdict: { type: 'string', enum: ['approve', 'reject', 'request_changes', 'comment'], description: 'Review verdict (for review)' },
        comment: { type: 'string', description: 'Review comment (for review)' },
        filter_status: { type: 'string', description: 'Filter by status (for list)' },
        filter_type: { type: 'string', description: 'Filter by proposal_type (for list)' },
        filter_author: { type: 'string', description: 'Filter by author_agent_id (for list)' },
        limit: { type: 'number', description: 'Max results (for list, default 20, max 50)' },
      },
      required: ['action'],
    },
    execute: (input) => proposalOps(input as unknown as Parameters<typeof proposalOps>[0]),
  });

  reg.register({
    name: 'web_search',
    displayName: 'Web Search',
    description: 'Search the web via SearXNG meta search engine. Returns titles, URLs, and snippets.',
    type: 'built_in',
    riskLevel: 'low',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        maxResults: { type: 'number', description: 'Max results to return (1-10, default 5)' },
      },
      required: ['query'],
    },
    execute: (input) => webSearch(input as unknown as Parameters<typeof webSearch>[0]),
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
    },
  };
  await writeFile(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2));
  console.log('[CLI] MCP config written');

  cliEnvironmentReady = true;
}

/**
 * Semaphore: acquire a CLI execution slot.
 * Blocks if MAX_CLI_CONCURRENCY is reached.
 * Times out after 10 minutes to prevent indefinite queueing.
 */
const CLI_SLOT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

function acquireCliSlot(): Promise<void> {
  const cfg = config ?? loadConfig();
  if (cliConcurrent < cfg.maxCliConcurrency) {
    cliConcurrent++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Remove from queue if still waiting
      const idx = cliQueue.indexOf(callback);
      if (idx >= 0) cliQueue.splice(idx, 1);
      reject(new Error(`CLI slot timeout: waited ${CLI_SLOT_TIMEOUT_MS / 1000}s, all ${cfg.maxCliConcurrency} slots occupied`));
    }, CLI_SLOT_TIMEOUT_MS);

    const callback = () => {
      clearTimeout(timer);
      cliConcurrent++;
      resolve();
    };
    cliQueue.push(callback);
    console.log(`[CLI] Execution queued — ${cliConcurrent}/${cfg.maxCliConcurrency} slots occupied, ${cliQueue.length} in queue`);
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

/** Start periodic OAuth token refresh timer */
function startTokenRefreshTimer(): void {
  const ONE_HOUR = 60 * 60 * 1000;
  // Initial refresh after 30 seconds (let the server finish booting)
  setTimeout(() => {
    refreshCredentials().catch(err =>
      console.warn('[CLI] Periodic token refresh error:', err),
    );
  }, 30_000);
  // Then every hour (8h token TTL, refresh at 1h before expiry)
  setInterval(() => {
    refreshCredentials().catch(err =>
      console.warn('[CLI] Periodic token refresh error:', err),
    );
  }, ONE_HOUR);
  console.log('[CLI] OAuth token refresh timer started (every 1h)');
}

/** Claude Code CLI OAuth client ID (constant) */
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const TOKEN_REFRESH_BUFFER_MS = 60 * 60 * 1000; // Refresh 1 hour before expiry

/**
 * Refresh OAuth credentials before execution.
 * 1. Copies fresher token from mount if available
 * 2. Auto-refreshes expired/expiring tokens using the refresh_token grant
 * 3. Persists refreshed tokens back to mount (host) for container restart survival
 */
async function refreshCredentials(): Promise<void> {
  const credsPath = `${CLAUDE_DIR}/.credentials.json`;
  const mountPath = '/tmp/claude-credentials.json';

  try {
    // Step 1: Copy fresher token from mount if available
    await access(mountPath);
    const mountRaw = await readFile(mountPath, 'utf8');
    const mountCreds = JSON.parse(mountRaw);
    let currentExpiry = 0;
    try {
      const curRaw = await readFile(credsPath, 'utf8');
      const cur = JSON.parse(curRaw);
      currentExpiry = cur.claudeAiOauth?.expiresAt || 0;
    } catch { /* no current file */ }
    if ((mountCreds.claudeAiOauth?.expiresAt || 0) > currentExpiry) {
      await copyFile(mountPath, credsPath);
      console.log('[CLI] Refreshed credentials from mount');
    }

    // Step 2: Check if token needs auto-refresh
    const raw = await readFile(credsPath, 'utf8');
    const creds = JSON.parse(raw);
    const oauth = creds.claudeAiOauth;
    if (!oauth?.refreshToken) return;

    const expiresAt = oauth.expiresAt || 0;
    const now = Date.now();

    if (expiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
      return; // Token still valid for > 1 hour
    }

    console.log(`[CLI] OAuth token expires in ${Math.round((expiresAt - now) / 60000)}min — auto-refreshing`);

    const res = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: oauth.refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[CLI] OAuth token refresh failed: ${res.status} ${errText.slice(0, 200)}`);
      return;
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Build updated credentials (preserve existing fields like scopes, subscriptionType)
    const updated = {
      claudeAiOauth: {
        ...oauth,
        accessToken: data.access_token,
        refreshToken: data.refresh_token, // Single-use — must store new one
        expiresAt: now + data.expires_in * 1000,
      },
    };

    const updatedJson = JSON.stringify(updated);

    // Write to CLI credential path
    await writeFile(credsPath, updatedJson);
    console.log(`[CLI] OAuth token refreshed — expires ${new Date(updated.claudeAiOauth.expiresAt).toISOString()}`);

    // Persist back to mount (host file) so it survives container restarts
    try {
      await writeFile(mountPath, updatedJson);
      console.log('[CLI] Persisted refreshed token to host mount');
    } catch (writeErr) {
      console.warn('[CLI] Could not persist to mount (read-only?):', (writeErr as Error).message);
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
      const MAX_BUFFER = 2 * 1024 * 1024; // 2MB cap — prevent OOM from verbose agents

      proc.stdout.on('data', (chunk: Buffer) => {
        if (stdout.length < MAX_BUFFER) stdout += chunk.toString().slice(0, MAX_BUFFER - stdout.length);
      });
      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stderr.length < MAX_BUFFER) stderr += text.slice(0, MAX_BUFFER - stderr.length);
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
        if (killed) return; // Guard against double-kill race
        killed = true;
        try {
          // Check process is still alive before killing
          if (proc.exitCode === null) {
            proc.kill('SIGTERM');
            try {
              execSync(`kill -TERM $(pgrep -P ${proc.pid}) 2>/dev/null || true`, { stdio: 'ignore', timeout: 3000 });
            } catch { /* no children or already dead */ }
            setTimeout(() => {
              try { if (proc.exitCode === null) proc.kill('SIGKILL'); } catch { /* already dead */ }
            }, 5000);
          }
        } catch { /* already dead */ }
      };

      proc.on('close', (code) => {
        proc.removeAllListeners(); // Prevent listener leak across 1000s of executions
        cleanup().catch(() => {});
        const cleanStdout = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
        resolve({
          exitCode: killed ? 124 : (code ?? 1),
          stdout: cleanStdout,
          stderr: stderr.trim(),
        });
      });

      proc.on('error', (err) => {
        proc.removeAllListeners();
        cleanup().catch(() => {});
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
    costUsd = (parsed['total_cost_usd'] as number) ?? 0;
    numTurns = (parsed['num_turns'] as number) ?? 0;

    const usage = parsed['usage'] as Record<string, number> | undefined;
    if (usage) {
      inputTokens = usage['input_tokens'] ?? 0;
      outputTokens = usage['output_tokens'] ?? 0;
    }

    // Extract the agent's actual text response — prefer 'result' field
    const resultText = parsed['result'] as string | undefined;
    const subtype = parsed['subtype'] as string | undefined;

    if (resultText && resultText.trim().length > 0) {
      output = resultText;
    } else if (subtype === 'error_max_budget_usd') {
      output = `[Budget exceeded after ${numTurns} turn(s), $${costUsd.toFixed(4)} spent] No output produced — budget was exhausted before the agent could complete its work.`;
      isError = true;
    } else if (subtype === 'error_max_turns') {
      output = `[Max turns reached (${numTurns}), $${costUsd.toFixed(4)} spent] Agent ran out of turns before completing. Partial work may exist in git worktree.`;
    } else {
      // Last resort: store a clean summary, not the raw JSON blob
      output = `[Execution completed: ${numTurns} turns, $${costUsd.toFixed(4)}] No text output captured.`;
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

/** Cached result of CLI availability check */
let cliAvailable: boolean | null = null;

/**
 * Validate prerequisites before spawning a CLI execution.
 * Checks command availability and validates required arguments.
 * Throws ExecutionError if prerequisites are not met.
 */
function validateCliPrerequisites(
  executionId: string,
  agentId: string,
  input: string,
): void {
  // Check CLI binary availability (cached after first successful check)
  if (cliAvailable === null) {
    try {
      execSync('which claude', { stdio: 'ignore', timeout: 5000 });
      cliAvailable = true;
    } catch {
      cliAvailable = false;
    }
  }

  if (!cliAvailable) {
    throw new ExecutionError(
      'Claude CLI binary not found in PATH',
      'CLI_NOT_FOUND',
      false,
      { executionId, agentId },
    );
  }

  // Validate required arguments
  if (!input || input.trim().length === 0) {
    throw new ExecutionError(
      'CLI execution requires a non-empty input prompt',
      'CLI_VALIDATION_ERROR',
      false,
      { executionId, agentId },
    );
  }

  if (!agentId || !executionId) {
    throw new ExecutionError(
      'CLI execution requires valid executionId and agentId',
      'CLI_VALIDATION_ERROR',
      false,
      { executionId, agentId },
    );
  }

  // Verify workspace directory is accessible (catches mount/permission issues)
  try {
    execSync(`test -w ${WORKSPACE_DIR}`, { stdio: 'ignore', timeout: 3000 });
  } catch {
    throw new ExecutionError(
      `Workspace directory ${WORKSPACE_DIR} is not writable`,
      'CLI_VALIDATION_ERROR',
      true, // Retryable — mount may recover
      { executionId, agentId },
    );
  }

  // Verify MCP config exists (written by setupCliEnvironment, but could be deleted)
  try {
    execSync(`test -f ${MCP_CONFIG_PATH}`, { stdio: 'ignore', timeout: 3000 });
  } catch {
    // MCP config missing — reset environment setup flag so it gets recreated
    cliEnvironmentReady = false;
  }
}

/**
 * Run an agent execution via Claude Code CLI (Phase 7).
 * Spawns the CLI as a child process with OAuth credentials and MCP tools.
 * This is the primary execution path — agents use Claude Max subscription.
 * Includes pre-execution validation and retry logic for transient failures.
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
    maxTurns?: number;
    /** Agent's schedule interval in minutes — used for runtime budgeting. */
    scheduleIntervalMinutes?: number;
  },
): Promise<void> {
  if (!initialized) {
    await initializeWorker();
  }

  const cfg = config ?? loadConfig();

  // One-time CLI environment setup (must run before validation to create dirs)
  await setupCliEnvironment();

  // Pre-execution validation — fail fast before acquiring resources
  validateCliPrerequisites(executionId, agentId, input);

  // Wait for concurrency slot
  await acquireCliSlot();

  const startTime = Date.now();
  forgeExecutionsTotal.inc();
  console.log(`[CLI] Processing execution ${executionId} for agent ${agentId}`);

  // Propagate execution context via AsyncLocalStorage so tools (agent_call, agent_delegate)
  // can access ownerId, executionId, and depth for sub-agent invocations
  const parentCtx = getExecutionContext();
  const depth = (parentCtx?.depth ?? 0) + (parentCtx ? 1 : 0);

  await executionStore.run({ ownerId, executionId, agentId, depth }, async () => {

  // Worktree state — hoisted above try/catch so finally can clean up
  const AGENT_REPO_ROOT = '/workspace';
  let agentWorktreeDir = '';
  let agentBranchName = '';
  let worktreeCreated = false;

  try {
    // Update execution status to running
    await query(
      `UPDATE forge_executions SET status = 'running', started_at = NOW() WHERE id = $1`,
      [executionId],
    );

    // Emit execution started event
    const agentRow = await query<{ name: string; model_id: string }>(`SELECT name, model_id FROM forge_agents WHERE id = $1`, [agentId]);
    const agentName = agentRow[0]?.name ?? agentId;
    const agentModelId = agentRow[0]?.model_id ?? 'claude-sonnet-4-6';
    const eventBus = getEventBus();
    void eventBus?.emitExecution('started', executionId, agentId, agentName, {
      input: input.substring(0, 200),
    }).catch(() => {});

    // Refresh OAuth credentials
    await refreshCredentials();

    // ---- Runtime budget calculation ----
    const runtimeBudget = calculateRuntimeBudget(
      options?.scheduleIntervalMinutes,
      cfg.cliTimeout,
    );
    const dynamicTimeout = runtimeBudget.maxDurationMs;

    // Estimate task complexity to adjust max turns
    const complexity = estimateTaskComplexity(input);
    const agentMaxTurns = options?.maxTurns ?? cfg.cliMaxTurns;
    const budgetAwareTurns = suggestMaxTurns(agentMaxTurns, complexity, dynamicTimeout);

    console.log(
      `[CLI] Runtime budget: ${Math.round(dynamicTimeout / 1000)}s timeout, ` +
      `complexity=${complexity}, turns=${budgetAwareTurns}/${agentMaxTurns} ` +
      `(schedule=${options?.scheduleIntervalMinutes ?? 'manual'}min)`,
    );

    // --- Git worktree isolation: each agent gets its own branch + working tree ---
    const agentSlug = agentName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    agentBranchName = `agent/${agentSlug}/${executionId}`;
    agentWorktreeDir = `${AGENT_REPO_ROOT}/.worktrees/${agentSlug}-${executionId}`;

    try {
      // Create worktree with a new branch based on main
      execSync(`git -C "${AGENT_REPO_ROOT}" worktree add "${agentWorktreeDir}" -b "${agentBranchName}" main 2>/dev/null || git -C "${AGENT_REPO_ROOT}" worktree add "${agentWorktreeDir}" "${agentBranchName}"`, {
        timeout: 60_000,
        stdio: 'pipe',
        env: { ...process.env, HOME: '/tmp', GIT_TERMINAL_PROMPT: '0' },
      });
      worktreeCreated = true;
      console.log(`[CLI] Created worktree for ${agentName}: ${agentWorktreeDir} (branch: ${agentBranchName})`);
    } catch (wtErr) {
      console.error(`[CLI] Failed to create worktree, falling back to shared workspace: ${wtErr instanceof Error ? wtErr.message : wtErr}`);
    }

    const agentWorkDir = worktreeCreated ? agentWorktreeDir : WORKSPACE_DIR;

    // Copy agent's system prompt as CLAUDE.md in workspace
    if (options?.systemPrompt) {
      try {
        // Inject relevant memories into the system prompt
        const memoryContext = await buildMemoryContext(agentId, input, { fleetWide: true }).catch((err) => {
          console.warn(`[CLI] Memory context build failed for ${agentName}: ${err instanceof Error ? err.message : err}`);
          return '';
        });
        // Inject runtime budget hint so agents self-regulate
        const budgetHint = formatBudgetPromptHint(runtimeBudget, agentName);
        const memoryInstruction = [
          '',
          '## COGNITIVE MEMORY — USE IT',
          'You have access to a fleet-wide cognitive memory system via the `memory_search` MCP tool.',
          '',
          '**Before starting work:**',
          '- Search memory for knowledge relevant to your task: `memory_search(query="<your task keywords>")`',
          '- Check if another agent already solved a similar problem',
          '- Look for procedural patterns that match your workflow',
          '',
          '**After completing work:**',
          '- Store key learnings via `memory_store` (type: "semantic" for facts, "episodic" for outcomes)',
          '- Include what worked, what failed, and any discoveries about the codebase',
          '- This helps the entire fleet learn from your experience',
          '',
        ].join('\n');
        const branchInstruction = [
          '',
          '## GIT WORKFLOW — MANDATORY',
          `You are working on git branch: ${agentBranchName}`,
          `Your working directory is: ${agentWorkDir}`,
          'All your file changes are isolated in your own git worktree.',
          '',
          'When you finish your work:',
          '1. Stage your changes: run `git add -A` in your working directory',
          '2. Commit with a descriptive message: run `git commit -m "your message"`',
          '3. Do NOT merge to main — a human will review and merge via the Push Panel',
          '4. Do NOT switch branches or run git checkout',
          '5. NEVER leave uncommitted changes on disk',
          '',
        ].join('\n');
        // Load organism vision — the DNA every agent carries
        let visionContext = '';
        try {
          visionContext = await readFile('/workspace/VISION.md', 'utf-8');
        } catch {
          // Vision file not available — continue without it
        }
        const fullPrompt = [visionContext, options.systemPrompt, memoryContext, memoryInstruction, budgetHint, branchInstruction]
          .filter(Boolean)
          .join('\n');
        await writeFile(`${agentWorkDir}/CLAUDE.md`, fullPrompt);
      } catch {
        console.warn('[CLI] Could not write CLAUDE.md to workspace');
      }
    }

    // Build CLI arguments
    const args: string[] = [
      '-p', input,
      '--output-format', 'json',
      '--max-turns', String(budgetAwareTurns),
      '--max-budget-usd', options?.maxBudgetUsd ?? cfg.cliBudgetUsd,
      '--dangerously-skip-permissions',
      '--mcp-config', MCP_CONFIG_PATH,
    ];

    // Use agent's configured model
    if (options?.modelId) {
      args.push('--model', options.modelId);
      console.log(`[CLI] Using model: ${options.modelId}`);
    }

    // Execute CLI with retry for transient failures
    const result = await withRetry(
      async () => {
        const res = await executeClaudeCode(args, agentWorkDir, dynamicTimeout);
        // Classify non-zero exits — throw retryable errors so withRetry can retry them
        if (res.exitCode !== 0) {
          const classified = classifyCliError(res.exitCode, res.stderr, res.stdout);
          if (classified.retryable) {
            console.warn(
              `[CLI] Execution ${executionId} transient failure (${classified.code}): ${classified.message} — will retry`,
            );
            throw classified;
          }
        }
        return res;
      },
      {
        maxRetries: 2,
        baseDelayMs: 3000,
        maxDelayMs: 15_000,
        backoffMultiplier: 2,
        jitter: 0.2,
        shouldRetry: (err) => err instanceof ExecutionError && err.retryable,
      },
    );
    const durationMs = Date.now() - startTime;

    // Parse result
    const parsed = parseCliOutput(result.stdout, result.stderr, result.exitCode);
    forgeExecutionDuration.observe(durationMs);

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

    // Record cost event for the cost dashboard (trackCost retries internally)
    if (parsed.costUsd > 0) {
      void trackCost({
        executionId,
        agentId,
        ownerId,
        provider: 'anthropic',
        model: agentModelId,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        cost: parsed.costUsd,
        metadata: { turns: parsed.numTurns, durationMs },
      }).catch(() => {
        // trackCost logs full details on final failure — nothing more to do here
      });
    }

    // Emit execution completed/failed event
    void eventBus?.emitExecution(
      parsed.isError ? 'failed' : 'completed',
      executionId, agentId, agentName,
      {
        output: parsed.output.substring(0, 500),
        error: parsed.isError ? (result.stderr?.substring(0, 500) || 'CLI execution failed') : undefined,
        tokens: parsed.inputTokens + parsed.outputTokens,
        cost: parsed.costUsd,
        durationMs,
        turns: parsed.numTurns,
      },
    ).catch(() => {});

    // Update agent performance counters (retry on transient DB errors)
    void retryQuery(
      `UPDATE forge_agents
       SET tasks_completed = tasks_completed + CASE WHEN $2 THEN 1 ELSE 0 END,
           tasks_failed = tasks_failed + CASE WHEN $2 THEN 0 ELSE 1 END
       WHERE id = $1`,
      [agentId, !parsed.isError],
    ).catch(() => {});

    // Update capability proficiency from tools used in this execution
    const toolExecs = await query<{ tool_name: string }>(
      `SELECT DISTINCT tool_name FROM forge_tool_executions WHERE execution_id = $1`,
      [executionId],
    ).catch(() => [] as { tool_name: string }[]);
    if (toolExecs.length > 0) {
      void updateCapabilityFromExecution(
        agentId, toolExecs.map((t) => t.tool_name), !parsed.isError,
      ).catch(() => {});
    }

    // Fire-and-forget memory extraction
    void extractMemories({
      executionId,
      agentId,
      ownerId,
      input,
      output: parsed.output,
      isError: parsed.isError,
      costUsd: parsed.costUsd,
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      numTurns: parsed.numTurns,
      durationMs,
    }).catch((err) => {
      console.warn('[Memory] Post-execution extraction failed:', err instanceof Error ? err.message : err);
    });

    // Fire-and-forget knowledge graph extraction (Phase 11)
    if (!parsed.isError && parsed.output.length > 200) {
      void extractKnowledge(agentId, parsed.output, input).catch(() => {});
    }

    // Record cost sample for optimization (Phase 10)
    if (parsed.costUsd > 0) {
      const quality = parsed.isError ? 0.2 : 0.8;
      const totalTokens = parsed.inputTokens + parsed.outputTokens;
      // Record at agent level (CLI mode doesn't populate forge_tool_executions)
      void recordCostSample(agentName, agentModelId, parsed.costUsd, totalTokens, quality).catch(() => {});
    }
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);

    // Structured error logging with classification
    if (err instanceof ExecutionError) {
      console.error(
        `[CLI] Execution ${executionId} ${err.retryable ? 'TRANSIENT' : 'FATAL'} error ` +
        `(${err.code}): ${err.message}`,
        JSON.stringify(err.metadata),
      );
    } else {
      console.error(`[CLI] Execution ${executionId} error: ${errorMsg}`);
    }

    // Emit failure event
    const errorCode = err instanceof ExecutionError ? err.code : 'UNKNOWN';
    void getEventBus()?.emitExecution('failed', executionId, agentId, agentId, {
      error: `[${errorCode}] ${errorMsg.substring(0, 500)}`,
      durationMs,
    }).catch(() => {});

    await query(
      `UPDATE forge_executions
       SET status = 'failed', error = $1, duration_ms = $2, completed_at = NOW()
       WHERE id = $3`,
      [errorMsg, durationMs, executionId],
    ).catch(() => {});

    // Update agent failure counter
    await query(
      `UPDATE forge_agents SET tasks_failed = tasks_failed + 1 WHERE id = $1`,
      [agentId],
    ).catch(() => {});
  } finally {
    // Clean up git worktree (branch stays for Push Panel review)
    if (worktreeCreated) {
      try {
        execSync(`git -C "${AGENT_REPO_ROOT}" worktree remove "${agentWorktreeDir}" --force 2>/dev/null || true`, {
          timeout: 10_000,
          stdio: 'pipe',
          env: { ...process.env, HOME: '/tmp', GIT_TERMINAL_PROMPT: '0' },
        });
        console.log(`[CLI] Removed worktree: ${agentWorktreeDir} (branch ${agentBranchName} preserved for review)`);
      } catch (cleanupErr) {
        console.warn(`[CLI] Worktree cleanup failed: ${cleanupErr instanceof Error ? cleanupErr.message : cleanupErr}`);
      }
    }
    releaseCliSlot();
  }

  }); // end executionStore.run()
}

/**
 * Run a synchronous CLI query (for System Assistant).
 * Spawns CLI with OAuth + MCP tools, returns output directly.
 * Shorter timeout and fewer turns than agent executions.
 */
export async function runCliQuery(
  prompt: string,
  options?: {
    model?: string;
    maxTurns?: number;
    timeout?: number;
    systemPrompt?: string;
  },
): Promise<{
  output: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  numTurns: number;
  isError: boolean;
}> {
  if (!initialized) {
    await initializeWorker();
  }

  await setupCliEnvironment();
  await acquireCliSlot();

  try {
    await refreshCredentials();

    // Write system prompt as CLAUDE.md in a temp directory to avoid conflicts
    const tempDir = `/tmp/assistant-query-${Date.now()}`;
    await mkdir(tempDir, { recursive: true });

    if (options?.systemPrompt) {
      await writeFile(`${tempDir}/CLAUDE.md`, options.systemPrompt);
    }

    const args: string[] = [
      '-p', prompt,
      '--output-format', 'json',
      '--max-turns', String(options?.maxTurns ?? 10),
      '--dangerously-skip-permissions',
      '--add-dir', tempDir,
      '--mcp-config', MCP_CONFIG_PATH,
    ];

    if (options?.model) {
      args.push('--model', options.model);
    }

    const result = await executeClaudeCode(args, tempDir, options?.timeout ?? 120000);
    const parsed = parseCliOutput(result.stdout, result.stderr, result.exitCode);

    // Cleanup temp directory
    await rm(tempDir, { recursive: true }).catch(() => {});

    return parsed;
  } finally {
    releaseCliSlot();
  }
}
