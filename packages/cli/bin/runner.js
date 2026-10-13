// Runs a TypeScript entry through one Vite module runner with the .tess plugin. Everything it
// imports (engine, scenes, scripts) shares one module graph, so component types stay identical.
import { fileURLToPath } from 'node:url';
import { createServer, createServerModuleRunner, runnerImport } from 'vite';

const pluginPath = fileURLToPath(new URL('../../compiler/src/vite.ts', import.meta.url));

/** Imports `entry` (absolute path) and calls `fn(module, importer)`; returns its result. */
export async function runTs(entry, fn) {
  const { module: plugin } = await runnerImport(pluginPath, {
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
  try {
    return await fn(await runner.import(entry), (path) => runner.import(path));
  } finally {
    await runner.close();
    await server.close();
  }
}
