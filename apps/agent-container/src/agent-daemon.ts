/**
 * Agent Daemon
 *
 * Runs inside each persistent agent container. Lifecycle:
 *
 * 1. Subscribe to Redis channel `agent:{agentId}:tasks`
 * 2. On task received:
 *    a. Run Claude Code CLI with the task, CLAUDE.md system prompt, and MCP config
 *    b. Parse result for cost/tokens/output
 *    c. Publish result to Redis `agent:{agentId}:results`
 * 3. Between tasks: container stays warm (instant next-task startup)
 */

import { Redis } from 'ioredis';
import { spawn } from 'child_process';
import { readFile, writeFile, access, copyFile, mkdir } from 'fs/promises';

// ============================================
// Configuration
// ============================================

const AGENT_ID = process.env['AGENT_ID'] ?? '';
const AGENT_NAME = process.env['AGENT_NAME'] ?? 'unknown';
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const MAX_BUDGET_USD = process.env['MAX_BUDGET_USD'] ?? '0.50';
const CLAUDE_MD_PATH = '/app/CLAUDE.md';
const MCP_CONFIG_PATH = '/app/mcp.json';

const log = (msg: string) => console.log(`[agent-${AGENT_NAME}] ${new Date().toISOString()} ${msg}`);
const logError = (msg: string) => console.error(`[agent-${AGENT_NAME}] ${new Date().toISOString()} ${msg}`);

if (!AGENT_ID) {
  logError('AGENT_ID is required');
  process.exit(1);
}

// ============================================
// Redis Setup
// ============================================

const subscriber = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 1000, 30000),
});

const publisher = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});

subscriber.on('error', (err) => logError(`Redis subscriber error: ${err.message}`));
publisher.on('error', (err) => logError(`Redis publisher error: ${err.message}`));

// ============================================
// Task Processor
// ============================================

interface TaskPayload {
  executionId: string;
  agentId: string;
  input: string;
  ownerId: string;
  sessionId: string | null;
  modelId: string | null;
  timestamp: string;
}

interface TaskResult {
  executionId: string;
  agentId: string;
  status: 'completed' | 'failed';
  output: string;
  error?: string;
  durationMs: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  numTurns?: number;
}

// ============================================
// Task Queue
// ============================================

const MAX_QUEUE_SIZE = 3;
const FAILURE_COOLDOWN_MS = 30_000; // 30s cooldown after failure before processing next task
const taskQueue: TaskPayload[] = [];
let isProcessing = false;
let lastFailureAt = 0;

