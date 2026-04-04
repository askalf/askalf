/**
 * Forge Request Validation Middleware
 * Zod-based validation for body, params, and query
 */

import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Format Zod errors into a human-readable structure.
 */
function formatZodError(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue: { path: Array<string | number>; message: string }) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Returns a Fastify preHandler that validates request.body against the given Zod schema.
 * On success, replaces request.body with the parsed (and possibly transformed) value.
 */
export function validateBody<T>(
  schema: ZodSchema<T>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function bodyValidator(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const result = schema.safeParse(request.body);
    if (!result.success) {
      reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request body',
        details: formatZodError(result.error),
      });
      return;
    }
    // Replace body with parsed value
    (request as FastifyRequest & { body: T }).body = result.data;
  };
}

/**
 * Returns a Fastify preHandler that validates request.params against the given Zod schema.
 * On success, replaces request.params with the parsed value.
 */
export function validateParams<T>(
  schema: ZodSchema<T>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function paramsValidator(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const result = schema.safeParse(request.params);
    if (!result.success) {
      reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid request parameters',
        details: formatZodError(result.error),
      });
      return;
    }
    (request as FastifyRequest & { params: T }).params = result.data;
  };
}

/**
 * Returns a Fastify preHandler that validates request.query against the given Zod schema.
 * On success, replaces request.query with the parsed value.
 */
export function validateQuery<T>(
  schema: ZodSchema<T>,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async function queryValidator(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const result = schema.safeParse(request.query);
    if (!result.success) {
      reply.status(400).send({
        error: 'Validation Error',
        message: 'Invalid query parameters',
        details: formatZodError(result.error),
      });
      return;
    }
    (request as FastifyRequest & { query: T }).query = result.data;
  };
}
