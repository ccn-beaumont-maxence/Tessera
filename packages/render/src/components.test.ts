import { World } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { Animate, Animator } from './components';

describe('Animator', () => {
  it('advances its time with the simulation, scaled by speed', () => {
    const w = new World();
    w.addSystem(Animate);
    const a = w.add(w.spawn(), Animator, { speed: 0.5 });
    for (let i = 0; i < 60; i++) w.step();
    expect(a.time).toBeCloseTo(0.5);
  });
});
