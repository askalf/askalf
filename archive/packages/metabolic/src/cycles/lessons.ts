/**
 * Lesson Extraction Cycle
 *
 * Processes negative episodes to extract lessons learned,
 * then stores them as facts in semantic memory.
 *
 * This wires Episodic Memory → Semantic Memory
 *
 * Includes deduplication to prevent near-identical lessons.
 */

import { query } from '@substrate/database';
import { semantic } from '@substrate/memory';
import { createLogger } from '@substrate/observability';
import { extractLesson, generateEmbedding } from '@substrate/ai';

const logger = createLogger({ component: 'lessons' });

export interface LessonExtractionConfig {
  maxEpisodesToProcess: number;
  minImportance: number;
  deduplicationThreshold: number; // Similarity threshold (0-1), above this = duplicate
}

const DEFAULT_CONFIG: LessonExtractionConfig = {
  maxEpisodesToProcess: 10,
  minImportance: 0.5,
  deduplicationThreshold: 0.75, // 75% similar = duplicate (catches paraphrases)
};

export interface LessonExtractionResult {
  processed: number;
  factsCreated: number;
  duplicatesSkipped: number;
  episodes: Array<{ episodeId: string; factId?: string; lesson: string; skipped?: boolean }>;
}

/**
 * Run the lesson extraction cycle
 */
export async function runLessonExtractionCycle(
  config: Partial<LessonExtractionConfig> = {}
): Promise<LessonExtractionResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  logger.info('Starting lesson extraction cycle');

  const result: LessonExtractionResult = {
    processed: 0,
    factsCreated: 0,
    duplicatesSkipped: 0,
    episodes: [],
  };

  // Find negative episodes that haven't been processed for lessons
  const negativeEpisodes = await query<{
    id: string;
    summary: string;
    situation: Record<string, unknown>;
    action: Record<string, unknown>;
    outcome: Record<string, unknown>;
    type: string;
    importance: number;
    lessons_learned: string[];
  }>(
    `SELECT id, summary, situation, action, outcome, type, importance, lessons_learned
     FROM episodes
     WHERE valence = 'negative'
       AND success = false
       AND importance >= $1
       AND COALESCE((metadata->>'lessons_extracted')::boolean, false) = false
     ORDER BY importance DESC, timestamp DESC
     LIMIT $2`,
    [cfg.minImportance, cfg.maxEpisodesToProcess]
  );

  logger.info({ count: negativeEpisodes.length }, 'Found negative episodes to process');

  for (const episode of negativeEpisodes) {
    try {
      // Extract lesson using LLM
      const lessonResult = await extractLesson({
        summary: episode.summary,
        situation: episode.situation,
        action: episode.action,
        outcome: episode.outcome,
        type: episode.type,
        existingLessons: episode.lessons_learned || [],
      });

      if (lessonResult.lesson && lessonResult.confidence >= 0.6) {
        // Check for duplicate lessons before storing
        const isDuplicate = await checkForDuplicateLesson(
          lessonResult.lesson,
          cfg.deduplicationThreshold
        );

        if (isDuplicate) {
          logger.info({
            episodeId: episode.id,
            lesson: lessonResult.lesson.substring(0, 50),
          }, 'Skipping duplicate lesson');

          result.duplicatesSkipped++;
          result.episodes.push({
            episodeId: episode.id,
            lesson: lessonResult.lesson,
            skipped: true,
          });
        } else {
          // Store as semantic fact
          const fact = await semantic.storeFact({
            subject: lessonResult.subject || 'system',
            predicate: 'learned_that',
            object: lessonResult.lesson,
            statement: lessonResult.lesson,
            confidence: lessonResult.confidence,
            sources: [`episode:${episode.id}`],
            evidence: [{
              episodeId: episode.id,
              summary: episode.summary,
              extractedAt: new Date().toISOString(),
            }],
            category: 'learned_lesson',
            isTemporal: false,
          });

          result.factsCreated++;
          result.episodes.push({
            episodeId: episode.id,
            factId: fact.id,
            lesson: lessonResult.lesson,
          });

          logger.info({
            episodeId: episode.id,
            factId: fact.id,
            lesson: lessonResult.lesson.substring(0, 50),
          }, 'Extracted lesson from episode');
        }
      }

      // Mark episode as processed (store flag in metadata JSONB)
      await query(
        `UPDATE episodes SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"lessons_extracted": true}'::jsonb WHERE id = $1`,
        [episode.id]
      );

      result.processed++;
    } catch (err) {
      logger.error({ episodeId: episode.id, error: err }, 'Failed to extract lesson');
    }
  }

  logger.info({
    processed: result.processed,
    factsCreated: result.factsCreated,
    duplicatesSkipped: result.duplicatesSkipped,
  }, 'Lesson extraction cycle complete');

  return result;
}

/**
 * Check if a similar lesson already exists in semantic memory.
 * Uses embedding similarity to detect near-duplicates.
 */
async function checkForDuplicateLesson(
  lesson: string,
  threshold: number
): Promise<boolean> {
  try {
    // Generate embedding for the new lesson
    const embedding = await generateEmbedding(lesson);
    const embeddingStr = `[${embedding.join(',')}]`;

    // Find the most similar existing learned_lesson fact
    const similarFacts = await query<{ similarity: number }>(
      `SELECT 1 - (embedding <=> $1::vector) as similarity
       FROM knowledge_facts
       WHERE category = 'learned_lesson'
         AND embedding IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT 1`,
      [embeddingStr]
    );

    if (similarFacts.length === 0 || !similarFacts[0]) {
      return false; // No existing lessons, not a duplicate
    }

    const similarity = similarFacts[0].similarity ?? 0;
    logger.debug({ lesson: lesson.substring(0, 30), similarity, threshold }, 'Duplicate check');

    return similarity >= threshold;
  } catch (err) {
    logger.error({ error: err }, 'Failed to check for duplicate lesson');
    return false; // On error, allow the lesson (fail open)
  }
}
