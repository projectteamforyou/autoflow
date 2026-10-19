/**
 * Safe expression language used by conditions, setVar, forEach and {{ }} interpolation.
 *
 * - No eval / Function, no property access on host objects, no I/O.
 * - Values: number, string, boolean, null, arrays.
 * - Operators: + - * / % ! && || == != < <= > >= ?: and parentheses; [index] on arrays/strings.
 * - Functions: a fixed allow-list (see FUNCTIONS).
 * - Bounded: max source length, max AST depth, max evaluation steps, max string/array size.
 *
 * The grammar is mirrored in the Rust and Kotlin executors.
 */

import { compileSafeRegex, MAX_PATTERN, RegexError, type SafeRegex } from "./safe-regex.js";

export type Value = number | string | boolean | null | Value[];

export class ExprError extends Error {
  constructor(message: string, public readonly pos = -1) {
    super(message);
    this.name = "ExprError";
  }
}

type Tok =
  | { t: "num"; v: number; p: number }
  | { t: "str"; v: string; p: number }
  | { t: "id"; v: string; p: number }
  | { t: "op"; v: string; p: number }
  | { t: "eof"; p: number };

const MAX_SOURCE = 2000;
const MAX_DEPTH = 64;
const MAX_STEPS = 20_000;
const MAX_STRING = 1_000_000;
const MAX_LIST = 100_000;

const OPS = ["&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "!", "<", ">", "(", ")", ",", "?", ":", "[", "]"];

function tokenize(src: string): Tok[] {
  if (src.length > MAX_SOURCE) throw new ExprError("expression too long");
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i))!;
      out.push({ t: "num", v: Number(m[0]), p: i });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const q = c;
      let s = "";
      let j = i + 1;
      for (;;) {
        if (j >= src.length) throw new ExprError("unterminated string", i);
        const d = src[j]!;
        if (d === "\\") {
          const n = src[j + 1];
          s += n === "n" ? "\n" : n === "t" ? "\t" : (n ?? "");
          j += 2;
          continue;
        }
        if (d === q) break;
        s += d;
        j++;
      }
      out.push({ t: "str", v: s, p: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: "id", v: m[0], p: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`unexpected character "${c}"`, i);
    out.push({ t: "op", v: op, p: i });
    i += op.length;
  }
  out.push({ t: "eof", p: src.length });
  return out;
}

export type Node =
  | { k: "lit"; v: Value }
  | { k: "var"; name: string }
  | { k: "un"; op: string; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "cond"; c: Node; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] }
  | { k: "idx"; a: Node; i: Node }
  | { k: "list"; items: Node[] };

const BP: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };

