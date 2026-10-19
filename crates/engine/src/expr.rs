//! Safe expression language — a faithful port of `packages/core/src/expr.ts`.
//!
//! Used by conditions, `setVar`, `forEach` and `{{ }}` interpolation.
//!
//! - No host access: only variables, literals, operators and an allow-list of functions.
//! - Values: number, string, boolean, null, arrays.
//! - Operators: `+ - * / % ! && || == != < <= > >= ?:`, parentheses and `[index]`.
//! - Bounded: source length, AST depth, evaluation steps, string and list sizes.
//!
//! Error messages, string semantics (UTF-16 lengths and indices) and number formatting match
//! the TypeScript implementation so a flow behaves identically in the browser and on Windows.

use crate::value::{js_number_to_string, js_round, js_trim, utf16_len, Value};
use chrono::{Datelike, Local, TimeZone, Timelike};
use indexmap::IndexMap;
use regex::Regex;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::fmt;
use std::rc::Rc;
use std::sync::OnceLock;

/// Maximum expression source length (UTF-16 code units).
pub const MAX_SOURCE: usize = 2000;
/// Maximum parser nesting depth.
pub const MAX_DEPTH: usize = 64;
/// Maximum evaluated nodes per evaluation.
pub const MAX_STEPS: u32 = 20_000;
/// Maximum string length produced by an expression.
pub const MAX_STRING: usize = 1_000_000;
/// Maximum list length produced by an expression.
pub const MAX_LIST: usize = 100_000;

/// Variables visible to expressions, in insertion order.
pub type Vars = IndexMap<String, Value>;

/// Error raised while parsing or evaluating an expression.
#[derive(Debug, Clone, PartialEq)]
pub struct ExprError {
    /// Human-readable message (identical to the TypeScript engine's).
    pub message: String,
    /// Position in the source (UTF-16 code units), when known.
    pub pos: Option<usize>,
    /// True for errors the JavaScript engine raises as host errors rather than `ExprError`
    /// (an invalid regular expression); the executor reports those as `action` errors.
    pub host: bool,
}

impl ExprError {
    fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), pos: None, host: false }
    }
    fn at(message: impl Into<String>, pos: usize) -> Self {
        Self { message: message.into(), pos: Some(pos), host: false }
    }
}

impl fmt::Display for ExprError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ExprError {}

/* ---------------------------------------------------------------- tokenizer */

#[derive(Debug, Clone, PartialEq)]
enum TokKind {
    Num(f64),
    Str(String),
    Id(String),
    Op(&'static str),
    Eof,
}

#[derive(Debug, Clone)]
struct Tok {
    kind: TokKind,
    p: usize,
}

const OPS: [&str; 21] = ["&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "!", "<", ">", "(", ")", ",", "?", ":", "[", "]"];

fn tokenize(src: &str) -> Result<Vec<Tok>, ExprError> {
    if utf16_len(src) > MAX_SOURCE {
        return Err(ExprError::new("expression too long"));
    }
    let chars: Vec<char> = src.chars().collect();
    // UTF-16 offset of every char index (plus the end), so positions match JavaScript.
    let mut p16 = Vec::with_capacity(chars.len() + 1);
    let mut acc = 0;
    for c in &chars {
        p16.push(acc);
        acc += c.len_utf16();
    }
    p16.push(acc);

    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if crate::value::is_js_whitespace(c) {
            i += 1;
            continue;
        }
        let next_is_digit = chars.get(i + 1).is_some_and(char::is_ascii_digit);
        if c.is_ascii_digit() || (c == '.' && next_is_digit) {
            let start = i;
            if c == '.' {
                i += 1;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
            } else {
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
                if i < chars.len() && chars[i] == '.' {
                    i += 1;
                    while i < chars.len() && chars[i].is_ascii_digit() {
                        i += 1;
                    }
                }
            }
            if i < chars.len() && (chars[i] == 'e' || chars[i] == 'E') {
                let mut j = i + 1;
                if j < chars.len() && (chars[j] == '+' || chars[j] == '-') {
                    j += 1;
                }
                if j < chars.len() && chars[j].is_ascii_digit() {
                    while j < chars.len() && chars[j].is_ascii_digit() {
                        j += 1;
                    }
                    i = j;
                }
            }
            let text: String = chars[start..i].iter().collect();
            out.push(Tok { kind: TokKind::Num(crate::value::js_string_to_number(&text)), p: p16[start] });
            continue;
        }
        if c == '"' || c == '\'' {
            let q = c;
            let mut s = String::new();
            let mut j = i + 1;
            loop {
                let Some(&d) = chars.get(j) else {
                    return Err(ExprError::at("unterminated string", p16[i]));
                };
                if d == '\\' {
                    match chars.get(j + 1) {
                        Some('n') => s.push('\n'),
                        Some('t') => s.push('\t'),
                        Some(&other) => s.push(other),
                        None => {}
                    }
                    j += 2;
                    continue;
                }
                if d == q {
                    break;
                }
                s.push(d);
                j += 1;
            }
            out.push(Tok { kind: TokKind::Str(s), p: p16[i] });
            i = j + 1;
            continue;
        }
        if c.is_ascii_alphabetic() || c == '_' {
            let start = i;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || chars[i] == '_') {
                i += 1;
            }
            out.push(Tok { kind: TokKind::Id(chars[start..i].iter().collect()), p: p16[start] });
            continue;
        }
        let op = OPS.iter().find(|o| {
            let mut k = i;
            o.chars().all(|oc| {
                let ok = chars.get(k) == Some(&oc);
                k += 1;
                ok
            })
        });
        let Some(op) = op else {
            return Err(ExprError::at(format!("unexpected character \"{c}\""), p16[i]));
        };
        out.push(Tok { kind: TokKind::Op(op), p: p16[i] });
        i += op.len();
    }
    out.push(Tok { kind: TokKind::Eof, p: p16[chars.len()] });
    Ok(out)
}

