import { describe, expect, it } from 'vitest';
import { ease, Timer, Timers } from './timer';
import { World } from './world';

describe('Timer', () => {
  it('fires once, repeats, or destroys its entity', () => {
    const w = new World();
    w.addSystem(Timers);
    const once = w.add(w.spawn(), Timer, { duration: 1.2 });
    const rep = w.add(w.spawn(), Timer, { duration: 0.5, repeat: true });
    const doomed = w.spawn();
    w.add(doomed, Timer, { duration: 0.1, destroy: true });
    let fired = 0;
    for (let i = 0; i < 71; i++) w.step();
    expect(once.done).toBe(false);
    w.step();
    expect(once.done).toBe(true);
    expect(w.alive(doomed)).toBe(false);
    for (let i = 0; i < 60; i++) {
      w.step();
      if (rep.done) fired++;
    }
    expect(fired).toBe(2);
    expect(once.done).toBe(true);
  });

  it('eases with clamping and names the kinds on typos', () => {
    expect(ease('linear', 2)).toBe(1);
    expect(ease('in', 0.5)).toBe(0.25);
    expect(ease('out', 0.5)).toBe(0.75);
    expect(ease('outBounce', 1)).toBeCloseTo(1);
    expect(ease('outBack', 1)).toBeCloseTo(1);
    expect(() => ease('easeOut', 0)).toThrow('ease: unknown kind "easeOut" (use linear, in, out');
  });
});
