import type { World } from '@tessera/core';
import { dump, runFrames } from '@tessera/headless';
import { press, release } from '@tessera/input';
import { describe, expect, it } from 'vitest';
import { loadExample } from './load';

type Script = (w: World, frame: number) => void;

/** Same inputs on the TypeScript and Tess versions must give identical dumps every 30 frames. */
async function compare(dir: string, frames: number, script: Script, seed = 1) {
  const run = async (file: 'game.ts' | 'game.tess') => {
    const w = await loadExample(`${import.meta.dirname}/${dir}`, file, seed);
    const dumps: string[] = [];
    for (let f = 0; f < frames; f++) {
      script(w, f);
      runFrames(w, 1);
      if (f % 30 === 29) dumps.push(dump(w));
    }
    return dumps;
  };
  const ts = await run('game.ts');
  const tess = await run('game.tess');
  for (let i = 0; i < ts.length; i++) expect(tess[i], `frame ${(i + 1) * 30}`).toBe(ts[i]);
}

const hold = (w: World, key: string, on: boolean) => (on ? press(w, key) : release(w, key));

describe('Tess versions behave like the TypeScript references', () => {
  it('platformer', async () => {
    await compare('platformer', 1500, (w, f) => {
      hold(w, 'ArrowRight', f % 400 < 300);
      hold(w, 'ArrowLeft', f % 400 >= 330);
      hold(w, 'Space', f % 45 < 12);
    });
  });

  it('arena', async () => {
    for (const seed of [1, 9]) {
      await compare(
        'arena',
        1800,
        (w, f) => {
          hold(w, 'Space', f % 90 < 70);
          hold(w, 'KeyW', f % 240 < 60);
          hold(w, 'KeyD', f % 240 >= 60 && f % 240 < 120);
          hold(w, 'KeyS', f % 240 >= 120 && f % 240 < 180);
          hold(w, 'KeyA', f % 240 >= 180);
        },
        seed,
      );
    }
  });
});
