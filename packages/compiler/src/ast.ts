import type { Pos } from './lexer';

export interface TypeRef extends Pos {
  name: string;
  ref: boolean;
}

export interface Field extends Pos {
  name: string;
  type: TypeRef;
  init: Expr | null;
}

export interface Param extends Pos {
  name: string;
  type: TypeRef;
}

export type Decl =
  | ({ kind: 'using'; path: string } & Pos)
  | ({ kind: 'const'; name: string; type: TypeRef; value: Expr } & Pos)
  | ({ kind: 'component' | 'resource' | 'event'; name: string; fields: Field[] } & Pos)
  | ({ kind: 'system'; name: string; params: Param[]; body: Stmt[] } & Pos)
  | ({ kind: 'function'; name: string; ret: TypeRef; params: Param[]; body: Stmt[] } & Pos);

export type Stmt =
  | ({ kind: 'var'; type: TypeRef | null; name: string; init: Expr | null } & Pos)
  | ({ kind: 'expr'; expr: Expr } & Pos)
  | ({ kind: 'if'; cond: Expr; then: Stmt[]; else: Stmt[] | null } & Pos)
  | ({ kind: 'while'; cond: Expr; body: Stmt[] } & Pos)
  | ({ kind: 'for'; init: Stmt | null; cond: Expr | null; step: Expr | null; body: Stmt[] } & Pos)
  | ({ kind: 'query'; vars: Param[]; body: Stmt[] } & Pos)
  | ({ kind: 'events'; var: Param; event: string; body: Stmt[] } & Pos)
  /** `for (Entity o : overlap(...))`: a built-in returning entities. */
  | ({ kind: 'list'; var: Param; source: Expr; body: Stmt[] } & Pos)
  | ({ kind: 'break' | 'continue' } & Pos)
  | ({ kind: 'return'; value: Expr | null } & Pos)
  | ({ kind: 'block'; body: Stmt[] } & Pos);

export type Expr =
  | ({ kind: 'num'; value: string; int: boolean } & Pos)
  | ({ kind: 'str'; value: string } & Pos)
  | ({ kind: 'bool'; value: boolean } & Pos)
  | ({ kind: 'none' } & Pos)
  | ({ kind: 'ident'; name: string } & Pos)
  | ({ kind: 'member'; obj: Expr; name: string } & Pos)
  | ({ kind: 'call'; name: string; typeArg: string | null; args: Expr[] } & Pos)
  | ({ kind: 'struct'; name: string; fields: { name: string; value: Expr; pos: Pos }[] } & Pos)
  | ({ kind: 'unary'; op: string; expr: Expr } & Pos)
  | ({ kind: 'binary'; op: string; left: Expr; right: Expr } & Pos)
  | ({ kind: 'assign'; op: string; target: Expr; value: Expr } & Pos)
  | ({ kind: 'update'; op: '++' | '--'; target: Expr } & Pos)
  | ({ kind: 'cond'; cond: Expr; then: Expr; else: Expr } & Pos);
