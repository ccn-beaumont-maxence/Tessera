import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { World } from '@tessera/core';
import { sceneGame } from '@tessera/scene';

/** Loads `<dir>/scene.yaml` with its game script swapped for `game.ts` or `game.tess`. */
export async function loadExample(
  dir: string,
  script: 'game.ts' | 'game.tess',
  seed = 1,
): Promise<World> {
  const game = await sceneGame(`${dir}/scene.yaml`, {
    read: async (p) => readFileSync(p, 'utf8').replace(/\.\/game\.(ts|tess)\b/, `./${script}`),
    load: (p) => import(/* @vite-ignore */ p),
    url: (p) => relative(process.cwd(), p),
  });
  const w = new World({ seed });
  await game.setup(w);
  return w;
}
