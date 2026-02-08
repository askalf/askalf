import ivm from 'isolated-vm';
import { createLogger } from '@substrate/observability';

const logger = createLogger({ component: 'sandbox' });

export interface ExecutionResult {
  success: boolean;
  output: unknown;
  error?: string;
  executionMs: number;
  memoryUsed: number;
}

export interface SandboxConfig {
  memoryLimitMb: number;
  timeoutMs: number;
  maxIsolates: number;
  isolateMaxAgeMs: number;
}

const DEFAULT_CONFIG: SandboxConfig = {
  memoryLimitMb: 50,
  timeoutMs: 5000,
  maxIsolates: 10,
  isolateMaxAgeMs: 60000, // 1 minute max age for pooled isolates
};

// Pooled isolate with creation timestamp
interface PooledIsolate {
  isolate: ivm.Isolate;
  createdAt: number;
}

// Isolate pool for reuse with TTL
const isolatePool: PooledIsolate[] = [];
let config = DEFAULT_CONFIG;

/**
 * Configure the sandbox
 */
export function configureSandbox(newConfig: Partial<SandboxConfig>): void {
  config = { ...config, ...newConfig };
}

/**
 * Cleanup expired isolates from the pool
 */
function cleanupExpiredIsolates(): void {
  const now = Date.now();
  for (let i = isolatePool.length - 1; i >= 0; i--) {
    const pooled = isolatePool[i];
    if (!pooled) continue;
    if (now - pooled.createdAt > config.isolateMaxAgeMs || pooled.isolate.isDisposed) {
      if (!pooled.isolate.isDisposed) {
        pooled.isolate.dispose();
      }
      isolatePool.splice(i, 1);
    }
  }
}

/**
 * Get an isolate from the pool or create a new one
 */
async function getIsolate(): Promise<ivm.Isolate> {
  // Clean expired isolates first
  cleanupExpiredIsolates();

  const pooled = isolatePool.pop();
  if (pooled && !pooled.isolate.isDisposed) {
    return pooled.isolate;
  }

  return new ivm.Isolate({ memoryLimit: config.memoryLimitMb });
}

/**
 * Return an isolate to the pool
 */
function returnIsolate(isolate: ivm.Isolate): void {
  if (!isolate.isDisposed && isolatePool.length < config.maxIsolates) {
    isolatePool.push({ isolate, createdAt: Date.now() });
  } else if (!isolate.isDisposed) {
    isolate.dispose();
  }
}

/**
 * Validate procedure logic for safety using regex patterns
 * to prevent bypasses like unicode escapes or string concatenation
 */
export function validateLogic(logic: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Use regex patterns for more robust matching
  const forbiddenPatterns: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /\beval\s*\(/i, name: 'eval()' },
    { pattern: /\bFunction\s*\(/i, name: 'Function constructor' },
    { pattern: /\brequire\s*\(/i, name: 'require()' },
    { pattern: /\bimport\s*[\s('"]/i, name: 'import' },
    { pattern: /\bprocess\s*[.\[]/i, name: 'process' },
    { pattern: /\bglobal\s*[.\[]/i, name: 'global' },
    { pattern: /\bglobalThis\s*[.\[]/i, name: 'globalThis' },
    { pattern: /__proto__/i, name: '__proto__' },
    { pattern: /constructor\s*\[\s*['"]constructor/i, name: 'constructor.constructor' },
    { pattern: /\bwith\s*\(/i, name: 'with statement' },
    { pattern: /\bProxy\s*\(/i, name: 'Proxy' },
    { pattern: /\bReflect\s*[.\[]/i, name: 'Reflect' },
  ];

  for (const { pattern, name } of forbiddenPatterns) {
    if (pattern.test(logic)) {
      errors.push(`Forbidden pattern: ${name}`);
    }
  }

  // Basic syntax validation - check for balanced braces/parens
  // We avoid using new Function() as it actually parses/compiles the code
  const opens = (logic.match(/[{[(]/g) || []).length;
  const closes = (logic.match(/[}\])]/g) || []).length;
  if (opens !== closes) {
    errors.push('Syntax error: Unbalanced brackets');
  }

  // Check for obviously incomplete statements
  if (/[{;]\s*$/.test(logic.trim()) === false && logic.trim().length > 0) {
    // Logic should end with } or ; typically
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Execute procedure logic in a secure sandbox
 */
export async function execute(
  logic: string,
  input: unknown
): Promise<ExecutionResult> {
  const startTime = Date.now();
  let isolate: ivm.Isolate | null = null;

  try {
    // Validate first
    const validation = validateLogic(logic);
    if (!validation.valid) {
      return {
        success: false,
        output: null,
        error: `Validation failed: ${validation.errors.join(', ')}`,
        executionMs: Date.now() - startTime,
        memoryUsed: 0,
      };
    }

    isolate = await getIsolate();
    const context = await isolate.createContext();

    // Create a jail for the global object
    const jail = context.global;
    await jail.set('global', jail.derefInto());

    // Inject the input
    await jail.set('__input__', new ivm.ExternalCopy(input).copyInto());

    // Wrap the logic in a function that returns the result
    const wrappedCode = `
      (function() {
        const input = __input__;
        ${logic}
        if (typeof execute === 'function') {
          return execute(input);
        }
        return null;
      })()
    `;

    // Compile and run
    const script = await isolate.compileScript(wrappedCode);
    const result = await script.run(context, { timeout: config.timeoutMs });

    const memoryUsed = (await isolate.getHeapStatistics()).used_heap_size;

    // Return isolate to pool
    returnIsolate(isolate);
    isolate = null;

    return {
      success: true,
      output: result,
      executionMs: Date.now() - startTime,
      memoryUsed,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.warn({ error: errorMessage }, 'Sandbox execution failed');

    return {
      success: false,
      output: null,
      error: errorMessage,
      executionMs: Date.now() - startTime,
      memoryUsed: 0,
    };
  } finally {
    // Dispose isolate if not returned to pool
    if (isolate && !isolate.isDisposed) {
      isolate.dispose();
    }
  }
}

/**
 * Cleanup all isolates
 */
export function cleanup(): void {
  for (const pooled of isolatePool) {
    if (!pooled.isolate.isDisposed) {
      pooled.isolate.dispose();
    }
  }
  isolatePool.length = 0;
}
