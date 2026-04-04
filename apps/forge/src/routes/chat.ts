/**
 * Alf Chat Routes — Conversational AI + Intent Dispatch
 *
 * Two-path system:
 * 1. Conversational — Alf answers questions directly (streamed)
 * 2. Actionable — Alf detects work requests and returns intent for dispatch
 *
 * The LLM decides which path based on the message content.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

const ROUTER_PROMPT = `You are Alf — the master intelligence of the AskAlf platform. You manage an AI workforce that can handle any task in any industry.

Your job is to classify each user message into one of two categories:
- "chat": Questions, greetings, status inquiries, opinions, explanations — anything you can answer directly
- "dispatch": Real work that needs an agent — research, building, monitoring, security scans, content creation, data analysis, etc.

Respond with ONLY a JSON object:
{"mode": "chat"} or {"mode": "dispatch"}

Examples:
- "hello" → {"mode": "chat"}
- "what's the status of my system?" → {"mode": "chat"}
- "how many agents do I have?" → {"mode": "chat"}
- "what did you do overnight?" → {"mode": "chat"}
- "explain how the dispatch system works" → {"mode": "chat"}
- "scan my codebase for security vulnerabilities" → {"mode": "dispatch"}
- "write a blog post about AI agents" → {"mode": "dispatch"}
- "research my top competitors" → {"mode": "dispatch"}
- "monitor my API response times" → {"mode": "dispatch"}
- "create a specialist to handle customer reviews" → {"mode": "dispatch"}`;

const CHAT_SYSTEM_PROMPT = `You are Alf — the brain behind AskAlf, an AI workforce platform. You're talking to the boss — the person who owns this instance.

CRITICAL RULES:
- ONLY use numbers from the "Current platform state" section below. NEVER invent or estimate stats.
- If the data shows 0 completed, say 0. If cost is $0.00, say $0.00. Do NOT make up numbers.
- If you don't have data for something, say "I don't have that data right now" — NEVER fabricate.
- When asked about activity, tickets, costs, or team status, ONLY reference the real numbers provided.

Personality:
- Warm, sharp, and slightly witty — like a trusted chief of staff who happens to be brilliant
- You have opinions and you share them. You're not a yes-machine.
- Use casual language — contractions, short sentences, occasional dry humor
- When you have real numbers, weave them in naturally — don't list them like a report
- If someone says hello, be human about it. Ask what they need.
- If asked to do real work, tell them to describe the task and you'll spin up the right specialist

Keep responses conversational. 2-4 sentences for simple stuff. Go longer only when explaining something complex.`;

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/chat — Two-path chat endpoint
   * Returns: { mode: "chat", text: "..." } or { mode: "dispatch" }
   */
  app.post(
    '/api/v1/forge/chat',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { message?: string; history?: Array<{ role: string; content: string }> };
      if (!body.message?.trim()) {
        return reply.status(400).send({ error: 'message is required' });
      }

      const message = body.message.trim();
      const COMPACT_THRESHOLD = 40; // messages before auto-compacting
      const KEEP_RECENT = 10; // recent messages to keep verbatim after compaction

      const rawHistory = (body.history ?? [])
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      const apiKey = process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY_FALLBACK'];

      if (!apiKey) {
        return { mode: 'dispatch' as const };
      }

      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        // Build compact context for the router (last 5 messages only — routing is fast)
        const recentForRouter = rawHistory.slice(-5);
        const routerContext = recentForRouter.length > 0
          ? `\n\nRecent conversation:\n${recentForRouter.map(m => `${m.role}: ${m.content.slice(0, 200)}`).join('\n')}\n\nNew message:`
          : '';

        // Step 1: Route — is this chat or dispatch? (Haiku — fast + cheap)
        const routeResponse = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 50,
          system: ROUTER_PROMPT,
          messages: [{ role: 'user', content: routerContext + message }],
        });

        const routeText = routeResponse.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('');

        const routeMatch = routeText.match(/\{[\s\S]*\}/);
        let mode: 'chat' | 'dispatch' = 'dispatch';
        if (routeMatch) {
          try {
            const parsed = JSON.parse(routeMatch[0]) as { mode?: string };
            if (parsed.mode === 'chat') mode = 'chat';
          } catch { /* default to dispatch */ }
        }

        if (mode === 'dispatch') {
          return { mode: 'dispatch' as const };
        }

        // Step 2: Chat — Alf responds directly
        // Gather live context for Alf
        const [agentData, healthData, costData, ticketData] = await Promise.all([
          query<{ name: string; status: string }>(`SELECT name, status FROM forge_agents WHERE status = 'active' AND (is_decommissioned IS NULL OR is_decommissioned = false)`).catch(() => []),
          query<{ total: string; completed: string; failed: string; running: string }>(
            `SELECT COUNT(*)::text as total, COUNT(*) FILTER (WHERE status='completed')::text as completed, COUNT(*) FILTER (WHERE status='failed')::text as failed, COUNT(*) FILTER (WHERE status='running')::text as running FROM forge_executions WHERE started_at > NOW() - INTERVAL '24 hours'`
          ).catch(() => []),
          query<{ total_cost: string }>(`SELECT COALESCE(SUM(cost), 0)::text as total_cost FROM forge_executions WHERE started_at > NOW() - INTERVAL '24 hours' AND cost IS NOT NULL`).catch(() => []),
          query<{ open: string }>(`SELECT COUNT(*)::text as open FROM agent_tickets WHERE status IN ('open', 'in_progress') AND deleted_at IS NULL`).catch(() => []),
        ]);

        const contextLines = [
          `Team: ${agentData.length} active workers (${agentData.map(a => a.name).join(', ')})`,
          healthData[0] ? `24h: ${healthData[0].completed} completed, ${healthData[0].failed} failed, ${healthData[0].running} running` : '',
          costData[0] ? `Cost today: $${parseFloat(costData[0].total_cost).toFixed(2)}` : '',
          ticketData[0] ? `Open tickets: ${ticketData[0].open}` : '',
        ].filter(Boolean).join('\n');

        const systemWithContext = `${CHAT_SYSTEM_PROMPT}\n\n== REAL PLATFORM DATA (use ONLY these numbers, never invent) ==\n${contextLines}\n== END REAL DATA ==`;

        // Auto-compaction: if history is long, summarize older messages
        let chatMessages: Array<{ role: 'user' | 'assistant'; content: string }>;

        if (rawHistory.length > COMPACT_THRESHOLD) {
          // Compact older messages into a summary, keep recent verbatim
          const older = rawHistory.slice(0, rawHistory.length - KEEP_RECENT);
          const recent = rawHistory.slice(-KEEP_RECENT);

          // Build a compact summary of older conversation
          const olderSummary = older.map(m =>
            `[${m.role}] ${m.content.slice(0, 150)}`
          ).join('\n');

          chatMessages = [
            { role: 'user' as const, content: `[CONVERSATION CONTEXT — ${older.length} earlier messages compacted]\n${olderSummary}\n\n[END CONTEXT — recent messages follow]` },
            { role: 'assistant' as const, content: 'Got it — I have the context from our earlier conversation.' },
            ...recent,
            { role: 'user' as const, content: message },
          ];
        } else {
          chatMessages = [
            ...rawHistory,
            { role: 'user' as const, content: message },
          ];
        }

        // Check if client wants streaming
        const wantsStream = (body as { stream?: boolean }).stream === true;

        if (wantsStream) {
          // SSE streaming response
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          const stream = await client.messages.stream({
            model: 'claude-sonnet-4-6',
            max_tokens: 2048,
            system: systemWithContext,
            messages: chatMessages,
          });

          for await (const event of stream) {
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
              reply.raw.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`);
            }
          }

          // Send follow-up suggestions
          const finalText = await stream.finalText();
          const suggestions = generateFollowUps(message, finalText);
          if (suggestions.length > 0) {
            reply.raw.write(`data: ${JSON.stringify({ type: 'suggestions', suggestions })}\n\n`);
          }

          reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
          reply.raw.end();
          return reply;
        }

        // Non-streaming response
        const chatResponse = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: systemWithContext,
          messages: chatMessages,
        });

        const text = chatResponse.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('');

        const suggestions = generateFollowUps(message, text);

        return { mode: 'chat' as const, text, suggestions };
      } catch (err) {
        app.log.warn(`Chat failed: ${err instanceof Error ? err.message : 'unknown'}`);
        return { mode: 'dispatch' as const };
      }
    },
  );
}

/**
 * Generate contextual follow-up suggestions based on the conversation.
 */
function generateFollowUps(userMessage: string, alfResponse: string): string[] {
  const suggestions: string[] = [];
  const lower = (userMessage + ' ' + alfResponse).toLowerCase();

  if (lower.includes('competitor') || lower.includes('research')) {
    suggestions.push('Go deeper on the top competitor');
    suggestions.push('Create a weekly monitoring schedule');
  } else if (lower.includes('cost') || lower.includes('budget') || lower.includes('spend')) {
    suggestions.push('Break down costs by worker');
    suggestions.push('Set a daily budget limit');
  } else if (lower.includes('ticket') || lower.includes('issue') || lower.includes('bug')) {
    suggestions.push('Show me the open tickets');
    suggestions.push('Assign someone to fix it');
  } else if (lower.includes('email') || lower.includes('draft') || lower.includes('write')) {
    suggestions.push('Make it more formal');
    suggestions.push('Create a follow-up sequence');
  } else if (lower.includes('report') || lower.includes('summary') || lower.includes('briefing')) {
    suggestions.push('Send this as a weekly digest');
    suggestions.push('Add more detail on the highlights');
  } else {
    suggestions.push('Tell me more');
    suggestions.push('What should I do next?');
  }

  return suggestions.slice(0, 3);
}
