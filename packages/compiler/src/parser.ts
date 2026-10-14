import type { Decl, Expr, Field, Param, Stmt, TypeRef } from './ast';
import { lex, type Pos, TessError, type Token } from './lexer';

const VALUE_TYPES = [
  'float',
  'int',
  'bool',
  'string',
  'Entity',
  'vec2',
  'vec3',
  'quat',
  'color',
  'auto',
  'void',
];

/** C++ habits mapped to their Tess equivalent (spec: "Not in Tess"). */
const CPP: Record<string, string> = {
  '#': 'Tess has no #include or preprocessor: use `using "./other.tess";`',
  '->': 'Tess has no pointers: use `.` (a.b)',
  '::': 'Tess has no `::`: use `.`',
  std: 'Tess has no std::: use built-ins (std::min -> min, std::cout -> log, std::vector -> not needed, use queries)',
  new: 'Tess has no `new`: use spawn("Prefab")',
  delete: 'Tess has no `delete`: use destroy(e)',
  nullptr: 'Tess has no nullptr: use `none`',
  NULL: 'Tess has no NULL: use `none`',
  class: 'Tess has no classes: use `component`, `resource` or `event`',
  struct: 'Tess has no structs: use `component`, `resource` or `event`',
  namespace: 'Tess has no namespaces: names are global to the scene',
  using: 'Tess `using` takes a file: using "./other.tess";',
  template: 'Tess has no templates',
  typedef: 'Tess has no typedef',
  unsigned: 'Tess has no unsigned: use int',
  double: 'Tess has no double: use float',
  long: 'Tess has no long: use int',
};

export function parse(src: string, file: string): Decl[] {
  return new Parser(lex(src, file), file).program();
}

class Parser {
  private i = 0;

  constructor(
    private readonly toks: Token[],
    private readonly file: string,
  ) {}

  private get tok(): Token {
    return this.toks[this.i] as Token;
  }
  private peek(n = 1): Token {
    return this.toks[Math.min(this.i + n, this.toks.length - 1)] as Token;
  }
  private fail(msg: string, at: Pos = this.tok): never {
    throw new TessError(this.file, { line: at.line, col: at.col }, msg);
  }
  private is(text: string, t: Token = this.tok): boolean {
    return t.text === text && (t.kind === 'punct' || t.kind === 'ident');
  }
  private eat(text: string): boolean {
    if (!this.is(text)) return false;
    this.i++;
    return true;
  }
  private expect(text: string, what = `"${text}"`): Token {
    if (!this.is(text)) {
      this.cpp();
      const got = this.tok.kind === 'eof' ? 'end of file' : `"${this.tok.text}"`;
      this.fail(`expected ${what}, got ${got}`);
    }
    return this.toks[this.i++] as Token;
  }
  private ident(what = 'a name'): Token {
    this.cpp();
    if (this.tok.kind !== 'ident')
      this.fail(`expected ${what}, got "${this.tok.text || 'end of file'}"`);
    return this.toks[this.i++] as Token;
  }
  /** Rejects C++ constructs at the current token with an actionable message. */
  private cpp(): void {
    const t = this.tok;
    if (t.kind === 'string' || t.kind === 'number') return;
    if (t.text === 'std' && this.is('::', this.peek())) this.fail(CPP.std as string);
    const msg = CPP[t.text];
    if (msg && t.text !== 'std') this.fail(msg);
  }

  program(): Decl[] {
    const decls: Decl[] = [];
    while (this.tok.kind !== 'eof') decls.push(this.decl());
    return decls;
  }

