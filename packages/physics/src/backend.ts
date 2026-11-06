import {
  type Entity,
  Parent,
  Terrain,
  Tilemap,
  Transform3D,
  terrainMesh,
  tileRects,
  type Vec2,
  type Vec3,
  type World,
} from '@tessera/core';
import { Collider, Collision, RigidBody, type Shape } from './components';

export interface RayHit {
  entity: Entity;
  point: Vec3;
  normal: Vec3;
  distance: number;
}

/** RayHit as seen by 2D code (z is 0). */
export interface RayHit2D {
  entity: Entity;
  point: Vec2;
  normal: Vec2;
  distance: number;
}

/** Accepts Vec2 or Vec3; z defaults to 0 and is ignored in 2D. */
export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface RayOptions {
  /** Ignore this entity's body (e.g. the caster itself). */
  exclude?: Entity;
  /** Hit sensors too (default false). */
  sensors?: boolean;
}

interface Handle {
  handle: number;
}
export interface Rec<B, C> {
  body: B;
  collider: C | null;
  type: string;
  /** Last pose/velocity written to or read from Rapier, to detect game-side changes. */
  last: { x: number; y: number; z: number; a: number; b: number; c: number; d: number };
  v: { x: number; y: number; z: number };
  av: { x: number; y: number; z: number };
  lock: boolean;
  /** Collider fields last written to Rapier; a change updates the collider in place. */
  col: ColliderData | null;
}

/** Entity bookkeeping and event plumbing shared by the 2D and 3D Rapier adapters. */
export abstract class Backend<B extends Handle, C extends Handle> {
  protected readonly recs = new Map<Entity, Rec<B, C>>();
  protected readonly owners = new Map<number, Entity>();
  /** Removed collider handles (-> was sensor), kept owned until Rapier reports their 'ended' events. */
  private readonly gone = new Map<number, boolean>();
  /** A collider was rebuilt this step: its events are held in `held` until they can be netted. */
  private rebuilt = false;
  private readonly held: ({ a: Entity; b: Entity; started: boolean; sensor: boolean } | null)[] =
    [];
  /** Static body per Tilemap, rebuilt when its tiles, size or friction change. */
  private readonly maps = new Map<
    Entity,
    { body: B; colliders: C[]; tiles: readonly string[]; size: number; friction: number }
  >();

  /** Static triangle mesh per Terrain (3D), built once. */
  private readonly grounds = new Map<Entity, { body: B; collider: C }>();

  abstract raycast(origin: Point, dir: Point, max: number, opts: RayOptions): RayHit | null;
  abstract overlap(shape: Shape, size: Point, position: Point): Entity[];
  /** Frees the Rapier world (WASM memory). */
  abstract dispose(): void;
  protected abstract createBody(w: World, e: Entity, type: string): B;
  protected abstract createCollider(e: Entity, c: ColliderData, body: B): C;
  protected abstract updateCollider(col: C, c: ColliderData): void;
  protected abstract removeBody(body: B): void;
  protected abstract removeCollider(c: C): void;
  /** Fixed box collider centered at (x, y) in the body's frame. */
  protected abstract createBox(
    body: B,
    x: number,
    y: number,
    hw: number,
    hh: number,
    friction: number,
  ): C;
  /** Fixed triangle mesh in the body's frame (3D only). */
  protected abstract createMesh(
    body: B,
    positions: Float32Array,
    indices: Uint32Array,
    friction: number,
  ): C;
  protected abstract push(w: World, e: Entity, rec: Rec<B, C>): void;
  protected abstract simulate(
    w: World,
    onEvent: (h1: number, h2: number, started: boolean) => void,
  ): void;
  protected abstract pull(w: World, e: Entity, rec: Rec<B, C>): void;
  protected abstract isSensor(handle: number): boolean;

  step(w: World): void {
    this.sync(w);
    for (const [e, rec] of this.recs) this.push(w, e, rec);
    this.simulate(w, (h1, h2, started) => {
      const a = this.owners.get(h1);
      const b = this.owners.get(h2);
      if (a === undefined || b === undefined) return;
      const sensor =
        (this.gone.get(h1) ?? this.isSensor(h1)) || (this.gone.get(h2) ?? this.isSensor(h2));
      if (this.rebuilt) this.held.push({ a, b, started, sensor });
      else w.emit(Collision, { a, b, started, sensor });
    });
    if (this.rebuilt) this.net(w);
    for (const h of this.gone.keys()) this.owners.delete(h);
    this.gone.clear();
    for (const [e, rec] of this.recs) this.pull(w, e, rec);
  }

  /**
   * Emits the held events, minus each ended/started pair on the same two entities: Rapier never
   * reports both for one pair of handles in a step, so such a pair is a rebuilt collider still touching.
   */
  private net(w: World): void {
    const h = this.held;
    // ponytail: O(n^2) over one step's events, only on steps that rebuilt a collider.
    for (let i = 0; i < h.length; i++) {
      const x = h[i];
      if (!x) continue;
      const j = h.findIndex(
        (y, k) =>
          k > i &&
          y !== null &&
          y.started !== x.started &&
          ((y.a === x.a && y.b === x.b) || (y.a === x.b && y.b === x.a)),
      );
      if (j >= 0) h[j] = null;
      else w.emit(Collision, x);
    }
    h.length = 0;
    this.rebuilt = false;
  }

