import { Transform3D, type World } from '@tessera/core';
import { find, findAll, runFrames } from '@tessera/headless';
import { press, release } from '@tessera/input';
import { Text } from '@tessera/render';
import { describe, expect, it } from 'vitest';
import { loadExample } from '../load';

const tap = (w: World, key: string) => {
  press(w, key);
  runFrames(w, 1);
  release(w, key);
  runFrames(w, 1);
};
const text = (w: World, name: string) => w.get(find(w, name), Text)?.text ?? '';
const hero = (w: World) => {
  const t = w.get(find(w, 'Hero'), Transform3D);
  if (!t) throw new Error('no Hero');
  return t.position;
};
const goTo = (w: World, name: string) => {
  const p = w.get(find(w, name), Transform3D)?.position;
  Object.assign(hero(w), { x: (p?.x ?? 0) + 1.5, y: 1, z: p?.z ?? 0 });
  runFrames(w, 2);
};

/** Fights around a spot until `done` (Tab targets, auto-attack and Strike). */
const fight = (w: World, x: number, z: number, done: () => boolean) => {
  Object.assign(hero(w), { x, y: 1, z });
  for (let s = 0; s < 600 && !done(); s++) {
    if (text(w, 'MessageHud').includes('died')) runFrames(w, 200);
    if (Math.hypot(hero(w).x - x, hero(w).z - z) > 12) Object.assign(hero(w), { x, y: 1, z });
    tap(w, 'Tab');
    tap(w, 'Digit1');
    runFrames(w, 30);
  }
  expect(done()).toBe(true);
};
const talk = (w: World, npc: string) => {
  goTo(w, npc);
  tap(w, 'KeyF');
  return text(w, 'MessageHud');
};

describe('dawnvale', () => {
  it('takes a quest, kills wolves for it and turns it in', async () => {
    const w = await loadExample(import.meta.dirname, 'game.tess');
    runFrames(w, 5);
    expect(findAll(w, 'Wolf')).toHaveLength(10);
    goTo(w, 'Rowan');
    tap(w, 'KeyF');
    expect(text(w, 'MessageHud')).toContain('Wolves at the Gate');
    expect(text(w, 'QuestHud')).toContain('Young Wolves slain 0/8');

    fight(w, -30, -2, () => text(w, 'QuestHud').includes('Complete'));
    expect(text(w, 'QuestHud')).toContain('Complete: see Captain Rowan');
    expect(text(w, 'PlayerHud')).not.toContain('level 1');

    goTo(w, 'Rowan');
    tap(w, 'KeyF');
    expect(text(w, 'MessageHud')).toContain('completed: +200 xp');
    tap(w, 'KeyF');
    expect(text(w, 'MessageHud')).toContain('Kobold Diggers');
  }, 60_000);

  it('gathers grapes for the farmer', async () => {
    const w = await loadExample(import.meta.dirname, 'game.tess');
    runFrames(w, 5);
    goTo(w, 'Tobbin');
    tap(w, 'KeyF');
    expect(text(w, 'QuestHud')).toContain('Grape Baskets 0/6');
    const baskets = findAll(w, 'Grapes');
    for (const b of baskets.slice(0, 6)) {
      Object.assign(hero(w), w.get(b, Transform3D)?.position, { y: 1 });
      runFrames(w, 2);
      tap(w, 'KeyF');
    }
    expect(text(w, 'QuestHud')).toContain('Complete: see Farmer Tobbin');
  });

  it('plays the six quests from level 1 to 6', async () => {
    const w = await loadExample(import.meta.dirname, 'game.tess');
    runFrames(w, 5);
    const quests = () => text(w, 'QuestHud');
    expect(talk(w, 'Rowan')).toContain('Wolves at the Gate');
    expect(talk(w, 'Tobbin')).toContain('The Grape Harvest');
    for (const b of findAll(w, 'Grapes').slice(0, 6)) {
      Object.assign(hero(w), w.get(b, Transform3D)?.position, { y: 1 });
      runFrames(w, 2);
      tap(w, 'KeyF');
    }
    expect(talk(w, 'Tobbin')).toContain('completed');
    fight(w, -30, -2, () => quests().includes('see Captain Rowan'));
    expect(talk(w, 'Rowan')).toContain('completed');
    expect(talk(w, 'Rowan')).toContain('Kobold Diggers');
    expect(talk(w, 'Mira')).toContain('Stolen Candles');
    fight(w, 28, -38, () => !quests().includes('/'));
    expect(talk(w, 'Rowan')).toContain('completed');
    expect(talk(w, 'Mira')).toContain('completed');
    expect(talk(w, 'Rowan')).toContain('Report to the Sergeant');
    expect(talk(w, 'Hale')).toContain('completed');
    expect(talk(w, 'Hale')).toContain('Grimtooth');
    fight(w, 30, -50, () => quests().includes('see Sergeant Hale'));
    expect(talk(w, 'Hale')).toContain('completed: +600 xp');
    expect(text(w, 'PlayerHud')).toMatch(/level [67]$/);
  }, 120_000);
});
