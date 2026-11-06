import {
  Parent,
  Terrain,
  Tilemap,
  Transform2D,
  Transform3D,
  terrainAt,
  vec2,
  vec3,
  World,
} from '@tessera/core';
import { dump, find, runFrames } from '@tessera/headless';
import { describe, expect, it } from 'vitest';
import { addPhysics, Collider, Collision, overlap, RigidBody, raycast } from './index';

type Dim = '2d' | '3d';
const TF = (d: Dim) => (d === '2d' ? Transform2D : Transform3D) as typeof Transform3D;

/** Ground at y=0 (top surface), a 1 m box dropped from y=5, a sensor zone at x=5. */
async function scene(dimension: Dim, seed = 1) {
  const w = new World({ seed });
  await addPhysics(w, { dimension });
  const T = (dimension === '2d' ? Transform2D : Transform3D) as typeof Transform3D;
  const at = (x: number, y: number) =>
    dimension === '2d' ? { position: vec2(x, y) } : { position: vec3(x, y, 0) };
  const ground = w.spawn('Ground');
  w.add(ground, T, at(0, -0.5) as never);
  w.add(ground, Collider, { size: vec3(40, 1, 40) });
  const box = w.spawn('Box');
  w.add(box, T, at(0, 5) as never);
  w.add(box, RigidBody);
  w.add(box, Collider);
  const zone = w.spawn('Zone');
  w.add(zone, T, at(5, 1) as never);
  w.add(zone, Collider, { sensor: true, size: vec3(2, 2, 2) });
  return w;
}

const y = (w: World, name: string) =>
  (w.get(find(w, name), Transform2D) ?? w.get(find(w, name), Transform3D))?.position.y ?? NaN;

