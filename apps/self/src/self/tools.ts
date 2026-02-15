/**
 * Self Tools — Claude API tool definitions and executor.
 * These tools let Self check connections, remember preferences,
 * and search the web during conversation.
 */

import { ulid } from 'ulid';
import { selfQuery, selfQueryOne } from '../database.js';
import { encrypt } from '../utils/encryption.js';

// ============================================
// Tool Definitions (Anthropic Tool format)
// ============================================

export interface SelfTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const SELF_TOOLS: SelfTool[] = [
  {
    name: 'check_connections',
    description: 'Check which external services the user has connected (Google, Microsoft, GitHub). Use this to know what data sources are available before suggesting actions.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'initiate_connection',
    description: 'Start the process of connecting an external service. The user will see a connect button in the conversation. Use this when the user wants to connect a service or when you need access to their data.',
    input_schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['google', 'microsoft', 'github'], description: 'The service to connect' },
      },
      required: ['provider'],
    },
  },
  {
    name: 'check_credentials',
    description: 'Check which AI provider credentials the user has configured (Claude, OpenAI).',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'prompt_credential',
    description: 'Ask the user to provide an API key for an AI provider. The user will see an input field in the conversation. Use this when enhanced AI capabilities are needed.',
    input_schema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['claude', 'openai'], description: 'The AI provider' },
      },
      required: ['provider'],
    },
  },
  {
    name: 'remember',
    description: 'Store something you learned about the user. Use this to remember preferences, facts, behaviors, and context across conversations. Be specific with keys.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'A specific, descriptive key (e.g., "preferred_language", "company_name", "timezone")' },
        value: { type: 'string', description: 'The value to remember' },
        category: { type: 'string', enum: ['preference', 'fact', 'behavior', 'context'], description: 'Category of information' },
      },
      required: ['key', 'value', 'category'],
    },
  },
  {
    name: 'recall',
    description: 'Retrieve stored information about the user. Use this to recall preferences, facts, or context before responding.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to match against stored preferences (optional, omit for all)' },
        category: { type: 'string', enum: ['preference', 'fact', 'behavior', 'context', 'all'], description: 'Filter by category' },
      },
    },
  },
  {
    name: 'web_search',
    description: 'Search the web for current information. Use this when you need up-to-date data or to answer questions about recent events.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
        num_results: { type: 'number', description: 'Number of results to return (default: 5)' },
      },
      required: ['query'],
    },
  },
];

// ============================================
// Tool Executor
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
      case 'check_connections':
        return await handleCheckConnections(userId);
      case 'initiate_connection':
        return await handleInitiateConnection(userId, input);
      case 'check_credentials':
        return await handleCheckCredentials(userId);
      case 'prompt_credential':
        return await handlePromptCredential(input);
      case 'remember':
        return await handleRemember(userId, input, conversationId);
      case 'recall':
        return await handleRecall(userId, input);
      case 'web_search':
        return await handleWebSearch(input);
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

async function handleCheckConnections(userId: string): Promise<ToolResult> {
  const connections = await selfQuery<{ provider: string; status: string; profile_data: unknown }>(
    `SELECT provider, status, profile_data FROM user_connections WHERE user_id = $1`,
    [userId],
  );

  const connected = connections.filter(c => c.status === 'active').map(c => c.provider);
  const available = ['google', 'microsoft', 'github'].filter(p => !connected.includes(p));

  return {
    content: JSON.stringify({
      connected,
      available,
      details: connections,
    }),
  };
}

async function handleInitiateConnection(userId: string, input: Record<string, unknown>): Promise<ToolResult> {
  const provider = input['provider'] as string;
  if (!['google', 'microsoft', 'github'].includes(provider)) {
    return { content: JSON.stringify({ error: 'Invalid provider' }) };
  }

  // Check if already connected
  const existing = await selfQueryOne<{ status: string }>(
    `SELECT status FROM user_connections WHERE user_id = $1 AND provider = $2`,
    [userId, provider],
  );

  if (existing?.status === 'active') {
    return { content: JSON.stringify({ already_connected: true, provider }) };
  }

  // Return action_required — frontend will render the connect button
  return {
    content: JSON.stringify({ action_required: true, provider, message: `Ready to connect ${provider}` }),
    actions: [{ type: 'connect', provider, status: 'pending' }],
  };
}

async function handleCheckCredentials(userId: string): Promise<ToolResult> {
  const credentials = await selfQuery<{ provider: string; last4: string | null; status: string }>(
    `SELECT provider, last4, status FROM user_credentials WHERE user_id = $1`,
    [userId],
  );

  const configured = credentials.filter(c => c.status === 'active').map(c => c.provider);
  const available = ['claude', 'openai'].filter(p => !configured.includes(p));

  return {
    content: JSON.stringify({ configured, available, details: credentials }),
  };
}

async function handlePromptCredential(input: Record<string, unknown>): Promise<ToolResult> {
  const provider = input['provider'] as string;
  if (!['claude', 'openai'].includes(provider)) {
    return { content: JSON.stringify({ error: 'Invalid provider' }) };
  }

  return {
    content: JSON.stringify({ action_required: true, provider, message: `Please provide your ${provider} API key` }),
    actions: [{ type: 'credential', provider, status: 'pending' }],
  };
}

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

async function handleWebSearch(input: Record<string, unknown>): Promise<ToolResult> {
  const query = input['query'] as string;
  const numResults = (input['num_results'] as number) ?? 5;

  if (!query?.trim()) {
    return { content: JSON.stringify({ error: 'query is required' }) };
  }

  try {
    const url = `http://searxng:8080/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=en&pageno=1`;
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      return { content: JSON.stringify({ error: `Search failed: ${response.status}` }) };
    }

    const data = await response.json() as { results: { title: string; url: string; content: string }[] };
    const results = (data.results || []).slice(0, Math.min(numResults, 10)).map(r => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));

    return { content: JSON.stringify({ query, results, total: results.length }) };
  } catch (err) {
    return { content: JSON.stringify({ error: `Search error: ${err instanceof Error ? err.message : String(err)}` }) };
  }
}
