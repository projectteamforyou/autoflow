//! Expression language, mirroring `describe("expressions")` in packages/core/test/core.test.ts
//! plus extra parity checks of JavaScript semantics.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::approx_constant)]

use autoflow_engine::expr::{check_expr, eval_expr, interpolate, referenced_vars, ExprEnv, Vars};
use autoflow_engine::Value;

fn vars() -> Vars {
    let mut v = Vars::new();
    v.insert("a".into(), Value::Num(2.0));
    v.insert("s".into(), Value::Str("Hello".into()));
    v.insert("l".into(), Value::List(vec![Value::Num(1.0), Value::Num(2.0), Value::Num(3.0)]));
    v
}

fn ev(src: &str) -> Value {
    let vars = vars();
    let now = || 0.0;
    let random = || 0.0;
    eval_expr(src, &ExprEnv { vars: &vars, now: &now, random: &random }).unwrap_or_else(|e| panic!("{src}: {e}"))
}

fn err(src: &str) -> String {
    let vars = vars();
    let now = || 0.0;
    let random = || 0.0;
    eval_expr(src, &ExprEnv { vars: &vars, now: &now, random: &random }).expect_err(src).message
}

fn n(x: f64) -> Value {
    Value::Num(x)
}
fn s(x: &str) -> Value {
    Value::Str(x.into())
}
fn b(x: bool) -> Value {
    Value::Bool(x)
}

#[test]
fn evaluates_arithmetic_precedence_and_logic() {
    assert_eq!(ev("1 + 2 * 3"), n(7.0));
    assert_eq!(ev("(1 + 2) * 3"), n(9.0));
    assert_eq!(ev("a > 1 && !false"), b(true));
    assert_eq!(ev("a == '2'"), b(true));
    assert_eq!(ev("a > 5 ? 'big' : 'small'"), s("small"));
    assert_eq!(ev("-a + 10 % 4"), n(0.0));
}

#[test]
fn supports_strings_lists_and_functions() {
    assert_eq!(ev("upper(s) + '!'"), s("HELLO!"));
    assert_eq!(ev("len(l)"), n(3.0));
    assert_eq!(ev("l[1] + l[-1]"), n(5.0));
    assert_eq!(ev("split('a,b,c', ',')[2]"), s("c"));
    assert_eq!(ev("contains(l, 2)"), b(true));
    assert_eq!(ev("join(range(3), '-')"), s("0-1-2"));
    assert_eq!(ev("round(3.14159, 2)"), n(3.14));
    assert_eq!(ev("[1, 'x'][1]"), s("x"));
}

#[test]
fn is_sandboxed() {
    assert!(err("constructor").contains("unknown variable"));
    assert!(err("eval('1')").contains("unknown function"));
    assert!(err("toString()").contains("unknown function"));
    assert!(err("1 / 0").contains("division by zero"));
    assert!(err("range(0, 1e9)").contains("too large"));
    assert!(err("matches('aaaa', '(a+)+$')").contains("too complex"));
    assert!(check_expr("1 +").is_some());
    assert!(check_expr("a && (b || c)").is_none());
}

#[test]
fn interpolates_text_and_resolves_secrets_without_inlining_them() {
    let vars = vars();
    let now = || 0.0;
    let random = || 0.0;
    let env = ExprEnv { vars: &vars, now: &now, random: &random };
    assert_eq!(interpolate("Hi {{ s }} x{{a*2}}", &env, None).unwrap(), "Hi Hello x4");
    let secret = |name: &str| (name == "main").then(|| "s3cret".to_owned());
    assert_eq!(interpolate("pw={{secret:main}}", &env, Some(&secret)).unwrap(), "pw=s3cret");
    let none = |_: &str| None;
    assert!(interpolate("{{secret:none}}", &env, Some(&none)).unwrap_err().message.contains("not available"));
    assert!(interpolate("{{secret:none}}", &env, None).unwrap_err().message.contains("not available"));
    assert_eq!(interpolate("no placeholders", &env, None).unwrap(), "no placeholders");
    assert_eq!(interpolate("{{ l }}|{{ null }}|{{ 0.1 + 0.2 }}", &env, None).unwrap(), "1,2,3||0.30000000000000004");
}

