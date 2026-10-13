import type { World } from './world';

/** A game or scene entry point: `export default { dimension: '2d', setup(world) {...} }`. */
export interface Game {
  readonly dimension: '2d' | '3d';
  setup(world: World): void | Promise<void>;
}
