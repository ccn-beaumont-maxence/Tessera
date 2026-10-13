# Tessera TypeScript API

Gameplay is a TypeScript module listed in the YAML scene `scripts:`; the scene orders its
systems by name. Exported components, resources and systems are registered by name.

```ts
import { component, mut, resource, event, system, vec2, vec3, quat, Transform2D, Transform3D } from '@tessera/core';
import { axis, isDown, wasPressed, wasReleased } from '@tessera/input';
import { Collision, RigidBody, Collider, raycast } from '@tessera/physics';
import { Sprite, Camera2D, Mesh } from '@tessera/render';
import { spawnPrefab } from '@tessera/scene';
import { playSound } from '@tessera/audio';

export const Health = component('Health', () => ({ value: 100, home: vec3() }));
export const Score = resource('Score', () => ({ coins: 0, won: false }));
export const Hit = event<{ target: number }>('Hit');

// Per-entity system: runs for every entity with all terms. mut() = writable, others read-only.
export const Move = system('Move', [mut(Transform3D), Health], (w, e, t, h) => {
  t.position.y += h.value * w.dt;
}, { reads: [Score], writes: [] }); // declare resources/components used through `w`

// Once-per-frame system: a plain object.
export const Tick = { name: 'Tick', reads: [], writes: [Score], run: (w) => { w.resource(Score).coins++; } };
```

## World (`w`)

`w.dt` (1/60 s), `w.time`, `w.frame`, `w.rng.next()` [0,1), `w.rng.range(a, b)`, `w.rng.int(a, b)`;
`w.get(e, T)` (or undefined), `w.has(e, T)`, `w.add(e, T, init?)`, `w.remove(e, T)`,
`w.destroy(e)`, `w.alive(e)`, `w.spawn(name)`, `w.resource(R)`,
`w.each([A, mut(B)], (e, a, b) => ...)` (nested queries), `w.events(E)` (last frame's),
`w.emit(E, payload)`. Entities are numbers (ids start at 1).

## Math (optional `out` argument avoids allocation; `out` may alias inputs)

`vec2(x, y)`, `vec3(x, y, z)`, `vec2/vec3.add/sub/scale/lerp/normalize/copy(…, out?)`,
`vec2/vec3.dot/len/dist`, `vec3.cross`, `quat.fromEuler(x, y, z, out?)`,
`quat.fromAxisAngle(axis, angle, out?)`, `quat.multiply`, `quat.rotate(q, v, out?)`.

## Engine

- Input: `isDown(w, 'jump')`, `wasPressed(w, 'jump')`, `wasReleased(w, 'jump')`, `axis(w, 'move')` (vec2, y up).
- Physics: `raycast(w, origin, dir, maxDist, { exclude: e })` returns `{ entity, point, normal, distance }` or null.
  Event `Collision { a, b, started, sensor }`.
- `spawnPrefab(w, 'Bullet', { Transform3D: { position: [x, y, z] }, RigidBody: { velocity: [x, y, z] } })` returns the entity.
- `playSound(w, url)`.
- Components: `Transform2D {position, rotation, scale}`, `Transform3D {position, rotation (quat), scale}`,
  `RigidBody {type, velocity (vec3), angularVelocity, gravityScale, linearDamping, lockRotation}`,
  `Collider {shape, size, sensor, friction, restitution, density}`, `Sprite`, `Mesh`, `Light`, `Camera2D`, `Camera3D`.

Conventions: Y up, meters, radians, 3D forward is -Z. No `Math.random()`: use `w.rng`.
