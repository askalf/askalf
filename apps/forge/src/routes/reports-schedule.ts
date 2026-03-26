/**
 * Report Schedule Routes
 * CRUD for scheduled reports (daily/weekly summaries to Discord/email)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ulid } from 'ulid';
import { query, queryOne } from '../database.js';
import { authMiddleware } from '../middleware/auth.js';
import { generateReport, dispatchReport, saveReport } from '../orchestration/report-builder.js';

export async function reportScheduleRoutes(app: FastifyInstance): Promise<void> {

  /**
   * GET /api/v1/forge/report-schedules — List all report schedules
   */
  app.get(
    '/api/v1/forge/report-schedules',
    { preHandler: [authMiddleware] },
    async () => {
      const schedules = await query(
        `SELECT * FROM report_schedules ORDER BY created_at DESC`,
      );
      return { schedules };
    },
  );

  /**
   * POST /api/v1/forge/report-schedules — Create a report schedule
   */
  app.post(
    '/api/v1/forge/report-schedules',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body as {
        name: string;
        report_type?: string;
        schedule_hour?: number;
        schedule_day_of_week?: number;
        include_sections?: string[];
        recipients?: { type: string; url?: string; address?: string }[];
      };

      if (!body.name?.trim()) {
        return reply.status(400).send({ error: 'Name is required' });
      }
      if (!body.recipients?.length) {
        return reply.status(400).send({ error: 'At least one recipient is required' });
      }

      const id = ulid();
      const schedule = await queryOne(
        `INSERT INTO report_schedules (id, name, report_type, schedule_hour, schedule_day_of_week, include_sections, recipients, is_enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
        [
          id,
          body.name.trim(),
          body.report_type || 'daily',
          body.schedule_hour ?? 9,
          body.schedule_day_of_week ?? 1,
          body.include_sections || ['metrics', 'activity', 'findings', 'cost'],
          JSON.stringify(body.recipients),
        ],
      );

      return reply.status(201).send({ schedule });
    },
  );

  /**
   * PUT /api/v1/forge/report-schedules/:id — Update a schedule
   */
  app.put(
    '/api/v1/forge/report-schedules/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        report_type?: string;
        schedule_hour?: number;
        schedule_day_of_week?: number;
        include_sections?: string[];
        recipients?: { type: string; url?: string; address?: string }[];
        is_enabled?: boolean;
      };

      const sets: string[] = [];
      const params: unknown[] = [];
      let idx = 1;

      const add = (col: string, val: unknown) => { sets.push(`${col} = $${idx}`); params.push(val); idx++; };

      if (body.name !== undefined) add('name', body.name);
      if (body.report_type !== undefined) add('report_type', body.report_type);
      if (body.schedule_hour !== undefined) add('schedule_hour', body.schedule_hour);
      if (body.schedule_day_of_week !== undefined) add('schedule_day_of_week', body.schedule_day_of_week);
      if (body.include_sections !== undefined) add('include_sections', body.include_sections);
      if (body.recipients !== undefined) add('recipients', JSON.stringify(body.recipients));
      if (body.is_enabled !== undefined) add('is_enabled', body.is_enabled);

      if (sets.length === 0) {
        return reply.status(400).send({ error: 'No fields to update' });
      }
      sets.push('updated_at = NOW()');

      const schedule = await queryOne(
        `UPDATE report_schedules SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
        [...params, id],
      );

      if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });
      return { schedule };
    },
  );

  /**
   * DELETE /api/v1/forge/report-schedules/:id
   */
  app.delete(
    '/api/v1/forge/report-schedules/:id',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const result = await queryOne(
        'DELETE FROM report_schedules WHERE id = $1 RETURNING id', [id],
      );
      if (!result) return reply.status(404).send({ error: 'Schedule not found' });
      return reply.status(204).send();
    },
  );

  /**
   * POST /api/v1/forge/report-schedules/:id/send-now — Trigger immediate report
   */
  app.post(
    '/api/v1/forge/report-schedules/:id/send-now',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const schedule = await queryOne<{
        id: string;
        report_type: string;
        include_sections: string[];
        recipients: { type: string; url?: string; address?: string }[];
      }>(
        'SELECT * FROM report_schedules WHERE id = $1', [id],
      );

      if (!schedule) return reply.status(404).send({ error: 'Schedule not found' });

      const report = await generateReport(
        schedule.report_type as 'daily' | 'weekly',
        schedule.include_sections || ['metrics', 'activity', 'findings', 'cost'],
      );
      const deliveryStatus = await dispatchReport(report, schedule.recipients || []);
      await saveReport(report, schedule.id, deliveryStatus);
      await query('UPDATE report_schedules SET last_sent_at = NOW(), updated_at = NOW() WHERE id = $1', [id]);

      return { report: { id: report.id, summary: report.summary }, deliveryStatus };
    },
  );

  /**
   * POST /api/v1/forge/reports/generate-preview — Preview a report without sending
   */
  app.post(
    '/api/v1/forge/reports/generate-preview',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const body = (request.body ?? {}) as { report_type?: string; include_sections?: string[] };
      const report = await generateReport(
        (body.report_type as 'daily' | 'weekly') || 'daily',
        body.include_sections || ['metrics', 'activity', 'findings', 'cost'],
      );
      return { report: { id: report.id, type: report.type, summary: report.summary, metrics: report.metrics } };
    },
  );

  /**
   * GET /api/v1/forge/reports/history — Past generated reports
   */
  app.get(
    '/api/v1/forge/reports/history',
    { preHandler: [authMiddleware] },
    async (request: FastifyRequest) => {
      const qs = request.query as { limit?: string; offset?: string };
      const limit = Math.min(50, Math.max(1, parseInt(qs.limit ?? '20')));
      const offset = Math.max(0, parseInt(qs.offset ?? '0'));

      const [reports, countResult] = await Promise.all([
        query(
          `SELECT id, schedule_id, report_type, period_start, period_end, summary_text, delivery_status, created_at
           FROM generated_reports ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
          [limit, offset],
        ),
        queryOne<{ count: string }>('SELECT COUNT(*)::text as count FROM generated_reports'),
      ]);

      return { reports, total: parseInt(countResult?.count || '0') };
    },
  );
}
