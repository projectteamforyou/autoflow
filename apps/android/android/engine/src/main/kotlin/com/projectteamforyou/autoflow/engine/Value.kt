package com.projectteamforyou.autoflow.engine

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.math.BigDecimal

/**
 * Runtime value of the safe expression language — the Kotlin mirror of `Value` in packages/core/src/expr.ts:
 * number | string | boolean | null | Value[]. Numbers are IEEE doubles, exactly like JavaScript.
 */
sealed class Value {
    data class Num(val v: Double) : Value()
    data class Str(val v: String) : Value()
    data class Bool(val v: Boolean) : Value()
    object Null : Value() {
        override fun toString(): String = "Null"
    }
    data class VList(val items: List<Value>) : Value()

    companion object {
        val TRUE = Bool(true)
        val FALSE = Bool(false)
        fun of(b: Boolean): Value = if (b) TRUE else FALSE
        fun of(n: Number): Value = Num(n.toDouble())
        fun of(s: String): Value = Str(s)
        fun list(vararg items: Value): Value = VList(items.toList())

        /** Converts arbitrary JSON (flow variable initial values, run inputs) into a Value. Objects become their JSON text. */
        fun fromJson(e: JsonElement?): Value = when (e) {
            null, JsonNull -> Null
            is JsonArray -> VList(e.map { fromJson(it) })
            is JsonObject -> Str(e.toString())
            is JsonPrimitive -> when {
                e.isString -> Str(e.content)
                e.booleanOrNull != null -> of(e.booleanOrNull!!)
                e.doubleOrNull != null -> Num(e.doubleOrNull!!)
                else -> Str(e.content)
            }
        }
    }
}

/** JSON encoding identical to what `JSON.stringify` produces for the TypeScript engine's values. */
fun Value.toJson(): JsonElement = when (this) {
    is Value.Num -> if (v.isFinite()) {
        if (v == Math.floor(v) && Math.abs(v) < 9.007199254740992E15) JsonPrimitive(v.toLong()) else JsonPrimitive(v)
    } else JsonNull // JSON.stringify(NaN / Infinity) === "null"
    is Value.Str -> JsonPrimitive(v)
    is Value.Bool -> JsonPrimitive(v)
    Value.Null -> JsonNull
    is Value.VList -> JsonArray(items.map { it.toJson() })
}

/** JavaScript `!!v`, except that lists are truthy only when non-empty (expr.ts `truthy`). */
fun truthy(v: Value): Boolean = when (v) {
    is Value.VList -> v.items.isNotEmpty()
    is Value.Num -> v.v != 0.0 && !v.v.isNaN()
    is Value.Str -> v.v.isNotEmpty()
    is Value.Bool -> v.v
    Value.Null -> false
}

/** expr.ts `toStr`: null → "", lists joined with ",", numbers formatted like JavaScript's `String(n)`. */
fun toStr(v: Value): String = when (v) {
    Value.Null -> ""
    is Value.VList -> v.items.joinToString(",") { toStr(it) }
    is Value.Num -> jsNumberToString(v.v)
    is Value.Str -> v.v
    is Value.Bool -> if (v.v) "true" else "false"
}

/** expr.ts `toNum`: throws [ExprError] for strings that are not numbers. */
fun toNum(v: Value): Double = when (v) {
    is Value.Num -> v.v
    is Value.Bool -> if (v.v) 1.0 else 0.0
    Value.Null -> 0.0
    is Value.VList -> v.items.size.toDouble()
    is Value.Str -> {
        val n = jsStringToNumber(v.v)
        if (n.isNaN()) throw ExprError("\"${v.v}\" is not a number")
        n
    }
}

/** JavaScript `Number(v)` (never throws, may be NaN) — used by loose equality and variable coercion. */
fun jsCoerceNumber(v: Value): Double = when (v) {
    is Value.Num -> v.v
    is Value.Bool -> if (v.v) 1.0 else 0.0
    Value.Null -> 0.0
    is Value.Str -> jsStringToNumber(v.v)
    is Value.VList -> jsStringToNumber(toStr(v))
}

/** expr.ts `eq`: element-wise for lists, numeric when either side is a number, strict otherwise. */
fun looseEq(a: Value, b: Value): Boolean {
    if (a is Value.VList && b is Value.VList) {
        return a.items.size == b.items.size && a.items.indices.all { looseEq(a.items[it], b.items[it]) }
    }
    if (a is Value.Num || b is Value.Num) {
        if (a == Value.Null || b == Value.Null) return strictEq(a, b)
        val x = jsCoerceNumber(a)
        val y = jsCoerceNumber(b)
        if (!x.isNaN() && !y.isNaN()) return x == y
    }
    return strictEq(a, b)
}

private fun strictEq(a: Value, b: Value): Boolean = when {
    a is Value.Num && b is Value.Num -> a.v == b.v // NaN !== NaN, like JS
    a is Value.VList || b is Value.VList -> a === b
    else -> a == b
}

private val JS_WS = setOf(
    '\u0009', '\u000A', '\u000B', '\u000C', '\u000D', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
    ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', ' ', '　', '﻿',
)

fun isJsWhitespace(c: Char): Boolean = c in JS_WS

/** `String.prototype.trim`. */
fun jsTrim(s: String): String {
    var start = 0
    var end = s.length
    while (start < end && isJsWhitespace(s[start])) start++
    while (end > start && isJsWhitespace(s[end - 1])) end--
    return s.substring(start, end)
}

private val DECIMAL = Regex("^[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?$")

/** JavaScript `Number(string)`. */
fun jsStringToNumber(raw: String): Double {
    val s = jsTrim(raw)
    if (s.isEmpty()) return 0.0
    when (s) {
        "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY
        "-Infinity" -> return Double.NEGATIVE_INFINITY
    }
    if (s.length > 2 && s[0] == '0') {
        val radix = when (s[1]) {
            'x', 'X' -> 16
            'o', 'O' -> 8
            'b', 'B' -> 2
            else -> 0
        }
        if (radix != 0) {
            return try {
                java.math.BigInteger(s.substring(2), radix).toDouble()
            } catch (_: NumberFormatException) {
                Double.NaN
            }
        }
    }
    if (!DECIMAL.matches(s)) return Double.NaN
    return s.toDouble()
}

/** JavaScript `Number.prototype.toString()` (ECMA-262 Number::toString, radix 10). */
fun jsNumberToString(d: Double): String {
    if (d.isNaN()) return "NaN"
    if (d == Double.POSITIVE_INFINITY) return "Infinity"
    if (d == Double.NEGATIVE_INFINITY) return "-Infinity"
    if (d == 0.0) return "0"
    if (d < 0) return "-" + jsNumberToString(-d)
    if (d == Math.floor(d) && d < 9.007199254740992E15) return d.toLong().toString()
    // Shortest round-trip digits (JDK 19+ Double.toString), then JS layout rules.
    val bd = BigDecimal(d.toString()).stripTrailingZeros()
    val digits = bd.unscaledValue().toString()
    val k = digits.length
    val n = k - bd.scale() // value = 0.digits × 10^n
    return when {
        n in k..21 -> digits + "0".repeat(n - k)
        n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
        n in -5..0 -> "0." + "0".repeat(-n) + digits
        else -> {
            val e = n - 1
            val sign = if (e >= 0) "+" else "-"
            val mant = if (k == 1) digits else digits[0] + "." + digits.substring(1)
            "${mant}e$sign${Math.abs(e)}"
        }
    }
}
