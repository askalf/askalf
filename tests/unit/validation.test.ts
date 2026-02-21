import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../apps/forge/src/middleware/validation.js';

function mockRequest(data: { body?: unknown; params?: unknown; query?: unknown }) {
  return {
    body: data.body,
    params: data.params ?? {},
    query: data.query ?? {},
  } as any;
}

function mockReply() {
  const reply: any = {
    statusCode: 200,
    payload: null,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    send(payload: unknown) {
      reply.payload = payload;
      return reply;
    },
  };
  return reply;
}

describe('validateBody', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('passes valid body and replaces with parsed data', async () => {
    const request = mockRequest({ body: { name: 'Alice', age: 30 } });
    const reply = mockReply();

    await validateBody(schema)(request, reply);

    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeNull();
    expect(request.body).toEqual({ name: 'Alice', age: 30 });
  });

  it('rejects invalid body with 400 and error details', async () => {
    const request = mockRequest({ body: { name: 123 } });
    const reply = mockReply();

    await validateBody(schema)(request, reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.payload.error).toBe('Validation Error');
    expect(reply.payload.details.length).toBeGreaterThan(0);
  });

  it('strips unknown fields via Zod strict mode', async () => {
    const strictSchema = z.object({ name: z.string() }).strict();
    const request = mockRequest({ body: { name: 'Alice', extra: true } });
    const reply = mockReply();

    await validateBody(strictSchema)(request, reply);

    expect(reply.statusCode).toBe(400);
  });
});

describe('validateParams', () => {
  const schema = z.object({ id: z.string().uuid() });

  it('passes valid params', async () => {
    const request = mockRequest({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } });
    const reply = mockReply();

    await validateParams(schema)(request, reply);

    expect(reply.statusCode).toBe(200);
    expect(reply.payload).toBeNull();
  });

  it('rejects invalid params with 400', async () => {
    const request = mockRequest({ params: { id: 'not-a-uuid' } });
    const reply = mockReply();

    await validateParams(schema)(request, reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.payload.message).toBe('Invalid request parameters');
  });
});

describe('validateQuery', () => {
  const schema = z.object({ page: z.coerce.number().min(1) });

  it('passes valid query', async () => {
    const request = mockRequest({ query: { page: '3' } });
    const reply = mockReply();

    await validateQuery(schema)(request, reply);

    expect(reply.statusCode).toBe(200);
    expect(request.query).toEqual({ page: 3 });
  });

  it('rejects invalid query with 400', async () => {
    const request = mockRequest({ query: { page: '0' } });
    const reply = mockReply();

    await validateQuery(schema)(request, reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.payload.message).toBe('Invalid query parameters');
  });
});
