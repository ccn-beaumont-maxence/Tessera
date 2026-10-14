import { color } from './math';
import { component } from './world';

/**
 * Grid of tiles drawn as one mesh, Transform2D position = top-left corner. `tiles` are rows
 * (top first) of characters: the i-th character of `chars` draws spritesheet frame i of
 * `image` (or a `color` square without image); other characters are empty. Tiles collide
 * (merged into few static boxes) unless their character is in `passable`.
 */
export const Tilemap = component('Tilemap', () => ({
  tiles: [] as string[],
  chars: '#',
  passable: '',
  size: 1,
  image: '',
  columns: 1,
  rows: 1,
  color: color(),
  layer: 0,
  friction: 0.5,
}));

export type TilemapData = ReturnType<typeof Tilemap.create>;

/** A box of tiles: column, row (top-left) and size in tiles. */
export interface TileRect {
  col: number;
  row: number;
  w: number;
  h: number;
}

/** Solid tiles merged greedily into rectangles (widest run first, then grown downwards). */
export function tileRects(map: {
  readonly tiles: readonly string[];
  readonly chars: string;
  readonly passable: string;
}): TileRect[] {
  const solid = (r: number, c: number) => {
    const ch = map.tiles[r]?.[c];
    return ch !== undefined && map.chars.includes(ch) && !map.passable.includes(ch);
  };
  const used = new Set<number>();
  const width = Math.max(0, ...map.tiles.map((t) => t.length));
  const free = (r: number, c: number) => solid(r, c) && !used.has(r * width + c);
  const out: TileRect[] = [];
  for (let row = 0; row < map.tiles.length; row++) {
    for (let col = 0; col < width; col++) {
      if (!free(row, col)) continue;
      let w = 1;
      while (free(row, col + w)) w++;
      let h = 1;
      const rowFree = (r: number) => {
        for (let c = col; c < col + w; c++) if (!free(r, c)) return false;
        return true;
      };
      while (row + h < map.tiles.length && rowFree(row + h)) h++;
      for (let r = row; r < row + h; r++)
        for (let c = col; c < col + w; c++) used.add(r * width + c);
      out.push({ col, row, w, h });
    }
  }
  return out;
}
