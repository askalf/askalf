import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // Sequential execution — integration tests depend on shared state (created agent ID)
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
