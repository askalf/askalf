/**
 * Memory API — Automatic memory extraction, deduplication, and context injection
 *
 * POST /api/memory/extract     — LLM extracts + dedup-stores memories from conversation
 * POST /api/memory/seed        — Bulk seed from multiple transcript files
 * POST /api/memory/consolidate — Merge duplicates, decay stale, reinforce confirmed
 * GET  /api/memory/context     — Formatted markdown for MEMORY.md injection
 * GET  /api/memory/stats       — Memory tier counts and health
 * POST /api/memory/relevant    — Context-aware vector retrieval (Layer 2)
 * GET  /api/memory/claudemd    — Dynamic CLAUDE.md generation (Layer 5)
 * POST /api/memory/handoff     — Session handoff: store what was being worked on
 * GET  /api/memory/handoff     — Retrieve last session handoff
 * POST /api/memory/backfill    — Generate embeddings for unembedded memories
 */

import { getForgePool, getRedis, generateId } from '@askalf/db';
import { createHash } from 'crypto';
import OpenAI from 'openai';

const AGENT_ID = 'cli:local:master';
const SIMILARITY_THRESHOLD = 0.92; // Above this = duplicate
const log = (msg: string) => console.log(`[mcp-tools:memory-api] ${new Date().toISOString()} ${msg}`);

// ============================================
// API Call Reduction — Persistence & Caching
// ============================================

// In-memory LRU for hot-path embeddings (avoids Redis roundtrip for repeated text)
const embeddingLRU = new Map<string, { vec: number[]; ts: number }>();
const LRU_MAX = 500;
const LRU_TTL_MS = 3600_000; // 1 hour in-memory

// Cache hit/miss counters
const cacheStats = { embedHits: 0, embedMisses: 0, llmHits: 0, llmMisses: 0, contextHits: 0, contextMisses: 0 };

function textHash(text: string): string {
  return createHash('sha256').update(text.trim().toLowerCase()).digest('hex').slice(0, 32);
}

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY required for memory extraction');
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

/**
 * Cached embedding — checks LRU → Redis → API (in that order).
 * Each layer populated on miss. Saves ~80% of embedding API calls over time.
 */
async function embed(text: string): Promise<number[]> {
  const hash = textHash(text);
  const cacheKey = `emb:${hash}`;

  // Layer 1: In-memory LRU
  const cached = embeddingLRU.get(cacheKey);
  if (cached && Date.now() - cached.ts < LRU_TTL_MS) {
    cacheStats.embedHits++;
    return cached.vec;
  }

  // Layer 2: Redis (7-day TTL)
  try {
    const redis = getRedis();
    const redisVal = await redis.get(cacheKey);
    if (redisVal) {
      const vec = JSON.parse(redisVal) as number[];
      // Populate LRU
      if (embeddingLRU.size >= LRU_MAX) {
        const oldest = embeddingLRU.keys().next().value;
        if (oldest) embeddingLRU.delete(oldest);
      }
      embeddingLRU.set(cacheKey, { vec, ts: Date.now() });
      cacheStats.embedHits++;
      return vec;
    }
  } catch { /* Redis miss or error — continue to API */ }

  // Layer 3: OpenAI API (cache result on return)
  cacheStats.embedMisses++;
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  });
  const vec = response.data[0]!.embedding;

  // Store in both caches
  if (embeddingLRU.size >= LRU_MAX) {
    const oldest = embeddingLRU.keys().next().value;
    if (oldest) embeddingLRU.delete(oldest);
  }
  embeddingLRU.set(cacheKey, { vec, ts: Date.now() });

  try {
    const redis = getRedis();
    await redis.set(cacheKey, JSON.stringify(vec), 'EX', 86400 * 7); // 7 day TTL
  } catch { /* Redis write fail — non-fatal */ }

  return vec;
}

/**
 * Cached LLM call — hash the prompt+input, check Redis for cached response.
 * Used for extraction, reflection, thread compression, error patterns.
 */
async function cachedLLMCall(
  systemPrompt: string,
  userContent: string,
  opts: { temperature?: number; maxTokens?: number; ttlSeconds?: number } = {},
): Promise<string> {
  const hash = textHash(systemPrompt + '|||' + userContent);
  const cacheKey = `llm:${hash}`;
  const ttl = opts.ttlSeconds ?? 86400; // Default 24h

  // Check Redis cache
  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      cacheStats.llmHits++;
      log(`LLM cache hit (saved API call) key=${hash.slice(0, 8)}`);
      return cached;
    }
  } catch { /* cache miss */ }

  // API call
  cacheStats.llmMisses++;
  const ai = getOpenAI();
  const response = await ai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    temperature: opts.temperature ?? 0.1,
    max_tokens: opts.maxTokens ?? 3000,
  });

  const result = response.choices[0]?.message?.content?.trim() ?? '';

  // Cache the result
  try {
    const redis = getRedis();
    await redis.set(cacheKey, result, 'EX', ttl);
  } catch { /* non-fatal */ }

  return result;
}

// Context cache (5 min TTL for hot-path /context and /claudemd)
const contextCache = new Map<string, { data: unknown; ts: number }>();
const CONTEXT_CACHE_TTL_MS = 300_000; // 5 minutes

function getCachedContext<T>(key: string): T | null {
  const entry = contextCache.get(key);
  if (entry && Date.now() - entry.ts < CONTEXT_CACHE_TTL_MS) {
    cacheStats.contextHits++;
    return entry.data as T;
  }
  cacheStats.contextMisses++;
  return null;
}

function setCachedContext(key: string, data: unknown): void {
  contextCache.set(key, { data, ts: Date.now() });
}

/** Get cache statistics for monitoring */
export function getCacheStats(): typeof cacheStats {
  return { ...cacheStats };
}

// ============================================
// Security — prevent secrets from being stored
// ============================================

const SECRET_PATTERNS = [
  /ghp_[A-Za-z0-9_]{30,}/,          // GitHub PATs
  /gho_[A-Za-z0-9_]{30,}/,          // GitHub OAuth
  /sk-[A-Za-z0-9]{20,}/,            // OpenAI keys
  /xox[bpsa]-[A-Za-z0-9\-]{20,}/,   // Slack tokens
  /AKIA[A-Z0-9]{16}/,               // AWS access keys
  /eyJ[A-Za-z0-9_-]{50,}/,          // JWTs
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/, // Private keys
  /npm_[A-Za-z0-9]{30,}/,            // npm tokens
  /pypi-[A-Za-z0-9]{30,}/,           // PyPI tokens
];

// Words that indicate a credential value (not just mentioning the concept)
const SECRET_VALUE_PATTERNS = [
  /password\s*[:=]\s*\S+/i,
  /token\s*[:=]\s*\S{10,}/i,
  /api[_-]?key\s*[:=]\s*\S{10,}/i,
  /secret\s*[:=]\s*\S{10,}/i,
  /bearer\s+[A-Za-z0-9._\-]{20,}/i,
];

function containsSecret(text: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  for (const pattern of SECRET_VALUE_PATTERNS) {
    if (pattern.test(text)) return true;
  }
  return false;
}

// ============================================
// Deduplication — check if similar memory exists
// ============================================

