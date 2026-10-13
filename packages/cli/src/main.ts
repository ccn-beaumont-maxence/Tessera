import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { tess } from '@tessera/compiler/vite';
import { type Game, World } from '@tessera/core';
import { dump, runFrames } from '@tessera/headless';
import { sceneGame } from '@tessera/scene';
import { chromium } from 'playwright';
import { createServer, type ViteDevServer } from 'vite';
import { startVitest } from 'vitest/node';
import { buildGame } from './build';

const USAGE = `usage:
  tess run <entry> [--frames N] [--seed S] [--dump] [--screenshot out.png]
  tess dev <entry|dir> [--port P]
  tess build <entry> [--out dist]
  tess test [filters...]`;

/** Imports a module inside the CLI's module graph, so games share engine module instances. */
export type Importer = (path: string) => Promise<Record<string, unknown>>;
let importer: Importer = (path) => import(/* @vite-ignore */ path);

export async function main(argv: string[], load?: Importer): Promise<number> {
  if (load) importer = load;
  const [command, ...rest] = argv;
  try {
    if (command === 'run') return await run(rest);
    if (command === 'dev') return await dev(rest);
    if (command === 'build') return await buildCommand(rest);
    if (command === 'test') return await test(rest);
    console.error(USAGE);
    return command === undefined || command === '--help' ? 0 : 1;
  } catch (err) {
    console.error(`tess: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function run(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      frames: { type: 'string', default: '0' },
      seed: { type: 'string', default: '1' },
      dump: { type: 'boolean', default: false },
      screenshot: { type: 'string' },
    },
  });
  const entry = positionals[0];
  if (!entry) throw new Error(`missing <entry>\n${USAGE}`);
  const frames = toInt(values.frames, 'frames');
  const seed = toInt(values.seed, 'seed');
  const path = resolve(entry);

  if (values.screenshot) {
    const out = resolve(values.screenshot);
    await screenshot(path, frames, seed, out);
    console.log(`screenshot: ${out}`);
  }
  if (values.dump || !values.screenshot) {
    const world = new World({ seed });
    await (await loadGame(path)).setup(world);
    runFrames(world, frames);
    console.log(values.dump ? dump(world) : `ran ${frames} frames`);
  }
  return 0;
}

function toInt(v: string, name: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0)
    throw new Error(`--${name} must be a non-negative integer, got "${v}"`);
  return n;
}

const isScene = (path: string) => /\.ya?ml$/.test(path);

/** Loads a game module (`export default { dimension, setup }`) or a YAML scene. */
export async function loadGame(path: string): Promise<Game> {
  if (!existsSync(path)) throw new Error(`${path}: file not found`);
  if (isScene(path)) {
    return sceneGame(path, {
      read: async (p) => readFileSync(p, 'utf8'),
      load: importer,
      url: (p) => relative(process.cwd(), p),
    });
  }
  const game = (await importer(path)).default as Partial<Game> | undefined;
  if (
    !game ||
    typeof game.setup !== 'function' ||
    (game.dimension !== '2d' && game.dimension !== '3d')
  ) {
    throw new Error(`${path}: must \`export default { dimension: '2d' | '3d', setup(world) {} }\``);
  }
  return game as Game;
}

const PAGE = (
  render: string,
  scene: string,
) => `<!doctype html><html><head><meta charset="utf-8"><title>Tessera</title></head>
<body style="margin:0;overflow:hidden;background:#1b1d26">
<canvas id="c" style="width:100vw;height:100vh;display:block"></canvas>
<script type="module">
const q = new URLSearchParams(location.search);
try {
  const { start } = await import('/@fs${render}');
  const entry = q.get('entry');
  const yaml = /.ya?ml$/.test(entry);
  const scene = yaml ? await import('/@fs${scene}') : null;
  const game = yaml ? await scene.sceneGame(entry, scene.browserIO) : (await import('/@fs' + entry)).default;
  const frames = q.has('frames') ? Number(q.get('frames')) : undefined;
  window.tess = await start(game, { canvas: document.getElementById('c'), frames, seed: Number(q.get('seed') ?? 1) });
  if (yaml && frames === undefined) scene.watch(window.tess.world, entry);
  await window.tess.ready;
  window.__tess = 'done';
} catch (e) { window.__tess = String(e && e.stack || e); console.error(e); }
</script></body></html>`;

