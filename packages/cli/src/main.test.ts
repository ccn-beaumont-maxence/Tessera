import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launch, loadGame, main, pageUrl, serve } from './main';

const example = (name: string) =>
  resolve(import.meta.dirname, '../../../examples', name, 'main.ts');

describe('tess run', () => {
  afterEach(() => vi.restoreAllMocks());

  it('dumps a headless run', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await main(['run', example('basic-3d'), '--frames', '30', '--dump'])).toBe(0);
    const out = String(log.mock.calls[0]?.[0]);
    expect(out.split('\n')[0]).toBe('frame 30');
    expect(out).toContain('#5 Cube Transform3D');
  });

  it('reports bad arguments in one line', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['run', example('basic-3d'), '--frames', '1.5'])).toBe(1);
    expect(err).toHaveBeenCalledWith('tess: --frames must be a non-negative integer, got "1.5"');
    expect(await main(['nope'])).toBe(1);
    expect(await main(['run', resolve(import.meta.dirname, 'index.ts')])).toBe(1);
    expect(String(err.mock.calls.at(-1)?.[0])).toContain('must `export default');
  });

  it('takes a screenshot at a given frame', { timeout: 60_000 }, async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = join(mkdtempSync(join(tmpdir(), 'tess-')), 'shot.png');
    expect(await main(['run', example('basic-2d'), '--frames', '120', '--screenshot', out])).toBe(
      0,
    );
    const png = readFileSync(out);
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    expect(png.length).toBeGreaterThan(3000);
  });
});

describe('tess dev page', () => {
  it('runs the game loop in real time', { timeout: 60_000 }, async () => {
    const entry = example('basic-3d');
    const server = await serve(resolve(entry, '..'));
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.goto(pageUrl(server, entry));
      await page.waitForFunction(() => (globalThis as { __tess?: string }).__tess === 'done');
      // Waits for frames rather than a fixed delay: CI renders slowly with a software GPU.
      await page.waitForFunction(
        () =>
          (globalThis as unknown as { tess: { world: { frame: number } } }).tess.world.frame > 10,
      );
    } finally {
      await browser.close();
      await server.close();
    }
  });
});

describe('YAML scenes', () => {
  const sceneFile = resolve(import.meta.dirname, '../../../examples/scene-2d/scene.yaml');

  it('plays headless without wiring code', async () => {
    const { World } = await import('@tessera/core');
    const { press, runFrames, find } = {
      ...(await import('@tessera/input')),
      ...(await import('@tessera/headless')),
    };
    const w = new World();
    await (await loadGame(sceneFile)).setup(w);
    press(w, 'move');
    runFrames(w, 120);
    const { Score } = await import('../../../examples/scene-2d/game');
    expect(w.resource(Score).value).toBe(2);
    expect(() => find(w, 'Player')).not.toThrow();
  });

  it('applies YAML edits without reloading the page', { timeout: 60_000 }, async () => {
    const dir = resolve(import.meta.dirname, '../.tmp/hmr');
    rmSync(dir, { recursive: true, force: true });
    cpSync(resolve(sceneFile, '..'), dir, { recursive: true });
    const file = join(dir, 'scene.yaml');
    const server = await serve(dir);
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.goto(pageUrl(server, file));
      await page.waitForFunction(() => (globalThis as { __tess?: string }).__tess === 'done');
      await page.evaluate(() => {
        (globalThis as { marker?: number }).marker = 1;
      });
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace('position: [2, 2] }', 'position: [2, 3.5] }'),
      );
      await page.waitForFunction(
        () => {
          const g = globalThis as unknown as {
            tess: {
              world: {
                entities(): Iterable<number>;
                nameOf(e: number): string;
                components(e: number): [{ name: string }, { position: { y: number } }][];
              };
            };
          };
          const w = g.tess.world;
          for (const e of w.entities()) {
            if (w.nameOf(e) !== 'Ledge') continue;
            return w
              .components(e)
              .some(([t, v]) => t.name === 'Transform2D' && v.position.y === 3.5);
          }
          return false;
        },
        null,
        { timeout: 10_000 },
      );
      expect(await page.evaluate(() => (globalThis as { marker?: number }).marker)).toBe(1);
    } finally {
      await browser.close();
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('reference games in the browser', () => {
  it('responds to keyboard input', { timeout: 60_000 }, async () => {
    const entry = resolve(import.meta.dirname, '../../../examples/platformer/scene.yaml');
    const server = await serve(resolve(entry, '..'));
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.goto(pageUrl(server, entry));
      await page.waitForFunction(() => (globalThis as { __tess?: string }).__tess === 'done');
      const playerX = () =>
        page.evaluate(() => {
          type W = {
            entities(): Iterable<number>;
            nameOf(e: number): string;
            components(e: number): [{ name: string }, { position: { x: number } }][];
          };
          const w = (globalThis as unknown as { tess: { world: W } }).tess.world;
          for (const e of w.entities()) {
            if (w.nameOf(e) !== 'Player') continue;
            const t = w.components(e).find(([c]) => c.name === 'Transform2D');
            return t?.[1].position.x ?? NaN;
          }
          return NaN;
        });
      const before = await playerX();
      await page.keyboard.down('ArrowRight');
      await page.waitForTimeout(700);
      await page.keyboard.up('ArrowRight');
      expect((await playerX()) - before).toBeGreaterThan(1);
    } finally {
      await browser.close();
      await server.close();
    }
  });
});

describe('tess build and tess test', () => {
  it('builds a static site that runs the game', { timeout: 120_000 }, async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const out = mkdtempSync(join(tmpdir(), 'tess-dist-'));
    const scene = resolve(import.meta.dirname, '../../../examples/arena/scene.yaml');
    expect(await main(['build', scene, '--out', out])).toBe(0);
    const { preview } = await import('vite');
    const server = await preview({
      configFile: false,
      logLevel: 'error',
      root: out,
      build: { outDir: out },
      preview: { port: 0 },
    });
    const browser = await launch();
    try {
      const page = await browser.newPage();
      await page.goto(server.resolvedUrls?.local[0] ?? '');
      await page.waitForFunction(
        () => (globalThis as { __tess?: string }).__tess === 'done',
        null,
        { timeout: 30_000 },
      );
      await page.waitForTimeout(500);
      const frame = await page.evaluate(
        () => (globalThis as unknown as { tess: { world: { frame: number } } }).tess.world.frame,
      );
      expect(frame).toBeGreaterThan(5);
    } finally {
      await browser.close();
      await server.close();
    }
  });

  it('runs project tests with .tess support', { timeout: 120_000 }, async () => {
    const { spawnSync } = await import('node:child_process');
    const bin = resolve(import.meta.dirname, '../bin/tess.js');
    const root = resolve(import.meta.dirname, '../../..');
    const res = spawnSync('node', [bin, 'test', 'examples/parity'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(res.stdout + res.stderr).toContain('2 passed');
    expect(res.status).toBe(0);
  });
});
