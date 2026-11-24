package com.projectteamforyou.autoflow.engine

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.ConcurrentHashMap

/**
 * Safe expression language — a line-by-line port of packages/core/src/expr.ts.
 *
 * - No reflection, no host object access, no I/O.
 * - Values: number, string, boolean, null, lists.
 * - Operators: + - * / % ! && || == != < <= > >= ?: and parentheses; [index] on lists/strings.
 * - Functions: the fixed allow-list in [FUNCTIONS].
 * - Bounded: max source length, max AST depth, max evaluation steps, max string/list size.
 */
class ExprError(message: String, val pos: Int = -1) : Exception(message)

const val MAX_SOURCE = 2000
const val MAX_DEPTH = 64
const val MAX_STEPS = 20_000
const val MAX_STRING = 1_000_000
private const val MAX_SAFE_INT = 9_007_199_254_740_991.0
const val MAX_LIST = 100_000
/**
 * Total characters held by the strings of one list (UTF-16 units; `MAX_LIST_CHARS` in expr.ts). The node and string
 * limits alone still allow 100 000 × 1 MB: engines that copy values (Rust, Kotlin) would exhaust memory where the
 * JavaScript engine merely shares references, so all three refuse such a list the same way.
 */
const val MAX_LIST_CHARS = 16_000_000

/** Evaluation step budget shared by the evaluator and the deep comparisons it triggers (`Budget`/`spend` in expr.ts). */
class Budget(var steps: Int = 0) {
    fun spend() {
        if (++steps > MAX_STEPS) throw ExprError("expression too expensive")
    }
}

private sealed class Tok(val p: Int) {
    class Num(val v: Double, p: Int) : Tok(p)
    class Str(val v: String, p: Int) : Tok(p)
    class Id(val v: String, p: Int) : Tok(p)
    class Op(val v: String, p: Int) : Tok(p)
    class Eof(p: Int) : Tok(p)
}

private val OPS = listOf("&&", "||", "==", "!=", "<=", ">=", "+", "-", "*", "/", "%", "!", "<", ">", "(", ")", ",", "?", ":", "[", "]")
private val NUMBER_RE = Regex("^(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?")
private val IDENT_RE = Regex("^[A-Za-z_][A-Za-z0-9_]*")

private fun isDigit(c: Char?) = c != null && c in '0'..'9'
private fun isIdentStart(c: Char) = c == '_' || c in 'A'..'Z' || c in 'a'..'z'

private fun tokenize(src: String): List<Tok> {
    if (src.length > MAX_SOURCE) throw ExprError("expression too long")
    val out = ArrayList<Tok>()
    var i = 0
    while (i < src.length) {
        val c = src[i]
        if (isJsWhitespace(c)) {
            i++
            continue
        }
        if (isDigit(c) || (c == '.' && isDigit(src.getOrNull(i + 1)))) {
            val m = NUMBER_RE.find(src.substring(i))!!.value
            out.add(Tok.Num(m.toDouble(), i))
            i += m.length
            continue
        }
        if (c == '"' || c == '\'') {
            val sb = StringBuilder()
            var j = i + 1
            while (true) {
                if (j >= src.length) throw ExprError("unterminated string", i)
                val d = src[j]
                if (d == '\\') {
                    when (val n = src.getOrNull(j + 1)) {
                        'n' -> sb.append('\n')
                        't' -> sb.append('\t')
                        null -> Unit
                        else -> sb.append(n)
                    }
                    j += 2
                    continue
                }
                if (d == c) break
                sb.append(d)
                j++
            }
            out.add(Tok.Str(sb.toString(), i))
            i = j + 1
            continue
        }
        if (isIdentStart(c)) {
            val m = IDENT_RE.find(src.substring(i))!!.value
            out.add(Tok.Id(m, i))
            i += m.length
            continue
        }
        val op = OPS.firstOrNull { src.startsWith(it, i) } ?: throw ExprError("unexpected character \"$c\"", i)
        out.add(Tok.Op(op, i))
        i += op.length
    }
    out.add(Tok.Eof(src.length))
    return out
}

