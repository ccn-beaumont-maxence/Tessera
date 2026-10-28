import { color, type Vec3, vec2 } from './math';
import { Transform3D } from './transform';
import { component, type Entity, resource, type World } from './world';

/**
 * Faceted 3D ground centered on its Transform3D position (rotation and scale are ignored).
 * Heights come from seeded noise sampled in world x/z, plus `slope` meters of rise per meter
 * along +z (so it runs downhill toward -z): chunks with the same settings placed side by side
 * join without seams. `resolution` is the number of cells along x and z. Faces steeper than
 * `steep` radians use `steepColor`. Collides as a static surface with `friction`.
 * Set the fields when spawning: the mesh and collider are built once. `terrainTrack` leaves
 * tracks with `lip` (lip height as a fraction of the depth) and `markColor` (track floor),
 * healing over `heal` seconds (0 = they stay): snow, mud, sand, or a flat Terrain as water.
 */
export const Terrain = component('Terrain', () => ({
  size: vec2(64, 64),
  resolution: vec2(32, 32),
  seed: 0,
  amplitude: 2,
  frequency: 0.05,
  octaves: 3,
  slope: 0,
  color: color(),
  steepColor: color(),
  steep: 0.7,
  roughness: 0.9,
  friction: 0.5,
  lip: 0.3,
  heal: 0,
  markColor: color(0.72, 0.72, 0.72),
}));

export type TerrainData = ReturnType<typeof Terrain.create>;
type TerrainShape = Pick<
  TerrainData,
  'size' | 'resolution' | 'seed' | 'amplitude' | 'frequency' | 'octaves' | 'slope'
>;

/** Lattice value in [-1, 1] for integer cell (x, z) of octave layer `s`. */
function lattice(x: number, z: number, s: number): number {
  let h = Math.imul(x, 0x27d4eb2d) ^ Math.imul(z, 0x165667b1) ^ Math.imul(s, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 0x7fffffff - 1;
}

/** Smooth value noise in [-1, 1]. */
function noise(x: number, z: number, s: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fz * fz * fz * (fz * (fz * 6 - 15) + 10);
  const a = lattice(ix, iz, s);
  const b = lattice(ix + 1, iz, s);
  const c = lattice(ix, iz + 1, s);
  const d = lattice(ix + 1, iz + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Height of the terrain's noise surface at world (x, z), ignoring the triangle facets. */
export function terrainY(t: TerrainShape, x: number, z: number): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let f = t.frequency;
  for (let o = 0; o < Math.max(1, t.octaves); o++) {
    sum += noise(x * f, z * f, t.seed * 16 + o) * amp;
    total += amp;
    amp *= 0.5;
    f *= 2;
  }
  return (sum / total) * t.amplitude + t.slope * z;
}

const cells = (t: TerrainShape) => ({
  nx: Math.max(1, Math.floor(t.resolution.x)),
  nz: Math.max(1, Math.floor(t.resolution.y)),
});

/**
 * Grid vertices relative to `origin` (the entity position) and two triangles per cell, split
 * along the same diagonal as `terrainAt` so drawing, collision and queries agree.
 */
export function terrainMesh(
  t: TerrainShape,
  origin: Vec3,
): { positions: Float32Array; indices: Uint32Array } {
  const { nx, nz } = cells(t);
  const positions = new Float32Array((nx + 1) * (nz + 1) * 3);
  const indices = new Uint32Array(nx * nz * 6);
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const x = -t.size.x / 2 + (i * t.size.x) / nx;
      const z = -t.size.y / 2 + (j * t.size.y) / nz;
      const k = (j * (nx + 1) + i) * 3;
      positions[k] = x;
      positions[k + 1] = terrainY(t, origin.x + x, origin.z + z) - origin.y;
      positions[k + 2] = z;
    }
  }
  let k = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const v00 = j * (nx + 1) + i;
      const v10 = v00 + 1;
      const v01 = v00 + nx + 1;
      indices.set([v00, v01, v10, v10, v01, v00 + nx + 2], k);
      k += 6;
    }
  }
  return { positions, indices };
}