describe.each<Dim>(['2d', '3d'])('physics %s', (dim) => {
  it('drops a body onto the ground and reports the contact', async () => {
    const w = await scene(dim);
    const hits: boolean[] = [];
    w.addSystem({
      name: 'Watch',
      reads: [],
      writes: [],
      run: (world) => {
        for (const c of world.events(Collision)) if (!c.sensor) hits.push(c.started);
      },
    });
    runFrames(w, 180);
    expect(y(w, 'Box')).toBeCloseTo(0.5, 1);
    expect(w.get(find(w, 'Box'), RigidBody)?.velocity.y).toBeCloseTo(0, 1);
    expect(hits[0]).toBe(true);
  });

  it('is deterministic', async () => {
    const run = async () => {
      const w = await scene(dim);
      runFrames(w, 120);
      return dump(w);
    };
    expect(await run()).toBe(await run());
  });

  it('raycasts against solids and skips sensors by default', async () => {
    const w = await scene(dim);
    runFrames(w, 1);
    const down = raycast(w, { x: 0, y: 10 }, { x: 0, y: -2 });
    expect(down?.entity).toBe(find(w, 'Box'));
    expect(down?.normal.y).toBeCloseTo(1);
    const ground = raycast(w, { x: 0, y: 10 }, { x: 0, y: -1 }, 100, { exclude: find(w, 'Box') });
    expect(ground?.entity).toBe(find(w, 'Ground'));
    expect(ground?.distance).toBeCloseTo(10);
    expect(ground?.point.y).toBeCloseTo(0);
    expect(raycast(w, { x: 5, y: 10 }, { x: 0, y: -1 })?.entity).toBe(find(w, 'Ground'));
    expect(raycast(w, { x: 5, y: 10 }, { x: 0, y: -1 }, 100, { sensors: true })?.entity).toBe(
      find(w, 'Zone'),
    );
    expect(raycast(w, { x: 0, y: 10 }, { x: 0, y: 1 })).toBeNull();
  });

  it('finds overlaps and fires sensor events', async () => {
    const w = await scene(dim);
    runFrames(w, 1);
    expect(overlap(w, 'sphere', { x: 1, y: 1 }, { x: 5, y: 1 })).toEqual([find(w, 'Zone')]);
    expect(overlap(w, 'box', { x: 0.2, y: 0.2 }, { x: -9, y: 9 })).toEqual([]);
    const ball = w.spawn('Ball');
    w.add(ball, TF(dim), { position: vec3(5, 4, 0) } as never);
    w.add(ball, RigidBody);
    w.add(ball, Collider, { shape: 'sphere', size: vec3(0.5, 0.5, 0.5) });
    const sensed: number[] = [];
    w.addSystem({
      name: 'Sense',
      reads: [],
      writes: [],
      run: (world) => {
        for (const c of world.events(Collision)) if (c.sensor && c.started) sensed.push(c.a, c.b);
      },
    });
    runFrames(w, 120);
    expect(sensed).toContain(ball);
    expect(sensed).toContain(find(w, 'Zone'));
  });

  it('applies game-side velocity, teleports and removals', async () => {
    const w = await scene(dim);
    const box = find(w, 'Box');
    runFrames(w, 120);
    const rb = w.get(box, RigidBody);
    if (!rb) throw new Error('no body');
    rb.velocity.x = 3;
    runFrames(w, 1);
    expect(rb.velocity.x).toBeGreaterThan(2);
    const t = w.get(box, Transform2D) ?? w.get(box, Transform3D);
    if (!t) throw new Error('no transform');
    t.position.y = 20;
    runFrames(w, 1);
    expect(y(w, 'Box')).toBeGreaterThan(19);
    runFrames(w, 60);
    expect(y(w, 'Box')).toBeLessThan(16);
    w.remove(box, Collider);
    w.destroy(find(w, 'Ground'));
    runFrames(w, 1);
    expect(raycast(w, { x: 0, y: 30 }, { x: 0, y: -1 }, 100)).toBeNull();
    w.remove(box, RigidBody);
    runFrames(w, 1);
  });

  it('moves kinematic bodies by velocity and locks rotation', async () => {
    const w = await scene(dim);
    const k = w.spawn('Platform');
    w.add(k, TF(dim), { position: vec3(-5, 2, 0) } as never);
    w.add(k, RigidBody, { type: 'kinematic', velocity: vec3(1, 0, 0) });
    w.add(k, Collider);
    w.add(find(w, 'Box'), RigidBody, { lockRotation: true, gravityScale: 0 });
    runFrames(w, 60);
    const t = w.get(k, Transform2D) ?? w.get(k, Transform3D);
    expect(t?.position.x).toBeCloseTo(-4, 1);
  });

  it('updates the collider when its fields change, without re-firing contacts', async () => {
    const w = await scene(dim);
    const box = find(w, 'Box');
    runFrames(w, 120);
    const c = w.get(box, Collider);
    if (!c) throw new Error('no collider');
    const events: boolean[] = [];
    w.addSystem({
      name: 'Watch',
      reads: [],
      writes: [],
      run: (world) => {
        for (const e of world.events(Collision)) if (!e.sensor) events.push(e.started);
      },
    });
    c.size.x = c.size.y = c.size.z = 4;
    runFrames(w, 60);
    expect(y(w, 'Box')).toBeCloseTo(2, 1);
    for (let i = 0; i < 10; i++) {
      c.size.x += 0.01;
      runFrames(w, 1);
    }
    expect(events).toEqual([]);
    c.sensor = true;
    runFrames(w, 60);
    expect(y(w, 'Box')).toBeLessThan(0);
  });

  it('applies game-side angular velocity to dynamic and kinematic bodies', async () => {
    const w = await scene(dim);
    const box = find(w, 'Box');
    w.add(box, RigidBody, { gravityScale: 0 });
    const k = w.spawn('Spinner');
    w.add(k, TF(dim), { position: vec3(-8, 3, 0) } as never);
    w.add(k, RigidBody, { type: 'kinematic', angularVelocity: vec3(0, 0, 1) });
    runFrames(w, 1);
    const rb = w.get(box, RigidBody);
    if (!rb) throw new Error('no body');
    rb.angularVelocity.z = 2;
    runFrames(w, 30);
    expect(rb.angularVelocity.z).toBeCloseTo(2);
    const spin = (e: number) => {
      const r = w.get(e, Transform2D)?.rotation ?? w.get(e, Transform3D)?.rotation.z ?? NaN;
      return dim === '2d' ? r : 2 * Math.asin(r as number);
    };
    expect(spin(box)).toBeCloseTo(1, 1);
    expect(spin(k)).toBeCloseTo(31 / 60, 2);
    rb.lockRotation = true;
    rb.angularVelocity.z = 4;
    const locked = spin(box);
    runFrames(w, 30);
    expect(spin(box)).toBeCloseTo(locked, 3);
  });

  it('carries riders on a kinematic body moved by its Transform', async () => {
    const w = new World();
    await addPhysics(w, { dimension: dim });
    const k = w.spawn('Platform');
    const pt = w.add(k, TF(dim), { position: vec3(0, 0, 0) } as never);
    w.add(k, RigidBody, { type: 'kinematic' });
    w.add(k, Collider, { size: vec3(6, 0.5, 6) });
    const box = w.spawn('Box');
    w.add(box, TF(dim), { position: vec3(0, 0.75, 0) } as never);
    w.add(box, RigidBody, { lockRotation: true });
    w.add(box, Collider);
    runFrames(w, 30);
    const move = () => {
      pt.position.x += 2 / 60;
    };
    w.addSystem({ name: 'Move', reads: [], writes: [], run: move });
    runFrames(w, 60);
    expect(pt.position.x).toBeCloseTo(2, 1);
    const bx = w.get(box, Transform2D)?.position.x ?? w.get(box, Transform3D)?.position.x;
    expect(bx).toBeGreaterThan(1);
  });

  it("reports 'ended' when a touching entity is destroyed", async () => {
    const w = await scene(dim);
    const ball = w.spawn('Ball');
    w.add(ball, TF(dim), { position: vec3(5, 1, 0) } as never);
    w.add(ball, RigidBody, { gravityScale: 0 });
    w.add(ball, Collider, { shape: 'sphere', size: vec3(0.5, 0.5, 0.5) });
    const ended: number[] = [];
    w.addSystem({
      name: 'Watch',
      reads: [],
      writes: [],
      run: (world) => {
        for (const c of world.events(Collision)) if (c.sensor && !c.started) ended.push(c.a, c.b);
      },
    });
    runFrames(w, 2);
    w.destroy(ball);
    runFrames(w, 2);
    expect(ended).toContain(ball);
    // The destroyed entity is the sensor itself: its flag comes from the removed collider.
    const ball2 = w.spawn('Ball2');
    w.add(ball2, TF(dim), { position: vec3(5, 1, 0) } as never);
    w.add(ball2, RigidBody, { gravityScale: 0 });
    w.add(ball2, Collider, { shape: 'sphere', size: vec3(0.5, 0.5, 0.5) });
    runFrames(w, 2);
    w.destroy(find(w, 'Zone'));
    runFrames(w, 2);
    expect(ended).toContain(ball2);
  });
});

