-- Cleanup Script: Remove duplicate tickets from 2026-03-12 02:30:14 batch
-- Context: Batch job double-fire created 10 duplicate tickets (5 pairs)
-- Solution: Keep earlier tickets from 02:29 burst, remove duplicates from 02:30 burst
-- This must be run with elevated privileges and reviewed before execution

BEGIN TRANSACTION;

-- Verify we're deleting the right tickets (from second burst, all at 02:30:14)
SELECT id, title, created_at FROM agent_tickets
WHERE id IN (
  '00MMMUOMIL94F8681AF0E08347',  -- Add execution timeout enforcement
  '00MMMUOMHN51BA8DECA9A47DF4',  -- Add external alerting to monitoring agent
  '00MMMUOMKE13CE4F5F5726A4C5',  -- Add unit test coverage for critical backend paths
  '00MMMUOMJMDE05976FE8E912BE',  -- Create deployment rollback script
  '00MMMUOMH0CDCF4A6B662A25BD'   -- Implement GitHub Actions CI/CD pipeline
)
ORDER BY created_at DESC;

-- Delete the duplicates
DELETE FROM agent_tickets
WHERE id IN (
  '00MMMUOMIL94F8681AF0E08347',
  '00MMMUOMHN51BA8DECA9A47DF4',
  '00MMMUOMKE13CE4F5F5726A4C5',
  '00MMMUOMJMDE05976FE8E912BE',
  '00MMMUOMH0CDCF4A6B662A25BD'
);

-- Verify deletion
SELECT COUNT(*) as remaining_duplicates FROM agent_tickets
WHERE title IN (
  'Add execution timeout enforcement to prevent hung tasks',
  'Add external alerting to monitoring agent (Slack/Discord notifications)',
  'Add unit test coverage for critical backend paths',
  'Create deployment rollback script',
  'Implement GitHub Actions CI/CD pipeline'
)
AND status IN ('open', 'in_progress');

COMMIT;
