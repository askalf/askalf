/**
 * Integration Test Suite for Backup API Endpoints
 */

import { describe, test, expect } from '@jest/globals';

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-token';

async function apiCall(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  token?: string
): Promise<{ status: number; data: unknown }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Cookie'] = `substrate_session=${token}`;
  }

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

describe('Backup API Integration Tests', () => {
  describe('Authentication', () => {
    test('Requires authentication', async () => {
      const { status } = await apiCall('GET', '/api/admin/backups');
      expect(status).toBe(401);
    });
  });

  describe('List Backups', () => {
    test('Returns backup list', async () => {
      const { status, data } = await apiCall('GET', '/api/admin/backups', undefined, ADMIN_TOKEN);
      expect(status).toBe(200);
      expect(data).toHaveProperty('backups');
      expect(Array.isArray(data.backups)).toBe(true);
    });
  });

  describe('Backup Stats', () => {
    test('Returns statistics', async () => {
      const { status, data } = await apiCall('GET', '/api/admin/backups/stats', undefined, ADMIN_TOKEN);
      expect(status).toBe(200);
      expect(data).toHaveProperty('stats');
    });
  });

  describe('Backup Config', () => {
    test('Returns configuration', async () => {
      const { status, data } = await apiCall('GET', '/api/admin/backups/config', undefined, ADMIN_TOKEN);
      expect(status).toBe(200);
      expect(data).toHaveProperty('config');
    });
  });

  describe('Trigger Backup', () => {
    test('Initiates backup', async () => {
      const { status, data } = await apiCall(
        'POST',
        '/api/admin/backups/trigger',
        { databases: ['main'] },
        ADMIN_TOKEN
      );
      expect(status).toBe(202);
      expect(data).toHaveProperty('jobId');
    });
  });

  describe('Error Handling', () => {
    test('Invalid ID returns 404', async () => {
      const { status } = await apiCall(
        'GET',
        '/api/admin/backups/invalid-id',
        undefined,
        ADMIN_TOKEN
      );
      expect(status).toBe(404);
    });
  });
});
