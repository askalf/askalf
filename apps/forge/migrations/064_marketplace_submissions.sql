CREATE TABLE IF NOT EXISTS marketplace_submissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  system_prompt TEXT NOT NULL,
  tools TEXT[] DEFAULT '{}',
  model TEXT DEFAULT 'claude-sonnet-4-6',
  author_name TEXT,
  author_email TEXT,
  instance_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'ai_reviewing', 'reviewed', 'approved', 'rejected', 'quarantined')),
  ai_review JSONB,
  ai_review_score NUMERIC(3,1),
  reviewer_notes TEXT,
  install_count INTEGER DEFAULT 0,
  rating_sum INTEGER DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_marketplace_submissions_status ON marketplace_submissions(status);
CREATE INDEX IF NOT EXISTS idx_marketplace_submissions_category ON marketplace_submissions(category);
