import { defineConfig } from 'vitest/config';
// Relative import so the config bundler inlines the TypeScript plugin.
import { tess } from './packages/compiler/src/vite';

export default defineConfig({
  plugins: [tess()],
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'packages/vscode-tess/*.test.ts',
      'examples/**/*.test.ts',
    ],
    coverage: {
      // Browser and CLI code is covered by Playwright-driven tests, not line coverage.
      include: ['packages/core/src/**/*.ts', 'packages/headless/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      thresholds: { lines: 90, branches: 90 },
    },
  },
});
