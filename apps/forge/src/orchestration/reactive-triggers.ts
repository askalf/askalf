/**
 * Reactive Coordination Triggers
 * Scans execution output for cross-domain signals and creates tickets
 * for relevant agents. Zero LLM calls — pure keyword matching against
 * the capability catalog.
 */

import { getEventBus, type ExecutionEvent } from './event-bus.js';
import { findAgentsWithCapability, getAgentCapabilities } from './capability-registry.js';
import { query } from '../database.js';
import { ulid } from 'ulid';

// ============================================
// Config
// ============================================

const MIN_OUTPUT_LENGTH = 300;
const SCAN_LENGTH = 1500;
const MIN_SIGNAL_STRENGTH = 3;
const COOLDOWN_MINUTES = 120;
const MAX_TRIGGERS_PER_HOUR = 6;
const MIN_PROFICIENCY = 40;
const MAX_SIGNALS_PER_EVENT = 2;

// ============================================
// Signal Map Cache
// ============================================

interface SignalMap {
  [capability: string]: RegExp;
}

let signalMapCache: SignalMap | null = null;
let signalMapLoadedAt = 0;
const SIGNAL_CACHE_TTL = 10 * 60 * 1000; // 10 min

async function getSignalMap(): Promise<SignalMap> {
  const now = Date.now();
  if (signalMapCache && now - signalMapLoadedAt < SIGNAL_CACHE_TTL) {
    return signalMapCache;
  }

  const rows = await query<{ name: string; keywords: string[] }>(
    `SELECT name, keywords FROM forge_capability_catalog`,
  );

  const map: SignalMap = {};
  for (const row of rows) {
    if (row.keywords.length === 0) continue;
    // Build a single regex that matches any keyword (word boundaries for precision)
    const escaped = row.keywords.map((kw) => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    map[row.name] = new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'gi');
  }

  signalMapCache = map;
  signalMapLoadedAt = now;
  return map;
}

// ============================================
// Signal Detection
// ============================================

interface Signal {
  capability: string;
  strength: number;
  keywords: string[];
}

function detectSignals(output: string, signalMap: SignalMap): Signal[] {
  const text = output.substring(0, SCAN_LENGTH).toLowerCase();
  const signals: Signal[] = [];

  for (const [capability, regex] of Object.entries(signalMap)) {
    // Reset regex state
    regex.lastIndex = 0;
    const matches = text.match(regex);
    if (!matches) continue;

    // Deduplicate matched keywords
    const unique = [...new Set(matches.map((m) => m.toLowerCase()))];
    if (unique.length >= MIN_SIGNAL_STRENGTH) {
      signals.push({ capability, strength: unique.length, keywords: unique });
    }
  }

  // Sort by strength descending, take top N
  return signals.sort((a, b) => b.strength - a.strength).slice(0, MAX_SIGNALS_PER_EVENT);
}

// ============================================
// Rate Limiting
// ============================================

async function checkGlobalRateLimit(): Promise<boolean> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM forge_reactive_triggers
     WHERE created_at > NOW() - INTERVAL '1 hour'`,
  );
  return parseInt(rows[0]?.count ?? '0', 10) < MAX_TRIGGERS_PER_HOUR;
}

async function checkCooldown(sourceAgentId: string, targetCapability: string): Promise<boolean> {
  const rows = await query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM forge_reactive_triggers
     WHERE source_agent_id = $1 AND target_capability = $2
       AND created_at > NOW() - make_interval(mins => $3)`,
    [sourceAgentId, targetCapability, COOLDOWN_MINUTES],
  );
  return parseInt(rows[0]?.count ?? '0', 10) === 0;
}

// ============================================
// Core Handler
// ============================================

