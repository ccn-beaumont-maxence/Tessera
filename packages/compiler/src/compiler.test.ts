import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ComponentType,
  type System,
  Transform2D,
  Transform3D,
  vec2,
  World,
} from '@tessera/core';
import { afterAll, describe, expect, it } from 'vitest';
import { compile } from './index';

const err = (src: string) => {
  try {
    compile(src, 'game.tess');
  } catch (e) {
    return (e as Error).message;
  }
  return 'compiled';
};

describe('C++ reflexes', () => {
  it.each([
    ['#include "x.h"', 'game.tess:1:1: Tess has no #include'],
    ['system S(Health* h) {}', 'game.tess:1:16: Tess has no pointers: use `Health&`'],
    ['void f(Entity e) { e->x = 1; }', 'game.tess:1:21: Tess has no pointers: use `.`'],
    [
      'void f() { std::min(1, 2); }',
      'game.tess:1:12: Tess has no std::: use built-ins (std::min -> min',
    ],
    [
      'void f() { Entity e = new Enemy(); }',
      'game.tess:1:23: Tess has no `new`: use spawn("Prefab")',
    ],
    ['void f(Entity e) { delete e; }', 'Tess has no `delete`: use destroy(e)'],
    ['void f() { Entity e = nullptr; }', 'Tess has no nullptr: use `none`'],
    ['class Foo {}', 'Tess has no classes: use `component`'],
    ['struct Foo {}', 'Tess has no structs'],
    ['void f() { float x = Foo::bar; }', 'Tess has no `::`: use `.`'],
    ['void f(float x) { float y = &x; }', 'Tess has no address-of'],
    ['void f() { double d = 1; }', 'Tess has no double: use float'],
    ["void f() { log('a'); }", 'use double quotes'],
    ['void f() { float x = (float)1; }', 'use a function-style cast: float(x)'],
    ['void f() { int a = b[0]; }', 'Tess has no arrays'],
    ['template <T> void f() {}', 'Tess has no templates'],
  ])('%s', (src, msg) => {
    expect(err(src)).toContain(msg);
  });
});

describe('type errors', () => {
  it.each([
    [
      'component H { float v; }\nsystem S(H h) { h.v = 1; }',
      'game.tess:2:17: cannot write "h.v": "h" is read-only; declare it "H& h"',
    ],
    ['system S(Transform2D t) { t.position = vec2(1, 2); }', 'declare it "Transform2D& t"'],
    ['void f() { float x = y; }', 'unknown name "y"'],
    ['void f() { float speed = 1; float x = sped; }', 'unknown name "sped" (did you mean speed?)'],
    ['void f() { vec3 v = vec2(1, 2); }', 'expected vec3, got vec2'],
    ['void f() { lenn(vec2(1, 2)); }', 'unknown function "lenn" (did you mean len?)'],
    [
      'component H { float v; }\nvoid f(Entity e) { get<H>(e).vv = 1; }',
      'H has no field "vv" (did you mean v?)',
    ],
    ['void f() { Floot x = 1; }', 'unknown type "Floot" (did you mean float?)'],
    ['void f() { if (vec2(1, 2)) {} }', 'condition must be bool, got vec2'],
    ['void f() { break; }', '`break` outside of a loop'],
    [
      'component H { float v; }\nsystem S(H h) { for (H o : query) { break; } }',
      '`break` cannot leave a query loop',
    ],
    [
      'component H { float v; }\nsystem S(H h) { for (H o : query) { return; } }',
      '`return` inside a query loop',
    ],
    ['float f() { return; }', 'return a float'],
    ['void f() { return 1; }', 'returns nothing'],
    ['system S(Entity e) {}', '`Entity` needs at least one component parameter'],
    ['event Hit { Entity t; }\nsystem S(Hit h) {}', 'must be Entity, a component or a resource'],
    ['void f() { vec2 a = vec2(1, 2) == vec2(1, 2); }', 'compare vec2 fields instead'],
    ['void f() { spawn(1); }', 'spawn needs a prefab name'],
    ['void f() { spawn("A", 3); }', 'spawn overrides are component literals'],
    ['void f() { emit(3); }', 'emit takes one event literal'],
    ['void f() { auto x; }', '`auto` needs an initializer'],
    ['component H { float v; }\ncomponent H { float v; }', '"H" is already defined'],
    ['void f() { float x = 1; float x = 2; }', '"x" is already declared'],
    ['void f() { random(1); }', 'random() takes 0 or 2 arguments'],
    ['void f() { sqrt(1, 2); }', 'sqrt() takes 1 argument, got 2'],
    ['void f() { get(1); }', 'get needs a type'],
    [
      'void f() { Entity e = none; Transform2D t = get<Transform2D>(e); t.rotation = 1; }',
      'declare it "Transform2D& t"',
    ],
    ['void f() { float x = "a" * 2; }', 'string * int is not supported'],
    [
      'void g(Transform2D& t) {}\nsystem S(Transform2D t) { g(t); }',
      '"t" is Transform2D& but this argument is read-only',
    ],
    ['void f() { float x = 1 } ', 'expected ";"'],
    ['component C { float v = dt; }', 'dt is not available in defaults'],
  ])('%s', (src, msg) => {
    expect(err(src)).toContain(msg);
  });
});

