import { color, quat, vec3 } from './math';
import { Transform2D, Transform3D, worldTransform2D, worldTransform3D } from './transform';
import { component, type Entity, mut, resource, type System, type World } from './world';

/**
 * Emits `rate` particles per second plus `burst` at once (reset to 0 after emitting), from
 * the entity's position, along its up axis (+Y) within a `spread` cone (radians, 2π = all
 * directions). Particles live `lifetime` s, fall with `gravity` m/s², fade from `color`/`size`
 * to `endColor`/`endSize`. At most `max` alive; they vanish with the emitter.
 */
export const Particles = component('Particles', () => ({
  rate: 10,
  burst: 0,
  lifetime: 1,
  speed: 2,
  spread: Math.PI / 4,
  gravity: 0,
  color: color(),
  endColor: color(),
  size: 0.2,
  endSize: 0,
  max: 100,
}));

/** Floats per particle: x y z vx vy vz age. */
export const PARTICLE_STRIDE = 7;

export interface ParticlePool {
  data: Float32Array;
  count: number;
  /** Fractional particles carried over to the next step. */
  carry: number;
}

const Pools = resource('ParticlePools', () => new Map<Entity, ParticlePool>(), {
  internal: true,
});

/** Live particles of an emitter (for rendering), or undefined. */
export const particlesOf = (w: World, e: Entity): Readonly<ParticlePool> | undefined =>
  w.resource(Pools).get(e);

const p2 = Transform2D.create();
const p3 = Transform3D.create();
const dir = vec3();
const UP = quat();

/** Simulates every emitter; scenes run it with Timers, before gameplay. */
export const ParticleSystem: System = {
  name: 'Particles',
  reads: [Transform2D, Transform3D],
  writes: [Particles],
  run(w) {
    const pools = w.resource(Pools);
    for (const e of pools.keys()) if (!w.has(e, Particles)) pools.delete(e);
    w.each([mut(Particles)], (e, p) => {
      let pool = pools.get(e);
      if (!pool || pool.data.length !== p.max * PARTICLE_STRIDE) {
        pool = { data: new Float32Array(p.max * PARTICLE_STRIDE), count: 0, carry: 0 };
        pools.set(e, pool);
      }
      const d = pool.data;
      for (let i = 0; i < pool.count; ) {
        const o = i * PARTICLE_STRIDE;
        d[o + 6] = (d[o + 6] as number) + w.dt;
        if ((d[o + 6] as number) >= p.lifetime) {
          pool.count--;
          d.copyWithin(o, pool.count * PARTICLE_STRIDE, (pool.count + 1) * PARTICLE_STRIDE);
          continue;
        }
        d[o + 4] = (d[o + 4] as number) - p.gravity * w.dt;
        d[o] = (d[o] as number) + (d[o + 3] as number) * w.dt;
        d[o + 1] = (d[o + 1] as number) + (d[o + 4] as number) * w.dt;
        d[o + 2] = (d[o + 2] as number) + (d[o + 5] as number) * w.dt;
        i++;
      }
      pool.carry += p.rate * w.dt;
      let n = p.burst + Math.floor(pool.carry);
      pool.carry -= Math.floor(pool.carry);
      p.burst = 0;
      if (n === 0) return;
      const is3d = w.has(e, Transform3D);
      const at = is3d ? worldTransform3D(w, e, p3).position : worldTransform2D(w, e, p2).position;
      const rot = is3d ? p3.rotation : UP;
      for (; n > 0 && pool.count < p.max; n--) {
        // Direction in a cone around +Y: polar angle up to spread/2, then the emitter's rotation.
        const theta = (w.rng.next() - 0.5) * Math.min(p.spread, Math.PI * 2);
        const phi = is3d ? w.rng.next() * Math.PI * 2 : 0;
        dir.x = Math.sin(theta) * Math.cos(phi);
        dir.y = Math.cos(theta);
        dir.z = Math.sin(theta) * Math.sin(phi);
        if (is3d) quat.rotate(rot, dir, dir);
        else {
          const c = Math.cos(p2.rotation);
          const s = Math.sin(p2.rotation);
          const x = dir.x;
          dir.x = c * x - s * dir.y;
          dir.y = s * x + c * dir.y;
        }
        const speed = p.speed * (0.5 + 0.5 * w.rng.next());
        const o = pool.count * PARTICLE_STRIDE;
        d[o] = at.x;
        d[o + 1] = at.y;
        d[o + 2] = is3d ? p3.position.z : 0;
        d[o + 3] = dir.x * speed;
        d[o + 4] = dir.y * speed;
        d[o + 5] = dir.z * speed;
        d[o + 6] = 0;
        pool.count++;
      }
    });
  },
};
