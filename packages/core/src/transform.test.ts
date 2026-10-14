import { describe, expect, it } from 'vitest';
import { quat, vec2, vec3 } from './math';
import { Transform2D, Transform3D, worldTransform2D, worldTransform3D } from './transform';
import { Parent, World } from './world';

describe('hierarchy', () => {
  it('composes 2D transforms down the Parent chain', () => {
    const w = new World();
    const root = w.spawn();
    w.add(root, Transform2D, { position: vec2(10, 0), rotation: Math.PI / 2, scale: vec2(2, 2) });
    const arm = w.spawn();
    w.add(arm, Transform2D, { position: vec2(1, 0) });
    w.add(arm, Parent, { entity: root });
    const hand = w.spawn();
    w.add(hand, Transform2D, { position: vec2(1, 0) });
    w.add(hand, Parent, { entity: arm });
    const p = worldTransform2D(w, hand);
    expect(p.position.x).toBeCloseTo(10);
    expect(p.position.y).toBeCloseTo(4);
    expect(p.rotation).toBeCloseTo(Math.PI / 2);
    expect(p.scale.x).toBe(2);
  });

  it('composes 3D transforms and ignores missing or self parents', () => {
    const w = new World();
    const root = w.spawn();
    w.add(root, Transform3D, {
      position: vec3(0, 1, 0),
      rotation: quat.fromAxisAngle(vec3(0, 1, 0), Math.PI / 2),
    });
    const kid = w.spawn();
    w.add(kid, Transform3D, { position: vec3(0, 0, -1) });
    w.add(kid, Parent, { entity: root });
    const p = worldTransform3D(w, kid);
    expect(
      [p.position.x, p.position.y, p.position.z].map((n) => Math.round(n * 1000) / 1000 + 0),
    ).toEqual([-1, 1, 0]);
    w.add(kid, Parent, { entity: kid });
    expect(worldTransform3D(w, kid).position.z).toBe(-1);
  });

  it('destroys children with their parent, also while iterating', () => {
    const w = new World();
    const root = w.spawn();
    const kids = [w.spawn(), w.spawn()];
    for (const k of kids) w.add(k, Parent, { entity: root });
    const grandkid = w.spawn();
    w.add(grandkid, Parent, { entity: kids[0] as number });
    const other = w.spawn();
    w.add(other, Parent, { entity: other + 100 });
    w.destroy(root);
    expect([...w.entities()]).toEqual([other]);

    const r2 = w.spawn();
    const k2 = w.spawn();
    w.add(r2, Parent, { entity: 0 });
    w.add(k2, Parent, { entity: r2 });
    w.each([Parent], (e) => {
      if (e === r2) w.destroy(r2);
    });
    expect(w.alive(k2)).toBe(false);
  });
});
