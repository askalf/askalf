/**
 * Active Memory Gathering
 * Extracts facts from conversations and updates ALF's memory about the user
 *
 * This module runs AFTER each LLM response to:
 * 1. Create working context for the conversation
 * 2. Extract facts about the user (preferences, stated info, interests)
 * 3. Update ALF profile with learned information
 * 4. Record episode for the interaction
 * 5. Promote high-importance facts to semantic memory
 */

import { query } from '@substrate/database';
import { complete, generateEmbedding } from '@substrate/ai';
import { ids } from '@substrate/core';
import * as alf from '../alf/index.js';
import * as working from '../working/index.js';
import * as episodic from '../episodic/index.js';
import { getLogger } from '@substrate/observability';

const logger = getLogger();

// ============================================
// TYPES
// ============================================

export interface ConversationTurn {
  userMessage: string;
  assistantResponse: string;
  sessionId: string;
  model: string;
  provider: string;
  tokensUsed: number;
  responseMs: number;
}

export interface ExtractedUserInfo {
  // Personal facts about the user
  facts: Array<{
    category: 'preference' | 'personal' | 'work' | 'interest' | 'goal' | 'location' | 'correction';
    key: string;
    value: string;
    confidence: number;
  }>;
  // Inferred interests from the conversation
  interests: string[];
  // Professional domains mentioned
  domains: string[];
  // Goals or intentions expressed
  goals: string[];
  // Corrections to previous understanding
  corrections: string[];
  // Topics user wants to avoid
  avoidTopics: string[];
  // User's preferred name if mentioned
  preferredName?: string;
}

export interface GatherResult {
  workingContextId: string | null;
  episodeId: string | null;
  factsExtracted: number;
  profileUpdated: boolean;
  errors: string[];
}

// ============================================
// USER INFO EXTRACTION
// ============================================

/**
 * Extract information about the user from a conversation turn
 * Uses LLM to identify facts, preferences, interests, and corrections
 */
export async function extractUserInfo(
  userMessage: string,
  assistantResponse: string
): Promise<ExtractedUserInfo> {
  // Quick skip for short/simple messages
  if (userMessage.length < 20) {
    return {
      facts: [],
      interests: [],
      domains: [],
      goals: [],
      corrections: [],
      avoidTopics: [],
    };
  }

  const prompt = `Analyze this conversation turn and extract information about the user.
Only extract EXPLICIT facts that the user has stated. Do not infer or assume.

User message: "${userMessage}"
Assistant response: "${assistantResponse}"

Extract:
1. facts: Personal facts stated by user (name, preferences, job, location, etc.)
2. interests: Topics the user seems interested in (based on what they asked about)
3. domains: Professional or expertise areas (e.g., "software development", "marketing")
4. goals: Things the user wants to accomplish
5. corrections: If user corrected the assistant, what was wrong
6. avoidTopics: Topics user explicitly said to avoid
7. preferredName: If user mentioned their name or how they want to be called

Respond in JSON only:
{
  "facts": [{"category": "preference|personal|work|interest|goal|location|correction", "key": "...", "value": "...", "confidence": 0.9}],
  "interests": ["topic1", "topic2"],
  "domains": ["domain1"],
  "goals": ["goal1"],
  "corrections": ["the previous X was wrong, actually Y"],
  "avoidTopics": [],
  "preferredName": null
}

Return empty arrays if nothing relevant was said. Only include high-confidence extractions.`;

  try {
    const response = await complete(prompt, {
      model: 'claude-sonnet-4-5',
      temperature: 0,
      maxTokens: 1024,
    });

    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        facts: [],
        interests: [],
        domains: [],
        goals: [],
        corrections: [],
        avoidTopics: [],
      };
    }

    const extracted = JSON.parse(jsonMatch[0]) as ExtractedUserInfo;

    // Filter out low-confidence facts
    extracted.facts = (extracted.facts || []).filter(f => f.confidence >= 0.7);

    return extracted;
  } catch (err) {
    logger.warn({ err }, 'Failed to extract user info');
    return {
      facts: [],
      interests: [],
      domains: [],
      goals: [],
      corrections: [],
      avoidTopics: [],
    };
  }
}

