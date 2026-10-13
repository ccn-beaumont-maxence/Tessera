import { describe, expect, it } from 'vitest';
import { type Vec3, vec3 } from './math';
import { Rng } from './rng';
import { component, event, mut, resource, system, World } from './world';

const Pos = component('Pos', () => ({ p: vec3() }));
const Vel = component('Vel', () => ({ v: vec3() }));
const Health = component('Health', () => ({ value: 100 }));
const Score = resource('Score', () => ({ value: 0 }));
const Hit = event<{ target: number }>('Hit');

describe('entities and components', () => {
  it('spawns, adds, gets, removes, destroys', () => {
    const w = new World();
    const e = w.spawn('Player');
    expect(w.nameOf(e)).toBe('Player');
    expect(w.nameOf(999)).toBe('');
    const h = w.add(e, Health, { value: 80 });
    expect(h.value).toBe(80);
    expect(w.add(e, Pos).p).toEqual(vec3());
    expect(w.get(e, Health)).toBe(h);
    expect(w.has(e, Health)).toBe(true);
    expect(w.components(e).map(([t]) => t.name)).toEqual(['Health', 'Pos']);
    w.remove(e, Health);
    expect(w.has(e, Health)).toBe(false);
    expect(w.get(e, Vel)).toBeUndefined();
    w.destroy(e);
    w.destroy(e);
    expect(w.alive(e)).toBe(false);
    expect(w.has(e, Pos)).toBe(false);
    expect([...w.entities()]).toEqual([]);
    expect(() => w.add(e, Health)).toThrow('entity #1 does not exist');
  });

  it('replaces an existing component', () => {
    const w = new World();
    const e = w.spawn();
    w.add(e, Health, { value: 1 });
    w.add(e, Health, { value: 2 });
    expect(w.get(e, Health)?.value).toBe(2);
  });

  it('rejects resources used as components', () => {
    const w = new World();
    expect(() => w.each([Score as never], () => {})).toThrow('"Score" is not a component');
  });
});

describe('each', () => {
  it('visits only entities with all terms', () => {
    const w = new World();
    const a = w.spawn();
    const b = w.spawn();
    w.add(a, Pos);
    w.add(a, Vel);
    w.add(b, Pos);
    const seen: number[] = [];
    w.each([Pos, Vel], (e) => seen.push(e));
    expect(seen).toEqual([a]);
  });

  it('allows add/remove/destroy during iteration', () => {
    const w = new World();
    const ids = [1, 2, 3, 4].map(() => {
      const e = w.spawn();
      w.add(e, Health);
      return e;
    });
    const seen: number[] = [];
    w.each([Health], (e) => {
      seen.push(e);
      if (e === ids[0]) {
        w.destroy(ids[1] as number); // not yet visited: skipped
        w.remove(ids[2] as number, Health); // not yet visited: skipped
        w.add(w.spawn(), Health); // added mid-iteration: not visited
      }
      if (e === ids[3]) w.destroy(e);
    });
    expect(seen).toEqual([ids[0], ids[3]]);
    const after: number[] = [];
    w.each([Health], (e) => after.push(e));
    expect(after).toEqual([ids[0], 5]);
    expect(w.get(ids[0] as number, Health)?.value).toBe(100);
  });

  it('supports nested iteration', () => {
    const w = new World();
    for (let i = 0; i < 3; i++) w.add(w.spawn(), Health);
    let pairs = 0;
    w.each([Health], () => w.each([Health], () => pairs++));
    expect(pairs).toBe(9);
  });

  it('rejects empty or oversized queries', () => {
    const w = new World();
    expect(() => w.each([], () => {})).toThrow('expected 1 to 8');
    expect(() => w.each(Array(9).fill(Pos), () => {})).toThrow('got 9');
  });
});

describe('systems', () => {
  it('runs in order, declares access, moves entities', () => {
    const w = new World({ seed: 7 });
    const e = w.spawn();
    w.add(e, Pos);
    w.add(e, Vel, { v: vec3(60, 0, 0) });
    const order: string[] = [];
    const Move = system('Move', [mut(Pos), Vel], (world, _e, pos, vel) => {
      order.push('Move');
      vec3.add(pos.p, vec3.scale(vel.v, world.dt), pos.p);
    });
    const Log = system('Log', [Pos], () => order.push('Log'), { writes: [Score] });
    expect(Move.reads).toEqual([Vel]);
    expect(Move.writes).toEqual([Pos]);
    expect(Log.writes).toEqual([Score]);
    w.addSystem(Move, Log);
    w.step();
    w.step();
    expect(order).toEqual(['Move', 'Log', 'Move', 'Log']);
    expect(w.get(e, Pos)?.p.x).toBeCloseTo(2);
    expect(w.frame).toBe(2);
    expect(w.time).toBeCloseTo(2 / 60);
    expect(() => w.addSystem(Move)).toThrow('"Move" is already scheduled');
  });

  it('types non-mut terms as read-only', () => {
    system('ReadOnly', [Vel], (_w, _e, vel) => {
      // @ts-expect-error read-only term
      vel.v.x = 1;
      const v: Vec3 = vel.v; // still usable as an input
      return v;
    });
  });
});

describe('resources and events', () => {
  it('lazily creates resources', () => {
    const w = new World();
    w.resource(Score).value += 3;
    expect(w.resource(Score).value).toBe(3);
  });

  it('delivers events for exactly the next frame', () => {
    const w = new World();
    const got: number[][] = [];
    w.addSystem({
      name: 'Read',
      reads: [],
      writes: [],
      run: (world) => got.push(world.events(Hit).map((h) => h.target)),
    });
    w.emit(Hit, { target: 1 });
    w.step();
    w.emit(Hit, { target: 2 });
    w.step();
    w.step();
    expect(got).toEqual([[], [1], [2]]);
  });
});

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seq = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(seq);
    expect(new Rng(43).next()).not.toBe(seq[0]);
    expect(new Rng().next()).toBe(new Rng(1).next());
  });

  it('respects ranges', () => {
    const r = new Rng(3);
    for (let i = 0; i < 1000; i++) {
      const f = r.range(-2, 2);
      expect(f).toBeGreaterThanOrEqual(-2);
      expect(f).toBeLessThan(2);
      const n = r.int(1, 6);
      expect(Number.isInteger(n) && n >= 1 && n <= 6).toBe(true);
    }
    expect(['a', 'b']).toContain(r.pick(['a', 'b']));
    expect(() => r.pick([])).toThrow('empty array');
  });
});