  private decl(): Decl {
    if (this.tok.text !== 'using') this.cpp();
    const t = this.tok;
    const at = { line: t.line, col: t.col };
    if (t.text === 'using' && this.peek().kind === 'string') {
      this.i++;
      const path = this.tok.text.slice(1, -1);
      if (!path.endsWith('.tess')) this.fail('`using` takes a .tess file: using "./other.tess";');
      this.i++;
      this.expect(';');
      return { kind: 'using', path, ...at };
    }
    if (this.eat('const')) {
      const type = this.type();
      const name = this.ident().text;
      this.expect('=');
      const value = this.expr();
      this.expect(';');
      return { kind: 'const', name, type, value, ...at };
    }
    if (t.text === 'component' || t.text === 'resource' || t.text === 'event') {
      this.i++;
      const name = this.ident(`a ${t.text} name`).text;
      this.expect('{');
      const fields: Field[] = [];
      while (!this.eat('}')) {
        const ft = this.tok;
        const type = this.type();
        const fname = this.ident('a field name').text;
        const init = this.eat('=') ? this.expr() : null;
        this.expect(';');
        fields.push({ name: fname, type, init, line: ft.line, col: ft.col });
      }
      this.eat(';');
      return { kind: t.text, name, fields, ...at };
    }
    if (this.eat('system')) {
      const name = this.ident('a system name').text;
      const params = this.params();
      return { kind: 'system', name, params, body: this.block(), ...at };
    }
    const ret = this.type();
    const name = this.ident('a function name').text;
    if (!this.is('('))
      this.fail('top level allows using, const, component, resource, event, system and functions');
    const params = this.params();
    return { kind: 'function', name, ret, params, body: this.block(), ...at };
  }

  private type(): TypeRef {
    const t = this.ident('a type');
    if (this.is('<')) this.fail('Tess has no templates: use a component or a query');
    if (this.is('*'))
      this.fail(`Tess has no pointers: use \`${t.text}&\` on system parameters, or Entity`);
    return { name: t.text, ref: this.eat('&'), line: t.line, col: t.col };
  }

  private params(): Param[] {
    this.expect('(');
    const out: Param[] = [];
    if (this.eat(')')) return out;
    do {
      const type = this.type();
      const name = this.ident('a parameter name');
      out.push({ name: name.text, type, line: type.line, col: type.col });
    } while (this.eat(','));
    this.expect(')', '")" or ","');
    return out;
  }

  private block(): Stmt[] {
    this.expect('{');
    const body: Stmt[] = [];
    while (!this.eat('}')) {
      if (this.tok.kind === 'eof') this.fail('missing "}"');
      body.push(this.stmt());
    }
    return body;
  }

  private body(): Stmt[] {
    return this.is('{') ? this.block() : [this.stmt()];
  }

  private isDecl(): boolean {
    const a = this.tok;
    const b = this.peek();
    if (a.kind !== 'ident' || CPP[a.text]) return false;
    if (b.kind === 'ident') return true;
    if (b.text === '&' && this.peek(2).kind === 'ident') return true;
    if (
      b.text === '*' &&
      this.peek(2).kind === 'ident' &&
      (VALUE_TYPES.includes(a.text) || /^[A-Z]/.test(a.text))
    ) {
      this.fail(`Tess has no pointers: use \`${a.text}&\` on system parameters, or Entity`, b);
    }
    return false;
  }

  private stmt(): Stmt {
    this.cpp();
    const t = this.tok;
    const at = { line: t.line, col: t.col };
    if (this.is('{')) return { kind: 'block', body: this.block(), ...at };
    if (this.eat('if')) {
      this.expect('(');
      const cond = this.expr();
      this.expect(')');
      const then = this.body();
      return { kind: 'if', cond, then, else: this.eat('else') ? this.body() : null, ...at };
    }
    if (this.eat('while')) {
      this.expect('(');
      const cond = this.expr();
      this.expect(')');
      return { kind: 'while', cond, body: this.body(), ...at };
    }
    if (this.eat('for')) return this.forStmt(at);
    if (this.eat('break')) return this.end({ kind: 'break', ...at });
    if (this.eat('continue')) return this.end({ kind: 'continue', ...at });
    if (this.eat('return'))
      return this.end({ kind: 'return', value: this.is(';') ? null : this.expr(), ...at });
    if (this.isDecl()) return this.end(this.varDecl());
    return this.end({ kind: 'expr', expr: this.expr(), ...at });
  }

