import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export type { GLTF };

const cache = new Map<string, Promise<unknown>>();
const inflight = new Set<Promise<unknown>>();

/** Loads once per key; later calls share the same promise. Errors name the URL. */
export function load<T>(key: string, loader: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = loader().catch((err: unknown) => {
      cache.delete(key);
      throw new Error(`asset "${key}": ${err instanceof Error ? err.message : String(err)}`);
    });
    cache.set(key, p);
    const settled = p.catch(() => {});
    inflight.add(settled);
    settled.finally(() => inflight.delete(settled));
  }
  return p;
}

/** Resolves once every load started so far has settled (including ones started meanwhile). */
export async function loaded(): Promise<void> {
  while (inflight.size > 0) await Promise.all(inflight);
}

/** sRGB texture with nearest filtering (pixel art friendly). Clone it to change repeat/offset. */
export const loadTexture = (url: string) =>
  load(`texture:${url}`, async () => {
    const tex = await new THREE.TextureLoader().loadAsync(url);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    return tex;
  });

/** glTF / GLB model. Clone `scene` before adding it to a scene graph. */
export const loadModel = (url: string) =>
  load(`model:${url}`, () => new GLTFLoader().loadAsync(url));

export const loadText = (url: string) =>
  load(`text:${url}`, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  });

export const loadSound = (url: string, ctx: BaseAudioContext) =>
  load(`sound:${url}`, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return ctx.decodeAudioData(await res.arrayBuffer());
  });

/** Forget cached entries (all, or those whose URL contains `match`), e.g. after a file changed. */
export function invalidate(match?: string): void {
  for (const key of cache.keys()) if (!match || key.includes(match)) cache.delete(key);
}
