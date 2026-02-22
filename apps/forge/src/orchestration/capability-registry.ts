/**
 * Capability Registry
 * Auto-detects agent capabilities from enabled tools, system prompt keywords,
 * and execution history. Used by agent-matcher for better task assignment.
 */

import { query } from '../database.js';
import { ulid } from 'ulid';

interface CatalogEntry {
  id: string;
  name: string;
  display_name: string;
  description: string;
  category: string;
  required_tools: string[];
  keywords: string[];
}

interface AgentCapability {
  id: string;
  agent_id: string;
  capability: string;
  category: string;
  proficiency: number;
  success_count: number;
  failure_count: number;
  source: string;
}

// Cache catalog in memory (small, rarely changes)
let catalogCache: CatalogEntry[] | null = null;

/**
 * Load capability catalog from DB (cached).
 */
async function getCatalog(): Promise<CatalogEntry[]> {
  if (catalogCache) return catalogCache;
  catalogCache = await query<CatalogEntry>(
    `SELECT id, name, display_name, description, category, required_tools, keywords
     FROM forge_capability_catalog`,
  );
  return catalogCache;
}

/**
 * Auto-detect capabilities for an agent based on tools and system prompt.
 * Inserts new capability records and returns the full capability list.
 */
export async function detectCapabilities(agentId: string): Promise<AgentCapability[]> {
  const catalog = await getCatalog();

  // Get agent details
  const agent = await query<{
    id: string;
    enabled_tools: string[];
    system_prompt: string;
    type: string;
  }>(`SELECT id, enabled_tools, system_prompt, type FROM forge_agents WHERE id = $1`, [agentId]);

  if (agent.length === 0) return [];
  const a = agent[0]!;

  const tools = new Set(a.enabled_tools || []);
  const promptLower = (a.system_prompt || '').toLowerCase();

  const detected: Array<{ name: string; category: string; score: number }> = [];

  for (const cap of catalog) {
    let score = 0;

    // Tool match: if agent has all required tools, strong signal
    if (cap.required_tools.length > 0) {
      const hasAll = cap.required_tools.every((t) => tools.has(t));
      if (hasAll) score += 50;
      else {
        const hasAny = cap.required_tools.some((t) => tools.has(t));
        if (hasAny) score += 20;
      }
    }

    // Keyword match: check system prompt for capability keywords
    const keywordHits = cap.keywords.filter((kw) => promptLower.includes(kw)).length;
    if (cap.keywords.length > 0) {
      score += Math.min(40, (keywordHits / cap.keywords.length) * 40);
    }

    // Type affinity bonus
    if (
      (cap.category === 'development' && a.type === 'dev') ||
      (cap.category === 'research' && a.type === 'research') ||
      (cap.category === 'communication' && a.type === 'content') ||
      (cap.category === 'operations' && a.type === 'monitor')
    ) {
      score += 15;
    }

    if (score >= 30) {
      detected.push({ name: cap.name, category: cap.category, score });
    }
  }

  // Upsert detected capabilities
  for (const d of detected) {
    await query(
      `INSERT INTO forge_agent_capabilities (id, agent_id, capability, category, proficiency, source)
       VALUES ($1, $2, $3, $4, $5, 'auto')
       ON CONFLICT (agent_id, capability) DO UPDATE SET
         proficiency = GREATEST(forge_agent_capabilities.proficiency, $5),
         updated_at = NOW()`,
      [ulid(), agentId, d.name, d.category, Math.round(d.score)],
    );
  }

  // Return all capabilities for this agent
  return query<AgentCapability>(
    `SELECT id, agent_id, capability, category, proficiency, success_count, failure_count, source
     FROM forge_agent_capabilities WHERE agent_id = $1 ORDER BY proficiency DESC`,
    [agentId],
  );
}

/**
 * Detect capabilities for all active agents.
 */
export async function detectAllCapabilities(): Promise<number> {
  const agents = await query<{ id: string }>(
    `SELECT id FROM forge_agents WHERE status != 'archived' AND (is_decommissioned IS NULL OR is_decommissioned = false)`,
  );

  let total = 0;
  for (const agent of agents) {
    const caps = await detectCapabilities(agent.id);
    total += caps.length;
  }

  console.log(`[Capabilities] Detected capabilities for ${agents.length} agents (${total} total)`);
  return total;
}

/**
 * Update capability proficiency based on execution outcome.
 * Called after each execution to refine agent capability scores.
 */
export async function updateCapabilityFromExecution(
  agentId: string,
  toolsUsed: string[],
  success: boolean,
): Promise<void> {
  if (toolsUsed.length === 0) return;

  const catalog = await getCatalog();

  // Find which capabilities match the tools used
  const toolSet = new Set(toolsUsed);
  for (const cap of catalog) {
    if (cap.required_tools.length === 0) continue;
    const overlap = cap.required_tools.filter((t) => toolSet.has(t)).length;
    if (overlap === 0) continue;

    const field = success ? 'success_count' : 'failure_count';
    await query(
      `UPDATE forge_agent_capabilities
       SET ${field} = ${field} + 1,
           last_used = NOW(),
           proficiency = LEAST(100, GREATEST(10, proficiency + $1)),
           updated_at = NOW()
       WHERE agent_id = $2 AND capability = $3`,
      [success ? 2 : -3, agentId, cap.name],
    );
  }
}

/**
 * Get capabilities for a specific agent.
 */
export async function getAgentCapabilities(agentId: string): Promise<AgentCapability[]> {
  return query<AgentCapability>(
    `SELECT id, agent_id, capability, category, proficiency, success_count, failure_count, source
     FROM forge_agent_capabilities WHERE agent_id = $1 ORDER BY proficiency DESC`,
    [agentId],
  );
}

/**
 * Find agents with a specific capability, ranked by proficiency.
 */
export async function findAgentsWithCapability(
  capability: string,
  minProficiency: number = 30,
): Promise<Array<{ agent_id: string; agent_name: string; proficiency: number; success_rate: number }>> {
  return query(
    `SELECT c.agent_id, a.name AS agent_name, c.proficiency,
            CASE WHEN c.success_count + c.failure_count > 0
              THEN c.success_count::float / (c.success_count + c.failure_count)
              ELSE 0.5
            END AS success_rate
     FROM forge_agent_capabilities c
     JOIN forge_agents a ON a.id = c.agent_id
     WHERE c.capability = $1
       AND c.proficiency >= $2
       AND a.is_decommissioned = false
     ORDER BY c.proficiency DESC, success_rate DESC`,
    [capability, minProficiency],
  );
}

/**
 * Invalidate cached catalog (call after catalog updates).
 */
export function invalidateCatalogCache(): void {
  catalogCache = null;
}
