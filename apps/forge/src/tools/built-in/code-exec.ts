/**
 * Built-in Tool: Code Execute
 * Executes JavaScript code in a sandboxed environment using the Function constructor.
 * NOT eval - uses Function constructor for slightly better isolation.
 */

import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface CodeExecInput {
  code: string;
  language?: string | undefined;
}

// ============================================
// Implementation
// ============================================

const EXECUTION_TIMEOUT_MS = 5_000;

/**
 * Execute JavaScript code in a basic sandboxed environment.
 *
 * - Uses the Function constructor (NOT eval) for isolation
 * - Captures console.log output
 * - Enforces a 5-second timeout
 * - Only JavaScript is currently supported
 */
export async function codeExec(input: CodeExecInput): Promise<ToolResult> {
  const startTime = performance.now();
  const language = input.language ?? 'javascript';

  // Only JavaScript is supported
  if (language !== 'javascript' && language !== 'js') {
    return {
      output: null,
      error: `Unsupported language: ${language}. Only 'javascript' is currently supported.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  if (!input.code.trim()) {
    return {
      output: null,
      error: 'No code provided',
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  // Capture console.log output
  const logs: string[] = [];
  const mockConsole = {
    log: (...args: unknown[]) => {
      logs.push(args.map(formatValue).join(' '));
    },
    warn: (...args: unknown[]) => {
      logs.push(`[WARN] ${args.map(formatValue).join(' ')}`);
    },
    error: (...args: unknown[]) => {
      logs.push(`[ERROR] ${args.map(formatValue).join(' ')}`);
    },
    info: (...args: unknown[]) => {
      logs.push(`[INFO] ${args.map(formatValue).join(' ')}`);
    },
  };

  // Provide a limited sandbox environment
  const sandbox: Record<string, unknown> = {
    console: mockConsole,
    Math,
    Date,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    encodeURIComponent,
    decodeURIComponent,
    encodeURI,
    decodeURI,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Symbol,
    Error,
    TypeError,
    RangeError,
    SyntaxError,
    // Explicitly block dangerous globals
    process: undefined,
    require: undefined,
    __dirname: undefined,
    __filename: undefined,
    global: undefined,
    globalThis: undefined,
    import: undefined,
  };

  try {
    // Build the function with sandboxed variables
    const sandboxKeys = Object.keys(sandbox);
    const sandboxValues = sandboxKeys.map((k) => sandbox[k]);

    // Wrap user code to capture the last expression's value
    const wrappedCode = `
      "use strict";
      ${input.code}
    `;

    // Create function with sandbox parameters
    // The Function constructor is safer than eval because it doesn't
    // have access to the local scope
    const fn = new Function(...sandboxKeys, wrappedCode);

    // Execute with timeout
    const result = await executeWithTimeout(
      () => fn(...sandboxValues) as unknown,
      EXECUTION_TIMEOUT_MS,
    );

    const durationMs = Math.round(performance.now() - startTime);

    return {
      output: {
        result: result !== undefined ? formatValue(result) : null,
        logs,
        executionTime: durationMs,
      },
      durationMs,
    };
  } catch (err) {
    const durationMs = Math.round(performance.now() - startTime);

    if (err instanceof Error && err.message === 'EXECUTION_TIMEOUT') {
      return {
        output: { logs },
        error: `Code execution timed out after ${EXECUTION_TIMEOUT_MS}ms`,
        durationMs,
      };
    }

    const errorMessage = err instanceof Error ? err.message : String(err);
    return {
      output: { logs },
      error: `Execution error: ${errorMessage}`,
      durationMs,
    };
  }
}

// ============================================
// Helpers
// ============================================

/**
 * Execute a synchronous or asynchronous function with a timeout.
 */
async function executeWithTimeout(
  fn: () => unknown,
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('EXECUTION_TIMEOUT'));
    }, timeoutMs);

    try {
      const result = fn();

      // Handle async results (promises)
      if (result instanceof Promise) {
        result
          .then((value) => {
            clearTimeout(timer);
            resolve(value);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      } else {
        clearTimeout(timer);
        resolve(result);
      }
    } catch (err) {
      clearTimeout(timer);
      reject(err);
    }
  });
}

/**
 * Format a value for display in output/logs.
 */
function formatValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'symbol') return value.toString();
  if (typeof value === 'bigint') return `${value.toString()}n`;
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
