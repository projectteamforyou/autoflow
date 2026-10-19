/**
 * Linear-time regular expressions for the `matches()` expression function.
 *
 * Patterns come from shared flows, so they are untrusted input. The JavaScript RegExp engine
 * backtracks: `^(a|a)*$` against "aaaa…b" takes exponential time and would freeze the tab or the
 * desktop/Android UI thread. This module compiles a pattern into a Thompson NFA and simulates it
 * with a Pike VM, so matching costs O(pattern × subject) in the worst case — like the Rust engine's
 * `regex` crate.
 *
 * Supported (the common, portable subset that Rust `regex` and Java share):
 *   literals and escapes (\. \\ \n \t \r \f \v \0, \xHH, \uHHHH), classes \d \D \w \W \s \S, `.`,
 *   [sets] with ranges / negation / class escapes, groups ( ) and (?: ), alternation |,
 *   quantifiers * + ? {n} {n,} {n,m} (lazy suffix `?` accepted), anchors ^ $ and \b \B.
 * Rejected with an error (instead of silently changing meaning): back-references, lookaround,
 * named groups and \p{…} properties.
 *
 * Matching works on UTF-16 code units, exactly like JavaScript strings, and is a search
 * (unanchored unless the pattern uses ^ / $), the same as `RegExp.prototype.test`.
 */

export class RegexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegexError";
  }
}

/** Pattern source limit (also enforced by the expression function). */
export const MAX_PATTERN = 200;
/** Upper bound for {n,m} counts. */
const MAX_REPEAT = 100;
/** Upper bound on compiled program size (after expanding counted repetitions). */
const MAX_PROGRAM = 5000;

type CharPred = (c: number) => boolean;

type Ast =
  | { k: "empty" }
  | { k: "char"; pred: CharPred }
  | { k: "cat"; items: Ast[] }
  | { k: "alt"; items: Ast[] }
  | { k: "rep"; a: Ast; min: number; max: number /* -1 = unbounded */ }
  | { k: "bol" }
  | { k: "eol" }
  | { k: "wordb"; negate: boolean };

const isDigit: CharPred = (c) => c >= 48 && c <= 57;
const isWord: CharPred = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
/** ECMAScript WhiteSpace + LineTerminator. */
const isSpace: CharPred = (c) =>
  c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 0xa0 || c === 0x1680 || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff;
