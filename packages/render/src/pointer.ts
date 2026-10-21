import {
  quat,
  Transform2D,
  Transform3D,
  type Vec2,
  type Vec3,
  vec2,
  vec3,
  type World,
  worldTransform2D,
  worldTransform3D,
} from '@tessera/core';
import { aspect, pointer } from '@tessera/input';
import { Camera2D, Camera3D } from './components';

/** A half-line: `origin + dir * t` for t >= 0, `dir` normalized. */
export interface Ray {
  origin: Vec3;
  dir: Vec3;
}

const pose2 = Transform2D.create();
const pose3 = Transform3D.create();
/** The renderer's camera when the scene has no Camera3D. */
const DEFAULT_3D = { position: vec3(0, 5, 10), rotation: quat.fromEuler(-Math.atan2(5, 10), 0, 0) };

/** Pointer position in the world of a 2D scene (first Camera2D, or the default camera). */
export function mouse(world: World, out = vec2()): Vec2 {
  const p = pointer(world);
  let half = 5;
  let cx = 0;
  let cy = 0;
  for (const e of world.entities()) {
    const c = world.get(e, Camera2D);
    if (!c || !world.has(e, Transform2D)) continue;
    const t = worldTransform2D(world, e, pose2);
    half = Math.max(c.height, c.width / aspect(world)) / 2;
    cx = t.position.x;
    cy = t.position.y;
    break;
  }
  out.x = cx + p.x * half * aspect(world);
  out.y = cy + p.y * half;
  return out;
}

/** Ray from the 3D camera through the pointer. */
export function mouseRay(world: World): Ray {
  const p = pointer(world);
  let fov = 60;
  let cam: { position: Vec3; rotation: typeof pose3.rotation } = DEFAULT_3D;
  for (const e of world.entities()) {
    const c = world.get(e, Camera3D);
    if (!c || !world.has(e, Transform3D)) continue;
    fov = c.fov;
    cam = worldTransform3D(world, e, pose3);
    break;
  }
  const k = Math.tan((fov * Math.PI) / 360);
  const dir = vec3.normalize(vec3(p.x * k * aspect(world), p.y * k, -1));
  return { origin: vec3.copy(cam.position), dir: quat.rotate(cam.rotation, dir, dir) };
}
