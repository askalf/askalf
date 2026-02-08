/**
 * ALF Profile Store
 * Personal AI assistant configuration - 100% isolated per user
 */

import { query, queryOne } from '@substrate/database';

// ============================================
// TYPES
// ============================================

export interface AlfProfile {
  id: string;
  tenantId: string;

  // Personality & Communication
  preferredName: string | null;
  communicationStyle: 'concise' | 'detailed' | 'balanced';
  tone: 'friendly' | 'professional' | 'casual' | 'formal';
  detailLevel: 'brief' | 'moderate' | 'comprehensive';
  responseFormat: 'adaptive' | 'markdown' | 'plain' | 'structured';

  // User Context
  aboutUser: Record<string, unknown>;
  interests: string[];
  domains: string[];
  goals: string[];
  avoidTopics: string[];

  // Learning Settings
  rememberPreferences: boolean;
  learnFromCorrections: boolean;
  personalFactsEnabled: boolean;
  privateShardsEnabled: boolean;

  // Custom Instructions
  customInstructions: string | null;

  // Model Preferences
  preferredModel: string | null;
  fallbackModel: string | null;
  maxTokensPerResponse: number | null;

  // Stats
  conversationsCount: number;
  messagesCount: number;
  lessonsLearned: number;
  shardHits: number;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastActiveAt: Date;
}

// ============================================
// LOAD PROFILE (Strict tenant isolation)
// ============================================

/**
 * Load ALF profile for a specific tenant
 * Returns null if no profile exists (should never happen with auto-create trigger)
 */
