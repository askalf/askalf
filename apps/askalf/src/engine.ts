/**
 * Ask Alf Streaming Engine
 * Multi-provider SSE streaming with classifier routing.
 */

import type { FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { askalfQuery, askalfQueryOne } from './database.js';
import { getProvider } from './providers/registry.js';
import { classifyPrompt } from './classifier/index.js';
import { decrypt } from './utils/encryption.js';
import type { ChatMessage } from './providers/types.js';

interface MessageRow {
  role: string;
  content: string;
}

interface CredentialRow {
  credential_enc: string;
}

interface PreferenceRow {
  default_provider: string;
  default_model: string | null;
}

/**
 * Resolve the API key for a provider:
 * 1. User's stored key (encrypted in askalf_credentials)
 * 2. Platform fallback from env
 */
async function resolveApiKey(userId: string, providerId: string): Promise<string> {
  // Check user's stored credential
  const credential = await askalfQueryOne<CredentialRow>(
    `SELECT credential_enc FROM askalf_credentials WHERE user_id = $1 AND provider = $2`,
    [userId, providerId],
  );

  if (credential) {
    try {
      return decrypt(credential.credential_enc);
    } catch {
      console.error(`[AskAlf] Failed to decrypt ${providerId} credential for user ${userId}, falling back`);
    }
  }

  // Platform fallback
  const envKey = providerId === 'claude'
    ? process.env['ANTHROPIC_API_KEY']
    : providerId === 'openai'
      ? process.env['OPENAI_API_KEY']
      : undefined;

  if (!envKey) {
    throw new Error(`No ${providerId} API key available. Add your key in Integrations.`);
  }

  return envKey;
}

/**
 * Stream a chat response via SSE.
 */
export async function streamChat(
  userId: string,
  conversationId: string,
  userMessage: string,
  requestedProvider: string | undefined,
  requestedModel: string | undefined,
  reply: FastifyReply,
): Promise<void> {
  // Set SSE headers
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Store user message
    const userMsgId = ulid();
    await askalfQuery(
      `INSERT INTO askalf_messages (id, conversation_id, role, content) VALUES ($1, $2, 'user', $3)`,
      [userMsgId, conversationId, userMessage],
    );

    await askalfQuery(
      `UPDATE askalf_conversations SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1`,
      [conversationId],
    );

    // Determine provider + model
    let providerId: string;
    let model: string;
    let classified = false;

    if (requestedProvider && requestedProvider !== 'auto') {
      // User explicitly chose a provider
      providerId = requestedProvider;
      const provider = getProvider(providerId);
      if (!provider) throw new Error(`Unknown provider: ${providerId}`);
      model = requestedModel || provider.defaultModel;
    } else {
      // Auto-classify: check user preferences first
      const prefs = await askalfQueryOne<PreferenceRow>(
        `SELECT default_provider, default_model FROM askalf_preferences WHERE user_id = $1`,
        [userId],
      );

      const choice = classifyPrompt(
        userMessage,
        prefs?.default_provider ?? undefined,
        prefs?.default_model ?? undefined,
      );
      providerId = choice.provider;
      model = choice.model;
      classified = true;
    }

    const provider = getProvider(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    // Validate model is available for this provider
    if (!provider.models.includes(model)) {
      model = provider.defaultModel;
    }

    // Send provider info to frontend
    send('provider', { provider: providerId, model, classified });

    // Resolve API key
    const apiKey = await resolveApiKey(userId, providerId);

    // Load conversation history (last 50 messages)
    const history = await askalfQuery<MessageRow>(
      `SELECT role, content FROM askalf_messages
       WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 50`,
      [conversationId],
    );

    // Build messages array (excluding the just-inserted user message since it's in history)
    const messages: ChatMessage[] = history.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Stream the response
    let fullContent = '';
    const result = await provider.streamChat(apiKey, {
      model,
      messages,
      onToken: (text: string) => {
        fullContent += text;
        send('token', { text });
      },
    });

    // Store assistant message
    const assistantMsgId = ulid();
    await askalfQuery(
      `INSERT INTO askalf_messages (id, conversation_id, role, content, provider, model, tokens_used, classified)
       VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7)`,
      [assistantMsgId, conversationId, fullContent, providerId, model, result.totalTokens, classified],
    );

    await askalfQuery(
      `UPDATE askalf_conversations SET message_count = message_count + 1, updated_at = NOW() WHERE id = $1`,
      [conversationId],
    );

    // Auto-generate title after first exchange
    const convo = await askalfQueryOne<{ message_count: number; title: string | null }>(
      `SELECT message_count, title FROM askalf_conversations WHERE id = $1`,
      [conversationId],
    );

    if (convo && convo.message_count <= 2 && !convo.title) {
      const title = generateTitle(userMessage);
      await askalfQuery(
        `UPDATE askalf_conversations SET title = $1 WHERE id = $2`,
        [title, conversationId],
      );
      send('title', { title });
    }

    send('done', { tokens: result.totalTokens, provider: providerId, model });
  } catch (err) {
    console.error('[AskAlf Engine] Error:', err);
    send('error', { message: err instanceof Error ? err.message : 'An error occurred' });
  } finally {
    reply.raw.end();
  }
}

function generateTitle(firstMessage: string): string {
  const words = firstMessage.trim().split(/\s+/).slice(0, 6);
  let title = words.join(' ');
  if (firstMessage.trim().split(/\s+/).length > 6) {
    title += '...';
  }
  return title.length > 60 ? title.slice(0, 57) + '...' : title;
}
