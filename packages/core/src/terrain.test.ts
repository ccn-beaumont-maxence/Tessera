import { describe, expect, it } from 'vitest';
import { vec3 } from './math';
import { Terrain, terrainAt, terrainMesh, terrainTrack, terrainY } from './terrain';
import { Transform3D } from './transform';
import { World } from './world';

const SNOW = { size: { x: 16, y: 16 }, resolution: { x: 8, y: 8 }, seed: 3, slope: 0.4 };

function slope(w: World, z: number) {
  const e = w.spawn('Chunk');
  w.add(e, Transform3D, { position: vec3(0, 0, z) });
  w.add(e, Terrain, SNOW);
  return e;
}

describe('Terrain', () => {
  it('is deterministic, runs downhill toward -z and joins chunks without seams', () => {
    const t = { ...Terrain.create(), ...SNOW };
    expect(terrainY(t, 3.3, -7.1)).toBe(terrainY(t, 3.3, -7.1));
    expect(terrainY(t, 0, -40)).toBeLessThan(terrainY(t, 0, 0) - 10);
    const a = terrainMesh(t, vec3(0, 0, 0)).positions;
    const b = terrainMesh(t, vec3(0, 0, -16)).positions;
    for (let i = 0; i <= 8; i++) {
      // A's first row (z = -8) is B's last row (z = -8 too).
      expect(a[i * 3 + 1]).toBeCloseTo((b[(8 * 9 + i) * 3 + 1] as number) - 0, 5);
    }
  });

  it('answers heights and normals on the drawn triangles', () => {
    const w = new World();
    slope(w, 0);
    const t = { ...Terrain.create(), ...SNOW };
    const n = vec3();
    expect(terrainAt(w, 2, 2, n)).toBeCloseTo(terrainY(t, 2, 2), 5); // grid vertex
    expect(n.y).toBeGreaterThan(0.8);
    expect(n.z).toBeLessThan(0); // rises toward +z, so the normal leans to -z
    expect(terrainAt(w, 100, 0, n)).toBe(0);
    expect(n).toEqual({ x: 0, y: 1, z: 0 });
  });

  it('digs a continuous groove with raised lips', () => {
    const w = new World();
    slope(w, 0);
    const before = (x: number, z: number) => terrainAt(w, x, z);
    const mid = before(0, 0);
    const side = before(0.225, 0);
    const between = before(0, -1.25);
    for (let z = 4; z > -4; z -= 0.5)
      terrainTrack(w, vec3(0, 0, z), vec3(0, 0, z - 0.5), 0.3, 0.05);
    expect(terrainAt(w, 0, 0)).toBeCloseTo(mid - 0.05, 5);
    expect(terrainAt(w, 0, -1.25)).toBeCloseTo(between - 0.05, 5); // between two calls
    expect(terrainAt(w, 0.225, 0)).toBeCloseTo(side + 0.3 * 0.05, 5); // lip top
    expect(terrainAt(w, 2, 0)).toBe(before(2, 0));
  });

  it('heals tracks over `heal` seconds, like a wake closing on water', () => {
    const w = new World();
    const water = w.spawn('Lake');
    w.add(water, Transform3D);
    w.add(water, Terrain, { amplitude: 0, heal: 2, lip: 0.5 });
    terrainTrack(w, vec3(0, 0, 2), vec3(0, 0, -2), 1, 0.2);
    expect(terrainAt(w, 0, 0)).toBeCloseTo(-0.2, 5);
    expect(terrainAt(w, 0.75, 0)).toBeCloseTo(0.1, 5); // lip: half the depth
    w.time = 1;
    expect(terrainAt(w, 0, 0)).toBeCloseTo(-0.1, 5);
    w.time = 3;
    expect(terrainAt(w, 0, 0)).toBe(0);
  });
});