async function handleExecutionCompleted(event: ExecutionEvent): Promise<void> {
  // Only handle completed executions (not failed/cancelled)
  if (event.event !== 'completed') return;

  const output = event.data?.output ?? '';

  // Skip trivial outputs
  if (output.length < MIN_OUTPUT_LENGTH) return;

  // Check if this execution was itself triggered by a reactive ticket (no cascade)
  const execMeta = await query<{ metadata: Record<string, unknown> | null }>(
    `SELECT metadata FROM forge_executions WHERE id = $1`,
    [event.executionId],
  );
  if (execMeta[0]?.metadata?.['reactive_source']) return;

  // Check global rate limit
  if (!(await checkGlobalRateLimit())) {
    console.log('[ReactiveTrigger] Global rate limit reached, skipping');
    return;
  }

  // Fetch full output if event only carries truncated version
  let fullOutput = output;
  if (output.length >= 490) {
    // Event likely truncated at 500 chars — fetch full output from DB
    const rows = await query<{ output: string }>(
      `SELECT output FROM forge_executions WHERE id = $1`,
      [event.executionId],
    );
    if (rows[0]?.output) {
      fullOutput = rows[0].output;
    }
  }

  // Get signal map and detect signals
  const signalMap = await getSignalMap();
  const signals = detectSignals(fullOutput, signalMap);
  if (signals.length === 0) return;

  // Get source agent's own capabilities to filter out
  const ownCaps = await getAgentCapabilities(event.agentId);
  const ownCapNames = new Set(ownCaps.map((c) => c.capability));

  // Filter to only foreign domains
  const foreignSignals = signals.filter((s) => !ownCapNames.has(s.capability));
  if (foreignSignals.length === 0) return;

  console.log(
    `[ReactiveTrigger] ${event.agentName} execution ${event.executionId} — ` +
    `detected ${foreignSignals.length} foreign signal(s): ${foreignSignals.map((s) => `${s.capability}(${s.strength})`).join(', ')}`,
  );

  for (const signal of foreignSignals) {
    // Check per-pair cooldown
    if (!(await checkCooldown(event.agentId, signal.capability))) {
      console.log(`[ReactiveTrigger] Cooldown active for ${event.agentName} → ${signal.capability}, skipping`);
      continue;
    }

    // Find best agent for this capability
    const candidates = await findAgentsWithCapability(signal.capability, MIN_PROFICIENCY);
    if (candidates.length === 0) {
      console.log(`[ReactiveTrigger] No qualified agent for ${signal.capability}`);
      continue;
    }

    const target = candidates[0]!;

    // Create ticket
    const ticketId = ulid();
    const title = `[Reactive] ${event.agentName} flagged ${signal.capability} implications`;
    const description =
      `**Auto-detected cross-domain signal** from ${event.agentName}'s execution.\n\n` +
      `**Signal keywords:** ${signal.keywords.join(', ')}\n` +
      `**Signal strength:** ${signal.strength} keyword matches in ${signal.capability} domain\n` +
      `**Source execution:** ${event.executionId}\n\n` +
      `**Context (first 500 chars):**\n${fullOutput.substring(0, 500)}\n\n` +
      `Please review the above execution output and take appropriate action within your domain.`;

    await query(
      `INSERT INTO agent_tickets (id, title, description, status, priority, category, created_by, assigned_to, is_agent_ticket, source, metadata)
       VALUES ($1, $2, $3, 'open', 'medium', $4, $5, $6, true, 'reactive', $7)`,
      [
        ticketId,
        title,
        description,
        signal.capability,
        event.agentName,
        target.agent_name,
        JSON.stringify({
          reactive_source: true,
          source_execution_id: event.executionId,
          source_agent_id: event.agentId,
          source_agent_name: event.agentName,
          signal_capability: signal.capability,
          signal_strength: signal.strength,
          signal_keywords: signal.keywords,
        }),
      ],
    );

    // Log trigger
    await query(
      `INSERT INTO forge_reactive_triggers (id, source_execution_id, source_agent_id, target_capability, target_agent_id, action_id, signal_keywords)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ulid(), event.executionId, event.agentId, signal.capability, target.agent_id, ticketId, signal.keywords],
    );

    console.log(
      `[ReactiveTrigger] Created ticket ${ticketId} for ${target.agent_name} ` +
      `(${signal.capability}, strength ${signal.strength}) from ${event.agentName}`,
    );
  }
}

// ============================================
// Startup
// ============================================

export function startReactiveTriggers(): void {
  const eventBus = getEventBus();
  if (!eventBus) {
    console.warn('[ReactiveTrigger] Event bus not available, skipping');
    return;
  }

  eventBus.on('execution', (event) => {
    if (event.type !== 'execution') return;
    void handleExecutionCompleted(event as ExecutionEvent).catch((err) => {
      console.error('[ReactiveTrigger] Error handling execution:', err instanceof Error ? err.message : err);
    });
  });

  console.log('[ReactiveTrigger] Reactive coordination triggers active');
}
