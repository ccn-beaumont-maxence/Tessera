import { component, mut, resource, system, Transform2D, vec2, World } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { assertComponent, dump, dumpEntity, find, findAll, formatValue, runFrames } from './index';

const Velocity = component('Velocity', () => ({ linear: vec2() }));
const Health = component('Health', () => ({ value: 100 }));
const Stats = resource('Stats', () => ({ bounces: 0 }));

const Gravity = system('Gravity', [mut(Velocity)], (w, _e, v) => {
  v.linear.y -= 9.81 * w.dt;
});
const Move = system('Move', [mut(Transform2D), mut(Velocity)], (w, _e, t, v) => {
  vec2.add(t.position, vec2.scale(v.linear, w.dt, tmp), t.position);
  if (t.position.y < 0) {
    t.position.y = 0;
    v.linear.y = -v.linear.y * 0.5;
    w.resource(Stats).bounces++;
  }
});
const tmp = vec2();

function simulate(seed: number): World {
  const w = new World({ seed });
  for (let i = 0; i < 5; i++) {
    const e = w.spawn('Ball');
    w.add(e, Transform2D, { position: vec2(w.rng.range(-5, 5), w.rng.range(2, 10)) });
    w.add(e, Velocity, { linear: vec2(w.rng.range(-1, 1), 0) });
  }
  const p = w.spawn('Player');
  w.add(p, Transform2D, { position: vec2(3, 1.5) });
  w.add(p, Health, { value: 80 });
  w.addSystem(Gravity, Move);
  runFrames(w, 300);
  return w;
}

describe('headless', () => {
  it('simulates 300 frames to a known state', () => {
    const w = simulate(1);
    expect(w.frame).toBe(300);
    expect(w.time).toBeCloseTo(5);
    expect(w.resource(Stats).bounces).toBeGreaterThan(5);
    for (const b of findAll(w, 'Ball')) {
      expect(w.get(b, Transform2D)?.position.y).toBeGreaterThanOrEqual(0);
    }
    assertComponent(w, 'Player', Health, { value: 80 });
    expect(dumpEntity(w, find(w, 'Player'))).toBe(
      '#6 Player Transform2D{position:(3,1.5)} Health{value:80}',
    );
  });

  it('is deterministic for a given seed', () => {
    expect(dump(simulate(42))).toBe(dump(simulate(42)));
    expect(dump(simulate(42))).not.toBe(dump(simulate(43)));
    expect(dump(simulate(42)).split('\n')).toHaveLength(7);
  });

  it('formats values compactly', () => {
    expect(formatValue(-0.0001)).toBe('0');
    expect(formatValue(1 / 3)).toBe('0.333');
    expect(formatValue('a')).toBe('"a"');
    expect(formatValue([1, { x: 1, y: 2, z: 3, w: 4 }])).toBe('[1,(1,2,3,4)]');
    expect(formatValue({ y: 1, x: 2 })).toBe('{y:1 x:2}');
    expect(formatValue({ r: 1, g: 0.5, b: 0, a: 1 })).toBe('(1,0.5,0,1)');
    expect(formatValue(true)).toBe('true');
    expect(formatValue(null)).toBe('null');
  });

  it('reports precise assertion failures', () => {
    const w = new World();
    const e = w.spawn();
    w.add(e, Transform2D);
    expect(() => assertComponent(w, e, Transform2D, { position: { x: 1 } })).toThrow(
      'Transform2D.position.x expected 1 | #1 Transform2D{}',
    );
    expect(() => assertComponent(w, e, Health, { value: 1 })).toThrow('has no Health');
    expect(() => assertComponent(w, e, Transform2D, { position: 3 as never })).toThrow(
      'Transform2D.position expected 3',
    );
    expect(() => assertComponent(w, e, Transform2D, { rotation: { a: 1 } as never })).toThrow(
      'Transform2D.rotation expected {a:1}',
    );
    assertComponent(w, e, Transform2D, { scale: { x: 1, y: 1 }, rotation: 0 });
    expect(() => find(w, 'Nope')).toThrow('no entity named "Nope" at frame 0');
  });
});
