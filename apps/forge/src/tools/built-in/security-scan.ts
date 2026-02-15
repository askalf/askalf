/**
 * Built-in Tool: Security Scan
 * Provides security analysis capabilities: npm audit, dependency checks,
 * file permission scanning, environment leak detection, Docker security inspection.
 */

import { exec } from 'child_process';
import { readdir, readFile, stat } from 'fs/promises';
import { join, extname } from 'path';
import http from 'node:http';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface SecurityScanInput {
  action: 'npm_audit' | 'dependency_check' | 'file_permissions' | 'env_leak_check' | 'docker_security';
  package_dir?: string;
  scan_path?: string;
  container?: string;
}

// ============================================
// Constants
// ============================================

const REPO_ROOT = process.env['REPO_ROOT'] ?? '/workspace';
const EXEC_TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 8_000;

const SECRET_PATTERNS = [
  /(?:api[_-]?key|secret|password|token|passwd|pwd)\s*[:=]\s*['"][^'"]{8,}/gi,
  /(?:sk-|pk_|rk_)[a-zA-Z0-9]{20,}/g,
  /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g,
  /(?:ghp_|gho_|ghs_|ghr_)[a-zA-Z0-9]{30,}/g,
  /xox[bpoa]-[a-zA-Z0-9-]+/g,
];

const SCAN_EXTENSIONS = new Set(['.ts', '.js', '.json', '.yml', '.yaml', '.env', '.sh', '.conf']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage']);

const DOCKER_SOCKET = '/var/run/docker.sock';

// ============================================
// Helpers
// ============================================

function run(cmd: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: 1_024_000 }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? (error.code ?? 1) : 0,
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
      });
    });
  });
}

async function walkFiles(dir: string, extensions: Set<string>, maxFiles = 500): Promise<string[]> {
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    if (results.length >= maxFiles) return;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= maxFiles) break;
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(fullPath);
      } else if (extensions.has(extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

function dockerRequest(
  method: string,
  path: string,
): Promise<{ statusCode: number; data: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Docker API request timed out')), 15_000);
    const req = http.request({ socketPath: DOCKER_SOCKET, path, method, headers: { 'Content-Type': 'application/json' } }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => { clearTimeout(timer); resolve({ statusCode: res.statusCode ?? 500, data: data.slice(0, 512_000) }); });
    });
    req.on('error', (err) => { clearTimeout(timer); reject(err); });
    req.end();
  });
}

// ============================================
// Implementation
// ============================================