/** Faceted height at world (x, z) of `t` placed at `origin` (no grooves); slope into `g`. */
export function terrainFacet(
  t: TerrainShape,
  origin: Vec3,
  x: number,
  z: number,
  g?: { x: number; z: number },
): number {
  const c = cells(t);
  const dx = t.size.x / c.nx;
  const dz = t.size.y / c.nz;
  const lx = x - origin.x + t.size.x / 2;
  const lz = z - origin.z + t.size.y / 2;
  const i = Math.max(0, Math.min(Math.floor(lx / dx), c.nx - 1));
  const j = Math.max(0, Math.min(Math.floor(lz / dz), c.nz - 1));
  const x0 = origin.x - t.size.x / 2 + i * dx;
  const z0 = origin.z - t.size.y / 2 + j * dz;
  const u = (x - x0) / dx;
  const v = (z - z0) / dz;
  const h10 = terrainY(t, x0 + dx, z0);
  const h01 = terrainY(t, x0, z0 + dz);
  let sx: number;
  let sz: number;
  let y: number;
  if (u + v <= 1) {
    const h00 = terrainY(t, x0, z0);
    sx = (h10 - h00) / dx;
    sz = (h01 - h00) / dz;
    y = h00 + sx * dx * u + sz * dz * v;
  } else {
    const h11 = terrainY(t, x0 + dx, z0 + dz);
    sx = (h11 - h01) / dx;
    sz = (h11 - h10) / dz;
    y = h11 - sx * dx * (1 - u) - sz * dz * (1 - v);
  }
  if (g) {
    g.x = sx;
    g.z = sz;
  }
  return y;
}

/** The lip spreads this many track half-widths past the track edge. */
const SPREAD = 1;
/** Side of the buckets indexing track segments, meters. */
const BUCKET = 2;
/** Numbers per track segment: x0, z0, x1, z1, half width, depth, time made. */
export const TRACK_STRIDE = 7;

/** Track segments per Terrain (oldest first) and a bucket index of their offsets. */
interface Tracks {
  segs: number[];
  buckets: Map<number, number[]>;
}
const AllTracks = resource('TerrainTracks', () => new Map<Entity, Tracks>(), {
  internal: true,
});

const bucketKey = (bx: number, bz: number) => bx * 92837111 + bz;

/** Track segments on terrain `e` (TRACK_STRIDE numbers each, oldest first), for rendering. */
export const terrainTracks = (w: World, e: Entity): readonly number[] =>
  w.resource(AllTracks).get(e)?.segs ?? [];

/** How much of a track made at `made` is left at `now`: 1 = fresh, 0 = healed. */
export const trackLife = (t: Pick<TerrainData, 'heal'>, made: number, now: number): number =>
  t.heal > 0 ? Math.max(0, 1 - (now - made) / t.heal) : 1;

let hitE = -1 as Entity;
let hitP: Vec3 | null = null;
let hitT: TerrainData | null = null;

/** The Terrain covering world (x, z) into hitE/hitP/hitT; false if none. */
function under(w: World, x: number, z: number): boolean {
  hitP = null;
  w.each([Transform3D, Terrain], (e, p, t) => {
    if (hitP) return;
    const lx = x - p.position.x + t.size.x / 2;
    const lz = z - p.position.z + t.size.y / 2;
    if (lx < 0 || lz < 0 || lx > t.size.x || lz > t.size.y) return;
    hitE = e;
    hitP = p.position;
    hitT = t;
  });
  return hitP !== null;
}

/** Track offset at (x, z): negative inside a track, raised on its lips, else 0. */
function trackAt(g: Tracks | undefined, t: TerrainData, now: number, x: number, z: number): number {
  const list = g?.buckets.get(bucketKey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
  if (!g || !list) return 0;
  let low = 0;
  let lip = 0;
  for (const k of list) {
    const s = g.segs;
    const depth = (s[k + 5] as number) * trackLife(t, s[k + 6] as number, now);
    if (depth === 0) continue;
    const ax = s[k] as number;
    const az = s[k + 1] as number;
    const bx = (s[k + 2] as number) - ax;
    const bz = (s[k + 3] as number) - az;
    const h = s[k + 4] as number;
    const l2 = bx * bx + bz * bz;
    const f = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / l2)) : 0;
    const d = Math.hypot(x - ax - bx * f, z - az - bz * f);
    if (d < h) low = Math.min(low, -depth * (1 - (d / h) ** 2));
    else if (d < h * (1 + SPREAD))
      lip = Math.max(lip, depth * t.lip * Math.sin((Math.PI * (d - h)) / (h * SPREAD)));
  }
  return low < 0 ? low : lip;
}

