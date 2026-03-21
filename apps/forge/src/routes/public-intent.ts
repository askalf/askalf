/**
 * Public Intent Parser — Landing Page Demo
 *
 * Lightweight, rate-limited, public endpoint that lets visitors
 * experience the enhanced NL intent parser from the landing page.
 *
 * Abuse protections:
 * - IP-based rate limiting (10 requests/minute)
 * - Input length cap (200 chars)
 * - Haiku model only (~$0.001/request)
 * - Classification only — no tool use, no execution
 * - 5 second timeout
 * - No auth required
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// In-memory rate limiter per IP
const ipCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipCounts) {
    if (now > entry.resetAt) ipCounts.delete(ip);
  }
}, 300_000);

const DEMO_SYSTEM_PROMPT = `You are the intent parser for AskAlf — an AI workforce platform where Alf is the master intelligence that composes the right team for ANY task.

AskAlf is NOT just for software. It handles marketing, support, e-commerce, research, legal, operations, finance — any industry. Alf spawns purpose-built specialists on demand.

Given a user's task request, respond with JSON only:
{
  "category": "research|security|monitor|build|analyze|automate|operations|custom",
  "agents": [
    { "name": "Worker Name", "role": "What this worker would do", "custom": true }
  ],
  "summary": "One sentence explaining the routing decision"
}

HOW IT WORKS:
- Alf analyzes the request and creates the RIGHT specialist(s) for the job
- Each specialist gets a precise name: "Competitor Researcher", "Invoice Monitor", "SEO Analyst", "Security Scanner", "Content Writer", "Customer Support Agent", "Data Pipeline Builder", etc.
- Specialists are first-class workers — they use tools, store memories, create tickets, and coordinate with each other
- Workers are spawned on demand with the exact system prompt and domain knowledge needed

Rules:
- Assign 1-4 workers maximum
- First worker is the PRIMARY handler
- Give each worker a specific, descriptive name that reflects the DOMAIN expertise
- Be specific about what each worker would do — include the domain expertise
- Keep summary under 20 words
- NEVER use generic names like "Agent 1" — always use descriptive role names`;

// No hardcoded agent color map — colors are assigned dynamically on the frontend

export async function publicIntentRoutes(app: FastifyInstance): Promise<void> {
  // Only enable on the hosted instance — not in self-hosted open-source deployments
  if (process.env['ENABLE_PUBLIC_DEMO'] !== 'true') {
    return;
  }

  app.post(
    '/api/v1/public/intent',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Rate limit by IP
      const ip = request.headers['x-forwarded-for'] as string || request.ip || 'unknown';
      if (!checkRateLimit(ip)) {
        return reply.code(429).send({ error: 'Rate limited. Try again in a minute.', agents: [] });
      }

      const body = request.body as { message?: string } | null;
      const message = body?.message?.trim();

      if (!message) {
        return reply.code(400).send({ error: 'Message is required', agents: [] });
      }

      // Input sanitization
      if (message.length > 200) {
        return reply.code(400).send({ error: 'Message too long (max 200 chars)', agents: [] });
      }

      // Check for API key
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        // Fallback to keyword matching
        return reply.send(keywordFallback(message));
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);

        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 256,
            system: DEMO_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: message }],
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!res.ok) {
          return reply.send(keywordFallback(message));
        }

        const data = await res.json() as {
          content: Array<{ type: string; text?: string }>;
        };

        const text = data.content?.find(b => b.type === 'text')?.text || '';

        // Parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return reply.send(keywordFallback(message));
        }

        const parsed = JSON.parse(jsonMatch[0]) as {
          category?: string;
          agents?: Array<{ name: string; role: string; custom?: boolean }>;
          summary?: string;
        };

        // Map to response format with dynamic colors
        const PALETTE = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c', '#f87171', '#e879f9', '#2dd4bf', '#3b82f6'];
        const result = {
          enhanced: true,
          category: parsed.category || 'operations',
          summary: parsed.summary || '',
          agents: (parsed.agents || []).map((a, i) => ({
            name: a.name,
            custom: a.custom ?? true,
            role: a.role,
            color: PALETTE[i % PALETTE.length],
            primary: i === 0,
          })),
        };

        return reply.send(result);
      } catch {
        return reply.send(keywordFallback(message));
      }
    },
  );
}

function keywordFallback(message: string): {
  enhanced: boolean;
  category: string;
  summary: string;
  agents: Array<{ name: string; role: string; color: string; primary: boolean; custom: boolean }>;
} {
  const msg = message.toLowerCase();

  const routes: Array<{
    kw: string[];
    category: string;
    agents: Array<{ name: string; role: string }>;
  }> = [
    { kw: ['security', 'vuln', 'cve', 'scan', 'audit', 'secret', 'leak'], category: 'security', agents: [{ name: 'Security Scanner', role: 'Run vulnerability scan' }] },
    { kw: ['monitor', 'health', 'alert', 'down', 'slow', 'memory', 'cpu'], category: 'monitor', agents: [{ name: 'System Monitor', role: 'Run diagnostics' }] },
    { kw: ['deploy', 'ship', 'release', 'push', 'production'], category: 'operations', agents: [{ name: 'Deploy Manager', role: 'Run deploy pipeline' }] },
    { kw: ['doc', 'readme', 'changelog', 'write', 'blog', 'content'], category: 'automate', agents: [{ name: 'Content Writer', role: 'Draft content' }] },
    { kw: ['research', 'competitor', 'market', 'find', 'search', 'seo'], category: 'research', agents: [{ name: 'Researcher', role: 'Investigate and compile findings' }] },
    { kw: ['support', 'customer', 'ticket', 'help desk'], category: 'operations', agents: [{ name: 'Support Agent', role: 'Handle support request' }] },
    { kw: ['invoice', 'billing', 'payment', 'accounting'], category: 'operations', agents: [{ name: 'Finance Monitor', role: 'Process financial task' }] },
    { kw: ['code', 'build', 'develop', 'api', 'database', 'bug', 'fix'], category: 'build', agents: [{ name: 'Builder', role: 'Implement and build' }] },
    { kw: ['analyze', 'data', 'report', 'metrics', 'trend'], category: 'analyze', agents: [{ name: 'Analyst', role: 'Analyze data and report' }] },
  ];

  for (const r of routes) {
    if (r.kw.some(k => msg.includes(k))) {
      return {
        enhanced: false,
        category: r.category,
        summary: `Alf assigns ${r.agents[0]!.name}`,
        agents: r.agents.map((a, i) => ({ ...a, color: ['#a78bfa', '#60a5fa', '#34d399'][i] ?? '#94a3b8', primary: i === 0, custom: true })),
      };
    }
  }

  return {
    enhanced: false,
    category: 'operations',
    summary: 'Alf assigns a specialist for this task',
    agents: [{ name: 'Task Specialist', role: 'Analyze and execute request', color: '#a78bfa', primary: true, custom: true }],
  };
}
