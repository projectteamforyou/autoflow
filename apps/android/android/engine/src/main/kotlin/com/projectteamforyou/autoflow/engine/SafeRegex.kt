package com.projectteamforyou.autoflow.engine

/**
 * Linear-time regular expressions for the `matches()` expression function — a port of packages/core/src/safe-regex.ts.
 *
 * Patterns come from shared flows, so they are untrusted input. java.util.regex backtracks: `^(a|a)*$` against
 * "aaaa…b" takes exponential time and would freeze the UI thread. This compiles a pattern into a Thompson NFA and
 * simulates it with a Pike VM, so matching costs O(pattern × subject) in the worst case — like the Rust engine's
 * `regex` crate and the TypeScript engine.
 *
 * The dialect is the ECMAScript one the TypeScript engine implements, so the three engines agree on every pattern:
 *   literals and escapes (\. \\ \n \t \r \f \v \0, \xHH, \uHHHH), classes \d \D \w \W \s \S (ASCII \d \w, ECMAScript
 *   WhiteSpace + LineTerminator for \s), `.` (anything but \n \r U+2028 U+2029), [sets] with ranges / negation /
 *   class escapes, groups ( ) and (?: ), alternation |, quantifiers * + ? {n} {n,} {n,m} (lazy suffix `?` accepted),
 *   anchors ^ $ and \b \B. Annex B quirks: `[\w-.]` and `[a-\d]` treat `-` as a literal, a `{` that is not a
 *   `{n}`/`{n,}`/`{n,m}` quantifier is a literal, `[]` matches nothing, `[^]` matches anything, `\0` is NUL and
 *   identity escapes such as `\A` are the letter itself.
 * Rejected with an error (instead of silently changing meaning): back-references, lookaround, named groups, inline
 * flags and \p{…} properties.
 *
 * Matching works on UTF-16 code units, exactly like JavaScript strings, and is a search (unanchored unless the
 * pattern uses ^ / $), the same as `RegExp.prototype.test`.
 */
class RegexError(message: String) : Exception(message)

/** Pattern source limit (also enforced by the expression function). */
const val MAX_PATTERN = 200
/** Upper bound for {n,m} counts. */
private const val MAX_REPEAT = 100
/** Upper bound on compiled program size (after expanding counted repetitions). */
private const val MAX_PROGRAM = 5000

private typealias CharPred = (Int) -> Boolean

private sealed class RAst {
    object Empty : RAst()
    class Ch(val pred: CharPred) : RAst()
    class Cat(val items: List<RAst>) : RAst()
    class Alt(val items: List<RAst>) : RAst()
    class Rep(val a: RAst, val min: Int, val max: Int /* -1 = unbounded */) : RAst()
    object Bol : RAst()
    object Eol : RAst()
    class WordB(val negate: Boolean) : RAst()
}

private val isDigit: CharPred = { c -> c in 48..57 }
private val isWord: CharPred = { c -> c in 48..57 || c in 65..90 || c in 97..122 || c == 95 }
/** ECMAScript WhiteSpace + LineTerminator. */
private val isSpace: CharPred = { c ->
    c == 9 || c == 10 || c == 11 || c == 12 || c == 13 || c == 32 || c == 0xa0 || c == 0x1680 || c in 0x2000..0x200a ||
        c == 0x2028 || c == 0x2029 || c == 0x202f || c == 0x205f || c == 0x3000 || c == 0xfeff
}
private val isLineTerminator: CharPred = { c -> c == 10 || c == 13 || c == 0x2028 || c == 0x2029 }

private val COUNTED_REPEAT = Regex("^\\{(\\d{1,4})(?:(,)(\\d{0,4}))?\\}")
private val HEX2 = Regex("^[0-9A-Fa-f]{2}")
private val HEX4 = Regex("^[0-9A-Fa-f]{4}")

/** Either a code unit (literal) or a predicate (class escape) — what `escape(inClass = true)` yields. */
private sealed class ClassAtom {
    class Code(val c: Int) : ClassAtom()
    class Pred(val p: CharPred) : ClassAtom()
}

private class RegexParser(private val src: String) {
    private var i = 0

    fun parse(): RAst {
        val ast = alternation()
        if (i < src.length) throw RegexError(if (src[i] == ')') "unmatched ')'" else "unexpected \"${src[i]}\"")
        return ast
    }

