import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { launch, main, pageUrl, serve } from './main';

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
      await page.waitForTimeout(500);
      const frame = await page.evaluate(
        () => (globalThis as unknown as { tess: { world: { frame: number } } }).tess.world.frame,
      );
      expect(frame).toBeGreaterThan(10);
    } finally {
      await browser.close();
      await server.close();
    }
  });
});