export async function loadProfile(tenantId: string): Promise<AlfProfile | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM alf_profiles WHERE tenant_id = $1`,
    [tenantId]
  );

  if (!row) return null;

  return mapRowToProfile(row);
}

/**
 * Load profile or create default if missing
 */
export async function loadOrCreateProfile(tenantId: string): Promise<AlfProfile> {
  let profile = await loadProfile(tenantId);

  if (!profile) {
    // Create default profile
    const id = 'alf_' + Math.random().toString(36).substring(2, 26);
    await query(
      `INSERT INTO alf_profiles (id, tenant_id) VALUES ($1, $2) ON CONFLICT (tenant_id) DO NOTHING`,
      [id, tenantId]
    );
    profile = await loadProfile(tenantId);
  }

  return profile!;
}

// ============================================
// UPDATE PROFILE
// ============================================

export interface ProfileUpdate {
  preferredName?: string | null;
  communicationStyle?: 'concise' | 'detailed' | 'balanced';
  tone?: 'friendly' | 'professional' | 'casual' | 'formal';
  detailLevel?: 'brief' | 'moderate' | 'comprehensive';
  responseFormat?: 'adaptive' | 'markdown' | 'plain' | 'structured';
  aboutUser?: Record<string, unknown>;
  interests?: string[];
  domains?: string[];
  goals?: string[];
  avoidTopics?: string[];
  rememberPreferences?: boolean;
  learnFromCorrections?: boolean;
  personalFactsEnabled?: boolean;
  privateShardsEnabled?: boolean;
  customInstructions?: string | null;
  preferredModel?: string | null;
  fallbackModel?: string | null;
  maxTokensPerResponse?: number | null;
}

/**
 * Update ALF profile for a tenant
 * Only updates fields that are provided
 */
export async function updateProfile(
  tenantId: string,
  updates: ProfileUpdate
): Promise<AlfProfile | null> {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Build dynamic SET clause
  if (updates.preferredName !== undefined) {
    setClauses.push(`preferred_name = $${paramIndex++}`);
    params.push(updates.preferredName);
  }
  if (updates.communicationStyle !== undefined) {
    setClauses.push(`communication_style = $${paramIndex++}`);
    params.push(updates.communicationStyle);
  }
  if (updates.tone !== undefined) {
    setClauses.push(`tone = $${paramIndex++}`);
    params.push(updates.tone);
  }
  if (updates.detailLevel !== undefined) {
    setClauses.push(`detail_level = $${paramIndex++}`);
    params.push(updates.detailLevel);
  }
  if (updates.responseFormat !== undefined) {
    setClauses.push(`response_format = $${paramIndex++}`);
    params.push(updates.responseFormat);
  }
  if (updates.aboutUser !== undefined) {
    setClauses.push(`about_user = $${paramIndex++}`);
    params.push(JSON.stringify(updates.aboutUser));
  }
  if (updates.interests !== undefined) {
    setClauses.push(`interests = $${paramIndex++}`);
    params.push(updates.interests);
  }
  if (updates.domains !== undefined) {
    setClauses.push(`domains = $${paramIndex++}`);
    params.push(updates.domains);
  }
  if (updates.goals !== undefined) {
    setClauses.push(`goals = $${paramIndex++}`);
    params.push(updates.goals);
  }
  if (updates.avoidTopics !== undefined) {
    setClauses.push(`avoid_topics = $${paramIndex++}`);
    params.push(updates.avoidTopics);
  }
  if (updates.rememberPreferences !== undefined) {
    setClauses.push(`remember_preferences = $${paramIndex++}`);
    params.push(updates.rememberPreferences);
  }
  if (updates.learnFromCorrections !== undefined) {
    setClauses.push(`learn_from_corrections = $${paramIndex++}`);
    params.push(updates.learnFromCorrections);
  }
  if (updates.personalFactsEnabled !== undefined) {
    setClauses.push(`personal_facts_enabled = $${paramIndex++}`);
    params.push(updates.personalFactsEnabled);
  }
  if (updates.privateShardsEnabled !== undefined) {
    setClauses.push(`private_shards_enabled = $${paramIndex++}`);
    params.push(updates.privateShardsEnabled);
  }
  if (updates.customInstructions !== undefined) {
    setClauses.push(`custom_instructions = $${paramIndex++}`);
    params.push(updates.customInstructions);
  }
  if (updates.preferredModel !== undefined) {
    setClauses.push(`preferred_model = $${paramIndex++}`);
    params.push(updates.preferredModel);
  }
  if (updates.fallbackModel !== undefined) {
    setClauses.push(`fallback_model = $${paramIndex++}`);
    params.push(updates.fallbackModel);
  }
  if (updates.maxTokensPerResponse !== undefined) {
    setClauses.push(`max_tokens_per_response = $${paramIndex++}`);
    params.push(updates.maxTokensPerResponse);
  }

  if (setClauses.length === 0) {
    return loadProfile(tenantId);
  }

  params.push(tenantId);

  await query(
    `UPDATE alf_profiles SET ${setClauses.join(', ')}, updated_at = NOW() WHERE tenant_id = $${paramIndex}`,
    params
  );

  return loadProfile(tenantId);
}

// ============================================
// STATS & ACTIVITY
// ============================================

/**
 * Record activity (updates last_active_at and counters)
 */
export async function recordActivity(
  tenantId: string,
  type: 'conversation' | 'message' | 'lesson' | 'shard_hit'
): Promise<void> {
  const updates: string[] = ['last_active_at = NOW()'];

  switch (type) {
    case 'conversation':
      updates.push('conversations_count = conversations_count + 1');
      break;
    case 'message':
      updates.push('messages_count = messages_count + 1');
      break;
    case 'lesson':
      updates.push('lessons_learned = lessons_learned + 1');
      break;
    case 'shard_hit':
      updates.push('shard_hits = shard_hits + 1');
      break;
  }

  await query(
    `UPDATE alf_profiles SET ${updates.join(', ')} WHERE tenant_id = $1`,
    [tenantId]
  );
}

// ============================================
// BUILD SYSTEM PROMPT INJECTION
// ============================================

/**
 * Build the system prompt injection from ALF profile
 * This is injected FIRST before any other context
 */
export function buildSystemPromptInjection(profile: AlfProfile): string {
  const parts: string[] = [];

  // Greeting / Name
  if (profile.preferredName) {
    parts.push(`The user prefers to be called "${profile.preferredName}".`);
  }

  // Communication preferences — only inject if user explicitly changed from defaults
  // 'balanced' + 'friendly' are assumed defaults; don't inject these so ALF starts neutral
  if (profile.communicationStyle !== 'balanced') {
    const styleMap = {
      concise: 'Keep responses brief and to the point.',
      detailed: 'Provide thorough, detailed explanations.',
      balanced: '',
    };
    parts.push(styleMap[profile.communicationStyle]);
  }

  if (profile.tone !== 'friendly') {
    const toneMap = {
      friendly: '',
      professional: 'Maintain a professional tone.',
      casual: 'Keep it casual and relaxed.',
      formal: 'Use formal language.',
    };
    parts.push(toneMap[profile.tone]);
  }

  // About user
  if (profile.aboutUser && Object.keys(profile.aboutUser).length > 0) {
    parts.push('\nAbout this user:');
    for (const [key, value] of Object.entries(profile.aboutUser)) {
      parts.push(`- ${key}: ${value}`);
    }
  }

  // Interests
  if (profile.interests.length > 0) {
    parts.push(`\nUser's interests: ${profile.interests.join(', ')}`);
  }

  // Domains
  if (profile.domains.length > 0) {
    parts.push(`Professional domains: ${profile.domains.join(', ')}`);
  }

  // Goals
  if (profile.goals.length > 0) {
    parts.push(`\nUser's goals with ALF:`);
    for (const goal of profile.goals) {
      parts.push(`- ${goal}`);
    }
  }

  // Avoid topics
  if (profile.avoidTopics.length > 0) {
    parts.push(`\nAvoid discussing: ${profile.avoidTopics.join(', ')}`);
  }

  // Custom instructions (user-provided, goes last)
  if (profile.customInstructions) {
    parts.push(`\nUser's custom instructions:\n${profile.customInstructions}`);
  }

  return parts.join('\n');
}