    private fun peek(): Char? = src.getOrNull(i)

    private fun alternation(): RAst {
        val items = arrayListOf(concatenation())
        while (peek() == '|') {
            i++
            items.add(concatenation())
        }
        return if (items.size == 1) items[0] else RAst.Alt(items)
    }

    private fun concatenation(): RAst {
        val items = ArrayList<RAst>()
        while (true) {
            val c = peek()
            if (c == null || c == '|' || c == ')') break
            items.add(quantified())
        }
        if (items.isEmpty()) return RAst.Empty
        return if (items.size == 1) items[0] else RAst.Cat(items)
    }

    private fun quantified(): RAst {
        val atom = atom()
        val c = peek()
        val min: Int
        val max: Int
        when (c) {
            '*' -> { min = 0; max = -1 }
            '+' -> { min = 1; max = -1 }
            '?' -> { min = 0; max = 1 }
            '{' -> {
                val m = COUNTED_REPEAT.find(src.substring(i)) ?: return atom // a literal "{" like JavaScript's Annex B
                min = m.groupValues[1].toInt()
                max = if (m.groups[2] != null) (if (m.groupValues[3].isNotEmpty()) m.groupValues[3].toInt() else -1) else min
                if (min > MAX_REPEAT || max > MAX_REPEAT) throw RegexError("repetition count too large")
                if (max != -1 && max < min) throw RegexError("numbers out of order in {} quantifier")
                i += m.value.length - 1
            }
            else -> return atom
        }
        i++
        if (peek() == '?') i++ // lazy: same result for a yes/no test
        val next = peek()
        if (next == '*' || next == '+' || next == '?') throw RegexError("nothing to repeat")
        if (atom is RAst.Bol || atom is RAst.Eol || atom is RAst.WordB) throw RegexError("nothing to repeat")
        return RAst.Rep(atom, min, max)
    }

    private fun atom(): RAst {
        val c = src[i++]
        return when (c) {
            '(' -> {
                if (peek() == '?') {
                    if (src.getOrNull(i + 1) != ':') throw RegexError("lookaround and named groups are not supported")
                    i += 2
                }
                val inner = alternation()
                if (peek() != ')') throw RegexError("unterminated group")
                i++
                inner
            }
            '.' -> RAst.Ch { x -> !isLineTerminator(x) }
            '^' -> RAst.Bol
            '$' -> RAst.Eol
            '[' -> RAst.Ch(charClass())
            '\\' -> escapeAtom()
            '*', '+', '?' -> throw RegexError("nothing to repeat")
            else -> {
                val code = c.code
                RAst.Ch { x -> x == code }
            }
        }
    }

    /** `escape(false)` in safe-regex.ts: the escape after a backslash, outside a class. */
    private fun escapeAtom(): RAst {
        val c = src.getOrNull(i++) ?: throw RegexError("\\ at end of pattern")
        return when (c) {
            'b' -> RAst.WordB(false)
            'B' -> RAst.WordB(true)
            else -> when (val a = escapeCommon(c, inClass = false)) {
                is ClassAtom.Code -> { val code = a.c; RAst.Ch { x -> x == code } }
                is ClassAtom.Pred -> RAst.Ch(a.p)
            }
        }
    }

    /** `escape(true)` in safe-regex.ts: the escape after a backslash, inside a class. */
    private fun escapeInClass(): ClassAtom {
        val c = src.getOrNull(i++) ?: throw RegexError("\\ at end of pattern")
        return when (c) {
            'b' -> ClassAtom.Code(8)
            'B' -> throw RegexError("\\B is not allowed in a class")
            else -> escapeCommon(c, inClass = true)
        }
    }

