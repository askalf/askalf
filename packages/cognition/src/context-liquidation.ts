/**
 * Context Liquidation - Extract high-density facts from raw context
 *
 * Working memory evaporates into concentrated knowledge:
 * - Remove noise (pleasantries, filler)
 * - Extract entities and relationships
 * - Compress into high-density facts
 * - Track temporal validity
 */

import { createLogger } from '@substrate/observability';
import { complete } from '@substrate/ai';

const logger = createLogger({ component: 'context-liquidation' });

export interface ExtractedFact {
  subject: string;
  predicate: string;
  object: string;
  statement: string;
  confidence: number;
  temporal?: {
    validFrom?: Date;
    validUntil?: Date;
    isTemporal: boolean;
  };
  source: string;
}

export interface ExtractedEntity {
  name: string;
  type: 'person' | 'organization' | 'concept' | 'tool' | 'location' | 'other';
  attributes: Record<string, string>;
  mentions: number;
}

export interface LiquidationResult {
  facts: ExtractedFact[];
  entities: ExtractedEntity[];
  noiseRemoved: string[];
  compressionRatio: number;
  originalTokens: number;
  liquidatedTokens: number;
}

/**
 * Patterns for noise detection
 */
const NOISE_PATTERNS = [
  /^(hi|hello|hey|thanks|thank you|please|sorry|ok|okay|sure|great|nice|good|yes|no|yeah|yep|nope)[\s!.,]*$/i,
  /^(um|uh|hmm|well|so|anyway|basically|actually|like|you know)[\s,]*/i,
  /^(i think|i believe|i guess|maybe|perhaps|possibly|probably)[\s,]+/i,
  /^(can you|could you|would you|will you)[\s]/i, // Often redundant preamble
];

/**
 * Detect and remove noise from text
 */
export function detectNoise(text: string): { cleaned: string; noiseRemoved: string[] } {
  const lines = text.split('\n');
  const noiseRemoved: string[] = [];
  const cleanedLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines
    if (!trimmed) continue;

    // Check against noise patterns
    let isNoise = false;
    for (const pattern of NOISE_PATTERNS) {
      if (pattern.test(trimmed)) {
        isNoise = true;
        noiseRemoved.push(trimmed);
        break;
      }
    }

    // Very short lines are often noise
    if (!isNoise && trimmed.length < 10 && !/\d/.test(trimmed)) {
      isNoise = true;
      noiseRemoved.push(trimmed);
    }

    if (!isNoise) {
      cleanedLines.push(trimmed);
    }
  }

  return {
    cleaned: cleanedLines.join('\n'),
    noiseRemoved,
  };
}

/**
 * Extract entities from text using heuristics
 */
export function extractEntitiesHeuristic(text: string): ExtractedEntity[] {
  const entities = new Map<string, ExtractedEntity>();

  // Extract capitalized phrases (likely proper nouns)
  const capitalizedPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
  let match;

  while ((match = capitalizedPattern.exec(text)) !== null) {
    const name = match[1] ?? '';
    if (!name) continue;

    // Skip common words that happen to be capitalized
    if (['The', 'This', 'That', 'These', 'Those', 'It', 'I', 'We', 'You', 'They'].includes(name)) {
      continue;
    }

    const existing = entities.get(name);
    if (existing) {
      existing.mentions++;
    } else {
      entities.set(name, {
        name,
        type: classifyEntityType(name, text),
        attributes: {},
        mentions: 1,
      });
    }
  }

  // Extract technical terms (code-like patterns)
  const technicalPattern = /\b([a-z][a-zA-Z]*(?:_[a-zA-Z]+)+|[A-Z]+_[A-Z_]+)\b/g;

  while ((match = technicalPattern.exec(text)) !== null) {
    const name = match[1] ?? '';
    if (!name) continue;
    if (!entities.has(name)) {
      entities.set(name, {
        name,
        type: 'tool',
        attributes: {},
        mentions: 1,
      });
    }
  }

  return Array.from(entities.values()).filter(e => e.mentions >= 1);
}

/**
 * Classify entity type based on context
 */
