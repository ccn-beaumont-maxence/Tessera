import { Transform3D } from '@tessera/core';
import { find, findAll, runFrames } from '@tessera/headless';
import { press, release } from '@tessera/input';
import { Text } from '@tessera/render';
import { describe, expect, it } from 'vitest';
import { loadExample } from '../load';

describe('forest', () => {
  it('walks, and wakes the forest once every wisp is found', async () => {
    const w = await loadExample(import.meta.dirname, 'game.tess');
    runFrames(w, 30);
    expect(findAll(w, 'Tree').length).toBe(95);
    const hero = w.get(find(w, 'Wanderer'), Transform3D);
    if (!hero) throw new Error('no Wanderer');
    const z = hero.position.z;
    press(w, 'KeyW');
    runFrames(w, 60);
    release(w, 'KeyW');
    expect(hero.position.z).toBeLessThan(z - 3);

    const wisps = findAll(w, 'Orb');
    expect(wisps).toHaveLength(12);
    for (const orb of wisps) {
      Object.assign(hero.position, w.get(orb, Transform3D)?.position);
      runFrames(w, 10);
    }
    expect(w.get(find(w, 'Hud'), Text)?.text).toContain('Wisps 12/12');
    expect(w.get(find(w, 'Title'), Text)?.text).toBe('The forest awakens');
  });
});
