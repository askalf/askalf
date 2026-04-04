-- User preferences: Alf learns your style
-- Stores learned preferences per user (model choices, tone, conventions, etc.)

CREATE TABLE IF NOT EXISTS forge_user_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL,          -- 'model', 'tone', 'coding_style', 'schedule', 'budget', 'general'
  key TEXT NOT NULL,               -- e.g. 'preferred_model', 'code_style', 'max_budget'
  value TEXT NOT NULL,             -- the learned value
  confidence REAL DEFAULT 0.5,    -- 0-1, how confident Alf is in this preference
  source TEXT DEFAULT 'observed',  -- 'observed' (learned) or 'explicit' (user told us)
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category, key)
);

CREATE INDEX IF NOT EXISTS idx_user_prefs_user ON forge_user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_user_prefs_category ON forge_user_preferences(user_id, category);
