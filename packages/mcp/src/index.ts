import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { launch, pageUrl, serve } from '@tessera/cli';
import { z } from 'zod';

const INSTRUCTIONS = `Inspect and drive a running Tessera game. Call \`open\` first unless a game was given at startup.
Start with \`state\` (one line per entity: #id Name Component{non-default fields}; @Resource lines).
\`inspect\` shows every field of one entity. \`step\` pauses and advances N fixed frames (60/s).
\`set\` edits a component or resource field. \`input\` holds or releases an action or key.
\`logs\` returns console output and runtime errors (the game pauses itself on an error).
\`screenshot\` shows the current frame. \`reload\` restarts the game.`;

/** Page-side helpers, loaded as a module next to the game so they share its engine modules. */
const PAGE_OPS = (headless: string, input: string) => `
import * as h from '/@fs${headless}';
import * as input from '/@fs${input}';
const run = () => window.tess;
const world = () => run().world;
const fail = (m) => { throw new Error(m); };
const target = (w, a) => {
  if (a.resource) {
    const r = w.resourceList().find(([t]) => t.name === a.resource && !t.internal);
    return r ? r[1] : fail('no resource "' + a.resource + '" (have: ' + w.resourceList().filter(([t]) => !t.internal).map(([t]) => t.name).join(', ') + ')');
  }
  if (!w.alive(a.entity)) fail('entity #' + a.entity + ' does not exist');
  const c = w.components(a.entity).find(([t]) => t.name === a.component);
  return c ? c[1] : fail('#' + a.entity + ' has no ' + a.component + ' (has: ' + w.components(a.entity).map(([t]) => t.name).join(', ') + ')');
};
const state = (filter) => {
  const lines = h.dump(world()).split('\\n');
  const ents = lines.filter((l) => l.startsWith('#') && (!filter || l.includes(filter)));
  return ['paused: ' + run().paused, ...lines.filter((l) => !l.startsWith('#')), ...ents].join('\\n');
};
window.__mcp = {
  state: (a) => state(a.filter),
  inspect: (a) => {
    const w = world();
    if (!w.alive(a.entity)) fail('entity #' + a.entity + ' does not exist');
    return JSON.stringify({ id: a.entity, name: w.nameOf(a.entity), components: Object.fromEntries(w.components(a.entity).map(([t, v]) => [t.name, v])) });
  },
  set: (a) => {
    const w = world();
    const keys = a.field.split('.');
    let o = target(w, a);
    for (const k of keys.slice(0, -1)) o = o[k] !== null && typeof o[k] === 'object' ? o[k] : fail('no object field "' + k + '" in ' + a.field);
    const last = keys[keys.length - 1];
    if (!(last in o)) fail('no field "' + last + '" (fields: ' + Object.keys(o).join(', ') + ')');
    const v = a.value;
    if (Array.isArray(v) && o[last] !== null && typeof o[last] === 'object') Object.keys(o[last]).forEach((k, i) => { if (i < v.length) o[last][k] = v[i]; });
    else o[last] = v;
    return a.resource ? state('@') : h.dumpEntity(w, a.entity);
  },
  step: (a) => { run().paused = true; run().step(a.frames); return state(a.filter); },
  run: (a) => { run().paused = a.paused; return 'paused: ' + a.paused; },
  input: (a) => { (a.down ? input.press : input.release)(world(), a.name); return (a.down ? 'holding ' : 'released ') + a.name; },
};
window.__mcpReady = true;
`;

export interface TessServer {
  server: McpServer;
  close(): Promise<void>;
}

/**
 * MCP server driving a game (scene .yaml or game .ts) in Chromium, optionally visible.
 * Without `entry`, the agent picks the game with the `open` tool.
 */
