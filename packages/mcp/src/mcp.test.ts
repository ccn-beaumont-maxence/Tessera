import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTessServer, type TessServer } from './index';

// A copy of the platformer with a planted bug: enemies never turn back left.
const dir = resolve(import.meta.dirname, '../.tmp/buggy');
let tess: TessServer;
const client = new Client({ name: 'test', version: '0' });

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const first = (res.content as { type: string; text?: string; data?: string }[])[0];
  if (res.isError) throw new Error(first?.text);
  return first?.type === 'text' ? (first.text as string) : (first?.data as string);
};

beforeAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  cpSync(resolve(import.meta.dirname, '../../../examples/platformer'), dir, { recursive: true });
  const game = join(dir, 'game.tess');
  writeFileSync(game, readFileSync(game, 'utf8').replace('en.dir = -1;', 'en.dir = 1;'));
  tess = await createTessServer(join(dir, 'scene.yaml'));
  const [a, b] = InMemoryTransport.createLinkedPair();
  await tess.server.connect(a);
  await client.connect(b);
}, 60_000);

afterAll(async () => {
  await client.close();
  await tess.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('tess-mcp', () => {
  it('lists the tools', async () => {
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'input',
      'inspect',
      'logs',
      'reload',
      'run',
      'screenshot',
      'set',
      'state',
      'step',
    ]);
  });

  it('finds a patrol bug using only MCP tools', async () => {
    await call('run', { paused: true });
    const before = await call('state', { filter: 'Slime1' });
    expect(before).toMatch(/^paused: true\nframe \d+\n@Score\{\}\n#\d+ Slime1 /);
    const id = Number(/#(\d+) Slime1/.exec(before)?.[1]);
    await call('step', { frames: 300 });
    const enemy = JSON.parse(await call('inspect', { entity: id }));
    const { range, startX, dir: walking } = enemy.components.Enemy;
    // Diagnosis: after 5 s the enemy is far outside startX ± range and still walking right.
    expect(enemy.components.Transform2D.position.x - startX).toBeGreaterThan(range * 2);
    expect(walking).toBe(1);
  });

  it('edits state, simulates input and shows the result', async () => {
    const player = Number(/#(\d+) Player/.exec(await call('state', { filter: 'Player' }))?.[1]);
    expect(
      await call('set', {
        entity: player,
        component: 'Transform2D',
        field: 'position',
        value: [17.5, -2],
      }),
    ).toContain('Transform2D{position:(17.5,-2)}');
    expect(await call('step', { frames: 60 })).toContain('@Score{deaths:1}');
    await call('set', { resource: 'Score', field: 'coins', value: 5 });
    await call('input', { name: 'move', down: true });
    const moved = await call('step', { frames: 30, filter: 'Player' });
    expect(Number(/Player Transform2D\{position:\(([\d.]+)/.exec(moved)?.[1])).toBeGreaterThan(1);
    expect(moved).toMatch(/@Score\{coins:\d+ deaths:1\}/);
    expect((await call('screenshot')).length).toBeGreaterThan(1000);
  });

  it('reports runtime errors and pauses the game', async () => {
    const player = Number(/#(\d+) Player/.exec(await call('state', { filter: 'Player' }))?.[1]);
    await call('set', { entity: player, component: 'RigidBody', field: 'type', value: 'static' });
    await call('run', { paused: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(await call('logs')).toContain('unknown type "static" (use dynamic, fixed, kinematic)');
    expect(await call('state', { filter: 'none' })).toMatch(/^paused: true/);
    await expect(call('inspect', { entity: 9999 })).rejects.toThrow('entity #9999 does not exist');
    await expect(
      call('set', { entity: player, component: 'Nope', field: 'x', value: 1 }),
    ).rejects.toThrow('has no Nope');
    expect(await call('reload')).toContain('@Score{}');
    expect(await call('logs')).toBe('(no logs)');
  });
});
