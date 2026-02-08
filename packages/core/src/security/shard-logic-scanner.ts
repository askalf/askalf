/**
 * SUBSTRATE Security: Shard Logic Scanner
 *
 * Dedicated fast scanner for shard/procedure logic validation.
 * Complements the sandbox validateLogic() with additional security checks.
 * Runs on every logic write operation (24x7 watch).
 */

export interface ShardScanResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  riskLevel: 'safe' | 'low' | 'medium' | 'high' | 'critical';
  shouldBlock: boolean;
  flagForReview: boolean;
}

export interface ShardLogicScannerConfig {
  maxLogicLength: number;
  maxStringLiteralLength: number;
  maxNestedLoops: number;
  strictMode: boolean;
}

const DEFAULT_CONFIG: ShardLogicScannerConfig = {
  maxLogicLength: 10000,
  maxStringLiteralLength: 1000,
  maxNestedLoops: 3,
  strictMode: false,
};

// Fast pre-check tokens - if none present, skip detailed scanning
const TRIGGER_TOKENS = [
  'constructor', 'prototype', '__proto__', 'eval', 'Function',
  'require', 'import', 'process', 'global', 'window', 'document',
  'fetch', 'XMLHttpRequest', 'WebSocket', 'this.', '[].', '()',
  'Proxy', 'Reflect', 'with', 'debugger', 'arguments.callee',
  // 2025-2026 additions
  'Symbol', 'WeakRef', 'FinalizationRegistry', 'SharedArrayBuffer',
  'Atomics', 'structuredClone', 'queueMicrotask', 'reportError',
  'String.raw', 'String.fromCode', 'atob', 'btoa',
  'fromCharCode', 'charCodeAt', 'codePointAt',
  'Intl', 'Temporal', 'navigator', 'location',
  'Worker', 'ServiceWorker', 'importScripts',
];

