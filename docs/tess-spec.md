# Tess language

Tess is C++-flavored gameplay code compiled to TypeScript for the Tessera engine. A `.tess` file
declares components, resources, events and systems; a YAML scene lists it in `scripts:` and
orders its systems. Code can be split across files with `using`. Entities and assets live in YAML, logic lives in Tess.

## Declarations

```cpp
const float GRAVITY = -9.81;

component Health { float value = 100; }
component Enemy { float speed = 2; int hp = 2; vec3 home; }
resource Score { int coins; bool won; }
event Hit { Entity target; float damage = 1; }
```

Fields default to `0`, `false`, `""`, zero vectors, identity `quat`, white `color`, `none`.
Field order is kept (state dumps show non-default fields).

## Files

```cpp
using "./enemy.tess";   // path relative to this file
```

`using` makes another file's constants, components, resources, events and functions visible
here (not the files it uses in turn). The scene lists only the entry file in `scripts:`; used
files load with it and their systems can be listed in `systems:`. A name defined in two files
is an error. Two files cannot use each other: move what they share to a third file.

## Types

`float`, `int` (integer division truncates), `bool`, `string`, `Entity` (`none` = no entity),
value types `vec2`, `vec3`, `quat`, `color`, and declared component/resource/event names.
`auto` infers a local's type. Value types are copied on assignment, never allocated.

## Systems

```cpp
system Movement(Transform3D& t, Velocity v) {
    t.position += v.linear * dt;
}
system Death(Entity e, Health h) {
    if (h.value <= 0) destroy(e);
}
system Spawn(Spawner& s) { ... }
```

- With component parameters, the body runs once per entity having all of them.
  Without, it runs once per frame.
- `Entity e` (optional, any position) is the current entity.
- `T&` grants write access; `T` is read-only (writing it is a compile error).
- Resource parameters (`Score& score`) give the singleton.
- Systems run in the order of the scene's `systems:` list.

## Functions and statements

```cpp
float speedOf(Enemy en) { return en.speed * 2; }
void respawn(Entity e, Score& score) { get<Transform2D>(e).position = vec2(0, 1); score.deaths++; }
```

Parameters are read-only; component and resource parameters may be `T&` (passed by reference).

`if/else`, `while`, `for (init; cond; step)`, `break`, `continue`, `return`, `? :`,
`+ - * / %` (`+` with a string concatenates: `"Coins " + n`), `== != < <= > >=`, `&& || !`, `= += -= *= /=`, `++ --`. Comments `//` and `/* */`.

Value-type math: `v + w`, `v - w`, `v * s`, `s * v`, `v / s`, `-v`, `q * q` (combine),
`q * v` (rotate). Fields `.x .y .z .w`, `.r .g .b .a`.

## Built-ins

| Area | Built-ins |
| --- | --- |
| Time | `dt`, `time`, `frame` |
| Math | `abs min max clamp floor ceil round sqrt pow sin cos tan atan2 PI`, `lerp(a, b, t)` (floats or vectors), `ease("out", t)` (linear in out inOut outBack outBounce) |
| Vectors | `vec2(x, y)`, `vec3(x, y, z)`, `len(v)`, `dist(a, b)`, `dot(a, b)`, `cross(a, b)`, `normalize(v)` |
| Rotation | `quat(x, y, z, w)`, `euler(x, y, z)` (radians), `axisAngle(axis, angle)` |
| Color | `color(r, g, b, a = 1)`, `color("#ff8800")` |
| Random (seeded) | `random()` in [0,1), `random(min, max)`, `randomInt(min, max)` inclusive |
| Entities | `spawn("Prefab", Comp { field = v, ... }, ...)` returns Entity, `destroy(e)`, `alive(e)`, `has<T>(e)`, `get<T>(e)` (writable; error if missing), `add<T>(e)`, `remove<T>(e)` |
| Queries | `for (Entity o, Enemy en, Transform3D t : query) { ... }` |
| Events | `for (Collision c : events<Collision>()) { ... }` (last frame's), `emit(Hit { target = e })` |
| Input | `down("jump")`, `pressed("jump")`, `released("jump")`, `axis("move")` (vec2, y up) |
| Physics | `raycast(origin, dir, maxDist, exclude = none)` returns the hit Entity or `none` |
| Audio | `play("coin.wav")`, `music("theme.ogg")` |
| Scenes | `loadScene("level2.yaml", Score, ...)` at the end of the frame: everything is replaced except the listed resources (path relative to the current scene; list it under `scenes:`) |
| Debug | `log(a, b, ...)` |

Engine components usable in parameters and `get<T>`: `Transform2D {position, rotation, scale}`,
`Transform3D {position, rotation, scale}`, `Parent {entity}` (transform relative to it), `Timer {duration, time, repeat, destroy, done}`, `RigidBody {type, velocity, angularVelocity,
gravityScale, linearDamping, lockRotation}`, `Collider {shape, size, sensor, friction,
restitution, density}`, `Sprite`, `SpriteAnimation`, `Text {text, size, color, align, layer, screen}`, `Mesh`, `Light`, `Camera2D`, `Camera3D`.
Engine event: `Collision {Entity a; Entity b; bool started; bool sensor;}`.

Conventions: Y up, meters, radians, 3D forward is -Z.

## Not in Tess (compile errors with the fix)

| Written | Use instead |
| --- | --- |
| `#include`, headers, `using namespace` | `using "./other.tess";` |
| `a->b`, `T*`, `&x` | `a.b`; `T&` only on component/resource parameters; `Entity` to refer to entities |
| `std::` | built-ins (`std::min` → `min`, `std::cout` → `log`) |
| `new`, `delete`, `nullptr` | `spawn`, `destroy`, `none` |
| `class`, `struct` | `component`, `resource`, `event` |
| `::` | `.` |

## Errors

Compile and runtime errors point to `file.tess:line:col`.
