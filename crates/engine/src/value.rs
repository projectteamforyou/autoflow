//! Runtime values of the expression language and flow variables.
//!
//! Mirrors `Value` in `packages/core/src/expr.ts`: number, string, boolean, null and arrays.
//! Numbers are IEEE-754 doubles and are converted to and from strings exactly like JavaScript
//! (`String(n)` / `Number(s)`), so `{{ }}` interpolation produces identical text on every platform.

use serde::de::{self, Deserializer, SeqAccess, Visitor};
use serde::ser::{SerializeSeq, Serializer};
use serde::{Deserialize, Serialize};
use std::fmt;

/// A dynamically typed value.
#[derive(Debug, Clone, PartialEq, Default)]
pub enum Value {
    /// `null` (also stands in for JavaScript `undefined` results).
    #[default]
    Null,
    /// `true` / `false`.
    Bool(bool),
    /// A double-precision number.
    Num(f64),
    /// A string.
    Str(String),
    /// An ordered list of values.
    List(Vec<Value>),
}

impl Value {
    /// JavaScript truthiness as defined by `truthy()` in expr.ts (empty arrays are falsy).
    pub fn truthy(&self) -> bool {
        match self {
            Value::Null => false,
            Value::Bool(b) => *b,
            Value::Num(n) => *n != 0.0 && !n.is_nan(),
            Value::Str(s) => !s.is_empty(),
            Value::List(l) => !l.is_empty(),
        }
    }

    /// `toStr()` from expr.ts: null → "", arrays → comma-joined, numbers like `String(n)`.
    pub fn to_js_string(&self) -> String {
        match self {
            Value::Null => String::new(),
            Value::Bool(b) => b.to_string(),
            Value::Num(n) => js_number_to_string(*n),
            Value::Str(s) => s.clone(),
            Value::List(l) => l.iter().map(Value::to_js_string).collect::<Vec<_>>().join(","),
        }
    }

    /// JavaScript `Number(v)` (never throws; may return NaN).
    pub fn to_js_number(&self) -> f64 {
        match self {
            Value::Null => 0.0,
            Value::Bool(b) => f64::from(u8::from(*b)),
            Value::Num(n) => *n,
            Value::Str(s) => js_string_to_number(s),
            Value::List(_) => js_string_to_number(&self.to_js_string()),
        }
    }

    /// Converts arbitrary JSON into a value. Objects (not part of the language) become `null`.
    pub fn from_json(v: &serde_json::Value) -> Value {
        match v {
            serde_json::Value::Null | serde_json::Value::Object(_) => Value::Null,
            serde_json::Value::Bool(b) => Value::Bool(*b),
            serde_json::Value::Number(n) => Value::Num(n.as_f64().unwrap_or(f64::NAN)),
            serde_json::Value::String(s) => Value::Str(s.clone()),
            serde_json::Value::Array(a) => Value::List(a.iter().map(Value::from_json).collect()),
        }
    }

    /// Converts to JSON the way `JSON.stringify` would (non-finite numbers become `null`).
    pub fn to_json(&self) -> serde_json::Value {
        match self {
            Value::Null => serde_json::Value::Null,
            Value::Bool(b) => serde_json::Value::Bool(*b),
            Value::Num(n) => number_to_json(*n),
            Value::Str(s) => serde_json::Value::String(s.clone()),
            Value::List(l) => serde_json::Value::Array(l.iter().map(Value::to_json).collect()),
        }
    }

    /// Short type name used in diagnostics.
    pub fn type_name(&self) -> &'static str {
        match self {
            Value::Null => "null",
            Value::Bool(_) => "boolean",
            Value::Num(_) => "number",
            Value::Str(_) => "string",
            Value::List(_) => "list",
        }
    }
}