/** Parsed expression tree (immutable, safe to cache and share across threads). */
sealed class Node {
    data class Lit(val v: Value) : Node()
    data class Var(val name: String) : Node()
    data class Un(val op: String, val a: Node) : Node()
    data class Bin(val op: String, val a: Node, val b: Node) : Node()
    data class Cond(val c: Node, val a: Node, val b: Node) : Node()
    data class Call(val fn: String, val args: List<Node>) : Node()
    data class Idx(val a: Node, val i: Node) : Node()
    data class ListLit(val items: List<Node>) : Node()
}

private val BP = mapOf("||" to 1, "&&" to 2, "==" to 3, "!=" to 3, "<" to 4, "<=" to 4, ">" to 4, ">=" to 4, "+" to 5, "-" to 5, "*" to 6, "/" to 6, "%" to 6)

private class Parser(src: String) {
    private val toks = tokenize(src)
    private var pos = 0
    private fun peek() = toks[pos]
    private fun next() = toks[pos++]
    private fun peekIsOp(v: String) = (peek() as? Tok.Op)?.v == v
    private fun expectOp(v: String) {
        val t = next()
        if (t !is Tok.Op || t.v != v) throw ExprError("expected \"$v\"", t.p)
    }

    private fun args(close: String, depth: Int): List<Node> {
        val out = ArrayList<Node>()
        if (!peekIsOp(close)) {
            while (true) {
                out.add(expression(0, depth + 1))
                if (peekIsOp(",")) {
                    next()
                    continue
                }
                break
            }
        }
        expectOp(close)
        return out
    }

    private fun primary(depth: Int): Node {
        if (depth > MAX_DEPTH) throw ExprError("expression too deep")
        val t = next()
        var node: Node = when {
            t is Tok.Num -> Node.Lit(Value.Num(t.v))
            t is Tok.Str -> Node.Lit(Value.Str(t.v))
            t is Tok.Id -> when {
                t.v == "true" || t.v == "false" -> Node.Lit(Value.of(t.v == "true"))
                t.v == "null" -> Node.Lit(Value.Null)
                peekIsOp("(") -> {
                    next()
                    val a = args(")", depth)
                    if (!FUNCTIONS.containsKey(t.v)) throw ExprError("unknown function \"${t.v}\"", t.p)
                    Node.Call(t.v, a)
                }
                else -> Node.Var(t.v)
            }
            t is Tok.Op && t.v == "(" -> {
                val n = expression(0, depth + 1)
                expectOp(")")
                n
            }
            t is Tok.Op && t.v == "[" -> Node.ListLit(args("]", depth))
            t is Tok.Op && (t.v == "!" || t.v == "-") -> return Node.Un(t.v, primary(depth + 1))
            else -> throw ExprError("unexpected token", t.p)
        }
        while (peekIsOp("[")) {
            next()
            val i = expression(0, depth + 1)
            expectOp("]")
            node = Node.Idx(node, i)
        }
        return node
    }

    fun expression(minBp: Int, depth: Int): Node {
        var left = primary(depth + 1)
        while (true) {
            val t = peek() as? Tok.Op ?: break
            if (t.v == "?" && minBp == 0) {
                next()
                val a = expression(0, depth + 1)
                expectOp(":")
                val b = expression(0, depth + 1)
                left = Node.Cond(left, a, b)
                continue
            }
            val bp = BP[t.v]
            if (bp == null || bp <= minBp) break
            next()
            val right = expression(bp, depth + 1)
            left = Node.Bin(t.v, left, right)
        }
        return left
    }

    fun parseAll(): Node {
        val n = expression(0, 0)
        if (peek() !is Tok.Eof) throw ExprError("unexpected trailing input", peek().p)
        return n
    }
}

