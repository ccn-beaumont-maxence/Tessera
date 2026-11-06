import type { World } from '@tessera/core';
import { parseScene, type SceneIO } from './parse';
import { reload, scenePaths } from './scene';

export { ASSET, mergeSpec, type Parsed, parseScene, type SceneIO, type Spec } from './parse';
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

/**
 * Re-applies scenes when one of their YAML files changes (`tess dev` sends `tess:yaml`): the
 * running scene, and the others listed under `scenes:` for the next loadScene().
 */
export function watch(world: World, path: string, io: SceneIO = browserIO): void {
  const hot = (import.meta as ImportMeta & { hot?: Hot }).hot;
  hot?.on('tess:yaml', async ({ file }) => {
    try {
      const paths = scenePaths(world);
      for (const p of paths.length > 0 ? paths : [path]) {
        const next = await parseScene(p, io);
        if (!next.files.includes(file)) continue;
        if (!reload(world, next)) return location.reload();
        console.info(`tess: applied ${file}`);
      }
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
    }
  });
}
