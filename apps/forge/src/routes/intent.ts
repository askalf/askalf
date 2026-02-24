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
}

const INTENT_SYSTEM_PROMPT = `You are an intent parser for an AI agent platform. Given a user's natural language request, determine:

1. category: One of: research, monitor, build, analyze, automate, security
2. What the user wants an agent to do
3. Whether this is a one-time task or recurring
4. Estimated complexity (low/medium/high)

Available template categories and their tools:
- research: web_search, web_browse, memory_store — for researching topics, competitors, markets
- security: security_scan, code_analysis, finding_ops — for security scanning and vulnerability assessment
- build: code_analysis, ticket_ops, git_ops — for code review, development tasks
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
  "complexity": "low|medium|high"
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

      // Use Anthropic SDK to classify intent (cheap, fast with haiku)
      const apiKey = process.env['ANTHROPIC_API_KEY'];
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
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map(block => block.text)
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
        };

        // Match to best template
        const matchedTemplate = templates.find(t => t.category === parsed.category) ?? null;
        const estimatedCost = matchedTemplate
          ? parseFloat(matchedTemplate.estimated_cost_per_run ?? '0.50')
          : (parsed.complexity === 'high' ? 1.0 : parsed.complexity === 'medium' ? 0.50 : 0.30);

        const tools = matchedTemplate?.required_tools ?? ['web_search'];

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
            maxCostPerExecution: estimatedCost,
          },
          schedule: parsed.schedule,
          estimatedCost,
          requiresApproval: estimatedCost > 1.0 || parsed.isRecurring,
          summary: parsed.taskDescription,
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
}