/** Adds segment offset `k` to every bucket its track and lips touch. */
function index(g: Tracks, k: number): void {
  const s = g.segs;
  const r = (s[k + 4] as number) * (1 + SPREAD);
  const x0 = Math.min(s[k] as number, s[k + 2] as number) - r;
  const x1 = Math.max(s[k] as number, s[k + 2] as number) + r;
  const z0 = Math.min(s[k + 1] as number, s[k + 3] as number) - r;
  const z1 = Math.max(s[k + 1] as number, s[k + 3] as number) + r;
  for (let bx = Math.floor(x0 / BUCKET); bx <= Math.floor(x1 / BUCKET); bx++) {
    for (let bz = Math.floor(z0 / BUCKET); bz <= Math.floor(z1 / BUCKET); bz++) {
      const key = bucketKey(bx, bz);
      const list = g.buckets.get(key);
      if (list) list.push(k);
      else g.buckets.set(key, [k]);
    }
  }
}

/** Drops healed segments once they are many (they are oldest first), re-indexing the rest. */
function prune(g: Tracks, t: TerrainData, now: number): void {
  let n = 0;
  while (n < g.segs.length && trackLife(t, g.segs[n + 6] as number, now) === 0) n += TRACK_STRIDE;
  if (n < 256 * TRACK_STRIDE) return;
  g.segs.splice(0, n);
  g.buckets.clear();
  for (let k = 0; k < g.segs.length; k += TRACK_STRIDE) index(g, k);
}

/**
 * Leaves a track `width` meters wide and `depth` deep from `from` to `to` (x/z; y ignored) on
 * the Terrain under its midpoint, with lips of pushed-aside material (`Terrain.lip`) on both
 * sides: a board in snow, wheels in mud, feet in sand, a boat's wake on water. Call it each
 * step with the previous and current position for a continuous track. Tracks fade over
 * `Terrain.heal` seconds (0 = they stay). Heights, normals and drawing change; the collider
 * keeps the base surface.
 */
export function terrainTrack(w: World, from: Vec3, to: Vec3, width: number, depth: number): void {
  if (width <= 0 || depth === 0 || !under(w, (from.x + to.x) / 2, (from.z + to.z) / 2) || !hitT)
    return;
  const all = w.resource(AllTracks);
  let g = all.get(hitE);
  if (!g) {
    for (const e of all.keys()) if (!w.alive(e) || !w.get(e, Terrain)) all.delete(e);
    g = { segs: [], buckets: new Map() };
    all.set(hitE, g);
  }
  if (hitT.heal > 0) prune(g, hitT, w.time);
  const k = g.segs.length;
  g.segs.push(from.x, from.z, to.x, to.z, width / 2, depth, w.time);
  index(g, k);
}

const slope = { x: 0, z: 0 };
/** Step for the track normal's finite differences, meters. */
const EPS = 0.02;

/**
 * Height of the Terrain surface under world (x, z): its flat triangles plus tracks.
 * `normal` (if given) receives the up-facing normal. Returns 0 (normal +Y) without a Terrain.
 */
export function terrainAt(w: World, x: number, z: number, normal?: Vec3): number {
  let y = 0;
  let sx = 0;
  let sz = 0;
  if (under(w, x, z) && hitP && hitT) {
    y = terrainFacet(hitT, hitP, x, z, slope);
    sx = slope.x;
    sz = slope.z;
    const g = w.resource(AllTracks).get(hitE);
    const t = hitT;
    const at = (px: number, pz: number) => trackAt(g, t, w.time, px, pz);
    const off = at(x, z);
    y += off;
    if (normal && g && (off !== 0 || at(x + EPS, z) !== 0)) {
      sx += (at(x + EPS, z) - at(x - EPS, z)) / (2 * EPS);
      sz += (at(x, z + EPS) - at(x, z - EPS)) / (2 * EPS);
    }
  }
  if (normal) {
    const len = Math.hypot(sx, 1, sz);
    normal.x = -sx / len + 0; // + 0 turns -0 into 0
    normal.y = 1 / len;
    normal.z = -sz / len + 0;
  }
  return y;
}

/** `terrainAt` height, for Tess `terrainHeight(x, z)`. */
export const terrainHeight = (w: World, x: number, z: number): number => terrainAt(w, x, z);

/** `terrainAt` normal written to `out`, for Tess `terrainNormal(x, z)`. */
export function terrainNormal(w: World, x: number, z: number, out: Vec3): Vec3 {
  terrainAt(w, x, z, out);
  return out;
}