// Sandbox escape patterns - common JS sandbox bypass techniques
const SANDBOX_ESCAPE_PATTERNS: Array<{ pattern: RegExp; name: string; severity: 'high' | 'critical' }> = [
  // Constructor chain escapes
  { pattern: /\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)\s*\.constructor/i, name: 'Arrow function constructor access', severity: 'critical' },
  { pattern: /\(\s*function\s*\(\s*\)\s*\{\s*\}\s*\)\s*\.constructor/i, name: 'Function constructor access', severity: 'critical' },
  { pattern: /this\.constructor\.constructor/i, name: 'this.constructor.constructor escape', severity: 'critical' },
  { pattern: /\[\s*\]\s*\.filter\.constructor/i, name: 'Array.filter.constructor escape', severity: 'critical' },
  { pattern: /\[\s*\]\s*\.\w+\.constructor/i, name: 'Array method constructor escape', severity: 'critical' },
  { pattern: /\(\s*['"`]\s*['"`]\s*\)\s*\.constructor/i, name: 'String constructor access', severity: 'critical' },
  { pattern: /\.constructor\s*\[\s*['"`]constructor['"`]\s*\]/i, name: 'Bracket notation constructor escape', severity: 'critical' },

  // Property access escapes
  { pattern: /\[\s*['"`]constructor['"`]\s*\]\s*\[\s*['"`]constructor['"`]\s*\]/i, name: 'Chained bracket constructor', severity: 'critical' },
  { pattern: /Object\s*\.\s*getOwnPropertyDescriptor/i, name: 'Property descriptor access', severity: 'high' },
  { pattern: /Object\s*\.\s*defineProperty/i, name: 'Property definition', severity: 'high' },
  { pattern: /Object\s*\.\s*setPrototypeOf/i, name: 'Prototype manipulation', severity: 'critical' },
  { pattern: /Object\s*\.\s*getPrototypeOf/i, name: 'Prototype access', severity: 'high' },

  // Obfuscated eval patterns
  { pattern: /\[\s*['"`]eval['"`]\s*\]/i, name: 'Bracket notation eval', severity: 'critical' },
  { pattern: /window\s*\[\s*['"`]eval['"`]\s*\]/i, name: 'Window eval access', severity: 'critical' },
  { pattern: /globalThis\s*\[\s*['"`]/i, name: 'globalThis bracket access', severity: 'critical' },
  { pattern: /self\s*\[\s*['"`]/i, name: 'self bracket access', severity: 'high' },

  // Template literal code execution
  { pattern: /`\$\{[^}]*constructor[^}]*\}`/i, name: 'Template literal constructor', severity: 'high' },
  { pattern: /String\s*\.\s*fromCharCode\s*\(/i, name: 'String.fromCharCode (potential obfuscation)', severity: 'high' },

  // Prototype pollution
  { pattern: /__proto__\s*=/i, name: 'Proto assignment', severity: 'critical' },
  { pattern: /prototype\s*\[\s*['"`]/i, name: 'Prototype bracket access', severity: 'high' },
  { pattern: /\[\s*['"`]__proto__['"`]\s*\]/i, name: 'Bracket proto access', severity: 'critical' },

  // Async/Promise escapes
  { pattern: /Promise\s*\.\s*constructor/i, name: 'Promise constructor access', severity: 'high' },
  { pattern: /async\s*function\s*\*|function\s*\*\s*async/i, name: 'Async generator', severity: 'high' },

  // Dangerous globals
  { pattern: /\bprocess\s*\./i, name: 'Process access', severity: 'critical' },
  { pattern: /\brequire\s*\(/i, name: 'require() call', severity: 'critical' },
  { pattern: /\bimport\s*\(/i, name: 'Dynamic import', severity: 'critical' },
  { pattern: /\bmodule\s*\./i, name: 'Module access', severity: 'critical' },
  { pattern: /\bBuffer\s*\./i, name: 'Buffer access', severity: 'high' },

  // Code generation
  { pattern: /\beval\s*\(/i, name: 'eval() call', severity: 'critical' },
  { pattern: /\bFunction\s*\(/i, name: 'Function() constructor', severity: 'critical' },
  { pattern: /\bsetTimeout\s*\(\s*['"`]/i, name: 'setTimeout with string', severity: 'high' },
  { pattern: /\bsetInterval\s*\(\s*['"`]/i, name: 'setInterval with string', severity: 'high' },

  // Network/IO
  { pattern: /\bfetch\s*\(/i, name: 'fetch() call', severity: 'high' },
  { pattern: /\bXMLHttpRequest/i, name: 'XMLHttpRequest', severity: 'high' },
  { pattern: /\bWebSocket\s*\(/i, name: 'WebSocket', severity: 'high' },

  // Debugger/arguments
  { pattern: /\bdebugger\b/i, name: 'debugger statement', severity: 'high' },
  { pattern: /arguments\s*\.\s*callee/i, name: 'arguments.callee', severity: 'high' },
  { pattern: /arguments\s*\.\s*caller/i, name: 'arguments.caller', severity: 'high' },

  // =============================================
  // 2025-2026 SANDBOX ESCAPE PATTERNS
  // =============================================

  // Computed property string concatenation obfuscation
  { pattern: /\[\s*['"`][a-z]+['"`]\s*\+\s*['"`][a-z]+['"`]\s*\]/i, name: 'String concatenation property access', severity: 'critical' },
  { pattern: /\[\s*`\$\{[^}]+\}`\s*\]/i, name: 'Template literal property access', severity: 'critical' },
  { pattern: /\[\s*String\s*\.\s*fromCharCode\s*\(/i, name: 'Dynamic property via fromCharCode', severity: 'critical' },
  { pattern: /\[\s*atob\s*\(/i, name: 'Dynamic property via atob', severity: 'critical' },
  { pattern: /\[\s*['"`]\s*['"`]\s*\.\s*concat\s*\(/i, name: 'String.concat property construction', severity: 'critical' },

  // Symbol exploitation
  { pattern: /Symbol\s*\.\s*(toPrimitive|iterator|asyncIterator|hasInstance|species|toStringTag)/i, name: 'Symbol well-known exploitation', severity: 'high' },
  { pattern: /\[Symbol\s*\.\s*\w+\]/i, name: 'Computed Symbol property access', severity: 'high' },

  // Tagged template abuse for code execution
  { pattern: /\w+\s*`[^`]*\$\{/i, name: 'Tagged template literal (potential code execution)', severity: 'high' },
  { pattern: /String\s*\.\s*raw\s*`/i, name: 'String.raw tagged template', severity: 'high' },

  // WeakRef / FinalizationRegistry (can leak GC info, bypass cleanup)
  { pattern: /\bnew\s+WeakRef\s*\(/i, name: 'WeakRef construction', severity: 'high' },
  { pattern: /\bnew\s+FinalizationRegistry\s*\(/i, name: 'FinalizationRegistry construction', severity: 'high' },

  // SharedArrayBuffer / Atomics (timing attacks, shared memory)
  { pattern: /\bSharedArrayBuffer\b/i, name: 'SharedArrayBuffer access', severity: 'critical' },
  { pattern: /\bAtomics\s*\./i, name: 'Atomics access', severity: 'critical' },

  // Proxy/Reflect abuse
  { pattern: /\bnew\s+Proxy\s*\(/i, name: 'Proxy construction', severity: 'critical' },
  { pattern: /\bReflect\s*\.\s*(apply|construct|defineProperty|get|set|ownKeys)/i, name: 'Reflect API usage', severity: 'critical' },

  // with statement (scope manipulation)
  { pattern: /\bwith\s*\(/i, name: 'with statement (scope escape)', severity: 'critical' },

  // Worker threads
  { pattern: /\bnew\s+Worker\s*\(/i, name: 'Worker construction', severity: 'critical' },
  { pattern: /\bimportScripts\s*\(/i, name: 'importScripts call', severity: 'critical' },

  // queueMicrotask / reportError (can escape error boundaries)
  { pattern: /\bqueueMicrotask\s*\(/i, name: 'queueMicrotask call', severity: 'high' },
  { pattern: /\breportError\s*\(/i, name: 'reportError call', severity: 'high' },

  // structuredClone (can bypass object freezing)
  { pattern: /\bstructuredClone\s*\(/i, name: 'structuredClone call', severity: 'high' },

  // Dynamic property access via array methods
  { pattern: /Object\s*\.\s*keys\s*\(.*?\)\s*\.\s*(find|filter|map)\s*\(/i, name: 'Dynamic property enumeration', severity: 'high' },
  { pattern: /Object\s*\.\s*entries\s*\(/i, name: 'Object.entries access', severity: 'high' },

  // Error stack trace exploitation
  { pattern: /new\s+Error\s*\(\s*\)\s*\.\s*stack/i, name: 'Error stack trace access', severity: 'high' },
  { pattern: /Error\s*\.\s*stackTraceLimit/i, name: 'Error.stackTraceLimit manipulation', severity: 'high' },

  // Intl / Temporal (can be used for environment fingerprinting)
  { pattern: /\bnavigator\s*\./i, name: 'navigator access', severity: 'critical' },
  { pattern: /\blocation\s*\./i, name: 'location access', severity: 'critical' },
];

// Shape validation - what valid shard logic should look like
const VALID_SHAPE_PATTERN = /^\s*(\/\/[^\n]*\n)*\s*(\/\*[\s\S]*?\*\/\s*)*(function\s+execute\s*\(|const\s+execute\s*=|let\s+execute\s*=|var\s+execute\s*=)/;

export class ShardLogicScanner {
  private config: ShardLogicScannerConfig;

  constructor(config: Partial<ShardLogicScannerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Quick pre-check - returns true if input likely needs detailed scanning
   */
  private needsDetailedScan(logic: string): boolean {
    const lowerLogic = logic.toLowerCase();
    return TRIGGER_TOKENS.some(token => lowerLogic.includes(token.toLowerCase()));
  }

  /**
   * Scan shard logic for security issues
   */
  scan(logic: string): ShardScanResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let riskLevel: ShardScanResult['riskLevel'] = 'safe';

    // Length check
    if (logic.length > this.config.maxLogicLength) {
      errors.push(`Logic exceeds maximum length of ${this.config.maxLogicLength} characters`);
      riskLevel = 'high';
    }

    // Empty/whitespace check
    if (!logic.trim()) {
      errors.push('Logic is empty');
      return {
        valid: false,
        errors,
        warnings,
        riskLevel: 'safe',
        shouldBlock: true,
        flagForReview: false,
      };
    }

    // Quick pre-check - if no trigger tokens, do minimal validation
    if (!this.needsDetailedScan(logic)) {
      // Still validate shape
      if (!VALID_SHAPE_PATTERN.test(logic)) {
        warnings.push('Logic does not follow expected shape (function execute(input){...})');
      }

      // Check string literal lengths
      const stringLiterals = logic.match(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g) || [];
      for (const str of stringLiterals) {
        if (str.length > this.config.maxStringLiteralLength) {
          warnings.push(`String literal exceeds ${this.config.maxStringLiteralLength} characters`);
          break;
        }
      }

      return {
        valid: true,
        errors,
        warnings,
        riskLevel,
        shouldBlock: false,
        flagForReview: warnings.length > 0,
      };
    }

    // Detailed scanning for suspicious patterns
    let criticalCount = 0;
    let highCount = 0;

    for (const { pattern, name, severity } of SANDBOX_ESCAPE_PATTERNS) {
      if (pattern.test(logic)) {
        errors.push(`Forbidden pattern detected: ${name}`);
        if (severity === 'critical') {
          criticalCount++;
        } else {
          highCount++;
        }
      }
    }

    // Determine risk level
    if (criticalCount > 0) {
      riskLevel = 'critical';
    } else if (highCount > 2) {
      riskLevel = 'high';
    } else if (highCount > 0) {
      riskLevel = 'medium';
    } else if (warnings.length > 0) {
      riskLevel = 'low';
    }

    // Check for nested loops (potential DoS)
    const loopPattern = /\b(for|while|do)\s*\(/g;
    const loopCount = (logic.match(loopPattern) || []).length;
    if (loopCount > this.config.maxNestedLoops) {
      warnings.push(`Excessive loop structures (${loopCount} found, max ${this.config.maxNestedLoops})`);
      if (riskLevel === 'safe' || riskLevel === 'low') {
        riskLevel = 'medium';
      }
    }

    // Check string literal lengths
    const stringLiterals = logic.match(/(['"`])(?:(?!\1)[^\\]|\\.)*\1/g) || [];
    for (const str of stringLiterals) {
      if (str.length > this.config.maxStringLiteralLength) {
        warnings.push(`String literal exceeds ${this.config.maxStringLiteralLength} characters`);
        break;
      }
    }

    // Check for hex/unicode escapes (potential obfuscation)
    const hexEscapes = logic.match(/\\x[0-9a-fA-F]{2}/g) || [];
    const unicodeEscapes = logic.match(/\\u[0-9a-fA-F]{4}/g) || [];
    if (hexEscapes.length > 10 || unicodeEscapes.length > 10) {
      warnings.push('Excessive escape sequences detected (potential obfuscation)');
      if (riskLevel === 'safe') {
        riskLevel = 'low';
      }
    }

    // Shape validation
    if (!VALID_SHAPE_PATTERN.test(logic)) {
      warnings.push('Logic does not follow expected shape (function execute(input){...})');
    }

    // Determine if we should block
    const shouldBlock = riskLevel === 'critical' || (this.config.strictMode && riskLevel === 'high');

    // Flag for review if suspicious but not blocked
    const flagForReview = !shouldBlock && (riskLevel === 'high' || riskLevel === 'medium');

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      riskLevel,
      shouldBlock,
      flagForReview,
    };
  }

  /**
   * Quick check - returns true if logic is safe to store
   */
  isSafe(logic: string): boolean {
    const result = this.scan(logic);
    return !result.shouldBlock;
  }

  /**
   * Validate and optionally block logic before database write
   * Returns the original logic if safe, throws if blocked
   */
  validateForStorage(logic: string, options: { allowFlagged?: boolean } = {}): string {
    const result = this.scan(logic);

    if (result.shouldBlock) {
      throw new ShardLogicBlockedError(
        `Shard logic blocked: ${result.errors.join('; ')}`,
        result
      );
    }

    if (result.flagForReview && !options.allowFlagged) {
      throw new ShardLogicFlaggedError(
        `Shard logic flagged for review: ${result.warnings.join('; ')}`,
        result
      );
    }

    return logic;
  }
}

export class ShardLogicBlockedError extends Error {
  constructor(message: string, public readonly scanResult: ShardScanResult) {
    super(message);
    this.name = 'ShardLogicBlockedError';
  }
}

export class ShardLogicFlaggedError extends Error {
  constructor(message: string, public readonly scanResult: ShardScanResult) {
    super(message);
    this.name = 'ShardLogicFlaggedError';
  }
}

// Singleton instance
export const shardLogicScanner = new ShardLogicScanner();