/* ------------------------------------------------------------------- parser */

/// Parsed expression tree.
#[derive(Debug, Clone, PartialEq)]
pub enum Node {
    /// Literal value.
    Lit(Value),
    /// Variable reference.
    Var(String),
    /// Unary operator (`!` or `-`).
    Un(&'static str, Box<Node>),
    /// Binary operator.
    Bin(&'static str, Box<Node>, Box<Node>),
    /// Conditional `c ? a : b`.
    Cond(Box<Node>, Box<Node>, Box<Node>),
    /// Call of an allow-listed function.
    Call(&'static str, Vec<Node>),
    /// Index `a[i]`.
    Idx(Box<Node>, Box<Node>),
    /// List literal `[a, b]`.
    List(Vec<Node>),
}

/// Names of every function callable from expressions.
pub const FUNCTION_NAMES: [&str; 30] = [
    "len",
    "upper",
    "lower",
    "trim",
    "contains",
    "startsWith",
    "endsWith",
    "replace",
    "substr",
    "split",
    "join",
    "num",
    "str",
    "round",
    "floor",
    "ceil",
    "abs",
    "min",
    "max",
    "random",
    "now",
    "hour",
    "minute",
    "weekday",
    "date",
    "time",
    "defined",
    "push",
    "range",
    "matches",
];

fn function_name(name: &str) -> Option<&'static str> {
    FUNCTION_NAMES.iter().copied().find(|f| *f == name)
}

fn binding_power(op: &str) -> Option<u8> {
    Some(match op {
        "||" => 1,
        "&&" => 2,
        "==" | "!=" => 3,
        "<" | "<=" | ">" | ">=" => 4,
        "+" | "-" => 5,
        "*" | "/" | "%" => 6,
        _ => return None,
    })
}

struct Parser {
    toks: Vec<Tok>,
    pos: usize,
}

impl Parser {
    fn peek(&self) -> &Tok {
        // The token list always ends with Eof and the parser never advances past it twice.
        &self.toks[self.pos.min(self.toks.len() - 1)]
    }
    fn next(&mut self) -> Tok {
        let t = self.peek().clone();
        self.pos += 1;
        t
    }
    fn peek_is_op(&self, v: &str) -> bool {
        matches!(&self.peek().kind, TokKind::Op(o) if *o == v)
    }
    fn expect_op(&mut self, v: &str) -> Result<(), ExprError> {
        let t = self.next();
        match t.kind {
            TokKind::Op(o) if o == v => Ok(()),
            _ => Err(ExprError::at(format!("expected \"{v}\""), t.p)),
        }
    }
    fn comma_list(&mut self, close: &str, depth: usize) -> Result<Vec<Node>, ExprError> {
        let mut items = Vec::new();
        if !self.peek_is_op(close) {
            loop {
                items.push(self.expression(0, depth + 1)?);
                if self.peek_is_op(",") {
                    self.next();
                    continue;
                }
                break;
            }
        }
        self.expect_op(close)?;
        Ok(items)
    }

    fn primary(&mut self, depth: usize) -> Result<Node, ExprError> {
        if depth > MAX_DEPTH {
            return Err(ExprError::new("expression too deep"));
        }
        let t = self.next();
        let mut node = match t.kind {
            TokKind::Num(v) => Node::Lit(Value::Num(v)),
            TokKind::Str(s) => Node::Lit(Value::Str(s)),
            TokKind::Id(name) => {
                if name == "true" || name == "false" {
                    Node::Lit(Value::Bool(name == "true"))
                } else if name == "null" {
                    Node::Lit(Value::Null)
                } else if self.peek_is_op("(") {
                    self.next();
                    let args = self.comma_list(")", depth)?;
                    let Some(f) = function_name(&name) else {
                        return Err(ExprError::at(format!("unknown function \"{name}\""), t.p));
                    };
                    Node::Call(f, args)
                } else {
                    Node::Var(name)
                }
            }
            TokKind::Op("(") => {
                let n = self.expression(0, depth + 1)?;
                self.expect_op(")")?;
                n
            }
            TokKind::Op("[") => Node::List(self.comma_list("]", depth)?),
            TokKind::Op(op @ ("!" | "-")) => return Ok(Node::Un(op, Box::new(self.primary(depth + 1)?))),
            _ => return Err(ExprError::at("unexpected token", t.p)),
        };
        while self.peek_is_op("[") {
            self.next();
            let i = self.expression(0, depth + 1)?;
            self.expect_op("]")?;
            node = Node::Idx(Box::new(node), Box::new(i));
        }
        Ok(node)
    }

    fn expression(&mut self, min_bp: u8, depth: usize) -> Result<Node, ExprError> {
        let mut left = self.primary(depth + 1)?;
        while let TokKind::Op(op) = self.peek().kind {
            if op == "?" && min_bp == 0 {
                self.next();
                let a = self.expression(0, depth + 1)?;
                self.expect_op(":")?;
                let b = self.expression(0, depth + 1)?;
                left = Node::Cond(Box::new(left), Box::new(a), Box::new(b));
                continue;
            }
            let Some(bp) = binding_power(op) else { break };
            if bp <= min_bp {
                break;
            }
            self.next();
            let right = self.expression(bp, depth + 1)?;
            left = Node::Bin(op, Box::new(left), Box::new(right));
        }
        Ok(left)
    }
}

/// Parses an expression into a tree.
pub fn parse(src: &str) -> Result<Node, ExprError> {
    let toks = tokenize(src)?;
    let mut p = Parser { toks, pos: 0 };
    let n = p.expression(0, 0)?;
    if p.peek().kind != TokKind::Eof {
        return Err(ExprError::at("unexpected trailing input", p.peek().p));
    }
    Ok(n)
}

/* --------------------------------------------------------------- evaluation */

/// Evaluation environment: variables plus a deterministic clock and RNG.
pub struct ExprEnv<'a> {
    /// Variables in scope.
    pub vars: &'a Vars,
    /// Epoch milliseconds.
    pub now: &'a dyn Fn() -> f64,
    /// Uniform random number in `[0, 1)`.
    pub random: &'a dyn Fn() -> f64,
}

/// Wall-clock epoch milliseconds.
pub fn system_now() -> f64 {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
    #[allow(clippy::cast_precision_loss)]
    let v = ms as f64;
    v
}

/// Non-cryptographic uniform random number in `[0, 1)` (SplitMix64, per-thread seed).
pub fn default_random() -> f64 {
    thread_local! {
        static STATE: Cell<u64> = Cell::new({
            let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos());
            #[allow(clippy::cast_possible_truncation)]
            let seed = nanos as u64;
            seed ^ (std::ptr::addr_of!(nanos) as u64).rotate_left(32)
        });
    }
    STATE.with(|s| {
        let mut z = s.get().wrapping_add(0x9E37_79B9_7F4A_7C15);
        s.set(z);
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        #[allow(clippy::cast_precision_loss)]
        let f = (z >> 11) as f64 / (1u64 << 53) as f64;
        f
    })
}

