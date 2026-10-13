import * as R from '@dimforge/rapier3d-compat';
import { type Entity, Transform3D, type Vec3, type World } from '@tessera/core';
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
export const init3d = () => {
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
  return R.ColliderDesc.cuboid(d.hx, d.hy, d.hz);
};

const pose = (w: World, e: Entity) =>
  w.get(e, Transform3D) ?? missingTransform(e, w, 'Transform3D');

export class Physics3D extends Backend<R.RigidBody, R.Collider> {
  private readonly rw: R.World;
  private readonly queue = new R.EventQueue(true);

  constructor(gravity: Vec3) {
    super();
    this.rw = new R.World(gravity);
  }

  protected createBody(w: World, e: Entity, type: keyof typeof BODY): R.RigidBody {
    const t = pose(w, e);
    const rb = w.get(e, RigidBody);
    const desc = BODY[type]().setTranslation(t.position.x, t.position.y, t.position.z);
    desc.setRotation(t.rotation);
    if (rb) {
      desc.setLinvel(rb.velocity.x, rb.velocity.y, rb.velocity.z);
      desc.setAngvel(rb.angularVelocity);
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
    const q = t.rotation;
    const l = rec.last;
    if (p.x !== l.x || p.y !== l.y || p.z !== l.z) rec.body.setTranslation(p, true);
    if (q.x !== l.a || q.y !== l.b || q.z !== l.c || q.w !== l.d) rec.body.setRotation(q, true);
    const rb = w.get(e, RigidBody);
    if (!rb) return;
    const v = rb.velocity;
    if (rec.type === 'kinematic') {
      rec.body.setNextKinematicTranslation({
        x: p.x + v.x * w.dt,
        y: p.y + v.y * w.dt,
        z: p.z + v.z * w.dt,
      });
    } else if (v.x !== rec.v.x || v.y !== rec.v.y || v.z !== rec.v.z) {
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
    const q = rec.body.rotation();
    t.position.x = rec.last.x = p.x;
    t.position.y = rec.last.y = p.y;
    t.position.z = rec.last.z = p.z;
    t.rotation.x = rec.last.a = q.x;
    t.rotation.y = rec.last.b = q.y;
    t.rotation.z = rec.last.c = q.z;
    t.rotation.w = rec.last.d = q.w;
    const rb = w.get(e, RigidBody);
    if (!rb) return;
    const v = rec.body.linvel();
    rb.velocity.x = rec.v.x = v.x;
    rb.velocity.y = rec.v.y = v.y;
    rb.velocity.z = rec.v.z = v.z;
    const av = rec.body.angvel();
    rb.angularVelocity.x = av.x;
    rb.angularVelocity.y = av.y;
    rb.angularVelocity.z = av.z;
  }

  protected isSensor(handle: number): boolean {
    return this.rw.getCollider(handle)?.isSensor() ?? false;
  }

  raycast(origin: Point, dir: Point, max: number, opts: RayOptions): RayHit | null {
    const len = Math.hypot(dir.x, dir.y, dir.z ?? 0) || 1;
    const d = { x: dir.x / len, y: dir.y / len, z: (dir.z ?? 0) / len };
    const o = { x: origin.x, y: origin.y, z: origin.z ?? 0 };
    const exclude = opts.exclude === undefined ? undefined : this.recs.get(opts.exclude)?.body;
    const flags = opts.sensors ? undefined : R.QueryFilterFlags.EXCLUDE_SENSORS;
    const hit = this.rw.castRayAndGetNormal(
      new R.Ray(o, d),
      max,
      true,
      flags,
      undefined,
      undefined,
      exclude,
    );
    if (!hit) return null;
    const s = hit.timeOfImpact;
    return {
      entity: this.entityOf(hit.collider),
      point: { x: o.x + d.x * s, y: o.y + d.y * s, z: o.z + d.z * s },
      normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
      distance: s,
    };
  }

  overlap(shape: Shape, size: Point, position: Point): Entity[] {
    const out: Entity[] = [];
    const pos = { x: position.x, y: position.y, z: position.z ?? 0 };
    this.rw.intersectionsWithShape(
      pos,
      { x: 0, y: 0, z: 0, w: 1 },
      shapeDesc(shape, size).shape,
      (c) => {
        out.push(this.entityOf(c));
        return true;
      },
    );
    return out;
  }
}