  /** Creates, updates and removes Rapier objects to match the components. */
  private sync(w: World): void {
    for (const [e, rec] of this.recs) {
      const rb = w.get(e, RigidBody);
      const c = w.get(e, Collider);
      if (!w.alive(e) || (!rb && !c) || (rb?.type ?? 'fixed') !== rec.type) {
        this.drop(e, rec);
      } else if (rec.collider && !c) {
        this.forget(rec.collider.handle);
        this.removeCollider(rec.collider);
        rec.collider = null;
      } else if (rec.collider && c && rec.col && !sameCollider(c, rec.col)) {
        if (sameShape(c, rec.col)) {
          this.updateCollider(rec.collider, c);
          rec.col = { ...c, size: { ...c.size } };
        } else {
          // Rapier's setShape keeps a resting contact's old manifold (no push-out), so rebuild;
          // step() cancels the ended/started pairs the new handle causes.
          this.rebuilt = true;
          this.forget(rec.collider.handle);
          this.removeCollider(rec.collider);
          rec.collider = null;
        }
      }
    }
    w.each([RigidBody], (e) => this.ensure(w, e));
    w.each([Collider], (e) => this.ensure(w, e));
    this.syncMaps(w);
  }

  private syncMaps(w: World): void {
    for (const [e, m] of this.maps) {
      const t = w.get(e, Tilemap);
      if (t && t.tiles === m.tiles && t.size === m.size && t.friction === m.friction) continue;
      for (const c of m.colliders) this.forget(c.handle);
      this.removeBody(m.body);
      this.maps.delete(e);
    }
    w.each([Tilemap], (e, t) => {
      if (this.maps.has(e)) return;
      const body = this.createBody(w, e, 'fixed');
      const colliders = tileRects(t).map((r) => {
        const c = this.createBox(
          body,
          (r.col + r.w / 2) * t.size,
          -(r.row + r.h / 2) * t.size,
          (r.w * t.size) / 2,
          (r.h * t.size) / 2,
          t.friction,
        );
        this.owners.set(c.handle, e);
        return c;
      });
      this.maps.set(e, { body, colliders, tiles: t.tiles, size: t.size, friction: t.friction });
    });
    for (const [e, g] of this.grounds) {
      if (w.alive(e) && w.get(e, Terrain)) continue;
      this.forget(g.collider.handle);
      this.removeBody(g.body);
      this.grounds.delete(e);
    }
    w.each([Transform3D, Terrain], (e, p, t) => {
      if (this.grounds.has(e)) return;
      const body = this.createBody(w, e, 'fixed');
      const { positions, indices } = terrainMesh(t, p.position);
      const collider = this.createMesh(body, positions, indices, t.friction);
      this.owners.set(collider.handle, e);
      this.grounds.set(e, { body, collider });
    });
  }

  private ensure(w: World, e: Entity): void {
    if (w.get(e, Parent)) {
      throw new Error(
        `physics: #${e} ${w.nameOf(e)} has a Parent; RigidBody/Collider must be on a root entity (move it to the parent or remove Parent)`,
      );
    }
    let rec = this.recs.get(e);
    if (!rec) {
      const rb = w.get(e, RigidBody);
      const type = rb?.type ?? 'fixed';
      if (type !== 'dynamic' && type !== 'fixed' && type !== 'kinematic') {
        throw new Error(
          `RigidBody on #${e}: unknown type "${type}" (use dynamic, fixed, kinematic)`,
        );
      }
      rec = {
        body: this.createBody(w, e, type),
        collider: null,
        type,
        last: { x: 0, y: 0, z: 0, a: 0, b: 0, c: 0, d: 0 },
        v: { x: 0, y: 0, z: 0 },
        av: { x: 0, y: 0, z: 0 },
        lock: rb?.lockRotation ?? false,
        col: null,
      };
      this.recs.set(e, rec);
      this.pull(w, e, rec);
    }
    const c = w.get(e, Collider);
    if (c && !rec.collider) {
      rec.collider = this.createCollider(e, c, rec.body);
      rec.col = { ...c, size: { ...c.size } };
      this.owners.set(rec.collider.handle, e);
    }
  }

  private drop(e: Entity, rec: Rec<B, C>): void {
    if (rec.collider) this.forget(rec.collider.handle);
    this.removeBody(rec.body);
    this.recs.delete(e);
  }

  /** Call before removing a collider from Rapier: its owner stays known for the 'ended' events. */
  private forget(handle: number): void {
    this.gone.set(handle, this.isSensor(handle));
  }

  protected entityOf(c: Handle): Entity {
    return this.owners.get(c.handle) ?? -1;
  }
}

export type ColliderData = ReturnType<typeof Collider.create>;
export type RigidBodyData = ReturnType<typeof RigidBody.create>;

function sameShape(a: ColliderData, b: ColliderData): boolean {
  return (
    a.shape === b.shape && a.size.x === b.size.x && a.size.y === b.size.y && a.size.z === b.size.z
  );
}

function sameCollider(a: ColliderData, b: ColliderData): boolean {
  return (
    sameShape(a, b) &&
    a.sensor === b.sensor &&
    a.friction === b.friction &&
    a.restitution === b.restitution &&
    a.density === b.density
  );
}

export function missingTransform(e: Entity, w: World, name: string): never {
  throw new Error(
    `physics: entity #${e} ${w.nameOf(e)} has a RigidBody/Collider but no ${name}; add ${name}`,
  );
}

/** Shape constructor arguments from a Collider-style size. */
export function dims(shape: Shape, size: Point) {
  if (shape !== 'box' && shape !== 'sphere' && shape !== 'capsule') {
    throw new Error(`Collider: unknown shape "${String(shape)}" (use box, sphere, capsule)`);
  }
  const r = size.x / 2;
  return {
    r,
    hh: Math.max(size.y / 2 - r, 0),
    hx: size.x / 2,
    hy: size.y / 2,
    hz: (size.z ?? 1) / 2,
  };
}
