/**
 * Self Tools — Remember/Recall for persistent user memory.
 * In CLI mode, most tools are handled natively by Claude Code or via MCP.
 * These two tools remain because they hit Self's own database directly.
 */

import { ulid } from 'ulid';
import { selfQuery } from '../database.js';

// ============================================
// Tool Executor (called from engine if needed)
// ============================================

export interface ToolResult {
  content: string;
  actions?: { type: string; provider?: string; status?: string; url?: string }[];
}

export async function executeSelfTool(
  name: string,
  input: Record<string, unknown>,
  userId: string,
  conversationId?: string,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'remember':
        return await handleRemember(userId, input, conversationId);
      case 'recall':
        return await handleRecall(userId, input);
      default:
        return { content: JSON.stringify({ error: `Unknown tool: ${name}` }) };
    }
  } catch (err) {
    return { content: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }) };
  }
}

// ============================================
// Tool Handlers
// ============================================

async function handleRemember(
  userId: string,
  input: Record<string, unknown>,
  conversationId?: string,
): Promise<ToolResult> {
  const key = input['key'] as string;
  const value = input['value'] as string;
  const category = input['category'] as string;

  if (!key || !value || !category) {
    return { content: JSON.stringify({ error: 'key, value, and category are required' }) };
  }

  await selfQuery(
    `INSERT INTO user_preferences (id, user_id, category, key, value, source_conversation_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, key) DO UPDATE SET value = $5, category = $3, updated_at = NOW()`,
    [ulid(), userId, category, key, value, conversationId ?? null],
  );

  return { content: JSON.stringify({ stored: true, key, category }) };
}

async function handleRecall(userId: string, input: Record<string, unknown>): Promise<ToolResult> {
  const query = input['query'] as string | undefined;
  const category = (input['category'] as string) || 'all';

  let sql = 'SELECT key, value, category FROM user_preferences WHERE user_id = $1';
  const params: unknown[] = [userId];

  if (category && category !== 'all') {
    sql += ' AND category = $2';
    params.push(category);
  }

  if (query) {
    sql += params.length === 1 ? ' AND (key ILIKE $2 OR value ILIKE $2)' : ' AND (key ILIKE $3 OR value ILIKE $3)';
    params.push(`%${query}%`);
  }

  sql += ' ORDER BY updated_at DESC LIMIT 50';

  const preferences = await selfQuery<{ key: string; value: string; category: string }>(sql, params);

  return {
    content: JSON.stringify({ preferences, total: preferences.length }),
  };
}
