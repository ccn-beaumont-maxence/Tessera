import { readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import type { Decl, Expr, Stmt, TypeRef } from './ast';
import { ENGINE, SCALARS, type StructInfo, TS_TYPE, VALUE } from './engine';
import { type Pos, TessError } from './lexer';
import { parse } from './parser';
import { sourceMap } from './sourcemap';

/** A typed JS expression. Value types (vec2/vec3/quat/color) carry an object `js` and/or `comps`. */
interface R {
  ty: string;
  /** Scalar/struct: the expression. Value type: an expression yielding an object ('' if only comps). */
  js: string;
  /** Value type components, evaluated in order (comps[0] may carry side effects). */
  comps?: string[] | undefined;
  lvalue?: boolean | undefined;
  writable?: boolean | undefined;
  /** Variable at the root of an lvalue, for error messages. */
  root?: Var | undefined;
}

interface Var {
  name: string;
  ty: string;
  js: string;
  writable: boolean;
  /** How to declare it writable, for error messages. */
  hint: string;
}

interface Fn {
  ret: string;
  params: { ty: string; name: string; ref: boolean }[];
}

interface Body {
  scopes: Map<string, Var>[];
  temps: number;
  /** Loop depth since the innermost function or query callback. */
  loops: number;
  inQuery: boolean;
  ret: string | 'system';
  reads: Set<string>;
  writes: Set<string>;
  lines: Line[];
  indent: number;
}

interface Line {
  text: string;
  pos: Pos | null;
}

export interface CompileResult {
  code: string;
  map: ReturnType<typeof sourceMap>;
}

const ASSET = /\.(png|jpe?g|webp|gif|svg|gltf|glb|mp3|ogg|wav|m4a)"$/i;
const isPure = (js: string) => /^-?[\w$.]+$/.test(js);
const isValue = (ty: string) => ty in VALUE;
const isNum = (ty: string) => ty === 'float' || ty === 'int';
const MATH1 = ['abs', 'floor', 'ceil', 'round', 'sqrt', 'sin', 'cos', 'tan'];
const MATH2 = ['pow', 'atan2', 'min', 'max'];

/** Reads a `using` target; paths are relative to the current directory like `file`. */
export type ReadFile = (file: string) => string;

/** Compiles one .tess file to a TypeScript module plus a source map back to the .tess file. */
export function compile(
  src: string,
  file: string,
  read: ReadFile = (f) => readFileSync(f, 'utf8'),
): CompileResult {
  return new Compiler(file, read).run(src);
}

const usings = (decls: Decl[]) =>
  decls.filter((d): d is Extract<Decl, { kind: 'using' }> => d.kind === 'using');

class Compiler {
  private readonly structs = new Map<string, StructInfo>();
  private readonly consts = new Map<string, Var>();
  private readonly fns = new Map<string, Fn>();
  private readonly imports = new Map<string, Set<string>>();
  /** Names brought in by `using`, to the path they come from. */
  private readonly used = new Map<string, string>();
  private readonly scratch: string[] = [];
  private readonly out: Line[] = [];
  /** Compiling defaults/constants: value results must be fresh objects, not shared scratch. */
  private constCtx = false;

  constructor(
    private readonly file: string,
    private readonly read: ReadFile,
  ) {}

  private fail(msg: string, at: Pos): never {
    throw new TessError(this.file, { line: at.line, col: at.col }, msg);
  }

  private use(module: string, name: string): string {
    let set = this.imports.get(module);
    if (!set) {
      set = new Set();
      this.imports.set(module, set);
    }
    set.add(name);
    return name;
  }

  run(src: string): CompileResult {
    const decls = parse(src, this.file);
    for (const u of usings(decls)) this.using(u);
    this.declare(decls);
    for (const d of decls) this.decl(d);
    const head: string[] = [];
    for (const [module, names] of this.imports)
      head.push(`import { ${[...names].sort().join(', ')} } from '${module}';`);
    // Re-export so a scene only lists its entry script: used components and systems register too.
    for (const u of usings(decls)) head.push(`export * from '${u.path}';`);
    head.push(`const $file = ${JSON.stringify(this.file)};`, 'let $l = 0;', ...this.scratch);
    const lines: Line[] = [...head.map((text) => ({ text, pos: null })), ...this.out];
    const code = `${lines.map((l) => l.text).join('\n')}\n`;
    return {
      code,
      map: sourceMap(
        this.file,
        src,
        lines.map((l) => l.pos),
      ),
    };
  }

  private parseFile(file: string, at: Pos): Decl[] {
    let src: string;
    try {
      src = this.read(file);
    } catch {
      return this.fail(`cannot read ${file}`, at);
    }
    return parse(src, file);
  }

  /** `using "./x.tess";`: x's declarations become visible here and are imported from its module. */
  private using(u: Extract<Decl, { kind: 'using' }>): void {
    const file = normalize(join(dirname(this.file), u.path));
    if (file === this.file) this.fail(`a file cannot use itself`, u);
    const decls = this.parseFile(file, u);
    this.noCycle(file, decls, [this.file, file], u);
    for (const d of decls) {
      if (d.kind === 'using' || d.kind === 'system') continue;
      const prev = this.used.get(d.name);
      if (prev) this.fail(`"${d.name}" is defined in both ${prev} and ${u.path}`, u);
      this.used.set(d.name, u.path);
      this.use(u.path, d.name);
      if (d.kind === 'const') {
        this.consts.set(d.name, {
          name: d.name,
          ty: d.type.name,
          js: d.name,
          writable: false,
          hint: 'constants are read-only',
        });
      } else if (d.kind === 'function') {
        this.fns.set(d.name, {
          ret: d.ret.name,
          params: d.params.map((p) => ({ ty: p.type.name, name: p.name, ref: p.type.ref })),
        });
      } else {
        const fields = new Map(d.fields.map((f) => [f.name, f.type.name]));
        this.structs.set(d.name, { kind: d.kind, fields, module: u.path });
        if (d.kind === 'event') this.use(u.path, `$new${d.name}`);
      }
    }
  }

  /** Modules that use each other would read uninitialized components at load time. */
  private noCycle(file: string, decls: Decl[], chain: string[], at: Pos): void {
    for (const u of usings(decls)) {
      const next = normalize(join(dirname(file), u.path));
      if (next === this.file)
        this.fail(
          `circular using: ${[...chain, next].join(' -> ')}: move shared declarations to a third file`,
          at,
        );
      if (chain.includes(next)) continue;
      this.noCycle(next, this.parseFile(next, at), [...chain, next], at);
    }
  }

  /** First pass: names of structs and functions, so order of declaration does not matter. */
  private declare(decls: Decl[]): void {
    this.use('@tessera/compiler/runtime', '$at');
    for (const d of decls) {
      if (d.kind === 'using') continue;
      const from = this.used.get(d.name);
      if (from) this.fail(`"${d.name}" is already defined in ${from}`, d);
      if (this.structs.has(d.name) || this.fns.has(d.name) || ENGINE[d.name]) {
        this.fail(`"${d.name}" is already defined`, d);
      }
      if (d.kind === 'component' || d.kind === 'resource' || d.kind === 'event') {
        const fields = new Map<string, string>();
        for (const f of d.fields) {
          this.checkType(f.type);
          if (fields.has(f.name)) this.fail(`duplicate field "${f.name}"`, f);
          fields.set(f.name, f.type.name);
        }
        this.structs.set(d.name, { kind: d.kind, fields, module: null });
      } else if (d.kind === 'function') {
        if (d.ret.name !== 'void') this.checkType(d.ret);
        for (const p of d.params) this.checkType(p.type);
        this.fns.set(d.name, {
          ret: d.ret.name,
          params: d.params.map((p) => ({ ty: p.type.name, name: p.name, ref: p.type.ref })),
        });
      }
    }
  }

  private struct(name: string): StructInfo | undefined {
    const own = this.structs.get(name);
    if (own) return own;
    const e = ENGINE[name];
    if (e?.module) this.use(e.module, e.kind === 'struct' ? `type ${name}` : name);
    return e;
  }

  private checkType(t: TypeRef): void {
    if (SCALARS.includes(t.name) || isValue(t.name) || this.structs.has(t.name) || ENGINE[t.name])
      return;
    const known = [
      ...SCALARS,
      ...Object.keys(VALUE),
      ...this.structs.keys(),
      ...Object.keys(ENGINE),
    ];
    this.fail(`unknown type "${t.name}"${suggest(t.name, known)}`, t);
  }

  // ---------------------------------------------------------------- declarations

  private decl(d: Decl): void {
    switch (d.kind) {
      case 'const':
        return this.constDecl(d);
      case 'system':
        return this.systemDecl(d);
      case 'function':
        return this.functionDecl(d);
      case 'using':
        return;
      default:
        return this.structDecl(d);
    }
  }

  private body(ret: string): Body {
    return {
      scopes: [new Map()],
      temps: 0,
      loops: 0,
      inQuery: false,
      ret,
      reads: new Set(),
      writes: new Set(),
      lines: [],
      indent: 1,
    };
  }

  private constDecl(d: Extract<Decl, { kind: 'const' }>): void {
    this.checkType(d.type);
    const b = this.body('const');
    this.constCtx = true;
    const v = this.expr(d.value, b);
    this.expectType(v, d.type.name, d.value);
    const js = isValue(d.type.name) ? this.freshValue(v, b) : v.js;
    this.constCtx = false;
    this.out.push({ text: `export const ${d.name} = ${this.once(js, b)};`, pos: d });
    this.consts.set(d.name, {
      name: d.name,
      ty: d.type.name,
      js: d.name,
      writable: false,
      hint: 'constants are read-only',
    });
  }

  private structDecl(d: Extract<Decl, { kind: 'component' | 'resource' | 'event' }>): void {
    const b = this.body('const');
    this.constCtx = true;
    const fields = d.fields.map((f) => {
      const ty = f.type.name;
      if (!f.init) return `${f.name}: ${this.zero(ty, f)}`;
      const v = this.expr(f.init, b);
      this.expectType(v, ty, f.init);
      return `${f.name}: ${isValue(ty) ? this.freshValue(v, b) : v.js}`;
    });
    this.constCtx = false;
    if (b.temps > 0) this.fail('field defaults must be simple values', d);
    const create = `() => ({ ${fields.join(', ')} })`;
    if (d.kind === 'event') {
      this.out.push({
        text: `export const ${d.name} = ${this.use('@tessera/core', 'event')}(${JSON.stringify(d.name)});`,
        pos: d,
      });
      this.out.push({ text: `export const $new${d.name} = ${create};`, pos: d });
    } else {
      this.out.push({
        text: `export const ${d.name} = ${this.use('@tessera/core', d.kind)}(${JSON.stringify(d.name)}, ${create});`,
        pos: d,
      });
    }
  }

  /** Wraps an initializer that needed temporaries. */
  private once(js: string, b: Body): string {
    if (b.temps === 0) return js;
    return `(() => { let ${Array.from({ length: b.temps }, (_, i) => `$h${i + 1}`).join(', ')}; return ${js}; })()`;
  }

  private zero(ty: string, at: Pos = { line: 1, col: 1 }): string {
    if (ty === 'bool') return 'false';
    if (ty === 'string') return '""';
    if (isValue(ty)) return `${this.use('@tessera/core', ty)}()`;
    if (isNum(ty) || ty === 'Entity') return '0';
    return this.fail(`type "${ty}" needs a value: use a scalar, a value type or Entity`, at);
  }

  private systemDecl(d: Extract<Decl, { kind: 'system' }>): void {
    const b = this.body('system');
    const terms: string[] = [];
    const args: string[] = [];
    let entity = '$e';
    const pre: string[] = [];
    for (const p of d.params) {
      const ty = p.type.name;
      if (ty === 'Entity') {
        if (p.type.ref) this.fail('Entity parameters cannot be `&`', p);
        entity = p.name;
        this.declareVar(
          b,
          { name: p.name, ty, js: p.name, writable: false, hint: 'the entity id is read-only' },
          p,
        );
        continue;
      }
      const info = this.struct(ty);
      if (!info || info.kind === 'event' || info.kind === 'struct') {
        this.fail(
          `system parameter "${p.name}" must be Entity, a component or a resource (got ${ty})`,
          p,
        );
      }
      const v: Var = {
        name: p.name,
        ty,
        js: p.name,
        writable: p.type.ref,
        hint: `"${p.name}" is read-only; declare it "${ty}& ${p.name}"`,
      };
      this.declareVar(b, v, p);
      if (info.kind === 'resource') {
        (p.type.ref ? b.writes : b.reads).add(ty);
        pre.push(`const ${p.name} = $w.resource(${ty});`);
      } else {
        terms.push(p.type.ref ? `${this.use('@tessera/core', 'mut')}(${ty})` : ty);
        args.push(p.name);
      }
    }
    if (terms.length === 0 && entity !== '$e')
      this.fail('`Entity` needs at least one component parameter to iterate', d);
    b.indent = 2;
    for (const s of d.body) this.stmt(s, b);
    const temps =
      b.temps > 0
        ? [`let ${Array.from({ length: b.temps }, (_, i) => `$h${i + 1}`).join(', ')};`]
        : [];
    const access = `{ reads: [${[...b.reads].join(', ')}], writes: [${[...b.writes].join(', ')}] }`;
    const name = JSON.stringify(d.name);
    const open =
      terms.length > 0
        ? `export const ${d.name} = ${this.use('@tessera/core', 'system')}(${name}, [${terms.join(', ')}], ($w, ${[entity, ...args].join(', ')}) => {`
        : `export const ${d.name} = { name: ${name}, ...${access}, run: ($w: ${this.useType('World')}) => {`;
    this.out.push({ text: open, pos: d });
    this.out.push({ text: '  try {', pos: d });
    for (const t of [...temps, ...pre]) this.out.push({ text: `    ${t}`, pos: d });
    this.out.push(...b.lines);
    this.out.push({ text: '  } catch ($err) { throw $at($err, $file, $l); }', pos: d });
    this.out.push({ text: terms.length > 0 ? `}, ${access});` : '} };', pos: null });
  }

  private useType(name: string): string {
    return this.use('@tessera/core', `type ${name}`).slice(5);
  }

  private tsType(ty: string): string {
    if (ty in TS_TYPE) {
      if (isValue(ty)) this.useType(TS_TYPE[ty] as string);
      return TS_TYPE[ty] as string;
    }
    const info = this.struct(ty);
    if (info?.kind === 'struct') return this.use(info.module as string, `type ${ty}`).slice(5);
    return `${this.use('@tessera/compiler/runtime', 'type Value').slice(5)}<typeof ${ty}>`;
  }

  private functionDecl(d: Extract<Decl, { kind: 'function' }>): void {
    const b = this.body(d.ret.name);
    const params = [`$w: ${this.useType('World')}`];
    for (const p of d.params) {
      const ty = p.type.name;
      const struct = !SCALARS.includes(ty) && !isValue(ty);
      if (p.type.ref && !struct) this.fail('`&` is for component and resource parameters', p);
      const hint = struct
        ? `"${p.name}" is read-only; declare it "${ty}& ${p.name}"`
        : 'function parameters are read-only; copy it to a local';
      this.declareVar(b, { name: p.name, ty, js: p.name, writable: p.type.ref, hint }, p);
      params.push(`${p.name}: ${this.tsType(ty)}`);
    }
    if (isValue(d.ret.name)) params.push(`$out: ${this.tsType(d.ret.name)}`);
    for (const s of d.body) this.stmt(s, b);
    const temps =
      b.temps > 0
        ? [`  let ${Array.from({ length: b.temps }, (_, i) => `$h${i + 1}`).join(', ')};`]
        : [];
    this.out.push({
      text: `export function ${d.name}(${params.join(', ')}): ${this.tsType(d.ret.name)} {`,
      pos: d,
    });
    for (const t of temps) this.out.push({ text: t, pos: d });
    this.out.push(...b.lines);
    this.out.push({ text: '}', pos: null });
  }

  // ---------------------------------------------------------------- statements

  private emit(b: Body, text: string, pos: Pos): void {
    b.lines.push({ text: `${'  '.repeat(b.indent)}$l = ${pos.line}; ${text}`, pos });
  }

  private declareVar(b: Body, v: Var, at: Pos): void {
    const scope = b.scopes[b.scopes.length - 1] as Map<string, Var>;
    if (scope.has(v.name)) this.fail(`"${v.name}" is already declared in this scope`, at);
    scope.set(v.name, v);
  }

  private block(stmts: Stmt[], b: Body): void {
    b.scopes.push(new Map());
    b.indent++;
    for (const s of stmts) this.stmt(s, b);
    b.indent--;
    b.scopes.pop();
  }

  private open(b: Body, text: string, pos: Pos, stmts: Stmt[]): void {
    this.emit(b, `${text} {`, pos);
    this.block(stmts, b);
    b.lines.push({ text: `${'  '.repeat(b.indent)}}`, pos: null });
  }

  private cond(e: Expr, b: Body): string {
    const c = this.expr(e, b);
    if (c.ty !== 'bool' && !isNum(c.ty) && c.ty !== 'Entity')
      this.fail(`condition must be bool, got ${c.ty}`, e);
    return c.js;
  }

  private stmt(s: Stmt, b: Body): void {
    switch (s.kind) {
      case 'block':
        this.open(b, '', s, s.body);
        return;
      case 'var':
        return this.varStmt(s, b);
      case 'expr': {
        const e = s.expr;
        if (e.kind === 'assign') return this.assign(e, b);
        this.emit(b, `${this.expr(e, b).js || this.fail('expression has no effect', e)};`, s);
        return;
      }
      case 'if': {
        this.open(b, `if (${this.cond(s.cond, b)})`, s, s.then);
        if (s.else) {
          const last = b.lines.pop() as Line;
          b.lines.push({ text: `${last.text} else {`, pos: null });
          this.block(s.else, b);
          b.lines.push({ text: `${'  '.repeat(b.indent)}}`, pos: null });
        }
        return;
      }
      case 'while':
        b.loops++;
        this.open(b, `while (${this.cond(s.cond, b)})`, s, s.body);
        b.loops--;
        return;
      case 'for': {
        b.scopes.push(new Map());
        b.loops++;
        let init = '';
        if (s.init?.kind === 'var') {
          if (s.init.type && isValue(s.init.type.name))
            this.fail('for-loop variables must be scalars', s.init);
          init = this.varDecl(s.init, b);
        } else if (s.init?.kind === 'expr') init = this.exprText(s.init.expr, b);
        const cond = s.cond ? this.cond(s.cond, b) : '';
        const step = s.step ? this.exprText(s.step, b) : '';
        this.open(b, `for (${init}; ${cond}; ${step})`, s, s.body);
        b.loops--;
        b.scopes.pop();
        return;
      }
      case 'query':
        return this.query(s, b);
      case 'events':
        return this.events(s, b);
      case 'list':
        return this.list(s, b);
      case 'break':
      case 'continue':
        if (b.loops === 0) {
          if (b.inQuery && s.kind === 'continue') return this.emit(b, 'return;', s);
          if (b.inQuery)
            this.fail('`break` cannot leave a query loop: use a bool flag and `continue`', s);
          this.fail(`\`${s.kind}\` outside of a loop`, s);
        }
        this.emit(b, `${s.kind};`, s);
        return;
      case 'return':
        return this.returnStmt(s, b);
    }
  }

  private exprText(e: Expr, b: Body): string {
    if (e.kind === 'assign') {
      const t = this.expr(e.target, b);
      if (isValue(t.ty)) this.fail('vector assignment is not allowed here', e);
      return this.scalarAssign(e, t, b);
    }
    return this.expr(e, b).js;
  }

  private varDecl(s: Extract<Stmt, { kind: 'var' }>, b: Body, pre?: R | null): string {
    if (s.type) this.checkType(s.type);
    const init = pre !== undefined ? pre : s.init ? this.expr(s.init, b) : null;
    const ty = s.type?.name ?? (init as R).ty;
    if (ty === 'void' || ty === 'none') this.fail(`cannot infer a type for "${s.name}"`, s);
    if (init) this.expectType(init, ty, s.init as Expr);
    const struct = !SCALARS.includes(ty) && !isValue(ty);
    if (struct && !init)
      this.fail(`"${s.name}" needs a value, e.g. ${ty}& ${s.name} = get<${ty}>(e);`, s);
    // `T x = get<T>(e)` is read-only like a by-value parameter; `T& x` or `auto x` keep write access.
    const writable = !struct || (s.type ? s.type.ref : (init?.writable ?? false));
    this.declareVar(
      b,
      { name: s.name, ty, js: s.name, writable, hint: `declare it "${ty}& ${s.name}"` },
      s,
    );
    let js = init ? init.js : this.zero(ty);
    if (ty === 'int' && init?.ty === 'float') js = `Math.trunc(${js})`;
    return `let ${s.name} = ${js}`;
  }

  private varStmt(s: Extract<Stmt, { kind: 'var' }>, b: Body): void {
    const ty = s.type?.name;
    if (ty && isValue(ty)) this.checkType(s.type as TypeRef);
    const init = s.init ? this.expr(s.init, b) : null;
    const vty = ty ?? init?.ty;
    if (vty && isValue(vty)) {
      if (init) this.expectType(init, vty, s.init as Expr);
      const obj = this.scratchOf(vty);
      this.declareVar(b, { name: s.name, ty: vty, js: obj, writable: true, hint: '' }, s);
      const comps = init
        ? this.comps(init, b)
        : (VALUE[vty]?.map((k) => (k === 'w' || k === 'a' ? '1' : '0')) ?? []);
      this.storeComps(b, obj, vty, comps, s);
      return;
    }
    this.emit(b, `${this.varDecl(s, b, init)};`, s);
  }

  private returnStmt(s: Extract<Stmt, { kind: 'return' }>, b: Body): void {
    if (b.inQuery)
      this.fail(
        '`return` inside a query loop only leaves the loop body: use `continue` or a flag',
        s,
      );
    if (b.ret === 'system' || b.ret === 'void') {
      if (s.value) this.fail('this function returns nothing (void)', s.value);
      return this.emit(b, 'return;', s);
    }
    if (!s.value) this.fail(`return a ${b.ret}`, s);
    const v = this.expr(s.value, b);
    this.expectType(v, b.ret, s.value);
    if (isValue(b.ret)) {
      this.storeComps(b, '$out', b.ret, this.comps(v, b), s);
      return this.emit(b, 'return $out;', s);
    }
    this.emit(b, `return ${v.js};`, s);
  }

  private query(s: Extract<Stmt, { kind: 'query' }>, b: Body): void {
    const inner: Body = {
      ...b,
      scopes: [...b.scopes, new Map()],
      loops: 0,
      inQuery: true,
      indent: b.indent + 1,
      lines: [],
    };
    const terms: string[] = [];
    const params: string[] = [];
    let entity = '$q';
    for (const v of s.vars) {
      const ty = v.type.name;
      if (ty === 'Entity') {
        entity = v.name;
        this.declareVar(inner, { name: v.name, ty, js: v.name, writable: false, hint: '' }, v);
        continue;
      }
      const info = this.struct(ty);
      if (info?.kind !== 'component')
        this.fail(`query variables must be Entity or components (got ${ty})`, v);
      terms.push(v.type.ref ? `${this.use('@tessera/core', 'mut')}(${ty})` : ty);
      params.push(v.name);
      (v.type.ref ? b.writes : b.reads).add(ty);
      this.declareVar(
        inner,
        {
          name: v.name,
          ty,
          js: v.name,
          writable: v.type.ref,
          hint: `"${v.name}" is read-only; declare it "${ty}& ${v.name}"`,
        },
        v,
      );
    }
    if (terms.length === 0) this.fail('a query needs at least one component', s);
    for (const st of s.body) this.stmt(st, inner);
    b.temps = inner.temps;
    this.emit(b, `$w.each([${terms.join(', ')}], (${[entity, ...params].join(', ')}) => {`, s);
    b.lines.push(...inner.lines);
    b.lines.push({ text: `${'  '.repeat(b.indent)}});`, pos: null });
  }

  private events(s: Extract<Stmt, { kind: 'events' }>, b: Body): void {
    const info = this.struct(s.event);
    if (info?.kind !== 'event') this.fail(`"${s.event}" is not an event`, s);
    if (s.var.type.name !== s.event)
      this.fail(`loop variable must be "${s.event} ${s.var.name}"`, s.var);
    const n = b.temps + 1;
    b.temps++;
    b.reads.add(s.event);
    b.scopes.push(new Map());
    this.declareVar(
      b,
      {
        name: s.var.name,
        ty: s.event,
        js: s.var.name,
        writable: false,
        hint: 'events are read-only',
      },
      s.var,
    );
    b.loops++;
    this.emit(b, `$h${n} = $w.events(${s.event});`, s);
    this.emit(b, `for (let $i${n} = 0; $i${n} < $h${n}.length; $i${n}++) {`, s);
    b.indent++;
    b.lines.push({ text: `${'  '.repeat(b.indent)}const ${s.var.name} = $h${n}[$i${n}];`, pos: s });
    for (const st of s.body) this.stmt(st, b);
    b.indent--;
    b.lines.push({ text: `${'  '.repeat(b.indent)}}`, pos: null });
    b.loops--;
    b.scopes.pop();
  }

  /** `for (Entity o : overlap(shape, size, position))`. */
  private list(s: Extract<Stmt, { kind: 'list' }>, b: Body): void {
    const src = s.source;
    if (src.kind !== 'call' || src.name !== 'overlap')
      this.fail('range-for works on `query`, `events<Event>()` or `overlap(...)`', src);
    if (s.var.type.name !== 'Entity' || s.var.type.ref)
      this.fail(`loop variable must be "Entity ${s.var.name}"`, s.var);
    this.needsWorld(src, b, 'overlap');
    const [shape, size, pos] = this.args(src, b, ['string', 'any', 'any']) as [R, R, R];
    this.vectorArg(size, src);
    this.vectorArg(pos, src);
    const n = b.temps + 1;
    b.temps++;
    b.scopes.push(new Map());
    this.declareVar(
      b,
      { name: s.var.name, ty: 'Entity', js: s.var.name, writable: false, hint: '' },
      s.var,
    );
    b.loops++;
    this.emit(
      b,
      `$h${n} = ${this.use('@tessera/physics', 'overlap')}($w, ${shape.js}, ${this.obj(size)}, ${this.obj(pos)});`,
      s,
    );
    this.emit(b, `for (let $i${n} = 0; $i${n} < $h${n}.length; $i${n}++) {`, s);
    b.indent++;
    b.lines.push({ text: `${'  '.repeat(b.indent)}const ${s.var.name} = $h${n}[$i${n}];`, pos: s });
    for (const st of s.body) this.stmt(st, b);
    b.indent--;
    b.lines.push({ text: `${'  '.repeat(b.indent)}}`, pos: null });
    b.loops--;
    b.scopes.pop();
  }

  // ---------------------------------------------------------------- assignment

  private writableTarget(t: R, e: Expr): void {
    if (!t.lvalue) this.fail('left side of `=` is not assignable', e);
    if (!t.writable) this.fail(`cannot write "${show(e)}": ${t.root?.hint ?? 'read-only'}`, e);
  }

  private assign(e: Extract<Expr, { kind: 'assign' }>, b: Body): void {
    const t = this.expr(e.target, b);
    this.writableTarget(t, e.target);
    if (!isValue(t.ty)) {
      if (!SCALARS.includes(t.ty)) this.fail(`cannot assign a whole ${t.ty}: assign its fields`, e);
      return this.emit(b, `${this.scalarAssign(e, t, b)};`, e);
    }
    const v = this.expr(e.value, b);
    const keys = VALUE[t.ty] as string[];
    let comps: string[];
    if (e.op === '=') {
      this.expectType(v, t.ty, e.value);
      comps = this.comps(v, b);
    } else if (e.op === '+=' || e.op === '-=') {
      this.expectType(v, t.ty, e.value);
      const op = e.op[0];
      comps = this.comps(v, b).map((c, i) => `$o.${keys[i]} ${op} ${c}`);
    } else if ((e.op === '*=' || e.op === '/=') && isNum(v.ty)) {
      const s = this.repeatable(v.js, b);
      comps = keys.map((k, i) => `$o.${k} ${e.op[0]} ${i === 0 ? s.first : s.ref}`);
    } else {
      return this.fail(`${t.ty} ${e.op} ${v.ty} is not supported`, e);
    }
    this.storeComps(b, t.js, t.ty, comps, e, true);
  }

  private scalarAssign(e: Extract<Expr, { kind: 'assign' }>, t: R, b: Body): string {
    const v = this.expr(e.value, b);
    if (e.op === '=') {
      this.expectType(v, t.ty, e.value);
      return `${t.js} = ${t.ty === 'int' && v.ty === 'float' ? `Math.trunc(${v.js})` : v.js}`;
    }
    if (t.ty === 'string' && e.op === '+=') return `${t.js} += ${v.js}`;
    if (!isNum(t.ty) || !isNum(v.ty)) this.fail(`${t.ty} ${e.op} ${v.ty} is not supported`, e);
    const op = e.op[0] as string;
    if (t.ty === 'int' && (v.ty === 'float' || op === '/'))
      return `${t.js} = Math.trunc(${t.js} ${op} ${v.js})`;
    return `${t.js} ${e.op} ${v.js}`;
  }

  /** Writes components through a block so the right side may read the target (aliasing safe). */
  private storeComps(
    b: Body,
    target: string,
    ty: string,
    comps: string[],
    at: Pos,
    viaO = false,
  ): void {
    const keys = VALUE[ty] as string[];
    const o = viaO || !isPure(target) ? '$o' : target;
    const parts = [];
    if (o === '$o') parts.push(`const $o = ${target};`);
    parts.push(
      `const ${comps.map((c, i) => `$v${i} = ${c.replaceAll('$o.', `${o}.`)}`).join(', ')};`,
    );
    parts.push(keys.map((k, i) => `${o}.${k} = $v${i};`).join(' '));
    this.emit(b, `{ ${parts.join(' ')} }`, at);
  }

  // ---------------------------------------------------------------- expressions

  private temp(b: Body): string {
    b.temps++;
    return `$h${b.temps}`;
  }

  /** A scalar used more than once: first use assigns a temp, later uses read it. */
  private repeatable(js: string, b: Body): { first: string; ref: string } {
    if (isPure(js)) return { first: js, ref: js };
    const t = this.temp(b);
    return { first: `(${t} = ${js})`, ref: t };
  }

  private scratchOf(ty: string): string {
    if (this.constCtx) return `${this.use('@tessera/core', ty)}()`;
    const name = `$s${this.scratch.length + 1}`;
    this.scratch.push(`const ${name} = ${this.use('@tessera/core', ty)}();`);
    return name;
  }

  /** A new object for a value computed in a default/constant (fresh calls are used as is). */
  private freshValue(v: R, b: Body): string {
    return v.js && !isPure(v.js) ? v.js : this.fresh(v.ty, this.comps(v, b));
  }

  /** Expression creating a new value object (only for defaults/constants, which run once). */
  private fresh(ty: string, comps: string[]): string {
    return `${this.use('@tessera/core', ty)}(${comps.join(', ')})`;
  }

  private comps(r: R, b: Body): string[] {
    if (r.comps) return r.comps;
    const keys = VALUE[r.ty] as string[];
    if (isPure(r.js)) return keys.map((k) => `${r.js}.${k}`);
    const t = this.temp(b);
    return keys.map((k, i) => (i === 0 ? `(${t} = ${r.js}).${k}` : `${t}.${k}`));
  }

  /** An expression evaluating (once) to an object holding the value. */
  private obj(r: R): string {
    if (r.js) return r.js;
    const s = this.scratchOf(r.ty);
    const keys = VALUE[r.ty] as string[];
    return `(${(r.comps as string[]).map((c, i) => `${s}.${keys[i]} = ${c}`).join(', ')}, ${s})`;
  }

  private valueR(ty: string, comps: string[]): R {
    return { ty, js: '', comps };
  }

  private expectType(v: R, ty: string, at: Pos): void {
    if (v.ty === ty) return;
    if (isNum(v.ty) && isNum(ty)) return;
    if (v.ty === 'none' && ty === 'Entity') return;
    this.fail(`expected ${ty}, got ${v.ty}`, at);
  }

  private lookup(name: string, b: Body): Var | undefined {
    for (let i = b.scopes.length - 1; i >= 0; i--) {
      const v = b.scopes[i]?.get(name);
      if (v) return v;
    }
    return this.consts.get(name);
  }

  private expr(e: Expr, b: Body): R {
    switch (e.kind) {
      case 'num':
        return { ty: e.int ? 'int' : 'float', js: e.value };
      case 'str':
        return { ty: 'string', js: e.value };
      case 'bool':
        return { ty: 'bool', js: String(e.value) };
      case 'none':
        return { ty: 'none', js: '0' };
      case 'ident':
        return this.ident(e, b);
      case 'member':
        return this.member(e, b);
      case 'call':
        return this.call(e, b);
      case 'struct':
        return this.fail(`${e.name} { ... } literals are only for spawn() and emit()`, e);
      case 'unary': {
        const v = this.expr(e.expr, b);
        if (e.op === '!') {
          if (v.ty !== 'bool') this.fail(`! needs a bool, got ${v.ty}`, e);
          return { ty: 'bool', js: `!${v.js}` };
        }
        if (isValue(v.ty) && e.op === '-')
          return this.valueR(
            v.ty,
            this.comps(v, b).map((c) => `-${c}`),
          );
        if (!isNum(v.ty)) this.fail(`${e.op} needs a number, got ${v.ty}`, e);
        return { ty: v.ty, js: `${e.op}${v.js}` };
      }
      case 'update': {
        const t = this.expr(e.target, b);
        this.writableTarget(t, e.target);
        if (!isNum(t.ty)) this.fail(`${e.op} needs a number, got ${t.ty}`, e);
        return { ty: t.ty, js: `${t.js}${e.op}` };
      }
      case 'assign':
        return this.fail('assignments are statements in Tess: put it on its own line', e);
      case 'cond': {
        const c = this.cond(e.cond, b);
        const x = this.expr(e.then, b);
        const y = this.expr(e.else, b);
        this.expectType(y, x.ty, e.else);
        if (isValue(x.ty)) {
          const s = this.repeatable(c, b);
          const xc = this.comps(x, b);
          const yc = this.comps(y, b);
          return this.valueR(
            x.ty,
            xc.map((xi, i) => `(${i === 0 ? s.first : s.ref} ? ${xi} : ${yc[i]})`),
          );
        }
        return { ty: x.ty === 'none' ? y.ty : x.ty, js: `(${c} ? ${x.js} : ${y.js})` };
      }
      case 'binary':
        return this.binary(e, b);
    }
  }

  private ident(e: Extract<Expr, { kind: 'ident' }>, b: Body): R {
    const v = this.lookup(e.name, b);
    if (v)
      return {
        ty: v.ty,
        js: v.js,
        lvalue: v.js !== v.name || SCALARS.includes(v.ty) || isValue(v.ty),
        writable: v.writable,
        root: v,
      };
    if (e.name === 'dt' || e.name === 'time' || e.name === 'frame') {
      if (b.ret === 'const') this.fail(`${e.name} is not available in defaults`, e);
      return { ty: e.name === 'frame' ? 'int' : 'float', js: `$w.${e.name}` };
    }
    if (e.name === 'PI') return { ty: 'float', js: 'Math.PI' };
    if (this.structs.has(e.name) || ENGINE[e.name]) {
      this.fail(`"${e.name}" is a type: use get<${e.name}>(e) or a system parameter`, e);
    }
    const names = [
      ...b.scopes.flatMap((s) => [...s.keys()]),
      ...this.consts.keys(),
      'dt',
      'time',
      'frame',
      'PI',
    ];
    return this.fail(`unknown name "${e.name}"${suggest(e.name, names)}`, e);
  }

  private member(e: Extract<Expr, { kind: 'member' }>, b: Body): R {
    const o = this.expr(e.obj, b);
    const keys = VALUE[o.ty];
    if (keys) {
      const i = keys.indexOf(e.name);
      if (i < 0) this.fail(`${o.ty} has no field "${e.name}" (fields: ${keys.join(', ')})`, e);
      if (o.js && isPure(o.js))
        return {
          ty: 'float',
          js: `${o.js}.${e.name}`,
          lvalue: o.lvalue,
          writable: o.writable,
          root: o.root,
        };
      return { ty: 'float', js: `(${this.obj(o)}).${e.name}` };
    }
    const info = this.struct(o.ty);
    if (!info) return this.fail(`${o.ty} has no fields`, e);
    const fty = info.fields.get(e.name);
    if (!fty) {
      const hint =
        suggest(e.name, [...info.fields.keys()]) ||
        ` (fields: ${[...info.fields.keys()].join(', ')})`;
      this.fail(`${o.ty} has no field "${e.name}"${hint}`, e);
    }
    return { ty: fty, js: `${o.js}.${e.name}`, lvalue: true, writable: o.writable, root: o.root };
  }

  private binary(e: Extract<Expr, { kind: 'binary' }>, b: Body): R {
    const l = this.expr(e.left, b);
    const r = this.expr(e.right, b);
    const op = e.op;
    if (op === '&&' || op === '||') {
      if (l.ty !== 'bool' || r.ty !== 'bool')
        this.fail(`${op} needs bools, got ${l.ty} and ${r.ty}`, e);
      return { ty: 'bool', js: `(${l.js} ${op} ${r.js})` };
    }
    if (op === '==' || op === '!=') {
      if (isValue(l.ty) || isValue(r.ty))
        this.fail(`compare ${l.ty} fields instead (a.x == b.x)`, e);
      const ok =
        l.ty === r.ty ||
        (isNum(l.ty) && isNum(r.ty)) ||
        [l.ty, r.ty].every((t) => t === 'Entity' || t === 'none');
      if (!ok) {
        const hit = l.ty.startsWith('RayHit') || r.ty.startsWith('RayHit');
        this.fail(`cannot compare ${l.ty} with ${r.ty}${hit ? ': compare its .entity' : ''}`, e);
      }
      return { ty: 'bool', js: `(${l.js} ${op}= ${r.js})` };
    }
    if (['<', '<=', '>', '>='].includes(op)) {
      if (!isNum(l.ty) || !isNum(r.ty))
        this.fail(`${op} needs numbers, got ${l.ty} and ${r.ty}`, e);
      return { ty: 'bool', js: `(${l.js} ${op} ${r.js})` };
    }
    if (op === '+' && (l.ty === 'string' || r.ty === 'string'))
      return { ty: 'string', js: `(${l.js} + ${r.js})` };
    if (isNum(l.ty) && isNum(r.ty)) {
      const int = l.ty === 'int' && r.ty === 'int';
      if (op === '/' && int) return { ty: 'int', js: `Math.trunc(${l.js} / ${r.js})` };
      return { ty: int ? 'int' : 'float', js: `(${l.js} ${op} ${r.js})` };
    }
    if (l.ty === 'quat' && op === '*' && (r.ty === 'quat' || r.ty === 'vec3')) {
      const fn = r.ty === 'quat' ? 'multiply' : 'rotate';
      return {
        ty: r.ty,
        js: `${this.use('@tessera/core', 'quat')}.${fn}(${this.obj(l)}, ${this.obj(r)}, ${this.scratchOf(r.ty)})`,
      };
    }
    if (isValue(l.ty) && l.ty === r.ty && (op === '+' || op === '-')) {
      const rc = this.comps(r, b);
      return this.valueR(
        l.ty,
        this.comps(l, b).map((c, i) => `(${c} ${op} ${rc[i]})`),
      );
    }
    if (isValue(l.ty) && isNum(r.ty) && (op === '*' || op === '/')) {
      const lc = this.comps(l, b);
      const s = this.repeatable(r.js, b);
      return this.valueR(
        l.ty,
        lc.map((c, i) => `(${c} ${op} ${i === 0 ? s.first : s.ref})`),
      );
    }
    if (isNum(l.ty) && isValue(r.ty) && op === '*') {
      const s = this.repeatable(l.js, b);
      return this.valueR(
        r.ty,
        this.comps(r, b).map((c, i) => `(${i === 0 ? s.first : s.ref} * ${c})`),
      );
    }
    return this.fail(`${l.ty} ${op} ${r.ty} is not supported`, e);
  }

  // ---------------------------------------------------------------- calls

  private args(
    e: Extract<Expr, { kind: 'call' }>,
    b: Body,
    types: string[],
    min = types.length,
  ): R[] {
    if (e.args.length < min || e.args.length > types.length) {
      const n = min === types.length ? `${min}` : `${min} to ${types.length}`;
      this.fail(
        `${e.name}() takes ${n} argument${types.length === 1 ? '' : 's'}, got ${e.args.length}`,
        e,
      );
    }
    return e.args.map((a, i) => {
      const v = this.expr(a, b);
      const ty = types[i] as string;
      if (ty === 'num') {
        if (!isNum(v.ty))
          this.fail(`${e.name}() argument ${i + 1} must be a number, got ${v.ty}`, a);
      } else if (ty !== 'any') this.expectType(v, ty, a);
      return v;
    });
  }

  private needsWorld(e: Pos, b: Body, name: string): void {
    if (b.ret === 'const') this.fail(`${name}() is not available in defaults and constants`, e);
  }

  private typeArg(e: Extract<Expr, { kind: 'call' }>, kind: 'component' | 'event'): string {
    const t = e.typeArg;
    if (!t) return this.fail(`${e.name} needs a type: ${e.name}<Name>(...)`, e);
    const info = this.struct(t);
    if (!info || info.kind !== kind) this.fail(`"${t}" is not a ${kind}`, e);
    return t;
  }

  private call(e: Extract<Expr, { kind: 'call' }>, b: Body): R {
    const core = (n: string) => this.use('@tessera/core', n);
    const n = e.name;
    if (e.typeArg && !['get', 'has', 'add', 'remove', 'events'].includes(n)) {
      this.fail(`${n} takes no <type>`, e);
    }
    if (MATH1.includes(n)) {
      const [x] = this.args(e, b, ['num']);
      return { ty: n === 'abs' ? (x as R).ty : 'float', js: `Math.${n}(${(x as R).js})` };
    }
    if (MATH2.includes(n)) {
      const [x, y] = this.args(e, b, ['num', 'num']) as [R, R];
      const int = (n === 'min' || n === 'max') && x.ty === 'int' && y.ty === 'int';
      return { ty: int ? 'int' : 'float', js: `Math.${n}(${x.js}, ${y.js})` };
    }
    switch (n) {
      case 'clamp': {
        const [x, lo, hi] = this.args(e, b, ['num', 'num', 'num']) as [R, R, R];
        return { ty: x.ty, js: `Math.min(Math.max(${x.js}, ${lo.js}), ${hi.js})` };
      }
      case 'float':
        return { ty: 'float', js: (this.args(e, b, ['num'])[0] as R).js };
      case 'int':
        return { ty: 'int', js: `Math.trunc(${(this.args(e, b, ['num'])[0] as R).js})` };
      case 'lerp': {
        const [x, y, t] = this.args(e, b, ['any', 'any', 'num']) as [R, R, R];
        this.expectType(y, x.ty, e.args[1] as Expr);
        if (isValue(x.ty)) {
          const s = this.repeatable(t.js, b);
          const yc = this.comps(y, b);
          return this.valueR(
            x.ty,
            this.comps(x, b).map((c, i) => {
              const a = this.repeatable(c, b);
              return `(${a.first} + (${yc[i]} - ${a.ref}) * ${i === 0 ? s.first : s.ref})`;
            }),
          );
        }
        if (!isNum(x.ty)) this.fail('lerp() works on numbers and vectors', e);
        const a = this.repeatable(x.js, b);
        return { ty: 'float', js: `(${a.first} + (${y.js} - ${a.ref}) * ${t.js})` };
      }
      case 'vec2':
      case 'vec3':
      case 'quat': {
        const types = Array((VALUE[n] as string[]).length).fill('num');
        return this.valueR(
          n,
          this.args(e, b, types).map((a) => a.js),
        );
      }
      case 'color': {
        if (e.args.length === 1) {
          const [hex] = this.args(e, b, ['string']) as [R];
          return {
            ty: 'color',
            js: `${core('color')}.hex(${hex.js}, ${this.scratchOf('color')})`,
          };
        }
        const cs = this.args(e, b, ['num', 'num', 'num', 'num'], 3).map((a) => a.js);
        return this.valueR('color', [...cs, ...(cs.length === 3 ? ['1'] : [])]);
      }
      case 'euler': {
        const [x, y, z] = this.args(e, b, ['num', 'num', 'num']) as [R, R, R];
        const out = this.scratchOf('quat');
        return { ty: 'quat', js: `${core('quat')}.fromEuler(${x.js}, ${y.js}, ${z.js}, ${out})` };
      }
      case 'axisAngle': {
        const [axis, angle] = this.args(e, b, ['vec3', 'num']) as [R, R];
        const out = this.scratchOf('quat');
        return {
          ty: 'quat',
          js: `${core('quat')}.fromAxisAngle(${this.obj(axis)}, ${angle.js}, ${out})`,
        };
      }
      case 'len': {
        const [v] = this.args(e, b, ['any']) as [R];
        this.vectorArg(v, e);
        return { ty: 'float', js: `Math.hypot(${this.comps(v, b).join(', ')})` };
      }
      case 'dist': {
        const [x, y] = this.args(e, b, ['any', 'any']) as [R, R];
        this.vectorArg(x, e);
        this.expectType(y, x.ty, e.args[1] as Expr);
        const yc = this.comps(y, b);
        return {
          ty: 'float',
          js: `Math.hypot(${this.comps(x, b)
            .map((c, i) => `${c} - ${yc[i]}`)
            .join(', ')})`,
        };
      }
      case 'dot': {
        const [x, y] = this.args(e, b, ['any', 'any']) as [R, R];
        this.vectorArg(x, e);
        this.expectType(y, x.ty, e.args[1] as Expr);
        const yc = this.comps(y, b);
        return {
          ty: 'float',
          js: `(${this.comps(x, b)
            .map((c, i) => `${c} * ${yc[i]}`)
            .join(' + ')})`,
        };
      }
      case 'cross': {
        const [x, y] = this.args(e, b, ['vec3', 'vec3']) as [R, R];
        return {
          ty: 'vec3',
          js: `${core('vec3')}.cross(${this.obj(x)}, ${this.obj(y)}, ${this.scratchOf('vec3')})`,
        };
      }
      case 'normalize': {
        const [v] = this.args(e, b, ['any']) as [R];
        this.vectorArg(v, e);
        const c = this.comps(v, b).map((x) => this.repeatable(x, b));
        const l = this.temp(b);
        const head = `${c.map((x) => (x.first !== x.ref ? `${x.first}, ` : '')).join('')}${l} = Math.hypot(${c.map((x) => x.ref).join(', ')})`;
        return this.valueR(
          v.ty,
          c.map((x, i) => `${i === 0 ? `(${head}, ` : '('}${l} > 0 ? ${x.ref} / ${l} : 0)`),
        );
      }
      case 'random': {
        this.needsWorld(e, b, n);
        const a = this.args(e, b, ['num', 'num'], 0);
        if (a.length === 1) this.fail('random() takes 0 or 2 arguments', e);
        return {
          ty: 'float',
          js: a.length === 0 ? '$w.rng.next()' : `$w.rng.range(${a[0]?.js}, ${a[1]?.js})`,
        };
      }
      case 'ease': {
        const [k, t] = this.args(e, b, ['string', 'num']) as [R, R];
        return { ty: 'float', js: `${core('ease')}(${k.js}, ${t.js})` };
      }
      case 'randomInt': {
        this.needsWorld(e, b, n);
        const [x, y] = this.args(e, b, ['num', 'num']) as [R, R];
        return { ty: 'int', js: `$w.rng.int(${x.js}, ${y.js})` };
      }
      case 'destroy':
      case 'alive': {
        this.needsWorld(e, b, n);
        const [x] = this.args(e, b, ['Entity']) as [R];
        return { ty: n === 'alive' ? 'bool' : 'void', js: `$w.${n}(${x.js})` };
      }
      case 'has':
      case 'get':
      case 'add':
      case 'remove': {
        this.needsWorld(e, b, n);
        const t = this.typeArg(e, 'component');
        const [x] = this.args(e, b, ['Entity']) as [R];
        if (n === 'has') {
          b.reads.add(t);
          return { ty: 'bool', js: `$w.has(${x.js}, ${t})` };
        }
        b.writes.add(t);
        if (n === 'remove') return { ty: 'void', js: `$w.remove(${x.js}, ${t})` };
        const js =
          n === 'get'
            ? `${this.use('@tessera/compiler/runtime', '$get')}($w, ${x.js}, ${t})`
            : `$w.add(${x.js}, ${t})`;
        return { ty: t, js, writable: true };
      }
      case 'spawn':
        return this.spawn(e, b);
      case 'emit': {
        this.needsWorld(e, b, n);
        const lit = e.args[0];
        if (e.args.length !== 1 || lit?.kind !== 'struct')
          this.fail('emit takes one event literal: emit(Hit { target = e })', e);
        const info = this.structs.get(lit.name);
        if (info?.kind !== 'event')
          this.fail(`"${lit.name}" is not an event: declare it with \`event\``, lit);
        b.writes.add(lit.name);
        return {
          ty: 'void',
          js: `$w.emit(${lit.name}, Object.assign($new${lit.name}(), ${this.literal(lit, b, true)}))`,
        };
      }
      case 'events':
        return this.fail('events<T>() is only for range-for: for (Hit h : events<Hit>())', e);
      case 'overlap':
        return this.fail('overlap() is only for range-for: for (Entity o : overlap(...))', e);
      case 'down':
      case 'pressed':
      case 'released': {
        this.needsWorld(e, b, n);
        const [a] = this.args(e, b, ['string']) as [R];
        const fn = { down: 'isDown', pressed: 'wasPressed', released: 'wasReleased' }[n];
        return { ty: 'bool', js: `${this.use('@tessera/input', fn)}($w, ${a.js})` };
      }
      case 'axis': {
        this.needsWorld(e, b, n);
        const [a] = this.args(e, b, ['string']) as [R];
        return { ty: 'vec2', js: `${this.use('@tessera/input', 'axis')}($w, ${a.js})` };
      }
      case 'mouse':
        this.needsWorld(e, b, n);
        this.args(e, b, []);
        return {
          ty: 'vec2',
          js: `${this.use('@tessera/render', 'mouse')}($w, ${this.scratchOf('vec2')})`,
        };
      case 'mouseRay':
        this.needsWorld(e, b, n);
        this.args(e, b, []);
        this.struct('Ray');
        return { ty: 'Ray', js: `${this.use('@tessera/render', 'mouseRay')}($w)` };
      case 'raycast': {
        this.needsWorld(e, b, n);
        const [o, d, max, ex] = this.args(e, b, ['any', 'any', 'num', 'Entity'], 3) as [
          R,
          R,
          R,
          R | undefined,
        ];
        this.vectorArg(o, e);
        this.expectType(d, o.ty, e.args[1] as Expr);
        const opts = ex ? `{ exclude: ${ex.js} }` : '{}';
        const ty = o.ty === 'vec2' ? 'RayHit2D' : 'RayHit';
        this.struct(ty);
        const m = this.repeatable(max.js, b);
        return {
          ty,
          js: `(${this.use('@tessera/physics', 'raycast')}($w, ${this.obj(o)}, ${this.obj(d)}, ${m.first}, ${opts}) ?? ${this.use('@tessera/compiler/runtime', '$noHit')}(${m.ref}))`,
        };
      }
      case 'play':
      case 'music': {
        this.needsWorld(e, b, n);
        const [a, ...rest] = this.args(e, b, ['string', 'any', 'num', 'num'], 1) as R[];
        const url = this.assetUrl(a as R);
        if (n === 'music') {
          if (rest.length > 0) this.fail('music() takes the file only: music("theme.ogg")', e);
          return { ty: 'void', js: `${this.use('@tessera/audio', 'playMusic')}($w, ${url})` };
        }
        const at = rest[0] && isValue(rest[0].ty) ? rest.shift() : undefined;
        if (at) this.vectorArg(at, e);
        if (rest.length > 2 || rest.some((r) => !isNum(r.ty)))
          this.fail('play(file, volume = 1, pitch = 1) or play(file, position, volume, pitch)', e);
        const opts = [
          at ? `position: ${this.fresh(at.ty, this.comps(at, b))}` : '',
          rest[0] ? `volume: ${rest[0].js}` : '',
          rest[1] ? `pitch: ${rest[1].js}` : '',
        ].filter(Boolean);
        return {
          ty: 'int',
          js: `${this.use('@tessera/audio', 'playSound')}($w, ${url}${opts.length ? `, { ${opts.join(', ')} }` : ''})`,
        };
      }
      case 'stop': {
        this.needsWorld(e, b, n);
        const [id] = this.args(e, b, ['num']) as [R];
        return { ty: 'void', js: `${this.use('@tessera/audio', 'stopSound')}($w, ${id.js})` };
      }
      case 'volume': {
        this.needsWorld(e, b, n);
        const [bus, v] = this.args(e, b, ['string', 'num']) as [R, R];
        return {
          ty: 'void',
          js: `${this.use('@tessera/audio', 'setVolume')}($w, ${bus.js}, ${v.js})`,
        };
      }
      case 'loadScene': {
        this.needsWorld(e, b, n);
        const [path, ...keep] = e.args;
        if (!path) return this.fail('loadScene needs a scene path: loadScene("level2.yaml")', e);
        const p = this.expr(path, b);
        this.expectType(p, 'string', path);
        const names = keep.map((k) => {
          if (k.kind !== 'ident' || this.struct(k.name)?.kind !== 'resource')
            this.fail('loadScene keeps resources by name: loadScene("level2.yaml", Score)', k);
          return k.name;
        });
        return {
          ty: 'void',
          js: `${this.use('@tessera/scene', 'loadScene')}($w, ${p.js}, [${names.join(', ')}])`,
        };
      }
      case 'log':
        return {
          ty: 'void',
          js: `console.log(${e.args
            .map((a) => {
              const v = this.expr(a, b);
              return isValue(v.ty) ? this.obj(v) : v.js;
            })
            .join(', ')})`,
        };
    }
    const fn = this.fns.get(n);
    if (!fn) {
      const builtins = [
        'abs',
        'min',
        'max',
        'clamp',
        'lerp',
        'len',
        'dist',
        'dot',
        'cross',
        'normalize',
        'random',
        'randomInt',
        'ease',
        'spawn',
        'destroy',
        'alive',
        'get',
        'has',
        'add',
        'remove',
        'emit',
        'down',
        'pressed',
        'released',
        'axis',
        'mouse',
        'mouseRay',
        'raycast',
        'overlap',
        'play',
        'stop',
        'volume',
        'music',
        'loadScene',
        'log',
        'euler',
        'axisAngle',
        'vec2',
        'vec3',
        'quat',
        'color',
        ...MATH1,
        ...MATH2,
      ];
      return this.fail(
        `unknown function "${n}"${suggest(n, [...this.fns.keys(), ...builtins])}`,
        e,
      );
    }
    this.needsWorld(e, b, n);
    const args = this.args(
      e,
      b,
      fn.params.map((p) => p.ty),
    ).map((a, i) => {
      const p = fn.params[i] as Fn['params'][number];
      if (p.ref && !a.writable) {
        this.fail(`"${p.name}" is ${p.ty}& but this argument is read-only`, e.args[i] as Expr);
      }
      return isValue(a.ty) ? this.obj(a) : a.js;
    });
    if (isValue(fn.ret)) args.push(this.scratchOf(fn.ret));
    return { ty: fn.ret, js: `${n}(${['$w', ...args].join(', ')})` };
  }

  /** Asset string literals resolve next to the compiled module. */
  private assetUrl(a: R): string {
    return ASSET.test(a.js) && !/^"(\/|[a-z]+:)/i.test(a.js)
      ? `new URL(${a.js}, import.meta.url).href`
      : a.js;
  }

  private vectorArg(v: R, e: Pos & { name?: string }): void {
    if (v.ty !== 'vec2' && v.ty !== 'vec3') this.fail(`expected vec2 or vec3, got ${v.ty}`, e);
  }

  private spawn(e: Extract<Expr, { kind: 'call' }>, b: Body): R {
    this.needsWorld(e, b, 'spawn');
    const [prefab, ...lits] = e.args;
    if (prefab?.kind !== 'str') this.fail('spawn needs a prefab name: spawn("Coin", ...)', e);
    const parts = lits.map((lit) => {
      if (lit.kind !== 'struct')
        this.fail('spawn overrides are component literals: Transform2D { position = p }', lit);
      const info = this.struct(lit.name);
      if (info?.kind !== 'component') this.fail(`"${lit.name}" is not a component`, lit);
      b.writes.add(lit.name);
      return `${lit.name}: ${this.literal(lit, b, false)}`;
    });
    return {
      ty: 'Entity',
      js: `${this.use('@tessera/scene', 'spawnPrefab')}($w, ${prefab.value}, { ${parts.join(', ')} })`,
    };
  }

  /** `{ field: value }` for a component/event literal; value types become objects. */
  private literal(lit: Extract<Expr, { kind: 'struct' }>, b: Body, copy: boolean): string {
    const info = this.struct(lit.name) as StructInfo;
    const fields = lit.fields.map((f) => {
      const ty = info.fields.get(f.name);
      if (!ty)
        this.fail(
          `${lit.name} has no field "${f.name}"${suggest(f.name, [...info.fields.keys()])}`,
          f.pos,
        );
      const v = this.expr(f.value, b);
      this.expectType(v, ty, f.pos);
      // Events outlive the frame, so they get fresh objects; spawn() copies fields itself.
      const js = isValue(ty) ? (copy ? this.fresh(ty, this.comps(v, b)) : this.obj(v)) : v.js;
      return `${f.name}: ${js}`;
    });
    return `{ ${fields.join(', ')} }`;
  }
}

function show(e: Expr): string {
  if (e.kind === 'ident') return e.name;
  if (e.kind === 'member') return `${show(e.obj)}.${e.name}`;
  if (e.kind === 'call') return `${e.name}(...)`;
  return 'expression';
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
