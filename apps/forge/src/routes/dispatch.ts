/**
 * Natural Language Task Dispatch Routes
 * Parses natural language input and dispatches to the appropriate agent.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';

interface DispatchBody {
  input: string;
}

const AGENT_KEYWORDS: Array<{ agent: string; keywords: string[] }> = [
  { agent: 'Frontend Dev', keywords: ['frontend', 'ui', 'dashboard', 'component', 'css', 'react', 'tailwind', 'layout', 'style', 'widget'] },
  { agent: 'Backend Dev', keywords: ['api', 'endpoint', 'database', 'migration', 'query', 'backend', 'server', 'route', 'schema', 'sql'] },
  { agent: 'Infra', keywords: ['docker', 'container', 'deploy', 'nginx', 'infra', 'kubernetes', 'k8s', 'ci', 'cd', 'pipeline', 'terraform'] },
  { agent: 'Security', keywords: ['security', 'vulnerability', 'cve', 'audit', 'auth', 'permission', 'xss', 'csrf', 'injection'] },
  { agent: 'QA', keywords: ['test', 'bug', 'qa', 'validate', 'regression', 'e2e', 'unit test', 'coverage', 'fixture'] },
  { agent: 'Writer', keywords: ['doc', 'readme', 'changelog', 'runbook', 'write', 'documentation', 'comment', 'jsdoc'] },
];

const DEFAULT_AGENT = 'Backend Dev';

function classifyAgent(input: string): string {
  const lower = input.toLowerCase();
  let bestAgent = DEFAULT_AGENT;
  let bestScore = 0;

  for (const { agent, keywords } of AGENT_KEYWORDS) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
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
        const assignedTo = classifyAgent(input);
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
