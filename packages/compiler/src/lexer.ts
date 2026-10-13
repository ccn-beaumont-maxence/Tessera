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