    /** The part of `escape` shared by both contexts (everything except \b / \B). */
    private fun escapeCommon(c: Char, @Suppress("UNUSED_PARAMETER") inClass: Boolean): ClassAtom = when (c) {
        'd' -> ClassAtom.Pred(isDigit)
        'D' -> ClassAtom.Pred { x -> !isDigit(x) }
        'w' -> ClassAtom.Pred(isWord)
        'W' -> ClassAtom.Pred { x -> !isWord(x) }
        's' -> ClassAtom.Pred(isSpace)
        'S' -> ClassAtom.Pred { x -> !isSpace(x) }
        'n' -> ClassAtom.Code(10)
        't' -> ClassAtom.Code(9)
        'r' -> ClassAtom.Code(13)
        'f' -> ClassAtom.Code(12)
        'v' -> ClassAtom.Code(11)
        '0' -> {
            if (src.getOrNull(i)?.let { isDigit(it.code) } == true) throw RegexError("back-references are not supported")
            ClassAtom.Code(0)
        }
        'x' -> {
            val m = HEX2.find(src.substring(i))
            if (m == null) ClassAtom.Code(120) else { i += 2; ClassAtom.Code(m.value.toInt(16)) }
        }
        'u' -> {
            val m = HEX4.find(src.substring(i))
            if (m == null) ClassAtom.Code(117) else { i += 4; ClassAtom.Code(m.value.toInt(16)) }
        }
        'p', 'P', 'k' -> throw RegexError("\\$c is not supported")
        else -> {
            if (c in '1'..'9') throw RegexError("back-references are not supported")
            ClassAtom.Code(c.code)
        }
    }

    private fun charClass(): CharPred {
        var negate = false
        if (peek() == '^') {
            negate = true
            i++
        }
        val preds = ArrayList<CharPred>()
        val ranges = ArrayList<IntArray>()
        var first = true
        while (true) {
            val c = peek() ?: throw RegexError("unterminated character class")
            if (c == ']' && !first) {
                i++
                break
            }
            if (c == ']' && first) {
                // JavaScript: "[]" matches nothing, "[^]" matches anything.
                i++
                return if (negate) { _ -> true } else { _ -> false }
            }
            first = false
            val lo = classAtom()
            if (lo is ClassAtom.Pred) {
                preds.add(lo.p)
                continue
            }
            val loCode = (lo as ClassAtom.Code).c
            if (peek() == '-' && src.getOrNull(i + 1) != null && src.getOrNull(i + 1) != ']') {
                i++
                val hi = classAtom()
                if (hi is ClassAtom.Pred) {
                    // [a-\d] is literal a, -, digits in JavaScript (Annex B).
                    ranges.add(intArrayOf(loCode, loCode))
                    ranges.add(intArrayOf(45, 45))
                    preds.add(hi.p)
                    continue
                }
                val hiCode = (hi as ClassAtom.Code).c
                if (hiCode < loCode) throw RegexError("range out of order in character class")
                ranges.add(intArrayOf(loCode, hiCode))
            } else {
                ranges.add(intArrayOf(loCode, loCode))
            }
        }
        val test: CharPred = { x -> ranges.any { x >= it[0] && x <= it[1] } || preds.any { it(x) } }
        return if (negate) { x -> !test(x) } else test
    }

    private fun classAtom(): ClassAtom {
        val c = src[i++]
        if (c != '\\') return ClassAtom.Code(c.code)
        return escapeInClass()
    }
}

/* --------------------------------------------------------------- compiler */

private sealed class Inst {
    class Ch(val pred: CharPred) : Inst()
    class Split(var x: Int, var y: Int) : Inst()
    class Jmp(var x: Int) : Inst()
    class Assert(val kind: Int) : Inst() // BOL / EOL / WORDB / NWORDB
    object Match : Inst()
}

private const val BOL = 0
private const val EOL = 1
private const val WORDB = 2
private const val NWORDB = 3

private class RegexCompiler {
    val prog = ArrayList<Inst>()

    private fun push(i: Inst): Int {
        if (prog.size >= MAX_PROGRAM) throw RegexError("pattern too complex")
        prog.add(i)
        return prog.size - 1
    }

