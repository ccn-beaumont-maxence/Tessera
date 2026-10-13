import { type Entity, resource, type Vec3, vec3, type World } from '@tessera/core';
import type { Backend, Point, RayHit, RayOptions } from './backend';
import type { Shape } from './components';

export type { Point, RayHit, RayOptions } from './backend';
export * from './components';

type AnyBackend = Backend<{ handle: number }, { handle: number }>;

const PhysicsState = resource('Physics', () => ({ backend: null as AnyBackend | null }), {
  internal: true,
});

type Rapier2D = typeof import('./rapier2d');
type Rapier3D = typeof import('./rapier3d');
let rapier2d: Rapier2D | null = null;
let rapier3d: Rapier3D | null = null;

/** Downloads and initializes the Rapier build for `dimension` (once). */
export async function loadPhysics(dimension: '2d' | '3d'): Promise<void> {
  // Dynamic imports: a game only downloads the Rapier build for its dimension.
  if (dimension === '2d') {
    const m = await import('./rapier2d');
    await m.init2d();
    rapier2d = m;
  } else {
    const m = await import('./rapier3d');
    await m.init3d();
    rapier3d = m;
  }
}

/**
 * Schedules the `Physics` system at this point of the system order (Rapier must be loaded, see
 * `loadPhysics`). Bodies sync from RigidBody/Collider + Transform2D/Transform3D every step.
 */
export function startPhysics(
  world: World,
  options: { dimension: '2d' | '3d'; gravity?: Vec3 },
): void {
  const gravity = options.gravity ?? vec3(0, -9.81, 0);
  const m = options.dimension === '2d' ? rapier2d : rapier3d;
  if (!m) throw new Error(`physics: await loadPhysics('${options.dimension}') first`);
  const backend = (
    'Physics2D' in m ? new m.Physics2D(gravity) : new m.Physics3D(gravity)
  ) as AnyBackend;
  const state = world.resource(PhysicsState);
  state.backend?.dispose();
  state.backend = backend;
  world.addSystem({ name: 'Physics', reads: [], writes: [], run: (w) => backend.step(w) });
}

/** `loadPhysics` then `startPhysics`. */
export async function addPhysics(
  world: World,
  options: { dimension: '2d' | '3d'; gravity?: Vec3 },
): Promise<void> {
  await loadPhysics(options.dimension);
  startPhysics(world, options);
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