/// `truthy()` from expr.ts.
pub fn truthy(v: &Value) -> bool {
    v.truthy()
}

/// `toStr()` from expr.ts.
pub fn to_str(v: &Value) -> String {
    v.to_js_string()
}

fn to_num(v: &Value) -> Result<f64, ExprError> {
    match v {
        Value::Num(n) => Ok(*n),
        Value::Bool(b) => Ok(f64::from(u8::from(*b))),
        Value::Null => Ok(0.0),
        #[allow(clippy::cast_precision_loss)]
        Value::List(l) => Ok(l.len() as f64),
        Value::Str(s) => {
            let n = crate::value::js_string_to_number(s);
            if n.is_nan() {
                Err(ExprError::new(format!("\"{s}\" is not a number")))
            } else {
                Ok(n)
            }
        }
    }
}

/// Loose equality used by `==` (see `eq` in expr.ts).
pub fn loose_eq(a: &Value, b: &Value) -> bool {
    if let (Value::List(x), Value::List(y)) = (a, b) {
        return x.len() == y.len() && x.iter().zip(y).all(|(p, q)| loose_eq(p, q));
    }
    if matches!(a, Value::Num(_)) || matches!(b, Value::Num(_)) {
        if matches!(a, Value::Null) || matches!(b, Value::Null) {
            return false; // `a === b` with exactly one side null and the other a number
        }
        let x = a.to_js_number();
        let y = b.to_js_number();
        if !x.is_nan() && !y.is_nan() {
            return x == y;
        }
    }
    strict_eq(a, b)
}

fn strict_eq(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Num(x), Value::Num(y)) => x == y,
        (Value::Str(x), Value::Str(y)) => x == y,
        // Distinct array objects are never `===` in JavaScript.
        _ => false,
    }
}