const isLineTerminator: CharPred = (c) => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parse(): Ast {
    const ast = this.alternation();
    if (this.i < this.src.length) throw new RegexError(this.src[this.i] === ")" ? "unmatched ')'" : `unexpected "${this.src[this.i]}"`);
    return ast;
  }

  private peek(): string | undefined {
    return this.src[this.i];
  }

  private alternation(): Ast {
    const items = [this.concatenation()];
    while (this.peek() === "|") {
      this.i++;
      items.push(this.concatenation());
    }
    return items.length === 1 ? items[0]! : { k: "alt", items };
  }

  private concatenation(): Ast {
    const items: Ast[] = [];
    for (;;) {
      const c = this.peek();
      if (c === undefined || c === "|" || c === ")") break;
      items.push(this.quantified());
    }
    if (items.length === 0) return { k: "empty" };
    return items.length === 1 ? items[0]! : { k: "cat", items };
  }

  private quantified(): Ast {
    const atom = this.atom();
    const c = this.peek();
    let min: number;
    let max: number;
    if (c === "*") [min, max] = [0, -1];
    else if (c === "+") [min, max] = [1, -1];
    else if (c === "?") [min, max] = [0, 1];
    else if (c === "{") {
      const m = /^\{(\d{1,4})(?:(,)(\d{0,4}))?\}/.exec(this.src.slice(this.i));
      if (!m) return atom; // a literal "{" like JavaScript's Annex B
      min = Number(m[1]);
      max = m[2] ? (m[3] ? Number(m[3]) : -1) : min;
      if (min > MAX_REPEAT || max > MAX_REPEAT) throw new RegexError("repetition count too large");
      if (max !== -1 && max < min) throw new RegexError("numbers out of order in {} quantifier");
      this.i += m[0].length - 1;
    } else return atom;
    this.i++;
    if (this.peek() === "?") this.i++; // lazy: same result for a yes/no test
    const next = this.peek();
    if (next === "*" || next === "+" || next === "?") throw new RegexError("nothing to repeat");
    if (atom.k === "bol" || atom.k === "eol" || atom.k === "wordb") throw new RegexError("nothing to repeat");
    return { k: "rep", a: atom, min, max };
  }

  private atom(): Ast {
    const c = this.src[this.i++]!;
    switch (c) {
      case "(": {
        if (this.peek() === "?") {
          if (this.src[this.i + 1] !== ":") throw new RegexError("lookaround and named groups are not supported");
          this.i += 2;
        }
        const inner = this.alternation();
        if (this.peek() !== ")") throw new RegexError("unterminated group");
        this.i++;
        return inner;
      }
      case ".":
        return { k: "char", pred: (x) => !isLineTerminator(x) };
      case "^":
        return { k: "bol" };
      case "$":
        return { k: "eol" };
      case "[":
        return { k: "char", pred: this.charClass() };
      case "\\":
        return this.escape(false) as Ast;
      case "*":
      case "+":
      case "?":
        throw new RegexError("nothing to repeat");
      default: {
        const code = c.charCodeAt(0);
        return { k: "char", pred: (x) => x === code };
      }
    }
  }

  /** Parses the escape after a backslash. In a class, returns a predicate or a code unit. */
  private escape(inClass: boolean): Ast | CharPred | number {
    const c = this.src[this.i++];
    if (c === undefined) throw new RegexError("\\ at end of pattern");
    const lit = (code: number): Ast | number => (inClass ? code : { k: "char", pred: (x: number) => x === code });
    const cls = (pred: CharPred): Ast | CharPred => (inClass ? pred : { k: "char", pred });
    switch (c) {
      case "d":
        return cls(isDigit);
      case "D":
        return cls((x) => !isDigit(x));
      case "w":
        return cls(isWord);
      case "W":
        return cls((x) => !isWord(x));
      case "s":
        return cls(isSpace);
      case "S":
        return cls((x) => !isSpace(x));
      case "b":
        if (inClass) return 8;
        return { k: "wordb", negate: false };
      case "B":
        if (inClass) throw new RegexError("\\B is not allowed in a class");
        return { k: "wordb", negate: true };
      case "n":
        return lit(10);
      case "t":
        return lit(9);
      case "r":
        return lit(13);
      case "f":
        return lit(12);
      case "v":
        return lit(11);
      case "0":
        if (isDigit(this.src.charCodeAt(this.i))) throw new RegexError("back-references are not supported");
        return lit(0);
      case "x": {
        const m = /^[0-9A-Fa-f]{2}/.exec(this.src.slice(this.i));
        if (!m) return lit(120);
        this.i += 2;
        return lit(parseInt(m[0], 16));
      }
      case "u": {
        const m = /^[0-9A-Fa-f]{4}/.exec(this.src.slice(this.i));
        if (!m) return lit(117);
        this.i += 4;
        return lit(parseInt(m[0], 16));
      }
      case "p":
      case "P":
      case "k":
        throw new RegexError(`\\${c} is not supported`);
      default:
        if (c >= "1" && c <= "9") throw new RegexError("back-references are not supported");
        return lit(c.charCodeAt(0));
    }
  }

  private charClass(): CharPred {
    let negate = false;
    if (this.peek() === "^") {
      negate = true;
      this.i++;
    }
    const preds: CharPred[] = [];
    const ranges: [number, number][] = [];
    let first = true;
    for (;;) {
      const c = this.peek();
      if (c === undefined) throw new RegexError("unterminated character class");
      if (c === "]" && !first) {
        this.i++;
        break;
      }
      if (c === "]" && first) {
        // JavaScript: "[]" matches nothing, "[^]" matches anything.
        this.i++;
        return negate ? () => true : () => false;
      }
      first = false;
      const lo = this.classAtom();
      if (typeof lo !== "number") {
        preds.push(lo);
        continue;
      }
      if (this.peek() === "-" && this.src[this.i + 1] !== undefined && this.src[this.i + 1] !== "]") {
        this.i++;
        const hi = this.classAtom();
        if (typeof hi !== "number") {
          // [a-\d] is literal a, -, digits in JavaScript (Annex B).
          ranges.push([lo, lo], [45, 45]);
          preds.push(hi);
          continue;
        }
        if (hi < lo) throw new RegexError("range out of order in character class");
        ranges.push([lo, hi]);
      } else ranges.push([lo, lo]);
    }
    const test: CharPred = (x) => ranges.some(([a, b]) => x >= a && x <= b) || preds.some((p) => p(x));
    return negate ? (x) => !test(x) : test;
  }

  private classAtom(): number | CharPred {
    const c = this.src[this.i++]!;
    if (c !== "\\") return c.charCodeAt(0);
    return this.escape(true) as number | CharPred;
  }
}

/* --------------------------------------------------------------- compiler */

type Inst =
  | { op: "char"; pred: CharPred }
  | { op: "split"; x: number; y: number }
  | { op: "jmp"; x: number }
  | { op: "assert"; kind: "bol" | "eol" | "wordb" | "nwordb" }
  | { op: "match" };

class Compiler {
  readonly prog: Inst[] = [];

  private push(i: Inst): number {
    if (this.prog.length >= MAX_PROGRAM) throw new RegexError("pattern too complex");
    this.prog.push(i);
    return this.prog.length - 1;
  }

