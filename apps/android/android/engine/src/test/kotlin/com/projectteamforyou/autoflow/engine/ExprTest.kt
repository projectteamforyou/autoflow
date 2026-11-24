package com.projectteamforyou.autoflow.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.time.ZoneOffset

/** Mirrors the "expressions" suite of packages/core/test/core.test.ts, plus JS-compatibility edge cases. */
class ExprTest {
    private fun env() = ExprEnv(
        vars = mutableMapOf("a" to Value.Num(2.0), "s" to Value.Str("Hello"), "l" to Value.list(Value.Num(1.0), Value.Num(2.0), Value.Num(3.0))),
        now = { 0L },
        zone = ZoneOffset.UTC,
    )

    private fun ev(src: String) = evalExpr(src, env())
    private fun num(d: Double) = Value.Num(d)

    private fun assertThrows(src: String, pattern: String) {
        try {
            ev(src)
            fail("expected \"$src\" to throw /$pattern/")
        } catch (e: ExprError) {
            assertTrue("\"${e.message}\" !~ /$pattern/", Regex(pattern).containsMatchIn(e.message ?: ""))
        }
    }

    @Test fun arithmeticPrecedenceAndLogic() {
        assertEquals(num(7.0), ev("1 + 2 * 3"))
        assertEquals(num(9.0), ev("(1 + 2) * 3"))
        assertEquals(Value.TRUE, ev("a > 1 && !false"))
        assertEquals(Value.TRUE, ev("a == '2'"))
        assertEquals(Value.Str("small"), ev("a > 5 ? 'big' : 'small'"))
        assertEquals(num(0.0), ev("-a + 10 % 4"))
    }

    @Test fun stringsListsAndFunctions() {
        assertEquals(Value.Str("HELLO!"), ev("upper(s) + '!'"))
        assertEquals(num(3.0), ev("len(l)"))
        assertEquals(num(5.0), ev("l[1] + l[-1]"))
        assertEquals(Value.Str("c"), ev("split('a,b,c', ',')[2]"))
        assertEquals(Value.TRUE, ev("contains(l, 2)"))
        assertEquals(Value.Str("0-1-2"), ev("join(range(3), '-')"))
        assertEquals(num(3.14), ev("round(3.14159, 2)"))
        assertEquals(Value.Str("x"), ev("[1, 'x'][1]"))
    }

    @Test fun sandboxed() {
        assertThrows("constructor", "unknown variable")
        assertThrows("eval('1')", "unknown function")
        assertThrows("toString()", "unknown function")
        assertThrows("1 / 0", "division by zero")
        assertThrows("range(0, 1e9)", "too large")
        assertThrows("matches('aaaa', '(a+)+$')", "too complex")
        assertNotNull(checkExpr("1 +"))
        assertNull(checkExpr("a && (b || c)"))
    }

    @Test fun interpolationAndSecrets() {
        assertEquals("Hi Hello x4", interpolate("Hi {{ s }} x{{a*2}}", env()))
        assertEquals("pw=s3cret", interpolate("pw={{secret:main}}", env()) { if (it == "main") "s3cret" else null })
        try {
            interpolate("{{secret:none}}", env()) { null }
            fail("expected missing secret to throw")
        } catch (e: ExprError) {
            assertTrue(e.message!!.contains("not available"))
        }
    }