// ============================================
// PROFILE UPDATE
// ============================================

/**
 * Update ALF profile with extracted user information
 * Merges new info with existing profile data
 */
async function updateProfileWithExtractedInfo(
  tenantId: string,
  extracted: ExtractedUserInfo,
  profile: alf.AlfProfile
): Promise<boolean> {
  // Skip if nothing to update
  if (
    extracted.facts.length === 0 &&
    extracted.interests.length === 0 &&
    extracted.domains.length === 0 &&
    extracted.goals.length === 0 &&
    !extracted.preferredName
  ) {
    return false;
  }

  const updates: alf.ProfileUpdate = {};

  // Update preferred name if discovered
  if (extracted.preferredName && !profile.preferredName) {
    updates.preferredName = extracted.preferredName;
  }

  // Merge interests (deduplicate)
  if (extracted.interests.length > 0) {
    const existingInterests = new Set(profile.interests.map(i => i.toLowerCase()));
    const newInterests = extracted.interests.filter(
      i => !existingInterests.has(i.toLowerCase())
    );
    if (newInterests.length > 0) {
      updates.interests = [...profile.interests, ...newInterests].slice(0, 20); // Cap at 20
    }
  }

  // Merge domains (deduplicate)
  if (extracted.domains.length > 0) {
    const existingDomains = new Set(profile.domains.map(d => d.toLowerCase()));
    const newDomains = extracted.domains.filter(
      d => !existingDomains.has(d.toLowerCase())
    );
    if (newDomains.length > 0) {
      updates.domains = [...profile.domains, ...newDomains].slice(0, 10); // Cap at 10
    }
  }

  // Merge goals (deduplicate)
  if (extracted.goals.length > 0) {
    const existingGoals = new Set(profile.goals.map(g => g.toLowerCase()));
    const newGoals = extracted.goals.filter(
      g => !existingGoals.has(g.toLowerCase())
    );
    if (newGoals.length > 0) {
      updates.goals = [...profile.goals, ...newGoals].slice(0, 10); // Cap at 10
    }
  }

  // Merge avoid topics
  if (extracted.avoidTopics.length > 0) {
    const existingAvoid = new Set(profile.avoidTopics.map(t => t.toLowerCase()));
    const newAvoid = extracted.avoidTopics.filter(
      t => !existingAvoid.has(t.toLowerCase())
    );
    if (newAvoid.length > 0) {
      updates.avoidTopics = [...profile.avoidTopics, ...newAvoid].slice(0, 10);
    }
  }

  // Merge aboutUser facts
  if (extracted.facts.length > 0) {
    const aboutUser = { ...profile.aboutUser };
    for (const fact of extracted.facts) {
      // Use fact key as the property name
      aboutUser[fact.key] = fact.value;
    }
    updates.aboutUser = aboutUser;
  }

  // Apply updates if any
  if (Object.keys(updates).length > 0) {
    await alf.updateProfile(tenantId, updates);
    // Record that we learned something
    await alf.recordActivity(tenantId, 'lesson');
    return true;
  }

  return false;
}

// ============================================
// MAIN GATHER FUNCTION
// ============================================

/**
 * Gather memory from a conversation turn
 * This should be called AFTER each LLM response
 */