export function parse(src: string): Node {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos]!;
  const next = () => toks[pos++]!;
  const expectOp = (v: string) => {
    const t = next();
    if (t.t !== "op" || t.v !== v) throw new ExprError(`expected "${v}"`, t.p);
  };

  function primary(depth: number): Node {
    if (depth > MAX_DEPTH) throw new ExprError("expression too deep");
    const t = next();
    let node: Node;
    if (t.t === "num") node = { k: "lit", v: t.v };
    else if (t.t === "str") node = { k: "lit", v: t.v };
    else if (t.t === "id") {
      if (t.v === "true" || t.v === "false") node = { k: "lit", v: t.v === "true" };
      else if (t.v === "null") node = { k: "lit", v: null };
      else if (peek().t === "op" && (peek() as { v: string }).v === "(") {
        next();
        const args: Node[] = [];
        if (!(peek().t === "op" && (peek() as { v: string }).v === ")")) {
          for (;;) {
            args.push(expression(0, depth + 1));
            const s = peek();
            if (s.t === "op" && s.v === ",") {
              next();
              continue;
            }
            break;
          }
        }
        expectOp(")");
        if (!Object.prototype.hasOwnProperty.call(FUNCTIONS, t.v)) throw new ExprError(`unknown function "${t.v}"`, t.p);
        node = { k: "call", fn: t.v, args };
      } else node = { k: "var", name: t.v };
    } else if (t.t === "op" && t.v === "(") {
      node = expression(0, depth + 1);
      expectOp(")");
    } else if (t.t === "op" && t.v === "[") {
      const items: Node[] = [];
      if (!(peek().t === "op" && (peek() as { v: string }).v === "]")) {
        for (;;) {
          items.push(expression(0, depth + 1));
          const s = peek();
          if (s.t === "op" && s.v === ",") {
            next();
            continue;
          }
          break;
        }
      }
      expectOp("]");
      node = { k: "list", items };
    } else if (t.t === "op" && (t.v === "!" || t.v === "-")) {
      node = { k: "un", op: t.v, a: primary(depth + 1) };
      return node;
    } else throw new ExprError("unexpected token", t.p);
    // postfix index
    for (;;) {
      const s = peek();
      if (s.t === "op" && s.v === "[") {
        next();
        const i = expression(0, depth + 1);
        expectOp("]");
        node = { k: "idx", a: node, i };
      } else break;
    }
    return node;
  }

  function expression(minBp: number, depth: number): Node {
    let left = primary(depth + 1);
    for (;;) {
      const t = peek();
      if (t.t !== "op") break;
      if (t.v === "?" && minBp === 0) {
        next();
        const a = expression(0, depth + 1);
        expectOp(":");
        const b = expression(0, depth + 1);
        left = { k: "cond", c: left, a, b };
        continue;
      }
      const bp = BP[t.v];
      if (bp === undefined || bp <= minBp) break;
      next();
      const right = expression(bp, depth + 1);
      left = { k: "bin", op: t.v, a: left, b: right };
    }
    return left;
  }

  const n = expression(0, 0);
  if (peek().t !== "eof") throw new ExprError("unexpected trailing input", peek().p);
  return n;
}

export function truthy(v: Value): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

export function toStr(v: Value): string {
  if (v === null) return "";
  // Nested lists could otherwise stringify into hundreds of MB before any size guard runs.
  if (Array.isArray(v)) return listToStr(v, { left: MAX_STRING });
  return String(v);
}

function listToStr(list: Value[], budget: { left: number }): string {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const x = list[i]!;
    const s = Array.isArray(x) ? listToStr(x, budget) : x === null ? "" : String(x);
    budget.left -= s.length + (i > 0 ? 1 : 0);
    if (budget.left < 0) throw new ExprError("string too large");
    parts.push(s);
  }
  return parts.join(",");
}

/** `replace` without building an oversized result first: the output size is known up front. */
function replaceAll(s: string, from: string, to: string): string {
  let pieces: number;
  if (from === "") pieces = s.length;
  else {
    pieces = 1;
    for (let i = s.indexOf(from); i !== -1; i = s.indexOf(from, i + from.length)) pieces++;
  }
  const out = s.length - (from === "" ? 0 : (pieces - 1) * from.length) + Math.max(0, pieces - 1) * to.length;
  if (out > MAX_STRING) throw new ExprError("string too large");
  return s.split(from).join(to);
}

const regexCache = new Map<string, SafeRegex>();
function safeRegex(pattern: string): SafeRegex {
  let re = regexCache.get(pattern);
  if (!re) {
    try {
      re = compileSafeRegex(pattern);
    } catch (e) {
      if (e instanceof RegexError) throw new ExprError(`invalid pattern: ${e.message}`);
      throw e;
    }
    if (regexCache.size > 64) regexCache.clear();
    regexCache.set(pattern, re);
  }
  return re;
}

function toNum(v: Value): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null) return 0;
  if (Array.isArray(v)) return v.length;
  const n = Number(v);
  if (Number.isNaN(n)) throw new ExprError(`"${v}" is not a number`);
  return n;
}

function eq(a: Value, b: Value): boolean {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => eq(x, b[i]!));
  if (typeof a === "number" || typeof b === "number") {
    if (a === null || b === null) return a === b;
    const x = Number(a);
    const y = Number(b);
    if (!Number.isNaN(x) && !Number.isNaN(y)) return x === y;
  }
  return a === b;
}

