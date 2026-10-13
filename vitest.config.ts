import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    coverage: {
      // Browser and CLI code is covered by Playwright-driven tests, not line coverage.
      include: ['packages/core/src/**/*.ts', 'packages/headless/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