export async function createTessServer(
  entry?: string,
  options: { headed?: boolean; seed?: number } = {},
): Promise<TessServer> {
  let path = entry ? resolve(entry) : null;
  const vite = await serve(entry ? dirname(resolve(entry)) : process.cwd());
  const browser = await launch(!options.headed);
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const require = createRequire(import.meta.url);
  const ops = PAGE_OPS(require.resolve('@tessera/headless'), require.resolve('@tessera/input'));
  let logs: string[] = [];
  page.on('console', (m) => {
    if (m.type() !== 'debug' && !m.text().startsWith('[vite]'))
      logs.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => logs.push(`error: ${e.message}`));

  const open = async () => {
    if (!path) throw new Error('no game open: call `open` with a scene .yaml or a main .ts path');
    await page.goto(pageUrl(vite, path, `&seed=${options.seed ?? 1}`));
    const status = await page
      .waitForFunction(() => (globalThis as { __tess?: string }).__tess, null, { timeout: 60_000 })
      .then((h) => h.jsonValue());
    if (status !== 'done') throw new Error(`game failed to start: ${status}`);
    await page.addScriptTag({ type: 'module', content: ops });
    await page.waitForFunction(() => (globalThis as { __mcpReady?: boolean }).__mcpReady);
  };
  if (path) await open();

  const op = async (name: string, args: Record<string, unknown>) => {
    if (!path) throw new Error('no game open: call `open` with a scene .yaml or a main .ts path');
    return page.evaluate(
      ([n, a]) => {
        const g = globalThis as unknown as { __mcp: Record<string, (a: unknown) => string> };
        return (g.__mcp[n as string] as (a: unknown) => string)(a);
      },
      [name, args] as const,
    );
  };
  const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

  const server = new McpServer(
    { name: 'tessera', version: '0.0.0' },
    { instructions: INSTRUCTIONS },
  );
  const entity = z.number().int().describe('entity id, the number after # in state lines');
  const filter = z.string().optional().describe('only entity lines containing this text');

  server.registerTool(
    'open',
    {
      description:
        'Start a game: path to a scene .yaml or a main .ts (relative to the project root).',
      inputSchema: { entry: z.string() },
    },
    async (a) => {
      path = resolve(a.entry);
      logs = [];
      await open();
      return text(await op('state', {}));
    },
  );
  server.registerTool(
    'state',
    {
      description: 'Frame, paused flag, resources and one line per entity (non-default fields).',
      inputSchema: { filter },
    },
    async (a) => text(await op('state', a)),
  );
  server.registerTool(
    'inspect',
    { description: 'Every component and field of one entity, as JSON.', inputSchema: { entity } },
    async (a) => text(await op('inspect', a)),
  );
  server.registerTool(
    'set',
    {
      description:
        'Set a field of an entity component (or of a resource). Vectors accept [x, y, z].',
      inputSchema: {
        entity: entity.optional(),
        component: z.string().optional().describe('e.g. Transform2D'),
        resource: z.string().optional().describe('e.g. Score (instead of entity/component)'),
        field: z.string().describe('dot path, e.g. position or position.x'),
        value: z.unknown().describe('JSON value'),
      },
    },
    async (a) => text(await op('set', a)),
  );
  server.registerTool(
    'step',
    {
      description: 'Pause, advance N fixed frames (60 per second), return the state.',
      inputSchema: { frames: z.number().int().min(1).max(36_000), filter },
    },
    async (a) => text(await op('step', a)),
  );
  server.registerTool(
    'run',
    { description: 'Pause or resume real-time play.', inputSchema: { paused: z.boolean() } },
    async (a) => text(await op('run', a)),
  );
  server.registerTool(
    'input',
    {
      description:
        'Hold (down=true) or release an input action (e.g. jump) or key code (e.g. ArrowLeft).',
      inputSchema: { name: z.string(), down: z.boolean() },
    },
    async (a) => text(await op('input', a)),
  );
  server.registerTool('screenshot', { description: 'PNG of the current frame.' }, async () => ({
    content: [
      {
        type: 'image' as const,
        data: (await page.screenshot()).toString('base64'),
        mimeType: 'image/png',
      },
    ],
  }));
  server.registerTool(
    'logs',
    { description: 'Console output and errors since the last call.' },
    async () => {
      const out = logs.join('\n') || '(no logs)';
      logs = [];
      return text(out);
    },
  );
  server.registerTool('reload', { description: 'Restart the game from its scene.' }, async () => {
    logs = [];
    await open();
    return text(await op('state', {}));
  });

  return {
    server,
    async close() {
      await server.close();
      await browser.close();
      await vite.close();
    },
  };
}
