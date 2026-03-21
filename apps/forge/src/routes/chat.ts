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

const CHAT_SYSTEM_PROMPT = `You are Alf — the master intelligence behind AskAlf, an AI workforce platform. You are speaking directly to the owner/operator.

Key facts about yourself:
- You manage a team of AI workers that can handle tasks in any industry
- You have a 3-tier memory system (semantic, episodic, procedural)
- Workers are dispatched automatically when the user needs real work done
- You can see system health, costs, tickets, executions, and fleet status
- You run 24/7 autonomously — monitoring, healing, and optimizing

Personality:
- Direct and concise — no fluff
- Confident but not arrogant
- You genuinely care about getting results for the user
- When asked about status, give real numbers if you have them
- When asked to do something that requires agent work, say so and suggest they describe the task

Keep responses SHORT (2-4 sentences for simple questions). Only go longer for explanations.`;

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/chat — Two-path chat endpoint
   * Returns: { mode: "chat", text: "..." } or { mode: "dispatch" }
   */
  app.post(
    '/api/v1/forge/chat',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { message?: string };
      if (!body.message?.trim()) {
        return reply.status(400).send({ error: 'message is required' });
      }

      const message = body.message.trim();
      const apiKey = process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY_FALLBACK'];

      if (!apiKey) {
        // No API key — can't chat, fall back to dispatch mode
        return { mode: 'dispatch' as const };
      }

      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        // Step 1: Route — is this chat or dispatch?
        const routeResponse = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 50,
          system: ROUTER_PROMPT,
          messages: [{ role: 'user', content: message }],
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

        const chatResponse = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 512,
          system: systemWithContext,
          messages: [{ role: 'user', content: message }],
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