impl From<bool> for Value {
    fn from(b: bool) -> Self {
        Value::Bool(b)
    }
}
impl From<f64> for Value {
    fn from(n: f64) -> Self {
        Value::Num(n)
    }
}
impl From<i64> for Value {
    fn from(n: i64) -> Self {
        // Precision loss above 2^53 matches JavaScript numbers.
        #[allow(clippy::cast_precision_loss)]
        Value::Num(n as f64)
    }
}
impl From<&str> for Value {
    fn from(s: &str) -> Self {
        Value::Str(s.to_owned())
    }
}
impl From<String> for Value {
    fn from(s: String) -> Self {
        Value::Str(s)
    }
}
impl From<Vec<Value>> for Value {
    fn from(l: Vec<Value>) -> Self {
        Value::List(l)
    }
}

/// Largest integer that a double represents exactly (`Number.MAX_SAFE_INTEGER`).
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

/// Integral numbers are written without a fraction (`2`, not `2.0`), non-finite ones as `null`.
pub(crate) fn number_to_json(n: f64) -> serde_json::Value {
    if !n.is_finite() {
        return serde_json::Value::Null;
    }
    if n.fract() == 0.0 && n.abs() <= MAX_SAFE {
        // In range and integral, so the cast is exact.
        #[allow(clippy::cast_possible_truncation)]
        return serde_json::Value::from(n as i64);
    }
    serde_json::Number::from_f64(n).map_or(serde_json::Value::Null, serde_json::Value::Number)
}

impl Serialize for Value {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Value::Null => s.serialize_unit(),
            Value::Bool(b) => s.serialize_bool(*b),
            Value::Num(n) => {
                if !n.is_finite() {
                    s.serialize_unit()
                } else if n.fract() == 0.0 && n.abs() <= MAX_SAFE {
                    #[allow(clippy::cast_possible_truncation)]
                    s.serialize_i64(*n as i64)
                } else {
                    s.serialize_f64(*n)
                }
            }
            Value::Str(v) => s.serialize_str(v),
            Value::List(l) => {
                let mut seq = s.serialize_seq(Some(l.len()))?;
                for item in l {
                    seq.serialize_element(item)?;
                }
                seq.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for Value {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        struct V;
        impl<'de> Visitor<'de> for V {
            type Value = Value;
            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("null, a boolean, a number, a string or an array")
            }
            fn visit_unit<E: de::Error>(self) -> Result<Value, E> {
                Ok(Value::Null)
            }
            fn visit_none<E: de::Error>(self) -> Result<Value, E> {
                Ok(Value::Null)
            }
            fn visit_some<D2: Deserializer<'de>>(self, d: D2) -> Result<Value, D2::Error> {
                Value::deserialize(d)
            }
            fn visit_bool<E: de::Error>(self, b: bool) -> Result<Value, E> {
                Ok(Value::Bool(b))
            }
            #[allow(clippy::cast_precision_loss)]
            fn visit_i64<E: de::Error>(self, n: i64) -> Result<Value, E> {
                Ok(Value::Num(n as f64))
            }
            #[allow(clippy::cast_precision_loss)]
            fn visit_u64<E: de::Error>(self, n: u64) -> Result<Value, E> {
                Ok(Value::Num(n as f64))
            }
            fn visit_f64<E: de::Error>(self, n: f64) -> Result<Value, E> {
                Ok(Value::Num(n))
            }
            fn visit_str<E: de::Error>(self, s: &str) -> Result<Value, E> {
                Ok(Value::Str(s.to_owned()))
            }
            fn visit_string<E: de::Error>(self, s: String) -> Result<Value, E> {
                Ok(Value::Str(s))
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
                let mut out = Vec::new();
                while let Some(v) = seq.next_element::<Value>()? {
                    out.push(v);
                }
                Ok(Value::List(out))
            }
            fn visit_map<A: de::MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
                // Objects are not values of the language; drain and map to null.
                while map.next_entry::<de::IgnoredAny, de::IgnoredAny>()?.is_some() {}
                Ok(Value::Null)
            }
        }
        d.deserialize_any(V)
    }
}

/* ------------------------------------------------------------ JS number semantics */

/// `Number.prototype.toString()` (radix 10) — shortest round-trip representation, JS formatting.
pub fn js_number_to_string(n: f64) -> String {
    let mut buf = ryu_js::Buffer::new();
    buf.format(n).to_owned()
}