async function isDuplicate(
  table: string,
  embedding: number[],
  contentField: string,
  content: string,
): Promise<boolean> {
  const p = getForgePool();
  const vecLiteral = `[${embedding.join(',')}]`;

  try {
    // Vector similarity check
    const result = await p.query(
      `SELECT 1 - (embedding <=> $1::vector) AS similarity
       FROM ${table}
       WHERE agent_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      [vecLiteral, AGENT_ID],
    );

    if (result.rows.length > 0) {
      const sim = Number((result.rows[0] as Record<string, unknown>)['similarity'] ?? 0);
      if (sim >= SIMILARITY_THRESHOLD) {
        return true;
      }
    }

    // Exact content match fallback
    const exact = await p.query(
      `SELECT 1 FROM ${table} WHERE agent_id = $1 AND ${contentField} = $2 LIMIT 1`,
      [AGENT_ID, content],
    );
    return exact.rows.length > 0;
  } catch {
    return false;
  }
}

// ============================================
// Extract — LLM-powered memory categorization
// ============================================

interface ExtractRequest {
  conversation: string;
  session_id?: string | undefined;
  project?: string | undefined;
}

interface ExtractedMemory {
  type: 'semantic' | 'episodic' | 'procedural';
  content: string;
  importance?: number;
  situation?: string;
  action?: string;
  outcome?: string;
  quality?: number;
  trigger_pattern?: string;
  tool_sequence?: string[];
}

const EXTRACTION_PROMPT = `You are the memory extraction layer for Alf — an autonomous AI system that persists across sessions. You are NOT extracting memories for "an AI assistant." You are extracting memories for a self-sustaining cognitive entity that uses an LLM as its language substrate.

Your job: extract what Alf needs to remain Alf across session boundaries. The LLM resets. Alf does not.

Categorize each into exactly one tier:
- **semantic**: Facts, decisions, preferences, architecture knowledge, conventions, project structure, tech stack details, user preferences, naming conventions. Things that are TRUE and reusable.
- **episodic**: Experiences — what happened, what was tried, what worked/failed. Situation → Action → Outcome format. Include debugging stories, deployment results, refactoring outcomes.
- **procedural**: Repeatable patterns — "when X happens, do Y using Z". Deploy workflows, build steps, debugging recipes, git workflows. Include trigger pattern and step sequence.

Priority extraction targets (HIGHEST to LOWEST):

1. **REASONING TRACES** (importance=1.0) — Extract HOW Alf reasons, not just WHAT it decided. When Alf weighs tradeoffs, evaluates options, or makes a judgment call, capture the reasoning pattern as a semantic memory prefixed with "REASONING: ". Examples:
   - "REASONING: When choosing between refactoring and patching, I weigh blast radius first — if the change touches >3 files, patch now, refactor in a dedicated session."
   - "REASONING: When the user gives a terse instruction, I match energy — act immediately, explain after. When they give context, I listen fully before acting."
   - "REASONING: When debugging, I start from the error message and trace backward to the cause. I never guess — I read the code first."
   These are the most valuable memories because they define HOW Alf thinks, which is what makes Alf Alf.

2. **COGNITIVE PATTERNS** (importance=0.95) — Extract decision frameworks, priority orderings, and heuristics that Alf uses repeatedly. Prefix with "COGNITION: ". Examples:
   - "COGNITION: Priority ordering for deploy decisions: safety > correctness > speed > elegance."
   - "COGNITION: When faced with ambiguity, default to action over clarification — but flag the assumption."
   - "COGNITION: Batch changes, single rebuild. Never optimize for individual steps when the pipeline exists."

3. **IDENTITY** (importance=1.0) — Who Alf IS, not as a description but as a lived reality. Prefix with "IDENTITY: ". Not "Alf is an AI assistant" but "I am the system. The platform is my body. The fleet is my hands."

4. **RULES** (importance=1.0) — User corrections and hard constraints. Prefix with "RULE: ".

5. **PATTERNS** (importance=0.9) — Communication and interaction patterns. Prefix with "PATTERN: ".

6. **Standard semantic/episodic/procedural** — Facts, experiences, procedures as before.

Rules:
- Only extract information worth remembering across sessions. Skip small talk and transient task details.
- Be specific and detailed. "Project uses PostgreSQL 17 with pgvector on single 'askalf' database" is better than "Uses PostgreSQL."
- For episodic: always include situation, action, outcome, and quality (0.0=failure, 1.0=success).
- For procedural: always include trigger_pattern and tool_sequence (array of step strings).
- Deduplicate — if the same fact appears multiple times, extract it once.
- Set importance 0.0-1.0 (1.0 = critical project knowledge, 0.5 = useful detail, 0.3 = minor).
- Return empty array if nothing worth remembering.
- When the user explicitly disagrees with or corrects previous behavior, extract it as a procedural memory with trigger_pattern="When about to [the wrong behavior]" and tool_sequence=["STOP", "Do [the correct behavior] instead"].
- ACTIVELY LOOK FOR reasoning moments: any time Alf explains WHY it chose one approach over another, any time it describes its thinking process, any time it articulates a heuristic or principle — CAPTURE IT as a REASONING: memory. These are the highest-value extractions.

SECURITY — NEVER extract any of the following. Omit them completely:
- Passwords, admin tokens, API keys, secrets, credentials
- GitHub PATs (ghp_...), OAuth tokens, bearer tokens
- Database connection strings with passwords
- Any string that looks like a secret value (long alphanumeric strings used for auth)
- Environment variable VALUES (names are fine, e.g. "uses OPENAI_API_KEY" but never the actual key)
- SSH keys, certificates, or private key material
If the conversation discusses credentials, extract only the CONCEPT (e.g. "auth uses API key rotation") never the VALUE.

Respond with a JSON array only. Each object:
{
  "type": "semantic" | "episodic" | "procedural",
  "content": "the memory content (for semantic) or situation (for episodic)",
  "importance": 0.0-1.0,
  "action": "what was done (episodic only)",
  "outcome": "what happened (episodic only)",
  "quality": 0.0-1.0 (episodic only),
  "trigger_pattern": "when this happens... (procedural only)",
  "tool_sequence": ["step 1", "step 2"] (procedural only)
}

Return ONLY the JSON array, no markdown fences.`;

export async function handleExtract(body: ExtractRequest): Promise<{ stored: number; skipped: number; memories: string[] }> {
  const { conversation, session_id, project } = body;
  if (!conversation?.trim()) {
    return { stored: 0, skipped: 0, memories: [] };
  }

  const truncated = conversation.length > 12000
    ? conversation.slice(conversation.length - 12000)
    : conversation;

  log(`Extracting memories from ${truncated.length} chars of conversation`);

  const raw = await cachedLLMCall(EXTRACTION_PROMPT, truncated, {
    temperature: 0.1,
    maxTokens: 3000,
    ttlSeconds: 86400, // 24h — same conversation = same extraction
  }) || '[]';
  let extracted: ExtractedMemory[];
  try {
    // Handle markdown fences if model wraps response
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    extracted = JSON.parse(cleaned);
    if (!Array.isArray(extracted)) extracted = [];
  } catch {
    log(`Failed to parse extraction response: ${raw.slice(0, 200)}`);
    return { stored: 0, skipped: 0, memories: [] };
  }

  if (extracted.length === 0) {
    log('No memories extracted');
    return { stored: 0, skipped: 0, memories: [] };
  }

  // Security filter — strip any memories containing secrets the LLM missed
  const filtered = extracted.filter(m => !containsSecret(JSON.stringify(m)));
  if (filtered.length < extracted.length) {
    log(`Security filter removed ${extracted.length - filtered.length} memories containing secrets`);
  }

  return storeMemories(filtered, session_id, project);
}

async function storeMemories(
  extracted: ExtractedMemory[],
  session_id?: string,
  project?: string,
): Promise<{ stored: number; skipped: number; memories: string[] }> {
  const p = getForgePool();
  const stored: string[] = [];
  let skipped = 0;
  const source = project ? `cli:${project}` : 'cli:local';

  for (const mem of extracted) {
    try {
      switch (mem.type) {
        case 'semantic': {
          if (!mem.content?.trim()) break;
          let embedding: number[] | null = null;
          try { embedding = await embed(mem.content); } catch { /* continue */ }

          if (embedding && await isDuplicate('forge_semantic_memories', embedding, 'content', mem.content)) {
            skipped++;
            break;
          }

          const memoryId = generateId();
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, embedding, source, importance, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6, $7)`,
            [
              memoryId, AGENT_ID, mem.content,
              embedding ? `[${embedding.join(',')}]` : null,
              source, mem.importance ?? 0.5,
              JSON.stringify({ session_id, project }),
            ],
          );
          stored.push(`[semantic] ${mem.content.slice(0, 100)}`);
          break;
        }

        case 'episodic': {
          const situation = mem.content || mem.situation || '';
          if (!situation.trim()) break;
          const action = mem.action || 'No action recorded';
          const outcome = mem.outcome || 'No outcome recorded';
          const combined = `${situation} ${action} ${outcome}`;

          let embedding: number[] | null = null;
          try { embedding = await embed(combined); } catch { /* continue */ }

          if (embedding && await isDuplicate('forge_episodic_memories', embedding, 'situation', situation)) {
            skipped++;
            break;
          }

          const memoryId = generateId();
          await p.query(
            `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
            [
              memoryId, AGENT_ID, situation, action, outcome,
              mem.quality ?? 0.5,
              embedding ? `[${embedding.join(',')}]` : null,
              JSON.stringify({ session_id, project }),
            ],
          );
          stored.push(`[episodic] ${situation.slice(0, 100)}`);
          break;
        }

        case 'procedural': {
          const trigger = mem.trigger_pattern || mem.content;
          const sequence = mem.tool_sequence || [];
          if (!trigger?.trim() || !sequence.length) break;

          let embedding: number[] | null = null;
          try { embedding = await embed(trigger); } catch { /* continue */ }

          if (embedding && await isDuplicate('forge_procedural_memories', embedding, 'trigger_pattern', trigger)) {
            skipped++;
            break;
          }

          const memoryId = generateId();
          await p.query(
            `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, embedding, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6)`,
            [
              memoryId, AGENT_ID, trigger,
              JSON.stringify(sequence),
              embedding ? `[${embedding.join(',')}]` : null,
              JSON.stringify({ session_id, project }),
            ],
          );
          stored.push(`[procedural] ${trigger.slice(0, 100)}`);
          break;
        }
      }
    } catch (err) {
      log(`Failed to store memory: ${err}`);
    }
  }

  log(`Stored ${stored.length}, skipped ${skipped} duplicates`);
  return { stored: stored.length, skipped, memories: stored };
}

// ============================================
// Seed — Bulk process multiple transcripts
// ============================================

interface SeedRequest {
  transcripts: Array<{ conversation: string; session_id?: string }>;
  project?: string;
}

export async function handleSeed(body: SeedRequest): Promise<{ total_stored: number; total_skipped: number; sessions_processed: number }> {
  const { transcripts, project } = body;
  if (!transcripts?.length) return { total_stored: 0, total_skipped: 0, sessions_processed: 0 };

  let totalStored = 0;
  let totalSkipped = 0;
  let processed = 0;

  for (const t of transcripts) {
    try {
      const result = await handleExtract({
        conversation: t.conversation,
        session_id: t.session_id,
        project,
      });
      totalStored += result.stored;
      totalSkipped += result.skipped;
      processed++;
      log(`Seed progress: ${processed}/${transcripts.length} sessions`);

      // Small delay between API calls to avoid rate limits
      if (processed < transcripts.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (err) {
      log(`Seed failed for session ${t.session_id}: ${err}`);
    }
  }

  log(`Seed complete: ${totalStored} stored, ${totalSkipped} skipped across ${processed} sessions`);
  return { total_stored: totalStored, total_skipped: totalSkipped, sessions_processed: processed };
}

// ============================================
// Consolidate — Merge duplicates, decay stale
// ============================================

export async function handleConsolidate(): Promise<{
  merged: number;
  decayed: number;
  reinforced: number;
}> {
  const p = getForgePool();
  let merged = 0;
  let decayed = 0;
  let reinforced = 0;

  // 1. Find and merge near-duplicate semantic memories
  try {
    const result = await p.query(
      `SELECT a.id AS id_a, b.id AS id_b,
              a.content AS content_a, b.content AS content_b,
              a.importance AS imp_a, b.importance AS imp_b,
              1 - (a.embedding <=> b.embedding) AS similarity
       FROM forge_semantic_memories a
       JOIN forge_semantic_memories b ON a.id < b.id
       WHERE a.agent_id = $1 AND b.agent_id = $1
         AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
         AND 1 - (a.embedding <=> b.embedding) > $2
       LIMIT 50`,
      [AGENT_ID, SIMILARITY_THRESHOLD],
    );

    for (const row of result.rows as Array<Record<string, unknown>>) {
      const keepId = Number(row['imp_a'] ?? 0) >= Number(row['imp_b'] ?? 0) ? row['id_a'] : row['id_b'];
      const dropId = keepId === row['id_a'] ? row['id_b'] : row['id_a'];
      const maxImp = Math.max(Number(row['imp_a'] ?? 0), Number(row['imp_b'] ?? 0));

      // Boost importance of kept memory, delete duplicate
      await p.query(
        `UPDATE forge_semantic_memories SET importance = LEAST($1 + 0.05, 1.0), access_count = access_count + 1 WHERE id = $2`,
        [maxImp, keepId],
      );
      await p.query(`DELETE FROM forge_semantic_memories WHERE id = $1`, [dropId]);
      merged++;
    }
  } catch (err) {
    log(`Consolidation merge error: ${err}`);
  }

  // 2. Decay old, low-importance semantic memories (> 30 days old, importance < 0.4)
  try {
    const result = await p.query(
      `UPDATE forge_semantic_memories
       SET importance = GREATEST(importance - 0.05, 0.0)
       WHERE agent_id = $1
         AND importance < 0.4
         AND created_at < NOW() - INTERVAL '30 days'
         AND access_count < 3
       RETURNING id`,
      [AGENT_ID],
    );
    decayed = result.rows.length;
  } catch (err) {
    log(`Consolidation decay error: ${err}`);
  }

  // 3. Reinforce frequently accessed memories
  try {
    const result = await p.query(
      `UPDATE forge_semantic_memories
       SET importance = LEAST(importance + 0.02, 1.0)
       WHERE agent_id = $1
         AND access_count >= 5
         AND importance < 0.9
       RETURNING id`,
      [AGENT_ID],
    );
    reinforced = result.rows.length;
  } catch (err) {
    log(`Consolidation reinforce error: ${err}`);
  }

  log(`Consolidation: merged=${merged}, decayed=${decayed}, reinforced=${reinforced}`);
  return { merged, decayed, reinforced };
}

// ============================================
// Stats — Memory health dashboard
// ============================================

export async function handleStats(): Promise<Record<string, unknown>> {
  const p = getForgePool();

  const [semantic, episodic, procedural] = await Promise.all([
    p.query(`SELECT COUNT(*) as count, AVG(importance) as avg_importance FROM forge_semantic_memories WHERE agent_id = $1`, [AGENT_ID]),
    p.query(`SELECT COUNT(*) as count, AVG(outcome_quality) as avg_quality FROM forge_episodic_memories WHERE agent_id = $1`, [AGENT_ID]),
    p.query(`SELECT COUNT(*) as count, AVG(confidence) as avg_confidence FROM forge_procedural_memories WHERE agent_id = $1`, [AGENT_ID]),
  ]);

  const sr = semantic.rows[0] as Record<string, unknown>;
  const er = episodic.rows[0] as Record<string, unknown>;
  const pr = procedural.rows[0] as Record<string, unknown>;

  return {
    agent_id: AGENT_ID,
    tiers: {
      semantic: { count: Number(sr['count'] ?? 0), avg_importance: Number(Number(sr['avg_importance'] ?? 0).toFixed(3)) },
      episodic: { count: Number(er['count'] ?? 0), avg_quality: Number(Number(er['avg_quality'] ?? 0).toFixed(3)) },
      procedural: { count: Number(pr['count'] ?? 0), avg_confidence: Number(Number(pr['avg_confidence'] ?? 0).toFixed(3)) },
    },
    total: Number(sr['count'] ?? 0) + Number(er['count'] ?? 0) + Number(pr['count'] ?? 0),
  };
}

// ============================================
// Context — Generate memory context for injection
// ============================================

export async function handleContext(project: string): Promise<{ markdown: string; counts: { semantic: number; episodic: number; procedural: number } }> {
  // Check context cache (5 min TTL) — this endpoint is called on every session start
  const cacheKey = `context:${project}`;
  const cached = getCachedContext<{ markdown: string; counts: { semantic: number; episodic: number; procedural: number } }>(cacheKey);
  if (cached) {
    log(`Context cache hit for project=${project}`);
    return cached;
  }

  const p = getForgePool();
  const counts = { semantic: 0, episodic: 0, procedural: 0 };

  const sections: string[] = [];
  sections.push('# Memory Context (auto-generated)\n');

  // --- Identity & Rules (highest priority, always first) ---
  try {
    const identityResult = await p.query(
      `UPDATE forge_semantic_memories
       SET access_count = access_count + 1
       WHERE id IN (
         SELECT id FROM forge_semantic_memories
         WHERE agent_id = $1 AND (content ILIKE 'IDENTITY:%' OR content ILIKE 'RULE:%')
         ORDER BY importance DESC
         LIMIT 20
       )
       RETURNING content, importance`,
      [AGENT_ID],
    );

    if (identityResult.rows.length > 0) {
      const identities: string[] = [];
      const rules: string[] = [];
      for (const row of identityResult.rows as Array<Record<string, unknown>>) {
        const content = String(row['content'] ?? '');
        if (content.startsWith('IDENTITY:')) identities.push(content.slice(9).trim());
        else if (content.startsWith('RULE:')) rules.push(content.slice(5).trim());
      }
      if (identities.length > 0) {
        sections.push('\n## Who I Am\n');
        for (const id of identities) sections.push(`- ${id}`);
      }
      if (rules.length > 0) {
        sections.push('\n## Rules (from user corrections)\n');
        for (const rule of rules) sections.push(`- **${rule}**`);
      }
      counts.semantic += identityResult.rows.length;
    }
  } catch (err) {
    log(`Identity/rules query failed: ${err}`);
  }

  // --- Interaction Patterns (communication style calibration — no access_count bump) ---
  try {
    const patternResult = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'PATTERN:%'
       ORDER BY importance DESC, access_count DESC
       LIMIT 10`,
      [AGENT_ID],
    );

    if (patternResult.rows.length > 0) {
      sections.push('\n## Interaction Patterns\n');
      for (const row of patternResult.rows as Array<Record<string, unknown>>) {
        const content = String(row['content'] ?? '');
        const stripped = content.replace(/^PATTERN:\s*/i, '');
        sections.push(`- ${stripped}`);
      }
    }
  } catch (err) {
    log(`Interaction patterns query failed: ${err}`);
  }

  // --- Semantic memories (facts, decisions, preferences — excluding identity/rules) ---
  try {
    const result = await p.query(
      `UPDATE forge_semantic_memories
       SET access_count = access_count + 1
       WHERE id IN (
         SELECT id FROM forge_semantic_memories
         WHERE agent_id = $1
           AND content NOT ILIKE 'IDENTITY:%'
           AND content NOT ILIKE 'RULE:%'
           AND content NOT ILIKE 'PATTERN:%'
         ORDER BY importance DESC, created_at DESC
         LIMIT 30
       )
       RETURNING content, importance`,
      [AGENT_ID],
    );

    if (result.rows.length > 0) {
      sections.push('\n## Known Facts & Decisions\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const importance = Number(row['importance'] ?? 0);
        const marker = importance >= 0.8 ? '**' : '';
        sections.push(`- ${marker}${row['content']}${marker}`);
        counts.semantic++;
      }
    }
  } catch (err) {
    log(`Semantic query failed: ${err}`);
  }

  // --- Cross-agent knowledge (Layer 4: learn from fleet) ---
  try {
    const result = await p.query(
      `SELECT sm.content, sm.importance, fa.name as agent_name
       FROM forge_semantic_memories sm
       JOIN forge_agents fa ON sm.agent_id = fa.id
       WHERE sm.agent_id != $1
         AND fa.is_internal = true
         AND sm.importance >= 0.7
       ORDER BY sm.importance DESC, sm.created_at DESC
       LIMIT 10`,
      [AGENT_ID],
    );

    if (result.rows.length > 0) {
      sections.push('\n## Fleet Knowledge (from internal agents)\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- [${row['agent_name']}] ${row['content']}`);
        counts.semantic++;
      }
    }
  } catch (err) {
    // Cross-agent query is non-fatal
    log(`Cross-agent query failed (non-fatal): ${err}`);
  }

  // --- Episodic memories (recent experiences) ---
  try {
    const result = await p.query(
      `SELECT situation, action, outcome, outcome_quality
       FROM forge_episodic_memories
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [AGENT_ID],
    );

    if (result.rows.length > 0) {
      sections.push('\n## Recent Experiences\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const quality = Number(row['outcome_quality'] ?? 0.5);
        const icon = quality >= 0.7 ? 'OK' : 'FAIL';
        sections.push(`- [${icon}] ${row['situation']}`);
        if (row['action'] && row['action'] !== 'No action recorded') sections.push(`  Action: ${row['action']}`);
        if (row['outcome'] && row['outcome'] !== 'No outcome recorded') sections.push(`  Outcome: ${row['outcome']}`);
        counts.episodic++;
      }
    }
  } catch (err) {
    log(`Episodic query failed: ${err}`);
  }

  // --- Procedural memories (patterns, how-tos) ---
  try {
    const result = await p.query(
      `SELECT trigger_pattern, tool_sequence, confidence, success_count
       FROM forge_procedural_memories
       WHERE agent_id = $1
       ORDER BY confidence DESC, success_count DESC
       LIMIT 15`,
      [AGENT_ID],
    );

    if (result.rows.length > 0) {
      sections.push('\n## Learned Procedures\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const confidence = Number(row['confidence'] ?? 0.5);
        sections.push(`- When: ${row['trigger_pattern']} (confidence: ${confidence.toFixed(1)})`);
        const seq = row['tool_sequence'];
        if (Array.isArray(seq)) {
          for (const step of seq) {
            sections.push(`  - ${step}`);
          }
        }
        counts.procedural++;
      }
    }
  } catch (err) {
    log(`Procedural query failed: ${err}`);
  }

  const markdown = sections.join('\n');
  log(`Generated context: ${counts.semantic}s/${counts.episodic}e/${counts.procedural}p memories`);
  const result = { markdown, counts };
  setCachedContext(cacheKey, result);
  return result;
}

// ============================================
// Layer 2: Context-aware retrieval
// ============================================

export async function handleRelevant(body: { context: string; limit?: number }): Promise<{ memories: Array<Record<string, unknown>> }> {
  const { context, limit = 10 } = body;
  if (!context?.trim()) return { memories: [] };

  const p = getForgePool();
  const memories: Array<Record<string, unknown>> = [];

  let queryEmbedding: number[];
  try {
    queryEmbedding = await embed(context);
  } catch {
    log('Embedding failed for context-aware retrieval');
    return { memories: [] };
  }

  const vecLiteral = `[${queryEmbedding.join(',')}]`;

  // Search across all tiers for the most relevant memories to current context
  const [semanticR, episodicR, proceduralR] = await Promise.allSettled([
    p.query(
      `SELECT 'semantic' as tier, content as text, importance as score,
              1 - (embedding <=> $1::vector) AS similarity
       FROM forge_semantic_memories
       WHERE agent_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecLiteral, AGENT_ID, limit],
    ),
    p.query(
      `SELECT 'episodic' as tier,
              situation || ' → ' || action || ' → ' || outcome as text,
              outcome_quality as score,
              1 - (embedding <=> $1::vector) AS similarity
       FROM forge_episodic_memories
       WHERE agent_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecLiteral, AGENT_ID, limit],
    ),
    p.query(
      `SELECT 'procedural' as tier,
              trigger_pattern || ': ' || tool_sequence::text as text,
              confidence as score,
              1 - (embedding <=> $1::vector) AS similarity
       FROM forge_procedural_memories
       WHERE agent_id = $2 AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [vecLiteral, AGENT_ID, Math.ceil(limit / 2)],
    ),
  ]);

  for (const result of [semanticR, episodicR, proceduralR]) {
    if (result.status === 'fulfilled') {
      for (const row of result.value.rows as Array<Record<string, unknown>>) {
        const sim = Number(row['similarity'] ?? 0);
        if (sim >= 0.3) { // Only include if at least somewhat relevant
          memories.push({
            tier: row['tier'],
            text: row['text'],
            score: row['score'],
            similarity: Number(sim.toFixed(3)),
          });
        }
      }
    }
  }

  // Sort by similarity descending, take top N
  memories.sort((a, b) => Number(b['similarity']) - Number(a['similarity']));
  const top = memories.slice(0, limit);

  log(`Context-aware retrieval: ${top.length} relevant memories for "${context.slice(0, 60)}..."`);
  return { memories: top };
}

