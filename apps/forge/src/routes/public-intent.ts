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

const DEMO_SYSTEM_PROMPT = `You are the intent parser for AskAlf — an AI agent fleet platform with 7 core agents and the ability to spawn unlimited custom specialists on demand.

Given a user's task request, respond with JSON only:
{
  "category": "dev|security|monitor|deploy|docs|frontend|testing|custom",
  "agents": [
    { "name": "Agent Name", "role": "What this agent would do", "custom": false }
  ],
  "summary": "One sentence explaining the routing decision"
}

CORE AGENTS (always available):
- Backend Dev: API routes, database, server logic, bug fixes, migrations
- Frontend Dev: React components, UI, CSS, dashboard features
- QA: Tests, validation, quality assurance, coverage
- Infra: Docker, deploys, infrastructure, Kubernetes, CI/CD
- Security: Vulnerability scanning, dependency audits, secret detection, CVEs
- Watchdog: Health checks, monitoring, incident detection, performance
- Writer: Documentation, changelogs, runbooks, technical writing

CUSTOM SPECIALISTS: For ANY task outside basic web dev and infra, spin up a custom specialist. Set "custom": true and give it a precise name that describes the expertise: "O365 Migration Engineer", "Data Pipeline Architect", "HIPAA Compliance Auditor", "ML Ops Specialist", "Salesforce Integration Dev", "Terraform Specialist", "iOS Build Engineer", etc.

Custom agents are created on the fly with the exact tools, system prompt, and domain knowledge needed for the job. They're first-class agents — they can create tickets, store memories, and coordinate with core agents.

Rules:
- Assign 1-4 agents maximum
- First agent is the PRIMARY handler
- PREFER custom specialists for domain-specific tasks — they're purpose-built
- Only use core agents (Backend Dev, Frontend Dev, QA, etc.) for generic web dev, testing, monitoring, or documentation tasks
- Core agents are best for tasks involving the AskAlf platform itself
- Be specific about what each agent would do — include the domain expertise
- Keep summary under 20 words`;

const agents: Record<string, string> = {
  'Backend Dev': '#60a5fa',
  'Frontend Dev': '#a78bfa',
  'QA': '#34d399',
  'Infra': '#fb923c',
  'Security': '#f87171',
  'Watchdog': '#2dd4bf',
  'Writer': '#e879f9',
};

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

        // Map to response format with colors
        const result = {
          enhanced: true,
          category: parsed.category || 'dev',
          summary: parsed.summary || '',
          agents: (parsed.agents || []).map((a, i) => ({
            name: a.name,
            custom: a.custom || !agents[a.name],
            role: a.role,
            color: agents[a.name] || '#94a3b8',
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
  agents: Array<{ name: string; role: string; color: string; primary: boolean }>;
} {
  const msg = message.toLowerCase();

  const routes: Array<{
    kw: string[];
    category: string;
    agents: Array<{ name: string; role: string }>;
  }> = [
    { kw: ['security', 'vuln', 'cve', 'scan', 'audit', 'secret', 'leak'], category: 'security', agents: [{ name: 'Security', role: 'Run vulnerability scan' }] },
    { kw: ['monitor', 'health', 'alert', 'down', 'slow', 'memory', 'cpu', 'redis'], category: 'monitor', agents: [{ name: 'Watchdog', role: 'Run diagnostics' }, { name: 'Infra', role: 'Apply fix if needed' }] },
    { kw: ['deploy', 'ship', 'release', 'push', 'production'], category: 'deploy', agents: [{ name: 'Infra', role: 'Run deploy pipeline' }] },
    { kw: ['doc', 'readme', 'changelog', 'write', 'blog'], category: 'docs', agents: [{ name: 'Writer', role: 'Draft documentation' }] },
    { kw: ['ui', 'frontend', 'css', 'style', 'component', 'page', 'button', 'modal'], category: 'frontend', agents: [{ name: 'Frontend Dev', role: 'Build UI component' }] },
    { kw: ['test', 'coverage', 'validate', 'spec', 'regression'], category: 'testing', agents: [{ name: 'QA', role: 'Write and run tests' }] },
    { kw: ['api', 'route', 'endpoint', 'database', 'query', 'migration'], category: 'dev', agents: [{ name: 'Backend Dev', role: 'Implement backend logic' }] },
    { kw: ['fix', 'bug', 'error', 'broken', 'crash'], category: 'dev', agents: [{ name: 'Backend Dev', role: 'Trace and fix bug' }, { name: 'QA', role: 'Verify fix' }] },
  ];

  for (const r of routes) {
    if (r.kw.some(k => msg.includes(k))) {
      return {
        enhanced: false,
        category: r.category,
        summary: `Routed to ${r.agents[0]!.name} (keyword match)`,
        agents: r.agents.map((a, i) => ({ ...a, color: agents[a.name] || '#94a3b8', primary: i === 0 })),
      };
    }
  }

  return {
    enhanced: false,
    category: 'dev',
    summary: 'General task — routed to Backend Dev',
    agents: [{ name: 'Backend Dev', role: 'Analyze request', color: '#60a5fa', primary: true }],
  };
}