function guard(v: Value): Value {
  if (typeof v === "string" && v.length > MAX_STRING) throw new ExprError("string too large");
  if (Array.isArray(v) && v.length > MAX_LIST) throw new ExprError("list too large");
  if (typeof v === "number" && !Number.isFinite(v)) throw new ExprError("number out of range");
  return v;
}

export interface ExprEnv {
  vars: Record<string, Value>;
  /** Deterministic clock and RNG so tests and replays are reproducible. */
  now?: () => number;
  random?: () => number;
}

type Fn = (args: Value[], env: ExprEnv) => Value;
const arity = (name: string, args: Value[], min: number, max = min) => {
  if (args.length < min || args.length > max) throw new ExprError(`${name}() expects ${min === max ? min : `${min}-${max}`} argument(s)`);
};

export const FUNCTIONS: Record<string, Fn> = {
  len: (a) => (arity("len", a, 1), Array.isArray(a[0]) ? a[0].length : toStr(a[0]!).length),
  upper: (a) => (arity("upper", a, 1), toStr(a[0]!).toUpperCase()),
  lower: (a) => (arity("lower", a, 1), toStr(a[0]!).toLowerCase()),
  trim: (a) => (arity("trim", a, 1), toStr(a[0]!).trim()),
  contains: (a) => {
    arity("contains", a, 2);
    return Array.isArray(a[0]) ? a[0].some((x) => eq(x, a[1]!)) : toStr(a[0]!).includes(toStr(a[1]!));
  },
  startsWith: (a) => (arity("startsWith", a, 2), toStr(a[0]!).startsWith(toStr(a[1]!))),
  endsWith: (a) => (arity("endsWith", a, 2), toStr(a[0]!).endsWith(toStr(a[1]!))),
  replace: (a) => (arity("replace", a, 3), replaceAll(toStr(a[0]!), toStr(a[1]!), toStr(a[2]!))),
  substr: (a) => {
    arity("substr", a, 2, 3);
    const s = toStr(a[0]!);
    const start = toNum(a[1]!);
    return a.length === 3 ? s.substr(start, toNum(a[2]!)) : s.substr(start);
  },
  split: (a) => (arity("split", a, 2), toStr(a[0]!).split(toStr(a[1]!)).slice(0, MAX_LIST)),
  join: (a) => {
    arity("join", a, 2);
    const items = Array.isArray(a[0]) ? a[0] : [a[0]!];
    const sep = toStr(a[1]!);
    let total = Math.max(0, items.length - 1) * sep.length;
    const parts = items.map((x) => {
      const p = toStr(x);
      total += p.length;
      if (total > MAX_STRING) throw new ExprError("string too large");
      return p;
    });
    return parts.join(sep);
  },
  num: (a) => (arity("num", a, 1), toNum(a[0]!)),
  str: (a) => (arity("str", a, 1), toStr(a[0]!)),
  round: (a) => {
    arity("round", a, 1, 2);
    const d = a.length === 2 ? Math.max(0, Math.min(10, toNum(a[1]!))) : 0;
    const f = 10 ** d;
    return Math.round(toNum(a[0]!) * f) / f;
  },
  floor: (a) => (arity("floor", a, 1), Math.floor(toNum(a[0]!))),
  ceil: (a) => (arity("ceil", a, 1), Math.ceil(toNum(a[0]!))),
  abs: (a) => (arity("abs", a, 1), Math.abs(toNum(a[0]!))),
  min: (a) => {
    if (!a.length) throw new ExprError("min() needs arguments");
    return Math.min(...a.map(toNum));
  },
  max: (a) => {
    if (!a.length) throw new ExprError("max() needs arguments");
    return Math.max(...a.map(toNum));
  },
  /** Integer in [lo, hi] inclusive. */
  random: (a, env) => {
    arity("random", a, 2);
    const lo = Math.ceil(toNum(a[0]!));
    const hi = Math.floor(toNum(a[1]!));
    return lo + Math.floor((env.random ?? Math.random)() * (hi - lo + 1));
  },
  /** Epoch milliseconds. */
  now: (a, env) => (arity("now", a, 0), (env.now ?? Date.now)()),
  hour: (a, env) => (arity("hour", a, 0), new Date((env.now ?? Date.now)()).getHours()),
  minute: (a, env) => (arity("minute", a, 0), new Date((env.now ?? Date.now)()).getMinutes()),
  weekday: (a, env) => (arity("weekday", a, 0), new Date((env.now ?? Date.now)()).getDay()),
  date: (a, env) => {
    arity("date", a, 0, 1);
    const d = new Date(a.length ? toNum(a[0]!) : (env.now ?? Date.now)());
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  },
  time: (a, env) => {
    arity("time", a, 0, 1);
    const d = new Date(a.length ? toNum(a[0]!) : (env.now ?? Date.now)());
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  },
  defined: (a, env) => {
    arity("defined", a, 1);
    return Object.prototype.hasOwnProperty.call(env.vars, toStr(a[0]!));
  },
  push: (a) => {
    arity("push", a, 2);
    const l = Array.isArray(a[0]) ? a[0] : [];
    return [...l, a[1]!];
  },
  range: (a) => {
    arity("range", a, 1, 2);
    const [lo, hi] = a.length === 1 ? [0, toNum(a[0]!)] : [toNum(a[0]!), toNum(a[1]!)];
    if (hi - lo > MAX_LIST) throw new ExprError("range too large");
    const out: number[] = [];
    for (let i = lo; i < hi; i++) out.push(i);
    return out;
  },
  /**
   * Regular-expression test. Patterns are untrusted (shared flows), so they run on a linear-time
   * engine (safe-regex.ts) instead of the backtracking RegExp engine.
   */
  matches: (a) => {
    arity("matches", a, 2);
    const pattern = toStr(a[1]!);
    if (pattern.length > MAX_PATTERN) throw new ExprError("pattern too long");
    // Kept for parity with the Rust and Kotlin engines, which reject the same patterns.
    if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) throw new ExprError("pattern too complex");
    return safeRegex(pattern).test(toStr(a[0]!).slice(0, 10_000));
  },
};