async function processTask(payload: TaskPayload): Promise<void> {
  if (isProcessing) {
    if (taskQueue.length >= MAX_QUEUE_SIZE) {
      logError(`Queue full (${MAX_QUEUE_SIZE}), rejecting task ${payload.executionId}`);
      try {
        await publisher.publish(`agent:${AGENT_ID}:results`, JSON.stringify({
          executionId: payload.executionId,
          agentId: payload.agentId,
          status: 'failed',
          output: '',
          error: 'Agent task queue full',
          durationMs: 0,
        }));
      } catch { /* best effort */ }
      return;
    }
    log(`Queuing task ${payload.executionId} (queue depth: ${taskQueue.length + 1})`);
    taskQueue.push(payload);
    return;
  }

  isProcessing = true;
  const startTime = Date.now();
  log(`Processing task ${payload.executionId}: ${payload.input.substring(0, 100)}...`);

  try {
    // Refresh credentials before each task — prefer mount if it has a fresher token
    const homeDir = process.env['HOME'] ?? '/home/agent';
    const credsPath = `${homeDir}/.claude/.credentials.json`;
    try {
      await access('/tmp/claude-credentials.json');
      const mountRaw = await readFile('/tmp/claude-credentials.json', 'utf8');
      const mountCreds = JSON.parse(mountRaw);
      let currentExpiry = 0;
      try {
        const curRaw = await readFile(credsPath, 'utf8');
        currentExpiry = JSON.parse(curRaw).claudeAiOauth?.expiresAt || 0;
      } catch { /* no current file */ }
      // Copy if mount has a fresher token
      if ((mountCreds.claudeAiOauth?.expiresAt || 0) > currentExpiry) {
        await copyFile('/tmp/claude-credentials.json', credsPath);
      }
    } catch { /* mount may not exist */ }

    // Set up workspace directory with CLAUDE.md for auto-discovery
    // Claude Code auto-loads CLAUDE.md from the working directory
    const workDir = '/tmp/agent-workspace';
    try {
      await mkdir(workDir, { recursive: true });
      await access(CLAUDE_MD_PATH);
      await copyFile(CLAUDE_MD_PATH, `${workDir}/CLAUDE.md`);
    } catch {
      // No CLAUDE.md or can't create workspace — will use defaults
      try { await mkdir(workDir, { recursive: true }); } catch { /* ignore */ }
    }

    // Build Claude Code CLI arguments
    const args: string[] = [
      '-p', payload.input,
      '--output-format', 'json',
      '--max-turns', '5',  // Each turn ~90s (API + MCP tools), 5 turns + startup ≈ 8-9min
      '--max-budget-usd', MAX_BUDGET_USD,
      '--dangerously-skip-permissions',
      '--add-dir', '/workspace',
    ];

    // Use agent's configured model (from Forge DB) instead of CLI default
    if (payload.modelId) {
      args.push('--model', payload.modelId);
      log(`Using model: ${payload.modelId}`);
    }

    // Add MCP config if available (streamable HTTP transport)
    try {
      await access(MCP_CONFIG_PATH);
      args.push('--mcp-config', MCP_CONFIG_PATH);
    } catch {
      // No MCP config — agent runs with native tools only
    }

    // Execute Claude Code CLI from workspace dir with CLAUDE.md
    const result = await executeClaudeCode(args, workDir);
    const durationMs = Date.now() - startTime;

    // Parse result
    let output = result.stdout;
    let costUsd = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let numTurns = 0;
    let isError = false; // Default to success; only mark failed if truly errored

    try {
      // Claude Code --output-format json returns:
      // { type, result, total_cost_usd, is_error, num_turns, session_id, usage: { input_tokens, output_tokens } }
      let jsonStr = result.stdout;
      // Remove all control characters except newline
      jsonStr = jsonStr.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
      // Extract JSON object — find first { and last }
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace >= 0 && lastBrace > firstBrace) {
        jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
      }

      const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
      output = (parsed['result'] as string) ?? result.stdout;
      costUsd = (parsed['total_cost_usd'] as number) ?? 0;
      numTurns = (parsed['num_turns'] as number) ?? 0;

      const usage = parsed['usage'] as Record<string, number> | undefined;
      if (usage) {
        inputTokens = usage['input_tokens'] ?? 0;
        outputTokens = usage['output_tokens'] ?? 0;
      }

      // Determine success: if CLI produced a parsed result with tokens, it ran successfully
      // even if exit code is non-zero (e.g. max_turns, max_budget subtypes)
      // Only mark as error if is_error is explicitly true AND no useful output was produced
      if (parsed['is_error'] === true && outputTokens === 0) {
        isError = true;
      } else if (!parsed['type'] && result.exitCode !== 0) {
        // No valid JSON structure parsed + non-zero exit = real failure
        isError = true;
      }

      log(`Parsed: cost=$${costUsd.toFixed(4)} tokens=${inputTokens}/${outputTokens} turns=${numTurns}`);
    } catch (parseErr) {
      logError(`JSON parse failed: ${parseErr instanceof Error ? parseErr.message : parseErr}`);
      logError(`Raw stdout first 200 chars: ${result.stdout.substring(0, 200)}`);
      if (result.stderr) {
        logError(`Stderr first 500 chars: ${result.stderr.substring(0, 500)}`);
      }
    }

    const taskResult: TaskResult = {
      executionId: payload.executionId,
      agentId: payload.agentId,
      status: isError ? 'failed' : 'completed',
      output,
      durationMs,
      costUsd,
      inputTokens,
      outputTokens,
      numTurns,
    };

    if (isError) {
      taskResult.error = result.stderr || 'Execution failed';
      lastFailureAt = Date.now();
    }

    // Publish result
    await publisher.publish(
      `agent:${AGENT_ID}:results`,
      JSON.stringify(taskResult),
    );

    log(`Task ${payload.executionId} ${taskResult.status} in ${durationMs}ms ($${costUsd.toFixed(4)})`);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const errorMsg = err instanceof Error ? err.message : String(err);
    logError(`Task ${payload.executionId} error: ${errorMsg}`);
    lastFailureAt = Date.now();

    const taskResult: TaskResult = {
      executionId: payload.executionId,
      agentId: payload.agentId,
      status: 'failed',
      output: '',
      error: errorMsg,
      durationMs,
    };

    try {
      await publisher.publish(
        `agent:${AGENT_ID}:results`,
        JSON.stringify(taskResult),
      );
    } catch {
      logError('Failed to publish error result');
    }
  } finally {
    isProcessing = false;

    // Drain queue: process next waiting task (with cooldown after failures)
    if (taskQueue.length > 0) {
      const timeSinceFailure = Date.now() - lastFailureAt;
      if (lastFailureAt > 0 && timeSinceFailure < FAILURE_COOLDOWN_MS) {
        const delay = FAILURE_COOLDOWN_MS - timeSinceFailure;
        log(`Cooldown after failure: waiting ${Math.round(delay / 1000)}s before next task`);
        setTimeout(() => {
          if (taskQueue.length > 0) {
            const next = taskQueue.shift()!;
            log(`Dequeuing task ${next.executionId} after cooldown (remaining: ${taskQueue.length})`);
            void processTask(next);
          }
        }, delay);
      } else {
        const next = taskQueue.shift()!;
        log(`Dequeuing task ${next.executionId} (remaining: ${taskQueue.length})`);
        void processTask(next);
      }
    }
  }
}