fn guard(v: Value) -> Result<Value, ExprError> {
    match &v {
        Value::Str(s) if s.len() > MAX_STRING && utf16_len(s) > MAX_STRING => Err(ExprError::new("string too large")),
        Value::List(l) if l.len() > MAX_LIST => Err(ExprError::new("list too large")),
        Value::Num(n) if !n.is_finite() => Err(ExprError::new("number out of range")),
        _ => Ok(v),
    }
}

fn arity(name: &str, args: &[Value], min: usize, max: usize) -> Result<(), ExprError> {
    if args.len() < min || args.len() > max {
        let expected = if min == max { min.to_string() } else { format!("{min}-{max}") };
        return Err(ExprError::new(format!("{name}() expects {expected} argument(s)")));
    }
    Ok(())
}

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// `String.prototype.split(sep)` with a string separator (code-unit split for "").
fn js_split(s: &str, sep: &str) -> Vec<String> {
    if sep.is_empty() {
        return utf16(s).iter().map(|u| String::from_utf16_lossy(&[*u])).collect();
    }
    s.split(sep).map(str::to_owned).collect()
}

/// ToIntegerOrInfinity for an already numeric value.
fn to_integer(n: f64) -> f64 {
    if n.is_nan() {
        0.0
    } else {
        n.trunc()
    }
}

#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss)]
fn js_substr(s: &str, start: f64, length: Option<f64>) -> String {
    let units = utf16(s);
    let size = units.len() as f64;
    let mut int_start = to_integer(start);
    if int_start == f64::NEG_INFINITY {
        int_start = 0.0;
    } else if int_start < 0.0 {
        int_start = (size + int_start).max(0.0);
    } else {
        int_start = int_start.min(size);
    }
    let int_length = length.map_or(size, to_integer);
    let int_end = (int_start + int_length.clamp(0.0, size)).min(size);
    if int_start >= int_end {
        return String::new();
    }
    String::from_utf16_lossy(&units[int_start as usize..int_end as usize])
}

