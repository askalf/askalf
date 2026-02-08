/**
 * Conditional Branching Router
 * Evaluates simple expressions used on workflow edges to decide
 * which branch to follow.
 *
 * Supported operators:
 *   ==   strict equality
 *   !=   strict inequality
 *   >    greater than (numeric)
 *   <    less than (numeric)
 *   >=   greater than or equal (numeric)
 *   <=   less than or equal (numeric)
 *   contains   string/array includes check
 *   exists     truthy existence check
 */

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

interface ParsedCondition {
  left: string;
  operator: string;
  right?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a dot-separated path against a context object.
 * e.g. "result.score" on { result: { score: 42 } } => 42
 */
function resolvePath(path: string, context: Record<string, unknown>): unknown {
  const parts = path.split('.');
  let current: unknown = context;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object' && current !== null) {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }

  return current;
}

/**
 * Try to interpret a token as a literal value.
 * Supports: numbers, booleans, quoted strings, null/undefined.
 * Falls back to treating the token as a context path.
 */
function resolveValue(token: string, context: Record<string, unknown>): unknown {
  const trimmed = token.trim();

  // Quoted string literal
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // Boolean literals
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;

  // Null / undefined literals
  if (trimmed === 'null') return null;
  if (trimmed === 'undefined') return undefined;

  // Numeric literal
  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== '') {
    return num;
  }

  // Context path lookup
  return resolvePath(trimmed, context);
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const BINARY_OPERATORS = ['==', '!=', '>=', '<=', '>', '<', 'contains'] as const;

function parseCondition(condition: string): ParsedCondition {
  const trimmed = condition.trim();

  // Check for "exists" as unary operator: "<path> exists"
  if (trimmed.endsWith(' exists')) {
    const left = trimmed.slice(0, -' exists'.length).trim();
    return { left, operator: 'exists' };
  }
  // Also support "exists <path>"
  if (trimmed.startsWith('exists ')) {
    const left = trimmed.slice('exists '.length).trim();
    return { left, operator: 'exists' };
  }

  // Try each binary operator (longest first so >= is matched before >)
  for (const op of BINARY_OPERATORS) {
    const idx = trimmed.indexOf(` ${op} `);
    if (idx !== -1) {
      const left = trimmed.slice(0, idx).trim();
      const right = trimmed.slice(idx + op.length + 2).trim();
      return { left, operator: op, right };
    }
  }

  // Fallback: treat as a truthy check on the expression itself
  return { left: trimmed, operator: 'exists' };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a condition expression against a context object.
 *
 * Examples:
 *   evaluateCondition('status == "active"', { status: 'active' })  => true
 *   evaluateCondition('score > 80', { score: 95 })                 => true
 *   evaluateCondition('tags contains "urgent"', { tags: ['urgent', 'new'] }) => true
 *   evaluateCondition('result exists', { result: { ok: true } })   => true
 */
export function evaluateCondition(
  condition: string,
  context: Record<string, unknown>,
): boolean {
  const parsed = parseCondition(condition);
  const leftVal = resolveValue(parsed.left, context);

  switch (parsed.operator) {
    case 'exists': {
      return leftVal !== undefined && leftVal !== null;
    }

    case '==': {
      const rightVal = resolveValue(parsed.right ?? '', context);
      return leftVal === rightVal;
    }

    case '!=': {
      const rightVal = resolveValue(parsed.right ?? '', context);
      return leftVal !== rightVal;
    }

    case '>': {
      const rightVal = resolveValue(parsed.right ?? '', context);
      return typeof leftVal === 'number' && typeof rightVal === 'number' && leftVal > rightVal;
    }

    case '<': {
      const rightVal = resolveValue(parsed.right ?? '', context);
      return typeof leftVal === 'number' && typeof rightVal === 'number' && leftVal < rightVal;
    }

    case '>=': {
      const rightVal = resolveValue(parsed.right ?? '', context);
      return typeof leftVal === 'number' && typeof rightVal === 'number' && leftVal >= rightVal;
    }

    case '<=': {
      const rightVal = resolveValue(parsed.right ?? '', context);
      return typeof leftVal === 'number' && typeof rightVal === 'number' && leftVal <= rightVal;
    }

    case 'contains': {
      const rightVal = resolveValue(parsed.right ?? '', context);
      if (typeof leftVal === 'string' && typeof rightVal === 'string') {
        return leftVal.includes(rightVal);
      }
      if (Array.isArray(leftVal)) {
        return leftVal.includes(rightVal);
      }
      return false;
    }

    default:
      return false;
  }
}