  private end<T extends Stmt>(s: T): T {
    this.expect(';', '";"');
    return s;
  }

  private varDecl(): Stmt {
    const type = this.type();
    const name = this.ident('a variable name').text;
    const init = this.eat('=') ? this.expr() : null;
    if (type.name === 'auto' && !init) this.fail('`auto` needs an initializer: auto x = 1;', type);
    return {
      kind: 'var',
      type: type.name === 'auto' ? null : type,
      name,
      init,
      line: type.line,
      col: type.col,
    };
  }

  private forStmt(at: Pos): Stmt {
    this.expect('(');
    // Range-for: `for (A a, B& b : query)` or `for (Collision c : events<Collision>())`.
    const save = this.i;
    const vars: Param[] = [];
    if (this.tok.kind === 'ident') {
      try {
        do {
          const type = this.type();
          vars.push({ name: this.ident().text, type, line: type.line, col: type.col });
        } while (this.eat(','));
      } catch {
        vars.length = 0;
      }
    }
    if (vars.length > 0 && this.eat(':')) {
      if (this.eat('query')) {
        this.expect(')');
        return { kind: 'query', vars, body: this.body(), ...at };
      }
      const src = this.tok;
      if (src.text === 'overlap') {
        const source = this.expr();
        this.expect(')');
        if (vars.length !== 1)
          this.fail('overlap() gives one variable: for (Entity o : overlap(...))', src);
        return { kind: 'list', var: vars[0] as Param, source, body: this.body(), ...at };
      }
      if (!this.eat('events'))
        this.fail('range-for works on `query`, `events<Event>()` or `overlap(...)`', src);
      this.expect('<');
      const event = this.ident('an event name').text;
      this.expect('>');
      this.expect('(');
      this.expect(')');
      this.expect(')');
      if (vars.length !== 1)
        this.fail('events<...>() gives one variable: for (Hit h : events<Hit>())', src);
      return { kind: 'events', var: vars[0] as Param, event, body: this.body(), ...at };
    }
    this.i = save;
    const init = this.is(';')
      ? null
      : this.isDecl()
        ? this.varDecl()
        : { kind: 'expr' as const, expr: this.expr(), ...at };
    this.expect(';');
    const cond = this.is(';') ? null : this.expr();
    this.expect(';');
    const step = this.is(')') ? null : this.expr();
    this.expect(')');
    return { kind: 'for', init, cond, step, body: this.body(), ...at };
  }

  // Expressions, lowest precedence first.
  expr(): Expr {
    const left = this.ternary();
    const t = this.tok;
    if (t.kind === 'punct' && ['=', '+=', '-=', '*=', '/=', '%='].includes(t.text)) {
      this.i++;
      return {
        kind: 'assign',
        op: t.text,
        target: left,
        value: this.expr(),
        line: t.line,
        col: t.col,
      };
    }
    return left;
  }

  private ternary(): Expr {
    const cond = this.binary(0);
    const t = this.tok;
    if (!this.eat('?')) return cond;
    const then = this.expr();
    this.expect(':');
    return { kind: 'cond', cond, then, else: this.ternary(), line: t.line, col: t.col };
  }

  private static readonly LEVELS = [
    ['||'],
    ['&&'],
    ['==', '!='],
    ['<', '<=', '>', '>='],
    ['+', '-'],
    ['*', '/', '%'],
  ];

