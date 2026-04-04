/**
 * Built-in Tool: Audit Inspect (Level 13 — Vibe Collaboration)
 * Self-inspection of audit trails and guardrail constraints: view own audit
 * history, pre-check guardrails before acting, and inspect active guardrail rules.
 */

import { query } from '../../database.js';
import { getAuditLog } from '../../observability/audit.js';
import { checkGuardrails } from '../../observability/guardrails.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface AuditInspectInput {
  action: 'my_audit' | 'check_guardrails' | 'my_guardrails';
  // For my_audit:
  filter_action?: string;
  filter_resource_type?: string;
  limit?: number;
  offset?: number;
  // For check_guardrails:
  input?: string;
  tool_name?: string;
  estimated_cost?: number;
  // Context:
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function auditInspect(input: AuditInspectInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'my_audit':
        return await handleMyAudit(input, startTime);
      case 'check_guardrails':
        return await handleCheckGuardrails(input, startTime);
      case 'my_guardrails':
        return await handleMyGuardrails(input, startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: my_audit, check_guardrails, my_guardrails`,
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

// ============================================
// My Audit Action
// ============================================

async function handleMyAudit(input: AuditInspectInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const ownerId = ctx?.ownerId ?? 'unknown';

  if (ownerId === 'unknown') {
    return { output: null, error: 'Could not determine owner ID', durationMs: Math.round(performance.now() - startTime) };
  }

  const limit = Math.min(input.limit ?? 25, 100);
  const offset = input.offset ?? 0;

  const result = await getAuditLog(ownerId, {
    action: input.filter_action,
    resourceType: input.filter_resource_type,
    limit,
    offset,
  });

  return {
    output: {
      owner_id: ownerId,
      entries: result.entries.map((e) => ({
        id: e.id,
        action: e.action,
        resource_type: e.resource_type,
        resource_id: e.resource_id,
        details: e.details,
        created_at: e.created_at,
      })),
      total: result.total,
      limit,
      offset,
      message: `${result.entries.length} audit entries (${result.total} total).`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Check Guardrails Action
// ============================================

async function handleCheckGuardrails(input: AuditInspectInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const ownerId = ctx?.ownerId ?? 'unknown';
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (ownerId === 'unknown' || agentId === 'unknown') {
    return { output: null, error: 'Could not determine owner/agent ID', durationMs: Math.round(performance.now() - startTime) };
  }
  if (!input.input) {
    return { output: null, error: 'input text is required for check_guardrails', durationMs: 0 };
  }

  const result = await checkGuardrails({
    ownerId,
    agentId,
    input: input.input,
    toolName: input.tool_name,
    estimatedCost: input.estimated_cost,
  });

  return {
    output: {
      allowed: result.allowed,
      reason: result.reason ?? null,
      agent_id: agentId,
      checked_input: input.input.substring(0, 100),
      checked_tool: input.tool_name ?? null,
      checked_cost: input.estimated_cost ?? null,
      message: result.allowed
        ? 'Action is allowed by all guardrails.'
        : `Action blocked: ${result.reason}`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// My Guardrails Action
// ============================================

async function handleMyGuardrails(input: AuditInspectInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const ownerId = ctx?.ownerId ?? 'unknown';
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (ownerId === 'unknown') {
    return { output: null, error: 'Could not determine owner ID', durationMs: Math.round(performance.now() - startTime) };
  }

  // Query guardrails that apply to this agent (global + agent-specific)
  const guardrails = await query<{
    id: string;
    name: string;
    description: string | null;
    type: string;
    config: Record<string, unknown>;
    is_enabled: boolean;
    is_global: boolean;
    priority: number;
  }>(
    `SELECT id, name, description, type, config, is_enabled, is_global, priority
     FROM forge_guardrails
     WHERE owner_id = $1
       AND is_enabled = true
       AND (is_global = true OR $2 = ANY(agent_ids))
     ORDER BY priority ASC`,
    [ownerId, agentId],
  );

  return {
    output: {
      agent_id: agentId,
      guardrails: guardrails.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        type: g.type,
        config: g.config,
        is_global: g.is_global,
        priority: g.priority,
      })),
      total: guardrails.length,
      global_count: guardrails.filter((g) => g.is_global).length,
      agent_specific_count: guardrails.filter((g) => !g.is_global).length,
      message: guardrails.length > 0
        ? `${guardrails.length} active guardrails (${guardrails.filter((g) => g.is_global).length} global, ${guardrails.filter((g) => !g.is_global).length} agent-specific).`
        : 'No active guardrails found for this agent.',
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
