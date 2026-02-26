-- 026: Store theme preference server-side for cross-device persistence
ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference TEXT;