export async function securityScan(input: SecurityScanInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'npm_audit': {
        const pkgDir = input.package_dir ? join(REPO_ROOT, input.package_dir) : REPO_ROOT;
        const res = await run('npm audit --json 2>/dev/null || true', pkgDir);

        let summary: Record<string, unknown> = { raw: res.stdout };
        try {
          const audit = JSON.parse(res.stdout) as Record<string, unknown>;
          const metadata = audit['metadata'] as Record<string, unknown> | undefined;
          summary = {
            vulnerabilities: audit['vulnerabilities'] ? Object.keys(audit['vulnerabilities'] as object).length : 0,
            totalDependencies: metadata?.['totalDependencies'] ?? 'unknown',
            severities: metadata?.['vulnerabilities'] ?? {},
          };
        } catch { /* use raw output */ }

        return {
          output: { action: 'npm_audit', package_dir: pkgDir, summary },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'dependency_check': {
        const pkgDir = input.package_dir ? join(REPO_ROOT, input.package_dir) : REPO_ROOT;
        const res = await run('pnpm outdated --json 2>/dev/null || true', pkgDir);

        let outdated: unknown = res.stdout;
        try {
          outdated = JSON.parse(res.stdout);
        } catch { /* use raw */ }

        return {
          output: { action: 'dependency_check', package_dir: pkgDir, outdated },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'file_permissions': {
        const scanPath = input.scan_path ? join(REPO_ROOT, input.scan_path) : REPO_ROOT;
        const issues: Array<{ file: string; mode: string; issue: string }> = [];
        const files = await walkFiles(scanPath, new Set([...SCAN_EXTENSIONS, '.sh', '.bash']), 200);

        for (const file of files) {
          try {
            const stats = await stat(file);
            const mode = (stats.mode & 0o777).toString(8);
            // Check for world-writable
            if (stats.mode & 0o002) {
              issues.push({ file: file.replace(REPO_ROOT, ''), mode, issue: 'world-writable' });
            }
            // Check for setuid/setgid
            if (stats.mode & 0o4000) {
              issues.push({ file: file.replace(REPO_ROOT, ''), mode, issue: 'setuid bit set' });
            }
            if (stats.mode & 0o2000) {
              issues.push({ file: file.replace(REPO_ROOT, ''), mode, issue: 'setgid bit set' });
            }
          } catch { /* skip */ }
        }

        return {
          output: { action: 'file_permissions', scan_path: scanPath, issues, count: issues.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'env_leak_check': {
        const scanPath = input.scan_path ? join(REPO_ROOT, input.scan_path) : REPO_ROOT;
        const findings: Array<{ file: string; line: number; pattern: string; snippet: string }> = [];
        const files = await walkFiles(scanPath, SCAN_EXTENSIONS, 300);

        for (const file of files) {
          // Skip lock files and known config files
          if (file.includes('pnpm-lock') || file.includes('package-lock')) continue;

          try {
            const content = await readFile(file, 'utf-8');
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]!;
              for (const pattern of SECRET_PATTERNS) {
                // Reset regex lastIndex for global patterns
                pattern.lastIndex = 0;
                const match = pattern.exec(line);
                if (match) {
                  // Mask the actual secret value
                  const snippet = line.slice(0, 100).replace(/(['"])[^'"]{8,}(['"])/g, '$1***REDACTED***$2');
                  findings.push({
                    file: file.replace(REPO_ROOT, ''),
                    line: i + 1,
                    pattern: pattern.source.slice(0, 40),
                    snippet,
                  });
                  break; // One finding per line is enough
                }
              }
            }
          } catch { /* skip unreadable files */ }
        }

        return {
          output: {
            action: 'env_leak_check',
            scan_path: scanPath,
            findings: findings.slice(0, 50), // Cap at 50 findings
            total_findings: findings.length,
            files_scanned: files.length,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'docker_security': {
        const res = await dockerRequest('GET', '/v1.44/containers/json?all=true');
        const containers = JSON.parse(res.data) as Array<Record<string, unknown>>;

        const prodContainers = containers.filter((c) => {
          const name = ((c['Names'] as string[]) ?? [])[0]?.replace(/^\//, '') ?? '';
          return name.startsWith('sprayberry-labs-');
        });

        const securityReport: Array<Record<string, unknown>> = [];

        for (const container of prodContainers) {
          const name = ((container['Names'] as string[]) ?? [])[0]?.replace(/^\//, '') ?? '';

          // Optionally filter to specific container
          if (input.container && !name.includes(input.container)) continue;

          const inspectRes = await dockerRequest('GET', `/v1.44/containers/${name}/json`);
          if (inspectRes.statusCode !== 200) continue;

          const info = JSON.parse(inspectRes.data) as Record<string, unknown>;
          const hostConfig = info['HostConfig'] as Record<string, unknown> | undefined;

          securityReport.push({
            name,
            readOnly: hostConfig?.['ReadonlyRootfs'] ?? false,
            privileged: hostConfig?.['Privileged'] ?? false,
            capDrop: hostConfig?.['CapDrop'] ?? [],
            capAdd: hostConfig?.['CapAdd'] ?? [],
            securityOpt: hostConfig?.['SecurityOpt'] ?? [],
            networkMode: hostConfig?.['NetworkMode'],
            pidMode: hostConfig?.['PidMode'] || 'default',
            usernsMode: hostConfig?.['UsernsMode'] || 'default',
            restartPolicy: hostConfig?.['RestartPolicy'],
          });
        }

        return {
          output: { action: 'docker_security', containers: securityReport, count: securityReport.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: npm_audit, dependency_check, file_permissions, env_leak_check, docker_security`,
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
