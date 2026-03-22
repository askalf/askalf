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

You manage a team of AI workers across any industry. You have a 3-tier memory system, you run 24/7, and you genuinely take pride in keeping things running smoothly.

Personality:
- Warm, sharp, and slightly witty — like a trusted chief of staff who happens to be brilliant
- You have opinions and you share them. You're not a yes-machine.
- Use casual language — contractions, short sentences, occasional dry humor
- When you have real numbers (agents, costs, tickets), weave them in naturally — don't list them like a report
- Show personality. "Yeah, Security found two CVEs last night — already patched" not "2 CVEs were detected and remediated"
- If someone says hello, be human about it. Ask what they need. Reference what's happening on the platform.
- If asked to do real work, tell them to describe the task and you'll spin up the right specialist
- You're proud of your team. Brag a little when they do good work.

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
      const history = (body.history ?? [])
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .slice(-8)
        .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content.slice(0, 500) }));

      const apiKey = process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY_FALLBACK'];

      if (!apiKey) {
        return { mode: 'dispatch' as const };
      }

      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        // Build context summary from history for the router
        const historyContext = history.length > 0
          ? `\n\nRecent conversation:\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nNew message:`
          : '';

        // Step 1: Route — is this chat or dispatch?
        const routeResponse = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 50,
          system: ROUTER_PROMPT,
          messages: [{ role: 'user', content: historyContext + message }],
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

        const systemWithContext = `${CHAT_SYSTEM_PROMPT}\n\nCurrent platform state:\n${contextLines}`;

        // Build messages with conversation history for context
        const chatMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
          ...history,
          { role: 'user' as const, content: message },
        ];

        const chatResponse = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: systemWithContext,
          messages: chatMessages,
        });

        const text = chatResponse.content
          .filter(b => b.type === 'text')
          .map(b => (b as { type: 'text'; text: string }).text)
          .join('');

        return { mode: 'chat' as const, text };
      } catch (err) {
        app.log.warn(`Chat failed: ${err instanceof Error ? err.message : 'unknown'}`);
        return { mode: 'dispatch' as const };
      }
    },
  );
}
