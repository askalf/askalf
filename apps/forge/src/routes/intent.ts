/**
 * Forge Intent Routes
 * Layer 1: Parse natural language into agent configuration
 * Uses local keyword matching (no LLM API call needed).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface TemplateRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  description: string;
  estimated_cost_per_run: string | null;
  required_tools: string[];
  agent_config: Record<string, unknown>;
}

interface IntentSubtask {
  title: string;
  description: string;
  suggestedAgentType: string;
  dependencies: string[];
  estimatedComplexity: 'low' | 'medium' | 'high';
}

interface ParsedIntent {
  category: string;
  confidence: number;
  templateId: string | null;
  templateName: string | null;
  agentConfig: {
    name: string;
    systemPrompt: string;
    model: string;
    tools: string[];
    maxIterations: number;
    maxCostPerExecution: number;
  };
  schedule: string | null;
  estimatedCost: number;
  requiresApproval: boolean;
  summary: string;
  executionMode: 'single' | 'pipeline' | 'fan-out' | 'consensus';
  subtasks: IntentSubtask[] | null;
  // Repo context (from Phase 3 simplified intent)
  repoId?: string;
  repoFullName?: string;
  repoProvider?: string;
}

// ── Local keyword-based intent classifier (no LLM API call needed) ──

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  security: ['security', 'vulnerab', 'scan', 'audit', 'cve', 'dependency', 'pentest', 'owasp', 'exploit', 'threat', 'attack', 'ssl', 'tls', 'xss', 'injection', 'auth'],
  build: ['build', 'code', 'develop', 'implement', 'fix', 'bug', 'feature', 'refactor', 'test', 'review', 'pr', 'pull request', 'deploy', 'ci', 'cd', 'typescript', 'react', 'api', 'endpoint', 'migration'],
  research: ['research', 'find', 'search', 'look up', 'investigate', 'competitor', 'market', 'compare', 'what is', 'how does', 'tell me about', 'learn', 'discover', 'explore', 'seo'],
  monitor: ['monitor', 'health', 'uptime', 'status', 'alert', 'incident', 'docker', 'container', 'log', 'cpu', 'memory', 'disk', 'performance', 'latency', 'error rate'],
  analyze: ['analyze', 'analysis', 'data', 'metric', 'report', 'insight', 'trend', 'statistics', 'profil', 'benchmark', 'cost', 'usage', 'dashboard'],
  automate: ['automate', 'schedule', 'write', 'content', 'generate', 'create', 'draft', 'blog', 'post', 'email', 'newsletter', 'summarize', 'document', 'release note'],
};

function classifyIntent(message: string): { category: string; confidence: number; complexity: 'low' | 'medium' | 'high' } {
  const lower = message.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score += 1;
    }
    scores[cat] = score;
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const best = sorted[0]!;
  const category = best[1] > 0 ? best[0] : 'research'; // default to research
  const confidence = best[1] > 0 ? Math.min(0.5 + best[1] * 0.15, 0.95) : 0.3;

  // Estimate complexity from message length and keyword density
  const wordCount = message.split(/\s+/).length;
  const complexity: 'low' | 'medium' | 'high' = wordCount > 80 ? 'high' : wordCount > 30 ? 'medium' : 'low';

  return { category, confidence, complexity };
}

export async function intentRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/intent/parse - Parse natural language into agent config
   */
  app.post(
    '/api/v1/forge/intent/parse',
    {
      schema: {
        tags: ['Intent'],
        summary: 'Parse natural language into agent configuration',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = (request.body ?? {}) as { message?: string; conversationId?: string };

      if (!body.message || body.message.trim().length === 0) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Message is required',
        });
      }

      const message = body.message.trim();

      // Load available templates for matching
      const templates = await query<TemplateRow>(
        `SELECT id, name, slug, category, description, estimated_cost_per_run, required_tools, agent_config
         FROM forge_agent_templates WHERE is_active = true ORDER BY sort_order ASC`,
      );

      // Classify intent locally (no LLM API call)
      const { category, confidence, complexity } = classifyIntent(message);

      // Match to best template by category
      const matchedTemplate = templates.find(t => t.category === category) ?? null;
      const estimatedCost = matchedTemplate
        ? parseFloat(matchedTemplate.estimated_cost_per_run ?? '0.50')
        : (complexity === 'high' ? 1.0 : complexity === 'medium' ? 0.50 : 0.30);

      const tools = matchedTemplate?.required_tools ?? ['web_search'];
      const agentConfig = matchedTemplate?.agent_config as Record<string, unknown> | undefined;

      const intent: ParsedIntent = {
        category,
        confidence,
        templateId: matchedTemplate?.id ?? null,
        templateName: matchedTemplate?.name ?? null,
        agentConfig: {
          name: (agentConfig?.['name'] as string) ?? `${category.charAt(0).toUpperCase() + category.slice(1)} Agent`,
          systemPrompt: (agentConfig?.['system_prompt'] as string) ?? `You are an expert ${category} agent. Complete the following task: ${message}`,
          model: 'claude-sonnet-4-6',
          tools,
          maxIterations: complexity === 'high' ? 20 : complexity === 'medium' ? 15 : 10,
          maxCostPerExecution: estimatedCost,
        },
        schedule: null,
        estimatedCost,
        requiresApproval: estimatedCost > 1.0,
        summary: message,
        executionMode: 'single',
        subtasks: null,
      };

      return intent;
    },
  );

  /**
   * POST /api/v1/forge/intent/dispatch-orchestration
   * Dispatches a confirmed multi-agent orchestration plan
   */
  app.post(
    '/api/v1/forge/intent/dispatch-orchestration',
    {
      schema: {
        tags: ['Intent'],
        summary: 'Dispatch a multi-agent orchestration plan',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const userId = request.userId!;
      const body = (request.body ?? {}) as {
        intent: ParsedIntent;
        conversationId?: string;
      };

      if (!body.intent || body.intent.executionMode === 'single' || !body.intent.subtasks?.length) {
        return reply.status(400).send({
          error: 'Bad Request',
          message: 'Intent must have multi-agent executionMode and subtasks',
        });
      }

      try {
        const { dispatchOrchestrationPlan } = await import('../orchestration/nl-orchestrator.js');

        // Resolve repo context if a target repo was selected
        let repoContext: { repoFullName: string; repoProvider: string; cloneUrl?: string; defaultBranch?: string } | undefined;
        if (body.intent.repoId) {
          const repoRow = await query<{ repo_full_name: string; provider: string; clone_url: string | null; default_branch: string }>(
            `SELECT repo_full_name, provider, clone_url, default_branch FROM user_repos WHERE id = $1 AND user_id = $2`,
            [body.intent.repoId, userId],
          );
          if (repoRow.length > 0) {
            const r = repoRow[0]!;
            repoContext = {
              repoFullName: r.repo_full_name,
              repoProvider: r.provider,
              cloneUrl: r.clone_url ?? undefined,
              defaultBranch: r.default_branch,
            };
          }
        }

        const result = await dispatchOrchestrationPlan({
          subtasks: body.intent.subtasks,
          ownerId: userId,
          conversationId: body.conversationId,
          originalInstruction: body.intent.summary,
          pattern: body.intent.executionMode as 'pipeline' | 'fan-out' | 'consensus',
          repoContext,
        });

        return {
          sessionId: result.sessionId,
          tasks: result.tasks,
          totalTasks: result.totalTasks,
          message: `Dispatched ${result.totalTasks} agents in ${body.intent.executionMode} mode`,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(500).send({
          error: 'Orchestration Error',
          message: `Failed to dispatch orchestration: ${msg}`,
        });
      }
    },
  );
}