export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

export function evaluate(node: Node, env: ExprEnv): Value {
  let steps = 0;
  const ev = (n: Node): Value => {
    if (++steps > MAX_STEPS) throw new ExprError("expression too expensive");
    switch (n.k) {
      case "lit":
        return n.v;
      case "var":
        if (!Object.prototype.hasOwnProperty.call(env.vars, n.name)) throw new ExprError(`unknown variable "${n.name}"`);
        return env.vars[n.name]!;
      case "list":
        return guard(n.items.map(ev));
      case "un": {
        const v = ev(n.a);
        return n.op === "!" ? !truthy(v) : -toNum(v);
      }
      case "cond":
        return truthy(ev(n.c)) ? ev(n.a) : ev(n.b);
      case "idx": {
        const a = ev(n.a);
        const i = Math.trunc(toNum(ev(n.i)));
        if (Array.isArray(a)) return a[i < 0 ? a.length + i : i] ?? null;
        const s = toStr(a);
        return s[i < 0 ? s.length + i : i] ?? null;
      }
      case "call":
        return guard(FUNCTIONS[n.fn]!(n.args.map(ev), env));
      case "bin": {
        if (n.op === "&&") {
          const a = ev(n.a);
          return truthy(a) ? ev(n.b) : a;
        }
        if (n.op === "||") {
          const a = ev(n.a);
          return truthy(a) ? a : ev(n.b);
        }
        const a = ev(n.a);
        const b = ev(n.b);
        switch (n.op) {
          case "+":
            if (typeof a === "string" || typeof b === "string") return guard(toStr(a) + toStr(b));
            if (Array.isArray(a) && Array.isArray(b)) return guard([...a, ...b]);
            return guard(toNum(a) + toNum(b));
          case "-":
            return guard(toNum(a) - toNum(b));
          case "*":
            return guard(toNum(a) * toNum(b));
          case "/": {
            const d = toNum(b);
            if (d === 0) throw new ExprError("division by zero");
            return toNum(a) / d;
          }
          case "%": {
            const d = toNum(b);
            if (d === 0) throw new ExprError("division by zero");
            return toNum(a) % d;
          }
          case "==":
            return eq(a, b);
          case "!=":
            return !eq(a, b);
          case "<":
          case "<=":
          case ">":
          case ">=": {
            const both = typeof a === "string" && typeof b === "string";
            const x = both ? a : toNum(a);
            const y = both ? b : toNum(b);
            return n.op === "<" ? x < y : n.op === "<=" ? x <= y : n.op === ">" ? x > y : x >= y;
          }
        }
        throw new ExprError(`unknown operator ${n.op}`);
      }
    }
  };
  return ev(node);
}

