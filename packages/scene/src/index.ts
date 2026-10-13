import type { World } from '@tessera/core';
import { parseScene, type SceneIO } from './parse';
import { currentScene, reload } from './scene';

export { mergeSpec, type Parsed, parseScene, type SceneIO, type Spec } from './parse';
export { build, currentScene, loadScene, reload, sceneGame, spawnPrefab } from './scene';

/** Browser IO through the Vite dev server (`/@fs` serves absolute paths). */
export const browserIO: SceneIO = {
  read: async (path) => {
    const res = await fetch(`/@fs${path}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
    return res.text();
  },
  load: (path) => import(/* @vite-ignore */ `/@fs${path}`),
  url: (path) => `/@fs${path}`,
};

type Hot = { on(event: string, cb: (data: { file: string }) => void): void };

/** Re-applies the scene when one of its YAML files changes (`tess dev` sends `tess:yaml`). */
export function watch(world: World, path: string, io: SceneIO = browserIO): void {
  const hot = (import.meta as ImportMeta & { hot?: Hot }).hot;
  hot?.on('tess:yaml', async ({ file }) => {
    try {
      const next = await parseScene(currentScene(world) ?? path, io);
      if (!next.files.includes(file)) return;
      if (!reload(world, next)) location.reload();
      else console.info(`tess: applied ${file}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  });
}
