/**
 * Forge Intent Routes
 * Layer 1: Parse natural language into agent configuration via LLM
 * Falls back to local keyword classifier if API is unavailable.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { query } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { buildIntentSystemPrompt, getPlatformContext, buildSessionContext } from '../runtime/platform-context.js';

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
  repoId?: string;
  repoFullName?: string;
  repoProvider?: string;
  projectPath?: string;
  projectName?: string;
}

const INTENT_SYSTEM_PROMPT = `You are the intent parser for AskAlf (askalf.org) — a self-hosted AI agent orchestration platform. Your job is to parse natural language requests into structured agent configurations.

The platform runs on: PostgreSQL 17 + pgvector, Redis, Node.js 22, Fastify v5, Docker Compose. It has 11 AI agents (5 internal, 6 user-facing), 28 skills, 24 MCP tools, and supports channel integrations (Slack, Discord, Telegram, WhatsApp) and git integrations (GitHub, GitLab, Bitbucket).

Given a user request, determine:

1. category: One of: research, monitor, build, analyze, automate, security, dev
2. What the user wants an agent to do
3. Whether this is a one-time task or recurring
4. Estimated complexity (low/medium/high)
5. executionMode: Determine if this needs multiple agents working together:
   - "single": One agent can handle this alone (most requests — use this by default)
   - "pipeline": Sequential steps where output feeds into the next (e.g. "research then write a report")
   - "fan-out": Multiple independent parallel tasks that converge (e.g. "analyze security, performance, and code quality")
   - "consensus": Multiple agents tackle the same problem from different angles
   ONLY use multi-agent modes when genuinely needed. Simple research, scans, monitoring, code review = "single".
6. If executionMode is NOT "single", provide subtasks (2-6 items). Each subtask needs:
   - title, description, suggestedAgentType (dev|research|security|content|monitor|custom), dependencies (array), estimatedComplexity

## Categories and their typical tools:
- research: web_search, web_browse, memory_store, memory_search — topics, competitors, markets, SEO
- security: security_scan, code_analysis, finding_ops — vulnerability scanning, dependency auditing, OWASP checks
- build: code_analysis, ticket_ops, deploy_ops — code review, testing, CI/CD, deployments
- dev: code_analysis, web_browse, finding_ops, memory_store, db_query — PR review, migrations, repo analysis, full-stack development
- automate: web_search, memory_store, finding_ops, team_coordinate — content creation, channel management, orchestration, broadcasting
- monitor: docker_api, deploy_ops, finding_ops, forge_cost, forge_fleet_intel — system health, incident response, cost tracking
- analyze: db_query, web_search, memory_store, code_analysis, forge_knowledge_graph — data analysis, performance profiling, knowledge building

## Full MCP tool catalog (24 tools):
Workflow: ticket_ops, finding_ops, intervention_ops, agent_call, proposal_ops
Data: db_query, substrate_db_query, memory_search, memory_store
Infrastructure: docker_api, deploy_ops, security_scan, code_analysis
Agent: web_search, web_browse, team_coordinate
Forge: forge_checkpoints, forge_capabilities, forge_knowledge_graph, forge_goals, forge_fleet_intel, forge_memory, forge_cost, forge_coordination

## Core Agent Fleet:
Core agents: Backend Dev, Frontend Dev, QA, Infra, Security, Watchdog, Writer
These handle platform development, testing, infrastructure, security, and documentation.

## Custom Specialist Agents:
For tasks outside the core agents' domains, create a CUSTOM specialist agent. Use a descriptive agentName like "O365 Migration Engineer", "Data Pipeline Architect", "HIPAA Compliance Auditor", "Terraform Specialist", etc. Custom agents are spawned on demand with the right system prompt and tools for the job. PREFER custom specialists for domain-specific tasks — they're purpose-built for the job.

## Available skills (28):
Research: competitor-research, seo-analyzer
Security: security-scanner, dependency-auditor
Build: frontend-dev, backend-dev, api-tester, qa-code-review
Dev: github-pr-review, db-migration-planner, repo-analyzer
Automate: slack-digest, discord-moderator, telegram-responder, whatsapp-support, deploy-manager, fleet-orchestrator, github-issue-triage, content-writer, release-notes, multi-channel-broadcast, checkpoint-reviewer
Monitor: system-monitor, incident-responder, cost-optimizer
Analyze: data-analyst, performance-profiler, knowledge-builder

## Channel integrations:
Slack, Discord, Telegram, WhatsApp — agents can digest, moderate, respond, and broadcast across channels.

## Git integrations:
GitHub, GitLab, Bitbucket — agents can review PRs, triage issues, analyze repos, and manage deployments.

Respond in JSON format:
{
  "category": "research|monitor|build|analyze|automate|security|dev",
  "confidence": 0.0-1.0,
  "taskDescription": "What the agent should do",
  "agentName": "Short descriptive name for the agent",
  "systemPrompt": "A focused system prompt for the agent",
  "isRecurring": false,
  "schedule": null or "6h" or "24h" etc,
  "complexity": "low|medium|high",
  "executionMode": "single|pipeline|fan-out|consensus",
  "subtasks": null or [{ "title": "", "description": "", "suggestedAgentType": "", "dependencies": [], "estimatedComplexity": "low|medium|high" }]
}`;

// ── Local keyword fallback classifier ──

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  security: ['security', 'vulnerab', 'scan', 'audit', 'cve', 'dependency', 'pentest', 'owasp', 'exploit', 'threat', 'attack', 'ssl', 'tls', 'xss', 'injection', 'auth'],
  dev: ['pr review', 'pull request', 'github', 'gitlab', 'bitbucket', 'migration', 'repo', 'repository', 'code review', 'diff', 'commit', 'branch', 'merge', 'git'],
  build: ['build', 'code', 'develop', 'implement', 'fix', 'bug', 'feature', 'refactor', 'test', 'review', 'deploy', 'ci', 'cd', 'typescript', 'react', 'api', 'endpoint'],
  research: ['research', 'find', 'search', 'look up', 'investigate', 'competitor', 'market', 'compare', 'what is', 'how does', 'tell me about', 'learn', 'discover', 'explore', 'seo'],
  monitor: ['monitor', 'health', 'uptime', 'status', 'alert', 'incident', 'docker', 'container', 'log', 'cpu', 'memory', 'disk', 'performance', 'latency', 'error rate'],
  analyze: ['analyze', 'analysis', 'data', 'metric', 'report', 'insight', 'trend', 'statistics', 'profil', 'benchmark', 'cost', 'usage', 'dashboard'],
  automate: ['automate', 'schedule', 'write', 'content', 'generate', 'create', 'draft', 'blog', 'post', 'email', 'newsletter', 'summarize', 'document', 'release note', 'slack', 'discord', 'telegram', 'whatsapp', 'broadcast', 'channel'],
};

function classifyIntentLocal(message: string): { category: string; confidence: number; complexity: 'low' | 'medium' | 'high' } {
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
  const category = best[1] > 0 ? best[0] : 'research';
  const confidence = best[1] > 0 ? Math.min(0.5 + best[1] * 0.15, 0.95) : 0.3;

  const wordCount = message.split(/\s+/).length;
  const complexity: 'low' | 'medium' | 'high' = wordCount > 80 ? 'high' : wordCount > 30 ? 'medium' : 'low';

  return { category, confidence, complexity };
}

function buildFallbackIntent(message: string, templates: TemplateRow[]): ParsedIntent {
  const { category, confidence, complexity } = classifyIntentLocal(message);
  const matchedTemplate = templates.find(t => t.category === category) ?? null;
  const estimatedCost = matchedTemplate
    ? parseFloat(matchedTemplate.estimated_cost_per_run ?? '0.50')
    : (complexity === 'high' ? 1.0 : complexity === 'medium' ? 0.50 : 0.30);
  const tools = matchedTemplate?.required_tools ?? ['web_search'];
  const agentConfig = matchedTemplate?.agent_config as Record<string, unknown> | undefined;

  return {
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

      // Try LLM-based parsing first, fall back to keyword classifier
      const apiKey = process.env['ANTHROPIC_INTENT_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY_FALLBACK'];
      if (!apiKey) {
        // No API key available — use local fallback
        return buildFallbackIntent(message, templates);
      }

      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        // Build system prompt dynamically from DB state (agents, skills, tools)
        let systemPrompt: string;
        try {
          systemPrompt = await buildIntentSystemPrompt();
        } catch {
          systemPrompt = INTENT_SYSTEM_PROMPT; // Fallback to static prompt
        }

        const templateContext = templates.map(t =>
          `- ${t.name} (${t.category}): ${t.description} [tools: ${t.required_tools.join(', ')}]`
        ).join('\n');

        const userContent = `Available templates:\n${templateContext}\n\nUser request: "${message}"`;

        // Try up to 2 times (initial + 1 retry)
        let responseText = '';
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const response = await client.messages.create({
              model: 'claude-haiku-4-5-20251001',
              max_tokens: 1024,
              system: systemPrompt,
              messages: [{ role: 'user', content: userContent }],
            });

            responseText = response.content
              .filter((block) => block.type === 'text')
              .map(block => (block as { type: 'text'; text: string }).text)
              .join('');
            break;
          } catch (apiErr) {
            if (attempt === 1) throw apiErr;
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        // Parse the JSON response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          // LLM returned non-JSON — fall back to keyword classifier
          app.log.warn('Intent LLM returned non-JSON, falling back to keyword classifier');
          return buildFallbackIntent(message, templates);
        }

        const parsed = JSON.parse(jsonMatch[0]) as {
          category: string;
          confidence: number;
          taskDescription: string;
          agentName: string;
          systemPrompt: string;
          isRecurring: boolean;
          schedule: string | null;
          complexity: string;
          executionMode?: 'single' | 'pipeline' | 'fan-out' | 'consensus';
          subtasks?: IntentSubtask[];
        };

        // Match to best template
        const matchedTemplate = templates.find(t => t.category === parsed.category) ?? null;
        const estimatedCost = matchedTemplate
          ? parseFloat(matchedTemplate.estimated_cost_per_run ?? '0.50')
          : (parsed.complexity === 'high' ? 1.0 : parsed.complexity === 'medium' ? 0.50 : 0.30);

        const tools = matchedTemplate?.required_tools ?? ['web_search'];

        // Determine execution mode and subtasks
        const executionMode = parsed.executionMode ?? 'single';
        const subtasks = executionMode !== 'single' && parsed.subtasks?.length
          ? parsed.subtasks
          : null;

        // Recalculate cost for multi-agent
        const totalEstimatedCost = subtasks
          ? subtasks.reduce((sum, st) => {
              const taskCost = st.estimatedComplexity === 'high' ? 1.0
                : st.estimatedComplexity === 'medium' ? 0.50 : 0.30;
              return sum + taskCost;
            }, 0)
          : estimatedCost;

        const intent: ParsedIntent = {
          category: parsed.category,
          confidence: parsed.confidence,
          templateId: matchedTemplate?.id ?? null,
          templateName: matchedTemplate?.name ?? null,
          agentConfig: {
            name: parsed.agentName,
            systemPrompt: parsed.systemPrompt,
            model: 'claude-sonnet-4-6',
            tools,
            maxIterations: parsed.complexity === 'high' ? 20 : parsed.complexity === 'medium' ? 15 : 10,
            maxCostPerExecution: totalEstimatedCost,
          },
          schedule: parsed.schedule,
          estimatedCost: totalEstimatedCost,
          requiresApproval: totalEstimatedCost > 1.0 || parsed.isRecurring || executionMode !== 'single',
          summary: parsed.taskDescription,
          executionMode,
          subtasks,
        };

        return intent;
      } catch (err) {
        // LLM failed — fall back to keyword classifier
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        app.log.warn(`Intent LLM failed (${errMsg}), falling back to keyword classifier`);
        return buildFallbackIntent(message, templates);
      }
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

        // Resolve workspace project context if selected
        const projectContext = body.intent.projectPath
          ? { projectPath: body.intent.projectPath, projectName: body.intent.projectName }
          : undefined;

        const result = await dispatchOrchestrationPlan({
          subtasks: body.intent.subtasks,
          ownerId: userId,
          conversationId: body.conversationId,
          originalInstruction: body.intent.summary,
          pattern: body.intent.executionMode as 'pipeline' | 'fan-out' | 'consensus',
          repoContext,
          projectContext,
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

  /**
   * GET /api/v1/forge/intent/platform-context
   * Returns live platform context (agents, skills, tools, integrations).
   * Used by dashboard sessions to generate dynamic instruction files.
   */
  app.get(
    '/api/v1/forge/intent/platform-context',
    {
      schema: {
        tags: ['Intent'],
        summary: 'Get live platform context for session injection',
      },
      preHandler: [authMiddleware],
    },
    async (_request: FastifyRequest, _reply: FastifyReply) => {
      return getPlatformContext();
    },
  );

  /**
   * GET /api/v1/forge/intent/session-context
   * Returns a rendered markdown context document for embedding in CLI sessions.
   */
  app.get(
    '/api/v1/forge/intent/session-context',
    {
      schema: {
        tags: ['Intent'],
        summary: 'Get rendered session context markdown',
      },
      preHandler: [authMiddleware],
    },
    async (request: FastifyRequest, _reply: FastifyReply) => {
      const qs = request.query as { type?: string; projectName?: string; projectDescription?: string };
      const sessionType = qs.type === 'codex' ? 'codex' as const : 'claude-code' as const;
      const markdown = await buildSessionContext({
        sessionType,
        projectName: qs.projectName,
        projectDescription: qs.projectDescription,
      });
      return { markdown };
    },
  );
}