const cache = new Map<string, Node>();
export function evalExpr(src: string, env: ExprEnv): Value {
  let n = cache.get(src);
  if (!n) {
    n = parse(src);
    if (cache.size > 500) cache.clear();
    cache.set(src, n);
  }
  return evaluate(n, env);
}

/** Returns null when valid, or a human-readable error. Used by the editor for live validation. */
export function checkExpr(src: string): string | null {
  try {
    parse(src);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Variables referenced by an expression (for lint "unknown variable" warnings). */
export function referencedVars(src: string): string[] {
  const out = new Set<string>();
  const walk = (n: Node) => {
    switch (n.k) {
      case "var":
        out.add(n.name);
        break;
      case "un":
        walk(n.a);
        break;
      case "bin":
        walk(n.a);
        walk(n.b);
        break;
      case "cond":
        walk(n.c);
        walk(n.a);
        walk(n.b);
        break;
      case "call":
        n.args.forEach(walk);
        break;
      case "idx":
        walk(n.a);
        walk(n.i);
        break;
      case "list":
        n.items.forEach(walk);
        break;
    }
  };
  try {
    walk(parse(src));
  } catch {
    /* invalid expressions are reported elsewhere */
  }
  return [...out];
}

export interface Placeholder {
  /** Index of the opening "{{". */
  start: number;
  /** Index just past the closing "}}". */
  end: number;
  /** Trimmed content between the braces. */
  inner: string;
}

/**
 * Finds `{{ … }}` placeholders in one linear pass. Same matches as the regular expression
 * /\{\{\s*([^}]+?)\s*\}\}/g, which backtracks quadratically on long runs of "{" or spaces.
 */
export function scanPlaceholders(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  let nextClose = -1;
  let i = text.indexOf("{{");
  while (i !== -1) {
    if (nextClose < i + 2) nextClose = text.indexOf("}", i + 2);
    if (nextClose === -1) break;
    // The content may not contain "}", so only the first "}" after "{{" can close it.
    if (text[nextClose + 1] === "}" && nextClose > i + 2) {
      const raw = text.slice(i + 2, nextClose);
      const inner = raw.trim();
      out.push({ start: i, end: nextClose + 2, inner: inner || raw.slice(-1) });
      i = text.indexOf("{{", nextClose + 2);
    } else i = text.indexOf("{{", i + 1);
  }
  return out;
}

/** Shown instead of a secret's value wherever text is logged or displayed. */
export const SECRET_MASK = "••••";

/**
 * Replaces {{ expr }} in text. {{secret:name}} is resolved through `secret` and never logged;
 * with `maskSecrets` the secret must exist but is rendered as SECRET_MASK (log messages).
 */
export function interpolate(text: string, env: ExprEnv, secret?: (name: string) => string | undefined, opts: { maskSecrets?: boolean } = {}): string {
  const found = scanPlaceholders(text);
  if (!found.length) return text;
  let out = "";
  let last = 0;
  for (const p of found) {
    out += text.slice(last, p.start);
    if (p.inner.startsWith("secret:")) {
      const name = p.inner.slice(7).trim();
      const v = secret?.(name);
      if (v === undefined) throw new ExprError(`secret "${name}" is not available on this device`);
      out += opts.maskSecrets ? SECRET_MASK : v;
    } else out += toStr(evalExpr(p.inner, env));
    if (out.length > MAX_STRING) throw new ExprError("string too large");
    last = p.end;
  }
  return out + text.slice(last);
}
