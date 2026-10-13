import type { ComponentType, Entity, World } from '@tessera/core';

/** Runs `n` fixed steps (world.dt each). */
export function runFrames(world: World, n: number): void {
  for (let i = 0; i < n; i++) world.step();
}

/** Compact value formatting: vectors and colors as tuples `(x,y[,z[,w]])`, numbers rounded to 3 decimals. */
export function formatValue(v: unknown): string {
  if (typeof v === 'number') {
    const r = Math.round(v * 1000) / 1000;
    return Object.is(r, -0) ? '0' : String(r);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(formatValue).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const keys = Object.keys(v);
    const o = v as Record<string, unknown>;
    if (isVector(keys)) return `(${keys.map((k) => formatValue(o[k])).join(',')})`;
    return `{${keys.map((k) => `${k}:${formatValue(o[k])}`).join(' ')}}`;
  }
  return String(v);
}

const isVector = (keys: string[]) =>
  keys.length >= 2 &&
  keys.length <= 4 &&
  (keys.every((k, i) => k === 'xyzw'[i]) || (keys.length === 4 && keys.join('') === 'rgba'));

/** Component fields that differ from the defaults, e.g. `{position:(3,1.5)}`. */
function formatComponent(defaults: unknown, value: unknown): string {
  if (
    value === null ||
    typeof value !== 'object' ||
    defaults === null ||
    typeof defaults !== 'object'
  ) {
    return `(${formatValue(value)})`;
  }
  const d = defaults as Record<string, unknown>;
  const fields = Object.entries(value).filter(([k, v]) => formatValue(v) !== formatValue(d[k]));
  return `{${fields.map(([k, v]) => `${k}:${formatValue(v)}`).join(' ')}}`;
}

/** One line, default-valued fields omitted: `#12 Player Transform2D{position:(3,1.5)} Health{value:80}`. */
export function dumpEntity(world: World, e: Entity): string {
  const name = world.nameOf(e);
  const parts = [`#${e}`];
  if (name) parts.push(name);
  for (const [type, value] of world.components(e))
    parts.push(type.name + formatComponent(type.create(), value));
  return parts.join(' ');
}

/** Whole world: frame number, game resources (`@Score{coins:2}`), then one line per entity. */
export function dump(world: World): string {
  const lines = [`frame ${world.frame}`];
  for (const [type, value] of world.resourceList()) {
    if (!type.internal) lines.push(`@${type.name}${formatComponent(type.create(), value)}`);
  }
  for (const e of world.entities()) lines.push(dumpEntity(world, e));
  return lines.join('\n');
}

/** First living entity named `name`; throws if none. */
export function find(world: World, name: string): Entity {
  for (const e of world.entities()) if (world.nameOf(e) === name) return e;
  throw new Error(`find: no entity named "${name}" at frame ${world.frame}`);
}

/** All living entities named `name`. */
export function findAll(world: World, name: string): Entity[] {
  return [...world.entities()].filter((e) => world.nameOf(e) === name);
}

/**
 * Throws unless the entity has `type` and every field of `expected` matches
 * (numbers within `epsilon`, objects compared recursively).
 */
export function assertComponent<T>(
  world: World,
  target: Entity | string,
  type: ComponentType<T>,
  expected: DeepPartial<T>,
  epsilon = 1e-6,
): void {
  const e = typeof target === 'string' ? find(world, target) : target;
  const actual = world.get(e, type);
  if (actual === undefined) {
    throw new Error(`assertComponent: ${dumpEntity(world, e)} has no ${type.name}`);
  }
  const path = mismatch(actual, expected, epsilon, type.name);
  if (path) {
    throw new Error(
      `assertComponent: ${path} expected ${formatValue(at(expected, path))} | ${dumpEntity(world, e)}`,
    );
  }
}

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

function mismatch(actual: unknown, expected: unknown, eps: number, path: string): string | null {
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object') return path;
    for (const [k, v] of Object.entries(expected)) {
      const m = mismatch((actual as Record<string, unknown>)[k], v, eps, `${path}.${k}`);
      if (m) return m;
    }
    return null;
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    return Math.abs(actual - expected) <= eps ? null : path;
  }
  return Object.is(actual, expected) ? null : path;
}

function at(root: unknown, path: string): unknown {
  let v = root;
  for (const k of path.split('.').slice(1)) v = (v as Record<string, unknown>)[k];
  return v;
}
