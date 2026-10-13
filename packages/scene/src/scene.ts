import {
  type ComponentType,
  color,
  type Entity,
  type Game,
  quat,
  type ResourceType,
  resource,
  type System,
  Transform2D,
  Transform3D,
  vec3,
  type World,
} from '@tessera/core';
import { addInput, type Bindings } from '@tessera/input';
import { addPhysics, Collider, RigidBody } from '@tessera/physics';
import {
  Camera2D,
  Camera3D,
  Light,
  Mesh,
  Sprite,
  SpriteAnimate,
  SpriteAnimation,
  Text,
} from '@tessera/render';
import {
  dirOf,
  join,
  type Loc,
  type Parsed,
  parseScene,
  type SceneIO,
  type Spec,
  suggest,
} from './parse';

type AnyComponent = ComponentType<unknown>;

const BUILTIN_COMPONENTS: Record<string, AnyComponent> = Object.fromEntries(
  [
    Transform2D,
    Transform3D,
    Mesh,
    Light,
    Camera3D,
    Camera2D,
    Sprite,
    SpriteAnimation,
    Text,
    RigidBody,
    Collider,
  ].map((c) => [c.name, c as AnyComponent]),
);

interface Registry {
  components: Record<string, AnyComponent>;
  resources: Record<string, ResourceType<unknown>>;
  systems: Record<string, System>;
}

const SceneState = resource(
  'Scene',
  () => ({
    parsed: null as Parsed | null,
    registry: null as Registry | null,
    io: null as SceneIO | null,
    entities: new Map<string, { entity: Entity; spec: Spec }>(),
  }),
  { internal: true },
);

const isSystem = (v: unknown): v is System =>
  typeof v === 'object' && v !== null && 'run' in v && 'name' in v && 'reads' in v;

async function registry(parsed: Parsed, io: SceneIO): Promise<Registry> {
  const r: Registry = {
    components: { ...BUILTIN_COMPONENTS },
    resources: {},
    systems: { SpriteAnimate },
  };
  for (const [i, script] of parsed.scripts.entries()) {
    let mod: Record<string, unknown>;
    try {
      mod = await io.load(script);
    } catch (err) {
      return parsed.loc
        .at('scripts', i)
        .fail(`cannot load ${script}: ${err instanceof Error ? err.message : String(err)}`);
    }
    for (const v of Object.values(mod)) {
      if (isSystem(v)) r.systems[v.name] = v;
      else if (typeof v === 'object' && v !== null && 'kind' in v && 'name' in v) {
        const t = v as { kind: string; name: string };
        if (t.kind === 'component') r.components[t.name] = v as AnyComponent;
        if (t.kind === 'resource') r.resources[t.name] = v as ResourceType<unknown>;
      }
    }
  }
  return r;
}

const ASSET = /\.(png|jpe?g|webp|gif|svg|gltf|glb|mp3|ogg|wav|m4a)$/i;

/**
 * Converts a YAML value onto a default: [x, y(, z)] for vectors, [rx, ry, rz] Euler radians
 * or [x, y, z, w] for quaternions, '#rrggbb' or [r, g, b(, a)] for colors, relative asset paths.
 */