// Compiled modules are imported through the Vite .tess plugin, like games are.
const dir = join(import.meta.dirname, '../.tmp');
let n = 0;
async function load(src: string): Promise<Record<string, unknown>> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `t${n++}.tess`);
  writeFileSync(file, src);
  return import(/* @vite-ignore */ file);
}
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const sys = (m: Record<string, unknown>, name: string) => m[name] as System;
const comp = (m: Record<string, unknown>, name: string) =>
  m[name] as ComponentType<Record<string, unknown>>;

describe('generated code', () => {
  it('runs vector math without allocating new vectors', async () => {
    const m = await load(`
component Vel { vec2 v = vec2(3, 4); float k = 2; }
resource Stats { float len; int n; }
system Move(Transform2D& t, Vel vel, Stats& s) {
    t.position += vel.v * dt * 60;
    vec2 d = normalize(vel.v) * vel.k;
    t.position = t.position + d - vec2(d.x, d.y);
    s.len = len(vel.v);
    s.n++;
    t.rotation = dot(vel.v, normalize(vel.v)) + int(7 / 2);
}
`);
    const w = new World();
    const e = w.spawn();
    w.add(e, Transform2D);
    w.add(e, comp(m, 'Vel'));
    w.addSystem(sys(m, 'Move'));
    w.step();
    const pos = w.get(e, Transform2D)?.position ?? vec2();
    expect([pos.x, pos.y].map((x) => x.toFixed(9))).toEqual(['3.000000000', '4.000000000']);
    expect(w.get(e, Transform2D)?.rotation).toBeCloseTo(8);
    expect(w.resourceList().map(([t, v]) => [t.name, v])).toEqual([['Stats', { len: 5, n: 1 }]]);
  });

  it('handles quaternions, colors, functions, consts and queries', async () => {
    const m = await load(`
const vec3 UP = vec3(0, 1, 0);
component Tint { color c = color("#ff0000"); quat q = euler(0, 1.5707963267948966, 0); }
resource Out { vec3 fwd; float r; int count; float l; }
vec3 turn(quat q, vec3 v) { return q * v; }
float twice(float x) { return x * 2; }
system Q(Tint t, Out& o) {
    o.fwd = turn(t.q, vec3(0, 0, -1));
    o.r = t.c.r + lerp(0, 10, 0.5) + twice(1);
    quat q2 = t.q * axisAngle(UP, 0);
    o.l = len(cross(vec3(1, 0, 0), vec3(0, 1, 0))) + dist(vec3(0, 0, 0), q2 * vec3(1, 0, 0));
    int count = 0;
    for (Entity e, Tint other : query) { if (e == none) continue; count++; }
    for (int i = 0; i < 3; i++) { if (i == 1) continue; count += 10; }
    while (count > 100) { count--; }
    o.count = count > 0 ? count : -count;
}
`);
    const w = new World();
    w.add(w.spawn(), comp(m, 'Tint'));
    w.add(w.spawn(), comp(m, 'Tint'));
    w.addSystem(sys(m, 'Q'));
    w.step();
    const out = w.resourceList()[0]?.[1] as {
      fwd: { x: number };
      r: number;
      count: number;
      l: number;
    };
    expect(out.fwd.x).toBeCloseTo(-1);
    expect(out.r).toBeCloseTo(8);
    expect(out.count).toBe(22);
    expect(out.l).toBeCloseTo(2);
  });

  it('emits events, spawns nothing without a scene, and reports runtime errors at the .tess line', async () => {
    const m = await load(`component Coin { int value = 1; }
event Picked { Entity who; vec2 at; }
resource Log { int picked; }
system Pick(Entity e, Coin c) {
    emit(Picked { who = e, at = vec2(1, 2) });
}
system Count(Log& log) {
    for (Picked p : events<Picked>()) { log.picked += 1; }
}
system Crash(Entity e, Coin c) {
    float v = get<Transform3D>(e).position.x;
}
`);
    const w = new World();
    const e = w.spawn('Gold');
    w.add(e, comp(m, 'Coin'));
    w.addSystem(sys(m, 'Pick'), sys(m, 'Count'));
    w.step();
    w.step();
    expect(w.resourceList()[0]?.[1]).toEqual({ picked: 1 });
    w.addSystem(sys(m, 'Crash'));
    expect(() => w.step()).toThrow(
      /t\d+\.tess:11: get<Transform3D>\(e\): entity #1 Gold has no Transform3D; check has<Transform3D>\(e\) first/,
    );
    expect(Transform3D.name).toBe('Transform3D');
  });
});

