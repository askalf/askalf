-- Add lessons_extracted column to episodes table
-- Required by metabolic lesson extraction cycle (packages/metabolic/src/cycles/lessons.ts)
-- Tracks which episodes have already been processed for lesson extraction

ALTER TABLE episodes ADD COLUMN IF NOT EXISTS lessons_extracted BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_episodes_lessons_extracted ON episodes(lessons_extracted)
  WHERE lessons_extracted IS NULL OR lessons_extracted = false;
