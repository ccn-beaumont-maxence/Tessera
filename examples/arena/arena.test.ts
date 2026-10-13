import { dump, find, findAll, runFrames } from '@tessera/headless';
import { press } from '@tessera/input';
import { describe, expect, it } from 'vitest';
import { loadExample } from '../load';
import { Bullet, Game, Player } from './game';

async function arena(seed = 1) {
  return loadExample(import.meta.dirname, 'game.ts', seed);
}

describe('arena', () => {
  it('spawns enemies that chase the player and cost lives until game over', async () => {
    const w = await arena();
    runFrames(w, 200);
    expect(findAll(w, 'Enemy').length).toBeGreaterThan(0);
    runFrames(w, 60 * 30);
    const game = w.resource(Game);
    expect(game.lives).toBe(0);
    expect(game.over).toBe(true);
    const enemies = findAll(w, 'Enemy').length;
    runFrames(w, 300);
    expect(findAll(w, 'Enemy').length).toBe(enemies);
    press(w, 'fire');
    runFrames(w, 2);
    expect(w.resource(Game)).toEqual({ lives: 3, kills: 0, over: false });
    expect(findAll(w, 'Enemy')).toHaveLength(0);
  });

  it('auto-aims at the nearest enemy and kills enemies', async () => {
    const w = await arena();
    press(w, 'fire');
    runFrames(w, 2);
    const bullets = findAll(w, 'Bullet');
    expect(bullets).toHaveLength(1);
    expect(w.get(find(w, 'Player'), Player)?.facing).toEqual({ x: 0, y: 0, z: -1 });
    runFrames(w, 60 * 20);
    expect(w.resource(Game).kills).toBeGreaterThan(2);
    for (const b of findAll(w, 'Bullet')) expect(w.get(b, Bullet)?.life).toBeGreaterThan(0);
  });

  it('moves and turns the player', async () => {
    const w = await arena();
    press(w, 'KeyD');
    runFrames(w, 30);
    const p = w.get(find(w, 'Player'), Player);
    expect(p?.facing.x).toBeCloseTo(1);
    expect(dump(w)).toMatch(/Player Transform3D\{position:\([2-3]\.\d+,0\.8,0\)/);
  });

  it('is deterministic for a seed', async () => {
    const play = async (seed: number) => {
      const w = await arena(seed);
      press(w, 'fire');
      press(w, 'KeyW');
      runFrames(w, 600);
      return dump(w);
    };
    expect(await play(3)).toBe(await play(3));
    expect(await play(3)).not.toBe(await play(4));
  });
});
