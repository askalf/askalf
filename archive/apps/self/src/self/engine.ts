/**
 * Self Conversation Engine — CLI Mode
 * Spawns Claude Code CLI with OAuth credentials and MCP tools.
 * Replaces direct Anthropic SDK usage for zero API cost (Claude Max subscription).
 */

import type { FastifyReply } from 'fastify';
import { spawn, execSync } from 'child_process';
import { readFile, writeFile, access, copyFile, mkdir, unlink } from 'fs/promises';
import { ulid } from 'ulid';
import { selfQuery, selfQueryOne } from '../database.js';
import { buildSystemPrompt, WELCOME_MESSAGE } from './system-prompt.js';

interface MessageRow {
  role: string;
  content: string;
}

// ============================================
// CLI Configuration
// ============================================

const MAX_CLI_TURNS = 10;
const CLI_TIMEOUT = 120_000; // 2 minutes per chat
const MAX_CONCURRENT = 2;

const CLAUDE_DIR = '/tmp/claude-home/.claude';
const MCP_CONFIG_PATH = '/tmp/claude-home/mcp.json';
const WORKSPACE_DIR = '/tmp/agent-workspace';

const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const TOKEN_REFRESH_BUFFER_MS = 60 * 60 * 1000; // 1 hour before expiry

// ============================================
// CLI Environment Setup
// ============================================

let cliReady = false;
let cliConcurrent = 0;
const cliQueue: Array<() => void> = [];

async function setupCliEnvironment(): Promise<void> {
  if (cliReady) return;

  await mkdir(`${CLAUDE_DIR}/debug`, { recursive: true });
  await mkdir(`${CLAUDE_DIR}/cache`, { recursive: true });
  await mkdir(WORKSPACE_DIR, { recursive: true });

  // Copy OAuth credentials if available
  try {
    await access('/tmp/claude-credentials.json');
    await copyFile('/tmp/claude-credentials.json', `${CLAUDE_DIR}/.credentials.json`);
    console.log('[Self CLI] OAuth credentials installed');
  } catch {
    console.warn('[Self CLI] No OAuth credentials found at /tmp/claude-credentials.json');
  }

  // Settings — auto-accept all permissions
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

  // MCP config — connect to mcp-tools for remember/recall/web_search
  const mcpConfig = {
    mcpServers: {
      'mcp-tools': {
        type: 'http',
        url: 'http://mcp-tools:3010/mcp',
      },
    },
  };
  await writeFile(MCP_CONFIG_PATH, JSON.stringify(mcpConfig, null, 2));

  cliReady = true;
  console.log('[Self CLI] Environment ready');
}

async function refreshCredentials(): Promise<void> {
  const credsPath = `${CLAUDE_DIR}/.credentials.json`;
  const mountPath = '/tmp/claude-credentials.json';

  try {
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
      console.log('[Self CLI] Refreshed credentials from mount');
    }

    const raw = await readFile(credsPath, 'utf8');
    const creds = JSON.parse(raw);
    const oauth = creds.claudeAiOauth;
    if (!oauth?.refreshToken) return;

    const expiresAt = oauth.expiresAt || 0;
    const now = Date.now();

    if (expiresAt > now + TOKEN_REFRESH_BUFFER_MS) return;

    console.log(`[Self CLI] OAuth token expires in ${Math.round((expiresAt - now) / 60000)}min — refreshing`);

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
      console.error(`[Self CLI] OAuth refresh failed: ${res.status} ${errText.slice(0, 200)}`);
      return;
    }

    const data = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    const updated = {
      claudeAiOauth: {
        ...oauth,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: now + data.expires_in * 1000,
      },
    };

    const updatedJson = JSON.stringify(updated);
    await writeFile(credsPath, updatedJson);
    console.log(`[Self CLI] Token refreshed — expires ${new Date(updated.claudeAiOauth.expiresAt).toISOString()}`);

    try {
      await writeFile(mountPath, updatedJson);
      console.log('[Self CLI] Persisted refreshed token to host mount');
    } catch (writeErr) {
      console.warn('[Self CLI] Could not persist to mount:', (writeErr as Error).message);
    }
  } catch { /* mount may not exist */ }
}

function startTokenRefreshTimer(): void {
  setTimeout(() => {
    refreshCredentials().catch(err =>
      console.warn('[Self CLI] Periodic token refresh error:', err),
    );
  }, 30_000);
  setInterval(() => {
    refreshCredentials().catch(err =>
      console.warn('[Self CLI] Periodic token refresh error:', err),
    );
  }, 60 * 60 * 1000);
  console.log('[Self CLI] OAuth token refresh timer started (every 1h)');
}

// ============================================
// CLI Concurrency Semaphore
// ============================================

