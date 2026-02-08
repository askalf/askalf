/**
 * SELF Intelligence Layer
 * Memory recall injection, morning briefings, follow-up tracking,
 * conversation summarization, and preference learning.
 */

import { query, queryOne } from '../database.js';
import { logActivity } from './activity-logger.js';
import { publishActivity } from './sse-stream.js';

// ============================================
// Memory Recall Injection
// ============================================

interface MemoryRecall {
  facts: string[];
  episodes: string[];
  preferences: string[];
}

/**
 * Recall relevant memories for a given context.
 * Injects remembered facts, episodes, and preferences into the conversation.
 */
export async function recallMemories(
  tenantId: string,
  userId: string,
  context: string,
): Promise<MemoryRecall> {
  const recall: MemoryRecall = {
    facts: [],
    episodes: [],
    preferences: [],
  };

  try {
    // Recall from ALF profile (preferences, interests, about_user)
    const profile = await queryOne<{
      preferred_name: string | null;
      interests: string[];
      domains: string[];
      goals: string[];
      about_user: Record<string, string>;
      avoid_topics: string[];
    }>(
      `SELECT preferred_name, interests, domains, goals, about_user, avoid_topics
       FROM alf_profiles WHERE tenant_id = $1`,
      [tenantId],
    );

    if (profile) {
      if (profile.preferred_name) {
        recall.preferences.push(`User prefers to be called "${profile.preferred_name}"`);
      }
      if (profile.interests.length > 0) {
        recall.preferences.push(`Interests: ${profile.interests.join(', ')}`);
      }
      if (profile.domains.length > 0) {
        recall.preferences.push(`Domains: ${profile.domains.join(', ')}`);
      }
      if (profile.goals.length > 0) {
        recall.preferences.push(`Goals: ${profile.goals.join(', ')}`);
      }
      if (profile.about_user && Object.keys(profile.about_user).length > 0) {
        for (const [key, value] of Object.entries(profile.about_user)) {
          recall.facts.push(`${key}: ${value}`);
        }
      }
      if (profile.avoid_topics.length > 0) {
        recall.preferences.push(`Avoid topics: ${profile.avoid_topics.join(', ')}`);
      }
    }
  } catch {
    // ALF profiles table may not exist — continue without
  }

  try {
    // Recall recent episodes
    const episodes = await query<{
      summary: string;
      type: string;
      timestamp: string;
    }>(
      `SELECT summary, type, timestamp
       FROM episodes
       WHERE owner_id = $1 OR agent_id = $1
       ORDER BY timestamp DESC
       LIMIT 5`,
      [tenantId],
    );

    for (const ep of episodes) {
      recall.episodes.push(`[${ep.type}] ${ep.summary}`);
    }
  } catch {
    // Episodes table structure may differ
  }

  try {
    // Recall relevant semantic facts
    const facts = await query<{
      subject: string;
      predicate: string;
      object: string;
    }>(
      `SELECT subject, predicate, object
       FROM knowledge_facts
       WHERE (owner_id = $1 OR visibility = 'public')
         AND confidence > 0.7
       ORDER BY access_count DESC, confidence DESC
       LIMIT 10`,
      [tenantId],
    );

    for (const fact of facts) {
      recall.facts.push(`${fact.subject} ${fact.predicate} ${fact.object}`);
    }
  } catch {
    // Knowledge facts may not have owner_id
  }

  return recall;
}

/**
 * Build a memory context block to inject into SELF's system prompt
 */
export function buildMemoryContext(recall: MemoryRecall): string {
  const sections: string[] = [];

  if (recall.preferences.length > 0) {
    sections.push(`## What I Know About You\n${recall.preferences.join('\n')}`);
  }

  if (recall.facts.length > 0) {
    sections.push(`## Remembered Facts\n${recall.facts.join('\n')}`);
  }

  if (recall.episodes.length > 0) {
    sections.push(`## Recent History\n${recall.episodes.join('\n')}`);
  }

  if (sections.length === 0) return '';

  return `\n\n---\n# Memory Context\n${sections.join('\n\n')}`;
}

