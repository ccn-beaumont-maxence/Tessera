#!/usr/bin/env node
// Runs the TypeScript CLI through one Vite module runner. Games, scenes and scripts are imported
// through the same runner, so they share engine module instances (component identity).
import { fileURLToPath } from 'node:url';
import { createServer, createServerModuleRunner } from 'vite';

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
const cli = await runner.import(fileURLToPath(new URL('../src/main.ts', import.meta.url)));
process.exitCode = await cli.main(process.argv.slice(2), (path) => runner.import(path));
await runner.close();
await server.close();
