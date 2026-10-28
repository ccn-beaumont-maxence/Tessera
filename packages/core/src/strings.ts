import { resource, type World } from './world';

/**
 * Translations of the scene's `strings:` files. `lang` picks a table ('' = source text);
 * it survives scene switches, and tests can set it directly.
 */
export const Strings = resource(
  'Strings',
  () => ({ lang: '', tables: {} as Record<string, Record<string, string>> }),
  { internal: true },
);

/**
 * `text` in the current language (unchanged without a translation), with `{0}`, `{1}`...
 * replaced by `args`.
 */
export function tr(w: World, text: string, ...args: (number | string | boolean)[]): string {
  const s = w.resource(Strings);
  const out = s.tables[s.lang]?.[text] ?? text;
  return args.length === 0 ? out : out.replace(/\{(\d+)\}/g, (m, i) => String(args[+i] ?? m));
}