  emit(a: Ast): void {
    switch (a.k) {
      case "empty":
        return;
      case "char":
        this.push({ op: "char", pred: a.pred });
        return;
      case "bol":
        this.push({ op: "assert", kind: "bol" });
        return;
      case "eol":
        this.push({ op: "assert", kind: "eol" });
        return;
      case "wordb":
        this.push({ op: "assert", kind: a.negate ? "nwordb" : "wordb" });
        return;
      case "cat":
        for (const it of a.items) this.emit(it);
        return;
      case "alt": {
        // split L1, next ; L1: a ; jmp end ; next: split L2, … ; last
        const jumps: number[] = [];
        for (let n = 0; n < a.items.length - 1; n++) {
          const split = this.push({ op: "split", x: 0, y: 0 });
          (this.prog[split] as { x: number }).x = this.prog.length;
          this.emit(a.items[n]!);
          jumps.push(this.push({ op: "jmp", x: 0 }));
          (this.prog[split] as { y: number }).y = this.prog.length;
        }
        this.emit(a.items[a.items.length - 1]!);
        for (const j of jumps) (this.prog[j] as { x: number }).x = this.prog.length;
        return;
      }
      case "rep": {
        for (let n = 0; n < a.min; n++) this.emit(a.a);
        if (a.max === -1) {
          // L: split body, end ; body ; jmp L
          const split = this.push({ op: "split", x: 0, y: 0 });
          (this.prog[split] as { x: number }).x = this.prog.length;
          this.emit(a.a);
          this.push({ op: "jmp", x: split });
          (this.prog[split] as { y: number }).y = this.prog.length;
          return;
        }
        const splits: number[] = [];
        for (let n = a.min; n < a.max; n++) {
          const split = this.push({ op: "split", x: 0, y: 0 });
          (this.prog[split] as { x: number }).x = this.prog.length;
          splits.push(split);
          this.emit(a.a);
        }
        for (const s of splits) (this.prog[s] as { y: number }).y = this.prog.length;
        return;
      }
    }
  }
}

export interface SafeRegex {
  test(subject: string): boolean;
}

/** Compiles a pattern; throws RegexError for invalid or unsupported syntax or excessive size. */
export function compileSafeRegex(pattern: string): SafeRegex {
  if (pattern.length > MAX_PATTERN) throw new RegexError("pattern too long");
  const ast = new Parser(pattern).parse();
  const c = new Compiler();
  c.emit(ast);
  c.prog.push({ op: "match" });
  const prog = c.prog;
  return { test: (subject) => run(prog, subject) };
}

/** Pike VM: every thread advances in lock step, so each (instruction, position) is visited once. */
function run(prog: Inst[], s: string): boolean {
  const n = prog.length;
  let clist = new Int32Array(n);
  let nlist = new Int32Array(n);
  let ccount = 0;
  let ncount = 0;
  const mark = new Int32Array(n).fill(-1);
  const stack = new Int32Array(n * 2 + 2);
  let gen = 0;

  const wordAt = (i: number) => i >= 0 && i < s.length && isWord(s.charCodeAt(i));
  /** Adds pc and its epsilon closure at position `pos`; returns true when Match is reachable. */
  const add = (list: Int32Array, count: number, pc0: number, pos: number): [number, boolean] => {
    let sp = 0;
    stack[sp++] = pc0;
    let matched = false;
    while (sp > 0) {
      const pc = stack[--sp]!;
      if (mark[pc] === gen) continue;
      mark[pc] = gen;
      const inst = prog[pc]!;
      switch (inst.op) {
        case "jmp":
          stack[sp++] = inst.x;
          break;
        case "split":
          stack[sp++] = inst.y;
          stack[sp++] = inst.x;
          break;
        case "assert": {
          let ok: boolean;
          if (inst.kind === "bol") ok = pos === 0;
          else if (inst.kind === "eol") ok = pos === s.length;
          else {
            const b = wordAt(pos - 1) !== wordAt(pos);
            ok = inst.kind === "wordb" ? b : !b;
          }
          if (ok) stack[sp++] = pc + 1;
          break;
        }
        case "match":
          matched = true;
          break;
        case "char":
          list[count++] = pc;
          break;
      }
    }
    return [count, matched];
  };

  gen = 1;
  let m: boolean;
  [ccount, m] = add(clist, 0, 0, 0);
  if (m) return true;
  for (let pos = 0; pos < s.length; pos++) {
    gen++;
    ncount = 0;
    const ch = s.charCodeAt(pos);
    for (let t = 0; t < ccount; t++) {
      const pc = clist[t]!;
      if ((prog[pc] as { pred: CharPred }).pred(ch)) {
        [ncount, m] = add(nlist, ncount, pc + 1, pos + 1);
        if (m) return true;
      }
    }
    // Unanchored search: a new thread also starts at every position.
    [ncount, m] = add(nlist, ncount, 0, pos + 1);
    if (m) return true;
    [clist, nlist] = [nlist, clist];
    ccount = ncount;
  }
  return false;
}
