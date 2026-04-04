/**
 * Built-in Tool: Capability Ops (Level 15 — Vibe Completeness)
 * Capability-based agent routing and discovery: find agents by capability,
 * view own capabilities, re-detect capabilities, and browse the catalog.
 */

import { query } from '../../database.js';
import {
  findAgentsWithCapability,
  getAgentCapabilities,
  detectCapabilities,
} from '../../orchestration/capability-registry.js';
import { getExecutionContext } from '../../runtime/execution-context.js';
import type { ToolResult } from '../registry.js';

// ============================================
// Types
// ============================================

export interface CapabilityOpsInput {
  action: 'find' | 'my_capabilities' | 'detect' | 'catalog';
  // For find:
  capability?: string;
  min_proficiency?: number;
  // Context:
  agent_id?: string;
}

// ============================================
// Implementation
// ============================================

export async function capabilityOps(input: CapabilityOpsInput): Promise<ToolResult> {
  const startTime = performance.now();

  try {
    switch (input.action) {
      case 'find':
        return await handleFind(input, startTime);
      case 'my_capabilities':
        return await handleMyCapabilities(input, startTime);
      case 'detect':
        return await handleDetect(input, startTime);
      case 'catalog':
        return await handleCatalog(startTime);
      default:
        return {
          output: null,
          error: `Unknown action: ${input.action}. Supported: find, my_capabilities, detect, catalog`,
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
// Find Action
// ============================================

async function handleFind(input: CapabilityOpsInput, startTime: number): Promise<ToolResult> {
  if (!input.capability) {
    return { output: null, error: 'capability is required for find', durationMs: 0 };
  }

  const agents = await findAgentsWithCapability(
    input.capability,
    input.min_proficiency ?? 30,
  );

  return {
    output: {
      capability: input.capability,
      min_proficiency: input.min_proficiency ?? 30,
      agents: agents.map((a) => ({
        agent_id: a.agent_id,
        agent_name: a.agent_name,
        proficiency: a.proficiency,
        success_rate: Math.round(a.success_rate * 100) / 100,
      })),
      total: agents.length,
      message: agents.length > 0
        ? `${agents.length} agent(s) found with "${input.capability}" capability.`
        : `No agents found with "${input.capability}" capability (min proficiency: ${input.min_proficiency ?? 30}).`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// My Capabilities Action
// ============================================

async function handleMyCapabilities(input: CapabilityOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  const capabilities = await getAgentCapabilities(agentId);

  return {
    output: {
      agent_id: agentId,
      capabilities: capabilities.map((c) => ({
        capability: c.capability,
        category: c.category,
        proficiency: c.proficiency,
        success_count: c.success_count,
        failure_count: c.failure_count,
        source: c.source,
      })),
      total: capabilities.length,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Detect Action
// ============================================

async function handleDetect(input: CapabilityOpsInput, startTime: number): Promise<ToolResult> {
  const ctx = getExecutionContext();
  const agentId = input.agent_id ?? ctx?.agentId ?? 'unknown';

  if (agentId === 'unknown') {
    return { output: null, error: 'Could not determine agent ID', durationMs: Math.round(performance.now() - startTime) };
  }

  // Guard: autonomy >= 3
  const agents = await query<{ autonomy_level: number }>(
    `SELECT autonomy_level FROM forge_agents WHERE id = $1`,
    [agentId],
  );
  if (agents.length > 0 && agents[0]!.autonomy_level < 3) {
    return {
      output: null,
      error: `Autonomy level ${agents[0]!.autonomy_level} insufficient. Need >= 3 to re-detect capabilities.`,
      durationMs: Math.round(performance.now() - startTime),
    };
  }

  const capabilities = await detectCapabilities(agentId);

  return {
    output: {
      agent_id: agentId,
      detected: capabilities.length,
      capabilities: capabilities.map((c) => ({
        capability: c.capability,
        category: c.category,
        proficiency: c.proficiency,
        source: c.source,
      })),
      message: `Detected ${capabilities.length} capabilities for agent.`,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}

// ============================================
// Catalog Action
// ============================================

async function handleCatalog(startTime: number): Promise<ToolResult> {
  const catalog = await query<{
    name: string;
    display_name: string;
    description: string;
    category: string;
    required_tools: string[];
    keywords: string[];
  }>(
    `SELECT name, display_name, description, category, required_tools, keywords
     FROM forge_capability_catalog
     ORDER BY category, name`,
  );

  const byCategory: Record<string, number> = {};
  for (const c of catalog) {
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
  }

  return {
    output: {
      capabilities: catalog.map((c) => ({
        name: c.name,
        display_name: c.display_name,
        description: c.description,
        category: c.category,
        required_tools: c.required_tools,
        keywords: c.keywords,
      })),
      total: catalog.length,
      by_category: byCategory,
    },
    durationMs: Math.round(performance.now() - startTime),
  };
}
