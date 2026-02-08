-- ============================================
-- ALF PROFILES: Per-User Personal AI Assistant
-- Strict tenant isolation - each user has their own ALF
-- ============================================

-- ALF Profile table
CREATE TABLE IF NOT EXISTS alf_profiles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- ============================================
  -- PERSONALITY & COMMUNICATION PREFERENCES
  -- ============================================
  preferred_name TEXT,                    -- "Call me Mike"
  communication_style TEXT DEFAULT 'balanced',  -- 'concise', 'detailed', 'balanced'
  tone TEXT DEFAULT 'friendly',           -- 'friendly', 'professional', 'casual', 'formal'
  detail_level TEXT DEFAULT 'moderate',   -- 'brief', 'moderate', 'comprehensive'
  response_format TEXT DEFAULT 'adaptive', -- 'adaptive', 'markdown', 'plain', 'structured'

  -- ============================================
  -- USER CONTEXT & KNOWLEDGE
  -- ============================================
  about_user JSONB DEFAULT '{}',          -- {"profession": "developer", "company": "Acme", "expertise": ["TypeScript"]}
  interests TEXT[] DEFAULT '{}',          -- Topics user is interested in
  domains TEXT[] DEFAULT '{}',            -- Professional domains
  goals TEXT[] DEFAULT '{}',              -- What user wants to achieve with ALF
  avoid_topics TEXT[] DEFAULT '{}',       -- Topics to not bring up

  -- ============================================
  -- LEARNING & MEMORY SETTINGS
  -- ============================================
  remember_preferences BOOLEAN DEFAULT true,     -- Learn from interactions
  learn_from_corrections BOOLEAN DEFAULT true,   -- Adjust when corrected
  personal_facts_enabled BOOLEAN DEFAULT true,   -- Store personal facts
  private_shards_enabled BOOLEAN DEFAULT true,   -- Create user-specific shards
  -- NO share_improvements - user data is 100% ISOLATED, never shared

  -- ============================================
  -- CUSTOM INSTRUCTIONS (System Prompt Injection)
  -- ============================================
  custom_instructions TEXT,               -- Free-form instructions for ALF
  -- Examples:
  -- "Always suggest unit tests for code"
  -- "Prefer functional programming patterns"
  -- "Remind me to take breaks during long sessions"
  -- "Use analogies when explaining complex topics"

  -- ============================================
  -- MODEL PREFERENCES
  -- ============================================
  preferred_model TEXT,                   -- Default model for this user
  fallback_model TEXT,                    -- Fallback if preferred unavailable
  max_tokens_per_response INTEGER,        -- Limit response length

  -- ============================================
  -- STATS & TRACKING
  -- ============================================
  conversations_count INTEGER DEFAULT 0,
  messages_count INTEGER DEFAULT 0,
  lessons_learned INTEGER DEFAULT 0,      -- Times ALF learned from correction
  shard_hits INTEGER DEFAULT 0,           -- Times user benefited from shards

  -- ============================================
  -- TIMESTAMPS
  -- ============================================
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_active_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookup
CREATE UNIQUE INDEX IF NOT EXISTS idx_alf_profiles_tenant
  ON alf_profiles(tenant_id);  -- One profile per tenant (strict isolation)

CREATE INDEX IF NOT EXISTS idx_alf_profiles_active
  ON alf_profiles(last_active_at DESC);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_alf_profile_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_alf_profiles_updated_at ON alf_profiles;
CREATE TRIGGER trg_alf_profiles_updated_at
  BEFORE UPDATE ON alf_profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_alf_profile_updated_at();

-- ============================================
-- PERSONAL FACTS TABLE (User-specific knowledge)
-- ============================================
-- Note: knowledge_facts already has owner_id for isolation
-- But we can add a specific view for personal facts

CREATE OR REPLACE VIEW user_personal_facts AS
SELECT
  kf.*,
  t.name as owner_name
FROM knowledge_facts kf
LEFT JOIN tenants t ON kf.owner_id = t.id
WHERE kf.visibility = 'private'
  AND kf.owner_id IS NOT NULL;

-- ============================================
-- HELPER FUNCTION: Get user's full context
-- ============================================
CREATE OR REPLACE FUNCTION get_user_alf_context(p_tenant_id TEXT)
RETURNS TABLE (
  profile_json JSONB,
  private_facts_count BIGINT,
  private_shards_count BIGINT,
  recent_topics TEXT[]
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    (SELECT to_jsonb(ap.*) FROM alf_profiles ap WHERE ap.tenant_id = p_tenant_id) as profile_json,
    (SELECT COUNT(*) FROM knowledge_facts WHERE owner_id = p_tenant_id AND visibility = 'private') as private_facts_count,
    (SELECT COUNT(*) FROM procedural_shards WHERE owner_id = p_tenant_id AND visibility = 'private') as private_shards_count,
    (SELECT ARRAY_AGG(DISTINCT topic) FROM (
      SELECT unnest(topics) as topic
      FROM working_contexts
      WHERE owner_id = p_tenant_id
      ORDER BY updated_at DESC
      LIMIT 10
    ) t) as recent_topics;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- AUTO-CREATE PROFILE ON TENANT CREATION
-- ============================================
CREATE OR REPLACE FUNCTION auto_create_alf_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO alf_profiles (id, tenant_id)
  VALUES ('alf_' || substr(md5(random()::text), 1, 24), NEW.id)
  ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auto_create_alf_profile ON tenants;
CREATE TRIGGER trg_auto_create_alf_profile
  AFTER INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION auto_create_alf_profile();

-- ============================================
-- CREATE PROFILES FOR EXISTING TENANTS
-- ============================================
INSERT INTO alf_profiles (id, tenant_id)
SELECT
  'alf_' || substr(md5(t.id || random()::text), 1, 24),
  t.id
FROM tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM alf_profiles ap WHERE ap.tenant_id = t.id
)
ON CONFLICT (tenant_id) DO NOTHING;

-- ============================================
-- COMMENTS
-- ============================================
COMMENT ON TABLE alf_profiles IS 'Per-user ALF (AI Learning Friend) configuration. 100% ISOLATED - no data crosses between users.';
COMMENT ON COLUMN alf_profiles.custom_instructions IS 'Free-form instructions injected into system prompt for personalization';
COMMENT ON COLUMN alf_profiles.about_user IS 'Structured knowledge about the user: profession, company, expertise, etc.';
