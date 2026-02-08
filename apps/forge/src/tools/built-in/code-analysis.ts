/**
 * Built-in Tool: Code Analysis
 * Read-only analysis capabilities: typecheck, dead code detection,
 * import analysis, complexity metrics, TODO scanning.
 */

import { exec } from 'child_process';
import { readdir, readFile } from 'fs/promises';
import { join, extname, relative } from 'path';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface CodeAnalysisInput {
  action: 'typecheck' | 'dead_code' | 'import_analysis' | 'complexity' | 'todo_scan';
  package_dir?: string;
  file_path?: string;
  scan_path?: string;
}

// ============================================
// Constants
// ============================================

const REPO_ROOT = process.env['REPO_ROOT'] ?? '/workspace';
const EXEC_TIMEOUT_MS = 120_000; // Typechecking can take a while
const MAX_OUTPUT = 8_000;

const CODE_EXTENSIONS = new Set(['.ts', '.js', '.tsx', '.jsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', 'coverage']);

// ============================================
// Helpers
// ============================================

function run(cmd: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, { cwd, timeout: EXEC_TIMEOUT_MS, maxBuffer: 2_048_000 }, (error, stdout, stderr) => {
      resolve({
        exitCode: error ? (error.code ?? 1) : 0,
        stdout: stdout.slice(0, MAX_OUTPUT),
        stderr: stderr.slice(0, MAX_OUTPUT),
      });
    });
  });
}