fun parseExpr(src: String): Node = Parser(src).parseAll()

/** Evaluation environment. Clock, RNG and time zone are injectable so tests and replays are reproducible. */
class ExprEnv(
    val vars: MutableMap<String, Value>,
    val now: () -> Long = { System.currentTimeMillis() },
    val random: (() -> Double)? = null,
    val zone: ZoneId = ZoneId.systemDefault(),
)

/** Deepest list nesting a value may have; deeper values are rejected like oversized ones. */
const val MAX_LIST_DEPTH = 64

/**
 * Charges every nested element to one shared budget (`left[0]` nodes, `left[1]` string characters), so a self-nesting
 * list (`v = [v, v]` repeated) cannot hide 2^n leaves behind a small top-level length. Shared sub-lists are counted
 * each time they are reached: that is the work every later deep operation (toStr, looseEq, toJson) would do.
 * Port of `listNodes` in expr.ts.
 */
private fun listNodes(list: List<Value>, depth: Int, left: IntArray) {
    if (depth > MAX_LIST_DEPTH) throw ExprError("list too large")
    for (x in list) {
        if (--left[0] < 0) throw ExprError("list too large")
        if (x is Value.VList) listNodes(x.items, depth + 1, left)
        else if (x is Value.Str) {
            left[1] -= x.v.length
            if (left[1] < 0) throw ExprError("list too large")
        }
    }
}

private fun guard(v: Value): Value {
    if (v is Value.Str && v.v.length > MAX_STRING) throw ExprError("string too large")
    if (v is Value.VList) {
        if (v.items.size > MAX_LIST) throw ExprError("list too large")
        listNodes(v.items, 0, intArrayOf(MAX_LIST, MAX_LIST_CHARS))
    }
    if (v is Value.Num && !v.v.isFinite()) throw ExprError("number out of range")
    return v
}

private fun arity(name: String, args: List<Value>, min: Int, max: Int = min) {
    if (args.size < min || args.size > max) {
        throw ExprError("$name() expects ${if (min == max) "$min" else "$min-$max"} argument(s)")
    }
}

/** JavaScript `"a,b".split(sep)` — an empty separator splits into UTF-16 units. */
private fun jsSplit(s: String, sep: String): List<String> = if (sep.isEmpty()) s.map { it.toString() } else s.split(sep)

/**
 * JavaScript `Math.round`: halves round toward +∞. Not `floor(x + 0.5)`: that adds a rounding error of its own, so
 * round(0.49999999999999994) would give 1 and round(2^52 + 1) would give 2^52 + 2.
 */
private fun jsRound(x: Double): Double {
    val f = Math.floor(x)
    return if (x - f >= 0.5) f + 1 else f
}

/** JavaScript ToIntegerOrInfinity. */
private fun toIntegerOrInfinity(d: Double): Double = if (d.isNaN()) 0.0 else if (d.isInfinite()) d else if (d < 0) Math.ceil(d) else Math.floor(d)

private fun jsSubstr(s: String, startArg: Double, lengthArg: Double?): String {
    val size = s.length
    var start = toIntegerOrInfinity(startArg)
    if (start == Double.NEGATIVE_INFINITY) start = 0.0 else if (start < 0) start = maxOf(size + start, 0.0)
    val length = if (lengthArg == null) size.toDouble() else toIntegerOrInfinity(lengthArg)
    val first = minOf(start, size.toDouble())
    val count = minOf(maxOf(length, 0.0), size - first)
    if (count <= 0) return ""
    return s.substring(first.toInt(), (first + count).toInt())
}

/** ECMAScript TimeClip: `new Date(ms)` is an Invalid Date outside ±8.64e15 ms or for NaN / Infinity. */
private const val MAX_TIME_MS = 8.64e15

