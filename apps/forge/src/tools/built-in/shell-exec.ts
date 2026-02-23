/**
 * Built-in Tool: Shell Execute
 * Executes shell commands in the container environment.
 * Includes safety checks for destructive commands.
 */

import { exec } from 'child_process';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface ShellExecInput {
  command: string;
  cwd?: string | undefined;
  timeout?: number | undefined;
}

// ============================================
// Implementation
// ============================================

const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_SIZE = 512_000; // 512KB

const BLOCKED_PATTERNS = [
  'rm -rf /',
  'mkfs',
  'dd if=/dev',
  ':(){',
  'chmod -R 777 /',
  '> /dev/sda',
  'shutdown',
  'reboot',
  'halt',
  'init 0',
  'init 6',
];

/**
 * Execute a shell command with safety checks.
 *
 * - Blocks dangerous command patterns
 * - Enforces timeout (default 30s, max 60s)
 * - Captures stdout and stderr
 * - Truncates output to 512KB
 */
export async function shellExec(input: ShellExecInput): Promise<ToolResult> {
  const startTime = performance.now();
  const timeout = Math.min(input.timeout ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);

  // Validate cwd — restrict to safe directories only
  const ALLOWED_CWD_PREFIXES = ['/app', '/tmp/agent-workspace', '/tmp/claude-home'];
  const cwd = input.cwd ?? '/app';
  const normalizedCwd = cwd.replace(/\/+$/, ''); // strip trailing slashes
  if (!ALLOWED_CWD_PREFIXES.some(prefix => normalizedCwd === prefix || normalizedCwd.startsWith(prefix + '/'))) {
    return {
      output: null,
      error: `Blocked: cwd '${cwd}' is outside allowed directories (${ALLOWED_CWD_PREFIXES.join(', ')})`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Block dangerous commands
  const cmdLower = input.command.toLowerCase();
  for (const pattern of BLOCKED_PATTERNS) {
    if (cmdLower.includes(pattern)) {
      return {
        output: null,
        error: `Blocked: command contains dangerous pattern '${pattern}'`,
        durationMs: Math.round(performance.now() - startTime),
      };
    }
  }

  return new Promise((resolve) => {
    exec(
      input.command,
      {
        cwd,
        timeout,
        maxBuffer: MAX_OUTPUT_SIZE,
        env: { ...process.env, HOME: '/app' },
      },
      (error, stdout, stderr) => {
        const durationMs = Math.round(performance.now() - startTime);

        if (error && error.killed) {
          resolve({
            output: {
              stdout: stdout.slice(0, MAX_OUTPUT_SIZE),
              stderr: stderr.slice(0, MAX_OUTPUT_SIZE),
            },
            error: `Command timed out after ${timeout}ms`,
            durationMs,
          });
          return;
        }

        resolve({
          output: {
            exitCode: error ? (error.code ?? 1) : 0,
            stdout: stdout.slice(0, MAX_OUTPUT_SIZE),
            stderr: stderr.slice(0, MAX_OUTPUT_SIZE),
          },
          error: error && !stdout ? `Command failed: ${error.message}` : undefined,
          durationMs,
        });
      },
    );
  });
}
