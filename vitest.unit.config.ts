import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/core/**/*.test.ts'],
    exclude: ['tests/unit/validation.test.ts'],
    testTimeout: 30000,
    hookTimeout: 15000,
    reporters: ['verbose'],
  },
});
