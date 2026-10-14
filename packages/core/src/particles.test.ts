import { describe, expect, it } from 'vitest';
import { vec2 } from './math';
import { PARTICLE_STRIDE, ParticleSystem, Particles, particlesOf } from './particles';
import { Transform2D } from './transform';
import { World } from './world';

function emitter(seed = 1) {
  const w = new World({ seed });
  w.addSystem(ParticleSystem);
  const e = w.spawn();
  w.add(e, Transform2D, { position: vec2(3, 1) });
  return {
    w,
    e,
    p: w.add(e, Particles, { rate: 0, burst: 5, lifetime: 0.5, speed: 2, gravity: 10 }),
  };
}

describe('particles', () => {
  it('bursts once, moves particles, expires them and is deterministic', () => {
    const { w, e, p } = emitter();
    w.step();
    expect(particlesOf(w, e)?.count).toBe(5);
    expect(p.burst).toBe(0);
    const d = particlesOf(w, e)?.data as Float32Array;
    expect([d[0], d[1]]).toEqual([3, 1]);
    w.step();
    expect(d[1]).not.toBe(1);
    const again = emitter();
    again.w.step();
    again.w.step();
    expect([...(particlesOf(again.w, again.e)?.data ?? [])]).toEqual([...d]);
    for (let i = 0; i < 30; i++) w.step();
    expect(particlesOf(w, e)?.count).toBe(0);
  });

  it('emits at a steady rate up to max and drops pools of removed emitters', () => {
    const { w, e, p } = emitter();
    Object.assign(p, { burst: 0, rate: 30, lifetime: 10, max: 20 });
    for (let i = 0; i < 60; i++) w.step();
    expect(particlesOf(w, e)?.count).toBe(20);
    expect(particlesOf(w, e)?.data.length).toBe(20 * PARTICLE_STRIDE);
    w.destroy(e);
    w.step();
    expect(particlesOf(w, e)).toBeUndefined();
  });
});
