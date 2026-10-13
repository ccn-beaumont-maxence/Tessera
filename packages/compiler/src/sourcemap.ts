import type { Pos } from './lexer';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(n: number): string {
  let v = n < 0 ? (-n << 1) | 1 : n << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += B64[digit];
  } while (v > 0);
  return out;
}

/** Source map v3 with one segment per generated line that has a source position. */
export function sourceMap(file: string, src: string, lines: (Pos | null)[]) {
  let prevLine = 0;
  let prevCol = 0;
  const mappings = lines
    .map((p) => {
      if (!p) return '';
      const seg = vlq(0) + vlq(0) + vlq(p.line - 1 - prevLine) + vlq(p.col - 1 - prevCol);
      prevLine = p.line - 1;
      prevCol = p.col - 1;
      return seg;
    })
    .join(';');
  return {
    version: 3,
    file,
    sources: [file],
    sourcesContent: [src],
    names: [] as string[],
    mappings,
  };
}
