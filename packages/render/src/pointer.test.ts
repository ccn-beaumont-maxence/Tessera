import { quat, Transform2D, Transform3D, vec2, vec3, World } from '@tessera/core';
import { addInput } from '@tessera/input';
import { describe, expect, it } from 'vitest';
import { Camera2D, Camera3D } from './components';
import { mouse, mouseRay } from './pointer';

/** Headless world with the pointer at `ndc` (16:9 viewport). */
function at(ndc: { x: number; y: number }) {
  const w = new World();
  addInput(w, {});
  w.step();
  const s = w.resourceList().find(([t]) => t.name === 'Input')?.[1] as { pointer: typeof ndc };
  s.pointer.x = ndc.x;
  s.pointer.y = ndc.y;
  return w;
}

describe('pointer in the world', () => {
  it('maps the pointer through the 2D camera', () => {
    const w = at({ x: 1, y: -1 });
    expect(mouse(w)).toEqual({ x: (5 * 16) / 9, y: -5 });
    const cam = w.spawn();
    w.add(cam, Transform2D, { position: vec2(10, 2) });
    w.add(cam, Camera2D, { height: 4 });
    const m = mouse(w);
    expect(m.x).toBeCloseTo(10 + (2 * 16) / 9);
    expect(m.y).toBeCloseTo(0);
  });

  it('casts a ray from the 3D camera through the pointer', () => {
    const w = at({ x: 0, y: 0 });
    const r = mouseRay(w);
    expect(r.origin).toEqual({ x: 0, y: 5, z: 10 });
    expect(r.dir.y / r.dir.z).toBeCloseTo(0.5);
    const cam = w.spawn();
    w.add(cam, Transform3D, {
      position: vec3(0, 10, 0),
      rotation: quat.fromEuler(-Math.PI / 2, 0, 0),
    });
    w.add(cam, Camera3D);
    const down = mouseRay(w).dir;
    expect([down.x, down.y, down.z].map((n) => Math.round(n * 1e6) / 1e6 + 0)).toEqual([0, -1, 0]);
  });
});