fn compare_utf16(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Local date-time for epoch milliseconds, `None` for an invalid JavaScript date.
fn local_date(ms: f64) -> Option<chrono::DateTime<Local>> {
    if !ms.is_finite() || ms.abs() > 8.64e15 {
        return None;
    }
    #[allow(clippy::cast_possible_truncation)]
    let ms = ms.trunc() as i64;
    Local.timestamp_millis_opt(ms).earliest()
}

fn date_arg(args: &[Value], env: &ExprEnv<'_>) -> Result<f64, ExprError> {
    if args.is_empty() {
        Ok((env.now)())
    } else {
        to_num(&args[0])
    }
}

/// Translates a JavaScript regular expression to the `regex` crate dialect: `\d \w \b` are
/// ASCII-only in JavaScript but Unicode-aware in Rust.
fn translate_js_regex(p: &str) -> Result<String, &'static str> {
    let mut out = String::with_capacity(p.len() + 8);
    let mut chars = p.chars().peekable();
    let mut in_class = false;
    while let Some(c) = chars.next() {
        match c {
            // JavaScript has no inline flag groups such as `(?i)`; reject them like `new RegExp`.
            '(' if !in_class && chars.peek() == Some(&'?') => {
                let mut ahead = chars.clone();
                ahead.next();
                if !matches!(ahead.peek(), Some(':' | '=' | '!' | '<')) {
                    return Err("Invalid group");
                }
                out.push(c);
            }
            '\\' => match chars.next() {
                Some('d') => out.push_str("[0-9]"),
                Some('D') => out.push_str("[^0-9]"),
                Some('w') => out.push_str("[0-9A-Za-z_]"),
                Some('W') => out.push_str("[^0-9A-Za-z_]"),
                Some('b') if in_class => out.push_str("\\x08"),
                Some('b') => out.push_str("(?-u:\\b)"),
                Some('B') => out.push_str("(?-u:\\B)"),
                Some('/') => out.push('/'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            },
            '[' if !in_class => {
                in_class = true;
                out.push(c);
            }
            ']' if in_class => {
                in_class = false;
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    Ok(out)
}

fn compile_pattern(pattern: &str) -> Result<Rc<Regex>, ExprError> {
    thread_local! {
        static CACHE: RefCell<HashMap<String, Rc<Regex>>> = RefCell::new(HashMap::new());
    }
    if let Some(r) = CACHE.with(|c| c.borrow().get(pattern).cloned()) {
        return Ok(r);
    }
    let invalid = |why: &str| ExprError { message: format!("Invalid regular expression: /{pattern}/: {why}"), pos: None, host: true };
    let translated = translate_js_regex(pattern).map_err(invalid)?;
    let re = regex::RegexBuilder::new(&translated)
        .size_limit(1 << 20)
        .dfa_size_limit(1 << 20)
        .build()
        .map_err(|e| invalid(e.to_string().lines().last().unwrap_or("invalid pattern").trim_start_matches("error: ")))?;
    let re = Rc::new(re);
    CACHE.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() > 64 {
            c.clear();
        }
        c.insert(pattern.to_owned(), Rc::clone(&re));
    });
    Ok(re)
}

fn nested_quantifier() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    #[allow(clippy::unwrap_used)] // constant pattern, covered by tests
    RE.get_or_init(|| Regex::new(r"\([^)]*[+*][^)]*\)[+*{]").unwrap())
}

#[allow(clippy::too_many_lines, clippy::cast_precision_loss)]
fn call(name: &str, a: &[Value], env: &ExprEnv<'_>) -> Result<Value, ExprError> {
    let s = |i: usize| a[i].to_js_string();
    Ok(match name {
        "len" => {
            arity(name, a, 1, 1)?;
            match &a[0] {
                Value::List(l) => Value::Num(l.len() as f64),
                v => Value::Num(utf16_len(&v.to_js_string()) as f64),
            }
        }
        "upper" => {
            arity(name, a, 1, 1)?;
            Value::Str(s(0).to_uppercase())
        }
        "lower" => {
            arity(name, a, 1, 1)?;
            Value::Str(s(0).to_lowercase())
        }
        "trim" => {
            arity(name, a, 1, 1)?;
            Value::Str(js_trim(&s(0)).to_owned())
        }
        "contains" => {
            arity(name, a, 2, 2)?;
            match &a[0] {
                Value::List(l) => Value::Bool(l.iter().any(|x| loose_eq(x, &a[1]))),
                v => Value::Bool(v.to_js_string().contains(&s(1))),
            }
        }
        "startsWith" => {
            arity(name, a, 2, 2)?;
            Value::Bool(s(0).starts_with(&s(1)))
        }
        "endsWith" => {
            arity(name, a, 2, 2)?;
            Value::Bool(s(0).ends_with(&s(1)))
        }
        "replace" => {
            arity(name, a, 3, 3)?;
            let (src, from, to) = (s(0), s(1), s(2));
            // Size the result first: replace(s, "", s) would otherwise square the input in memory.
            let (n, from_len, to_len) = (utf16_len(&src), utf16_len(&from), utf16_len(&to));
            let pieces = if from.is_empty() { n } else { src.matches(from.as_str()).count() + 1 };
            let out = n - if from.is_empty() { 0 } else { (pieces - 1) * from_len } + pieces.saturating_sub(1).saturating_mul(to_len);
            if out > MAX_STRING {
                return Err(ExprError::new("string too large"));
            }
            Value::Str(js_split(&src, &from).join(&to))
        }
        "substr" => {
            arity(name, a, 2, 3)?;
            let start = to_num(&a[1])?;
            let len = if a.len() == 3 { Some(to_num(&a[2])?) } else { None };
            Value::Str(js_substr(&s(0), start, len))
        }
        "split" => {
            arity(name, a, 2, 2)?;
            Value::List(js_split(&s(0), &s(1)).into_iter().take(MAX_LIST).map(Value::Str).collect())
        }
        "join" => {
            arity(name, a, 2, 2)?;
            let sep = s(1);
            let parts: Vec<String> = match &a[0] {
                Value::List(l) => l.iter().map(Value::to_js_string).collect(),
                v => vec![v.to_js_string()],
            };
            Value::Str(parts.join(&sep))
        }
        "num" => {
            arity(name, a, 1, 1)?;
            Value::Num(to_num(&a[0])?)
        }
        "str" => {
            arity(name, a, 1, 1)?;
            Value::Str(s(0))
        }
        "round" => {
            arity(name, a, 1, 2)?;
            let d = if a.len() == 2 { to_num(&a[1])?.clamp(0.0, 10.0) } else { 0.0 };
            let f = 10f64.powf(d);
            Value::Num(js_round(to_num(&a[0])? * f) / f)
        }
        "floor" => {
            arity(name, a, 1, 1)?;
            Value::Num(to_num(&a[0])?.floor())
        }
        "ceil" => {
            arity(name, a, 1, 1)?;
            Value::Num(to_num(&a[0])?.ceil())
        }
        "abs" => {
            arity(name, a, 1, 1)?;
            Value::Num(to_num(&a[0])?.abs())
        }
        "min" | "max" => {
            if a.is_empty() {
                return Err(ExprError::new(format!("{name}() needs arguments")));
            }
            let mut acc = if name == "min" { f64::INFINITY } else { f64::NEG_INFINITY };
            for v in a {
                let n = to_num(v)?;
                acc = if name == "min" { acc.min(n) } else { acc.max(n) };
            }
            Value::Num(acc)
        }
        "random" => {
            arity(name, a, 2, 2)?;
            let lo = to_num(&a[0])?.ceil();
            let hi = to_num(&a[1])?.floor();
            Value::Num(lo + ((env.random)() * (hi - lo + 1.0)).floor())
        }
        "now" => {
            arity(name, a, 0, 0)?;
            Value::Num((env.now)())
        }
        "hour" | "minute" | "weekday" => {
            arity(name, a, 0, 0)?;
            let n = local_date((env.now)()).map_or(f64::NAN, |d| {
                f64::from(match name {
                    "hour" => d.hour(),
                    "minute" => d.minute(),
                    _ => d.weekday().num_days_from_sunday(),
                })
            });
            Value::Num(n)
        }
        "date" => {
            arity(name, a, 0, 1)?;
            let ms = date_arg(a, env)?;
            Value::Str(local_date(ms).map_or_else(|| "NaN-NaN-NaN".to_owned(), |d| format!("{}-{:02}-{:02}", d.year(), d.month(), d.day())))
        }
        "time" => {
            arity(name, a, 0, 1)?;
            let ms = date_arg(a, env)?;
            Value::Str(
                local_date(ms).map_or_else(|| "NaN:NaN:NaN".to_owned(), |d| format!("{:02}:{:02}:{:02}", d.hour(), d.minute(), d.second())),
            )
        }
        "defined" => {
            arity(name, a, 1, 1)?;
            Value::Bool(env.vars.contains_key(&s(0)))
        }
        "push" => {
            arity(name, a, 2, 2)?;
            let mut l = match &a[0] {
                Value::List(l) => l.clone(),
                _ => Vec::new(),
            };
            l.push(a[1].clone());
            Value::List(l)
        }
        "range" => {
            arity(name, a, 1, 2)?;
            let (lo, hi) = if a.len() == 1 { (0.0, to_num(&a[0])?) } else { (to_num(&a[0])?, to_num(&a[1])?) };
            if hi - lo > MAX_LIST as f64 {
                return Err(ExprError::new("range too large"));
            }
            let mut out = Vec::new();
            let mut i = lo;
            while i < hi {
                out.push(Value::Num(i));
                i += 1.0;
            }
            Value::List(out)
        }
        "matches" => {
            arity(name, a, 2, 2)?;
            let pattern = s(1);
            if utf16_len(&pattern) > 200 {
                return Err(ExprError::new("pattern too long"));
            }
            if nested_quantifier().is_match(&pattern) {
                return Err(ExprError::new("pattern too complex"));
            }
            let re = compile_pattern(&pattern)?;
            let subject = utf16(&s(0));
            let subject = String::from_utf16_lossy(&subject[..subject.len().min(10_000)]);
            Value::Bool(re.is_match(&subject))
        }
        other => return Err(ExprError::new(format!("unknown function \"{other}\""))),
    })
}

struct Evaluator<'e, 'a> {
    env: &'e ExprEnv<'a>,
    steps: u32,
}

// Left-associative operator chains (`1+1+…`) nest as deep as the 2000-character source
// allows, so the recursive path (`ev` → `binary` → `ev`) keeps its frames small and moves
// everything else into non-inlined helpers.
impl Evaluator<'_, '_> {
    fn ev(&mut self, n: &Node) -> Result<Value, ExprError> {
        self.steps += 1;
        if self.steps > MAX_STEPS {
            return Err(ExprError::new("expression too expensive"));
        }
        match n {
            Node::Bin(op, a, b) => self.binary(op, a, b),
            Node::Lit(v) => Ok(v.clone()),
            _ => self.ev_other(n),
        }
    }

    fn binary(&mut self, op: &'static str, a: &Node, b: &Node) -> Result<Value, ExprError> {
        let x = self.ev(a)?;
        match op {
            "&&" if x.truthy() => self.ev(b),
            "||" if !x.truthy() => self.ev(b),
            "&&" | "||" => Ok(x),
            _ => {
                let y = self.ev(b)?;
                apply_binary(op, x, y)
            }
        }
    }

    #[inline(never)]
    fn ev_other(&mut self, n: &Node) -> Result<Value, ExprError> {
        match n {
            Node::Var(name) => self.env.vars.get(name).cloned().ok_or_else(|| ExprError::new(format!("unknown variable \"{name}\""))),
            Node::List(items) => {
                let mut out = Vec::with_capacity(items.len());
                for i in items {
                    out.push(self.ev(i)?);
                }
                guard(Value::List(out))
            }
            Node::Un(op, a) => {
                let v = self.ev(a)?;
                if *op == "!" {
                    Ok(Value::Bool(!v.truthy()))
                } else {
                    Ok(Value::Num(-to_num(&v)?))
                }
            }
            Node::Cond(c, a, b) => {
                if self.ev(c)?.truthy() {
                    self.ev(a)
                } else {
                    self.ev(b)
                }
            }
            Node::Idx(a, i) => {
                let a = self.ev(a)?;
                let i = to_num(&self.ev(i)?)?.trunc();
                Ok(index(a, i))
            }
            Node::Call(f, args) => {
                let mut vals = Vec::with_capacity(args.len());
                for a in args {
                    vals.push(self.ev(a)?);
                }
                guard(call(f, &vals, self.env)?)
            }
            Node::Lit(v) => Ok(v.clone()),
            Node::Bin(op, a, b) => self.binary(op, a, b),
        }
    }
}

#[inline(never)]
#[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss, clippy::needless_pass_by_value)]
fn index(a: Value, i: f64) -> Value {
    let pick = |len: usize| -> Option<usize> {
        let idx = if i < 0.0 { len as f64 + i } else { i };
        (idx >= 0.0 && idx < len as f64).then_some(idx as usize)
    };
    match a {
        Value::List(l) => pick(l.len()).map_or(Value::Null, |k| l[k].clone()),
        other => {
            let units = utf16(&other.to_js_string());
            pick(units.len()).map_or(Value::Null, |k| Value::Str(String::from_utf16_lossy(&units[k..=k])))
        }
    }
}

#[inline(never)]
#[allow(clippy::needless_pass_by_value)]
fn apply_binary(op: &str, x: Value, y: Value) -> Result<Value, ExprError> {
    match op {
        "+" => {
            if matches!(x, Value::Str(_)) || matches!(y, Value::Str(_)) {
                return guard(Value::Str(x.to_js_string() + &y.to_js_string()));
            }
            if let (Value::List(l), Value::List(r)) = (&x, &y) {
                let mut out = l.clone();
                out.extend(r.iter().cloned());
                return guard(Value::List(out));
            }
            guard(Value::Num(to_num(&x)? + to_num(&y)?))
        }
        "-" => guard(Value::Num(to_num(&x)? - to_num(&y)?)),
        "*" => guard(Value::Num(to_num(&x)? * to_num(&y)?)),
        "/" | "%" => {
            let d = to_num(&y)?;
            if d == 0.0 {
                return Err(ExprError::new("division by zero"));
            }
            let n = to_num(&x)?;
            Ok(Value::Num(if op == "/" { n / d } else { n % d }))
        }
        "==" => Ok(Value::Bool(loose_eq(&x, &y))),
        "!=" => Ok(Value::Bool(!loose_eq(&x, &y))),
        "<" | "<=" | ">" | ">=" => {
            let ord = if let (Value::Str(l), Value::Str(r)) = (&x, &y) {
                Some(compare_utf16(l, r))
            } else {
                let l = to_num(&x)?;
                let r = to_num(&y)?;
                l.partial_cmp(&r)
            };
            let Some(ord) = ord else { return Ok(Value::Bool(false)) };
            Ok(Value::Bool(match op {
                "<" => ord.is_lt(),
                "<=" => ord.is_le(),
                ">" => ord.is_gt(),
                _ => ord.is_ge(),
            }))
        }
        other => Err(ExprError::new(format!("unknown operator {other}"))),
    }
}

/// Evaluates a parsed tree.
pub fn evaluate(node: &Node, env: &ExprEnv<'_>) -> Result<Value, ExprError> {
    Evaluator { env, steps: 0 }.ev(node)
}

/// Parses (with a small per-thread cache) and evaluates an expression.
pub fn eval_expr(src: &str, env: &ExprEnv<'_>) -> Result<Value, ExprError> {
    thread_local! {
        static CACHE: RefCell<HashMap<String, Rc<Node>>> = RefCell::new(HashMap::new());
    }
    let cached = CACHE.with(|c| c.borrow().get(src).cloned());
    let node = if let Some(n) = cached {
        n
    } else {
        let n = Rc::new(parse(src)?);
        CACHE.with(|c| {
            let mut c = c.borrow_mut();
            if c.len() > 500 {
                c.clear();
            }
            c.insert(src.to_owned(), Rc::clone(&n));
        });
        n
    };
    evaluate(&node, env)
}

/// Returns `None` when the expression parses, or the error message.
pub fn check_expr(src: &str) -> Option<String> {
    parse(src).err().map(|e| e.message)
}

/// Variables referenced by an expression (empty for invalid expressions).
pub fn referenced_vars(src: &str) -> Vec<String> {
    fn walk(n: &Node, out: &mut Vec<String>) {
        match n {
            Node::Var(name) => {
                if !out.contains(name) {
                    out.push(name.clone());
                }
            }
            Node::Un(_, a) => walk(a, out),
            Node::Bin(_, a, b) | Node::Idx(a, b) => {
                walk(a, out);
                walk(b, out);
            }
            Node::Cond(c, a, b) => {
                walk(c, out);
                walk(a, out);
                walk(b, out);
            }
            Node::Call(_, items) | Node::List(items) => items.iter().for_each(|i| walk(i, out)),
            Node::Lit(_) => {}
        }
    }
    let mut out = Vec::new();
    if let Ok(n) = parse(src) {
        walk(&n, &mut out);
    }
    out
}

fn placeholder() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    #[allow(clippy::unwrap_used)] // constant pattern, covered by tests
    RE.get_or_init(|| Regex::new(r"\{\{[\s\x{FEFF}]*([^}]+?)[\s\x{FEFF}]*\}\}").unwrap())
}

