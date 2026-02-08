/**
 * Built-in Tool: File Operations
 * Read, write, list, and check existence of files.
 * Restricted to the workspace root directory.
 */

import { readFile, writeFile, readdir, stat, access, mkdir } from 'fs/promises';
import { resolve } from 'path';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface FileOpsInput {
  operation: 'read' | 'write' | 'list' | 'exists';
  path: string;
  content?: string | undefined;
}

// ============================================
// Implementation
// ============================================

const MAX_READ_SIZE = 512_000; // 512KB
const WORKSPACE_ROOT = process.env['WORKSPACE_ROOT'] ?? '/app';

/**
 * Resolve a path safely within the workspace root.
 * Prevents path traversal attacks.
 */
function safePath(inputPath: string): string {
  const resolved = resolve(WORKSPACE_ROOT, inputPath);
  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    throw new Error(`Path traversal blocked: ${inputPath}`);
  }
  return resolved;
}

/**
 * Perform file operations (read, write, list, exists).
 *
 * - All paths are resolved relative to WORKSPACE_ROOT (/app by default)
 * - Path traversal is blocked
 * - Read operations truncate output to 512KB
 */
export async function fileOps(input: FileOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.operation) {
      case 'read': {
        const filePath = safePath(input.path);
        const content = await readFile(filePath, 'utf-8');
        return {
          output: {
            path: filePath,
            content:
              content.length > MAX_READ_SIZE
                ? content.slice(0, MAX_READ_SIZE) + '\n... [truncated]'
                : content,
            size: content.length,
            truncated: content.length > MAX_READ_SIZE,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'write': {
        if (input.content === undefined) {
          return {
            output: null,
            error: 'Content is required for write operation',
            durationMs: Math.round(performance.now() - startTime),
          };
        }
        const filePath = safePath(input.path);
        // Ensure parent directory exists
        const parentDir = resolve(filePath, '..');
        await mkdir(parentDir, { recursive: true });
        await writeFile(filePath, input.content, 'utf-8');
        return {
          output: {
            path: filePath,
            written: input.content.length,
            success: true,
          },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'list': {
        const dirPath = safePath(input.path);
        const entries = await readdir(dirPath, { withFileTypes: true });
        const items = entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
        }));
        return {
          output: { path: dirPath, entries: items, count: items.length },
          durationMs: Math.round(performance.now() - startTime),
        };
      }

      case 'exists': {
        const checkPath = safePath(input.path);
        try {
          await access(checkPath);
          const stats = await stat(checkPath);
          return {
            output: {
              path: checkPath,
              exists: true,
              isFile: stats.isFile(),
              isDirectory: stats.isDirectory(),
              size: stats.size,
            },
            durationMs: Math.round(performance.now() - startTime),
          };
        } catch {
          return {
            output: { path: checkPath, exists: false },
            durationMs: Math.round(performance.now() - startTime),
          };
        }
      }

      default:
        return {
          output: null,
          error: `Unknown operation: ${input.operation}. Supported: read, write, list, exists`,
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