function convert(def: unknown, val: unknown, loc: Loc, label: string, io: SceneIO): unknown {
  if (val === undefined || val === null) return def;
  const expect = (what: string): never =>
    loc.fail(`${label} expects ${what}, got ${JSON.stringify(val)}`);
  if (typeof def === 'number') return typeof val === 'number' ? val : expect('a number');
  if (typeof def === 'boolean') return typeof val === 'boolean' ? val : expect('true or false');
  if (typeof def === 'string') {
    if (typeof val !== 'string') return expect('a string');
    return ASSET.test(val) && !/^([a-z]+:|\/)/i.test(val)
      ? io.url(join(dirOf(loc.file), val))
      : val;
  }
  if (Array.isArray(def)) return Array.isArray(val) ? [...val] : expect('a list');
  if (typeof def !== 'object' || def === null) return val;
  const o = def as Record<string, unknown>;
  const keys = Object.keys(o);
  const sig = keys.join('');
  if (sig === 'rgba') {
    if (typeof val === 'string') return color.hex(val, o as never);
    if (Array.isArray(val) && val.length >= 3 && val.every((n) => typeof n === 'number')) {
      return Object.assign(o, { r: val[0], g: val[1], b: val[2], a: val[3] ?? 1 });
    }
    return expect('"#rrggbb" or [r, g, b, a]');
  }
  if (Array.isArray(val)) {
    if (!val.every((n) => typeof n === 'number')) return expect('numbers');
    if (sig === 'xyzw' && val.length === 3)
      return quat.fromEuler(val[0] ?? 0, val[1] ?? 0, val[2] ?? 0, o as never);
    // Shorter lists keep the remaining defaults, so 2D scenes can write [x, y] for Vec3 fields.
    if (
      ((sig === 'xy' || sig === 'xyz') && val.length >= 2 && val.length <= keys.length) ||
      (sig === 'xyzw' && val.length === 4)
    ) {
      val.forEach((n, i) => {
        o[keys[i] as string] = n;
      });
      return o;
    }
    return expect(sig === 'xyzw' ? '[rx, ry, rz] radians or [x, y, z, w]' : `[${keys.join(', ')}]`);
  }
  if (typeof val !== 'object') return expect(`{ ${keys.join(', ')} }`);
  for (const [k, v] of Object.entries(val)) {
    if (!(k in o))
      loc.fail(`unknown field "${k}" in ${label}${suggest(k, keys)} (fields: ${keys.join(', ')})`);
    o[k] = convert(o[k], v, loc, `${label}.${k}`, io);
  }
  return o;
}

function componentType(r: Registry, name: string, loc: Loc): AnyComponent {
  const t = r.components[name];
  if (!t) {
    const hint =
      suggest(name, Object.keys(r.components)) || ' (export it from a file listed in `scripts`)';
    loc.fail(`unknown component "${name}"${hint}`);
  }
  return t;
}

function addSpec(world: World, e: Entity, spec: Spec, r: Registry, loc: Loc, io: SceneIO): void {
  for (const [name, fields] of Object.entries(spec)) {
    const l = loc.at(name);
    const type = componentType(r, name, l);
    const value = convert(type.create(), fields, l, name, io);
    world.add(e, type, value as Partial<unknown>);
  }
}

const usesAny = (p: Parsed, names: string[]) =>
  [...p.entities.map((e) => e.spec), ...Object.values(p.prefabs).map((x) => x.spec)].some((s) =>
    names.some((n) => n in s),
  );

