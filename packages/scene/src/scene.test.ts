import {
  component,
  mut,
  Parent,
  resource,
  Strings,
  system,
  Transform2D,
  tr,
  World,
} from '@tessera/core';
import { dump, find } from '@tessera/headless';
import { isDown, press } from '@tessera/input';
import { RigidBody } from '@tessera/physics';
import { Sprite } from '@tessera/render';
import { describe, expect, it } from 'vitest';
import { parseScene, type SceneIO } from './parse';
import { build, currentScene, loadScene, reload, sceneGame, spawnPrefab } from './scene';

const Speed = component('Speed', () => ({ value: 1 }));
const Score = resource('Score', () => ({ value: 0, best: 0 }));
const order: string[] = [];
const Walk = system('Walk', [mut(Transform2D), Speed], (w, _e, t, s) => {
  order.push('Walk');
  t.position.x += s.value * w.dt;
});
const script = { Speed, Score, Walk, helper: 42 };

function memoryIO(files: Record<string, string>): SceneIO {
  return {
    read: async (p) => {
      const f = files[p];
      if (f === undefined) throw new Error(`no file ${p}`);
      return f;
    },
    load: async (p) => {
      if (p !== '/game/game.ts') throw new Error('not found');
      return script;
    },
    url: (p) => `url:${p}`,
  };
}

const SCENE = `dimension: 2d
scripts: [./game.ts]
systems: [Walk]
input: ./input.yaml
resources:
  Score: { best: 10 }
prefabs:
  Coin: ./coin.yaml
  Wall: { Transform2D: {}, Collider: { size: [4, 1, 1] } }
entities:
  - name: Hero
    Transform2D: { position: [1, 2], rotation: 0.5 }
    Sprite: { image: ./hero.png, color: '#ff0000', columns: 4 }
    SpriteAnimation: { frames: [0, 1] }
    Speed: { value: 60 }
  - name: Coin
    prefab: Coin
    Transform2D: { position: [3, 0] }
  - prefab: Wall
`;
const files = {
  '/game/scene.yaml': SCENE,
  '/game/input.yaml': 'jump: [Space]\n',
  '/game/coin.yaml': 'Transform2D: {}\nSprite: { color: [1, 1, 0], size: [0.5, 0.5] }\n',
};

async function load(over: Record<string, string> = {}) {
  const io = memoryIO({ ...files, ...over });
  const w = new World();
  await build(w, await parseScene('/game/scene.yaml', io), io);
  return { w, io };
}

