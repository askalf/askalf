/**
 * Memory API — Automatic memory extraction, deduplication, and context injection
 *
 * POST /api/memory/extract  — LLM extracts + dedup-stores memories from conversation
 * POST /api/memory/seed     — Bulk seed from multiple transcript files
 * POST /api/memory/consolidate — Merge duplicates, decay stale, reinforce confirmed
 * GET  /api/memory/context  — Formatted markdown for MEMORY.md injection
 * GET  /api/memory/stats    — Memory tier counts and health
 */

import { getForgePool, generateId } from '@askalf/db';
import OpenAI from 'openai';

const AGENT_ID = 'cli:local:master';
const SIMILARITY_THRESHOLD = 0.92; // Above this = duplicate
const log = (msg: string) => console.log(`[mcp-tools:memory-api] ${new Date().toISOString()} ${msg}`);

let openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!openai) {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) throw new Error('OPENAI_API_KEY required for memory extraction');
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

async function embed(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
    dimensions: 1536,
  });
  return response.data[0]!.embedding;
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

const EXTRACTION_PROMPT = `You are a memory extraction system for a software engineer's AI coding assistant. Analyze the conversation and extract distinct memories worth preserving across sessions.

Categorize each into exactly one tier:
- **semantic**: Facts, decisions, preferences, architecture knowledge, conventions, project structure, tech stack details, user preferences, naming conventions. Things that are TRUE and reusable.
- **episodic**: Experiences — what happened, what was tried, what worked/failed. Situation → Action → Outcome format. Include debugging stories, deployment results, refactoring outcomes.
- **procedural**: Repeatable patterns — "when X happens, do Y using Z". Deploy workflows, build steps, debugging recipes, git workflows. Include trigger pattern and step sequence.

Rules:
- Only extract information worth remembering across sessions. Skip small talk and transient task details.
- Be specific and detailed. "Project uses PostgreSQL 17 with pgvector on single 'askalf' database" is better than "Uses PostgreSQL."
- For episodic: always include situation, action, outcome, and quality (0.0=failure, 1.0=success).
- For procedural: always include trigger_pattern and tool_sequence (array of step strings).
- Deduplicate — if the same fact appears multiple times, extract it once.
- Set importance 0.0-1.0 (1.0 = critical project knowledge, 0.5 = useful detail, 0.3 = minor).
- Return empty array if nothing worth remembering.
- Extract user PREFERENCES and RULES as high-importance semantic memories.

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

  const ai = getOpenAI();
  const response = await ai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: EXTRACTION_PROMPT },
      { role: 'user', content: truncated },
    ],
    temperature: 0.1,
    max_tokens: 3000,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? '[]';
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

  return storeMemories(extracted, session_id, project);
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
  const p = getForgePool();
  const counts = { semantic: 0, episodic: 0, procedural: 0 };

  const sections: string[] = [];
  sections.push('# Memory Context (auto-generated)\n');

  // --- Semantic memories (facts, decisions, preferences) ---
  try {
    // Bump access_count for retrieved memories
    const result = await p.query(
      `UPDATE forge_semantic_memories
       SET access_count = access_count + 1
       WHERE id IN (
         SELECT id FROM forge_semantic_memories
         WHERE agent_id = $1
         ORDER BY importance DESC, created_at DESC
         LIMIT 40
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
  return { markdown, counts };
}