// ============================================
// Morning Briefing
// ============================================

/**
 * Generate a morning briefing for a SELF instance.
 * Summarizes overnight activity, upcoming calendar events, and pending items.
 */
export async function generateMorningBriefing(
  selfId: string,
  userId: string,
): Promise<string> {
  const parts: string[] = [];

  // 1. Overnight activity count
  const overnightCount = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM self_activities
     WHERE self_id = $1 AND created_at > NOW() - INTERVAL '8 hours'`,
    [selfId],
  );
  const count = parseInt(overnightCount?.count ?? '0', 10);
  if (count > 0) {
    parts.push(`${count} activities while you were away.`);
  }

  // 2. Pending approvals
  const pendingApprovals = await queryOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM self_approvals
     WHERE self_id = $1 AND status = 'pending'`,
    [selfId],
  );
  const approvalCount = parseInt(pendingApprovals?.count ?? '0', 10);
  if (approvalCount > 0) {
    parts.push(`${approvalCount} pending approval${approvalCount > 1 ? 's' : ''} waiting for your decision.`);
  }

  // 3. Budget status
  const budget = await queryOne<{ daily_spent_usd: string; daily_budget_usd: string }>(
    `SELECT daily_spent_usd, daily_budget_usd FROM self_instances WHERE id = $1`,
    [selfId],
  );
  if (budget) {
    const spent = parseFloat(budget.daily_spent_usd);
    const total = parseFloat(budget.daily_budget_usd);
    const remaining = total - spent;
    parts.push(`Budget: $${remaining.toFixed(2)} remaining today.`);
  }

  // 4. Important activities
  const importantActivities = await query<{ title: string; type: string }>(
    `SELECT title, type FROM self_activities
     WHERE self_id = $1 AND created_at > NOW() - INTERVAL '8 hours'
       AND importance >= 7 AND visible_to_user = true
     ORDER BY importance DESC
     LIMIT 3`,
    [selfId],
  );
  if (importantActivities.length > 0) {
    parts.push('Key highlights:');
    for (const a of importantActivities) {
      parts.push(`  - ${a.title}`);
    }
  }

  if (parts.length === 0) {
    return 'Good morning! Everything is quiet — no activity overnight and no pending items.';
  }

  return `Good morning! Here's your briefing:\n\n${parts.join('\n')}`;
}

// ============================================
// Follow-up Intelligence
// ============================================

interface FollowUp {
  id: string;
  selfId: string;
  userId: string;
  topic: string;
  context: string;
  checkAfterMs: number;
  createdAt: string;
}

/**
 * Create a follow-up reminder.
 * SELF remembers to check back on something.
 */
export async function createFollowUp(params: {
  selfId: string;
  userId: string;
  topic: string;
  context: string;
  checkAfterHours: number;
}): Promise<string> {
  const { selfId, userId, topic, context, checkAfterHours } = params;
  const id = (await import('ulid')).ulid();

  await query(
    `INSERT INTO self_schedules (id, self_id, name, action_type, action_config, interval_ms, next_run_at, enabled)
     VALUES ($1, $2, $3, 'follow_up', $4, NULL, NOW() + ($5 || ' hours')::interval, true)`,
    [
      id,
      selfId,
      `Follow up: ${topic}`,
      JSON.stringify({ topic, context, userId, oneShot: true }),
      checkAfterHours,
    ],
  );

  await logActivity({
    selfId,
    userId,
    type: 'memory',
    title: `Will follow up: ${topic}`,
    body: `Checking back in ${checkAfterHours} hours.`,
    importance: 4,
    visibleToUser: false,
  });

  return id;
}

// ============================================
// Conversation Summarization
// ============================================

/**
 * Summarize a conversation into an episodic memory entry.
 * Called when a conversation ends or becomes stale.
 */
