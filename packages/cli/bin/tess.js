#!/usr/bin/env node
// Loads the TypeScript CLI through Vite's module runner (no build step, no extra loader dependency).
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const { module } = await runnerImport(fileURLToPath(new URL('../src/main.ts', import.meta.url)), {
  configFile: false,
  logLevel: 'error',
});
process.exitCode = await module.main(process.argv.slice(2));
