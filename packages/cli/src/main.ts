import { existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { type Game, World } from '@tessera/core';
import { dump, runFrames } from '@tessera/headless';
import { chromium } from 'playwright';
import { createServer, runnerImport, type ViteDevServer } from 'vite';

const USAGE = `usage:
  tess run <entry> [--frames N] [--seed S] [--dump] [--screenshot out.png]
  tess dev <entry|dir> [--port P]`;

export async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === 'run') return await run(rest);
    if (command === 'dev') return await dev(rest);
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

export async function loadGame(path: string): Promise<Game> {
  const { module } = await runnerImport<{ default?: Partial<Game> }>(path, {
    configFile: false,
    logLevel: 'error',
  });
  const game = module.default;
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
) => `<!doctype html><html><head><meta charset="utf-8"><title>Tessera</title></head>
<body style="margin:0;overflow:hidden;background:#1b1d26">
<canvas id="c" style="width:100vw;height:100vh;display:block"></canvas>
<script type="module">
const q = new URLSearchParams(location.search);
try {
  const { start } = await import('/@fs${render}');
  const game = (await import('/@fs' + q.get('entry'))).default;
  const frames = q.has('frames') ? Number(q.get('frames')) : undefined;
  window.tess = await start(game, { canvas: document.getElementById('c'), frames, seed: Number(q.get('seed') ?? 1) });
  await window.tess.ready;
  window.__tess = 'done';
} catch (e) { window.__tess = String(e && e.stack || e); console.error(e); }
</script></body></html>`;

/** Vite dev server whose `/__tess?entry=<abs path>[&frames=N][&seed=S]` page runs a game. */
export async function serve(root: string, port = 0, index?: string): Promise<ViteDevServer> {
  const html = PAGE(createRequire(import.meta.url).resolve('@tessera/render'));
  const server = await createServer({
    configFile: false,
    logLevel: 'error',
    root,
    server: { port, fs: { strict: false } },
    plugins: [
      {
        name: 'tess-page',
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

export const launch = () =>
  chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });

/** `tess dev <entry|dir>`: serves one game, or an index of every `<dir>/<game>/main.ts`. */
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
      .filter((d) => existsSync(join(target, d, 'main.ts')))
      .map(
        (d) =>
          `<li><a href="/__tess?entry=${encodeURIComponent(join(target, d, 'main.ts'))}">${d}</a></li>`,
      )
      .join('');
    const index = `<!doctype html><meta charset="utf-8"><title>Tessera</title><ul>${links}</ul>`;
    const server = await serve(target, port, index);
    console.log(`tess dev: ${server.resolvedUrls?.local[0]}`);
  }
  await new Promise(() => {});
  return 0;
}