/** Vite dev server whose `/__tess?entry=<abs path>[&frames=N][&seed=S]` page runs a game. */
export async function serve(root: string, port = 0, index?: string): Promise<ViteDevServer> {
  const require = createRequire(import.meta.url);
  const html = PAGE(require.resolve('@tessera/render'), require.resolve('@tessera/scene'));
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    root,
    server: { port, fs: { strict: false } },
    plugins: [
      tess(),
      {
        name: 'tess-page',
        // YAML is fetched, not imported: tell the page instead of letting Vite reload it.
        handleHotUpdate({ file, server: s }) {
          if (!isScene(file)) return;
          s.ws.send({ type: 'custom', event: 'tess:yaml', data: { file } });
          return [];
        },
        configureServer(s) {
          s.middlewares.use('/__tess', (_req, res) => {
            res.setHeader('content-type', 'text/html');
            res.end(html);
          });
          if (index) {
            s.middlewares.use((req, res, next) => {
              if (req.url !== '/' && req.url !== '/index.html') return next();
              res.setHeader('content-type', 'text/html');
              res.end(index);
            });
          }
        },
      },
    ],
  });
  await server.listen();
  return server;
}

export const pageUrl = (server: ViteDevServer, entry: string, params = '') =>
  new URL(
    `__tess?entry=${encodeURIComponent(entry)}${params}`,
    server.resolvedUrls?.local[0] ?? 'http://localhost:5173/',
  ).href;

/** Steps `frames` in headless Chromium and saves a PNG. */
export async function screenshot(
  path: string,
  frames: number,
  seed: number,
  out: string,
): Promise<void> {
  const server = await serve(dirname(path));
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(pageUrl(server, path, `&frames=${frames}&seed=${seed}`));
    const status = await page
      .waitForFunction(() => (globalThis as { __tess?: string }).__tess, null, { timeout: 60_000 })
      .then((h) => h.jsonValue());
    if (status !== 'done') throw new Error(`game failed in browser: ${status}`);
    if (errors.length > 0) console.error(`browser errors:\n${errors.join('\n')}`);
    writeFileSync(out, await page.screenshot());
  } finally {
    await browser.close();
    await server.close();
  }
}

export const launch = (headless = true) =>
  chromium.launch({
    headless,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

const entryOf = (dir: string) =>
  ['scene.yaml', 'main.ts'].map((f) => join(dir, f)).find((f) => existsSync(f));

/** `tess dev <entry|dir>`: serves one game, or an index of `<dir>/<game>/{scene.yaml,main.ts}`. */
async function dev(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { port: { type: 'string', default: '5173' } },
  });
  const target = resolve(positionals[0] ?? '.');
  const port = toInt(values.port, 'port');
  if (!statSync(target).isDirectory()) {
    console.log(`tess dev: ${pageUrl(await serve(dirname(target), port), target)}`);
  } else {
    const links = readdirSync(target)
      .map((d) => [d, entryOf(join(target, d))] as const)
      .filter(([, entry]) => entry)
      .map(
        ([d, entry]) =>
          `<li><a href="/__tess?entry=${encodeURIComponent(entry ?? '')}">${d}</a></li>`,
      )
      .join('');
    const index = `<!doctype html><meta charset="utf-8"><title>Tessera</title><ul>${links}</ul>`;
    const server = await serve(target, port, index);
    console.log(`tess dev: ${server.resolvedUrls?.local[0]}`);
  }
  await new Promise(() => {});
  return 0;
}

async function buildCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { out: { type: 'string', default: 'dist' } },
  });
  const entry = positionals[0];
  if (!entry) throw new Error(`missing <entry>\n${USAGE}`);
  await buildGame(entry, values.out);
  console.log(`built ${resolve(values.out)}`);
  return 0;
}

/** Runs Vitest once; .tess modules compile unless the project's own config already does it. */
async function test(filters: string[]): Promise<number> {
  const own = ['vitest.config.ts', 'vitest.config.js', 'vite.config.ts', 'vite.config.js'].some(
    (f) => existsSync(f),
  );
  const vitest = await startVitest(
    'test',
    filters,
    { run: true, ...(own ? {} : { config: false }) },
    own ? {} : { plugins: [tess()] },
  );
  await vitest.close();
  return process.exitCode === undefined || process.exitCode === 0 ? 0 : 1;
}
