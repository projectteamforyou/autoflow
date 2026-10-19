package com.projectteamforyou.autoflow.engine

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.concurrent.ConcurrentHashMap
import java.util.regex.Pattern
import java.util.regex.PatternSyntaxException

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
const val MAX_LIST = 100_000

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

private fun guard(v: Value): Value {
    if (v is Value.Str && v.v.length > MAX_STRING) throw ExprError("string too large")
    if (v is Value.VList && v.items.size > MAX_LIST) throw ExprError("list too large")
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

/** JavaScript `Math.round`: halves round toward +∞. */
private fun jsRound(x: Double): Double = if (x.isNaN() || x.isInfinite()) x else Math.floor(x + 0.5)

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

private fun localTime(env: ExprEnv, args: List<Value>): ZonedDateTime {
    val ms = if (args.isNotEmpty()) toNum(args[0]).toLong() else env.now()
    return Instant.ofEpochMilli(ms).atZone(env.zone)
}

private fun pad2(n: Int) = n.toString().padStart(2, '0')

/** Wraps regex input so catastrophic backtracking is cut off instead of hanging the run. */
private class BudgetedChars(private val s: CharSequence, private val budget: IntArray) : CharSequence {
    override val length: Int get() = s.length
    override fun get(index: Int): Char {
        if (--budget[0] < 0) throw ExprError("pattern too expensive")
        return s[index]
    }
    override fun subSequence(startIndex: Int, endIndex: Int): CharSequence = BudgetedChars(s.subSequence(startIndex, endIndex), budget)
    override fun toString(): String = s.toString()
}

private val NESTED_QUANTIFIER = Regex("\\([^)]*[+*][^)]*\\)[+*{]")

typealias ExprFn = (List<Value>, ExprEnv) -> Value

val FUNCTIONS: Map<String, ExprFn> = mapOf(
    "len" to { a, _ -> arity("len", a, 1); val x = a[0]; Value.Num(if (x is Value.VList) x.items.size.toDouble() else toStr(x).length.toDouble()) },
    "upper" to { a, _ -> arity("upper", a, 1); Value.Str(toStr(a[0]).uppercase()) },
    "lower" to { a, _ -> arity("lower", a, 1); Value.Str(toStr(a[0]).lowercase()) },
    "trim" to { a, _ -> arity("trim", a, 1); Value.Str(jsTrim(toStr(a[0]))) },
    "contains" to { a, _ ->
        arity("contains", a, 2)
        val x = a[0]
        Value.of(if (x is Value.VList) x.items.any { looseEq(it, a[1]) } else toStr(x).contains(toStr(a[1])))
    },
    "startsWith" to { a, _ -> arity("startsWith", a, 2); Value.of(toStr(a[0]).startsWith(toStr(a[1]))) },
    "endsWith" to { a, _ -> arity("endsWith", a, 2); Value.of(toStr(a[0]).endsWith(toStr(a[1]))) },
    "replace" to { a, _ -> arity("replace", a, 3); Value.Str(jsSplit(toStr(a[0]), toStr(a[1])).joinToString(toStr(a[2]))) },
    "substr" to { a, _ ->
        arity("substr", a, 2, 3)
        Value.Str(jsSubstr(toStr(a[0]), toNum(a[1]), if (a.size == 3) toNum(a[2]) else null))
    },
    "split" to { a, _ -> arity("split", a, 2); Value.VList(jsSplit(toStr(a[0]), toStr(a[1])).take(MAX_LIST).map { Value.Str(it) }) },
    "join" to { a, _ ->
        arity("join", a, 2)
        val x = a[0]
        Value.Str((if (x is Value.VList) x.items else listOf(x)).joinToString(toStr(a[1])) { toStr(it) })
    },
    "num" to { a, _ -> arity("num", a, 1); Value.Num(toNum(a[0])) },
    "str" to { a, _ -> arity("str", a, 1); Value.Str(toStr(a[0])) },
    "round" to { a, _ ->
        arity("round", a, 1, 2)
        val d = if (a.size == 2) maxOf(0.0, minOf(10.0, toNum(a[1]))) else 0.0
        val f = Math.pow(10.0, d)
        Value.Num(jsRound(toNum(a[0]) * f) / f)
    },
    "floor" to { a, _ -> arity("floor", a, 1); Value.Num(Math.floor(toNum(a[0]))) },
    "ceil" to { a, _ -> arity("ceil", a, 1); Value.Num(Math.ceil(toNum(a[0]))) },
    "abs" to { a, _ -> arity("abs", a, 1); Value.Num(Math.abs(toNum(a[0]))) },
    "min" to { a, _ -> if (a.isEmpty()) throw ExprError("min() needs arguments"); Value.Num(a.minOf { toNum(it) }) },
    "max" to { a, _ -> if (a.isEmpty()) throw ExprError("max() needs arguments"); Value.Num(a.maxOf { toNum(it) }) },
    "random" to { a, env ->
        arity("random", a, 2)
        val lo = Math.ceil(toNum(a[0]))
        val hi = Math.floor(toNum(a[1]))
        Value.Num(lo + Math.floor((env.random ?: Math::random)() * (hi - lo + 1)))
    },
    "now" to { a, env -> arity("now", a, 0); Value.Num(env.now().toDouble()) },
    "hour" to { a, env -> arity("hour", a, 0); Value.Num(localTime(env, a).hour.toDouble()) },
    "minute" to { a, env -> arity("minute", a, 0); Value.Num(localTime(env, a).minute.toDouble()) },
    "weekday" to { a, env -> arity("weekday", a, 0); Value.Num((localTime(env, a).dayOfWeek.value % 7).toDouble()) },
    "date" to { a, env ->
        arity("date", a, 0, 1)
        val d = localTime(env, a)
        Value.Str("${d.year}-${pad2(d.monthValue)}-${pad2(d.dayOfMonth)}")
    },
    "time" to { a, env ->
        arity("time", a, 0, 1)
        val d = localTime(env, a)
        Value.Str("${pad2(d.hour)}:${pad2(d.minute)}:${pad2(d.second)}")
    },
    "defined" to { a, env -> arity("defined", a, 1); Value.of(env.vars.containsKey(toStr(a[0]))) },
    "push" to { a, _ ->
        arity("push", a, 2)
        val l = (a[0] as? Value.VList)?.items ?: emptyList()
        Value.VList(l + a[1])
    },
    "range" to { a, _ ->
        arity("range", a, 1, 2)
        val lo = if (a.size == 1) 0.0 else toNum(a[0])
        val hi = if (a.size == 1) toNum(a[0]) else toNum(a[1])
        if (hi - lo > MAX_LIST) throw ExprError("range too large")
        val out = ArrayList<Value>()
        var i = lo
        while (i < hi) {
            out.add(Value.Num(i))
            i += 1.0
        }
        Value.VList(out)
    },
    "matches" to { a, _ ->
        arity("matches", a, 2)
        val pattern = toStr(a[1])
        if (pattern.length > 200) throw ExprError("pattern too long")
        // Reject nested quantifiers that commonly cause catastrophic backtracking.
        if (NESTED_QUANTIFIER.containsMatchIn(pattern)) throw ExprError("pattern too complex")
        val compiled = try {
            Pattern.compile(pattern)
        } catch (e: PatternSyntaxException) {
            throw ExprError("invalid pattern: ${e.description}")
        }
        val input = toStr(a[0]).take(10_000)
        Value.of(compiled.matcher(BudgetedChars(input, intArrayOf(2_000_000))).find())
    },
)

val FUNCTION_NAMES: Set<String> get() = FUNCTIONS.keys

fun evaluate(node: Node, env: ExprEnv): Value {
    var steps = 0
    fun ev(n: Node): Value {
        if (++steps > MAX_STEPS) throw ExprError("expression too expensive")
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
                val i = if (iD.isNaN()) 0L else iD.toLong() // Math.trunc
                if (a is Value.VList) {
                    val k = if (i < 0) a.items.size + i else i
                    if (k in 0 until a.items.size) a.items[k.toInt()] else Value.Null
                } else {
                    val s = toStr(a)
                    val k = if (i < 0) s.length + i else i
                    if (k in 0 until s.length) Value.Str(s[k.toInt()].toString()) else Value.Null
                }
            }
            is Node.Call -> guard(FUNCTIONS.getValue(n.fn)(n.args.map { ev(it) }, env))
            is Node.Bin -> binary(n, ::ev)
        }
    }
    return ev(node)
}

private fun binary(n: Node.Bin, ev: (Node) -> Value): Value {
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
            Value.Num(toNum(a) / d)
        }
        "%" -> {
            val d = toNum(b)
            if (d == 0.0) throw ExprError("division by zero")
            Value.Num(toNum(a) % d) // Kotlin % on doubles has JS semantics (sign of the dividend)
        }
        "==" -> Value.of(looseEq(a, b))
        "!=" -> Value.of(!looseEq(a, b))
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

private val INTERPOLATION = Regex("\\{\\{\\s*([^}]+?)\\s*\\}\\}")

/** Replaces {{ expr }} in text. {{secret:name}} is resolved through [secret] and never logged. */
fun interpolate(text: String, env: ExprEnv, secret: ((String) -> String?)? = null): String =
    INTERPOLATION.replace(text) { m ->
        val inner = m.groupValues[1]
        if (inner.startsWith("secret:")) {
            val name = jsTrim(inner.substring(7))
            secret?.invoke(name) ?: throw ExprError("secret \"$name\" is not available on this device")
        } else {
            toStr(evalExpr(inner, env))
        }
    }
