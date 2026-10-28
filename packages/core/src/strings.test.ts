import { describe, expect, it } from 'vitest';
import { Strings, tr } from './strings';
import { World } from './world';

describe('tr', () => {
  it('translates with the current language and fills {n} placeholders', () => {
    const w = new World();
    w.resource(Strings).tables = {
      ja: { 'Wisps {0}/{1}': 'ウィスプ {0}/{1}', Hello: 'こんにちは' },
    };
    expect(tr(w, 'Hello')).toBe('Hello');
    w.resource(Strings).lang = 'ja';
    expect(tr(w, 'Hello')).toBe('こんにちは');
    expect(tr(w, 'Wisps {0}/{1}', 3, 12)).toBe('ウィスプ 3/12');
    expect(tr(w, 'Missing {0} {1}', 'a')).toBe('Missing a {1}');
  });
});
