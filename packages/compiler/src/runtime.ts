import type { ComponentType, Entity, World } from '@tessera/core';

/** Value stored by a component/resource/event type. */
export type Value<T> = T extends { create(): infer R } ? R : never;

/** get<T>(e): the component, or a one-line error naming the entity. */
export function $get<T>(w: World, e: Entity, type: ComponentType<T>): T {
  const v = w.get(e, type);
  if (v === undefined) {
    const name = w.nameOf(e);
    const what = w.alive(e) ? `has no ${type.name}` : 'is destroyed or none';
    throw new Error(
      `get<${type.name}>(e): entity #${e}${name ? ` ${name}` : ''} ${what}; check has<${type.name}>(e) first`,
    );
  }
  return v;
}

/** Prefixes a runtime error with the .tess location being executed (once). */
export function $at(err: unknown, file: string, line: number): Error {
  const e = err instanceof Error ? err : new Error(String(err));
  if (!/\.tess:\d+/.test(e.message)) e.message = `${file}:${line}: ${e.message}`;
  return e;
}

/** raycast() result when nothing is hit: entity none. */
export const $noHit = (distance: number) => ({
  entity: 0,
  point: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 0 },
  distance,
});