/**
 * `new Date(ms)` in local time, or null for an Invalid Date (every getter then returns NaN, which the TypeScript
 * `date()` / `time()` render as "NaN-NaN-NaN" / "NaN:NaN:NaN").
 */
private fun localTime(env: ExprEnv, args: List<Value>): ZonedDateTime? {
    val ms: Long = if (args.isNotEmpty()) {
        val d = toNum(args[0])
        if (!d.isFinite() || Math.abs(d) > MAX_TIME_MS) return null
        d.toLong() // ToIntegerOrInfinity: truncates toward zero
    } else env.now()
    return Instant.ofEpochMilli(ms).atZone(env.zone)
}

private fun pad2(n: Int) = n.toString().padStart(2, '0')

/**
 * Kept for parity with the TypeScript and Rust engines, which reject the same nested-quantifier patterns with
 * "pattern too complex" (the linear-time engine would cope, but the three engines must agree on every pattern).
 */
private val NESTED_QUANTIFIER = Regex("\\([^)]*[+*][^)]*\\)[+*{]")

private val REGEX_CACHE = ConcurrentHashMap<String, SafeRegex>()

/** expr.ts `safeRegex`: compiles through [SafeRegex] (linear time) and caches a few recent patterns. */
private fun safeRegex(pattern: String): SafeRegex {
    REGEX_CACHE[pattern]?.let { return it }
    val re = try {
        SafeRegex.compile(pattern)
    } catch (e: RegexError) {
        throw ExprError("invalid pattern: ${e.message}")
    }
    if (REGEX_CACHE.size > 64) REGEX_CACHE.clear()
    REGEX_CACHE[pattern] = re
    return re
}

/** A built-in function: arguments, environment and the evaluation's step budget (expr.ts `Fn`). */
typealias ExprFn = (List<Value>, ExprEnv, Budget) -> Value

