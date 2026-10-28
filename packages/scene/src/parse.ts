import { isMap, isSeq, LineCounter, type Node, parseDocument } from 'yaml';

/** File access, injected so scenes load the same way in Node (CLI) and the browser (Vite). */
export interface SceneIO {
  read(path: string): Promise<string>;
  /** Imports a script module (shared module graph with the engine). */
  load(path: string): Promise<Record<string, unknown>>;
  /** URL the runtime should use for an asset file (images, models, sounds). */
  url(path: string): string;
}

/** Component name -> fields, as written in YAML. */
export type Spec = Record<string, Record<string, unknown>>;

/** Points at a YAML node to build `file:line: message` errors. */
export class Loc {
  constructor(
    readonly file: string,
    private readonly root: Node | null,
    private readonly lines: LineCounter,
    readonly path: (string | number)[] = [],
  ) {}

  at(...path: (string | number)[]): Loc {
    return new Loc(this.file, this.root, this.lines, [...this.path, ...path]);
  }

  /** Line of the deepest existing node on this path. */
  line(): number {
    let node: unknown = this.root;
    let best = node;
    for (const k of this.path) {
      if (isMap(node) || isSeq(node)) node = node.get(k, true);
      else break;
      if (node) best = node;
      else break;
    }
    const range = (best as { range?: [number] } | null)?.range;
    return range ? this.lines.linePos(range[0]).line : 1;
  }

  fail(message: string): never {
    throw new Error(`${this.file}:${this.line()}: ${message}`);
  }
}

export interface EntityDef {
  key: string;
  /** Key of the parent entity (`children:` in YAML). */
  parent: string | null;
  name: string;
  spec: Spec;
  loc: Loc;
}

export interface Parsed {
  path: string;
  dimension: '2d' | '3d';
  scripts: string[];
  /** Other scenes loadScene() may switch to (absolute paths). */
  scenes: string[];
  systems: string[];
  input: Record<string, unknown> | null;
  physics: { gravity?: number[] } | null;
  /** Language code -> source text -> translation. */
  strings: Record<string, Record<string, string>>;
  resources: Spec;
  prefabs: Record<string, { spec: Spec; loc: Loc }>;
  entities: EntityDef[];
  /** Every YAML file this scene depends on (hot reload). */
  files: string[];
  loc: Loc;
}

const TOP_KEYS = [
  'dimension',
  'scripts',
  'scenes',
  'systems',
  'input',
  'physics',
  'strings',
  'resources',
  'prefabs',
  'entities',
];

export async function readYaml(path: string, io: SceneIO): Promise<{ data: unknown; loc: Loc }> {
  const lines = new LineCounter();
  const doc = parseDocument(await io.read(path), { lineCounter: lines, prettyErrors: false });
  const err = doc.errors[0];
  if (err) {
    const line = err.linePos?.[0]?.line ?? 1;
    throw new Error(`${path}:${line}: ${err.message.split('\n')[0]}`);
  }
  return { data: doc.toJS(), loc: new Loc(path, doc.contents as Node | null, lines) };
}

export const dirOf = (path: string) => path.slice(0, path.lastIndexOf('/') + 1);