export async function gatherFromConversation(
  tenantId: string,
  turn: ConversationTurn
): Promise<GatherResult> {
  const errors: string[] = [];
  let workingContextId: string | null = null;
  let episodeId: string | null = null;
  let factsExtracted = 0;
  let profileUpdated = false;

  const tenant = { tenantId };

  try {
    // 1. Create working context for this conversation turn
    const contextContent = `User: ${turn.userMessage}\n\nAssistant: ${turn.assistantResponse}`;
    const context = await working.createContext(
      {
        sessionId: turn.sessionId,
        rawContent: contextContent,
        contentType: 'conversation',
        originalTokens: Math.ceil(contextContent.length / 4),
        ttlSeconds: 3600, // 1 hour default
        extractedFacts: [],
        extractedEntities: [],
        noiseRemoved: [],
      },
      { tenant, visibility: 'private' }
    );
    workingContextId = context.id;
  } catch (err) {
    errors.push(`Failed to create working context: ${err}`);
    logger.warn({ err, tenantId }, 'Working context creation failed');
  }

  try {
    // 2. Extract user information
    const extracted = await extractUserInfo(turn.userMessage, turn.assistantResponse);
    factsExtracted = extracted.facts.length;

    // 3. Update ALF profile with extracted info
    if (factsExtracted > 0 || extracted.interests.length > 0 || extracted.domains.length > 0) {
      const profile = await alf.loadOrCreateProfile(tenantId);
      profileUpdated = await updateProfileWithExtractedInfo(tenantId, extracted, profile);
    }
  } catch (err) {
    errors.push(`Failed to extract/update user info: ${err}`);
    logger.warn({ err, tenantId }, 'User info extraction failed');
  }

  try {
    // 4. Record episode for this interaction
    const episode = await episodic.recordEpisode(
      {
        situation: {
          context: `User asked: ${turn.userMessage.substring(0, 200)}`,
          entities: [turn.model, turn.provider],
          state: { tokensUsed: turn.tokensUsed, responseMs: turn.responseMs },
        },
        action: {
          type: 'llm_response',
          description: `Responded using ${turn.model}`,
          parameters: { model: turn.model, provider: turn.provider },
        },
        outcome: {
          result: `Response: ${turn.assistantResponse.substring(0, 200)}...`,
          success: true,
          effects: ['user_served'],
          metrics: { tokensUsed: turn.tokensUsed, responseMs: turn.responseMs },
        },
        type: 'interaction',
        summary: `Answered user query using ${turn.model} (${turn.responseMs}ms)`,
        success: true,
        valence: 'positive',
        importance: 0.3, // Regular interactions are low importance
        lessonsLearned: [],
        sessionId: turn.sessionId,
        metadata: { model: turn.model, provider: turn.provider, tokensUsed: turn.tokensUsed },
        timestamp: new Date(),
      },
      { tenant, visibility: 'private' }
    );
    episodeId = episode.id;
  } catch (err) {
    errors.push(`Failed to record episode: ${err}`);
    logger.warn({ err, tenantId }, 'Episode recording failed');
  }

  // 5. If we have a working context and facts were extracted, consider liquidation
  if (workingContextId && factsExtracted > 0) {
    try {
      // Liquidate to extract structured facts
      await working.liquidateContext(workingContextId);

      // For high-value extractions, promote to semantic memory
      if (factsExtracted >= 2) {
        await working.promoteToSemantic(workingContextId, tenant);
      }
    } catch (err) {
      // Non-critical - don't add to errors, just log
      logger.debug({ err, contextId: workingContextId }, 'Context liquidation failed');
    }
  }

  return {
    workingContextId,
    episodeId,
    factsExtracted,
    profileUpdated,
    errors,
  };
}

/**
 * Quick check if a message is worth analyzing for memory
 * Skip trivial messages like "hi", "thanks", "ok"
 */
export function shouldGatherMemory(userMessage: string): boolean {
  const msg = userMessage.toLowerCase().trim();

  // Skip very short messages
  if (msg.length < 10) return false;

  // Skip common greetings/acknowledgments
  const skipPatterns = [
    /^(hi|hey|hello|yo)[\s!.,]*$/i,
    /^(thanks|thank you|thx|ty)[\s!.,]*$/i,
    /^(ok|okay|k|got it|sure|yes|no|yep|nope)[\s!.,]*$/i,
    /^(bye|goodbye|see you|cya)[\s!.,]*$/i,
    /^(cool|nice|great|awesome|perfect)[\s!.,]*$/i,
  ];

  for (const pattern of skipPatterns) {
    if (pattern.test(msg)) return false;
  }

  return true;
}

/**
 * Gather memory in the background (non-blocking)
 * Returns immediately, processing happens async
 */
export function gatherInBackground(
  tenantId: string,
  turn: ConversationTurn
): void {
  // Skip if message isn't worth analyzing
  if (!shouldGatherMemory(turn.userMessage)) {
    return;
  }

  // Run async without blocking
  gatherFromConversation(tenantId, turn).catch(err => {
    logger.error({ err, tenantId, sessionId: turn.sessionId }, 'Background memory gathering failed');
  });
}
