-- Community Skills Library
-- Users submit skills, Alf curates and publishes featured ones

ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'private';
ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS submitted_by TEXT;
ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS approved BOOLEAN DEFAULT false;
ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS featured BOOLEAN DEFAULT false;
ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS downloads INTEGER DEFAULT 0;
ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS rating_sum INTEGER DEFAULT 0;
ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;
ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS author_name TEXT;
ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
ALTER TABLE forge_agent_templates ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'system';

-- visibility: 'private' (user only), 'community' (submitted, pending), 'approved' (reviewed), 'featured' (alf curated)
-- source: 'system' (built-in), 'user' (user created), 'alf' (alf generated), 'community' (imported from library)

CREATE INDEX IF NOT EXISTS idx_templates_visibility ON forge_agent_templates(visibility) WHERE visibility != 'private';
CREATE INDEX IF NOT EXISTS idx_templates_featured ON forge_agent_templates(featured) WHERE featured = true;
CREATE INDEX IF NOT EXISTS idx_templates_downloads ON forge_agent_templates(downloads DESC);

-- Mark all existing templates as system/approved/featured
UPDATE forge_agent_templates SET visibility = 'approved', approved = true, source = 'system' WHERE visibility IS NULL OR visibility = 'private';