function classifyEntityType(
  name: string,
  context: string
): ExtractedEntity['type'] {
  const lowerContext = context.toLowerCase();
  const lowerName = name.toLowerCase();

  // Check for person indicators
  if (
    lowerContext.includes(`${lowerName} said`) ||
    lowerContext.includes(`${lowerName} asked`) ||
    lowerContext.includes(`${lowerName} is a`) ||
    /^(mr|ms|mrs|dr|prof)\.?\s/i.test(name)
  ) {
    return 'person';
  }

  // Check for organization indicators
  if (
    lowerContext.includes(`${lowerName} company`) ||
    lowerContext.includes(`${lowerName} inc`) ||
    lowerContext.includes(`${lowerName} corp`) ||
    /\b(Inc|LLC|Ltd|Corp)\b/.test(name)
  ) {
    return 'organization';
  }

  // Check for location indicators
  if (
    lowerContext.includes(`in ${lowerName}`) ||
    lowerContext.includes(`at ${lowerName}`) ||
    lowerContext.includes(`${lowerName} city`) ||
    lowerContext.includes(`${lowerName} state`)
  ) {
    return 'location';
  }

  // Check for tool/technology indicators
  if (
    /^[A-Z][a-z]+(?:JS|TS|DB|API|SDK|CLI)$/.test(name) ||
    lowerContext.includes(`using ${lowerName}`) ||
    lowerContext.includes(`${lowerName} library`) ||
    lowerContext.includes(`${lowerName} framework`)
  ) {
    return 'tool';
  }

  return 'concept';
}

/**
 * Extract simple facts using pattern matching
 */
export function extractFactsHeuristic(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];

  // Pattern: X is Y
  const isPattern = /\b([A-Z][a-zA-Z\s]+)\s+is\s+(?:a\s+)?([^.!?]+)[.!?]/g;
  let match;

  while ((match = isPattern.exec(text)) !== null) {
    const subject = (match[1] ?? '').trim();
    const object = (match[2] ?? '').trim();

    if (subject.length > 2 && object.length > 2) {
      facts.push({
        subject,
        predicate: 'is',
        object,
        statement: `${subject} is ${object}`,
        confidence: 0.7,
        source: 'heuristic',
      });
    }
  }

  // Pattern: X uses/uses Y
  const usesPattern = /\b([A-Z][a-zA-Z\s]+)\s+(?:uses?|utilizes?)\s+([^.!?]+)[.!?]/gi;

  while ((match = usesPattern.exec(text)) !== null) {
    const subject = (match[1] ?? '').trim();
    const object = (match[2] ?? '').trim();

    if (subject.length > 2 && object.length > 2) {
      facts.push({
        subject,
        predicate: 'uses',
        object,
        statement: `${subject} uses ${object}`,
        confidence: 0.75,
        source: 'heuristic',
      });
    }
  }

  // Pattern: X has Y
  const hasPattern = /\b([A-Z][a-zA-Z\s]+)\s+has\s+([^.!?]+)[.!?]/gi;

  while ((match = hasPattern.exec(text)) !== null) {
    const subject = (match[1] ?? '').trim();
    const object = (match[2] ?? '').trim();

    if (subject.length > 2 && object.length > 2) {
      facts.push({
        subject,
        predicate: 'has',
        object,
        statement: `${subject} has ${object}`,
        confidence: 0.7,
        source: 'heuristic',
      });
    }
  }

  return facts;
}

/**
 * Full liquidation using LLM for high-quality extraction
 */