val FUNCTIONS: Map<String, ExprFn> = mapOf(
    "len" to { a, _, _ -> arity("len", a, 1); val x = a[0]; Value.Num(if (x is Value.VList) x.items.size.toDouble() else toStr(x).length.toDouble()) },
    "upper" to { a, _, _ -> arity("upper", a, 1); Value.Str(toStr(a[0]).uppercase()) },
    "lower" to { a, _, _ -> arity("lower", a, 1); Value.Str(toStr(a[0]).lowercase()) },
    "trim" to { a, _, _ -> arity("trim", a, 1); Value.Str(jsTrim(toStr(a[0]))) },
    "contains" to { a, _, budget ->
        arity("contains", a, 2)
        val x = a[0]
        Value.of(if (x is Value.VList) x.items.any { looseEq(it, a[1], budget) } else toStr(x).contains(toStr(a[1])))
    },
    "startsWith" to { a, _, _ -> arity("startsWith", a, 2); Value.of(toStr(a[0]).startsWith(toStr(a[1]))) },
    "endsWith" to { a, _, _ -> arity("endsWith", a, 2); Value.of(toStr(a[0]).endsWith(toStr(a[1]))) },
    "replace" to { a, _, _ ->
        arity("replace", a, 3)
        val (src, from, to) = Triple(toStr(a[0]), toStr(a[1]), toStr(a[2]))
        // Size the result first: replace(s, "", s) would otherwise square the input in memory.
        val pieces = if (from.isEmpty()) src.length.toLong() else (src.split(from).size).toLong()
        val out = src.length - (if (from.isEmpty()) 0L else (pieces - 1) * from.length) + maxOf(0L, pieces - 1) * to.length
        if (out > MAX_STRING) throw ExprError("string too large")
        Value.Str(jsSplit(src, from).joinToString(to))
    },
    "substr" to { a, _, _ ->
        arity("substr", a, 2, 3)
        Value.Str(jsSubstr(toStr(a[0]), toNum(a[1]), if (a.size == 3) toNum(a[2]) else null))
    },
    "split" to { a, _, _ -> arity("split", a, 2); Value.VList(jsSplit(toStr(a[0]), toStr(a[1])).take(MAX_LIST).map { Value.Str(it) }) },
    "join" to { a, _, _ ->
        arity("join", a, 2)
        val x = a[0]
        val items = if (x is Value.VList) x.items else listOf(x)
        val sep = toStr(a[1])
        // Running total like expr.ts `join`: the result is refused before it is built, not after.
        var total = maxOf(0, items.size - 1).toLong() * sep.length
        val parts = items.map { item ->
            val p = toStr(item)
            total += p.length
            if (total > MAX_STRING) throw ExprError("string too large")
            p
        }
        Value.Str(parts.joinToString(sep))
    },
    "num" to { a, _, _ -> arity("num", a, 1); Value.Num(toNum(a[0])) },
    "str" to { a, _, _ -> arity("str", a, 1); Value.Str(toStr(a[0])) },
    "round" to { a, _, _ ->
        arity("round", a, 1, 2)
        val d = if (a.size == 2) maxOf(0.0, minOf(10.0, toNum(a[1]))) else 0.0
        val f = Math.pow(10.0, d)
        Value.Num(jsRound(toNum(a[0]) * f) / f)
    },
    "floor" to { a, _, _ -> arity("floor", a, 1); Value.Num(Math.floor(toNum(a[0]))) },
    "ceil" to { a, _, _ -> arity("ceil", a, 1); Value.Num(Math.ceil(toNum(a[0]))) },
    "abs" to { a, _, _ -> arity("abs", a, 1); Value.Num(Math.abs(toNum(a[0]))) },
    "min" to { a, _, _ -> if (a.isEmpty()) throw ExprError("min() needs arguments"); Value.Num(a.minOf { toNum(it) }) },
    "max" to { a, _, _ -> if (a.isEmpty()) throw ExprError("max() needs arguments"); Value.Num(a.maxOf { toNum(it) }) },
    "random" to { a, env, _ ->
        arity("random", a, 2)
        val lo = Math.ceil(toNum(a[0]))
        val hi = Math.floor(toNum(a[1]))
        Value.Num(lo + Math.floor((env.random ?: Math::random)() * (hi - lo + 1)))
    },
    "now" to { a, env, _ -> arity("now", a, 0); Value.Num(env.now().toDouble()) },
    "hour" to { a, env, _ -> arity("hour", a, 0); Value.Num(localTime(env, a)!!.hour.toDouble()) },
    "minute" to { a, env, _ -> arity("minute", a, 0); Value.Num(localTime(env, a)!!.minute.toDouble()) },
    "weekday" to { a, env, _ -> arity("weekday", a, 0); Value.Num((localTime(env, a)!!.dayOfWeek.value % 7).toDouble()) },
    "date" to { a, env, _ ->
        arity("date", a, 0, 1)
        val d = localTime(env, a)
        Value.Str(if (d == null) "NaN-NaN-NaN" else "${d.year}-${pad2(d.monthValue)}-${pad2(d.dayOfMonth)}")
    },
    "time" to { a, env, _ ->
        arity("time", a, 0, 1)
        val d = localTime(env, a)
        Value.Str(if (d == null) "NaN:NaN:NaN" else "${pad2(d.hour)}:${pad2(d.minute)}:${pad2(d.second)}")
    },
    "defined" to { a, env, _ -> arity("defined", a, 1); Value.of(env.vars.containsKey(toStr(a[0]))) },
    "push" to { a, _, _ ->
        arity("push", a, 2)
        val l = (a[0] as? Value.VList)?.items ?: emptyList()
        Value.VList(l + a[1])
    },
    "range" to { a, _, _ ->
        arity("range", a, 1, 2)
        val lo = if (a.size == 1) 0.0 else toNum(a[0])
        val hi = if (a.size == 1) toNum(a[0]) else toNum(a[1])
        // Past 2^53 `i += 1.0` no longer changes `i`, so bounds must be safe integers in magnitude.
        if (!(Math.abs(lo) <= MAX_SAFE_INT && Math.abs(hi) <= MAX_SAFE_INT)) throw ExprError("range() bounds out of range")
        if (hi - lo > MAX_LIST) throw ExprError("range too large")
        val out = ArrayList<Value>()
        var k = 0.0
        while (lo + k < hi) {
            out.add(Value.Num(lo + k))
            k += 1.0
        }
        Value.VList(out)
    },
    /**
     * Regular-expression test (expr.ts `matches`). Patterns are untrusted (shared flows), so they run on the
     * linear-time [SafeRegex] engine instead of the backtracking java.util.regex one.
     */
    "matches" to { a, _, _ ->
        arity("matches", a, 2)
        val pattern = toStr(a[1])
        if (pattern.length > MAX_PATTERN) throw ExprError("pattern too long")
        if (NESTED_QUANTIFIER.containsMatchIn(pattern)) throw ExprError("pattern too complex")
        Value.of(safeRegex(pattern).test(toStr(a[0]).take(10_000)))
    },
)

