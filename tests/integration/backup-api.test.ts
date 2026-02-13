/**
 * Integration Tests for Backup API Endpoints
 * Tests all backup-related API endpoints with authentication, validation, and error handling
 */

import { test, expect, describe, beforeAll, afterAll } from 'vitest';

// Test configuration
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3001';
const TEST_ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL || 'admin@askalf.org';
const TEST_ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD || 'admin123';

interface TestSession {
  sessionToken?: string;
  headers: Record<string, string>;
}

let testSession: TestSession = { headers: {} };

/**
 * Helper to make authenticated API requests
 */
async function apiRequest(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
  body?: any,
  requireAuth = true
) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...testSession.headers
  };

  if (requireAuth && testSession.sessionToken) {
    headers['Cookie'] = `substrate_session=${testSession.sessionToken}`;
  }

  const options: RequestInit = {
    method,
    headers,
    credentials: 'include'
  };

  if (body && (method === 'POST' || method === 'PUT')) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const data = await response.json();

  return {
    status: response.status,
    ok: response.ok,
    data,
    headers: response.headers
  };
}

/**
 * Authenticate as admin user
 */
async function authenticateAdmin() {
  const loginResponse = await apiRequest('/api/auth/login', 'POST', {
    email: TEST_ADMIN_EMAIL,
    password: TEST_ADMIN_PASSWORD
  }, false);

  if (!loginResponse.ok) {
    throw new Error(`Failed to authenticate: ${JSON.stringify(loginResponse.data)}`);
  }

  // Extract session token from Set-Cookie header
  const setCookieHeader = loginResponse.headers.get('set-cookie');
  if (setCookieHeader) {
    const sessionMatch = setCookieHeader.match(/substrate_session=([^;]+)/);
    if (sessionMatch) {
      testSession.sessionToken = sessionMatch[1];
    }
  }
}