/// Characters JavaScript treats as white space / line terminators for `trim()` and `Number()`.
pub(crate) fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}' | '\u{000A}' | '\u{000B}' | '\u{000C}' | '\u{000D}' | '\u{0020}' | '\u{00A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// `String.prototype.trim()`.
pub(crate) fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_whitespace)
}

/// JavaScript `Number(string)` (StringToNumber): decimal, `Infinity`, and 0x/0o/0b integers.
pub fn js_string_to_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    let lower_prefix = |p: &str| t.len() > 2 && t.get(..2).is_some_and(|head| head.eq_ignore_ascii_case(p));
    for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] {
        if lower_prefix(prefix) {
            let digits = &t[2..];
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            let mut v = 0.0f64;
            for c in digits.chars() {
                v = v * f64::from(radix) + f64::from(c.to_digit(radix).unwrap_or(0));
            }
            return v;
        }
    }
    let (sign, body) = match t.as_bytes()[0] {
        b'+' => (1.0, &t[1..]),
        b'-' => (-1.0, &t[1..]),
        _ => (1.0, t),
    };
    if body == "Infinity" {
        return sign * f64::INFINITY;
    }
    if !is_decimal_literal(body) {
        return f64::NAN;
    }
    body.parse::<f64>().map_or(f64::NAN, |v| sign * v)
}

/// `StrUnsignedDecimalLiteral` without `Infinity`: `1`, `1.`, `.5`, `1.5e-3`.
fn is_decimal_literal(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = 0;
    let int_start = i;
    while i < b.len() && b[i].is_ascii_digit() {
        i += 1;
    }
    let int_digits = i - int_start;
    let mut frac_digits = 0;
    if i < b.len() && b[i] == b'.' {
        i += 1;
        let f = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        frac_digits = i - f;
    }
    if int_digits == 0 && frac_digits == 0 {
        return false;
    }
    if i < b.len() && (b[i] == b'e' || b[i] == b'E') {
        i += 1;
        if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
            i += 1;
        }
        let e = i;
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        if i == e {
            return false;
        }
    }
    i == b.len()
}

/// `Math.round`: halves round towards +∞.
pub(crate) fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// Length of a string in UTF-16 code units (JavaScript `.length`).
pub(crate) fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_format_like_javascript() {
        assert_eq!(js_number_to_string(4.0), "4");
        assert_eq!(js_number_to_string(2.75), "2.75");
        assert_eq!(js_number_to_string(-0.0), "0");
        assert_eq!(js_number_to_string(1e21), "1e+21");
        assert_eq!(js_number_to_string(0.000001), "0.000001");
        assert_eq!(js_number_to_string(1e-7), "1e-7");
        assert_eq!(js_number_to_string(f64::NAN), "NaN");
        assert_eq!(js_number_to_string(f64::INFINITY), "Infinity");
        assert_eq!(js_number_to_string(0.1 + 0.2), "0.30000000000000004");
    }

    #[test]
    fn strings_parse_like_javascript() {
        assert_eq!(js_string_to_number(" 12 "), 12.0);
        assert_eq!(js_string_to_number(""), 0.0);
        assert_eq!(js_string_to_number("0x1F"), 31.0);
        assert_eq!(js_string_to_number("-Infinity"), f64::NEG_INFINITY);
        assert_eq!(js_string_to_number(".5"), 0.5);
        assert_eq!(js_string_to_number("5."), 5.0);
        assert!(js_string_to_number("inf").is_nan());
        assert!(js_string_to_number("1,2").is_nan());
        assert!(js_string_to_number("-0x1").is_nan());
        assert!(js_string_to_number("abc").is_nan());
    }

    #[test]
    fn rounding_matches_math_round() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-2.6), -3.0);
    }

    #[test]
    fn json_round_trip() {
        let v: Value = serde_json::from_str(r#"[1, "a", true, null, [2.5]]"#).expect("valid json");
        assert_eq!(serde_json::to_string(&v).expect("serializes"), r#"[1,"a",true,null,[2.5]]"#);
    }
}
