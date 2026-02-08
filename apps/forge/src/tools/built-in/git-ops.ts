/**
 * Built-in Tool: Git Operations
 * Provides git access for agents to create branches, write code, and commit.
 * All work happens on `agent/*` branches — merging to main requires human approval.
 */

import { exec } from 'child_process';
import pg from 'pg';
import crypto from 'crypto';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface GitOpsInput {
  action:
    | 'status'
    | 'diff'
    | 'log'
    | 'branch_list'
    | 'branch_create'
    | 'checkout'
    | 'add'
    | 'commit'
    | 'merge_to_main';
  branch_name?: string;
  paths?: string[];
  message?: string;
  max_count?: number;
  cached?: boolean;
  file_path?: string;
  agent_name?: string;
  agent_id?: string;
}

// ============================================
// Constants
// ============================================

const REPO_ROOT = process.env['REPO_ROOT'] ?? '/workspace';
const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 8_000;
const MAX_DIFF_OUTPUT = 4_000;

const BLOCKED_BRANCHES = ['main', 'master', 'production'];
const BLOCKED_FILE_PATTERNS = ['.env', '.key', '.pem', 'credentials', 'secret'];

// ============================================
// Helpers
// ============================================

function git(args: string, timeout = EXEC_TIMEOUT_MS): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(
      `git -C "${REPO_ROOT}" ${args}`,
      { timeout, maxBuffer: 1_024_000, env: { ...process.env, HOME: '/tmp', GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout, stderr) => {
        resolve({
          exitCode: error ? (error.code ?? 1) : 0,
          stdout: stdout.slice(0, MAX_OUTPUT),
          stderr: stderr.slice(0, MAX_OUTPUT),
        });
      },
    );
  });
}

function isBlockedFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  return BLOCKED_FILE_PATTERNS.some((p) => lower.includes(p));
}

// Substrate DB pool for creating interventions
let pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env['SUBSTRATE_DATABASE_URL'];
    if (!connectionString) throw new Error('SUBSTRATE_DATABASE_URL not configured');
    pool = new pg.Pool({ connectionString, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  }
  return pool;
}

function generateId(): string {
  const timestamp = Date.now().toString(36).padStart(10, '0');
  const random = crypto.randomBytes(10).toString('hex').slice(0, 16);
  return (timestamp + random).toUpperCase();
}

// ============================================
// Implementation
// ============================================

