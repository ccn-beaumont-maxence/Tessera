import { Tilemap, Transform2D, Transform3D, vec2, vec3, World } from '@tessera/core';
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
