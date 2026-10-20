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
        try {
            evalExpr("matches(long, 'a*a*a*a*a*a*b')", ExprEnv(mutableMapOf("long" to Value.Str("a".repeat(5000)))))
            fail("expected backtracking budget to trip")
        } catch (e: ExprError) {
            assertTrue(e.message!!.contains("too expensive"))
        }
        assertThrows("matches('a', '" + "a".repeat(201) + "')", "pattern too long")
        assertThrows("len()", "expects 1 argument")
    }
}