    @Test fun javascriptCompatibility() {
        assertEquals(Value.Str("0.1"), ev("str(0.1)"))
        assertEquals(Value.Str("0.30000000000000004"), ev("str(0.1 + 0.2)"))
        assertEquals(Value.Str("1e-7"), ev("str(0.0000001)"))
        assertEquals(Value.Str("0.000001"), ev("str(0.000001)"))
        assertEquals(Value.Str("1e+21"), ev("str(1e21)"))
        assertEquals(Value.Str("123456789012"), ev("str(123456789012)"))
        assertEquals(Value.Str("2.5"), ev("'' + 2.5"))
        assertEquals(Value.Str("a,b"), ev("str(['a', 'b'])"))
        assertEquals(Value.Str("a-b-c"), ev("replace('abc', '', '-')"))
        assertEquals(Value.Str("hello"), ev("substr('xhello', 1)"))
        assertEquals(Value.Str("he"), ev("substr('hello', 0, 2)"))
        assertEquals(Value.Str("lo"), ev("substr('hello', -2)"))
        assertEquals(num(3.0), ev("round(2.5)"))
        assertEquals(num(-2.0), ev("round(-2.5)"))
        assertEquals(num(-1.0), ev("-7 % 3"))
        assertEquals(Value.TRUE, ev("'10' == 10"))
        assertEquals(Value.FALSE, ev("null == 0"))
        assertEquals(Value.TRUE, ev("true == 1"))
        assertEquals(Value.TRUE, ev("'b' > 'a'"))
        assertEquals(Value.TRUE, ev("'10' < 9 == false"))
        assertEquals(num(16.0), ev("num('0x10')"))
        assertEquals(num(0.0), ev("num('')"))
        assertThrows("num('abc')", "is not a number")
        assertEquals(Value.Null, ev("l[10]"))
        assertEquals(Value.Str("o"), ev("s[-1]"))
        assertEquals(Value.Str("x"), ev("0 || 'x'"))
        assertEquals(num(0.0), ev("0 && 'x'"))
        assertEquals(Value.TRUE, ev("defined('a')"))
        assertEquals(Value.FALSE, ev("defined('zzz')"))
        assertEquals(Value.list(num(1.0), num(2.0)), ev("push([1], 2)"))
        assertEquals(Value.TRUE, ev("matches('abc123', '[0-9]+$')"))
        assertEquals(Value.TRUE, ev("startsWith(s, 'He') && endsWith(s, 'lo')"))
        assertEquals(Value.Str("trim"), ev("trim('  trim \\n')"))
        assertEquals(num(4.0), ev("max(1, 4, 2)"))
        assertEquals(num(1.0), ev("min(3, 1, 2)"))
        assertEquals(num(1.0), ev("ceil(0.2)"))
        assertEquals(num(0.0), ev("floor(0.9)"))
        assertEquals(num(5.0), ev("abs(-5)"))
        assertEquals(Value.Str("a"), ev("lower('A')"))
    }

    @Test fun numericEdgeCasesFollowJavaScript() {
        // Math.round is not floor(x + 0.5): that adds its own rounding error.
        assertEquals(num(0.0), ev("round(0.49999999999999994)"))
        assertEquals(num(4503599627370497.0), ev("round(4503599627370497)"))
        // No sign after a radix prefix.
        assertThrows("num('0x-1')", "is not a number")
        assertThrows("num('0x+1')", "is not a number")
        assertEquals(num(255.0), ev("num('0xff')"))
        // / and % are guarded like + - *.
        assertThrows("1e308 / 0.1", "number out of range")
        assertThrows("1e400 / 1e400", "number out of range")
        assertEquals(num(1.0), ev("7 % -3"))
        // A NaN index is `a[NaN]` → null, not element 0 (NaN can only arrive through a variable: arithmetic is guarded).
        val nan = ExprEnv(mutableMapOf("l" to Value.list(num(1.0), num(2.0)), "nan" to num(Double.NaN), "s" to Value.Str("ab")))
        assertEquals(Value.Null, evalExpr("l[nan]", nan))
        assertEquals(Value.Null, evalExpr("s[nan]", nan))
        assertEquals(num(1.0), ev("l[0.9]"))
        // Invalid dates render like `new Date(x)` in JavaScript.
        assertEquals(Value.Str("NaN-NaN-NaN"), ev("date(1e300)"))
        assertEquals(Value.Str("NaN:NaN:NaN"), ev("time(8.65e15)"))
        assertEquals(Value.Str("1970-01-01"), ev("date(8.64e15 - 8.64e15)"))
    }

