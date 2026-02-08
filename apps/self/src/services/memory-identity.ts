/**
 * Memory Identity Bridge
 * Bridges SELF with the existing @substrate/memory gather system.
 * After each conversation turn, triggers memory extraction to learn about the user.
 */

import { query } from '../database.js';

/**
 * Trigger memory gathering for a SELF conversation turn.
 * Uses the existing memory gather infrastructure from @substrate/memory.
 *
 * In Phase 1, we store the conversation context for later processing.
 * The existing gather system runs as part of the main API, so we enqueue
 * the gathering via a simple database record that the worker can pick up.
 */
export async function triggerMemoryGather(params: {
  tenantId: string;
  userId: string;
  selfId: string;
  userMessage: string;
  assistantResponse: string;
  sessionId: string;
  executionId: string;
}): Promise<void> {
  const { tenantId, userMessage, assistantResponse } = params;

  // Skip very short messages that won't yield useful info
  if (userMessage.length < 20) {
    return;
  }

  try {
    // Check if alf_profiles table exists and update interaction count
    await query(
      `UPDATE alf_profiles
       SET total_interactions = total_interactions + 1,
           last_interaction_at = NOW(),
           updated_at = NOW()
       WHERE tenant_id = $1`,
      [tenantId],
    );
  } catch {
    // alf_profiles may not exist for this user yet — that's fine
  }

  try {
    // Store a working context for the gather system to process
    const { ids } = await import('@substrate/core');
    const contextId = ids.context();

    await query(
      `INSERT INTO working_contexts
       (id, session_id, raw_content, content_type, status, ttl_seconds, expires_at, original_tokens)
       VALUES ($1, $2, $3, 'self_conversation', 'raw', 3600, NOW() + INTERVAL '1 hour', $4)`,
      [
        contextId,
        params.sessionId,
        JSON.stringify({
          user_message: userMessage,
          assistant_response: assistantResponse,
          source: 'self',
          self_id: params.selfId,
        }),
        Math.ceil((userMessage.length + assistantResponse.length) / 4),
      ],
    );
  } catch (err) {
    // Non-critical: log but don't fail the conversation
    console.error('[SELF Memory] Failed to store working context:', err);
  }
}
