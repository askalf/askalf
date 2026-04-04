/**
 * CSP Violation Report Receiver
 * Accepts Content-Security-Policy violation reports from browsers.
 * No authentication required — these are sent automatically by browsers.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

interface CspViolation {
  'document-uri'?: string;
  referrer?: string;
  'violated-directive'?: string;
  'effective-directive'?: string;
  'original-policy'?: string;
  'blocked-uri'?: string;
  'status-code'?: number;
  'script-sample'?: string;
  'source-file'?: string;
  'line-number'?: number;
  'column-number'?: number;
  disposition?: string;
}

interface CspReportBody {
  'csp-report'?: CspViolation;
}

export async function cspReportRoutes(app: FastifyInstance): Promise<void> {
  // Browsers send CSP reports with Content-Type: application/csp-report (not application/json)
  app.addContentTypeParser('application/csp-report', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, {});
    }
  });

  /**
   * POST /api/v1/csp-report
   * Receives CSP violation reports from browsers (Level 2 format).
   * No auth — this endpoint is called automatically by the browser.
   */
  app.post('/api/v1/csp-report', async (request: FastifyRequest, reply: FastifyReply) => {
    const report = request.body as CspReportBody | null;
    const csp = report?.['csp-report'];

    if (csp) {
      request.log.warn(
        {
          csp_violation: {
            blocked_uri: csp['blocked-uri'],
            violated_directive: csp['violated-directive'],
            effective_directive: csp['effective-directive'],
            document_uri: csp['document-uri'],
            source_file: csp['source-file'],
            line_number: csp['line-number'],
            column_number: csp['column-number'],
            script_sample: csp['script-sample'],
            disposition: csp['disposition'],
          },
        },
        'CSP violation reported',
      );
    }

    return reply.status(204).send();
  });
}
