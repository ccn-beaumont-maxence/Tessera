# Scenes

A scene is one YAML file: entities and assets live here, logic lives in the scripts.

```yaml
dimension: 2d                 # or 3d: picks the default camera and the physics backend
scripts: [./game.tess]        # .tess or .ts modules (plus the files they `using`); their components/resources/systems become usable by name
systems: [PlayerMove, Score]  # run order of script systems
scenes: [./level2.yaml]       # other scenes loadScene() can switch to (same dimension), preloaded
input:                        # named actions (or a path: ./input.yaml)
  move: { left: [KeyA, ArrowLeft], right: [KeyD, ArrowRight], up: [KeyW], down: [KeyS], stick: PadLeft }
  jump: [Space, PadA]         # KeyboardEvent.code, MouseLeft/Right/Middle (touch = MouseLeft), PadA PadB PadX PadY PadLB PadRB PadLT PadRT PadStart PadUp...
physics: { gravity: [0, -20] }
strings: { ja: ./ja.yaml }    # translations for tr(): "Coins {0}": "コイン {0}"; ?lang=ja in the URL, else the browser language
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
    children:                 # transforms relative to the parent; destroyed with it
      - { name: Gun, Transform2D: { position: [0.5, 0] }, Sprite: { size: [0.4, 0.1] } }
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
| Parent | entity (set by `children:`; the transform becomes local to that entity's; physics bodies ignore it, keep them on root entities) |
| Transform3D | position [0,0,0], rotation identity, scale [1,1,1] |
| Timer | duration 1, time 0, repeat false, destroy false, done (true on the step it elapses; then stops, or restarts with repeat; destroy removes the entity) |
| Particles | rate 10 (per s), burst 0 (emitted once, then reset), lifetime 1, speed 2, spread 0.785 (cone around +Y, radians; 6.3 = all directions), gravity 0, color/endColor white, size 0.2, endSize 0, max 100 |
| Sprite | image '', size [1,1] (used without image), color white, pixelsPerUnit 100, layer 0 (higher on top), columns 1, rows 1, frame 0, flipX false, align center (left/right: that edge sits at the position, e.g. a bar filled by scale.x), screen false (true: HUD like screen Text, also in 3D scenes) |
| Text | text '', size 0.5 (line height), color white, align left/center/right, layer 0, screen false (true: HUD over everything, Transform2D position in [-1,1] with y up, size in tenths of screen height; text draws over sprites of the same layer), billboard false (true: 3D world text faces the camera) |
| SpriteAnimation | frames [0], fps 10, loop true |
| Tilemap | tiles [] (rows of characters, top first; Transform2D position = top-left corner), chars '#' (i-th char draws frame i of image, or a color square), passable '' (chars that don't collide), size 1 (tile meters), image '', columns 1, rows 1, color white, layer 0, friction 0.5. Solid tiles become a few static boxes |
| Camera2D | height 10 (visible meters), width 0 (if > 0, also always shows at least this many meters across) |
| Terrain | 3D faceted ground centered on its position (rotation/scale ignored): size [64,64] (x, z meters), resolution [32,32] (cells), seed 0, amplitude 2, frequency 0.05, octaves 3 (seeded noise sampled in world x/z), slope 0 (meters of rise per meter along +z: it runs downhill toward -z), color white, steepColor white (faces steeper than `steep`), steep 0.7 (radians), roughness 0.9, friction 0.5, lip 0.3 (track lip height, fraction of its depth), heal 0 (seconds for tracks to fade; 0 = they stay), markColor [0.72,0.72,0.72] (track floor). Collides as a static surface. Chunks with the same settings side by side join without seams. Built once at spawn. `terrainTrack` tracks (snow, mud, sand; a flat Terrain with a short `heal` and white `markColor` makes boat wakes) are drawn and change heights; the collider keeps the base surface |
| Mesh | shape box/sphere/plane/capsule/cylinder/cone/ico (cone, ico: faceted low-poly), size [1,1,1], color white, roughness 0.8, metalness 0, emissive 0 (glow in its color), model '' (glTF path) |
| Animator | clip '' (name in Mesh.model's glTF; '' = first clip), speed 1, loop true, time 0 (advanced by the simulation) |
| Camera3D | fov 60, near 0.1, far 1000, background '#1b1d26', fog 0 (meters to fade into background; 0 = off), bloom 0 (glow of bright/emissive colors; 0 = off) |
| Light | kind directional/point/ambient, color white, intensity 1 (directional shines along -Z) |
| RigidBody | type dynamic/fixed/kinematic, velocity, angularVelocity, gravityScale 1, linearDamping 0, lockRotation false |
| Collider | shape box/sphere/capsule, size [1,1,1] (full extent; sphere/capsule diameter = x), sensor false, friction 0.5, restitution 0, density 1 |

A Collider without RigidBody is fixed. Without a camera entity a default one is used; without
lights, default lighting. `Input`, `Timers` then `Particles` run first, `Physics` and `SpriteAnimate` last, unless you list
them in `systems:`. In `tess dev`, saving the YAML updates the running game without a reload.