/** Resolves `rel` against directory `dir` (POSIX paths). */
export function join(dir: string, rel: string): string {
  if (rel.startsWith('/')) return rel;
  const parts = (dir + rel).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.') out.push(p);
  }
  return out.join('/');
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export async function parseScene(path: string, io: SceneIO): Promise<Parsed> {
  const { data, loc: root } = await readYaml(path, io);
  const loc: Loc = root;
  if (!isObj(data)) return loc.fail('a scene is a map with `dimension` and `entities`');
  for (const k of Object.keys(data)) {
    if (!TOP_KEYS.includes(k))
      return loc.at(k).fail(`unknown key "${k}" (use ${TOP_KEYS.join(', ')})`);
  }
  const dir = dirOf(path);
  const files = [path];
  const dimension = data.dimension;
  if (dimension !== '2d' && dimension !== '3d')
    return loc.at('dimension').fail('dimension must be 2d or 3d');

  const list = (key: string): string[] => {
    const v = data[key] ?? [];
    if (!Array.isArray(v) || !v.every((s) => typeof s === 'string')) {
      return loc.at(key).fail(`${key} must be a list of names`);
    }
    return v;
  };

  let input: unknown = data.input ?? null;
  if (typeof input === 'string') {
    const file = join(dir, input);
    files.push(file);
    input = (await readYaml(file, io)).data;
  }
  if (input !== null && !isObj(input))
    return loc.at('input').fail('input must map action names to buttons');

  const strings: Parsed['strings'] = {};
  const rawStrings = data.strings ?? {};
  if (!isObj(rawStrings))
    return loc
      .at('strings')
      .fail('strings maps languages to translation files: strings: { ja: ./ja.yaml }');
  for (const [lang, v] of Object.entries(rawStrings)) {
    let table = v;
    let at = loc.at('strings', lang);
    if (typeof v === 'string') {
      const file = join(dir, v);
      files.push(file);
      ({ data: table, loc: at } = await readYaml(file, io));
    }
    if (!isObj(table) || !Object.values(table).every((t) => typeof t === 'string'))
      return at.fail(
        `strings ${lang}: map each source text to its translation ("Coins {0}": "コイン {0}")`,
      );
    strings[lang] = table as Record<string, string>;
  }

  const physics = data.physics ?? null;
  if (physics !== null && !isObj(physics))
    return loc.at('physics').fail('physics must be a map, e.g. { gravity: [0, -9.81] }');

  const resources = data.resources ?? {};
  if (!isObj(resources))
    return loc.at('resources').fail('resources must map resource names to fields');

  const prefabs: Parsed['prefabs'] = {};
  const prefabData = data.prefabs ?? {};
  if (!isObj(prefabData))
    return loc.at('prefabs').fail('prefabs must map names to a file or components');
  for (const [name, v] of Object.entries(prefabData)) {
    if (typeof v === 'string') {
      const file = join(dir, v);
      files.push(file);
      const p = await readYaml(file, io);
      prefabs[name] = { spec: toSpec(p.data, p.loc), loc: p.loc };
    } else {
      const l = loc.at('prefabs', name);
      prefabs[name] = { spec: toSpec(v, l), loc: l };
    }
  }

  const entityData = data.entities ?? [];
  if (!Array.isArray(entityData)) return loc.at('entities').fail('entities must be a list');
  const names = new Map<string, number>();
  const count = (list: unknown[]) => {
    for (const e of list) {
      if (!isObj(e)) continue;
      if (typeof e.name === 'string') names.set(e.name, (names.get(e.name) ?? 0) + 1);
      if (Array.isArray(e.children)) count(e.children);
    }
  };
  count(entityData);
  const entities: EntityDef[] = [];
  // Pre-order: a parent is always spawned before its children.
  const walk = (list: unknown[], at: Loc, parent: string | null, prefix: string): void => {
    for (const [i, e] of list.entries()) {
      const l: Loc = at.at(i);
      if (!isObj(e))
        return l.fail('each entity is a map of components (plus optional name, prefab, children)');
      const { name = '', prefab, children, ...rest } = e;
      if (typeof name !== 'string') return l.at('name').fail('name must be a string');
      let spec = toSpec(rest, l);
      if (prefab !== undefined) {
        const p = typeof prefab === 'string' ? prefabs[prefab] : undefined;
        if (!p)
          return l
            .at('prefab')
            .fail(
              `unknown prefab "${String(prefab)}"${suggest(String(prefab), Object.keys(prefabs))}`,
            );
        spec = mergeSpec(p.spec, spec);
      }
      const key = name && names.get(name) === 1 ? name : `${prefix}#${i}`;
      entities.push({ key, parent, name, spec, loc: l });
      if (children === undefined) continue;
      if (!Array.isArray(children)) return l.at('children').fail('children must be a list');
      walk(children, l.at('children'), key, `${key}/`);
    }
  };
  walk(entityData, loc.at('entities'), null, '');

  return {
    path,
    dimension,
    scripts: list('scripts').map((s) => join(dir, s)),
    scenes: list('scenes').map((s) => join(dir, s)),
    systems: list('systems'),
    input: input as Record<string, unknown> | null,
    physics: physics as Parsed['physics'],
    strings,
    resources: toSpec(resources, loc.at('resources')),
    prefabs,
    entities,
    files,
    loc,
  };
}

function toSpec(v: unknown, loc: Loc): Spec {
  if (!isObj(v)) loc.fail('expected a map of components');
  const spec: Spec = {};
  for (const [k, fields] of Object.entries(v)) {
    if (fields === null) spec[k] = {};
    else if (isObj(fields)) spec[k] = fields;
    else loc.at(k).fail(`${k} must be a map of fields (use {} for defaults)`);
  }
  return spec;
}

/** Prefab components overridden field by field by the entity's. */
export function mergeSpec(base: Spec, over: Spec): Spec {
  const out: Spec = {};
  for (const [k, v] of Object.entries(base)) out[k] = { ...v };
  for (const [k, v] of Object.entries(over)) out[k] = { ...out[k], ...v };
  return out;
}

/** ` (did you mean X?)` when a close name exists. */
export function suggest(name: string, options: string[]): string {
  let best = '';
  let bestD = Math.max(2, Math.floor(name.length / 3)) + 1;
  for (const o of options) {
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
