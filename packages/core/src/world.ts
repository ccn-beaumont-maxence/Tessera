import { Rng } from './rng';

export type Entity = number;

export interface ComponentType<T> {
  readonly kind: 'component';
  readonly name: string;
  readonly create: () => T;
}
export interface ResourceType<T> {
  readonly kind: 'resource';
  readonly name: string;
  readonly create: () => T;
  /** Engine bookkeeping, left out of state dumps. */
  readonly internal?: boolean;
}
export interface EventType<T> {
  readonly kind: 'event';
  readonly name: string;
  /** Phantom field carrying the payload type; never set. */
  readonly payload?: T;
}

export const component = <T>(name: string, create: () => T): ComponentType<T> => ({
  kind: 'component',
  name,
  create,
});
export const resource = <T>(
  name: string,
  create: () => T,
  options: { internal?: boolean } = {},
): ResourceType<T> => ({ kind: 'resource', name, create, ...options });
export const event = <T>(name: string): EventType<T> => ({ kind: 'event', name });

/** Marks a query term as written: `system('Move', [mut(Transform3D), Velocity], ...)`. */
export interface Mut<T> {
  readonly mut: ComponentType<T>;
}
export const mut = <T>(type: ComponentType<T>): Mut<T> => ({ mut: type });

export type Term = ComponentType<unknown> | Mut<unknown>;
type Access = ComponentType<unknown> | ResourceType<unknown>;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
type TermValue<X> =
  X extends Mut<infer T> ? T : X extends ComponentType<infer T> ? DeepReadonly<T> : never;
export type Values<Q extends readonly Term[]> = { [K in keyof Q]: TermValue<Q[K]> };

export interface System {
  readonly name: string;
  readonly reads: readonly Access[];
  readonly writes: readonly Access[];
  run(world: World): void;
}

const MAX_TERMS = 8;

/**
 * Per-entity system. Terms wrapped in `mut()` are writable; others are typed read-only.
 * Declare extra components/resources accessed through `world` in `access`.
 */
export function system<const Q extends readonly Term[]>(
  name: string,
  terms: Q,
  fn: (world: World, e: Entity, ...c: Values<Q>) => void,
  access: { reads?: readonly Access[]; writes?: readonly Access[] } = {},
): System {
  const f = fn as unknown as (w: World, e: Entity, ...c: unknown[]) => void;
  return {
    name,
    reads: [...terms.filter((t) => !('mut' in t)).map(typeOf), ...(access.reads ?? [])],
    writes: [...terms.filter((t) => 'mut' in t).map(typeOf), ...(access.writes ?? [])],
    run: (world) =>
      world.each(terms, ((e: Entity, a, b, c, d, g, h, i, j) =>
        f(world, e, a, b, c, d, g, h, i, j)) as Fixed as never),
  };
}

type Fixed = (e: Entity, ...c: unknown[]) => void;

const typeOf = (t: Term): ComponentType<unknown> => ('mut' in t ? t.mut : t);

/** Sparse set. While the world is iterating, removals leave holes (entity -1) compacted later. */
class Store {
  readonly sparse = new Map<Entity, number>();
  readonly ents: Entity[] = [];
  readonly vals: unknown[] = [];
  holes = 0;

  get(e: Entity): unknown {
    const i = this.sparse.get(e);
    return i === undefined ? undefined : this.vals[i];
  }

  set(e: Entity, v: unknown): void {
    const i = this.sparse.get(e);
    if (i !== undefined) {
      this.vals[i] = v;
      return;
    }
    this.sparse.set(e, this.ents.length);
    this.ents.push(e);
    this.vals.push(v);
  }

  delete(e: Entity, locked: boolean): boolean {
    const i = this.sparse.get(e);
    if (i === undefined) return false;
    this.sparse.delete(e);
    if (locked) {
      this.ents[i] = -1;
      this.vals[i] = undefined;
      this.holes++;
      return true;
    }
    const last = this.ents.length - 1;
    if (i !== last) {
      const moved = this.ents[last] as Entity;
      this.ents[i] = moved;
      this.vals[i] = this.vals[last];
      this.sparse.set(moved, i);
    }
    this.ents.pop();
    this.vals.pop();
    return true;
  }

  /** Removes holes, keeping order (deterministic iteration). */
  compact(): void {
    let w = 0;
    for (let r = 0; r < this.ents.length; r++) {
      const e = this.ents[r] as Entity;
      if (e < 0) continue;
      this.ents[w] = e;
      this.vals[w] = this.vals[r];
      this.sparse.set(e, w);
      w++;
    }
    this.ents.length = w;
    this.vals.length = w;
    this.holes = 0;
  }
}

export class World {
  /** Fixed timestep in seconds. */
  readonly dt = 1 / 60;
  frame = 0;
  time = 0;
  readonly rng: Rng;

  private nextId = 1;
  private readonly names = new Map<Entity, string>();
  private readonly stores = new Map<ComponentType<unknown>, Store>();
  private readonly resources = new Map<ResourceType<unknown>, unknown>();
  private readonly queues = new Map<EventType<unknown>, { cur: unknown[]; prev: unknown[] }>();
  private readonly systems: System[] = [];
  private locked = 0;