/** Populates `world` from a parsed scene: resources, systems (in order), entities. */
export async function build(world: World, parsed: Parsed, io: SceneIO): Promise<void> {
  const r = await registry(parsed, io);
  const state = world.resource(SceneState);
  Object.assign(state, { parsed, registry: r, io });

  for (const [name, fields] of Object.entries(parsed.resources)) {
    const l = parsed.loc.at('resources', name);
    const type = r.resources[name];
    if (!type)
      return l.fail(`unknown resource "${name}"${suggest(name, Object.keys(r.resources))}`);
    convert(world.resource(type), fields, l, name, io);
  }

  const order = [...parsed.systems];
  if (parsed.input && !order.includes('Input')) order.unshift('Input');
  const physics = parsed.physics !== null || usesAny(parsed, ['RigidBody', 'Collider']);
  if (physics && !order.includes('Physics')) order.push('Physics');
  if (usesAny(parsed, ['SpriteAnimation']) && !order.includes('SpriteAnimate'))
    order.push('SpriteAnimate');
  for (const name of order) {
    if (name === 'Input') {
      addInput(world, (parsed.input ?? {}) as Bindings);
    } else if (name === 'Physics') {
      const g = parsed.physics?.gravity;
      await addPhysics(world, {
        dimension: parsed.dimension,
        gravity: g ? vec3(g[0] ?? 0, g[1] ?? 0, g[2] ?? 0) : vec3(0, -9.81, 0),
      });
    } else {
      const s = r.systems[name];
      if (!s) {
        const i = parsed.systems.indexOf(name);
        return parsed.loc
          .at('systems', i)
          .fail(`unknown system "${name}"${suggest(name, Object.keys(r.systems))}`);
      }
      world.addSystem(s);
    }
  }

  for (const def of parsed.entities) {
    const e = world.spawn(def.name);
    addSpec(world, e, def.spec, r, def.loc, io);
    state.entities.set(def.key, { entity: e, spec: def.spec });
  }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies an edited scene to a running world, touching only what changed in the YAML:
 * changed fields are overwritten, entities/components added or removed. Returns false when
 * scripts, systems, input, physics or dimension changed (the caller should restart).
 */
export function reload(world: World, next: Parsed): boolean {
  const state = world.resource(SceneState);
  const prev = state.parsed;
  const r = state.registry;
  const io = state.io;
  if (!prev || !r || !io) throw new Error('scene: reload() needs a world built by build()');
  for (const k of ['dimension', 'scripts', 'systems', 'input', 'physics'] as const) {
    if (!same(prev[k], next[k])) return false;
  }

  for (const [name, fields] of Object.entries(next.resources)) {
    const type = r.resources[name];
    const old = prev.resources[name] ?? {};
    if (!type) return next.loc.at('resources', name).fail(`unknown resource "${name}"`);
    const changed = Object.fromEntries(Object.entries(fields).filter(([k, v]) => !same(old[k], v)));
    convert(world.resource(type), changed, next.loc.at('resources', name), name, io);
  }

  const seen = new Set<string>();
  for (const def of next.entities) {
    seen.add(def.key);
    const cur = state.entities.get(def.key);
    if (!cur || !world.alive(cur.entity)) {
      const e = world.spawn(def.name);
      addSpec(world, e, def.spec, r, def.loc, io);
      state.entities.set(def.key, { entity: e, spec: def.spec });
      continue;
    }
    const e = cur.entity;
    for (const [name, fields] of Object.entries(def.spec)) {
      const l = def.loc.at(name);
      const type = componentType(r, name, l);
      const live = world.get(e, type) as Record<string, unknown> | undefined;
      const old = cur.spec[name];
      if (!live || !old) {
        addSpec(world, e, { [name]: fields }, r, def.loc, io);
        continue;
      }
      const defaults = type.create() as Record<string, unknown>;
      for (const k of new Set([...Object.keys(old), ...Object.keys(fields)])) {
        if (same(old[k], fields[k])) continue;
        if (!(k in defaults))
          l.fail(`unknown field "${k}" in ${name}${suggest(k, Object.keys(defaults))}`);
        live[k] = convert(defaults[k], fields[k], l, `${name}.${k}`, io);
      }
    }
    for (const name of Object.keys(cur.spec)) {
      if (!(name in def.spec)) world.remove(e, componentType(r, name, def.loc));
    }
    cur.spec = def.spec;
  }
  for (const [key, cur] of state.entities) {
    if (!seen.has(key)) {
      world.destroy(cur.entity);
      state.entities.delete(key);
    }
  }
  state.parsed = next;
  return true;
}

/** Spawns a prefab declared in the scene, with optional YAML-style overrides. */
export function spawnPrefab(world: World, name: string, overrides: Spec = {}): Entity {
  const { parsed, registry: r, io } = world.resource(SceneState);
  if (!parsed || !r || !io)
    throw new Error(`spawnPrefab("${name}"): no scene loaded in this world`);
  const p = parsed.prefabs[name];
  if (!p) {
    throw new Error(
      `spawnPrefab: unknown prefab "${name}"${suggest(name, Object.keys(parsed.prefabs))}`,
    );
  }
  const e = world.spawn(name);
  const spec: Spec = {};
  for (const [k, v] of Object.entries(p.spec)) spec[k] = { ...v, ...overrides[k] };
  for (const [k, v] of Object.entries(overrides)) spec[k] ??= v;
  addSpec(world, e, spec, r, p.loc, io);
  return e;
}

/** A Game whose world is built from a YAML scene file. */
export async function sceneGame(
  path: string,
  io: SceneIO,
  onReady?: (world: World) => void,
): Promise<Game> {
  const parsed = await parseScene(path, io);
  return {
    dimension: parsed.dimension,
    async setup(world) {
      await build(world, parsed, io);
      onReady?.(world);
    },
  };
}