val FUNCTION_NAMES: Set<String> get() = FUNCTIONS.keys

fun evaluate(node: Node, env: ExprEnv): Value {
    val budget = Budget()
    fun ev(n: Node): Value {
        budget.spend()
        return when (n) {
            is Node.Lit -> n.v
            is Node.Var -> env.vars[n.name] ?: if (env.vars.containsKey(n.name)) Value.Null else throw ExprError("unknown variable \"${n.name}\"")
            is Node.ListLit -> guard(Value.VList(n.items.map { ev(it) }))
            is Node.Un -> {
                val v = ev(n.a)
                if (n.op == "!") Value.of(!truthy(v)) else Value.Num(-toNum(v))
            }
            is Node.Cond -> if (truthy(ev(n.c))) ev(n.a) else ev(n.b)
            is Node.Idx -> {
                val a = ev(n.a)
                val iD = toNum(ev(n.i))
                // JavaScript `a[Math.trunc(NaN)]` is `a[NaN]` → undefined → null, not element 0.
                if (iD.isNaN()) return Value.Null
                val i = iD.toLong() // Math.trunc (±Infinity saturate and fall out of range below)
                if (a is Value.VList) {
                    val k = if (i < 0) a.items.size + i else i
                    if (k in 0 until a.items.size) a.items[k.toInt()] else Value.Null
                } else {
                    val s = toStr(a)
                    val k = if (i < 0) s.length + i else i
                    if (k in 0 until s.length) Value.Str(s[k.toInt()].toString()) else Value.Null
                }
            }
            is Node.Call -> guard(FUNCTIONS.getValue(n.fn)(n.args.map { ev(it) }, env, budget))
            is Node.Bin -> binary(n, ::ev, budget)
        }
    }
    return ev(node)
}

