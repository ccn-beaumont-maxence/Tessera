import {
  type ComponentType,
  color,
  type Entity,
  type Game,
  Parent,
  quat,
  type ResourceType,
  resource,
  type System,
  Timer,
  Timers,
  Transform2D,
  Transform3D,
  vec3,
  type World,
} from '@tessera/core';
import { addInput, type Bindings } from '@tessera/input';
import { Collider, loadPhysics, RigidBody, startPhysics } from '@tessera/physics';
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
  type EntityDef,
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
    Parent,
    Timer,
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

/** A parsed scene with its scripts loaded: instantiating it needs no I/O. */
interface Prepared {
  parsed: Parsed;
  registry: Registry;
}

const SceneState = resource(
  'Scene',
  () => ({
    parsed: null as Parsed | null,
    registry: null as Registry | null,
    io: null as SceneIO | null,
    entities: new Map<string, { entity: Entity; spec: Spec }>(),
    /** Every scene loadScene() may switch to, by path. */
    scenes: new Map<string, Prepared>(),
    next: null as { path: string; keep: readonly ResourceType<unknown>[] } | null,
  }),
  { internal: true },
);

const isSystem = (v: unknown): v is System =>
  typeof v === 'object' && v !== null && 'run' in v && 'name' in v && 'reads' in v;

async function registry(parsed: Parsed, io: SceneIO): Promise<Registry> {
  const r: Registry = {
    components: { ...BUILTIN_COMPONENTS },
    resources: {},
    systems: { SpriteAnimate, Timers },
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

/** Loads scripts and physics, and checks names, so that instantiate() cannot need I/O. */
async function prepare(parsed: Parsed, io: SceneIO): Promise<Prepared> {
  const r = await registry(parsed, io);
  for (const [i, name] of parsed.systems.entries()) {
    if (!r.systems[name] && !['Input', 'Physics'].includes(name))
      parsed.loc
        .at('systems', i)
        .fail(`unknown system "${name}"${suggest(name, Object.keys(r.systems))}`);
  }
  for (const name of Object.keys(parsed.resources)) {
    if (!r.resources[name])
      parsed.loc
        .at('resources', name)
        .fail(`unknown resource "${name}"${suggest(name, Object.keys(r.resources))}`);
  }
  for (const def of parsed.entities)
    for (const name of Object.keys(def.spec)) componentType(r, name, def.loc.at(name));
  if (usesPhysics(parsed)) await loadPhysics(parsed.dimension);
  return { parsed, registry: r };
}

const usesPhysics = (p: Parsed) => p.physics !== null || usesAny(p, ['RigidBody', 'Collider']);

/**
 * Populates `world` from a parsed scene: resources, systems (in order), entities.
 * Scenes listed in `scenes:` (recursively) are loaded too, ready for loadScene().
 */
export async function build(world: World, parsed: Parsed, io: SceneIO): Promise<void> {
  const state = world.resource(SceneState);
  state.io = io;
  state.scenes.set(parsed.path, await prepare(parsed, io));
  const todo = [...parsed.scenes];
  for (let path = todo.shift(); path; path = todo.shift()) {
    if (state.scenes.has(path)) continue;
    const p = await parseScene(path, io);
    if (p.dimension !== parsed.dimension)
      parsed.loc
        .at('scenes')
        .fail(`${path} is ${p.dimension}, scenes must all be ${parsed.dimension}`);
    state.scenes.set(path, await prepare(p, io));
    todo.push(...p.scenes);
  }
  instantiate(world, state.scenes.get(parsed.path) as Prepared);
}

function instantiate(world: World, { parsed, registry: r }: Prepared): void {
  const state = world.resource(SceneState);
  const io = state.io as SceneIO;
  Object.assign(state, { parsed, registry: r });
  state.entities.clear();

  for (const [name, fields] of Object.entries(parsed.resources)) {
    const type = r.resources[name] as ResourceType<unknown>;
    convert(world.resource(type), fields, parsed.loc.at('resources', name), name, io);
  }

  const order = [...parsed.systems];
  if (!order.includes('Timers')) order.unshift('Timers');
  if (parsed.input && !order.includes('Input')) order.unshift('Input');
  if (usesPhysics(parsed) && !order.includes('Physics')) order.push('Physics');
  if (usesAny(parsed, ['SpriteAnimation']) && !order.includes('SpriteAnimate'))
    order.push('SpriteAnimate');
  for (const name of order) {
    if (name === 'Input') {
      addInput(world, (parsed.input ?? {}) as Bindings);
    } else if (name === 'Physics') {
      const g = parsed.physics?.gravity;
      startPhysics(world, {
        dimension: parsed.dimension,
        gravity: g ? vec3(g[0] ?? 0, g[1] ?? 0, g[2] ?? 0) : vec3(0, -9.81, 0),
      });
    } else {
      world.addSystem(r.systems[name] as System);
    }
  }
  world.addSystem(SceneLoad);

  for (const def of parsed.entities) {
    const e = world.spawn(def.name);
    addSpec(world, e, def.spec, r, def.loc, io);
    state.entities.set(def.key, { entity: e, spec: def.spec });
    link(world, e, def);
  }
}

/** Last system of every scene: applies a pending loadScene(). */
const SceneLoad: System = {
  name: 'SceneLoad',
  reads: [],
  writes: [],
  run(world) {
    const state = world.resource(SceneState);
    const next = state.next;
    if (!next) return;
    state.next = null;
    world.clear(next.keep);
    instantiate(world, state.scenes.get(next.path) as Prepared);
  },
};

/**
 * Switches to another scene at the end of the current step: entities, systems and resources
 * are replaced, except the resources in `keep`. `path` is relative to the current scene file
 * and must be the current scene or listed under `scenes:`.
 */
export function loadScene(
  world: World,
  path: string,
  keep: readonly ResourceType<unknown>[] = [],
): void {
  const state = world.resource(SceneState);
  if (!state.parsed) throw new Error(`loadScene("${path}"): no scene loaded in this world`);
  const full = join(dirOf(state.parsed.path), path);
  if (!state.scenes.has(full)) {
    const known = [...state.scenes.keys()].map((k) => k.slice(k.lastIndexOf('/') + 1));
    throw new Error(
      `loadScene("${path}"): unknown scene; list it under \`scenes:\` in the first scene (loaded: ${known.join(', ')})`,
    );
  }
  state.next = { path: full, keep };
}

/** Path of the scene currently instantiated in `world`, or null. */
export const currentScene = (world: World): string | null =>
  world.resource(SceneState).parsed?.path ?? null;

/** Sets the Parent of an entity declared under `children:`. */
function link(world: World, e: Entity, def: EntityDef): void {
  if (def.parent === null) return;
  const p = world.resource(SceneState).entities.get(def.parent);
  if (p) world.add(e, Parent, { entity: p.entity });
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
  if (prev?.path !== next.path) return false;
  for (const k of ['dimension', 'scripts', 'systems', 'input', 'physics', 'scenes'] as const) {
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
      link(world, e, def);
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
