/**
 * Built-in Tool: Git Operations
 * Provides git access for agents to create branches, write code, and commit.
 * All work happens on `agent/*` branches — merging to main requires human approval.
 */

import { execFile } from 'child_process';
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
const WORKTREE_BASE = `${REPO_ROOT}/.worktrees`;
const EXEC_TIMEOUT_MS = 30_000;
const MAX_OUTPUT = 8_000;
const MAX_DIFF_OUTPUT = 4_000;

const BLOCKED_BRANCHES = ['main', 'master', 'production'];
const BLOCKED_FILE_PATTERNS = ['.env', '.key', '.pem', 'credentials', 'secret'];

// Track active worktrees per branch so subsequent operations (add, commit) target the right path
const activeWorktrees = new Map<string, string>();

// ============================================
// Helpers
// ============================================

function git(args: string[], timeout = EXEC_TIMEOUT_MS): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', REPO_ROOT, ...args],
      { timeout, maxBuffer: 1_024_000, env: { ...process.env, HOME: '/tmp', GIT_TERMINAL_PROMPT: '0' }, shell: false },
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

/** Run git in a specific worktree directory (falls back to REPO_ROOT) */
function gitIn(worktreePath: string, args: string[], timeout = EXEC_TIMEOUT_MS): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', worktreePath, ...args],
      { timeout, maxBuffer: 1_024_000, env: { ...process.env, HOME: '/tmp', GIT_TERMINAL_PROMPT: '0' }, shell: false },
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

