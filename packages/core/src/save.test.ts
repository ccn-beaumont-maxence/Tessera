import { describe, expect, it } from 'vitest';
import { load, save } from './save';

describe('save/load', () => {
  it('round-trips values and falls back on missing keys or other types', () => {
    expect(load('best', 0)).toBe(0);
    save('best', 42.5);
    save('name', 'ada');
    save('done', true);
    expect(load('best', 0)).toBe(42.5);
    expect(load('name', '')).toBe('ada');
    expect(load('done', false)).toBe(true);
    expect(load('name', 7)).toBe(7);
  });
});
