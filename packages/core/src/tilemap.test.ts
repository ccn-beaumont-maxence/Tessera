import { describe, expect, it } from 'vitest';
import { Tilemap, tileRects } from './tilemap';

describe('tileRects', () => {
  it('merges solid tiles into few rectangles and skips passable ones', () => {
    const map = Object.assign(Tilemap.create(), {
      chars: '#=~',
      passable: '~',
      tiles: ['#..==', '#..==', '#####', '~~~~~'],
    });
    expect(tileRects(map)).toEqual([
      { col: 0, row: 0, w: 1, h: 3 },
      { col: 3, row: 0, w: 2, h: 3 },
      { col: 1, row: 2, w: 2, h: 1 },
    ]);
  });
});
