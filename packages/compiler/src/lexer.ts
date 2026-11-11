export type TokenKind = 'ident' | 'number' | 'string' | 'punct' | 'eof';

export interface Pos {
  line: number;
  col: number;
}

export interface Token extends Pos {
  kind: TokenKind;
  text: string;
}

/** Compile error located in the .tess source: `file.tess:line:col: message`. */
export class TessError extends Error {
  constructor(
    readonly file: string,
    readonly pos: Pos,
    readonly detail: string,
  ) {
    super(`${file}:${pos.line}:${pos.col}: ${detail}`);
  }
}

// Longest first so `<=` wins over `<`.
const PUNCT = [
  '->',
  '::',
  '++',
  '--',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '==',
  '!=',
  '<=',
  '>=',
  '&&',
  '||',
  '{',
  '}',
  '(',
  ')',
  '[',
  ']',
  ';',
  ',',
  '.',
  ':',
  '?',
  '<',
  '>',
  '=',
  '+',
  '-',
  '*',
  '/',
  '%',
  '!',
  '&',
  '#',
  '|',
  '~',
  '^',
];

export function lex(src: string, file: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const pos = (): Pos => ({ line, col: i - lineStart + 1 });
  const fail = (msg: string): never => {
    throw new TessError(file, pos(), msg);
  };
  while (i < src.length) {
    const c = src[i] as string;
    if (c === '\n') {
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) fail('unterminated comment: add */');
      for (; i < end + 2; i++) {
        if (src[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
      }
      continue;
    }
    const start = pos();
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j] as string)) j++;
      out.push({ kind: 'ident', text: src.slice(i, j), ...start });
      i = j;
      continue;
    }
    const hex = /^0[xX][0-9a-fA-F]+/.exec(src.slice(i, i + 20));
    if (hex) fail(`Tess has no hex numbers: write ${Number(hex[0])}`);
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?f?/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ kind: 'number', text: m[0].replace(/f$/, ''), ...start });
      i += m[0].length;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"' && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      if (src[j] !== '"') fail('unterminated string: add a closing "');
      out.push({ kind: 'string', text: src.slice(i, j + 1), ...start });
      i = j + 1;
      continue;
    }
    if (c === "'") fail('use double quotes for strings: "text"');
    const p = PUNCT.find((t) => src.startsWith(t, i));
    if (!p) fail(`unexpected character "${c}"`);
    out.push({ kind: 'punct', text: p as string, ...start });
    i += (p as string).length;
  }
  out.push({ kind: 'eof', text: '', ...pos() });
  return out;
}

/** ` (did you mean X?)` when a close name exists. */
export function suggest(name: string, options: string[]): string {
  let best = '';
  let bestD = Math.max(2, Math.floor(name.length / 3)) + 1;
  for (const o of new Set(options)) {
    const d = distance(name.toLowerCase(), o.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best ? ` (did you mean ${best}?)` : '';
}

function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        (prev[j] as number) + 1,
        (cur[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length] as number;
}
