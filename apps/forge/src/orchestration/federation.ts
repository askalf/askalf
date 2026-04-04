/**
 * Cross-Instance Federation
 *
 * Multiple AskAlf instances share anonymized learnings:
 * - Procedural memories (trigger → fix patterns)
 * - Cost optimization discoveries
 * - Agent prompt improvements that worked
 * - Template recommendations based on use-case
 *
 * Privacy-first: all data is anonymized before sharing.
 * Opt-in only: controlled by ENABLE_FEDERATION env var.
 *
 * Architecture:
 * - Each instance has a unique federation_id
 * - Insights are published to a shared endpoint (federation hub)
 * - Instances pull insights from the hub periodically
 * - Local Fleet Chief decides whether to apply shared insights
 */

import { query, queryOne } from '../database.js';
import { ulid } from 'ulid';

interface SharedInsight {
  id: string;
  federation_id: string;    // anonymized instance ID
  category: string;         // 'cost_optimization', 'prompt_improvement', 'pattern', 'template'
  content: string;          // the insight (anonymized)
  confidence: number;       // 0-1
  impact: string;           // e.g. "saved $140/month"
  created_at: string;
}

const FEDERATION_HUB_URL = process.env['FEDERATION_HUB_URL'] || 'https://federation.askalf.org';
const FEDERATION_ENABLED = process.env['ENABLE_FEDERATION'] === 'true';

/**
 * Get or create this instance's federation ID (persistent, anonymous).
 */
async function getFederationId(): Promise<string> {
  const existing = await queryOne<{ value: string }>(
    `SELECT value FROM platform_settings WHERE key = 'federation_id'`,
  );
  if (existing) return existing.value;

  const id = `fed_${ulid()}`;
  await query(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ('federation_id', $1, NOW()) ON CONFLICT (key) DO NOTHING`,
    [id],
  );
  return id;
}

/**
 * Extract shareable insights from local fleet data.
 * All data is anonymized — no agent names, user data, or secrets.
 */
export async function extractInsights(): Promise<SharedInsight[]> {
  const fedId = await getFederationId();
  const insights: SharedInsight[] = [];

  // 1. Cost optimization discoveries
  const costPatterns = await query<{ trigger_pattern: string; tool_sequence: string; confidence: number }>(
    `SELECT trigger_pattern, tool_sequence::text, confidence FROM forge_procedural_memories
     WHERE metadata->>'source' = 'dream_cycle' AND confidence > 0.7
     ORDER BY confidence DESC LIMIT 10`,
  );

  for (const pattern of costPatterns) {
    // Anonymize: remove specific agent names/IDs
    const anonymized = pattern.trigger_pattern
      .replace(/[A-Z][a-z]+ [A-Z][a-z]+/g, '[Agent]')  // Remove proper names
      .replace(/\$\d+\.\d+/g, '[cost]')                  // Remove specific costs
      .replace(/\d{10,}/g, '[id]');                       // Remove IDs

    insights.push({
      id: ulid(),
      federation_id: fedId,
      category: 'pattern',
      content: anonymized,
      confidence: pattern.confidence,
      impact: 'Procedural learning from execution patterns',
      created_at: new Date().toISOString(),
    });
  }

  // 2. Model routing insights
  const modelInsights = await query<{ name: string; model_id: string; metadata: Record<string, unknown> }>(
    `SELECT name, model_id, metadata FROM forge_agents
     WHERE status = 'active' AND metadata->>'reputation' IS NOT NULL
     AND (metadata->'reputation'->>'cost_efficiency')::float > 0.7`,
  );

  for (const agent of modelInsights) {
    const rep = agent.metadata?.['reputation'] as Record<string, unknown>;
    if (!rep) continue;

    const isHaiku = agent.model_id?.includes('haiku');
    const agentType = agent.name.includes('Monitor') ? 'monitor' : agent.name.includes('Manager') ? 'community' : 'worker';

    insights.push({
      id: ulid(),
      federation_id: fedId,
      category: 'cost_optimization',
      content: `${agentType} agents with high cost efficiency (${rep['cost_efficiency']}) use ${isHaiku ? 'Haiku' : 'Sonnet'} model`,
      confidence: parseFloat(String(rep['score'] || '0.5')),
      impact: `Cost efficiency score: ${rep['cost_efficiency']}`,
      created_at: new Date().toISOString(),
    });
  }

  return insights;
}

/**
 * Publish local insights to the federation hub.
 */
export async function publishInsights(): Promise<{ published: number }> {
  if (!FEDERATION_ENABLED) return { published: 0 };

  const insights = await extractInsights();
  if (insights.length === 0) return { published: 0 };

  try {
    const res = await fetch(`${FEDERATION_HUB_URL}/api/v1/federation/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ insights }),
      signal: AbortSignal.timeout(10000),
    });

    if (res.ok) {
      console.log(`[Federation] Published ${insights.length} insights to hub`);
      return { published: insights.length };
    }
  } catch (err) {
    console.warn(`[Federation] Publish failed: ${err instanceof Error ? err.message : err}`);
  }

  return { published: 0 };
}

/**
 * Pull insights from the federation hub and apply relevant ones.
 */
export async function pullInsights(): Promise<{ pulled: number; applied: number }> {
  if (!FEDERATION_ENABLED) return { pulled: 0, applied: 0 };

  const fedId = await getFederationId();

  try {
    const res = await fetch(`${FEDERATION_HUB_URL}/api/v1/federation/insights?exclude=${fedId}&limit=20`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return { pulled: 0, applied: 0 };

    const data = await res.json() as { insights: SharedInsight[] };
    const insights = data.insights || [];

    let applied = 0;
    for (const insight of insights) {
      if (insight.confidence < 0.7) continue;

      // Store as a semantic memory for Fleet Chief to evaluate
      const existing = await queryOne<{ id: string }>(
        `SELECT id FROM forge_semantic_memories WHERE content = $1 LIMIT 1`,
        [insight.content],
      );

      if (!existing) {
        await query(
          `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, tenant_id, content, source, importance, metadata)
           VALUES ($1, '01DFLTFLEETCHIEF00000000000', 'selfhosted-admin', 'selfhosted', $2, 'federation', 0.6, $3)`,
          [
            ulid(),
            `[Federation insight] ${insight.content}`,
            JSON.stringify({ federation_id: insight.federation_id, category: insight.category, confidence: insight.confidence }),
          ],
        );
        applied++;
      }
    }

    console.log(`[Federation] Pulled ${insights.length} insights, applied ${applied} new`);
    return { pulled: insights.length, applied };
  } catch (err) {
    console.warn(`[Federation] Pull failed: ${err instanceof Error ? err.message : err}`);
    return { pulled: 0, applied: 0 };
  }
}

/**
 * Run federation sync — publish and pull. Called weekly by the dispatcher.
 */
export async function syncFederation(): Promise<void> {
  if (!FEDERATION_ENABLED) return;

  console.log('[Federation] Starting weekly sync...');
  const published = await publishInsights();
  const pulled = await pullInsights();

  console.log(`[Federation] Sync complete: published ${published.published}, pulled ${pulled.pulled} (${pulled.applied} new)`);
}