#[test]
fn javascript_semantics() {
    // && / || return operands
    assert_eq!(ev("0 || 'x'"), s("x"));
    assert_eq!(ev("'a' && 0"), n(0.0));
    // loose equality
    assert_eq!(ev("null == 0"), b(false));
    assert_eq!(ev("null == null"), b(true));
    assert_eq!(ev("true == 1"), b(true));
    assert_eq!(ev("'' == 0"), b(true));
    assert_eq!(ev("[1,2] == [1,2]"), b(true));
    assert_eq!(ev("'a' == 'a'"), b(true));
    assert_eq!(ev("'1e3' == 1000"), b(true));
    // + concatenation and list concat
    assert_eq!(ev("1 + '1'"), s("11"));
    assert_eq!(ev("[1] + [2]"), Value::List(vec![n(1.0), n(2.0)]));
    assert_eq!(ev("true + 1"), n(2.0));
    assert_eq!(ev("l + 1"), n(4.0)); // toNum(list) = length
                                     // comparisons
    assert_eq!(ev("'10' < '9'"), b(true));
    assert_eq!(ev("'10' < 9"), b(false));
    assert_eq!(err("'x' < 1"), "\"x\" is not a number");
    // numbers print like JavaScript
    assert_eq!(ev("str(1/3)"), s("0.3333333333333333"));
    assert_eq!(ev("str(1e21)"), s("1e+21"));
    assert_eq!(ev("str(-7 % 3)"), s("-1"));
    assert_eq!(ev("str(2.5 * 2)"), s("5"));
    // indexing
    assert_eq!(ev("s[0]"), s("H"));
    assert_eq!(ev("s[-1]"), s("o"));
    assert_eq!(ev("s[99]"), Value::Null);
    assert_eq!(ev("l[1.9]"), n(2.0));
    // functions
    assert_eq!(ev("trim('  x ')"), s("x"));
    assert_eq!(ev("replace('a-b-c', '-', '+')"), s("a+b+c"));
    assert_eq!(ev("substr('Hello', 1)"), s("ello"));
    assert_eq!(ev("substr('Hello', 1, 2)"), s("el"));
    assert_eq!(ev("startsWith(s, 'He') && endsWith(s, 'lo')"), b(true));
    assert_eq!(ev("num('  12.5 ')"), n(12.5));
    assert_eq!(ev("floor(-1.5) + ceil(1.2) + abs(-3)"), n(3.0));
    assert_eq!(ev("min(3, 1, 2) + max(3, 1, 2)"), n(4.0));
    assert_eq!(ev("random(1, 6)"), n(1.0));
    assert_eq!(ev("now()"), n(0.0));
    assert_eq!(ev("defined('a') && !defined('zz')"), b(true));
    assert_eq!(ev("push(l, 4)"), Value::List(vec![n(1.0), n(2.0), n(3.0), n(4.0)]));
    assert_eq!(ev("range(2, 5)"), Value::List(vec![n(2.0), n(3.0), n(4.0)]));
    assert_eq!(ev("matches('order-123', '^order-\\\\d+$')"), b(true));
    assert_eq!(ev("round(2.5)"), n(3.0));
    assert_eq!(ev("round(-2.5)"), n(-2.0));
    assert_eq!(ev("len(split('', ','))"), n(1.0));
    assert_eq!(ev("join('x', ',')"), s("x"));
    assert_eq!(ev("'it\\'s' + \"\\n\""), s("it's\n"));
    assert_eq!(ev(".5 + 1."), n(1.5));
}

#[test]
fn errors_and_limits_match_typescript_messages() {
    assert_eq!(err("min()"), "min() needs arguments");
    assert_eq!(err("upper()"), "upper() expects 1 argument(s)");
    assert_eq!(err("round(1,2,3)"), "round() expects 1-2 argument(s)");
    assert_eq!(err("now(1)"), "now() expects 0 argument(s)");
    assert_eq!(err("zz"), "unknown variable \"zz\"");
    assert_eq!(err("foo(1)"), "unknown function \"foo\"");
    assert_eq!(err("1 +"), "unexpected token");
    assert_eq!(err("1 # 2"), "unexpected character \"#\"");
    assert_eq!(err("10 % 0"), "division by zero");
    assert!(err("matches('a', '(')").starts_with("Invalid regular expression"));
    assert_eq!(err("num('abc')"), "\"abc\" is not a number");
    assert_eq!(err("num('Infinity')"), "number out of range");
    let long_pattern = format!("matches('a', '{}')", "a".repeat(201));
    assert_eq!(err(&long_pattern), "pattern too long");
    // Evaluation budget: 20 000 nodes.
    assert_eq!(ev("len(range(0, 100000)) + len(range(0, 5000))"), n(105_000.0));
    let many = (0..1000).map(|_| "1").collect::<Vec<_>>().join("+");
    assert_eq!(many.len(), 1999);
    assert_eq!(ev(&many), n(1000.0));
}

#[test]
fn referenced_variables() {
    let mut vars = referenced_vars("a + b[i] + len(c) + (d ? e : f)");
    vars.sort();
    assert_eq!(vars, vec!["a", "b", "c", "d", "e", "f", "i"]);
    assert!(referenced_vars("1 +").is_empty());
}

#[test]
fn date_functions_use_local_time() {
    use chrono::{Datelike, Local, TimeZone, Timelike};
    let vars = Vars::new();
    let t = Local.with_ymd_and_hms(2026, 10, 19, 9, 5, 7).single().expect("unambiguous time");
    #[allow(clippy::cast_precision_loss)]
    let ms = t.timestamp_millis() as f64;
    let now = move || ms;
    let random = || 0.5;
    let env = ExprEnv { vars: &vars, now: &now, random: &random };
    let get = |src: &str| eval_expr(src, &env).unwrap();
    assert_eq!(get("date()"), s("2026-10-19"));
    assert_eq!(get("time()"), s("09:05:07"));
    assert_eq!(get("hour()"), n(f64::from(t.hour())));
    assert_eq!(get("minute()"), n(5.0));
    assert_eq!(get("weekday()"), n(f64::from(t.weekday().num_days_from_sunday())));
    assert_eq!(get("random(1, 10)"), n(6.0));
}