describe('physics errors', () => {
  it('explains missing setup, transforms and bad values', async () => {
    const w = new World();
    expect(() => raycast(w, { x: 0, y: 0 }, { x: 1, y: 0 })).toThrow('call `await addPhysics');
    await addPhysics(w, { dimension: '3d' });
    const e = w.spawn('Lost');
    w.add(e, Collider);
    expect(() => runFrames(w, 1)).toThrow('#1 Lost has a RigidBody/Collider but no Transform3D');
    w.destroy(e);
    const f = w.spawn();
    w.add(f, Transform3D);
    w.add(f, RigidBody, { type: 'static' as never });
    expect(() => runFrames(w, 1)).toThrow('unknown type "static"');
    w.destroy(f);
    const g = w.spawn();
    w.add(g, Transform3D);
    w.add(g, Collider, { shape: 'cone' as never });
    expect(() => runFrames(w, 1)).toThrow('unknown shape "cone"');
    w.destroy(g);
    const h = w.spawn('Hitbox');
    w.add(h, Transform3D);
    w.add(h, Parent, { entity: w.spawn('Owner') });
    w.add(h, Collider);
    expect(() => runFrames(w, 1)).toThrow('#4 Hitbox has a Parent');
  });
});

describe('tilemap', () => {
  it('collides with merged tiles, reports the map entity, and rebuilds on edit', async () => {
    const w = new World();
    await addPhysics(w, { dimension: '2d' });
    const map = w.spawn('Level');
    w.add(map, Transform2D, { position: vec2(-5, 0) });
    const tiles = w.add(map, Tilemap, { tiles: ['..........', '##########'], size: 1 });
    const box = w.spawn('Box');
    w.add(box, Transform2D, { position: vec2(0, 3) });
    w.add(box, RigidBody);
    w.add(box, Collider);
    runFrames(w, 120);
    expect(y(w, 'Box')).toBeCloseTo(-0.5, 1);
    expect(raycast(w, vec2(0, 3), vec2(0, -1))?.entity).toBe(box);
    expect(raycast(w, vec2(-4.5, 3), vec2(0, -1))?.entity).toBe(map);
    expect(raycast(w, vec2(-4.5, -0.5), vec2(0, -1))?.distance).toBeCloseTo(0.5);
    tiles.tiles = ['..........', '..........', '##########'];
    runFrames(w, 1);
    expect(raycast(w, vec2(-4.5, -0.5), vec2(0, -1))?.distance).toBeCloseTo(1.5);
  });
});

describe('terrain', () => {
  it('collides with the same surface terrainAt reports, and slides bodies downhill', async () => {
    const w = new World();
    await addPhysics(w, { dimension: '3d' });
    const ground = w.spawn('Slope');
    w.add(ground, Transform3D);
    w.add(ground, Terrain, { size: vec2(40, 40), resolution: vec2(20, 20), slope: 0.3, seed: 1 });
    runFrames(w, 1);
    const hit = raycast(w, vec3(1.3, 50, -2.7), vec3(0, -1, 0));
    expect(hit?.entity).toBe(ground);
    expect(hit?.point.y).toBeCloseTo(terrainAt(w, 1.3, -2.7), 3);
    const ball = w.spawn('Ball');
    w.add(ball, Transform3D, { position: vec3(0, terrainAt(w, 0, 0) + 1, 0) });
    w.add(ball, RigidBody);
    w.add(ball, Collider, { shape: 'sphere', size: vec3(0.5, 0.5, 0.5) });
    runFrames(w, 90);
    const p = w.get(ball, Transform3D)?.position ?? vec3();
    expect(p.z).toBeLessThan(-0.5); // rolled toward -z
    expect(p.y).toBeCloseTo(terrainAt(w, p.x, p.z) + 0.25, 0);
  });
});
