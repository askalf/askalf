import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000, // 60s for API calls
    hookTimeout: 30000,
    reporters: ['verbose'],
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
});
