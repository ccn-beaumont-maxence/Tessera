import type { Entity, World } from '@tessera/core';
import { find, runFrames } from '@tessera/headless';
import { press, release } from '@tessera/input';
import { spawnPrefab } from '@tessera/scene';
import { describe, expect, it } from 'vitest';
import { loadExample } from '../examples/load';

// Driven by run.ts: BENCH_TASK, BENCH_DIR (a copy of the example), BENCH_SCRIPT (game.ts | game.tess).
const { BENCH_TASK: task, BENCH_DIR: dir, BENCH_SCRIPT: script } = process.env;

type Fields = Record<string, number | boolean>;
const res = (w: World, name: string) => {
  const r = w.resourceList().find(([t]) => t.name === name);
  if (!r) throw new Error(`resource ${name} missing`);
  return r[1] as Fields;
};
const comp = <T>(w: World, e: Entity, name: string) =>
  w.components(e).find(([t]) => t.name === name)?.[1] as T;
const vy = (w: World) =>
  comp<{ velocity: { y: number } }>(w, find(w, 'Player'), 'RigidBody').velocity.y;
const tap = (w: World, frames: number) => {
  press(w, 'jump');
  runFrames(w, 1);
  release(w, 'jump');
  runFrames(w, frames);
};

const CHECKS: Record<string, (w: World) => void> = {
  'double-jump': (w) => {
    runFrames(w, 30);
    tap(w, 10);
    press(w, 'jump');
    runFrames(w, 1);
    expect(vy(w), 'second jump in the air').toBeGreaterThan(9);
    release(w, 'jump');
    runFrames(w, 5);
    press(w, 'jump');
    runFrames(w, 1);
    expect(vy(w), 'no third jump').toBeLessThan(9);
    release(w, 'jump');
    runFrames(w, 120);
    tap(w, 10);
    press(w, 'jump');
    runFrames(w, 1);
    expect(vy(w), 'double jump restored after landing').toBeGreaterThan(9);
  },
  'jump-count': (w) => {
    runFrames(w, 30);
    for (let i = 0; i < 3; i++) tap(w, 70);
    tap(w, 10);
    tap(w, 80); // pressed while airborne: not a jump
    expect(res(w, 'Score').jumps).toBe(4);
  },
  combo: (w) => {
    let expected = 0;
    let best = 0;
    let prev = { ...res(w, 'Game') };
    let kills = 0;
    let losses = 0;
    for (let f = 0; f < 3600 && !prev.over; f++) {
      // Alternate shooting (kills) and idling (enemies reach the player: lost lives).
      if (f % 600 === 0) press(w, 'fire');
      if (f % 600 === 300) release(w, 'fire');
      runFrames(w, 1);
      const g = res(w, 'Game');
      const dk = (g.kills as number) - (prev.kills as number);
      const lost = (g.lives as number) < (prev.lives as number);
      kills += dk;
      if (lost) losses++;
      if (dk > 0 && lost)
        expected = g.combo as number; // same-frame order is unspecified
      else if (lost) expected = 0;
      else expected += dk;
      best = Math.max(best, expected);
      expect(g.combo, `combo at frame ${w.frame}`).toBe(expected);
      expect(g.bestCombo, `bestCombo at frame ${w.frame}`).toBe(
        Math.max(best, g.bestCombo as number),
      );
      expect(g.bestCombo as number).toBeGreaterThanOrEqual(g.combo as number);
      prev = { ...g };
    }
    expect(kills).toBeGreaterThan(0);
    expect(losses).toBeGreaterThan(0);
  },
  invulnerable: (w) => {
    runFrames(w, 1);
    for (const x of [1.6, 2.2, 2.8])
      spawnPrefab(w, 'Enemy', { Transform3D: { position: [x, 0.6, 0] } });
    runFrames(w, 50);
    expect(res(w, 'Game').lives, 'three quick hits cost one life').toBe(2);
    runFrames(w, 40);
    spawnPrefab(w, 'Enemy', { Transform3D: { position: [-1.6, 0.6, 0] } });
    runFrames(w, 40);
    expect(res(w, 'Game').lives, 'hits count again after 1 s').toBe(1);
  },
};

describe.skipIf(!task)(`benchmark check ${task}`, () => {
  it('meets the feature request', async () => {
    const check = CHECKS[task as string];
    if (!check) throw new Error(`unknown task ${task}`);
    check(await loadExample(dir as string, script as 'game.ts' | 'game.tess'));
  });
});
