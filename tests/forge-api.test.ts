/**
 * Forge API Integration Tests
 *
 * Tests the forge service HTTP API endpoints.
 * Requires forge to be running on FORGE_URL (default http://localhost:3005).
 */

import { describe, it, expect } from 'vitest';

const FORGE_URL = process.env.FORGE_URL ?? 'http://forge:3005';

async function get(path: string) {
  const res = await fetch(`${FORGE_URL}${path}`);
  return { status: res.status, body: await res.json() };
}

// ── Health ──────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns service health status', async () => {
    const { status, body } = await get('/health');
    expect(status).toBe(200);
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('service', 'forge');
    expect(body).toHaveProperty('version');
    expect(body).toHaveProperty('timestamp');
    expect(body.checks).toHaveProperty('database');
    expect(body.checks).toHaveProperty('redis');
  });

  it('reports database as healthy', async () => {
    const { body } = await get('/health');
    expect(body.checks.database).toBe(true);
  });
});

// ── Unauthenticated access ─────────────────────────────────

describe('Auth guard', () => {
  it('rejects unauthenticated requests to /api/v1/forge/agents', async () => {
    const { status } = await get('/api/v1/forge/agents');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated requests to /api/v1/admin/agents', async () => {
    const { status } = await get('/api/v1/admin/agents');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });

  it('rejects unauthenticated requests to /api/v1/forge/executions', async () => {
    const { status } = await get('/api/v1/forge/executions?agentId=test');
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(500);
  });
});

// ── 404 handling ────────────────────────────────────────────

describe('Unknown routes', () => {
  it('returns 404 for non-existent paths', async () => {
    const res = await fetch(`${FORGE_URL}/api/v1/does-not-exist`);
    expect(res.status).toBe(404);
  });
});
