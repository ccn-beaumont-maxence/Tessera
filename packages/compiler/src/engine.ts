/** Engine types visible from Tess: module to import from, kind and field types. */
export interface StructInfo {
  /** `struct`: read-only record returned by a built-in (TS type exported by `module`). */
  kind: 'component' | 'resource' | 'event' | 'struct';
  fields: Map<string, string>;
  module: string | null;
}

const s = (
  kind: StructInfo['kind'],
  module: string,
  fields: Record<string, string>,
): StructInfo => ({
  kind,
  module,
  fields: new Map(Object.entries(fields)),
});

export const ENGINE: Record<string, StructInfo> = {
  Transform2D: s('component', '@tessera/core', {
    position: 'vec2',
    rotation: 'float',
    scale: 'vec2',
  }),
  Transform3D: s('component', '@tessera/core', {
    position: 'vec3',
    rotation: 'quat',
    scale: 'vec3',
  }),
  Parent: s('component', '@tessera/core', { entity: 'Entity' }),
  Timer: s('component', '@tessera/core', {
    duration: 'float',
    time: 'float',
    repeat: 'bool',
    destroy: 'bool',
    done: 'bool',
  }),
  RigidBody: s('component', '@tessera/physics', {
    type: 'string',
    velocity: 'vec3',
    angularVelocity: 'vec3',
    gravityScale: 'float',
    linearDamping: 'float',
    lockRotation: 'bool',
  }),
  Collider: s('component', '@tessera/physics', {
    shape: 'string',
    size: 'vec3',
    sensor: 'bool',
    friction: 'float',
    restitution: 'float',
    density: 'float',
  }),
  Collision: s('event', '@tessera/physics', {
    a: 'Entity',
    b: 'Entity',
    started: 'bool',
    sensor: 'bool',
  }),
  Sprite: s('component', '@tessera/render', {
    image: 'string',
    size: 'vec2',
    color: 'color',
    pixelsPerUnit: 'float',
    layer: 'float',
    columns: 'int',
    rows: 'int',
    frame: 'int',
    flipX: 'bool',
    align: 'string',
    screen: 'bool',
  }),
  SpriteAnimation: s('component', '@tessera/render', { fps: 'float', loop: 'bool', time: 'float' }),
  Text: s('component', '@tessera/render', {
    text: 'string',
    size: 'float',
    color: 'color',
    align: 'string',
    layer: 'float',
    screen: 'bool',
    billboard: 'bool',
  }),
  Tilemap: s('component', '@tessera/core', {
    chars: 'string',
    passable: 'string',
    size: 'float',
    image: 'string',
    columns: 'int',
    rows: 'int',
    color: 'color',
    layer: 'float',
    friction: 'float',
  }),
  Particles: s('component', '@tessera/core', {
    rate: 'float',
    burst: 'int',
    lifetime: 'float',
    speed: 'float',
    spread: 'float',
    gravity: 'float',
    color: 'color',
    endColor: 'color',
    size: 'float',
    endSize: 'float',
    max: 'int',
  }),
  Mesh: s('component', '@tessera/render', {
    shape: 'string',
    size: 'vec3',
    color: 'color',
    roughness: 'float',
    metalness: 'float',
    emissive: 'float',
    model: 'string',
  }),
  Animator: s('component', '@tessera/render', {
    clip: 'string',
    speed: 'float',
    loop: 'bool',
    time: 'float',
  }),
  Light: s('component', '@tessera/render', { kind: 'string', color: 'color', intensity: 'float' }),
  Camera2D: s('component', '@tessera/render', { height: 'float' }),
  Camera3D: s('component', '@tessera/render', {
    fov: 'float',
    near: 'float',
    far: 'float',
    background: 'color',
    fog: 'float',
    bloom: 'float',
  }),
  RayHit: s('struct', '@tessera/physics', {
    entity: 'Entity',
    point: 'vec3',
    normal: 'vec3',
    distance: 'float',
  }),
  RayHit2D: s('struct', '@tessera/physics', {
    entity: 'Entity',
    point: 'vec2',
    normal: 'vec2',
    distance: 'float',
  }),
  Ray: s('struct', '@tessera/render', { origin: 'vec3', dir: 'vec3' }),
};

/** Component names of the value types, in storage order. */
export const VALUE: Record<string, string[]> = {
  vec2: ['x', 'y'],
  vec3: ['x', 'y', 'z'],
  quat: ['x', 'y', 'z', 'w'],
  color: ['r', 'g', 'b', 'a'],
};

export const SCALARS = ['float', 'int', 'bool', 'string', 'Entity'];

export const TS_TYPE: Record<string, string> = {
  float: 'number',
  int: 'number',
  bool: 'boolean',
  string: 'string',
  Entity: 'number',
  void: 'void',
  vec2: 'Vec2',
  vec3: 'Vec3',
  quat: 'Quat',
  color: 'Color',
};
