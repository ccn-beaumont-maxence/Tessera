import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { tess } from '@tessera/compiler/vite';
import { parseScene } from '@tessera/scene';
import { build } from 'vite';

const ASSET = /[\w./-]+\.(png|jpe?g|webp|gif|svg|gltf|glb|mp3|ogg|wav|m4a)\b/gi;

/** Module that starts a YAML scene with its files, scripts and assets bundled in. */
async function sceneMain(path: string, render: string, scene: string): Promise<string> {
  const files: Record<string, string> = {};
  const parsed = await parseScene(path, {
    read: async (p) => {
      files[p] = readFileSync(p, 'utf8');
      return files[p];
    },
    load: async () => ({}),
    url: (p) => p,
  });
  const assets = new Set<string>();
  for (const [file, text] of Object.entries(files)) {
    for (const m of text.matchAll(ASSET)) {
      const abs = resolve(dirname(file), m[0]);
      if (!/^[a-z]+:/i.test(m[0]) && existsSync(abs)) assets.add(abs);
    }
  }
  const lines = [
    `import { start } from ${JSON.stringify(render)};`,
    `import { sceneGame } from ${JSON.stringify(scene)};`,
  ];
  for (const [i, s] of parsed.scripts.entries())
    lines.push(`import * as s${i} from ${JSON.stringify(s)};`);
  for (const [i, a] of [...assets].entries())
    lines.push(`import a${i} from ${JSON.stringify(`${a}?url`)};`);
  lines.push(
    `const files = ${JSON.stringify(files)};`,
    `const scripts = { ${parsed.scripts.map((s, i) => `${JSON.stringify(s)}: s${i}`).join(', ')} };`,
    `const assets = { ${[...assets].map((a, i) => `${JSON.stringify(a)}: a${i}`).join(', ')} };`,
    'const io = { read: async (p) => files[p], load: async (p) => scripts[p], url: (p) => assets[p] ?? p };',
    `const game = await sceneGame(${JSON.stringify(path)}, io);`,
  );
  return lines.join('\n');
}

/** Bundles a game (scene .yaml or main .ts) into a static site in `outDir`. */
export async function buildGame(entry: string, outDir: string): Promise<void> {
  const path = resolve(entry);
  const require = createRequire(import.meta.url);
  const render = require.resolve('@tessera/render');
  const tmp = join(dirname(path), '.tess-build');
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  try {
    const head = /\.ya?ml$/.test(path)
      ? await sceneMain(path, render, require.resolve('@tessera/scene'))
      : `import { start } from ${JSON.stringify(render)};\nimport game from ${JSON.stringify(path)};`;
    writeFileSync(
      join(tmp, 'main.js'),
      `${head}\nwindow.tess = await start(game, { canvas: document.getElementById('c') });\nawait window.tess.ready;\nwindow.__tess = 'done';\n`,
    );
    writeFileSync(
      join(tmp, 'index.html'),
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tessera</title></head>
<body style="margin:0;overflow:hidden;background:#1b1d26"><canvas id="c" style="width:100vw;height:100vh;display:block"></canvas>
<script type="module" src="./main.js"></script></body></html>`,
    );
    await build({
      configFile: false,
      logLevel: 'error',
      root: tmp,
      base: './',
      plugins: [tess()],
      build: { outDir: resolve(outDir), emptyOutDir: true, target: 'es2022' },
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