describe('scene', () => {
  it('builds entities, prefabs, resources and systems from YAML', async () => {
    const { w } = await load();
    const hero = find(w, 'Hero');
    expect(w.get(hero, Transform2D)).toEqual({
      position: { x: 1, y: 2 },
      rotation: 0.5,
      scale: { x: 1, y: 1 },
    });
    const s = w.get(hero, Sprite);
    expect(s?.image).toBe('url:/game/hero.png');
    expect(s?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
    expect(w.get(find(w, 'Coin'), Sprite)?.size).toEqual({ x: 0.5, y: 0.5 });
    expect(w.get(find(w, 'Coin'), Transform2D)?.position).toEqual({ x: 3, y: 0 });
    expect(w.resource(Score)).toEqual({ value: 0, best: 10 });
    order.length = 0;
    press(w, 'jump');
    w.step();
    expect(isDown(w, 'jump')).toBe(true);
    expect(order).toEqual(['Walk']);
    expect(w.get(hero, Transform2D)?.position.x).toBeCloseTo(2);
  });

  it('loads strings: tables for tr(), from files or inline', async () => {
    const { w } = await load({
      '/game/scene.yaml': `${SCENE}strings: { ja: ./ja.yaml, ko: { Hello: 안녕 } }\n`,
      '/game/ja.yaml': '"Coins {0}": "コイン {0}"\n',
    });
    expect(w.resource(Strings).lang).toBe('');
    w.resource(Strings).lang = 'ja';
    expect(tr(w, 'Coins {0}', 3)).toBe('コイン 3');
    w.resource(Strings).lang = 'ko';
    expect(tr(w, 'Hello')).toBe('안녕');
    await expect(
      load({ '/game/scene.yaml': `${SCENE}strings: { ja: { a: [1] } }\n` }),
    ).rejects.toThrow('/game/scene.yaml:20: strings ja: map each source text to its translation');
  });

  it('converts 3D rotations and passes through absolute URLs', async () => {
    const io = memoryIO({
      '/s.yaml': `dimension: 3d
entities:
  - Transform3D: { rotation: [0, 0, 0], position: [1, 2, 3] }
    Mesh: { model: http://x/a.glb, color: [0.5, 0.5, 0.5, 0.5] }
`,
    });
    const game = await sceneGame('/s.yaml', io);
    expect(game.dimension).toBe('3d');
    const w = new World();
    await game.setup(w);
    expect(dump(w)).toContain('Transform3D{position:(1,2,3)}');
    expect(dump(w)).toContain('model:"http://x/a.glb"');
  });

  it('reports file:line errors with suggestions', async () => {
    const bad = async (scene: string, extra: Record<string, string> = {}) => {
      try {
        await load({ '/game/scene.yaml': scene, ...extra });
      } catch (e) {
        return (e as Error).message;
      }
      return 'no error';
    };
    const head = 'dimension: 2d\nentities:\n';
    expect(await bad(`${head}  - Transfrom2D: {}\n`)).toBe(
      '/game/scene.yaml:3: unknown component "Transfrom2D" (did you mean Transform2D?)',
    );
    expect(await bad(`${head}  - Nothing: {}\n`)).toContain(
      'export it from a file listed in `scripts`',
    );
    expect(await bad(`${head}  - Transform2D: { position: [1] }\n`)).toBe(
      '/game/scene.yaml:3: Transform2D.position expects [x, y], got [1]',
    );
    expect(await bad(`${head}  - Transform2D:\n      postion: [1, 2]\n`)).toBe(
      '/game/scene.yaml:4: unknown field "postion" in Transform2D (did you mean position?) (fields: position, rotation, scale)',
    );
    expect(await bad(`${head}  - Sprite: { color: 3 }\n`)).toContain(
      'expects "#rrggbb" or [r, g, b, a]',
    );
    expect(await bad(`${head}  - Sprite: { layer: up }\n`)).toContain(
      'Sprite.layer expects a number',
    );
    expect(await bad(`${head}  - Sprite: { flipX: 1 }\n`)).toContain('expects true or false');
    expect(await bad(`${head}  - Sprite: { image: 3 }\n`)).toContain('expects a string');
    expect(await bad(`${head}  - SpriteAnimation: { frames: 3 }\n`)).toContain('expects a list');
    expect(await bad(`${head}  - Transform2D: { position: 3 }\n`)).toContain('expects { x, y }');
    expect(await bad(`${head}  - Transform2D: { position: [a, b] }\n`)).toContain(
      'expects numbers',
    );
    expect(await bad(`${head}  - Transform3D: { rotation: [1, 2] }\n`)).toContain(
      '[rx, ry, rz] radians',
    );
    expect(await bad(`prefabs: { Coin: ./coin.yaml }\n${head}  - prefab: Coni\n`)).toContain(
      'unknown prefab "Coni" (did you mean Coin?)',
    );
    expect(await bad(`${head}  - 3\n`)).toContain('each entity is a map');
    expect(await bad(`${head}  - name: 3\n`)).toContain('name must be a string');
    expect(await bad(`${head}  - Sprite: 3\n`)).toContain('Sprite must be a map of fields');
    expect(await bad('dimension: 4d\n')).toBe('/game/scene.yaml:1: dimension must be 2d or 3d');
    expect(await bad('dimension: 2d\nentites: []\n')).toContain('unknown key "entites"');
    expect(await bad('dimension: 2d\nsystems: Walk\n')).toContain('systems must be a list');
    expect(await bad('dimension: 2d\nsystems: [Wlak]\nscripts: [game.ts]\n')).toBe(
      '/game/scene.yaml:2: unknown system "Wlak" (did you mean Walk?)',
    );
    expect(await bad('dimension: 2d\nscripts: [nope.ts]\n')).toContain('cannot load /game/nope.ts');
    expect(await bad('dimension: 2d\nresources: { Scor: {} }\nscripts: [game.ts]\n')).toContain(
      'unknown resource "Scor" (did you mean Score?)',
    );
    expect(await bad('dimension: 2d\ninput: 3\n')).toContain('input must map');
    expect(await bad('dimension: 2d\nphysics: 3\n')).toContain('physics must be a map');
    expect(await bad('dimension: 2d\nresources: 3\n')).toContain('resources must map');
    expect(await bad('dimension: 2d\nprefabs: 3\n')).toContain('prefabs must map');
    expect(await bad('dimension: 2d\nentities: 3\n')).toContain('entities must be a list');
    expect(await bad('- 3\n')).toContain('a scene is a map');
    expect(await bad('a: [\n')).toMatch(/^\/game\/scene\.yaml:\d+: /);
  });

  it('applies YAML edits to a running world, keeping untouched runtime state', async () => {
    const { w, io } = await load();
    const hero = find(w, 'Hero');
    w.step();
    const x = w.get(hero, Transform2D)?.position.x;
    const edited = SCENE.replace('rotation: 0.5', 'rotation: 1')
      .replace('Speed: { value: 60 }', '')
      .replace('  - prefab: Wall\n', '  - name: Extra\n    Transform2D: {}\n')
      .replace('best: 10', 'best: 20');
    const ok = reload(
      w,
      await parseScene('/game/scene.yaml', memoryIO({ ...files, '/game/scene.yaml': edited })),
    );
    expect(ok).toBe(true);
    const t = w.get(hero, Transform2D);
    expect(t?.rotation).toBe(1);
    expect(t?.position.x).toBe(x);
    expect(w.has(hero, Speed)).toBe(false);
    expect(w.alive(find(w, 'Extra'))).toBe(true);
    expect(w.resource(Score).best).toBe(20);
    expect(dump(w)).not.toContain('Collider');

    const prefabEdit = {
      ...files,
      '/game/coin.yaml': 'Transform2D: {}\nSprite: { layer: 3 }\nRigidBody: {}\n',
    };
    expect(reload(w, await parseScene('/game/scene.yaml', memoryIO(prefabEdit)))).toBe(true);
    const coin = w.get(find(w, 'Coin'), Sprite);
    expect([coin?.layer, coin?.size]).toEqual([3, { x: 1, y: 1 }]);
    expect(w.has(find(w, 'Coin'), RigidBody)).toBe(true);
    w.destroy(find(w, 'Coin'));
    expect(reload(w, await parseScene('/game/scene.yaml', memoryIO(prefabEdit)))).toBe(true);
    expect(w.alive(find(w, 'Coin'))).toBe(true);

    const restart = SCENE.replace('systems: [Walk]', 'systems: []');
    expect(
      reload(
        w,
        await parseScene('/game/scene.yaml', memoryIO({ ...files, '/game/scene.yaml': restart })),
      ),
    ).toBe(false);
    expect(() => reload(new World(), {} as never)).toThrow('needs a world built by build()');
    void io;
  });

  it('links children to their parent and reloads them', async () => {
    const scene = `dimension: 2d
entities:
  - name: Ship
    Transform2D: { position: [5, 0] }
    children:
      - name: Gun
        Transform2D: { position: [1, 0] }
        children: [{ Transform2D: {} }]
`;
    const { w } = await load({ '/game/scene.yaml': scene });
    const ship = find(w, 'Ship');
    const gun = find(w, 'Gun');
    expect(w.get(gun, Parent)?.entity).toBe(ship);
    expect(dump(w)).toContain(`Parent{entity:${gun}}`);
    const edited = scene.replace('[1, 0]', '[2, 0]');
    expect(
      reload(
        w,
        await parseScene('/game/scene.yaml', memoryIO({ ...files, '/game/scene.yaml': edited })),
      ),
    ).toBe(true);
    expect(w.get(gun, Transform2D)?.position.x).toBe(2);
    const bad = 'dimension: 2d\nentities:\n  - name: A\n    children: 3\n';
    await expect(load({ '/game/scene.yaml': bad })).rejects.toThrow(
      'scene.yaml:4: children must be a list',
    );
  });

  it('switches scenes at the end of the step, keeping chosen resources', async () => {
    const level2 =
      'dimension: 2d\nscripts: [./game.ts]\nsystems: [Walk]\nentities:\n  - { name: Boss, Transform2D: {}, Speed: {} }\n';
    const { w } = await load({
      '/game/scene.yaml': SCENE.replace(
        'systems: [Walk]',
        'scenes: [./level2.yaml]\nsystems: [Walk]',
      ),
      '/game/level2.yaml': level2,
    });
    w.resource(Score).value = 7;
    loadScene(w, 'level2.yaml', [Score]);
    expect(find(w, 'Hero')).toBeGreaterThan(0);
    w.step();
    expect(() => find(w, 'Hero')).toThrow();
    expect(currentScene(w)).toBe('/game/level2.yaml');
    expect(w.resource(Score).value).toBe(7);
    w.step();
    expect(w.get(find(w, 'Boss'), Transform2D)?.position.x).toBeCloseTo(1 / 60);
    loadScene(w, './scene.yaml');
    w.step();
    expect(w.resource(Score)).toEqual({ value: 0, best: 10 });
    expect(find(w, 'Hero')).toBeGreaterThan(0);
    expect(() => loadScene(w, 'nope.yaml')).toThrow(
      'loadScene("nope.yaml"): unknown scene; list it under `scenes:` in the first scene (loaded: scene.yaml, level2.yaml)',
    );
    await expect(
      load({
        '/game/scene.yaml': 'dimension: 2d\nscenes: [./b.yaml]\n',
        '/game/b.yaml': 'dimension: 3d\n',
      }),
    ).rejects.toThrow('scene.yaml:2: /game/b.yaml is 3d, scenes must all be 2d');
  });

  it('spawns prefabs at runtime with overrides', async () => {
    const { w } = await load();
    const e = spawnPrefab(w, 'Coin', { Transform2D: { position: [9, 9] }, Speed: { value: 2 } });
    expect(w.nameOf(e)).toBe('Coin');
    expect(w.get(e, Transform2D)?.position).toEqual({ x: 9, y: 9 });
    expect(w.get(e, Speed)?.value).toBe(2);
    const red = { r: 1, g: 0, b: 0, a: 1 };
    expect(w.get(spawnPrefab(w, 'Coin', { Sprite: { color: red } }), Sprite)?.color).toEqual(red);
    expect(() => spawnPrefab(w, 'Con')).toThrow('unknown prefab "Con" (did you mean Coin?)');
    expect(() => spawnPrefab(new World(), 'Coin')).toThrow('no scene loaded');
  });
});