  private binary(level: number): Expr {
    const ops = Parser.LEVELS[level];
    if (!ops) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const t = this.tok;
      if (t.kind !== 'punct' || !ops.includes(t.text)) return left;
      this.i++;
      left = {
        kind: 'binary',
        op: t.text,
        left,
        right: this.binary(level + 1),
        line: t.line,
        col: t.col,
      };
    }
  }

  private unary(): Expr {
    const t = this.tok;
    if (t.kind === 'punct') {
      if (t.text === '&') this.fail('Tess has no address-of `&x`: pass the value, or use Entity');
      if (t.text === '*') this.fail('Tess has no pointers: remove the `*`');
      if (t.text === '-' || t.text === '!' || t.text === '+') {
        this.i++;
        return { kind: 'unary', op: t.text, expr: this.unary(), line: t.line, col: t.col };
      }
      if (t.text === '++' || t.text === '--') {
        this.i++;
        return { kind: 'update', op: t.text, target: this.unary(), line: t.line, col: t.col };
      }
    }
    return this.postfix();
  }

  private postfix(): Expr {
    let e = this.primary();
    for (;;) {
      const t = this.tok;
      if (this.eat('.')) {
        e = {
          kind: 'member',
          obj: e,
          name: this.ident('a field name').text,
          line: e.line,
          col: e.col,
        };
      } else if (t.text === '++' || t.text === '--') {
        this.i++;
        e = { kind: 'update', op: t.text, target: e, line: t.line, col: t.col };
      } else if (t.text === '->' || t.text === '::') {
        this.cpp();
      } else if (t.text === '[') {
        this.fail('Tess has no arrays or indexing: use queries and components');
      } else {
        return e;
      }
    }
  }

  private primary(): Expr {
    this.cpp();
    const t = this.tok;
    const at = { line: t.line, col: t.col };
    this.i++;
    if (t.kind === 'number')
      return { kind: 'num', value: t.text, int: !/[.eE]/.test(t.text), ...at };
    if (t.kind === 'string') return { kind: 'str', value: t.text, ...at };
    if (t.kind === 'punct' && t.text === '(') {
      if (
        this.tok.kind === 'ident' &&
        VALUE_TYPES.includes(this.tok.text) &&
        this.is(')', this.peek())
      ) {
        this.fail(`use a function-style cast: ${this.tok.text}(x)`);
      }
      const e = this.expr();
      this.expect(')');
      return e;
    }
    if (t.kind !== 'ident')
      this.fail(`expected an expression, got "${t.text || 'end of file'}"`, t);
    if (t.text === 'true' || t.text === 'false')
      return { kind: 'bool', value: t.text === 'true', ...at };
    if (t.text === 'none') return { kind: 'none', ...at };
    // name<Type>(args)
    if (
      this.is('<') &&
      this.peek().kind === 'ident' &&
      this.is('>', this.peek(2)) &&
      this.is('(', this.peek(3))
    ) {
      this.i++;
      const typeArg = this.ident().text;
      this.i++;
      return { kind: 'call', name: t.text, typeArg, args: this.args(), ...at };
    }
    if (this.is('('))
      return { kind: 'call', name: t.text, typeArg: null, args: this.args(), ...at };
    // Type { field = value, ... }
    if (
      /^[A-Z]/.test(t.text) &&
      this.is('{') &&
      (this.is('}', this.peek()) || this.is('=', this.peek(2)))
    ) {
      this.i++;
      const fields: { name: string; value: Expr; pos: Pos }[] = [];
      while (!this.eat('}')) {
        const f = this.ident('a field name');
        this.expect('=');
        fields.push({ name: f.text, value: this.expr(), pos: { line: f.line, col: f.col } });
        if (!this.eat(',')) {
          this.expect('}', '"," or "}"');
          break;
        }
      }
      return { kind: 'struct', name: t.text, fields, ...at };
    }
    return { kind: 'ident', name: t.text, ...at };
  }

  private args(): Expr[] {
    this.expect('(');
    const args: Expr[] = [];
    if (this.eat(')')) return args;
    do args.push(this.expr());
    while (this.eat(','));
    this.expect(')', '")" or ","');
    return args;
  }
}