// ============================================
// HELPER
// ============================================

function mapRowToProfile(row: Record<string, unknown>): AlfProfile {
  return {
    id: row['id'] as string,
    tenantId: row['tenant_id'] as string,
    preferredName: row['preferred_name'] as string | null,
    communicationStyle: (row['communication_style'] as AlfProfile['communicationStyle']) || 'balanced',
    tone: (row['tone'] as AlfProfile['tone']) || 'friendly',
    detailLevel: (row['detail_level'] as AlfProfile['detailLevel']) || 'moderate',
    responseFormat: (row['response_format'] as AlfProfile['responseFormat']) || 'adaptive',
    aboutUser: (row['about_user'] as Record<string, unknown>) || {},
    interests: (row['interests'] as string[]) || [],
    domains: (row['domains'] as string[]) || [],
    goals: (row['goals'] as string[]) || [],
    avoidTopics: (row['avoid_topics'] as string[]) || [],
    rememberPreferences: row['remember_preferences'] as boolean ?? true,
    learnFromCorrections: row['learn_from_corrections'] as boolean ?? true,
    personalFactsEnabled: row['personal_facts_enabled'] as boolean ?? true,
    privateShardsEnabled: row['private_shards_enabled'] as boolean ?? true,
    customInstructions: row['custom_instructions'] as string | null,
    preferredModel: row['preferred_model'] as string | null,
    fallbackModel: row['fallback_model'] as string | null,
    maxTokensPerResponse: row['max_tokens_per_response'] as number | null,
    conversationsCount: row['conversations_count'] as number || 0,
    messagesCount: row['messages_count'] as number || 0,
    lessonsLearned: row['lessons_learned'] as number || 0,
    shardHits: row['shard_hits'] as number || 0,
    createdAt: new Date(row['created_at'] as string),
    updatedAt: new Date(row['updated_at'] as string),
    lastActiveAt: new Date(row['last_active_at'] as string),
  };
}
