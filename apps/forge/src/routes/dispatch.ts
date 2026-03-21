/**
 * Natural Language Task Dispatch Routes
 * Parses natural language input and dispatches to the best-matching agent.
 * Dynamic — queries actual agents from the database instead of hardcoded names.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface DispatchBody {
  input: string;
}

interface AgentCandidate {
  name: string;
  type: string | null;
  description: string | null;
  system_prompt: string | null;
}

/**
 * Dynamically classify which agent should handle a task
 * by scoring each active agent against the input text.
 */
async function classifyAgent(input: string): Promise<string> {
  const agents = await query<AgentCandidate>(
    `SELECT name, type, description, system_prompt
     FROM forge_agents
     WHERE status = 'active'
       AND (is_decommissioned IS NULL OR is_decommissioned = false)
       AND (is_internal IS NULL OR is_internal = false)
     ORDER BY tasks_completed DESC NULLS LAST`,
  );

  if (agents.length === 0) return 'Alf';

  const lower = input.toLowerCase();
  let bestAgent = agents[0]!.name;
  let bestScore = 0;

  for (const agent of agents) {
    let score = 0;

    // Score by agent name match
    if (lower.includes(agent.name.toLowerCase())) score += 5;

    // Score by type keywords
    const typeKeywords: Record<string, string[]> = {
      research: ['research', 'find', 'search', 'look up', 'investigate', 'competitor', 'market', 'compare', 'explore', 'seo'],
      security: ['security', 'vulnerability', 'cve', 'audit', 'auth', 'permission', 'xss', 'csrf', 'injection', 'scan'],
      dev: ['code', 'build', 'develop', 'implement', 'fix', 'bug', 'api', 'endpoint', 'database', 'migration', 'test'],
      content: ['write', 'doc', 'readme', 'blog', 'content', 'report', 'draft', 'release notes', 'changelog'],
      monitor: ['monitor', 'health', 'alert', 'incident', 'performance', 'uptime', 'status', 'docker', 'container'],
      custom: [],
    };

    const agentType = agent.type || 'custom';
    const keywords = typeKeywords[agentType] ?? [];
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }

    // Score by description match
    if (agent.description) {
      const descWords = agent.description.toLowerCase().split(/\s+/);
      const inputWords = new Set(lower.split(/\s+/));
      for (const word of descWords) {
        if (word.length > 3 && inputWords.has(word)) score += 0.5;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent.name;
    }
  }

  return bestAgent;
}

export async function dispatchRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/forge/dispatch — dispatch a task from natural language
   */
  app.post(
    '/api/v1/forge/dispatch',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = request.body as DispatchBody;

        if (!body.input || typeof body.input !== 'string' || body.input.trim().length === 0) {
          return reply.status(400).send({ error: 'Missing or empty "input" field' });
        }

        const input = body.input.trim();
        const assignedTo = await classifyAgent(input);
        const title = input.length > 100 ? input.substring(0, 100) : input;
        const ticketId = ulid();

        await query(
          `INSERT INTO agent_tickets (id, title, description, status, priority, assigned_to, created_by, is_agent_ticket, source, created_at, updated_at)
           VALUES ($1, $2, $3, 'open', 'medium', $4, 'dashboard', true, 'nl_dispatch', NOW(), NOW())`,
          [ticketId, title, input, assignedTo],
        );

        return reply.status(201).send({
          ticketId,
          assignedTo,
          title,
        });
      } catch (err) {
        request.log.error(err, 'Failed to dispatch task');
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}
