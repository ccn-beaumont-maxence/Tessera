import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Rule = { match?: string; begin?: string; end?: string; patterns?: Rule[]; include?: string };
const grammar = JSON.parse(
  readFileSync(`${import.meta.dirname}/syntaxes/tess.tmLanguage.json`, 'utf8'),
) as {
  scopeName: string;
  patterns: Rule[];
  repository: Record<string, Rule>;
};

function* rules(list: Rule[]): Generator<Rule> {
  for (const r of list) {
    yield r;
    if (r.patterns) yield* rules(r.patterns);
  }
}
const all = [
  ...rules(grammar.patterns),
  ...Object.values(grammar.repository).flatMap((r) => [...rules([r])]),
];
const scopeOf = (text: string) =>
  all.find((r) => r.match && new RegExp(r.match).exec(text)?.[0] === text);

describe('Tess TextMate grammar', () => {
  it('has valid regexes and resolvable includes', () => {
    for (const r of all) {
      for (const re of [r.match, r.begin, r.end])
        if (re) expect(() => new RegExp(re)).not.toThrow();
      if (r.include) expect(grammar.repository).toHaveProperty(r.include.slice(1));
    }
    expect(grammar.scopeName).toBe('source.tess');
  });

  it('classifies Tess tokens', () => {
    expect(scopeOf('return')).toMatchObject({ name: 'keyword.control.tess' });
    expect(scopeOf('vec3')).toMatchObject({ name: 'storage.type.primitive.tess' });
    expect(scopeOf('Transform2D')).toMatchObject({ name: 'support.class.engine.tess' });
    expect(scopeOf('none')).toMatchObject({ name: 'constant.language.tess' });
    expect(scopeOf('->')).toMatchObject({ name: 'invalid.illegal.cpp.tess' });
    expect(scopeOf('1.5')).toMatchObject({ name: 'constant.numeric.tess' });
  });
});