/// Optional `{{secret:name}}` resolver passed to [`interpolate`].
pub type SecretLookup<'a> = Option<&'a dyn Fn(&str) -> Option<String>>;

/// Replaces `{{ expr }}` in text. `{{secret:name}}` is resolved through `secret` and never logged.
pub fn interpolate(text: &str, env: &ExprEnv<'_>, secret: SecretLookup<'_>) -> Result<String, ExprError> {
    interpolate_with(text, env, secret, false)
}

/// Shown instead of a secret's value in logged text (`SECRET_MASK` in expr.ts).
pub const SECRET_MASK: &str = "\u{2022}\u{2022}\u{2022}\u{2022}";

/// Like [`interpolate`]; with `mask_secrets`, secrets must exist but render as [`SECRET_MASK`].
pub fn interpolate_with(text: &str, env: &ExprEnv<'_>, secret: SecretLookup<'_>, mask_secrets: bool) -> Result<String, ExprError> {
    let re = placeholder();
    let mut out = String::with_capacity(text.len());
    let mut last = 0;
    for caps in re.captures_iter(text) {
        let (Some(whole), Some(inner)) = (caps.get(0), caps.get(1)) else { continue };
        out.push_str(&text[last..whole.start()]);
        let inner = inner.as_str();
        if let Some(rest) = inner.strip_prefix("secret:") {
            let name = js_trim(rest);
            match secret.and_then(|f| f(name)) {
                Some(_) if mask_secrets => out.push_str(SECRET_MASK),
                Some(v) => out.push_str(&v),
                None => return Err(ExprError::new(format!("secret \"{name}\" is not available on this device"))),
            }
        } else {
            out.push_str(&eval_expr(inner, env)?.to_js_string());
        }
        last = whole.end();
    }
    out.push_str(&text[last..]);
    Ok(out)
}

