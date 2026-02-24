/**
 * Forge Intent Routes
 * Layer 1: Parse natural language into agent configuration via LLM
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
}

const INTENT_SYSTEM_PROMPT = `You are an intent parser for an AI agent platform. Given a user's natural language request, determine:

1. category: One of: research, monitor, build, analyze, automate, security
2. What the user wants an agent to do
3. Whether this is a one-time task or recurring
4. Estimated complexity (low/medium/high)
5. executionMode: Determine if this needs multiple agents working together:
   - "single": One agent can handle this alone (most requests — use this by default)
   - "pipeline": Sequential steps where output of one feeds into the next (e.g. "research then write a report")
   - "fan-out": Multiple independent parallel tasks that converge (e.g. "analyze security, performance, and code quality")
   - "consensus": Multiple agents tackle the same problem from different angles for better accuracy
   ONLY use multi-agent modes when the task genuinely requires different expertise areas or has clearly separable sub-objectives. Simple research, single scans, monitoring, code review = "single".
6. If executionMode is NOT "single", provide subtasks (2-6 items). Each subtask needs:
   - title: short name for the subtask
   - description: what the agent assigned to this subtask should do
   - suggestedAgentType: one of dev, research, security, content, monitor, custom
   - dependencies: list of other subtask titles that must complete first (empty array if none)
   - estimatedComplexity: low, medium, or high

Available template categories and their tools:
- research: web_search, web_browse, memory_store — for researching topics, competitors, markets
- security: security_scan, code_analysis, finding_ops — for security scanning and vulnerability assessment
- build: code_analysis, ticket_ops — for code review, development tasks
- automate: web_search, memory_store — for content creation, automation tasks
- monitor: docker_api, deploy_ops, finding_ops — for system monitoring and health checks
- analyze: db_query, web_search, memory_store — for data analysis and insights

Respond in JSON format:
{
  "category": "research|monitor|build|analyze|automate|security",
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

      // Dedicated key for intent parsing (isolated from CLI OAuth flow)
      const apiKey = process.env['ANTHROPIC_INTENT_API_KEY'] || process.env['ANTHROPIC_API_KEY'] || process.env['ANTHROPIC_API_KEY_FALLBACK'];
      if (!apiKey) {
        return reply.status(503).send({
          error: 'Service Unavailable',
          message: 'AI provider not configured',
        });
      }

      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const client = new Anthropic({ apiKey });

        const templateContext = templates.map(t =>
          `- ${t.name} (${t.category}): ${t.description} [tools: ${t.required_tools.join(', ')}]`
        ).join('\n');

        const response = await client.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: INTENT_SYSTEM_PROMPT,
          messages: [{
            role: 'user',
            content: `Available templates:\n${templateContext}\n\nUser request: "${message}"`,
          }],
        });

        const responseText = response.content
          .filter((block) => block.type === 'text')
          .map(block => (block as { type: 'text'; text: string }).text)
          .join('');

        // Parse the JSON response
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          return reply.status(500).send({
            error: 'Parse Error',
            message: 'Failed to parse intent from AI response',
          });
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
        const message = err instanceof Error ? err.message : 'Unknown error';
        return reply.status(500).send({
          error: 'Intent Parse Error',
          message: `Failed to parse intent: ${message}`,
        });
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

        const result = await dispatchOrchestrationPlan({
          subtasks: body.intent.subtasks,
          ownerId: userId,
          conversationId: body.conversationId,
          originalInstruction: body.intent.summary,
          pattern: body.intent.executionMode as 'pipeline' | 'fan-out' | 'consensus',
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
