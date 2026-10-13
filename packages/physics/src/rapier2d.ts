import * as R from '@dimforge/rapier2d-compat';
import { type Entity, Transform2D, type Vec3, type World } from '@tessera/core';
import {
  Backend,
  type ColliderData,
  dims,
  missingTransform,
  type Point,
  type RayHit,
  type RayOptions,
  type Rec,
} from './backend';
import { RigidBody, type Shape } from './components';

let ready: Promise<void> | null = null;
export const init2d = () => {
  ready ??= R.init();
  return ready;
};

const BODY = {
  dynamic: () => R.RigidBodyDesc.dynamic(),
  fixed: () => R.RigidBodyDesc.fixed(),
  kinematic: () => R.RigidBodyDesc.kinematicPositionBased(),
};

const shapeDesc = (shape: Shape, size: Point) => {
  const d = dims(shape, size);
  if (shape === 'sphere') return R.ColliderDesc.ball(d.r);
  if (shape === 'capsule') return R.ColliderDesc.capsule(d.hh, d.r);
  return R.ColliderDesc.cuboid(d.hx, d.hy);
};

const pose = (w: World, e: Entity) =>
  w.get(e, Transform2D) ?? missingTransform(e, w, 'Transform2D');

export class Physics2D extends Backend<R.RigidBody, R.Collider> {
  private readonly rw: R.World;
  private readonly queue = new R.EventQueue(true);

  constructor(gravity: Vec3) {
    super();
    this.rw = new R.World({ x: gravity.x, y: gravity.y });
  }

  protected createBody(w: World, e: Entity, type: keyof typeof BODY): R.RigidBody {
    const t = pose(w, e);
    const rb = w.get(e, RigidBody);
    const desc = BODY[type]().setTranslation(t.position.x, t.position.y).setRotation(t.rotation);
    if (rb) {
      desc.setLinvel(rb.velocity.x, rb.velocity.y).setAngvel(rb.angularVelocity.z);
      desc.setGravityScale(rb.gravityScale).setLinearDamping(rb.linearDamping);
      if (rb.lockRotation) desc.lockRotations();
    }
    return this.rw.createRigidBody(desc);
  }

  protected createCollider(_e: Entity, c: ColliderData, body: R.RigidBody): R.Collider {
    const desc = shapeDesc(c.shape, c.size)
      .setSensor(c.sensor)
      .setFriction(c.friction)
      .setRestitution(c.restitution)
      .setDensity(c.density)
      .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    return this.rw.createCollider(desc, body);
  }

  protected removeBody(body: R.RigidBody): void {
    this.rw.removeRigidBody(body);
  }

  protected removeCollider(c: R.Collider): void {
    this.rw.removeCollider(c, true);
  }

  protected push(w: World, e: Entity, rec: Rec<R.RigidBody, R.Collider>): void {
    const t = pose(w, e);
    const p = t.position;
    const l = rec.last;
    if (p.x !== l.x || p.y !== l.y) rec.body.setTranslation(p, true);
    if (t.rotation !== l.a) rec.body.setRotation(t.rotation, true);
    const rb = w.get(e, RigidBody);
    if (!rb) return;
    const v = rb.velocity;
    if (rec.type === 'kinematic') {
      rec.body.setNextKinematicTranslation({ x: p.x + v.x * w.dt, y: p.y + v.y * w.dt });
    } else if (v.x !== rec.v.x || v.y !== rec.v.y) {
      rec.body.setLinvel(v, true);
    }
    rec.body.setGravityScale(rb.gravityScale, false);
    rec.body.setLinearDamping(rb.linearDamping);
  }

  protected simulate(w: World, onEvent: (h1: number, h2: number, started: boolean) => void) {
    this.rw.timestep = w.dt;
    this.rw.step(this.queue);
    this.queue.drainCollisionEvents(onEvent);
  }

  protected pull(w: World, e: Entity, rec: Rec<R.RigidBody, R.Collider>): void {
    const t = pose(w, e);
    const p = rec.body.translation();
    t.position.x = rec.last.x = p.x;
    t.position.y = rec.last.y = p.y;
    t.rotation = rec.last.a = rec.body.rotation();
    const rb = w.get(e, RigidBody);
    if (!rb) return;
    const v = rec.body.linvel();
    rb.velocity.x = rec.v.x = v.x;
    rb.velocity.y = rec.v.y = v.y;
    rb.angularVelocity.z = rec.body.angvel();
  }

  protected isSensor(handle: number): boolean {
    return this.rw.getCollider(handle)?.isSensor() ?? false;
  }

  dispose(): void {
    this.queue.free();
    this.rw.free();
  }

  raycast(origin: Point, dir: Point, max: number, opts: RayOptions): RayHit | null {
    const len = Math.hypot(dir.x, dir.y) || 1;
    const d = { x: dir.x / len, y: dir.y / len };
    const exclude = opts.exclude === undefined ? undefined : this.recs.get(opts.exclude)?.body;
    const flags = opts.sensors ? undefined : R.QueryFilterFlags.EXCLUDE_SENSORS;
    const ray = new R.Ray({ x: origin.x, y: origin.y }, d);
    const hit = this.rw.castRayAndGetNormal(ray, max, true, flags, undefined, undefined, exclude);
    if (!hit) return null;
    const s = hit.timeOfImpact;
    return {
      entity: this.entityOf(hit.collider),
      point: { x: origin.x + d.x * s, y: origin.y + d.y * s, z: 0 },
      normal: { x: hit.normal.x, y: hit.normal.y, z: 0 },
      distance: s,
    };
  }

  overlap(shape: Shape, size: Point, position: Point): Entity[] {
    const out: Entity[] = [];
    this.rw.intersectionsWithShape(position, 0, shapeDesc(shape, size).shape, (c) => {
      out.push(this.entityOf(c));
      return true;
    });
    return out;
  }
}