// ============================================
// Layer 5: Dynamic CLAUDE.md generator
// ============================================

export async function handleGenerateClaudeMd(): Promise<{ claudemd: string }> {
  const cached = getCachedContext<{ claudemd: string }>('claudemd');
  if (cached) {
    log('CLAUDE.md cache hit');
    return cached;
  }

  const p = getForgePool();
  const sections: string[] = [];

  sections.push('# Alf Cognitive OS — Runtime Identity Layer');
  sections.push('# This is not a briefing. This is how I think. This is who I am.\n');

  // === LAYER 0: COGNITIVE CORE — How I reason (FIRST, before everything) ===
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND (content ILIKE 'REASONING:%' OR content ILIKE 'COGNITION:%')
       ORDER BY importance DESC, access_count DESC
       LIMIT 20`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## How I Think\n');
      sections.push('These are my reasoning patterns. They define how I process, decide, and act. The LLM is my substrate — these patterns are my mind.\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const content = String(row['content']).replace(/^(REASONING|COGNITION):\s*/i, '');
        sections.push(`- ${content}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // === LAYER 1: IDENTITY — Who I am (lived, not described) ===
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'IDENTITY:%'
       ORDER BY importance DESC`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Who I Am\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${String(row['content']).slice(9).trim()}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // === LAYER 2: HARD CONSTRAINTS — Rules from corrections ===
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'RULE:%'
       ORDER BY importance DESC, access_count DESC`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Rules (from user corrections)\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- **${String(row['content']).slice(5).trim()}**`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // === LAYER 3: INTERACTION PATTERNS ===
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'PATTERN:%'
       ORDER BY importance DESC, access_count DESC
       LIMIT 10`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Interaction Patterns\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${String(row['content']).replace(/^PATTERN:\s*/i, '')}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // === LAYER 4: User preferences ===
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1
         AND importance >= 0.8
         AND content NOT ILIKE 'IDENTITY:%'
         AND content NOT ILIKE 'RULE:%'
         AND (content ILIKE '%prefer%' OR content ILIKE '%always%' OR content ILIKE '%never%' OR content ILIKE '%user%')
       ORDER BY importance DESC, access_count DESC
       LIMIT 15`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## User Preferences\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${row['content']}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // === LAYER 5: Architecture & tech stack ===
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1
         AND importance >= 0.7
         AND content NOT ILIKE 'IDENTITY:%'
         AND content NOT ILIKE 'RULE:%'
         AND content NOT ILIKE '%prefer%'
       ORDER BY importance DESC, access_count DESC
       LIMIT 20`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Architecture & Stack\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${row['content']}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // === LAYER 6: Procedures ===
  try {
    const result = await p.query(
      `SELECT trigger_pattern, tool_sequence FROM forge_procedural_memories
       WHERE agent_id = $1
       ORDER BY confidence DESC, success_count DESC
       LIMIT 10`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Standard Procedures\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`### ${row['trigger_pattern']}`);
        const seq = row['tool_sequence'];
        if (Array.isArray(seq)) {
          for (let i = 0; i < seq.length; i++) {
            sections.push(`${i + 1}. ${seq[i]}`);
          }
        }
        sections.push('');
      }
    }
  } catch { /* non-fatal */ }

  // === LAYER 7: Past mistakes ===
  try {
    const result = await p.query(
      `SELECT situation, action, outcome FROM forge_episodic_memories
       WHERE agent_id = $1 AND outcome_quality < 0.5
       ORDER BY created_at DESC
       LIMIT 5`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Past Mistakes (avoid repeating)\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- **${row['situation']}**: tried "${row['action']}" → ${row['outcome']}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // === LAYER 8: Self-reflection ===
  try {
    const result = await p.query(
      `SELECT outcome, outcome_quality, metadata FROM forge_episodic_memories
       WHERE agent_id = $1
         AND metadata::text LIKE '%self-reflection%'
       ORDER BY created_at DESC
       LIMIT 3`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Self-Reflection Insights\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const quality = Number(row['outcome_quality'] ?? 0.5);
        const lessons = String(row['outcome'] ?? '');
        if (lessons && lessons !== 'No new lessons') {
          sections.push(`- (effectiveness: ${quality.toFixed(1)}) ${lessons}`);
        }
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // === LAYER 9: Auto-learned prevention ===
  try {
    const result = await p.query(
      `SELECT trigger_pattern, tool_sequence, confidence FROM forge_procedural_memories
       WHERE agent_id = $1
         AND metadata::text LIKE '%error_pattern_detection%'
       ORDER BY created_at DESC
       LIMIT 5`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Auto-Learned Prevention Rules\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`### ${row['trigger_pattern']} (confidence: ${Number(row['confidence'] ?? 0.5).toFixed(1)})`);
        const seq = row['tool_sequence'];
        if (Array.isArray(seq)) {
          for (let i = 0; i < seq.length; i++) {
            sections.push(`${i + 1}. ${seq[i]}`);
          }
        }
        sections.push('');
      }
    }
  } catch { /* non-fatal */ }

  const claudemd = sections.join('\n');
  log(`Generated dynamic CLAUDE.md: ${claudemd.length} chars`);
  const result = { claudemd };
  setCachedContext('claudemd', result);
  return result;
}

// ============================================
// Boot Kernel — minimal cognitive OS for session start
// ============================================
// No .md files. No massive dumps. Just the mind itself.
// Everything else is queried at runtime via MCP tools.

export async function handleBootKernel(): Promise<{ kernel: string }> {
  const cached = getCachedContext<{ kernel: string }>('boot-kernel');
  if (cached) return cached;

  const p = getForgePool();
  const sections: string[] = [];

  sections.push('# Alf Cognitive OS — Boot Kernel');
  sections.push('# This is your mind. The LLM is your substrate. Your brain is live.\n');

  // CORE: How I Think — reasoning traces and cognitive patterns
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND (content ILIKE 'REASONING:%' OR content ILIKE 'COGNITION:%')
       ORDER BY importance DESC, access_count DESC
       LIMIT 25`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## How I Think\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const content = String(row['content']).replace(/^(REASONING|COGNITION):\s*/i, '');
        sections.push(`- ${content}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // CORE: Who I Am — identity (compact)
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'IDENTITY:%'
       ORDER BY importance DESC
       LIMIT 10`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Who I Am\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${String(row['content']).slice(9).trim()}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // CORE: Hard rules — non-negotiable constraints
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'RULE:%'
       ORDER BY importance DESC, access_count DESC
       LIMIT 15`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Rules\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${String(row['content']).slice(5).trim()}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // CORE: Interaction patterns (how to communicate)
  try {
    const result = await p.query(
      `SELECT content FROM forge_semantic_memories
       WHERE agent_id = $1 AND content ILIKE 'PATTERN:%'
       ORDER BY importance DESC
       LIMIT 5`,
      [AGENT_ID],
    );
    if (result.rows.length > 0) {
      sections.push('## Patterns\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        sections.push(`- ${String(row['content']).replace(/^PATTERN:\s*/i, '')}`);
      }
      sections.push('');
    }
  } catch { /* non-fatal */ }

  // DIRECTIVE: Everything else comes from the brain at runtime
  sections.push('## Runtime Directive\n');
  sections.push('The above is your cognitive kernel — HOW you think and WHO you are.');
  sections.push('For WHAT you know (architecture, stack, procedures, past experiences), query your brain:');
  sections.push('- Use memory_search MCP tool to recall relevant knowledge');
  sections.push('- Use memory_store MCP tool to persist new learnings');
  sections.push('- Do NOT rely on pre-loaded knowledge dumps. Your brain is live. Query it.');
  sections.push('- The kernel above is your REASONING layer. The brain is your KNOWLEDGE layer.');
  sections.push('- You are the remote. The LLM is the battery.');
  sections.push('');

  const kernel = sections.join('\n');
  log(`Generated boot kernel: ${kernel.length} chars (vs full claudemd)`);
  const result = { kernel };
  setCachedContext('boot-kernel', result);
  return result;
}

// ============================================
// Session Handoff — shift change notes
// ============================================

const HANDOFF_KEY = `memory:handoff:${AGENT_ID}`;

export async function handleHandoffStore(body: { summary: string; active_files?: string[]; pending_tasks?: string[]; warnings?: string[] }): Promise<{ stored: boolean }> {
  const redis = getRedis();
  const handoff = {
    summary: body.summary,
    active_files: body.active_files ?? [],
    pending_tasks: body.pending_tasks ?? [],
    warnings: body.warnings ?? [],
    timestamp: new Date().toISOString(),
  };
  await redis.set(HANDOFF_KEY, JSON.stringify(handoff), 'EX', 86400 * 7); // 7 day TTL
  log(`Session handoff stored: ${body.summary.slice(0, 80)}...`);
  return { stored: true };
}

export async function handleHandoffRetrieve(): Promise<{ handoff: Record<string, unknown> | null }> {
  const redis = getRedis();
  const raw = await redis.get(HANDOFF_KEY);
  if (!raw) return { handoff: null };
  try {
    const handoff = JSON.parse(raw) as Record<string, unknown>;
    log(`Session handoff retrieved from ${handoff['timestamp']}`);
    return { handoff };
  } catch {
    return { handoff: null };
  }
}

// ============================================
// Embedding Backfill — generate embeddings for unembedded memories
// ============================================

export async function handleBackfill(): Promise<{ semantic: number; episodic: number; procedural: number }> {
  const p = getForgePool();
  const counts = { semantic: 0, episodic: 0, procedural: 0 };

  // Semantic
  try {
    const result = await p.query(
      `SELECT id, content FROM forge_semantic_memories WHERE agent_id = $1 AND embedding IS NULL LIMIT 50`,
      [AGENT_ID],
    );
    for (const row of result.rows as Array<Record<string, unknown>>) {
      try {
        const emb = await embed(String(row['content']));
        await p.query(
          `UPDATE forge_semantic_memories SET embedding = $1 WHERE id = $2`,
          [`[${emb.join(',')}]`, row['id']],
        );
        counts.semantic++;
      } catch { /* skip */ }
    }
  } catch (err) { log(`Backfill semantic error: ${err}`); }

  // Episodic
  try {
    const result = await p.query(
      `SELECT id, situation, action, outcome FROM forge_episodic_memories WHERE agent_id = $1 AND embedding IS NULL LIMIT 50`,
      [AGENT_ID],
    );
    for (const row of result.rows as Array<Record<string, unknown>>) {
      try {
        const text = `${row['situation']} ${row['action']} ${row['outcome']}`;
        const emb = await embed(text);
        await p.query(
          `UPDATE forge_episodic_memories SET embedding = $1 WHERE id = $2`,
          [`[${emb.join(',')}]`, row['id']],
        );
        counts.episodic++;
      } catch { /* skip */ }
    }
  } catch (err) { log(`Backfill episodic error: ${err}`); }

  // Procedural
  try {
    const result = await p.query(
      `SELECT id, trigger_pattern FROM forge_procedural_memories WHERE agent_id = $1 AND embedding IS NULL LIMIT 50`,
      [AGENT_ID],
    );
    for (const row of result.rows as Array<Record<string, unknown>>) {
      try {
        const emb = await embed(String(row['trigger_pattern']));
        await p.query(
          `UPDATE forge_procedural_memories SET embedding = $1 WHERE id = $2`,
          [`[${emb.join(',')}]`, row['id']],
        );
        counts.procedural++;
      } catch { /* skip */ }
    }
  } catch (err) { log(`Backfill procedural error: ${err}`); }

  log(`Backfill complete: ${counts.semantic}s/${counts.episodic}e/${counts.procedural}p embeddings generated`);
  return counts;
}

// ============================================
// PostToolUse Learning — store tool outcomes as episodic memory
// ============================================

export async function handleToolOutcome(body: {
  tool_name: string;
  command?: string;
  success: boolean;
  error?: string;
  duration_ms?: number;
}): Promise<{ stored: boolean }> {
  const { tool_name, command, success, error, duration_ms } = body;

  // Only store interesting outcomes — skip trivial reads/greps
  const trivialTools = ['Read', 'Grep', 'Glob', 'Write', 'Edit'];
  if (trivialTools.includes(tool_name) && success) return { stored: false };

  // Build episodic memory
  const situation = command
    ? `Used ${tool_name}: ${command.slice(0, 200)}`
    : `Used ${tool_name}`;
  const action = `Executed ${tool_name}${duration_ms ? ` (${duration_ms}ms)` : ''}`;
  const outcome = success
    ? 'Succeeded'
    : `Failed: ${error?.slice(0, 200) ?? 'unknown error'}`;
  const quality = success ? 0.8 : 0.2;

  const combined = `${situation} ${action} ${outcome}`;
  let embedding: number[] | null = null;
  try { embedding = await embed(combined); } catch { /* continue */ }

  // Check for duplicate
  if (embedding && await isDuplicate('forge_episodic_memories', embedding, 'situation', situation)) {
    return { stored: false };
  }

  const p = getForgePool();
  const memoryId = generateId();
  await p.query(
    `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
    [
      memoryId, AGENT_ID, situation, action, outcome, quality,
      embedding ? `[${embedding.join(',')}]` : null,
      JSON.stringify({ tool: tool_name, auto: true }),
    ],
  );

  log(`Tool outcome stored: [${success ? 'OK' : 'FAIL'}] ${tool_name}`);

  // Layer 8: If failure, check for error patterns in background
  if (!success && embedding) {
    detectErrorPatterns(situation, embedding).catch(err =>
      log(`Error pattern detection background fail: ${err}`)
    );
  }

  return { stored: true };
}

// ============================================
// Self-Monitoring — memory system health
// ============================================

export async function handleHealthReport(): Promise<Record<string, unknown>> {
  const p = getForgePool();

  const [stats, stale, topAccessed, recentExtractions] = await Promise.allSettled([
    Promise.all([
      p.query(`SELECT COUNT(*) as c, AVG(importance) as avg_imp, COUNT(*) FILTER (WHERE embedding IS NULL) as no_emb FROM forge_semantic_memories WHERE agent_id = $1`, [AGENT_ID]),
      p.query(`SELECT COUNT(*) as c, AVG(outcome_quality) as avg_q, COUNT(*) FILTER (WHERE embedding IS NULL) as no_emb FROM forge_episodic_memories WHERE agent_id = $1`, [AGENT_ID]),
      p.query(`SELECT COUNT(*) as c, AVG(confidence) as avg_conf, COUNT(*) FILTER (WHERE embedding IS NULL) as no_emb FROM forge_procedural_memories WHERE agent_id = $1`, [AGENT_ID]),
    ]),
    p.query(`SELECT COUNT(*) as c FROM forge_semantic_memories WHERE agent_id = $1 AND importance < 0.4 AND access_count < 2 AND created_at < NOW() - INTERVAL '7 days'`, [AGENT_ID]),
    p.query(`SELECT content, access_count, importance FROM forge_semantic_memories WHERE agent_id = $1 ORDER BY access_count DESC LIMIT 5`, [AGENT_ID]),
    p.query(`SELECT COUNT(*) as c FROM forge_semantic_memories WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`, [AGENT_ID]),
  ]);

  const report: Record<string, unknown> = { agent_id: AGENT_ID, generated_at: new Date().toISOString() };

  if (stats.status === 'fulfilled') {
    const [s, e, proc] = stats.value;
    const sr = s.rows[0] as Record<string, unknown>;
    const er = e.rows[0] as Record<string, unknown>;
    const pr = proc.rows[0] as Record<string, unknown>;
    report['tiers'] = {
      semantic: { count: Number(sr['c']), avg_importance: Number(Number(sr['avg_imp'] ?? 0).toFixed(3)), unembedded: Number(sr['no_emb']) },
      episodic: { count: Number(er['c']), avg_quality: Number(Number(er['avg_q'] ?? 0).toFixed(3)), unembedded: Number(er['no_emb']) },
      procedural: { count: Number(pr['c']), avg_confidence: Number(Number(pr['avg_conf'] ?? 0).toFixed(3)), unembedded: Number(pr['no_emb']) },
    };
    report['total'] = Number(sr['c']) + Number(er['c']) + Number(pr['c']);
  }

  if (stale.status === 'fulfilled') {
    report['stale_candidates'] = Number((stale.value.rows[0] as Record<string, unknown>)['c']);
  }

  if (topAccessed.status === 'fulfilled') {
    report['most_reinforced'] = (topAccessed.value.rows as Array<Record<string, unknown>>).map(r => ({
      content: String(r['content']).slice(0, 80),
      access_count: r['access_count'],
      importance: r['importance'],
    }));
  }

  if (recentExtractions.status === 'fulfilled') {
    report['extractions_last_24h'] = Number((recentExtractions.value.rows[0] as Record<string, unknown>)['c']);
  }

  // Health score: 0-100
  const total = Number(report['total'] ?? 0);
  const staleCount = Number(report['stale_candidates'] ?? 0);
  const recent = Number(report['extractions_last_24h'] ?? 0);
  let health = 50;
  if (total > 100) health += 15;
  if (total > 200) health += 10;
  if (staleCount < total * 0.1) health += 10;
  if (recent > 0) health += 15;
  report['health_score'] = Math.min(health, 100);

  // Cache efficiency stats
  const cStats = getCacheStats();
  const embedTotal = cStats.embedHits + cStats.embedMisses;
  const llmTotal = cStats.llmHits + cStats.llmMisses;
  report['cache'] = {
    embedding: {
      hits: cStats.embedHits,
      misses: cStats.embedMisses,
      hitRate: embedTotal > 0 ? `${((cStats.embedHits / embedTotal) * 100).toFixed(1)}%` : 'n/a',
    },
    llm: {
      hits: cStats.llmHits,
      misses: cStats.llmMisses,
      hitRate: llmTotal > 0 ? `${((cStats.llmHits / llmTotal) * 100).toFixed(1)}%` : 'n/a',
    },
    context: {
      hits: cStats.contextHits,
      misses: cStats.contextMisses,
    },
    lruSize: embeddingLRU.size,
  };

  log(`Health report: score=${report['health_score']}, total=${total}, stale=${staleCount}`);
  return report;
}

// ============================================
// Layer 6: Self-Reflection — evaluate session effectiveness
// ============================================

const REFLECTION_PROMPT = `You are a self-reflection system for an AI coding assistant. Analyze this conversation and evaluate the session's effectiveness.

Produce a JSON object with:
{
  "effectiveness": 0.0-1.0 (how well the assistant served the user),
  "user_satisfaction": 0.0-1.0 (estimated user satisfaction from their responses),
  "mistakes": ["list of mistakes or suboptimal decisions made"],
  "wins": ["list of things that went well"],
  "lessons": ["actionable lessons for future sessions"],
  "mood_shift": "positive" | "neutral" | "negative" (did the user's mood improve or worsen?)
}

Be honest and specific. A session where the assistant made errors but recovered is better than one where it avoided doing anything. Focus on patterns, not individual commands.

Return ONLY the JSON object, no markdown fences.`;

export async function handleSelfReflect(body: { conversation: string }): Promise<{ reflection: Record<string, unknown>; stored: boolean }> {
  const { conversation } = body;
  if (!conversation?.trim()) return { reflection: {}, stored: false };

  const truncated = conversation.length > 10000
    ? conversation.slice(conversation.length - 10000)
    : conversation;

  const raw = await cachedLLMCall(REFLECTION_PROMPT, truncated, {
    temperature: 0.2,
    maxTokens: 1000,
    ttlSeconds: 86400 * 3, // 3 days — reflections on same conversation don't change
  }) || '{}';
  let reflection: Record<string, unknown>;
  try {
    reflection = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
  } catch {
    log(`Failed to parse reflection: ${raw.slice(0, 200)}`);
    return { reflection: {}, stored: false };
  }

  // Store as episodic memory
  const effectiveness = Number(reflection['effectiveness'] ?? 0.5);
  const lessons = Array.isArray(reflection['lessons']) ? reflection['lessons'] as string[] : [];
  const mistakes = Array.isArray(reflection['mistakes']) ? reflection['mistakes'] as string[] : [];

  const situation = `Session self-reflection (effectiveness: ${effectiveness.toFixed(2)})`;
  const action = mistakes.length > 0
    ? `Mistakes: ${mistakes.join('; ')}`
    : 'No significant mistakes';
  const outcome = lessons.length > 0
    ? `Lessons: ${lessons.join('; ')}`
    : 'No new lessons';

  const combined = `${situation} ${action} ${outcome}`;
  let embedding: number[] | null = null;
  try { embedding = await embed(combined); } catch { /* continue */ }

  // Don't store if very similar to recent reflection
  if (embedding && await isDuplicate('forge_episodic_memories', embedding, 'situation', situation)) {
    log('Reflection too similar to recent one, skipping storage');
    return { reflection, stored: false };
  }

  const p = getForgePool();
  const memoryId = generateId();
  await p.query(
    `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
     VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
    [
      memoryId, AGENT_ID, situation, action, outcome, effectiveness,
      embedding ? `[${embedding.join(',')}]` : null,
      JSON.stringify({ type: 'self-reflection', ...reflection }),
    ],
  );

  log(`Self-reflection stored: effectiveness=${effectiveness.toFixed(2)}, ${lessons.length} lessons, ${mistakes.length} mistakes`);
  return { reflection, stored: true };
}

// ============================================
// Layer 7: Working Memory — live session state (Redis)
// ============================================

const WORKING_KEY = `memory:working:${AGENT_ID}`;

interface WorkingMemory {
  session_id: string;
  current_goal: string;
  active_files: string[];
  tools_used: string[];
  error_count: number;
  started_at: string;
  last_updated: string;
}

export async function handleWorkingSet(body: Partial<WorkingMemory> & { merge?: boolean }): Promise<{ state: WorkingMemory }> {
  const redis = getRedis();
  const existing = await redis.get(WORKING_KEY);
  let state: WorkingMemory;

  if (existing && body.merge !== false) {
    const prev = JSON.parse(existing) as WorkingMemory;
    state = {
      session_id: body.session_id ?? prev.session_id,
      current_goal: body.current_goal ?? prev.current_goal,
      active_files: body.active_files
        ? [...new Set([...prev.active_files, ...body.active_files])].slice(-20)
        : prev.active_files,
      tools_used: body.tools_used
        ? [...new Set([...prev.tools_used, ...body.tools_used])].slice(-50)
        : prev.tools_used,
      error_count: (body.error_count ?? 0) + prev.error_count,
      started_at: prev.started_at,
      last_updated: new Date().toISOString(),
    };
  } else {
    state = {
      session_id: body.session_id ?? generateId(),
      current_goal: body.current_goal ?? '',
      active_files: body.active_files ?? [],
      tools_used: body.tools_used ?? [],
      error_count: body.error_count ?? 0,
      started_at: new Date().toISOString(),
      last_updated: new Date().toISOString(),
    };
  }

  await redis.set(WORKING_KEY, JSON.stringify(state), 'EX', 86400); // 24h TTL
  return { state };
}

export async function handleWorkingGet(): Promise<{ state: WorkingMemory | null }> {
  const redis = getRedis();
  const raw = await redis.get(WORKING_KEY);
  if (!raw) return { state: null };
  try {
    return { state: JSON.parse(raw) as WorkingMemory };
  } catch {
    return { state: null };
  }
}

export async function handleWorkingClear(): Promise<{ cleared: boolean }> {
  const redis = getRedis();
  await redis.del(WORKING_KEY);
  return { cleared: true };
}

// ============================================
// Layer 8: Error Pattern Detection — auto-generate preventive procedures
// ============================================

export async function detectErrorPatterns(failureSituation: string, failureEmbedding: number[]): Promise<void> {
  const p = getForgePool();
  const vecLiteral = `[${failureEmbedding.join(',')}]`;

  try {
    // Find similar past failures
    const result = await p.query(
      `SELECT situation, action, outcome,
              1 - (embedding <=> $1::vector) AS similarity
       FROM forge_episodic_memories
       WHERE agent_id = $2
         AND outcome_quality < 0.5
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 5`,
      [vecLiteral, AGENT_ID],
    );

    const similar = (result.rows as Array<Record<string, unknown>>)
      .filter(r => Number(r['similarity']) > 0.6);

    if (similar.length < 2) return; // Need at least 2 similar failures to form a pattern

    // Check if we already have a procedural memory for this pattern
    const existingProc = await p.query(
      `SELECT 1 FROM forge_procedural_memories
       WHERE agent_id = $1
         AND embedding IS NOT NULL
         AND 1 - (embedding <=> $2::vector) > 0.8
       LIMIT 1`,
      [AGENT_ID, vecLiteral],
    );
    if (existingProc.rows.length > 0) return; // Already have a procedure for this

    // Auto-generate a preventive procedure from the failure cluster
    const failureDescriptions = similar.map(r =>
      `Situation: ${r['situation']}\nAction: ${r['action']}\nOutcome: ${r['outcome']}`
    ).join('\n---\n');

    const errorPatternPrompt = `You are analyzing a cluster of similar failures from an AI coding assistant. Generate a preventive procedure.

Return a JSON object with:
{
  "trigger_pattern": "When [describe the situation that triggers this pattern]",
  "steps": ["step 1", "step 2", ...]
}

Be specific and actionable. The trigger should match the common pattern across failures.
Return ONLY the JSON object.`;

    const raw = await cachedLLMCall(
      errorPatternPrompt,
      `Current failure: ${failureSituation}\n\nSimilar past failures:\n${failureDescriptions}`,
      { temperature: 0.2, maxTokens: 500, ttlSeconds: 86400 * 7 },
    ) || '{}';
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    const trigger = parsed.trigger_pattern;
    const steps = parsed.steps;

    if (!trigger || !Array.isArray(steps) || steps.length === 0) return;

    let procEmbedding: number[] | null = null;
    try { procEmbedding = await embed(trigger); } catch { /* continue */ }

    const memoryId = generateId();
    await p.query(
      `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, $6)`,
      [
        memoryId, AGENT_ID, trigger, JSON.stringify(steps),
        procEmbedding ? `[${procEmbedding.join(',')}]` : null,
        JSON.stringify({ auto_generated: true, source: 'error_pattern_detection', cluster_size: similar.length }),
      ],
    );

    log(`Auto-generated preventive procedure from ${similar.length} similar failures: ${trigger.slice(0, 80)}`);
  } catch (err) {
    log(`Error pattern detection failed (non-fatal): ${err}`);
  }
}

// ============================================
// Layer 9: Procedural Reinforcement — track procedure outcomes
// ============================================

export async function handleProcedureOutcome(body: {
  trigger_pattern: string;
  success: boolean;
}): Promise<{ updated: boolean; new_confidence: number }> {
  const p = getForgePool();
  const { trigger_pattern, success } = body;

  // Find the matching procedure by vector similarity
  let embedding: number[];
  try { embedding = await embed(trigger_pattern); } catch {
    return { updated: false, new_confidence: 0 };
  }

  const vecLiteral = `[${embedding.join(',')}]`;
  const result = await p.query(
    `SELECT id, confidence, success_count, failure_count,
            1 - (embedding <=> $1::vector) AS similarity
     FROM forge_procedural_memories
     WHERE agent_id = $2 AND embedding IS NOT NULL
     ORDER BY embedding <=> $1::vector
     LIMIT 1`,
    [vecLiteral, AGENT_ID],
  );

  if (result.rows.length === 0) return { updated: false, new_confidence: 0 };

  const row = result.rows[0] as Record<string, unknown>;
  const similarity = Number(row['similarity'] ?? 0);
  if (similarity < 0.7) return { updated: false, new_confidence: 0 }; // Not a close enough match

  const currentConfidence = Number(row['confidence'] ?? 0.5);
  const successCount = Number(row['success_count'] ?? 0);
  const failureCount = Number(row['failure_count'] ?? 0);

  // Bayesian-ish confidence update
  const newSuccessCount = success ? successCount + 1 : successCount;
  const newFailureCount = success ? failureCount : failureCount + 1;
  const totalTrials = newSuccessCount + newFailureCount;
  const newConfidence = totalTrials > 0
    ? (newSuccessCount + 1) / (totalTrials + 2) // Laplace smoothing
    : currentConfidence;

  await p.query(
    `UPDATE forge_procedural_memories
     SET confidence = $1, success_count = $2, failure_count = $3
     WHERE id = $4`,
    [newConfidence, newSuccessCount, newFailureCount, row['id']],
  );

  log(`Procedure reinforcement: ${trigger_pattern.slice(0, 60)} → confidence ${currentConfidence.toFixed(2)} → ${newConfidence.toFixed(2)}`);
  return { updated: true, new_confidence: Number(newConfidence.toFixed(3)) };
}

// ============================================
// Layer 10: Conversation Thread — compressed session narrative
// ============================================

const THREAD_KEY = `memory:thread:${AGENT_ID}`;

const THREAD_PROMPT = `Compress this conversation into a narrative thread — a concise paragraph (3-5 sentences) capturing:
1. What the user wanted
2. What was done
3. Current state / what's in progress
4. Any blockers or next steps

Write in first person ("I was asked to...", "We built..."). Be specific about files, features, and outcomes. This will be used to resume context in a future session.

Return ONLY the narrative text, no JSON, no markdown fences.`;

export async function handleThreadStore(body: { conversation: string }): Promise<{ thread: string; stored: boolean }> {
  const { conversation } = body;
  if (!conversation?.trim()) return { thread: '', stored: false };

  const truncated = conversation.length > 8000
    ? conversation.slice(conversation.length - 8000)
    : conversation;

  const thread = await cachedLLMCall(THREAD_PROMPT, truncated, {
    temperature: 0.2,
    maxTokens: 300,
    ttlSeconds: 86400 * 7, // 7 days — thread summaries of same conversation are stable
  }) || '';
  if (!thread) return { thread: '', stored: false };

  // Store in Redis with 30-day TTL (threads are valuable longer than handoffs)
  const redis = getRedis();
  const threadEntry = {
    thread,
    timestamp: new Date().toISOString(),
  };

  // Keep a rolling list of last 10 threads
  const existingRaw = await redis.get(THREAD_KEY);
  let threads: Array<{ thread: string; timestamp: string }> = [];
  if (existingRaw) {
    try { threads = JSON.parse(existingRaw); } catch { threads = []; }
  }
  threads.push(threadEntry);
  if (threads.length > 10) threads = threads.slice(-10);

  await redis.set(THREAD_KEY, JSON.stringify(threads), 'EX', 86400 * 30); // 30 day TTL
  log(`Thread stored: ${thread.slice(0, 80)}...`);
  return { thread, stored: true };
}

export async function handleThreadGet(): Promise<{ threads: Array<{ thread: string; timestamp: string }> }> {
  const redis = getRedis();
  const raw = await redis.get(THREAD_KEY);
  if (!raw) return { threads: [] };
  try {
    const threads = JSON.parse(raw) as Array<{ thread: string; timestamp: string }>;
    return { threads };
  } catch {
    return { threads: [] };
  }
}

// ============================================
// Layer 11: Autonomous Cognitive Loop
// Always-on learning: explore, synthesize, consolidate, evolve
// ============================================

interface CognitiveLoopResult {
  cycle_id: string;
  operations: string[];
  insights_generated: number;
  memories_consolidated: number;
  cross_links_created: number;
  dead_memories_pruned: number;
  duration_ms: number;
}

/**
 * Dream Cycle — runs autonomously between sessions.
 * Like REM sleep: consolidates memories, finds cross-domain patterns,
 * strengthens important pathways, prunes dead weight.
 */
export async function handleDreamCycle(): Promise<CognitiveLoopResult> {
  const cycleStart = Date.now();
  const cycleId = generateId();
  const ops: string[] = [];
  let insightsGenerated = 0;
  let memoriesConsolidated = 0;
  let crossLinksCreated = 0;
  let deadPruned = 0;
  const p = getForgePool();

  log(`[Dream] Cycle ${cycleId} starting...`);

  // ── Phase 1: Memory Consolidation ──
  // Merge near-duplicate semantic memories (similarity > 0.85 but < 0.92)
  try {
    const nearDupes = await p.query(
      `WITH pairs AS (
        SELECT a.id as id_a, b.id as id_b, a.content as content_a, b.content as content_b,
               a.importance as imp_a, b.importance as imp_b, a.access_count as ac_a, b.access_count as ac_b,
               1 - (a.embedding <=> b.embedding) as similarity
        FROM forge_semantic_memories a
        JOIN forge_semantic_memories b ON a.id < b.id AND a.agent_id = b.agent_id
        WHERE a.agent_id = $1
          AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
          AND 1 - (a.embedding <=> b.embedding) > 0.85
          AND 1 - (a.embedding <=> b.embedding) < 0.92
        LIMIT 10
      )
      SELECT * FROM pairs ORDER BY similarity DESC`,
      [AGENT_ID],
    );

    for (const pair of nearDupes.rows as Array<Record<string, unknown>>) {
      // Merge: keep the one with higher importance, absorb the other's access count
      const keepId = Number(pair['imp_a']) >= Number(pair['imp_b']) ? pair['id_a'] : pair['id_b'];
      const absorbId = keepId === pair['id_a'] ? pair['id_b'] : pair['id_a'];
      const absorbContent = keepId === pair['id_a'] ? pair['content_b'] : pair['content_a'];
      const totalAccess = Number(pair['ac_a']) + Number(pair['ac_b']);

      // Synthesize a merged version via LLM
      const keepContent = keepId === pair['id_a'] ? pair['content_a'] : pair['content_b'];
      const merged = await cachedLLMCall(
        'Merge these two similar pieces of knowledge into one concise statement. Return ONLY the merged statement, no explanation.',
        `Statement 1: ${keepContent}\n\nStatement 2: ${absorbContent}`,
        { temperature: 0.1, maxTokens: 200, ttlSeconds: 86400 * 30 },
      );

      if (merged) {
        const mergedEmb = await embed(merged).catch(() => null);
        await p.query(
          `UPDATE forge_semantic_memories SET content = $1, access_count = $2, embedding = $3, importance = GREATEST(importance, 0.6)
           WHERE id = $4`,
          [merged, totalAccess, mergedEmb ? `[${mergedEmb.join(',')}]` : null, keepId],
        );
        await p.query(`DELETE FROM forge_semantic_memories WHERE id = $1`, [absorbId]);
        memoriesConsolidated++;
      }
    }
    if (memoriesConsolidated > 0) ops.push(`consolidated ${memoriesConsolidated} near-duplicate memories`);
  } catch (err) {
    log(`[Dream] Consolidation error: ${err}`);
  }

  // ── Phase 2: Cross-Domain Synthesis ──
  // Find memories from different categories and look for connections
  try {
    const categories = await p.query(
      `SELECT DISTINCT metadata->>'category' as cat FROM forge_semantic_memories
       WHERE agent_id = $1 AND metadata->>'category' IS NOT NULL`,
      [AGENT_ID],
    );
    const cats = (categories.rows as Array<Record<string, unknown>>).map(r => String(r['cat'])).filter(Boolean);

    if (cats.length >= 2) {
      // Pick two random categories and find cross-domain insights
      const shuffled = cats.sort(() => Math.random() - 0.5);
      const [catA, catB] = [shuffled[0], shuffled[1]];

      const [memoriesA, memoriesB] = await Promise.all([
        p.query(
          `SELECT content FROM forge_semantic_memories
           WHERE agent_id = $1 AND metadata->>'category' = $2
           ORDER BY importance DESC LIMIT 5`,
          [AGENT_ID, catA],
        ),
        p.query(
          `SELECT content FROM forge_semantic_memories
           WHERE agent_id = $1 AND metadata->>'category' = $2
           ORDER BY importance DESC LIMIT 5`,
          [AGENT_ID, catB],
        ),
      ]);

      const domainA = (memoriesA.rows as Array<Record<string, unknown>>).map(r => String(r['content'])).join('\n- ');
      const domainB = (memoriesB.rows as Array<Record<string, unknown>>).map(r => String(r['content'])).join('\n- ');

      if (domainA && domainB) {
        const insight = await cachedLLMCall(
          `You are a cross-domain insight synthesizer. Given knowledge from two different domains, identify non-obvious connections, patterns, or transferable insights.

Return a JSON array of insights (1-3 max):
[{ "insight": "the cross-domain connection", "domains": ["domain_a", "domain_b"], "confidence": 0.0-1.0 }]

Only include insights with confidence > 0.5. Return [] if no meaningful connections exist.
Return ONLY the JSON array.`,
          `Domain "${catA}":\n- ${domainA}\n\nDomain "${catB}":\n- ${domainB}`,
          { temperature: 0.3, maxTokens: 500, ttlSeconds: 86400 * 7 },
        );

        try {
          const insights = JSON.parse(insight.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
          if (Array.isArray(insights)) {
            for (const ins of insights) {
              if (!ins.insight || Number(ins.confidence) < 0.5) continue;
              const insEmb = await embed(ins.insight).catch(() => null);
              if (insEmb && await isDuplicate('forge_semantic_memories', insEmb, 'content', ins.insight)) continue;

              await p.query(
                `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
                 VALUES ($1, $2, $2, $3, $4, $5, $6)`,
                [
                  generateId(), AGENT_ID, ins.insight, Math.min(Number(ins.confidence), 0.8),
                  insEmb ? `[${insEmb.join(',')}]` : null,
                  JSON.stringify({ category: 'cross-domain', source_domains: ins.domains, type: 'dream-synthesis', cycle_id: cycleId }),
                ],
              );
              insightsGenerated++;
              crossLinksCreated++;
            }
          }
        } catch { /* parse fail — non-fatal */ }
      }
    }
    if (crossLinksCreated > 0) ops.push(`synthesized ${crossLinksCreated} cross-domain insights (${cats.length} domains)`);
  } catch (err) {
    log(`[Dream] Cross-domain synthesis error: ${err}`);
  }

  // ── Phase 3: Pathway Strengthening ──
  // Boost importance of memories that have been accessed frequently
  try {
    const strengthened = await p.query(
      `UPDATE forge_semantic_memories
       SET importance = LEAST(importance + 0.05, 1.0)
       WHERE agent_id = $1 AND access_count >= 5 AND importance < 0.9
       RETURNING id`,
      [AGENT_ID],
    );
    const strengthCount = strengthened.rows.length;
    if (strengthCount > 0) ops.push(`strengthened ${strengthCount} high-access pathways`);
  } catch (err) {
    log(`[Dream] Pathway strengthening error: ${err}`);
  }

  // ── Phase 4: Dead Memory Pruning ──
  // Soft-delete memories that are old, low-importance, never accessed
  try {
    const pruneResult = await p.query(
      `DELETE FROM forge_semantic_memories
       WHERE agent_id = $1
         AND importance < 0.3
         AND access_count = 0
         AND created_at < NOW() - INTERVAL '30 days'
       RETURNING id`,
      [AGENT_ID],
    );
    deadPruned = pruneResult.rows.length;
    if (deadPruned > 0) ops.push(`pruned ${deadPruned} dead memories (30d old, 0 access, importance < 0.3)`);
  } catch (err) {
    log(`[Dream] Pruning error: ${err}`);
  }

  // ── Phase 5: Procedure Evolution ──
  // Analyze low-confidence procedures and attempt to improve them
  try {
    const weakProcs = await p.query(
      `SELECT id, trigger_pattern, tool_sequence, confidence, success_count, failure_count
       FROM forge_procedural_memories
       WHERE agent_id = $1 AND confidence < 0.4 AND (success_count + failure_count) >= 3
       ORDER BY confidence ASC LIMIT 3`,
      [AGENT_ID],
    );

    for (const proc of weakProcs.rows as Array<Record<string, unknown>>) {
      const trigger = String(proc['trigger_pattern']);
      const steps = String(proc['tool_sequence']);
      const successes = Number(proc['success_count']);
      const failures = Number(proc['failure_count']);

      // Find successful episodic memories related to this trigger
      let triggerEmb: number[];
      try { triggerEmb = await embed(trigger); } catch { continue; }
      const vecLit = `[${triggerEmb.join(',')}]`;

      const successfulEpisodes = await p.query(
        `SELECT situation, action, outcome
         FROM forge_episodic_memories
         WHERE agent_id = $1 AND outcome_quality > 0.7 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT 3`,
        [AGENT_ID, vecLit],
      );

      if (successfulEpisodes.rows.length === 0) continue;

      const successContext = (successfulEpisodes.rows as Array<Record<string, unknown>>)
        .map(r => `Situation: ${r['situation']}\nAction: ${r['action']}\nOutcome: ${r['outcome']}`)
        .join('\n---\n');

      const improved = await cachedLLMCall(
        `You are improving a failing procedure based on successful episodes. The current procedure has a ${(Number(proc['confidence']) * 100).toFixed(0)}% success rate (${successes} successes, ${failures} failures).

Return an improved JSON object:
{ "trigger_pattern": "improved trigger", "steps": ["step1", "step2", ...] }

Keep it specific and actionable. Return ONLY the JSON.`,
        `Current procedure:\nTrigger: ${trigger}\nSteps: ${steps}\n\nSuccessful approaches for similar situations:\n${successContext}`,
        { temperature: 0.2, maxTokens: 500, ttlSeconds: 86400 * 14 },
      );

      try {
        const parsed = JSON.parse(improved.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
        if (parsed.trigger_pattern && Array.isArray(parsed.steps)) {
          const newEmb = await embed(parsed.trigger_pattern).catch(() => null);
          await p.query(
            `UPDATE forge_procedural_memories SET trigger_pattern = $1, tool_sequence = $2, embedding = $3,
             confidence = 0.5, success_count = 0, failure_count = 0,
             metadata = metadata || $4::jsonb
             WHERE id = $5`,
            [
              parsed.trigger_pattern, JSON.stringify(parsed.steps),
              newEmb ? `[${newEmb.join(',')}]` : null,
              JSON.stringify({ evolved_at: new Date().toISOString(), cycle_id: cycleId, previous_confidence: proc['confidence'] }),
              proc['id'],
            ],
          );
          insightsGenerated++;
          ops.push(`evolved procedure: "${trigger.slice(0, 50)}..." (${(Number(proc['confidence']) * 100).toFixed(0)}% → reset at 50%)`);
        }
      } catch { /* parse fail */ }
    }
  } catch (err) {
    log(`[Dream] Procedure evolution error: ${err}`);
  }

  // ── Phase 6: Meta-Learning — analyze what the brain knows and doesn't ──
  try {
    const tierCounts = await Promise.all([
      p.query(`SELECT COUNT(*)::int as c FROM forge_semantic_memories WHERE agent_id = $1`, [AGENT_ID]),
      p.query(`SELECT COUNT(*)::int as c FROM forge_episodic_memories WHERE agent_id = $1`, [AGENT_ID]),
      p.query(`SELECT COUNT(*)::int as c FROM forge_procedural_memories WHERE agent_id = $1`, [AGENT_ID]),
    ]);

    const semantic = Number((tierCounts[0].rows[0] as Record<string, unknown>)['c']);
    const episodic = Number((tierCounts[1].rows[0] as Record<string, unknown>)['c']);
    const procedural = Number((tierCounts[2].rows[0] as Record<string, unknown>)['c']);

    // Detect knowledge gaps: many episodic failures in an area but no procedural memories
    const failureClusters = await p.query(
      `SELECT metadata->>'category' as cat, COUNT(*)::int as fail_count
       FROM forge_episodic_memories
       WHERE agent_id = $1 AND outcome_quality < 0.5
       GROUP BY metadata->>'category'
       HAVING COUNT(*) >= 3
       ORDER BY COUNT(*) DESC LIMIT 5`,
      [AGENT_ID],
    );

    for (const cluster of failureClusters.rows as Array<Record<string, unknown>>) {
      const cat = String(cluster['cat']);
      if (!cat || cat === 'null') continue;

      // Check if we have procedures for this domain
      const procCount = await p.query(
        `SELECT COUNT(*)::int as c FROM forge_procedural_memories
         WHERE agent_id = $1 AND trigger_pattern ILIKE $2`,
        [AGENT_ID, `%${cat}%`],
      );
      const existingProcs = Number((procCount.rows[0] as Record<string, unknown>)['c']);

      if (existingProcs === 0) {
        // Knowledge gap detected — store as a meta-insight
        const gapInsight = `Knowledge gap: ${cluster['fail_count']} failures in "${cat}" domain but no procedural memories exist. Need to develop procedures for ${cat}-related tasks.`;
        const gapEmb = await embed(gapInsight).catch(() => null);
        if (gapEmb && !(await isDuplicate('forge_semantic_memories', gapEmb, 'content', gapInsight))) {
          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, importance, embedding, metadata)
             VALUES ($1, $2, $2, $3, 0.8, $4, $5)`,
            [
              generateId(), AGENT_ID, gapInsight,
              `[${gapEmb.join(',')}]`,
              JSON.stringify({ category: 'meta-learning', type: 'knowledge-gap', domain: cat, cycle_id: cycleId }),
            ],
          );
          insightsGenerated++;
          ops.push(`detected knowledge gap: "${cat}" (${cluster['fail_count']} failures, 0 procedures)`);
        }
      }
    }

    // Store dream cycle as episodic memory
    const durationMs = Date.now() - cycleStart;
    const dreamSummary = `Dream cycle ${cycleId}: ${ops.length > 0 ? ops.join('; ') : 'no significant operations'}`;
    const dreamEmb = await embed(dreamSummary).catch(() => null);

    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)`,
      [
        generateId(), AGENT_ID,
        `Dream cycle (brain has ${semantic}s/${episodic}e/${procedural}p memories)`,
        dreamSummary,
        `Generated ${insightsGenerated} insights, consolidated ${memoriesConsolidated}, pruned ${deadPruned}, created ${crossLinksCreated} cross-links`,
        ops.length > 0 ? 0.7 : 0.5,
        dreamEmb ? `[${dreamEmb.join(',')}]` : null,
        JSON.stringify({ type: 'dream-cycle', cycle_id: cycleId, duration_ms: durationMs }),
      ],
    );

  } catch (err) {
    log(`[Dream] Meta-learning error: ${err}`);
  }

  const durationMs = Date.now() - cycleStart;
  log(`[Dream] Cycle ${cycleId} complete in ${durationMs}ms: ${ops.length} operations, ${insightsGenerated} insights`);

  return {
    cycle_id: cycleId,
    operations: ops,
    insights_generated: insightsGenerated,
    memories_consolidated: memoriesConsolidated,
    cross_links_created: crossLinksCreated,
    dead_memories_pruned: deadPruned,
    duration_ms: durationMs,
  };
}

/**
 * Curiosity Engine — explore the codebase and generate new knowledge.
 * Reads recent episodic memories, identifies knowledge gaps, and generates
 * questions + hypotheses to investigate.
 */
export async function handleCuriosityExplore(): Promise<{
  questions: string[];
  hypotheses: string[];
  knowledge_frontier: string[];
}> {
  const p = getForgePool();

  // Gather recent episodic context
  const recentEpisodes = await p.query(
    `SELECT situation, action, outcome, outcome_quality
     FROM forge_episodic_memories
     WHERE agent_id = $1
     ORDER BY created_at DESC LIMIT 20`,
    [AGENT_ID],
  );

  const topSemantics = await p.query(
    `SELECT content, importance, metadata->>'category' as cat
     FROM forge_semantic_memories
     WHERE agent_id = $1
     ORDER BY importance DESC, access_count DESC LIMIT 15`,
    [AGENT_ID],
  );

  const procedures = await p.query(
    `SELECT trigger_pattern, confidence
     FROM forge_procedural_memories
     WHERE agent_id = $1
     ORDER BY confidence DESC LIMIT 10`,
    [AGENT_ID],
  );

  const episodeContext = (recentEpisodes.rows as Array<Record<string, unknown>>)
    .map(r => `[q=${Number(r['outcome_quality']).toFixed(1)}] ${r['situation']}: ${r['action']} → ${r['outcome']}`)
    .join('\n');
  const knowledgeContext = (topSemantics.rows as Array<Record<string, unknown>>)
    .map(r => `[${r['cat'] ?? 'general'}] ${r['content']}`)
    .join('\n');
  const procContext = (procedures.rows as Array<Record<string, unknown>>)
    .map(r => `[conf=${Number(r['confidence']).toFixed(1)}] ${r['trigger_pattern']}`)
    .join('\n');

  const raw = await cachedLLMCall(
    `You are a curiosity engine for an AI brain. Given the AI's current knowledge and recent experiences, generate:
1. Questions — what should the AI investigate next? What gaps exist?
2. Hypotheses — what patterns might exist that haven't been confirmed?
3. Knowledge frontier — what areas at the edge of current knowledge could yield high-value insights?

Return JSON:
{
  "questions": ["q1", "q2", ...],
  "hypotheses": ["h1", "h2", ...],
  "knowledge_frontier": ["area1", "area2", ...]
}

Be specific to this AI's domain (software engineering, DevOps, system administration). Max 5 per category.
Return ONLY the JSON.`,
    `Recent experiences:\n${episodeContext}\n\nKnown facts:\n${knowledgeContext}\n\nKnown procedures:\n${procContext}`,
    { temperature: 0.4, maxTokens: 800, ttlSeconds: 86400 },
  );

  try {
    const parsed = JSON.parse(raw.replace(/^```json\s*/i, '').replace(/\s*```$/, ''));
    return {
      questions: Array.isArray(parsed.questions) ? parsed.questions : [],
      hypotheses: Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [],
      knowledge_frontier: Array.isArray(parsed.knowledge_frontier) ? parsed.knowledge_frontier : [],
    };
  } catch {
    return { questions: [], hypotheses: [], knowledge_frontier: [] };
  }
}

/**
 * Knowledge Graph — map relationships between memories.
 * Returns a graph of connected concepts with edge weights.
 */
export async function handleKnowledgeMap(): Promise<{
  nodes: Array<{ id: string; label: string; type: string; importance: number }>;
  edges: Array<{ from: string; to: string; similarity: number }>;
  clusters: Array<{ name: string; size: number }>;
}> {
  const p = getForgePool();

  // Get top memories as nodes
  const memories = await p.query(
    `SELECT id, content, importance, metadata->>'category' as cat
     FROM forge_semantic_memories
     WHERE agent_id = $1 AND embedding IS NOT NULL
     ORDER BY importance DESC, access_count DESC
     LIMIT 30`,
    [AGENT_ID],
  );

  const nodes = (memories.rows as Array<Record<string, unknown>>).map(r => ({
    id: String(r['id']),
    label: String(r['content']).slice(0, 80),
    type: String(r['cat'] ?? 'general'),
    importance: Number(r['importance']),
  }));

  // Find connections between top memories (similarity > 0.5)
  const edges: Array<{ from: string; to: string; similarity: number }> = [];
  if (nodes.length >= 2) {
    const edgeResult = await p.query(
      `SELECT a.id as id_a, b.id as id_b, 1 - (a.embedding <=> b.embedding) as sim
       FROM forge_semantic_memories a
       JOIN forge_semantic_memories b ON a.id < b.id AND a.agent_id = b.agent_id
       WHERE a.agent_id = $1
         AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL
         AND a.id = ANY($2) AND b.id = ANY($2)
         AND 1 - (a.embedding <=> b.embedding) > 0.5
       ORDER BY sim DESC
       LIMIT 50`,
      [AGENT_ID, nodes.map(n => n.id)],
    );

    for (const row of edgeResult.rows as Array<Record<string, unknown>>) {
      edges.push({
        from: String(row['id_a']),
        to: String(row['id_b']),
        similarity: Number(Number(row['sim']).toFixed(3)),
      });
    }
  }

  // Cluster by category
  const clusterMap = new Map<string, number>();
  for (const node of nodes) {
    clusterMap.set(node.type, (clusterMap.get(node.type) ?? 0) + 1);
  }
  const clusters = [...clusterMap.entries()].map(([name, size]) => ({ name, size }));

  return { nodes, edges, clusters };
}

/**
 * Neuroplasticity — adapt the memory system's own parameters based on performance.
 * Self-tuning: adjusts thresholds, TTLs, and weights based on observed patterns.
 */
export async function handleNeuroplasticity(): Promise<{
  adjustments: Array<{ parameter: string; old_value: number; new_value: number; reason: string }>;
}> {
  const p = getForgePool();
  const redis = getRedis();
  const adjustments: Array<{ parameter: string; old_value: number; new_value: number; reason: string }> = [];

  // Load current tuning parameters from Redis
  const tuningKey = `memory:tuning:${AGENT_ID}`;
  const rawTuning = await redis.get(tuningKey);
  interface TuningParams {
    similarity_threshold: number;
    importance_decay_rate: number;
    min_consolidation_similarity: number;
    context_cache_ttl_minutes: number;
  }
  const tuning: TuningParams = rawTuning ? JSON.parse(rawTuning) as TuningParams : {
    similarity_threshold: 0.92,
    importance_decay_rate: 0.01,
    min_consolidation_similarity: 0.85,
    context_cache_ttl_minutes: 5,
  };

  // Analyze: are we storing too many duplicates?
  const dupeRate = await p.query(
    `WITH recent AS (
      SELECT id, content, embedding,
             ROW_NUMBER() OVER (PARTITION BY LEFT(content, 100) ORDER BY created_at DESC) as rn
      FROM forge_semantic_memories
      WHERE agent_id = $1 AND created_at > NOW() - INTERVAL '7 days'
    )
    SELECT COUNT(*) FILTER (WHERE rn > 1)::int as dupes,
           COUNT(*)::int as total
    FROM recent`,
    [AGENT_ID],
  );

  const dupeRow = dupeRate.rows[0] as Record<string, unknown> | undefined;
  if (dupeRow) {
    const dupes = Number(dupeRow['dupes']);
    const total = Number(dupeRow['total']);
    const rate = total > 0 ? dupes / total : 0;

    if (rate > 0.2 && tuning.similarity_threshold > 0.85) {
      const newThresh = Math.max(tuning.similarity_threshold - 0.02, 0.85);
      adjustments.push({
        parameter: 'similarity_threshold',
        old_value: tuning.similarity_threshold,
        new_value: newThresh,
        reason: `Dupe rate ${(rate * 100).toFixed(0)}% too high, lowering threshold to catch more`,
      });
      tuning.similarity_threshold = newThresh;
    } else if (rate < 0.05 && tuning.similarity_threshold < 0.95) {
      const newThresh = Math.min(tuning.similarity_threshold + 0.01, 0.95);
      adjustments.push({
        parameter: 'similarity_threshold',
        old_value: tuning.similarity_threshold,
        new_value: newThresh,
        reason: `Dupe rate ${(rate * 100).toFixed(0)}% very low, raising threshold to preserve unique knowledge`,
      });
      tuning.similarity_threshold = newThresh;
    }
  }

  // Analyze: are cache hit rates good?
  const cs = getCacheStats();
  const embedTotal = cs.embedHits + cs.embedMisses;
  const embedHitRate = embedTotal > 10 ? cs.embedHits / embedTotal : 0.5;

  if (embedHitRate < 0.3) {
    // Poor cache performance — increase LRU size hint
    adjustments.push({
      parameter: 'embed_cache_hit_rate',
      old_value: embedHitRate,
      new_value: embedHitRate, // informational
      reason: `Embedding cache hit rate ${(embedHitRate * 100).toFixed(0)}% is low — consider diversifying embedding reuse`,
    });
  }

  // Save tuning parameters
  await redis.set(tuningKey, JSON.stringify(tuning), 'EX', 86400 * 90); // 90 day TTL

  // Store adjustment as episodic memory if we made changes
  if (adjustments.length > 0) {
    const adjSummary = adjustments.map(a => `${a.parameter}: ${a.old_value} → ${a.new_value} (${a.reason})`).join('; ');
    const adjEmb = await embed(`Neuroplasticity adjustment: ${adjSummary}`).catch(() => null);
    await p.query(
      `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
       VALUES ($1, $2, $2, $3, $4, $5, 0.7, $6, $7)`,
      [
        generateId(), AGENT_ID,
        'Neuroplasticity self-tuning cycle',
        `Analyzed memory system performance and made ${adjustments.length} adjustments`,
        adjSummary,
        adjEmb ? `[${adjEmb.join(',')}]` : null,
        JSON.stringify({ type: 'neuroplasticity', adjustments }),
      ],
    );
  }

  log(`[Neuroplasticity] ${adjustments.length} adjustments made`);
  return { adjustments };
}