  constructor(options: { seed?: number } = {}) {
    this.rng = new Rng(options.seed ?? 1);
  }

  spawn(name = ''): Entity {
    const e = this.nextId++;
    this.names.set(e, name);
    return e;
  }

  destroy(e: Entity): void {
    if (!this.names.delete(e)) return;
    for (const s of this.stores.values()) s.delete(e, this.locked > 0);
  }

  alive(e: Entity): boolean {
    return this.names.has(e);
  }

  /** Living entities in creation order. */
  entities(): IterableIterator<Entity> {
    return this.names.keys();
  }

  nameOf(e: Entity): string {
    return this.names.get(e) ?? '';
  }

  /** Adds (or replaces) a component, built from its defaults merged with `init`. */
  add<T>(e: Entity, type: ComponentType<T>, init?: Partial<T>): T {
    if (!this.names.has(e)) {
      throw new Error(
        `add(${type.name}): entity #${e} does not exist (destroyed or never spawned)`,
      );
    }
    const v = init ? Object.assign(type.create() as object, init) : type.create();
    this.store(type).set(e, v);
    return v as T;
  }

  get<T>(e: Entity, type: ComponentType<T>): T | undefined {
    return this.stores.get(type)?.get(e) as T | undefined;
  }

  has(e: Entity, type: ComponentType<unknown>): boolean {
    return this.stores.get(type)?.sparse.has(e) ?? false;
  }

  remove(e: Entity, type: ComponentType<unknown>): void {
    this.stores.get(type)?.delete(e, this.locked > 0);
  }

  /** Components of `e`, in component registration order. */
  components(e: Entity): [ComponentType<unknown>, unknown][] {
    const out: [ComponentType<unknown>, unknown][] = [];
    for (const [type, s] of this.stores) if (s.sparse.has(e)) out.push([type, s.get(e)]);
    return out;
  }

  /**
   * Calls `fn` for every entity having all `terms`. Spawning, adding, removing and destroying
   * during iteration is safe; entities gaining the components mid-iteration are not visited.
   */
  each<const Q extends readonly Term[]>(terms: Q, fn: (e: Entity, ...c: Values<Q>) => void): void {
    const n = terms.length;
    if (n === 0 || n > MAX_TERMS) {
      throw new Error(`each: expected 1 to ${MAX_TERMS} components, got ${n}`);
    }
    const stores = terms.map((t) => this.store(typeOf(t)));
    let driver = stores[0] as Store;
    for (const s of stores) if (s.ents.length < driver.ents.length) driver = s;
    const c: unknown[] = new Array(MAX_TERMS);
    const call = fn as (e: Entity, ...c: unknown[]) => void;
    this.locked++;
    try {
      const len = driver.ents.length;
      outer: for (let i = 0; i < len; i++) {
        const e = driver.ents[i] as Entity;
        if (e < 0) continue;
        for (let k = 0; k < n; k++) {
          const v = (stores[k] as Store).get(e);
          if (v === undefined) continue outer;
          c[k] = v;
        }
        // ponytail: fixed arity avoids a spread allocation per entity; caps queries at 8 terms.
        call(e, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
      }
    } finally {
      if (--this.locked === 0) for (const s of this.stores.values()) if (s.holes > 0) s.compact();
    }
  }

  /** Global singleton, created from its defaults on first access. */
  resource<T>(type: ResourceType<T>): T {
    let v = this.resources.get(type);
    if (v === undefined) {
      v = type.create();
      this.resources.set(type, v);
    }
    return v as T;
  }

  /** Resources created so far, in creation order. */
  resourceList(): [ResourceType<unknown>, unknown][] {
    return [...this.resources];
  }

  emit<T>(type: EventType<T>, payload: T): void {
    this.queue(type).cur.push(payload);
  }

  /** Events emitted during the previous frame (each event is seen for exactly one frame). */
  events<T>(type: EventType<T>): readonly T[] {
    return this.queue(type).prev as T[];
  }

  /** Appends systems; they run in the order added. */
  addSystem(...systems: System[]): void {
    for (const s of systems) {
      if (this.systems.some((o) => o.name === s.name)) {
        throw new Error(`addSystem: a system named "${s.name}" is already scheduled`);
      }
      this.systems.push(s);
    }
  }

  /** Advances one fixed step: runs every system, then rotates event queues. */
  step(): void {
    for (const s of this.systems) s.run(this);
    for (const q of this.queues.values()) {
      const prev = q.prev;
      prev.length = 0;
      q.prev = q.cur;
      q.cur = prev;
    }
    this.frame++;
    this.time = this.frame * this.dt;
  }

  private store(type: ComponentType<unknown>): Store {
    if (type.kind !== 'component') {
      throw new Error(
        `"${(type as { name: string }).name}" is not a component; use world.resource()`,
      );
    }
    let s = this.stores.get(type);
    if (!s) {
      s = new Store();
      this.stores.set(type, s);
    }
    return s;
  }

  private queue(type: EventType<unknown>) {
    let q = this.queues.get(type);
    if (!q) {
      q = { cur: [], prev: [] };
      this.queues.set(type, q);
    }
    return q;
  }
}