function acquireSlot(): Promise<void> {
  if (cliConcurrent < MAX_CONCURRENT) {
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

function releaseSlot(): void {
  cliConcurrent--;
  if (cliQueue.length > 0) {
    const next = cliQueue.shift()!;
    next();
  }
}

// ============================================
// CLI Execution
// ============================================

function executeClaudeCode(
  args: string[],
  cwd: string,
  timeout: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const promptIdx = args.indexOf('-p');
    let promptFile: string | null = null;
    const filteredArgs = [...args];

    const run = async () => {
      if (promptIdx >= 0 && promptIdx + 1 < args.length) {
        promptFile = `/tmp/prompt-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
        await writeFile(promptFile, filteredArgs[promptIdx + 1]!);
        filteredArgs.splice(promptIdx, 2);
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
          ANTHROPIC_API_KEY: '', // Force OAuth
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
        const lines = text.trim().split('\n');
        for (const line of lines.slice(0, 3)) {
          if (line.trim()) console.log(`[Self CLI:stderr] ${line.substring(0, 200)}`);
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
    jsonStr = jsonStr.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '');
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

    if (parsed['is_error'] === true && outputTokens === 0) {
      isError = true;
    } else if (!parsed['type'] && exitCode !== 0) {
      isError = true;
    }
  } catch {
    console.error(`[Self CLI] JSON parse failed: ${stdout.substring(0, 200)}`);
    if (stderr) console.error(`[Self CLI] stderr: ${stderr.substring(0, 500)}`);
    if (exitCode !== 0) isError = true;
  }

  return { output, costUsd, inputTokens, outputTokens, numTurns, isError };
}

// ============================================
// Public API
// ============================================

let initialized = false;

/**
 * Initialize the Self CLI engine.
 * Call once on server startup.
 */
export async function initializeSelfEngine(): Promise<void> {
  if (initialized) return;
  await setupCliEnvironment();
  startTokenRefreshTimer();
  initialized = true;
  console.log('[Self CLI] Engine initialized');
}

/**
 * Stream a Self conversation response via SSE using Claude CLI.
 * MVP: runs CLI to completion, sends result as one SSE burst.
 */
export async function streamSelfConversation(
  userId: string,
  conversationId: string,
  userMessage: string,
  reply: FastifyReply,
): Promise<void> {
  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Store user message
    const userMsgId = ulid();
    await selfQuery(
      `INSERT INTO self_messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
      [userMsgId, conversationId, userMessage],
    );

    await selfQuery(
      `UPDATE self_conversations SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1`,
      [conversationId],
    );

    // Load conversation history (last 50 messages)
    const history = await selfQuery<MessageRow>(
      `SELECT role, content FROM self_messages
       WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 50`,
      [conversationId],
    );

    // Load user preferences for system prompt context
    const preferences = await selfQuery<{ key: string; value: string }>(
      `SELECT key, value FROM user_preferences WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`,
      [userId],
    );

    // Build the system prompt
    const systemPrompt = buildSystemPrompt(preferences);

    // Build conversation context for CLI prompt
    const conversationContext = history
      .slice(0, -1) // Exclude the message we just inserted (it's the current input)
      .map(m => `[${m.role}] ${m.content}`)
      .join('\n\n');

    const cliPrompt = conversationContext
      ? `<conversation-history>\n${conversationContext}\n</conversation-history>\n\n<current-message>\n${userMessage}\n</current-message>`
      : userMessage;

    // Write system prompt as CLAUDE.md in workspace
    await writeFile(`${WORKSPACE_DIR}/CLAUDE.md`, systemPrompt);

    // Ensure CLI environment and credentials are fresh
    await setupCliEnvironment();
    await refreshCredentials();

    // Acquire concurrency slot
    await acquireSlot();

    const startTime = Date.now();

    try {
      // Build CLI arguments
      const args: string[] = [
        '-p', cliPrompt,
        '--output-format', 'json',
        '--max-turns', String(MAX_CLI_TURNS),
        '--dangerously-skip-permissions',
        '--add-dir', WORKSPACE_DIR,
        '--mcp-config', MCP_CONFIG_PATH,
      ];

      // Execute CLI
      const result = await executeClaudeCode(args, WORKSPACE_DIR, CLI_TIMEOUT);
      const durationMs = Date.now() - startTime;
      const parsed = parseCliOutput(result.stdout, result.stderr, result.exitCode);

      console.log(
        `[Self CLI] Chat ${conversationId.slice(-6)} ${parsed.isError ? 'FAILED' : 'done'} ` +
        `in ${durationMs}ms — cost=$${parsed.costUsd.toFixed(4)} turns=${parsed.numTurns}`,
      );

      if (parsed.isError) {
        send('error', { message: 'Self encountered an error. Please try again.' });
      } else {
        // Send the response as token events (one burst for MVP)
        send('token', { text: parsed.output });

        // Store assistant message
        const assistantMsgId = ulid();
        await selfQuery(
          `INSERT INTO self_messages (id, conversation_id, role, content, tokens_used)
           VALUES ($1, $2, 'assistant', $3, $4)`,
          [assistantMsgId, conversationId, parsed.output, parsed.inputTokens + parsed.outputTokens],
        );

        await selfQuery(
          `UPDATE self_conversations SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1`,
          [conversationId],
        );

        // Auto-generate title after first exchange
        const convo = await selfQueryOne<{ message_count: number; title: string | null }>(
          `SELECT message_count, title FROM self_conversations WHERE id = $1`,
          [conversationId],
        );

        if (convo && convo.message_count <= 2 && !convo.title) {
          const title = generateTitle(userMessage);
          await selfQuery(
            `UPDATE self_conversations SET title = $1 WHERE id = $2`,
            [title, conversationId],
          );
          send('title', { title });
        }

        send('done', { tokens: parsed.inputTokens + parsed.outputTokens, turns: parsed.numTurns });
      }
    } finally {
      releaseSlot();
    }
  } catch (err) {
    console.error('[Self CLI] Error:', err);
    send('error', { message: err instanceof Error ? err.message : 'An error occurred' });
  } finally {
    reply.raw.end();
  }
}

/**
 * Get or create a welcome message for new conversations.
 */
export function getWelcomeMessage(): string {
  return WELCOME_MESSAGE;
}

// ============================================
// Helpers
// ============================================

function generateTitle(firstMessage: string): string {
  const words = firstMessage.trim().split(/\s+/).slice(0, 6);
  let title = words.join(' ');
  if (firstMessage.trim().split(/\s+/).length > 6) {
    title += '...';
  }
  return title.length > 60 ? title.slice(0, 57) + '...' : title;
}
