/**
 * Memory API — Automatic memory extraction and context injection
 *
 * POST /api/memory/extract — Takes conversation text, extracts memories via LLM,
 *   stores them in the appropriate tier (semantic/episodic/procedural).
 *
 * GET /api/memory/context — Returns formatted memory context for session injection.
 *   Queries all tiers, formats as markdown for MEMORY.md generation.
 */

import { getForgePool, generateId } from '@askalf/db';
import OpenAI from 'openai';

const AGENT_ID = 'cli:local:master';
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
// Extract — LLM-powered memory categorization
// ============================================

interface ExtractRequest {
  conversation: string;    // Raw conversation text (last N turns)
  session_id?: string;     // For episodic context
  project?: string;        // Project identifier
}

interface ExtractedMemory {
  type: 'semantic' | 'episodic' | 'procedural';
  content: string;
  importance?: number;
  // episodic fields
  situation?: string;
  action?: string;
  outcome?: string;
  quality?: number;
  // procedural fields
  trigger_pattern?: string;
  tool_sequence?: string[];
}

const EXTRACTION_PROMPT = `You are a memory extraction system. Analyze the conversation and extract distinct memories worth preserving across sessions.

Categorize each into exactly one tier:
- **semantic**: Facts, decisions, preferences, architecture knowledge, conventions. Things that are TRUE and reusable.
- **episodic**: Experiences — what happened, what was tried, what worked/failed. Situation → Action → Outcome format.
- **procedural**: Repeatable patterns — "when X happens, do Y using Z". Include trigger pattern and tool/step sequence.

Rules:
- Only extract information worth remembering across sessions. Skip transient task details.
- Be specific. "User prefers X" is better than "User has preferences."
- For episodic: always include situation, action, outcome, and quality (0.0=failure, 1.0=success).
- For procedural: always include trigger_pattern and tool_sequence (array of step strings).
- Deduplicate — if the same fact appears multiple times, extract it once.
- Set importance 0.0-1.0 (1.0 = critical project knowledge, 0.3 = minor detail).
- Return empty array if nothing worth remembering.

Respond with a JSON array of objects. Each object must have:
{
  "type": "semantic" | "episodic" | "procedural",
  "content": "the memory content (for semantic) or situation (for episodic)",
  "importance": 0.0-1.0,
  // episodic only:
  "action": "what was done",
  "outcome": "what happened",
  "quality": 0.0-1.0,
  // procedural only:
  "trigger_pattern": "when this happens...",
  "tool_sequence": ["step 1", "step 2"]
}

Return ONLY the JSON array, no markdown fences, no explanation.`;