/** Resolve the worktree path for the current agent, if one exists */
function resolveWorkdir(): string {
  // Check execution context for a known worktree
  // API-mode agents create worktrees via branch_create, so look up by current invocation
  return REPO_ROOT;
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
        const res = await git(['status', '--porcelain', '-b']);
        return {
          output: { branch: res.stdout.split('\n')[0]?.replace('## ', ''), status: res.stdout, exitCode: res.exitCode },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'diff': {
        const args: string[] = ['diff'];
        if (input.cached) args.push('--cached');
        if (input.file_path) args.push('--', input.file_path);
        const res = await git(args);
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
        const res = await git(['log', '--oneline', '-n', String(count)]);
        return {
          output: { log: res.stdout, exitCode: res.exitCode },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'branch_list': {
        const res = await git(['branch', '-a']);
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
        const worktreePath = `${WORKTREE_BASE}/${agentSlug}-${slug}`;

        // Use git worktree for isolation — doesn't touch main's working tree
        const res = await git(['worktree', 'add', worktreePath, '-b', branchName, 'main']);
        if (res.exitCode !== 0) {
          // If branch already exists, try attaching worktree to existing branch
          if (res.stderr.includes('already exists')) {
            const retry = await git(['worktree', 'add', worktreePath, branchName]);
            if (retry.exitCode === 0) {
              activeWorktrees.set(branchName, worktreePath);
              return {
                output: { branch: branchName, worktree: worktreePath, created: false, switched: true, exitCode: 0 },
                durationMs: Math.round(performance.now() - startTime),
              };
            }
            // Worktree may already exist too — just register it
            if (retry.stderr.includes('already checked out')) {
              activeWorktrees.set(branchName, worktreePath);
              return {
                output: { branch: branchName, worktree: worktreePath, created: false, switched: true, exitCode: 0 },
                durationMs: Math.round(performance.now() - startTime),
              };
            }
            return { output: null, error: retry.stderr, durationMs: Math.round(performance.now() - startTime) };
          }
          return { output: null, error: res.stderr, durationMs: Math.round(performance.now() - startTime) };
        }
        activeWorktrees.set(branchName, worktreePath);
        return {
          output: { branch: branchName, worktree: worktreePath, created: true, exitCode: 0 },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'checkout': {
        if (!input.branch_name) {
          return { output: null, error: 'branch_name is required for checkout', durationMs: 0 };
        }
        const branch = input.branch_name;
        if (!branch.startsWith('agent/') && !['main', 'master'].includes(branch)) {
          return { output: null, error: 'Can only checkout agent/* branches or main/master', durationMs: 0 };
        }
        // With worktrees, checkout is a no-op — each branch has its own worktree
        const wt = activeWorktrees.get(branch);
        if (wt) {
          return {
            output: { branch, worktree: wt, exitCode: 0, message: 'Worktree already active — no checkout needed' },
            durationMs: Math.round(performance.now() - startTime),
          };
        }
        // Fallback: traditional checkout for branches without worktrees (e.g. main read-only view)
        const res = await git(['checkout', branch]);
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
        // Use worktree path if available (resolve from current branch)
        const addBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
        const addWorkdir = activeWorktrees.get(addBranch.stdout.trim()) ?? REPO_ROOT;
        const res = await gitIn(addWorkdir, ['add', '--', ...input.paths]);
        return {
          output: { added: input.paths, worktree: addWorkdir, exitCode: res.exitCode },
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

        // Resolve worktree for the current branch
        const branchRes = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
        const currentBranch = branchRes.stdout.trim();
        const commitWorkdir = activeWorktrees.get(currentBranch);

        // If we have a worktree, use it; otherwise check we're on an agent/* branch in main repo
        const commitDir = commitWorkdir ?? REPO_ROOT;
        if (!commitWorkdir) {
          // Fallback: verify branch in main repo
          if (!currentBranch.startsWith('agent/')) {
            return {
              output: null,
              error: `Cannot commit: must be on an agent/* branch (currently on '${currentBranch}')`,
              durationMs: Math.round(performance.now() - startTime),
            };
          }
        }

        // Verify branch in worktree is agent/*
        if (commitWorkdir) {
          const wtBranch = await gitIn(commitWorkdir, ['rev-parse', '--abbrev-ref', 'HEAD']);
          if (!wtBranch.stdout.trim().startsWith('agent/')) {
            return {
              output: null,
              error: `Cannot commit: worktree branch is '${wtBranch.stdout.trim()}', expected agent/*`,
              durationMs: Math.round(performance.now() - startTime),
            };
          }
        }

        // Auto-append agent attribution to commit message
        const agentEmail = `${input.agent_name.replace(/\s+/g, '').toLowerCase()}@forge.local`;
        const fullMessage = `${input.message}\n\n[Agent: ${input.agent_name} | Execution: ${input.agent_id ?? 'unknown'}]`;

        const res = await gitIn(
          commitDir,
          ['-c', `user.name=${input.agent_name}`, `-c`, `user.email=${agentEmail}`, 'commit', '-m', fullMessage],
        );

        if (res.exitCode !== 0 && res.stderr.includes('lock')) {
          // Git lock error — retry once after 2s
          await new Promise((r) => setTimeout(r, 2000));
          const retry = await gitIn(
            commitDir,
            ['-c', `user.name=${input.agent_name}`, `-c`, `user.email=${agentEmail}`, 'commit', '-m', fullMessage],
          );
          return {
            output: { committed: retry.exitCode === 0, branch: currentBranch, worktree: commitDir, retried: true, stdout: retry.stdout },
            error: retry.exitCode !== 0 ? retry.stderr : undefined,
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        return {
          output: { committed: res.exitCode === 0, branch: currentBranch, worktree: commitDir, stdout: res.stdout },
          error: res.exitCode !== 0 ? res.stderr : undefined,
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'merge_to_main': {
        if (!input.agent_name) {
          return { output: null, error: 'agent_name is required for merge_to_main', durationMs: 0 };
        }

        // Resolve branch — check worktree first, then main repo HEAD
        let currentBranch: string;
        if (input.branch_name && activeWorktrees.has(input.branch_name)) {
          currentBranch = input.branch_name;
        } else {
          const branchRes = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
          currentBranch = branchRes.stdout.trim();
        }
        if (!currentBranch.startsWith('agent/')) {
          return {
            output: null,
            error: `Cannot merge: must be on an agent/* branch (currently on '${currentBranch}')`,
            durationMs: Math.round(performance.now() - startTime),
          };
        }

        // Get diff summary for the intervention description (always from main repo)
        const diffStat = await git(['diff', `main..${currentBranch}`, '--stat']);
        const logSummary = await git(['log', `main..${currentBranch}`, '--oneline']);

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
