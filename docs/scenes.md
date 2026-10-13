# Scenes

A scene is one YAML file: entities and assets live here, logic lives in the scripts.

```yaml
dimension: 2d                 # or 3d: picks the default camera and the physics backend
scripts: [./game.tess]        # .tess or .ts modules; their components/resources/systems become usable by name
systems: [PlayerMove, Score]  # run order of script systems
input:                        # named actions (or a path: ./input.yaml)
  move: { left: [KeyA, ArrowLeft], right: [KeyD, ArrowRight], up: [KeyW], down: [KeyS], stick: PadLeft }
  jump: [Space, PadA]         # KeyboardEvent.code, MouseLeft/Right/Middle (touch = MouseLeft), PadA PadB PadX PadY PadLB PadRB PadLT PadRT PadStart PadUp...
physics: { gravity: [0, -20] }
resources:
  Score: { lives: 3 }
prefabs:                      # reusable component sets: inline or a path (./coin.yaml)
  Coin:
    Transform2D: {}
    Sprite: { size: [0.4, 0.4], color: '#ffd166' }
    Collider: { shape: sphere, size: [0.4, 0.4], sensor: true }
    Coin: {}
entities:
  - name: Player              # optional; names show in dumps and find(w, 'Player')
    Transform2D: { position: [0, 1] }
    Sprite: { image: ./hero.png, columns: 4, pixelsPerUnit: 16 }
    RigidBody: { lockRotation: true }
    Collider: { shape: capsule, size: [0.8, 1] }
    Player: {}
  - { prefab: Coin, Transform2D: { position: [3, 0.5] } }   # entity fields override the prefab's
```

Spawn prefabs at runtime with `spawn("Coin", Transform2D { position = p })` in Tess.

## Values

Vectors `[x, y]` or `[x, y, z]` (missing components keep their default), rotations `[rx, ry, rz]`
Euler radians or `[x, y, z, w]`, colors `'#rrggbb'` or `[r, g, b, a]` (0..1), asset paths relative
to the YAML file. Only the fields you write change; the rest keep the component defaults.

## Engine components

| Component | Fields (defaults) |
| --- | --- |
| Transform2D | position [0,0], rotation 0 (radians), scale [1,1] |
| Transform3D | position [0,0,0], rotation identity, scale [1,1,1] |
| Sprite | image '', size [1,1] (used without image), color white, pixelsPerUnit 100, layer 0 (higher on top), columns 1, rows 1, frame 0, flipX false |
| SpriteAnimation | frames [0], fps 10, loop true |
| Camera2D | height 10 (visible meters) |
| Mesh | shape box/sphere/plane/capsule/cylinder, size [1,1,1], color white, roughness 0.8, metalness 0, model '' (glTF path) |
| Camera3D | fov 60, near 0.1, far 1000 |
| Light | kind directional/point/ambient, color white, intensity 1 (directional shines along -Z) |
| RigidBody | type dynamic/fixed/kinematic, velocity, angularVelocity, gravityScale 1, linearDamping 0, lockRotation false |
| Collider | shape box/sphere/capsule, size [1,1,1] (full extent; sphere/capsule diameter = x), sensor false, friction 0.5, restitution 0, density 1 |

A Collider without RigidBody is fixed. Without a camera entity a default one is used; without
lights, default lighting. `Input` runs first, `Physics` and `SpriteAnimate` last, unless you list
them in `systems:`. In `tess dev`, saving the YAML updates the running game without a reload.