export async function handleExtract(body: ExtractRequest): Promise<{ stored: number; memories: string[] }> {
  const { conversation, session_id, project } = body;
  if (!conversation?.trim()) {
    return { stored: 0, memories: [] };
  }

  // Truncate to ~12k chars to stay within cheap model limits
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
    max_tokens: 2000,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? '[]';
  let extracted: ExtractedMemory[];
  try {
    extracted = JSON.parse(raw);
    if (!Array.isArray(extracted)) extracted = [];
  } catch {
    log(`Failed to parse extraction response: ${raw.slice(0, 200)}`);
    return { stored: 0, memories: [] };
  }

  if (extracted.length === 0) {
    log('No memories extracted');
    return { stored: 0, memories: [] };
  }

  const p = getForgePool();
  const stored: string[] = [];
  const source = project ? `cli:${project}` : 'cli:local';

  for (const mem of extracted) {
    try {
      const memoryId = generateId();

      switch (mem.type) {
        case 'semantic': {
          let embedding: number[] | null = null;
          try { embedding = await embed(mem.content); } catch { /* continue without embedding */ }

          await p.query(
            `INSERT INTO forge_semantic_memories (id, agent_id, owner_id, content, embedding, source, importance, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6, $7)
             ON CONFLICT DO NOTHING`,
            [
              memoryId, AGENT_ID, mem.content,
              embedding ? `[${embedding.join(',')}]` : null,
              source, mem.importance ?? 0.5,
              JSON.stringify({ session_id, project }),
            ],
          );
          stored.push(`[semantic] ${mem.content.slice(0, 80)}`);
          break;
        }

        case 'episodic': {
          const situation = mem.content || mem.situation || '';
          const action = mem.action || 'No action recorded';
          const outcome = mem.outcome || 'No outcome recorded';
          let embedding: number[] | null = null;
          try { embedding = await embed(`${situation} ${action} ${outcome}`); } catch { /* continue */ }

          await p.query(
            `INSERT INTO forge_episodic_memories (id, agent_id, owner_id, situation, action, outcome, outcome_quality, embedding, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8)
             ON CONFLICT DO NOTHING`,
            [
              memoryId, AGENT_ID, situation, action, outcome,
              mem.quality ?? 0.5,
              embedding ? `[${embedding.join(',')}]` : null,
              JSON.stringify({ session_id, project }),
            ],
          );
          stored.push(`[episodic] ${situation.slice(0, 80)}`);
          break;
        }

        case 'procedural': {
          const trigger = mem.trigger_pattern || mem.content;
          const sequence = mem.tool_sequence || [];
          if (!trigger || !sequence.length) break;

          let embedding: number[] | null = null;
          try { embedding = await embed(trigger); } catch { /* continue */ }

          await p.query(
            `INSERT INTO forge_procedural_memories (id, agent_id, owner_id, trigger_pattern, tool_sequence, embedding, metadata)
             VALUES ($1, $2, $2, $3, $4, $5, $6)
             ON CONFLICT DO NOTHING`,
            [
              memoryId, AGENT_ID, trigger,
              JSON.stringify(sequence),
              embedding ? `[${embedding.join(',')}]` : null,
              JSON.stringify({ session_id, project }),
            ],
          );
          stored.push(`[procedural] ${trigger.slice(0, 80)}`);
          break;
        }
      }
    } catch (err) {
      log(`Failed to store memory: ${err}`);
    }
  }

  log(`Stored ${stored.length} memories`);
  return { stored: stored.length, memories: stored };
}

// ============================================
// Context — Generate memory context for injection
// ============================================

export async function handleContext(project: string): Promise<{ markdown: string; counts: { semantic: number; episodic: number; procedural: number } }> {
  const p = getForgePool();
  const counts = { semantic: 0, episodic: 0, procedural: 0 };

  const sections: string[] = [];
  sections.push('# Memory Context (auto-generated)\n');
  sections.push(`Agent: ${AGENT_ID} | Generated: ${new Date().toISOString()}\n`);

  // --- Semantic memories (facts, decisions, preferences) ---
  try {
    const result = await p.query(
      `SELECT content, source, importance, created_at
       FROM forge_semantic_memories
       WHERE agent_id = $1
       ORDER BY importance DESC, created_at DESC
       LIMIT 30`,
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
      `SELECT situation, action, outcome, outcome_quality, created_at
       FROM forge_episodic_memories
       WHERE agent_id = $1
       ORDER BY created_at DESC
       LIMIT 15`,
      [AGENT_ID],
    );

    if (result.rows.length > 0) {
      sections.push('\n## Recent Experiences\n');
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const quality = Number(row['outcome_quality'] ?? 0.5);
        const icon = quality >= 0.7 ? 'OK' : 'FAIL';
        sections.push(`- [${icon}] ${row['situation']}`);
        if (row['action']) sections.push(`  Action: ${row['action']}`);
        if (row['outcome']) sections.push(`  Outcome: ${row['outcome']}`);
        counts.episodic++;
      }
    }
  } catch (err) {
    log(`Episodic query failed: ${err}`);
  }

  // --- Procedural memories (patterns, how-tos) ---
  try {
    const result = await p.query(
      `SELECT trigger_pattern, tool_sequence, confidence, success_count, failure_count
       FROM forge_procedural_memories
       WHERE agent_id = $1
       ORDER BY confidence DESC, success_count DESC
       LIMIT 10`,
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
