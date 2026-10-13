import { Transform2D, vec2, type World } from '@tessera/core';
import { dump, find, runFrames } from '@tessera/headless';
import { press, release } from '@tessera/input';
import { RigidBody } from '@tessera/physics';
import { describe, expect, it } from 'vitest';
import { loadExample } from '../load';
import { Score } from './game';

async function level(seed = 1) {
  return loadExample(import.meta.dirname, 'game.ts', seed);
}

const place = (w: World, name: string, x: number, y: number) => {
  const t = w.get(find(w, name), Transform2D);
  if (t) vec2.copy({ x, y }, t.position);
};
const pos = (w: World, name: string) =>
  w.get(find(w, name), Transform2D)?.position ?? vec2(NaN, NaN);

describe('platformer', () => {
  it('runs right and collects ground coins', async () => {
    const w = await level();
    press(w, 'move');
    runFrames(w, 50);
    expect(w.resource(Score).coins).toBe(2);
    expect(pos(w, 'Player').x).toBeGreaterThan(4);
  });

  it('jumps only when grounded', async () => {
    const w = await level();
    runFrames(w, 30); // land first: the player spawns 0.5 m above the ground
    press(w, 'jump');
    runFrames(w, 10);
    const peak = pos(w, 'Player').y;
    expect(peak).toBeGreaterThan(1.5);
    release(w, 'jump');
    runFrames(w, 1);
    press(w, 'jump');
    runFrames(w, 1);
    // A second press in the air must not reset the upward velocity to `jump` (11).
    expect(w.get(find(w, 'Player'), RigidBody)?.velocity.y).toBeLessThan(8);
  });

  it('stomps enemies from above and dies from the side', async () => {
    const w = await level();
    runFrames(w, 1);
    const slime = pos(w, 'Slime1');
    place(w, 'Player', slime.x, 3);
    runFrames(w, 40);
    expect(w.resource(Score).stomps).toBe(1);
    expect(() => find(w, 'Slime1')).toThrow();

    const slime2 = pos(w, 'Slime2');
    place(w, 'Player', slime2.x - 1.2, 0.5);
    press(w, 'move');
    runFrames(w, 30);
    expect(w.resource(Score).deaths).toBe(1);
    expect(pos(w, 'Player').x).toBeLessThan(5);
  });

  it('respawns after falling into the gap', async () => {
    const w = await level();
    place(w, 'Player', 17.5, -2);
    runFrames(w, 60);
    expect(w.resource(Score).deaths).toBe(1);
    expect(w.get(find(w, 'Player'), RigidBody)?.velocity.y).toBeLessThanOrEqual(0);
  });

  it('wins at the goal and the camera follows', async () => {
    const w = await level();
    place(w, 'Player', 35, 0.5);
    press(w, 'move');
    runFrames(w, 60);
    expect(w.resource(Score).won).toBe(true);
    expect(pos(w, 'Camera').x).toBeCloseTo(pos(w, 'Player').x, 0);
  });

  it('replays identically from the same inputs', async () => {
    const play = async () => {
      const w = await level(7);
      press(w, 'move');
      for (let i = 0; i < 6; i++) {
        press(w, 'jump');
        runFrames(w, 20);
        release(w, 'jump');
        runFrames(w, 30);
      }
      return dump(w);
    };
    expect(await play()).toBe(await play());
  });
});
