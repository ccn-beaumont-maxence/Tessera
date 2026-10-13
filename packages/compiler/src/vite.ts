import { relative } from 'node:path';
import { type Plugin, transformWithOxc } from 'vite';
import { compile } from './compile';

/** Compiles `.tess` modules to TypeScript, then to JS with a source map back to the .tess file. */
export function tess(): Plugin {
  return {
    name: 'tess',
    async transform(src, id) {
      if (!id.endsWith('.tess')) return null;
      const file = relative(process.cwd(), id) || id;
      const out = compile(src, file);
      const js = await transformWithOxc(out.code, `${id}.ts`, { sourcemap: true }, out.map);
      return { code: js.code, map: js.map ?? null };
    },
  };
}