async function walkCodeFiles(dir: string, maxFiles = 500): Promise<string[]> {
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
      } else if (CODE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

// ============================================
// Implementation
// ============================================

export async function codeAnalysis(input: CodeAnalysisInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'typecheck': {
        const pkgDir = input.package_dir ? join(REPO_ROOT, input.package_dir) : REPO_ROOT;
        const res = await run('npx tsc --noEmit --pretty 2>&1 || true', pkgDir);

        // Parse TypeScript errors
        const errorLines = res.stdout.split('\n').filter((l) => l.includes('error TS'));
        const errorCount = errorLines.length;

        return {
          output: {
            action: 'typecheck',
            package_dir: pkgDir,
            errorCount,
            errors: errorLines.slice(0, 30), // Cap at 30 errors
            fullOutput: res.stdout,
            exitCode: res.exitCode,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'dead_code': {
        const scanPath = input.scan_path ? join(REPO_ROOT, input.scan_path) : REPO_ROOT;
        const files = await walkCodeFiles(scanPath);

        // Collect all exported symbols
        const exports: Array<{ file: string; symbol: string; line: number }> = [];
        // Collect all import references
        const importRefs = new Set<string>();

        for (const file of files) {
          try {
            const content = await readFile(file, 'utf-8');
            const lines = content.split('\n');
            const relPath = relative(REPO_ROOT, file);

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]!;
              // Find exports
              const exportMatch = line.match(/export\s+(?:async\s+)?(?:function|const|let|var|class|interface|type|enum)\s+(\w+)/);
              if (exportMatch?.[1]) {
                exports.push({ file: relPath, symbol: exportMatch[1], line: i + 1 });
              }

              // Find imports
              const importMatch = line.match(/import\s+(?:\{([^}]+)\}|(\w+))\s+from/);
              if (importMatch) {
                const symbols = (importMatch[1] ?? importMatch[2] ?? '').split(',').map((s) => s.trim().split(' as ')[0]!.trim());
                for (const sym of symbols) {
                  if (sym) importRefs.add(sym);
                }
              }
            }
          } catch { /* skip */ }
        }

        // Dead exports = exported but never imported
        const deadExports = exports.filter((e) => !importRefs.has(e.symbol));

        return {
          output: {
            action: 'dead_code',
            scan_path: scanPath,
            totalExports: exports.length,
            deadExports: deadExports.slice(0, 50),
            deadCount: deadExports.length,
            filesScanned: files.length,
            note: 'Dead code detection is heuristic — some exports may be used dynamically or as entry points.',
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'import_analysis': {
        if (!input.file_path) {
          return { output: null, error: 'file_path is required for import_analysis', durationMs: 0 };
        }

        const targetFile = join(REPO_ROOT, input.file_path);
        const targetRelPath = relative(REPO_ROOT, targetFile);

        let content: string;
        try {
          content = await readFile(targetFile, 'utf-8');
        } catch {
          return { output: null, error: `Cannot read file: ${input.file_path}`, durationMs: Math.round(performance.now() - startTime) };
        }

        // What this file imports
        const imports: Array<{ module: string; symbols: string[] }> = [];
        const importRegex = /import\s+(?:\{([^}]+)\}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          const symbols = match[1]
            ? match[1].split(',').map((s) => s.trim())
            : [match[2] ?? match[3] ?? 'default'];
          imports.push({ module: match[4]!, symbols });
        }

        // What imports this file (search across codebase)
        const scanPath = input.scan_path ? join(REPO_ROOT, input.scan_path) : REPO_ROOT;
        const allFiles = await walkCodeFiles(scanPath, 300);
        const importedBy: Array<{ file: string; symbols: string[] }> = [];

        // Build possible import paths for this file
        const baseName = targetRelPath.replace(/\.(ts|js|tsx|jsx)$/, '');
        const possiblePaths = [
          baseName,
          `./${baseName}`,
          `../${baseName.split('/').pop()}`,
          baseName.replace(/\/index$/, ''),
        ];

        for (const file of allFiles) {
          if (file === targetFile) continue;
          try {
            const fileContent = await readFile(file, 'utf-8');
            for (const possiblePath of possiblePaths) {
              if (fileContent.includes(possiblePath)) {
                const relFile = relative(REPO_ROOT, file);
                const fileImportRegex = new RegExp(`import\\s+(?:\\{([^}]+)\\}|([\\w]+))\\s+from\\s+['"][^'"]*${possiblePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^'"]*['"]`);
                const fileMatch = fileImportRegex.exec(fileContent);
                const symbols = fileMatch?.[1]
                  ? fileMatch[1].split(',').map((s) => s.trim())
                  : fileMatch?.[2] ? [fileMatch[2]] : ['*'];
                importedBy.push({ file: relFile, symbols });
                break;
              }
            }
          } catch { /* skip */ }
        }

        return {
          output: {
            action: 'import_analysis',
            file: targetRelPath,
            imports,
            importedBy,
            importCount: imports.length,
            importedByCount: importedBy.length,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'complexity': {
        const scanPath = input.scan_path
          ? join(REPO_ROOT, input.scan_path)
          : input.file_path
            ? join(REPO_ROOT, input.file_path)
            : REPO_ROOT;

        const files = input.file_path ? [join(REPO_ROOT, input.file_path)] : await walkCodeFiles(scanPath, 200);
        const results: Array<{ file: string; functions: Array<{ name: string; line: number; length: number; maxDepth: number; branches: number }> }> = [];

        for (const file of files) {
          try {
            const content = await readFile(file, 'utf-8');
            const lines = content.split('\n');
            const relPath = relative(REPO_ROOT, file);

            const functions: Array<{ name: string; line: number; length: number; maxDepth: number; branches: number }> = [];
            let currentFunc: { name: string; line: number; startLine: number; depth: number; maxDepth: number; branches: number; braceCount: number } | null = null;

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]!;

              // Detect function starts
              const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/);
              if (funcMatch && !currentFunc) {
                currentFunc = {
                  name: funcMatch[1] ?? funcMatch[2] ?? 'anonymous',
                  line: i + 1,
                  startLine: i,
                  depth: 0,
                  maxDepth: 0,
                  branches: 0,
                  braceCount: 0,
                };
              }

              if (currentFunc) {
                // Track brace depth
                for (const ch of line) {
                  if (ch === '{') {
                    currentFunc.braceCount++;
                    currentFunc.depth++;
                    if (currentFunc.depth > currentFunc.maxDepth) currentFunc.maxDepth = currentFunc.depth;
                  } else if (ch === '}') {
                    currentFunc.braceCount--;
                    currentFunc.depth--;
                  }
                }

                // Count branch points
                if (/\b(if|else if|switch|case|\?\?|&&|\|\||catch)\b/.test(line)) {
                  currentFunc.branches++;
                }

                // Function ended
                if (currentFunc.braceCount <= 0 && i > currentFunc.startLine) {
                  const length = i - currentFunc.startLine + 1;
                  if (length > 20 || currentFunc.maxDepth > 4 || currentFunc.branches > 5) {
                    functions.push({
                      name: currentFunc.name,
                      line: currentFunc.line,
                      length,
                      maxDepth: currentFunc.maxDepth,
                      branches: currentFunc.branches,
                    });
                  }
                  currentFunc = null;
                }
              }
            }

            if (functions.length > 0) {
              results.push({ file: relPath, functions });
            }
          } catch { /* skip */ }
        }

        // Sort by complexity (length + depth + branches)
        const allFunctions = results.flatMap((r) => r.functions.map((f) => ({ ...f, file: r.file })));
        allFunctions.sort((a, b) => (b.length + b.maxDepth * 5 + b.branches * 3) - (a.length + a.maxDepth * 5 + a.branches * 3));

        return {
          output: {
            action: 'complexity',
            scan_path: scanPath,
            filesScanned: files.length,
            complexFunctions: allFunctions.slice(0, 30),
            totalFlagged: allFunctions.length,
            thresholds: { minLength: 20, maxDepth: 4, maxBranches: 5 },
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'todo_scan': {
        const scanPath = input.scan_path ? join(REPO_ROOT, input.scan_path) : REPO_ROOT;
        const files = await walkCodeFiles(scanPath, 500);
        const todos: Array<{ file: string; line: number; type: string; text: string }> = [];
        const todoPattern = /\b(TODO|FIXME|HACK|XXX|BUG|WARN)\b[:\s]*(.*)/i;

        for (const file of files) {
          try {
            const content = await readFile(file, 'utf-8');
            const lines = content.split('\n');
            const relPath = relative(REPO_ROOT, file);

            for (let i = 0; i < lines.length; i++) {
              const match = todoPattern.exec(lines[i]!);
              if (match) {
                todos.push({
                  file: relPath,
                  line: i + 1,
                  type: match[1]!.toUpperCase(),
                  text: match[2]!.trim().slice(0, 200),
                });
              }
            }
          } catch { /* skip */ }
        }

        // Group by type
        const byType: Record<string, number> = {};
        for (const todo of todos) {
          byType[todo.type] = (byType[todo.type] ?? 0) + 1;
        }

        return {
          output: {
            action: 'todo_scan',
            scan_path: scanPath,
            todos: todos.slice(0, 50),
            totalCount: todos.length,
            byType,
            filesScanned: files.length,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: typecheck, dead_code, import_analysis, complexity, todo_scan`,
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