describe('using', () => {
  const files: Record<string, string> = {
    'lib.tess':
      'const float K = 2;\ncomponent Hp { float v = 10; }\nevent Hit { Entity t; }\nfloat twice(float x) { return x * K; }',
    'a.tess': 'using "./b.tess";',
    'b.tess': 'using "./game.tess";',
    'dup.tess': 'component Hp { float v; }',
  };
  const read = (f: string) => {
    const src = files[f];
    if (src === undefined) throw new Error('ENOENT');
    return src;
  };
  const err = (src: string) => {
    try {
      compile(src, 'game.tess', read);
    } catch (e) {
      return (e as Error).message;
    }
    return 'compiled';
  };

  it.each([
    ['using "./lib.tess";\nsystem S(Hp& h) { h.v = twice(h.v) + K; }', 'compiled'],
    ['using "./nope.tess";', 'game.tess:1:1: cannot read nope.tess'],
    ['using "./lib.ts";', '`using` takes a .tess file'],
    ['using "./a.tess";', 'circular using: game.tess -> a.tess -> b.tess -> game.tess'],
    ['using "./game.tess";', 'a file cannot use itself'],
    [
      'using "./lib.tess";\nusing "./dup.tess";',
      '"Hp" is defined in both ./lib.tess and ./dup.tess',
    ],
    ['using "./lib.tess";\ncomponent Hp { float v; }', '"Hp" is already defined in ./lib.tess'],
    ['using namespace std;', 'Tess `using` takes a file: using "./other.tess";'],
  ])('%s', (src, msg) => {
    expect(err(src)).toContain(msg);
  });

  it('shares components, events, functions and constants across files', async () => {
    writeFileSync(
      join(dir, 'shared.tess'),
      'const float K = 3;\ncomponent Hp { float v = 10; }\nevent Hit { Entity t; float dmg = 1; }\nfloat hurt(float v, float d) { return v - d * K; }\n',
    );
    const m = await load(`
using "./shared.tess";
system Fire(Entity e, Hp h) { emit(Hit { t = e, dmg = 2 }); }
system Apply(Hp& h) { for (Hit x : events<Hit>()) h.v = hurt(h.v, x.dmg); }
`);
    expect(m.Hp, 'used declarations are re-exported for the scene').toBeDefined();
    const w = new World();
    w.add(w.spawn(), comp(m, 'Hp'));
    w.addSystem(sys(m, 'Fire'));
    w.addSystem(sys(m, 'Apply'));
    w.step();
    w.step();
    expect(w.components(1).find(([t]) => t.name === 'Hp')?.[1]).toEqual({ v: 4 });
  });
});
