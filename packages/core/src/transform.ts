import { type Quat, quat, type Vec2, type Vec3, vec2, vec3 } from './math';
import { component, type Entity, Parent, type World } from './world';

/** 2D transform: Y up, rotation in radians (counter-clockwise), 1 unit = 1 m. */
export const Transform2D = component('Transform2D', () => ({
  position: vec2(),
  rotation: 0,
  scale: vec2(1, 1),
}));

/** 3D transform: Y up, right-handed, forward is -Z. */
export const Transform3D = component('Transform3D', () => ({
  position: vec3(),
  rotation: quat(),
  scale: vec3(1, 1, 1),
}));

export type Pose2D = { position: Vec2; rotation: number; scale: Vec2 };
export type Pose3D = { position: Vec3; rotation: Quat; scale: Vec3 };

/** Longest Parent chain followed (guards against cycles). */
const MAX_DEPTH = 64;
const tmp = vec3();

/** `out = parent ∘ local` (`out` may be `local`). */
export function compose2D(parent: Pose2D, local: Pose2D, out: Pose2D): Pose2D {
  const c = Math.cos(parent.rotation);
  const s = Math.sin(parent.rotation);
  const lx = local.position.x * parent.scale.x;
  const ly = local.position.y * parent.scale.y;
  out.position.x = parent.position.x + c * lx - s * ly;
  out.position.y = parent.position.y + s * lx + c * ly;
  out.rotation = parent.rotation + local.rotation;
  out.scale.x = parent.scale.x * local.scale.x;
  out.scale.y = parent.scale.y * local.scale.y;
  return out;
}

/** `out = parent ∘ local` (`out` may be `local`). */
export function compose3D(parent: Pose3D, local: Pose3D, out: Pose3D): Pose3D {
  tmp.x = local.position.x * parent.scale.x;
  tmp.y = local.position.y * parent.scale.y;
  tmp.z = local.position.z * parent.scale.z;
  quat.rotate(parent.rotation, tmp, tmp);
  vec3.add(parent.position, tmp, out.position);
  quat.multiply(parent.rotation, local.rotation, out.rotation);
  out.scale.x = parent.scale.x * local.scale.x;
  out.scale.y = parent.scale.y * local.scale.y;
  out.scale.z = parent.scale.z * local.scale.z;
  return out;
}

/** `e`'s parent if it is alive and has a transform of `type`, else 0. */
export function parentOf(
  w: World,
  e: Entity,
  type: typeof Transform2D | typeof Transform3D,
): Entity {
  const p = w.get(e, Parent)?.entity ?? 0;
  return p !== e && w.has(p, type) ? p : 0;
}

const copy2 = (a: Pose2D, out: Pose2D) => {
  vec2.copy(a.position, out.position);
  out.rotation = a.rotation;
  vec2.copy(a.scale, out.scale);
  return out;
};
const copy3 = (a: Pose3D, out: Pose3D) => {
  vec3.copy(a.position, out.position);
  quat.copy(a.rotation, out.rotation);
  vec3.copy(a.scale, out.scale);
  return out;
};

/** World pose of `e` (its Transform2D under its parents'). */
export function worldTransform2D(w: World, e: Entity, out = Transform2D.create()): Pose2D {
  const t = w.get(e, Transform2D);
  if (!t) return copy2(Transform2D.create(), out);
  copy2(t, out);
  for (let p = parentOf(w, e, Transform2D), d = 0; p && d < MAX_DEPTH; d++) {
    compose2D(w.get(p, Transform2D) as Pose2D, out, out);
    p = parentOf(w, p, Transform2D);
  }
  return out;
}

/** World pose of `e` (its Transform3D under its parents'). */
export function worldTransform3D(w: World, e: Entity, out = Transform3D.create()): Pose3D {
  const t = w.get(e, Transform3D);
  if (!t) return copy3(Transform3D.create(), out);
  copy3(t, out);
  for (let p = parentOf(w, e, Transform3D), d = 0; p && d < MAX_DEPTH; d++) {
    compose3D(w.get(p, Transform3D) as Pose3D, out, out);
    p = parentOf(w, p, Transform3D);
  }
  return out;
}