/// Formats a number exactly like JavaScript's `String(n)`.
pub fn format_number(n: f64) -> String {
    js_number_to_string(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env_vars() -> Vars {
        let mut v = Vars::new();
        v.insert("a".into(), Value::Num(2.0));
        v.insert("s".into(), Value::Str("Hello".into()));
        v.insert("l".into(), Value::List(vec![Value::Num(1.0), Value::Num(2.0), Value::Num(3.0)]));
        v
    }

    fn ev(src: &str) -> Result<Value, ExprError> {
        let vars = env_vars();
        let now = || 0.0;
        let random = || 0.0;
        eval_expr(src, &ExprEnv { vars: &vars, now: &now, random: &random })
    }

    #[test]
    fn regex_translation() {
        assert_eq!(translate_js_regex(r"\d+"), Ok("[0-9]+".to_owned()));
        assert_eq!(translate_js_regex(r"[\d\s]"), Ok(r"[[0-9]\s]".to_owned()));
        assert_eq!(translate_js_regex("(?i)x"), Err("Invalid group"));
        assert!(translate_js_regex("(?:x)").is_ok());
        assert!(ev("matches('abc123', '^[a-z]+\\\\d+$')").expect("ok").truthy());
        assert!(!ev("matches('١٢٣', '^\\\\d+$')").expect("ok").truthy());
    }

    #[test]
    fn invalid_regex_is_host_error() {
        let e = ev("matches('a', '(')").expect_err("invalid");
        assert!(e.host);
    }

    #[test]
    fn utf16_semantics() {
        assert_eq!(ev("len('😀')").expect("ok"), Value::Num(2.0));
        assert_eq!(ev("substr('héllo', 1, 3)").expect("ok"), Value::Str("éll".into()));
        assert_eq!(ev("substr('hello', -3)").expect("ok"), Value::Str("llo".into()));
        assert_eq!(ev("replace('abc', '', '-')").expect("ok"), Value::Str("a-b-c".into()));
        assert_eq!(ev("'b' > 'a'").expect("ok"), Value::Bool(true));
    }

    #[test]
    fn positions_and_messages() {
        let e = parse("1 + @").expect_err("bad char");
        assert_eq!(e.message, "unexpected character \"@\"");
        assert_eq!(e.pos, Some(4));
        assert_eq!(parse("'abc").expect_err("unterminated").message, "unterminated string");
        assert_eq!(parse("1 2").expect_err("trailing").message, "unexpected trailing input");
        assert_eq!(parse("(1").expect_err("paren").message, "expected \")\"");
        assert_eq!(ev("len()").expect_err("arity").message, "len() expects 1 argument(s)");
        assert_eq!(ev("substr()").expect_err("arity").message, "substr() expects 2-3 argument(s)");
        assert_eq!(ev("num('x')").expect_err("nan").message, "\"x\" is not a number");
    }

    #[test]
    fn limits() {
        let deep = "(".repeat(70) + "1" + &")".repeat(70);
        assert_eq!(parse(&deep).expect_err("deep").message, "expression too deep");
        let long = "1+".repeat(1001) + "1";
        assert_eq!(parse(&long).expect_err("long").message, "expression too long");
        assert_eq!(ev("len(range(100000))").expect("ok"), Value::Num(100_000.0));
        assert_eq!(ev("range(100001)").expect_err("big").message, "range too large");
    }
}
