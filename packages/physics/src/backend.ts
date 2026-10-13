import type { Entity, Vec3, World } from '@tessera/core';
import { Collider, Collision, RigidBody, type Shape } from './components';

export interface RayHit {
  entity: Entity;
  point: Vec3;
  normal: Vec3;
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
}

/** Entity bookkeeping and event plumbing shared by the 2D and 3D Rapier adapters. */
export abstract class Backend<B extends Handle, C extends Handle> {
  protected readonly recs = new Map<Entity, Rec<B, C>>();
  protected readonly owners = new Map<number, Entity>();

  abstract raycast(origin: Point, dir: Point, max: number, opts: RayOptions): RayHit | null;
  abstract overlap(shape: Shape, size: Point, position: Point): Entity[];
  protected abstract createBody(w: World, e: Entity, type: string): B;
  protected abstract createCollider(e: Entity, c: ColliderData, body: B): C;
  protected abstract removeBody(body: B): void;
  protected abstract removeCollider(c: C): void;
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
      w.emit(Collision, { a, b, started, sensor: this.isSensor(h1) || this.isSensor(h2) });
    });
    for (const [e, rec] of this.recs) this.pull(w, e, rec);
  }

  /** Creates, updates and removes Rapier objects to match the components. */
  private sync(w: World): void {
    for (const [e, rec] of this.recs) {
      const rb = w.get(e, RigidBody);
      const c = w.get(e, Collider);
      if (!w.alive(e) || (!rb && !c) || (rb?.type ?? 'fixed') !== rec.type) {
        this.drop(e, rec);
      } else if (!c && rec.collider) {
        this.owners.delete(rec.collider.handle);
        this.removeCollider(rec.collider);
        rec.collider = null;
      }
    }
    w.each([RigidBody], (e) => this.ensure(w, e));
    w.each([Collider], (e) => this.ensure(w, e));
  }

  private ensure(w: World, e: Entity): void {
    let rec = this.recs.get(e);
    if (!rec) {
      const type = w.get(e, RigidBody)?.type ?? 'fixed';
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
      };
      this.recs.set(e, rec);
      this.pull(w, e, rec);
    }
    const c = w.get(e, Collider);
    if (c && !rec.collider) {
      rec.collider = this.createCollider(e, c, rec.body);
      this.owners.set(rec.collider.handle, e);
    }
  }

  private drop(e: Entity, rec: Rec<B, C>): void {
    if (rec.collider) this.owners.delete(rec.collider.handle);
    this.removeBody(rec.body);
    this.recs.delete(e);
  }

  protected entityOf(c: Handle): Entity {
    return this.owners.get(c.handle) ?? -1;
  }
}

export type ColliderData = ReturnType<typeof Collider.create>;
export type RigidBodyData = ReturnType<typeof RigidBody.create>;

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