    fun emit(a: RAst) {
        when (a) {
            RAst.Empty -> return
            is RAst.Ch -> push(Inst.Ch(a.pred))
            RAst.Bol -> push(Inst.Assert(BOL))
            RAst.Eol -> push(Inst.Assert(EOL))
            is RAst.WordB -> push(Inst.Assert(if (a.negate) NWORDB else WORDB))
            is RAst.Cat -> for (it in a.items) emit(it)
            is RAst.Alt -> {
                // split L1, next ; L1: a ; jmp end ; next: split L2, … ; last
                val jumps = ArrayList<Int>()
                for (n in 0 until a.items.size - 1) {
                    val split = push(Inst.Split(0, 0))
                    (prog[split] as Inst.Split).x = prog.size
                    emit(a.items[n])
                    jumps.add(push(Inst.Jmp(0)))
                    (prog[split] as Inst.Split).y = prog.size
                }
                emit(a.items[a.items.size - 1])
                for (j in jumps) (prog[j] as Inst.Jmp).x = prog.size
            }
            is RAst.Rep -> {
                for (n in 0 until a.min) emit(a.a)
                if (a.max == -1) {
                    // L: split body, end ; body ; jmp L
                    val split = push(Inst.Split(0, 0))
                    (prog[split] as Inst.Split).x = prog.size
                    emit(a.a)
                    push(Inst.Jmp(split))
                    (prog[split] as Inst.Split).y = prog.size
                    return
                }
                val splits = ArrayList<Int>()
                for (n in a.min until a.max) {
                    val split = push(Inst.Split(0, 0))
                    (prog[split] as Inst.Split).x = prog.size
                    splits.add(split)
                    emit(a.a)
                }
                for (s in splits) (prog[s] as Inst.Split).y = prog.size
            }
        }
    }
}

/** A compiled pattern; [test] is an unanchored search like `RegExp.prototype.test`. */
class SafeRegex private constructor(private val prog: Array<Inst>) {
    fun test(subject: String): Boolean = run(prog, subject)

    companion object {
        /** Compiles a pattern; throws [RegexError] for invalid or unsupported syntax or excessive size. */
        fun compile(pattern: String): SafeRegex {
            if (pattern.length > MAX_PATTERN) throw RegexError("pattern too long")
            val ast = RegexParser(pattern).parse()
            val c = RegexCompiler()
            c.emit(ast)
            c.prog.add(Inst.Match)
            return SafeRegex(c.prog.toTypedArray())
        }
    }
}

/** Pike VM: every thread advances in lock step, so each (instruction, position) is visited once. */
private fun run(prog: Array<Inst>, s: String): Boolean {
    val n = prog.size
    var clist = IntArray(n)
    var nlist = IntArray(n)
    var ccount: Int
    var ncount: Int
    val mark = IntArray(n) { -1 }
    val stack = IntArray(n * 2 + 2)
    var gen = 0
    var matched = false

    fun wordAt(i: Int) = i >= 0 && i < s.length && isWord(s[i].code)

    /** Adds pc0 and its epsilon closure at position `pos` to `list`; sets [matched] when Match is reachable. */
    fun add(list: IntArray, count0: Int, pc0: Int, pos: Int): Int {
        var count = count0
        var sp = 0
        stack[sp++] = pc0
        matched = false
        while (sp > 0) {
            val pc = stack[--sp]
            if (mark[pc] == gen) continue
            mark[pc] = gen
            when (val inst = prog[pc]) {
                is Inst.Jmp -> stack[sp++] = inst.x
                is Inst.Split -> {
                    stack[sp++] = inst.y
                    stack[sp++] = inst.x
                }
                is Inst.Assert -> {
                    val ok = when (inst.kind) {
                        BOL -> pos == 0
                        EOL -> pos == s.length
                        else -> {
                            val b = wordAt(pos - 1) != wordAt(pos)
                            if (inst.kind == WORDB) b else !b
                        }
                    }
                    if (ok) stack[sp++] = pc + 1
                }
                Inst.Match -> matched = true
                is Inst.Ch -> list[count++] = pc
            }
        }
        return count
    }

    gen = 1
    ccount = add(clist, 0, 0, 0)
    if (matched) return true
    for (pos in 0 until s.length) {
        gen++
        ncount = 0
        val ch = s[pos].code
        for (t in 0 until ccount) {
            val pc = clist[t]
            if ((prog[pc] as Inst.Ch).pred(ch)) {
                ncount = add(nlist, ncount, pc + 1, pos + 1)
                if (matched) return true
            }
        }
        // Unanchored search: a new thread also starts at every position.
        ncount = add(nlist, ncount, 0, pos + 1)
        if (matched) return true
        val tmp = clist
        clist = nlist
        nlist = tmp
        ccount = ncount
    }
    return false
}