// ============================================
// Claude Code CLI Execution
// ============================================

async function executeClaudeCode(
  args: string[],
  cwd = '/workspace',
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const timeout = 900_000; // 15 minutes max (agents need 8-12 min for multi-turn executions)

  // Write prompt to temp file to avoid shell escaping issues with long/complex prompts
  const promptIdx = args.indexOf('-p');
  let promptFile: string | null = null;
  const filteredArgs = [...args];
  if (promptIdx >= 0 && promptIdx + 1 < args.length) {
    promptFile = `/tmp/prompt-${Date.now()}.txt`;
    await writeFile(promptFile, filteredArgs[promptIdx + 1]!);
    // Replace -p "long prompt" with -p @file (read from file)
    // Claude CLI doesn't support @file, so use stdin instead
    filteredArgs.splice(promptIdx, 2); // remove -p and prompt
  }

  return new Promise((resolve) => {
    // Claude CLI requires a shell context (doesn't work with execFile/spawn directly)
    // Build shell command with proper escaping for non-prompt args
    const escapedArgs = filteredArgs.map(a => "'" + a.replace(/'/g, "'\\''") + "'").join(' ');
    const shellCmd = promptFile
      ? `claude -p "$(cat '${promptFile}')" ${escapedArgs}`
      : `claude ${escapedArgs}`;

    const proc = spawn('sh', ['-c', shellCmd], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin=ignore prevents CLI waiting for input
      env: {
        ...process.env,
        ...(process.env['ANTHROPIC_API_KEY'] ? { ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'] } : {}),
      },
    });

    let stdout = '';
    let stderr = '';
    let killed = false;
    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      // Log stderr in real-time to diagnose CLI slowness
      const lines = text.trim().split('\n');
      for (const line of lines.slice(0, 3)) {
        if (line.trim()) log(`[stderr] ${line.substring(0, 200)}`);
      }
    });

    const cleanup = async () => {
      if (promptFile) {
        try { const { unlink } = await import('fs/promises'); await unlink(promptFile); } catch { /* ignore */ }
      }
    };

    // Kill process tree: sh → claude → child tools
    const killTree = () => {
      killed = true;
      try {
        // Kill the shell and direct children
        proc.kill('SIGTERM');
        // Also kill any claude process spawned by this shell
        const { execSync } = require('child_process');
        try {
          execSync(`kill -TERM $(pgrep -P ${proc.pid}) 2>/dev/null || true`, { stdio: 'ignore' });
        } catch { /* no children or already dead */ }
      } catch { /* already dead */ }
      // Force kill after 5s
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    };

    proc.on('close', async (code) => {
      await cleanup();
      const cleanStdout = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').trim();
      resolve({
        exitCode: killed ? 124 : (code ?? 1), // 124 = timeout convention
        stdout: cleanStdout,
        stderr: stderr.trim(),
      });
    });

    proc.on('error', async (err) => {
      await cleanup();
      resolve({ exitCode: 1, stdout: '', stderr: err.message });
    });

    // Safety: kill process tree if still running after timeout
    setTimeout(killTree, timeout);
  });
}

// ============================================
// Main Loop
// ============================================

async function main(): Promise<void> {
  log('Agent daemon starting...');

  // Set up Claude Code OAuth credentials if available
  // Credentials are mounted at /tmp/claude-credentials.json (read-only)
  // Claude Code CLI looks for ~/.claude/.credentials.json
  const claudeDir = `${process.env['HOME'] ?? '/home/agent'}/.claude`;
  try {
    await mkdir(`${claudeDir}/debug`, { recursive: true });
    await mkdir(`${claudeDir}/cache`, { recursive: true });
    await access('/tmp/claude-credentials.json');
    await copyFile('/tmp/claude-credentials.json', `${claudeDir}/.credentials.json`);
    log('OAuth credentials installed for Claude Code CLI');
  } catch {
    log('No OAuth credentials found — will use ANTHROPIC_API_KEY if set');
  }

  // Set up git config for code-writing agents
  const homeDir = process.env['HOME'] ?? '/home/agent';
  try {
    const gitConfig = [
      '[user]',
      `\tname = ${AGENT_NAME}`,
      `\temail = ${AGENT_NAME.toLowerCase().replace(/\s+/g, '-')}@agent.askalf.org`,
      '[safe]',
      '\tdirectory = /workspace',
      '[init]',
      '\tdefaultBranch = main',
    ].join('\n');
    await writeFile(`${homeDir}/.gitconfig`, gitConfig);
    log('Git config written');
  } catch (gitErr) {
    logError(`Failed to write .gitconfig: ${gitErr instanceof Error ? gitErr.message : gitErr}`);
  }

  // Write settings.json — auto-accept all permissions, prevent any interactive prompts
  try {
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
    await writeFile(`${claudeDir}/settings.json`, JSON.stringify(settings, null, 2));
    log('Settings.json written — all permissions auto-accepted');
  } catch (settingsErr) {
    logError(`Failed to write settings.json: ${settingsErr instanceof Error ? settingsErr.message : settingsErr}`);
  }

  // Subscribe to task channel
  const channel = `agent:${AGENT_ID}:tasks`;
  await subscriber.subscribe(channel);
  log(`Subscribed to ${channel}`);

  // Set agent status in Redis
  await publisher.set(`agent:${AGENT_ID}:status`, JSON.stringify({
    status: 'idle',
    name: AGENT_NAME,
    startedAt: new Date().toISOString(),
    pid: process.pid,
  }));

  // Listen for tasks
  subscriber.on('message', async (_channel, message) => {
    try {
      const payload = JSON.parse(message) as TaskPayload;

      // Update status
      await publisher.set(`agent:${AGENT_ID}:status`, JSON.stringify({
        status: 'processing',
        name: AGENT_NAME,
        executionId: payload.executionId,
        startedAt: new Date().toISOString(),
      }));

      await processTask(payload);

      // Reset status
      await publisher.set(`agent:${AGENT_ID}:status`, JSON.stringify({
        status: 'idle',
        name: AGENT_NAME,
        lastActivity: new Date().toISOString(),
      }));
    } catch (err) {
      logError(`Message processing error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // Heartbeat
  setInterval(async () => {
    try {
      await publisher.setex(`agent:${AGENT_ID}:heartbeat`, 120, Date.now().toString());
    } catch {
      // Non-fatal
    }
  }, 30000);

  // Credential refresh — check token expiry every 5 minutes
  // If access token is within 30 min of expiry, use refresh token to get a new one
  setInterval(async () => {
    try {
      const credsPath = `${claudeDir}/.credentials.json`;
      await access(credsPath);
      const raw = await readFile(credsPath, 'utf8');
      const creds = JSON.parse(raw);
      const oauth = creds.claudeAiOauth;
      if (!oauth?.expiresAt || !oauth?.refreshToken) return;

      const timeLeft = oauth.expiresAt - Date.now();
      const thirtyMin = 30 * 60 * 1000;

      if (timeLeft > thirtyMin) {
        // Token still fresh — also sync from mount in case host has a newer one
        try {
          await access('/tmp/claude-credentials.json');
          const mountRaw = await readFile('/tmp/claude-credentials.json', 'utf8');
          const mountCreds = JSON.parse(mountRaw);
          if (mountCreds.claudeAiOauth?.expiresAt > oauth.expiresAt) {
            await copyFile('/tmp/claude-credentials.json', credsPath);
            log('Synced fresher token from mount');
          }
        } catch { /* mount check non-fatal */ }
        return;
      }

      // Token expiring soon or already expired — refresh it
      log(`Access token expires in ${Math.round(timeLeft / 60000)}min — refreshing...`);
      try {
        const params = new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: oauth.refreshToken,
          client_id: 'claude-code',
        });
        const resp = await fetch('https://console.anthropic.com/v1/oauth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        });

        if (!resp.ok) {
          logError(`Token refresh failed: HTTP ${resp.status} ${await resp.text().catch(() => '')}`);
          return;
        }

        const data = await resp.json() as {
          access_token?: string;
          refresh_token?: string;
          expires_in?: number;
        };
        if (!data.access_token) {
          logError('Token refresh returned no access_token');
          return;
        }

        // Update credentials
        const newCreds = {
          claudeAiOauth: {
            ...oauth,
            accessToken: data.access_token,
            refreshToken: data.refresh_token || oauth.refreshToken,
            expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 3600000),
          },
        };

        await writeFile(credsPath, JSON.stringify(newCreds));
        log(`Token refreshed — new expiry: ${new Date(newCreds.claudeAiOauth.expiresAt).toISOString()}`);

        // Also update the mount if writable (propagates to other agents)
        try {
          await writeFile('/tmp/claude-credentials.json', JSON.stringify(newCreds));
        } catch { /* mount is read-only, expected */ }
      } catch (refreshErr) {
        logError(`OAuth refresh error: ${refreshErr instanceof Error ? refreshErr.message : String(refreshErr)}`);
      }
    } catch {
      // No credentials file — non-fatal
    }
  }, 5 * 60 * 1000);

  log('Agent daemon ready and waiting for tasks');
}

// ============================================
// Shutdown
// ============================================

process.on('SIGTERM', async () => {
  log('SIGTERM received, shutting down gracefully...');
  try {
    await publisher.set(`agent:${AGENT_ID}:status`, JSON.stringify({
      status: 'shutdown',
      name: AGENT_NAME,
      shutdownAt: new Date().toISOString(),
    }));
    await subscriber.unsubscribe();
    await subscriber.quit();
    await publisher.quit();
  } catch {
    // Ignore cleanup errors
  }
  process.exit(0);
});

process.on('SIGINT', () => process.exit(0));

// Start
main().catch((err) => {
  logError(`Fatal error: ${err}`);
  process.exit(1);
});