export async function summarizeConversation(
  conversationId: string,
  selfId: string,
  tenantId: string,
): Promise<void> {
  // Load messages
  const messages = await query<{ role: string; content: string; created_at: string }>(
    `SELECT role, content, created_at FROM self_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC`,
    [conversationId],
  );

  if (messages.length < 2) return;

  // Build summary from messages
  const userMessages = messages.filter(m => m.role === 'user').map(m => m.content);
  const topics = userMessages.map(m => m.length > 80 ? m.slice(0, 77) + '...' : m);

  const summary = `Conversation with ${messages.length} messages. Topics: ${topics.slice(0, 3).join('; ')}`;

  try {
    const { ids } = await import('@substrate/core');
    const episodeId = ids.episode();

    await query(
      `INSERT INTO episodes (id, situation, action, outcome, type, summary, success, importance, owner_id, timestamp)
       VALUES ($1, $2, $3, $4, 'self_conversation', $5, true, 0.5, $6, NOW())`,
      [
        episodeId,
        JSON.stringify({ conversation_id: conversationId, message_count: messages.length }),
        JSON.stringify({ type: 'conversation', topics: topics.slice(0, 5) }),
        JSON.stringify({ completed: true }),
        summary,
        tenantId,
      ],
    );
  } catch {
    // Episode creation is non-critical
  }
}

// ============================================
// Preference Learning
// ============================================

/**
 * Learn from approval/rejection patterns.
 * When a user approves or rejects actions, SELF adjusts its understanding.
 */
export async function learnFromApproval(params: {
  selfId: string;
  userId: string;
  tenantId: string;
  approvalId: string;
  action: 'approved' | 'rejected';
  actionType: string;
  context: Record<string, unknown>;
}): Promise<void> {
  const { selfId, userId, tenantId, action, actionType } = params;

  // Track approval patterns
  try {
    // Check if we have an ALF profile to update
    const profile = await queryOne<{ id: string; about_user: Record<string, string> }>(
      `SELECT id, about_user FROM alf_profiles WHERE tenant_id = $1`,
      [tenantId],
    );

    if (profile) {
      // Record the preference pattern
      const key = action === 'approved'
        ? `approved_actions`
        : `rejected_actions`;

      const existing = profile.about_user[key] ?? '';
      const actions = existing ? existing.split(',') : [];

      if (!actions.includes(actionType)) {
        actions.push(actionType);
        const updated = { ...profile.about_user, [key]: actions.join(',') };

        await query(
          `UPDATE alf_profiles SET about_user = $1, updated_at = NOW() WHERE tenant_id = $2`,
          [JSON.stringify(updated), tenantId],
        );
      }
    }
  } catch {
    // Non-critical
  }

  // Log the learning
  await logActivity({
    selfId,
    userId,
    type: 'memory',
    title: `Learned: user ${action} "${actionType}" actions`,
    importance: 3,
    visibleToUser: false,
  });
}

// ============================================
// Proactive Insights
// ============================================

/**
 * Generate proactive insights based on patterns SELF has observed.
 * Called during heartbeat when SELF has enough context.
 */
export async function generateInsights(
  selfId: string,
  userId: string,
): Promise<string[]> {
  const insights: string[] = [];

  // Check for recurring patterns in approvals
  const approvalPatterns = await query<{ type: string; count: string }>(
    `SELECT type, COUNT(*) as count FROM self_approvals
     WHERE self_id = $1 AND status = 'approved'
       AND created_at > NOW() - INTERVAL '7 days'
     GROUP BY type
     HAVING COUNT(*) >= 3
     ORDER BY count DESC`,
    [selfId],
  );

  for (const pattern of approvalPatterns) {
    insights.push(
      `You've approved ${pattern.count} "${pattern.type}" actions this week. Consider increasing autonomy for these.`
    );
  }

  // Check if daily budget is consistently hit
  const budgetHistory = await query<{ daily_spent_usd: string }>(
    `SELECT daily_spent_usd FROM self_activities
     WHERE self_id = $1 AND type = 'system'
       AND title LIKE '%budget%'
       AND created_at > NOW() - INTERVAL '7 days'
     LIMIT 7`,
    [selfId],
  );

  // More insights can be added as patterns emerge

  return insights;
}
