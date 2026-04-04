/**
 * Test setup and utilities for integration tests
 */

import { beforeAll, afterAll } from 'vitest';

export interface TestConfig {
  apiBaseUrl: string;
  adminEmail: string;
  adminPassword: string;
  dbConnectionString?: string;
}

export const testConfig: TestConfig = {
  apiBaseUrl: process.env.API_BASE_URL || 'http://localhost:3001',
  adminEmail: process.env.TEST_ADMIN_EMAIL || 'admin@askalf.org',
  adminPassword: process.env.TEST_ADMIN_PASSWORD || 'admin123',
  dbConnectionString: process.env.TEST_DATABASE_URL
};

/**
 * Global test setup
 */
export function setupIntegrationTests() {
  beforeAll(async () => {
    // Ensure API is running
    try {
      const response = await fetch(`${testConfig.apiBaseUrl}/health`);
      if (!response.ok) {
        throw new Error(`API health check failed: ${response.status}`);
      }
    } catch (error) {
      throw new Error(`Cannot connect to API at ${testConfig.apiBaseUrl}: ${error}`);
    }
  });

  afterAll(async () => {
    // Cleanup after tests if needed
  });
}

/**
 * Wait for a condition to be met with timeout
 */
export async function waitForCondition(
  condition: () => Promise<boolean>,
  timeoutMs = 30000,
  intervalMs = 1000
): Promise<boolean> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeoutMs) {
    try {
      if (await condition()) {
        return true;
      }
    } catch (error) {
      // Continue waiting
    }
    
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  return false;
}

/**
 * Generate test data for backup jobs
 */
export function generateTestBackupJob(overrides: Partial<any> = {}) {
  return {
    id: `test-job-${Date.now()}`,
    type: 'full',
    status: 'pending',
    createdAt: new Date().toISOString(),
    ...overrides
  };
}