    @Test fun deepComparisonsAreChargedToTheStepBudget() {
        // packages/core/test/regressions.test.ts "charges deep equality on shared nested lists to the step budget".
        var v: Value = Value.list(num(1.0))
        repeat(40) { v = Value.list(v, v) }
        val e = ExprEnv(mutableMapOf("v" to v, "w" to Value.list(v)))
        val t0 = System.currentTimeMillis()
        for (src in listOf("v == v", "v != v", "contains(w, v)")) {
            try {
                evalExpr(src, e)
                fail("expected \"$src\" to exceed the step budget")
            } catch (ex: ExprError) {
                assertTrue(ex.message!!.contains("too expensive"))
            }
        }
        assertTrue(System.currentTimeMillis() - t0 < 1000)
        // Ordinary comparisons are unaffected.
        assertEquals(Value.TRUE, ev("[1, [2, 3]] == [1, [2, 3]]"))
        assertEquals(Value.TRUE, ev("contains([[1], [2]], [2])"))
        assertEquals(Value.TRUE, ev("range(9000) == range(9000)"))
        assertThrows("range(50000) == range(50000)", "too expensive")
    }

    @Test fun stringBudgetsRefuseOversizedResultsBeforeBuildingThem() {
        val big = Value.Str("x".repeat(350_000))
        val e = ExprEnv(mutableMapOf("l" to Value.list(big, big, big), "big" to big))
        for (src in listOf("str(l)", "join(l, '')", "l + ''", "len(str(l))", "'' + [l]", "contains('x', l)", "l[0] + l")) {
            try {
                evalExpr(src, e)
                fail("expected \"$src\" to be too large")
            } catch (ex: ExprError) {
                assertEquals(src, "string too large", ex.message)
            }
        }
        assertEquals(num(3.0), evalExpr("len(l)", e))
        assertEquals(num(350_000.0), evalExpr("len(big)", e))
        assertEquals(Value.TRUE, evalExpr("contains(l, big)", e))
        // A list may hold at most MAX_LIST_CHARS characters in total (expr.ts MAX_LIST_CHARS).
        val chunk = Value.Str("y".repeat(900_000))
        val many = ExprEnv(mutableMapOf("c" to chunk, "l" to Value.VList(List(17) { chunk })))
        assertEquals(num(17.0), evalExpr("len(l)", many))
        for (src in listOf("push(l, c)", "l + [c]", "[c, c, c, c, c, c, c, c, c, c, c, c, c, c, c, c, c, c]")) {
            try {
                evalExpr(src, many)
                fail("expected \"$src\" to exceed MAX_LIST_CHARS")
            } catch (ex: ExprError) {
                assertEquals(src, "list too large", ex.message)
            }
        }
    }

    @Test fun timeFunctionsUseTheInjectedClockAndZone() {
        val e = ExprEnv(mutableMapOf(), now = { 1_760_000_000_000L }, zone = ZoneOffset.UTC) // 2025-10-09T08:53:20Z (Thursday)
        assertEquals(Value.Str("2025-10-09"), evalExpr("date()", e))
        assertEquals(Value.Str("08:53:20"), evalExpr("time()", e))
        assertEquals(num(8.0), evalExpr("hour()", e))
        assertEquals(num(53.0), evalExpr("minute()", e))
        assertEquals(num(4.0), evalExpr("weekday()", e))
        assertEquals(num(1_760_000_000_000.0), evalExpr("now()", e))
        val r = ExprEnv(mutableMapOf(), random = { 0.999 })
        assertEquals(num(6.0), evalExpr("random(1, 6)", r))
    }

    @Test fun limits() {
        assertThrows("1" + " + 1".repeat(1200), "too long")
        assertThrows("(".repeat(70) + "1" + ")".repeat(70), "too deep")
        assertThrows("'unterminated", "unterminated string")
        assertThrows("1 # 2", "unexpected character")
        assertThrows("range(100001)", "range too large")
        // The linear-time engine (SafeRegex.kt) answers a pathological pattern instead of tripping a backtracking budget.
        val t0 = System.currentTimeMillis()
        assertEquals(Value.FALSE, evalExpr("matches(long, 'a*a*a*a*a*a*b')", ExprEnv(mutableMapOf("long" to Value.Str("a".repeat(5000))))))
        assertTrue(System.currentTimeMillis() - t0 < 3000)
        assertThrows("matches('a', '" + "a".repeat(201) + "')", "pattern too long")
        assertThrows("len()", "expects 1 argument")
    }
}
