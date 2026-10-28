import { Terrain, Transform3D, terrainAt, terrainFacet, terrainTracks } from '@tessera/core';
import { find, runFrames } from '@tessera/headless';
import { describe, expect, it } from 'vitest';
import { loadExample } from '../load';

describe('snow', () => {
  it('slides downhill and leaves a track with lips along its path', async () => {
    const w = await loadExample(import.meta.dirname, 'game.tess');
    runFrames(w, 240);
    expect(w.get(find(w, 'Board'), Transform3D)?.position.z).toBeLessThan(-5);

    const slope = find(w, 'Slope0');
    const t = w.get(slope, Terrain);
    const origin = w.get(slope, Transform3D)?.position;
    const segs = terrainTracks(w, slope);
    expect(segs.length / 7).toBeGreaterThan(50);
    if (!t || !origin) throw new Error('no slope');
    // Middle of one segment, and the lip top 1.5 half-widths to its side.
    const [x0, z0, x1, z1, h, depth] = segs.slice(280, 286) as [
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const lx = mx + ((z1 - z0) / len) * 1.5 * h;
    const lz = mz - ((x1 - x0) / len) * 1.5 * h;
    expect(terrainAt(w, mx, mz)).toBeCloseTo(terrainFacet(t, origin, mx, mz) - depth, 3);
    expect(terrainAt(w, lx, lz)).toBeGreaterThan(terrainFacet(t, origin, lx, lz));
  });
});