export async function liquidateWithLLM(
  rawContext: string,
  options?: { maxFacts?: number }
): Promise<LiquidationResult> {
  const startTime = Date.now();
  const maxFacts = options?.maxFacts ?? 20;

  // First pass: remove obvious noise
  const { cleaned, noiseRemoved } = detectNoise(rawContext);

  if (cleaned.length < 50) {
    // Too short for meaningful liquidation
    return {
      facts: [],
      entities: extractEntitiesHeuristic(cleaned),
      noiseRemoved,
      compressionRatio: 0,
      originalTokens: estimateTokens(rawContext),
      liquidatedTokens: 0,
    };
  }

  // Use LLM for deep extraction
  const prompt = `Extract structured knowledge from this text. Return JSON.

TEXT:
${cleaned}

Return a JSON object with:
{
  "facts": [
    {
      "subject": "entity name",
      "predicate": "relationship verb",
      "object": "related entity or value",
      "confidence": 0.0-1.0,
      "isTemporal": true/false
    }
  ],
  "entities": [
    {
      "name": "entity name",
      "type": "person|organization|concept|tool|location|other",
      "attributes": {}
    }
  ]
}

Extract up to ${maxFacts} most important facts. Focus on:
- Definitions and classifications
- Relationships between entities
- States and properties
- Actions and their effects

Skip opinions, speculation, and filler.`;

  try {
    const response = await complete(prompt, { maxTokens: 1500 });

    // Parse JSON from response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Fallback to heuristics
      logger.debug('LLM response not parseable, using heuristics');
      return liquidateHeuristic(rawContext);
    }

    const parsed = JSON.parse(jsonMatch[0]);

    const facts: ExtractedFact[] = (parsed.facts || []).map((f: Record<string, unknown>) => ({
      subject: f['subject'] as string,
      predicate: f['predicate'] as string,
      object: f['object'] as string,
      statement: `${f['subject']} ${f['predicate']} ${f['object']}`,
      confidence: (f['confidence'] as number) ?? 0.7,
      temporal: f['isTemporal'] ? { isTemporal: true } : undefined,
      source: 'llm',
    }));

    const entities: ExtractedEntity[] = (parsed.entities || []).map((e: Record<string, unknown>) => ({
      name: e['name'] as string,
      type: e['type'] as ExtractedEntity['type'],
      attributes: (e['attributes'] as Record<string, string>) ?? {},
      mentions: 1,
    }));

    // Calculate compression metrics
    const originalTokens = estimateTokens(rawContext);
    const liquidatedTokens = facts.reduce((sum, f) => sum + estimateTokens(f.statement), 0);
    const compressionRatio = originalTokens > 0 ? 1 - (liquidatedTokens / originalTokens) : 0;

    logger.info({
      factCount: facts.length,
      entityCount: entities.length,
      compressionRatio: compressionRatio.toFixed(2),
      processingMs: Date.now() - startTime,
    }, 'Context liquidation complete');

    return {
      facts,
      entities,
      noiseRemoved,
      compressionRatio,
      originalTokens,
      liquidatedTokens,
    };
  } catch (error) {
    logger.warn({ error }, 'LLM liquidation failed, falling back to heuristics');
    return liquidateHeuristic(rawContext);
  }
}

/**
 * Fast liquidation using only heuristics (no LLM)
 */
export function liquidateHeuristic(rawContext: string): LiquidationResult {
  const { cleaned, noiseRemoved } = detectNoise(rawContext);
  const facts = extractFactsHeuristic(cleaned);
  const entities = extractEntitiesHeuristic(cleaned);

  const originalTokens = estimateTokens(rawContext);
  const liquidatedTokens = facts.reduce((sum, f) => sum + estimateTokens(f.statement), 0);
  const compressionRatio = originalTokens > 0 ? 1 - (liquidatedTokens / originalTokens) : 0;

  return {
    facts,
    entities,
    noiseRemoved,
    compressionRatio,
    originalTokens,
    liquidatedTokens,
  };
}

/**
 * Merge new facts with existing knowledge, handling conflicts
 */
export function mergeFacts(
  existing: ExtractedFact[],
  incoming: ExtractedFact[]
): { merged: ExtractedFact[]; conflicts: Array<{ existing: ExtractedFact; incoming: ExtractedFact }> } {
  const merged: ExtractedFact[] = [...existing];
  const conflicts: Array<{ existing: ExtractedFact; incoming: ExtractedFact }> = [];

  for (const newFact of incoming) {
    // Check for matching subject+predicate
    const existingMatch = existing.find(
      e => e.subject.toLowerCase() === newFact.subject.toLowerCase() &&
           e.predicate.toLowerCase() === newFact.predicate.toLowerCase()
    );

    if (existingMatch) {
      // Same subject+predicate but different object = potential conflict
      if (existingMatch.object.toLowerCase() !== newFact.object.toLowerCase()) {
        conflicts.push({ existing: existingMatch, incoming: newFact });

        // If new fact has higher confidence, replace
        if (newFact.confidence > existingMatch.confidence) {
          const idx = merged.indexOf(existingMatch);
          merged[idx] = newFact;
        }
      }
      // Same object = duplicate, skip
    } else {
      // New fact, add it
      merged.push(newFact);
    }
  }

  return { merged, conflicts };
}

/**
 * Estimate token count
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
