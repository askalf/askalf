/**
 * Client Error Reporting Routes
 * Receives frontend error reports from the ErrorBoundary component.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query } from '../database.js';

interface ErrorReportBody {
  message: string;
  stack?: string;
  componentStack?: string;
  url?: string;
  userAgent?: string;
  timestamp?: string;
}

export async function errorRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/v1/errors/report - Receive client-side error reports
   * Public endpoint — called by ErrorBoundary when the SPA crashes.
   */
  app.post(
    '/api/v1/errors/report',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const body = request.body as ErrorReportBody;
        const ip = request.ip;

        await query(
          `INSERT INTO client_errors (id, message, stack, component_stack, url, user_agent, ip)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            ulid(),
            body.message ?? '(no message)',
            body.stack ?? null,
            body.componentStack ?? null,
            body.url ?? null,
            body.userAgent ?? null,
            ip,
          ],
        );

        return reply.status(201).send({ ok: true });
      } catch (err) {
        request.log.error(err, 'Failed to record client error report');
        return reply.status(500).send({ error: 'Internal Server Error' });
      }
    },
  );
}