describe('Backup API Integration Tests', () => {
  beforeAll(async () => {
    // Authenticate as admin before running tests
    await authenticateAdmin();
  });

  describe('Authentication & Authorization', () => {
    test('should reject unauthenticated requests', async () => {
      const response = await fetch(`${API_BASE_URL}/api/backups/jobs`);
      expect(response.status).toBe(401);
    });

    test('should reject non-admin users', async () => {
      // This would require setting up a non-admin user session
      // For now, we'll test with invalid session token
      const response = await fetch(`${API_BASE_URL}/api/backups/jobs`, {
        headers: {
          'Cookie': 'substrate_session=invalid_token'
        }
      });
      expect(response.status).toBe(401);
    });
  });

  describe('GET /api/backups/jobs', () => {
    test('should list backup jobs for authenticated admin', async () => {
      const response = await apiRequest('/api/backups/jobs');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('jobs');
      expect(Array.isArray(response.data.jobs)).toBe(true);
      expect(response.data).toHaveProperty('pagination');
    });

    test('should handle pagination parameters', async () => {
      const response = await apiRequest('/api/backups/jobs?limit=5&offset=0');
      
      expect(response.status).toBe(200);
      expect(response.data.jobs.length).toBeLessThanOrEqual(5);
    });

    test('should filter by job status', async () => {
      const response = await apiRequest('/api/backups/jobs?status=completed');
      
      expect(response.status).toBe(200);
      response.data.jobs.forEach((job: any) => {
        expect(job.status).toBe('completed');
      });
    });

    test('should filter by job type', async () => {
      const response = await apiRequest('/api/backups/jobs?type=full');
      
      expect(response.status).toBe(200);
      response.data.jobs.forEach((job: any) => {
        expect(job.type).toBe('full');
      });
    });

    test('should validate limit parameter bounds', async () => {
      const response = await apiRequest('/api/backups/jobs?limit=1001');
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });
  });

  describe('GET /api/backups/jobs/:id', () => {
    test('should get specific backup job details', async () => {
      // First get a job ID from the list
      const listResponse = await apiRequest('/api/backups/jobs?limit=1');
      
      if (listResponse.data.jobs.length > 0) {
        const jobId = listResponse.data.jobs[0].id;
        const response = await apiRequest(`/api/backups/jobs/${jobId}`);
        
        expect(response.status).toBe(200);
        expect(response.data).toHaveProperty('job');
        expect(response.data.job.id).toBe(jobId);
      }
    });

    test('should return 404 for non-existent job', async () => {
      const response = await apiRequest('/api/backups/jobs/non-existent-id');
      
      expect(response.status).toBe(404);
      expect(response.data).toHaveProperty('error');
    });

    test('should validate job ID format', async () => {
      const response = await apiRequest('/api/backups/jobs/invalid-uuid');
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });
  });

  describe('POST /api/backups/trigger', () => {
    test('should trigger full backup', async () => {
      const response = await apiRequest('/api/backups/trigger', 'POST', {
        type: 'full'
      });
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('jobId');
      expect(response.data).toHaveProperty('message');
    });

    test('should trigger incremental backup', async () => {
      const response = await apiRequest('/api/backups/trigger', 'POST', {
        type: 'incremental'
      });
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('jobId');
    });

    test('should validate backup type', async () => {
      const response = await apiRequest('/api/backups/trigger', 'POST', {
        type: 'invalid-type'
      });
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });

    test('should handle missing backup type', async () => {
      const response = await apiRequest('/api/backups/trigger', 'POST', {});
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });
  });

  describe('GET /api/backups/stats', () => {
    test('should return backup statistics', async () => {
      const response = await apiRequest('/api/backups/stats');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('stats');
      
      const stats = response.data.stats;
      expect(stats).toHaveProperty('totalBackups');
      expect(stats).toHaveProperty('successfulBackups');
      expect(stats).toHaveProperty('failedBackups');
      expect(stats).toHaveProperty('totalSizeBytes');
      expect(typeof stats.totalBackups).toBe('number');
      expect(typeof stats.successfulBackups).toBe('number');
      expect(typeof stats.failedBackups).toBe('number');
    });
  });

  describe('GET /api/backups/config', () => {
    test('should return backup configuration', async () => {
      const response = await apiRequest('/api/backups/config');
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('config');
      
      const config = response.data.config;
      expect(config).toHaveProperty('scheduleEnabled');
      expect(config).toHaveProperty('scheduleCron');
      expect(config).toHaveProperty('retentionDays');
      expect(config).toHaveProperty('compressionEnabled');
      expect(config).toHaveProperty('encryptionEnabled');
      expect(typeof config.scheduleEnabled).toBe('boolean');
      expect(typeof config.compressionEnabled).toBe('boolean');
      expect(typeof config.encryptionEnabled).toBe('boolean');
    });
  });

  describe('PUT /api/backups/config', () => {
    test('should update backup configuration', async () => {
      const newConfig = {
        scheduleEnabled: true,
        scheduleCron: '0 2 * * *',
        retentionDays: 30,
        compressionEnabled: true,
        encryptionEnabled: true,
        notifyOnFailure: true
      };

      const response = await apiRequest('/api/backups/config', 'PUT', newConfig);
      
      expect(response.status).toBe(200);
      expect(response.data).toHaveProperty('message');
      
      // Verify the configuration was updated
      const getResponse = await apiRequest('/api/backups/config');
      expect(getResponse.data.config.scheduleEnabled).toBe(newConfig.scheduleEnabled);
      expect(getResponse.data.config.retentionDays).toBe(newConfig.retentionDays);
    });

    test('should validate cron expression format', async () => {
      const response = await apiRequest('/api/backups/config', 'PUT', {
        scheduleCron: 'invalid-cron'
      });
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });

    test('should validate retention period bounds', async () => {
      const response = await apiRequest('/api/backups/config', 'PUT', {
        retentionDays: -1
      });
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });

    test('should validate email format for notifications', async () => {
      const response = await apiRequest('/api/backups/config', 'PUT', {
        notifyEmail: 'invalid-email'
      });
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });
  });

  describe('POST /api/backups/restore', () => {
    test('should validate restore request parameters', async () => {
      const response = await apiRequest('/api/backups/restore', 'POST', {});
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });

    test('should validate backup job exists for restore', async () => {
      const response = await apiRequest('/api/backups/restore', 'POST', {
        jobId: 'non-existent-job-id'
      });
      
      expect(response.status).toBe(404);
      expect(response.data).toHaveProperty('error');
    });

    // Note: We won't actually test successful restore in integration tests
    // as it could be destructive. This would be better tested in a dedicated
    // test environment with proper isolation.
  });

  describe('DELETE /api/backups/jobs/:id', () => {
    test('should validate job ID format for deletion', async () => {
      const response = await apiRequest('/api/backups/jobs/invalid-uuid', 'DELETE');
      
      expect(response.status).toBe(400);
      expect(response.data).toHaveProperty('error');
    });

    test('should return 404 for non-existent job deletion', async () => {
      const response = await apiRequest('/api/backups/jobs/550e8400-e29b-41d4-a716-446655440000', 'DELETE');
      
      expect(response.status).toBe(404);
      expect(response.data).toHaveProperty('error');
    });

    // Note: We won't test successful deletion to avoid removing actual backup data
    // This should be tested in an isolated test environment
  });

  describe('Error Handling & Edge Cases', () => {
    test('should handle backup service unavailable', async () => {
      // This test assumes the backup service might be down
      // In a real environment, you might temporarily stop the service
      // For now, we'll just ensure the API handles service errors gracefully
      
      const response = await apiRequest('/api/backups/trigger', 'POST', {
        type: 'full'
      });
      
      // Should either succeed (200) or return service unavailable error
      expect([200, 503]).toContain(response.status);
    });

    test('should handle malformed JSON in request body', async () => {
      const response = await fetch(`${API_BASE_URL}/api/backups/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `substrate_session=${testSession.sessionToken}`
        },
        body: '{invalid-json'
      });
      
      expect(response.status).toBe(400);
    });

    test('should handle large request bodies appropriately', async () => {
      const largeConfig = {
        scheduleCron: '0 2 * * *',
        notifyEmail: 'a'.repeat(1000) + '@example.com' // Very long email
      };

      const response = await apiRequest('/api/backups/config', 'PUT', largeConfig);
      
      expect([400, 413]).toContain(response.status); // Bad Request or Payload Too Large
    });
  });

  describe('Rate Limiting & Security', () => {
    test('should handle multiple rapid requests appropriately', async () => {
      // Make multiple rapid requests to test rate limiting
      const requests = Array.from({ length: 10 }, () => 
        apiRequest('/api/backups/stats')
      );
      
      const responses = await Promise.all(requests);
      
      // All should either succeed or be rate limited
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status);
      });
    });

    test('should sanitize error messages to prevent information disclosure', async () => {
      const response = await apiRequest('/api/backups/jobs/../../etc/passwd');
      
      expect(response.status).toBe(400);
      // Error message should not contain the malicious path
      expect(response.data.error).not.toContain('../../etc/passwd');
    });
  });
});