export async function gitOps(input: GitOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      // ----- Read-only operations -----

      case 'status': {
        const res = await git('status --porcelain -b');
        return {
          output: { branch: res.stdout.split('\n')[0]?.replace('## ', ''), status: res.stdout, exitCode: res.exitCode },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'diff': {
        let cmd = 'diff';
        if (input.cached) cmd += ' --cached';
        if (input.file_path) cmd += ` -- "${input.file_path}"`;
        const res = await git(cmd);
        const diff = res.stdout.length > MAX_DIFF_OUTPUT
          ? res.stdout.slice(0, MAX_DIFF_OUTPUT) + '\n... [truncated]'
          : res.stdout;
        return {
          output: { diff, truncated: res.stdout.length > MAX_DIFF_OUTPUT, exitCode: res.exitCode },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'log': {
        const count = Math.min(input.max_count ?? 20, 50);
        const res = await git(`log --oneline -n ${count}`);
        return {
          output: { log: res.stdout, exitCode: res.exitCode },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'branch_list': {
        const res = await git('branch -a');
        return {
          output: { branches: res.stdout, exitCode: res.exitCode },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      // ----- Write operations -----

      case 'branch_create': {
        if (!input.branch_name) {
          return { output: null, error: 'branch_name is required for branch_create', durationMs: 0 };
        }
        if (!input.agent_name) {
          return { output: null, error: 'agent_name is required for branch_create', durationMs: 0 };
        }
        // Auto-prefix with agent/<name>/
        const slug = input.branch_name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
        const agentSlug = input.agent_name.replace(/\s+/g, '-').toLowerCase();
        const branchName = `agent/${agentSlug}/${slug}`;

        const res = await git(`checkout -b "${branchName}"`);
        if (res.exitCode !== 0) {
          // If branch already exists, try switching to it
          if (res.stderr.includes('already exists')) {
            const checkout = await git(`checkout "${branchName}"`);
            return {
              output: { branch: branchName, created: false, switched: true, exitCode: checkout.exitCode },
              error: checkout.exitCode !== 0 ? checkout.stderr : undefined,
              durationMs: Math.round(performance.now() - startTime),
            };
          }
          return { output: null, error: res.stderr, durationMs: Math.round(performance.now() - startTime) };
        }
        return {
          output: { branch: branchName, created: true, exitCode: 0 },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'checkout': {
        if (!input.branch_name) {
          return { output: null, error: 'branch_name is required for checkout', durationMs: 0 };
        }
        // Allow checking out agent/* branches or main (read-only view)
        const branch = input.branch_name;
        if (!branch.startsWith('agent/') && !['main', 'master'].includes(branch)) {
          return { output: null, error: 'Can only checkout agent/* branches or main/master', durationMs: 0 };
        }
        const res = await git(`checkout "${branch}"`);
        return {
          output: { branch, exitCode: res.exitCode },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'add': {
        if (!input.paths || input.paths.length === 0) {
          return { output: null, error: 'paths array is required for add', durationMs: 0 };
        }
        // Block sensitive files
        const blockedPaths = input.paths.filter(isBlockedFile);
        if (blockedPaths.length > 0) {
          return {
            output: null,
            error: `Blocked: cannot stage sensitive files: ${blockedPaths.join(', ')}`,
            durationMs: Math.round(performance.now() - startTime),
          };
        }
        const pathArgs = input.paths.map((p) => `"${p}"`).join(' ');
        const res = await git(`add -- ${pathArgs}`);
        return {
          output: { added: input.paths, exitCode: res.exitCode },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'commit': {
        if (!input.message) {
          return { output: null, error: 'message is required for commit', durationMs: 0 };
        }
        if (!input.agent_name) {
          return { output: null, error: 'agent_name is required for commit', durationMs: 0 };
        }

        // Verify we're on an agent/* branch
        const branchRes = await git('rev-parse --abbrev-ref HEAD');
        const currentBranch = branchRes.stdout.trim();
        if (!currentBranch.startsWith('agent/')) {
          return {
            output: null,
            error: `Cannot commit: must be on an agent/* branch (currently on '${currentBranch}')`,
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        // Auto-append agent attribution to commit message
        const agentEmail = `${input.agent_name.replace(/\s+/g, '').toLowerCase()}@forge.local`;
        const fullMessage = `${input.message}\n\n[Agent: ${input.agent_name} | Execution: ${input.agent_id ?? 'unknown'}]`;

        const res = await git(
          `-c user.name="${input.agent_name}" -c user.email="${agentEmail}" commit -m "${fullMessage.replace(/"/g, '\\"')}"`,
        );

        if (res.exitCode !== 0 && res.stderr.includes('lock')) {
          // Git lock error — retry once after 2s
          await new Promise((r) => setTimeout(r, 2000));
          const retry = await git(
            `-c user.name="${input.agent_name}" -c user.email="${agentEmail}" commit -m "${fullMessage.replace(/"/g, '\\"')}"`,
          );
          return {
            output: { committed: retry.exitCode === 0, branch: currentBranch, retried: true, stdout: retry.stdout },
            error: retry.exitCode !== 0 ? retry.stderr : undefined,
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        return {
          output: { committed: res.exitCode === 0, branch: currentBranch, stdout: res.stdout },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'merge_to_main': {
        if (!input.agent_name) {
          return { output: null, error: 'agent_name is required for merge_to_main', durationMs: 0 };
        }

        // Get current branch
        const branchRes = await git('rev-parse --abbrev-ref HEAD');
        const currentBranch = branchRes.stdout.trim();
        if (!currentBranch.startsWith('agent/')) {
          return {
            output: null,
            error: `Cannot merge: must be on an agent/* branch (currently on '${currentBranch}')`,
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        // Get diff summary for the intervention description
        const diffStat = await git(`diff main..${currentBranch} --stat`);
        const logSummary = await git(`log main..${currentBranch} --oneline`);

        // Create intervention request — never merge directly
        const p = getPool();
        const id = generateId();
        await p.query(
          `INSERT INTO agent_interventions (id, agent_id, agent_name, agent_type, type, title, description, context, proposed_action, status)
           VALUES ($1, $2, $3, 'dev', 'approval', $4, $5, $6, $7, 'pending')`,
          [
            id,
            input.agent_id ?? 'unknown',
            input.agent_name,
            `Merge branch: ${currentBranch} → main`,
            `Agent ${input.agent_name} requests merging branch '${currentBranch}' into main.`,
            JSON.stringify({
              branch: currentBranch,
              diff_stat: diffStat.stdout.slice(0, 2000),
              commits: logSummary.stdout.slice(0, 1000),
            }),
            `git checkout main && git merge ${currentBranch}`,
          ],
        );

        return {
          output: {
            approved: false,
            intervention_id: id,
            branch: currentBranch,
            message: 'Merge request created. Awaiting human approval via intervention.',
            diff_stat: diffStat.stdout.slice(0, 2000),
            commits: logSummary.stdout.slice(0, 1000),
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: status, diff, log, branch_list, branch_create, checkout, add, commit, merge_to_main`,
          durationMs: Math.round(performance.now() - startTime),
        };
    }
  } catch (err) {
    return {
      output: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startTime),
    };
  }
}
