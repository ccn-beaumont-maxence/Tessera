#!/usr/bin/env node
// Runs the TypeScript CLI through one Vite module runner. Games, scenes and scripts are imported
// through the same runner, so they share engine module instances (component identity).
import { fileURLToPath } from 'node:url';
import { createServer, createServerModuleRunner, runnerImport } from 'vite';

const src = (path) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
// The .tess plugin is TypeScript too: load it once to compile .tess modules in the runner below.
const { module: plugin } = await runnerImport(src('../../compiler/src/vite.ts'), {
  configFile: false,
  logLevel: 'error',
});

const server = await createServer({
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  plugins: [plugin.tess()],
  server: { middlewareMode: true, hmr: false, ws: false },
});
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false });
const cli = await runner.import(src('main.ts'));
process.exitCode = await cli.main(process.argv.slice(2), (path) => runner.import(path));
await runner.close();
await server.close();
