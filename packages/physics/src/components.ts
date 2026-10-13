import { component, type Entity, event, vec3 } from '@tessera/core';

export type BodyType = 'dynamic' | 'fixed' | 'kinematic';
export type Shape = 'box' | 'sphere' | 'capsule';

/**
 * Simulated body. Same fields in 2D and 3D: in 2D, z is ignored and spin is `angularVelocity.z`.
 * Velocities are read back after each step, so writing `velocity` steers the body.
 * Kinematic bodies move by `velocity` and push dynamic ones.
 */
export const RigidBody = component('RigidBody', () => ({
  type: 'dynamic' as BodyType,
  velocity: vec3(),
  angularVelocity: vec3(),
  gravityScale: 1,
  linearDamping: 0,
  lockRotation: false,
}));

/**
 * Collision shape centered on the entity. `size` is the full extent in meters:
 * box = width/height/depth, sphere (circle in 2D) = diameter in x, capsule = diameter x, height y.
 * Without a RigidBody the collider is fixed. Sensors report overlaps but do not collide.
 */
export const Collider = component('Collider', () => ({
  shape: 'box' as Shape,
  size: vec3(1, 1, 1),
  sensor: false,
  friction: 0.5,
  restitution: 0,
  density: 1,
}));

/** Contact or sensor overlap that started or ended during the previous frame. */
export const Collision = event<{ a: Entity; b: Entity; started: boolean; sensor: boolean }>(
  'Collision',
);
