import { type Entity, resource, type Vec3, vec3, type World } from '@tessera/core';
import type { Backend, Point, RayHit, RayOptions } from './backend';
import type { Shape } from './components';
import { init2d, Physics2D } from './rapier2d';
import { init3d, Physics3D } from './rapier3d';

export type { Point, RayHit, RayOptions } from './backend';
export * from './components';

type AnyBackend = Backend<{ handle: number }, { handle: number }>;

const PhysicsState = resource('Physics', () => ({ backend: null as AnyBackend | null }), {
  internal: true,
});

/**
 * Loads Rapier and schedules the `Physics` system at this point of the system order.
 * Bodies sync from RigidBody/Collider + Transform2D/Transform3D every step.
 */
export async function addPhysics(
  world: World,
  options: { dimension: '2d' | '3d'; gravity?: Vec3 },
): Promise<void> {
  const gravity = options.gravity ?? vec3(0, -9.81, 0);
  let backend: AnyBackend;
  if (options.dimension === '2d') {
    await init2d();
    backend = new Physics2D(gravity) as AnyBackend;
  } else {
    await init3d();
    backend = new Physics3D(gravity) as AnyBackend;
  }
  world.resource(PhysicsState).backend = backend;
  world.addSystem({ name: 'Physics', reads: [], writes: [], run: (w) => backend.step(w) });
}

function backendOf(world: World): AnyBackend {
  const b = world.resource(PhysicsState).backend;
  if (!b) throw new Error('physics: call `await addPhysics(world, { dimension })` in setup first');
  return b;
}

/** First solid hit along `direction` (normalized for you), or null. Sensors ignored by default. */
export function raycast(
  world: World,
  origin: Point,
  direction: Point,
  maxDistance = 1000,
  options: RayOptions = {},
): RayHit | null {
  return backendOf(world).raycast(origin, direction, maxDistance, options);
}

/** Entities whose colliders intersect `shape` (Collider size semantics) placed at `position`. */
export function overlap(world: World, shape: Shape, size: Point, position: Point): Entity[] {
  return backendOf(world).overlap(shape, size, position);
}