private fun binary(n: Node.Bin, ev: (Node) -> Value, budget: Budget): Value {
    if (n.op == "&&") {
        val a = ev(n.a)
        return if (truthy(a)) ev(n.b) else a
    }
    if (n.op == "||") {
        val a = ev(n.a)
        return if (truthy(a)) a else ev(n.b)
    }
    val a = ev(n.a)
    val b = ev(n.b)
    return when (n.op) {
        "+" -> when {
            a is Value.Str || b is Value.Str -> guard(Value.Str(toStr(a) + toStr(b)))
            a is Value.VList && b is Value.VList -> guard(Value.VList(a.items + b.items))
            else -> guard(Value.Num(toNum(a) + toNum(b)))
        }
        "-" -> guard(Value.Num(toNum(a) - toNum(b)))
        "*" -> guard(Value.Num(toNum(a) * toNum(b)))
        "/" -> {
            val d = toNum(b)
            if (d == 0.0) throw ExprError("division by zero")
            // Guarded like + - *: 1e308 / 0.1 or 1e400 / 1e400 must not leak Infinity / NaN into variables.
            guard(Value.Num(toNum(a) / d))
        }
        "%" -> {
            val d = toNum(b)
            if (d == 0.0) throw ExprError("division by zero")
            guard(Value.Num(toNum(a) % d)) // Kotlin % on doubles has JS semantics (sign of the dividend)
        }
        "==" -> Value.of(looseEq(a, b, budget))
        "!=" -> Value.of(!looseEq(a, b, budget))
        "<", "<=", ">", ">=" -> {
            val cmp: Int? = if (a is Value.Str && b is Value.Str) {
                a.v.compareTo(b.v) // UTF-16 code unit order, like JS
            } else {
                val x = toNum(a)
                val y = toNum(b)
                if (x.isNaN() || y.isNaN()) null else x.compareTo(y).let { if (x == y) 0 else it }
            }
            Value.of(
                cmp != null && when (n.op) {
                    "<" -> cmp < 0
                    "<=" -> cmp <= 0
                    ">" -> cmp > 0
                    else -> cmp >= 0
                },
            )
        }
        else -> throw ExprError("unknown operator ${n.op}")
    }
}

private val CACHE = ConcurrentHashMap<String, Node>()

fun evalExpr(src: String, env: ExprEnv): Value {
    val n = CACHE[src] ?: parseExpr(src).also {
        if (CACHE.size > 500) CACHE.clear()
        CACHE[src] = it
    }
    return evaluate(n, env)
}

/** Returns null when valid, or a human-readable error. */
fun checkExpr(src: String): String? = try {
    parseExpr(src)
    null
} catch (e: ExprError) {
    e.message
}


/** Replaces {{ expr }} in text. {{secret:name}} is resolved through [secret] and never logged. */
/** Shown instead of a secret's value in logged text (`SECRET_MASK` in expr.ts). */
const val SECRET_MASK = "\u2022\u2022\u2022\u2022"

data class Placeholder(val start: Int, val end: Int, val inner: String)

/**
 * Finds `{{ … }}` placeholders in one linear pass (`scanPlaceholders` in expr.ts): same matches as the old regular
 * expression, which backtracked quadratically on long runs of "{" or spaces.
 */
fun scanPlaceholders(text: String): List<Placeholder> {
    val out = ArrayList<Placeholder>()
    var nextClose = -1
    var i = text.indexOf("{{")
    while (i != -1) {
        if (nextClose < i + 2) nextClose = text.indexOf('}', i + 2)
        if (nextClose == -1) break
        if (nextClose + 1 < text.length && text[nextClose + 1] == '}' && nextClose > i + 2) {
            val raw = text.substring(i + 2, nextClose)
            val inner = jsTrim(raw)
            out.add(Placeholder(i, nextClose + 2, inner.ifEmpty { raw.takeLast(1) }))
            i = text.indexOf("{{", nextClose + 2)
        } else {
            i = text.indexOf("{{", i + 1)
        }
    }
    return out
}

fun interpolate(text: String, env: ExprEnv, maskSecrets: Boolean = false, secret: ((String) -> String?)? = null): String {
    val found = scanPlaceholders(text)
    if (found.isEmpty()) return text
    val out = StringBuilder()
    var last = 0
    for (p in found) {
        out.append(text, last, p.start)
        if (p.inner.startsWith("secret:")) {
            val name = jsTrim(p.inner.substring(7))
            val v = secret?.invoke(name) ?: throw ExprError("secret \"$name\" is not available on this device")
            out.append(if (maskSecrets) SECRET_MASK else v)
        } else {
            out.append(toStr(evalExpr(p.inner, env)))
        }
        if (out.length > MAX_STRING) throw ExprError("string too large")
        last = p.end
    }
    out.append(text, last, text.length)
    return out.toString()
}
