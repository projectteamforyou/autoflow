package com.projectteamforyou.autoflow.engine

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Mirrors packages/core/test/safe-regex.test.ts: the linear-time engine agrees with JavaScript's RegExp on the supported subset. */
class SafeRegexTest {
    private val SUBJECTS = listOf("", "abc", "xabcx", "ac", "aaa", "ababc", "abbc", "hello12", "hello1234", "a foo b", "afoo", "y", "xy", "color", "colour", "123", "abc!", "  bob@ex.com ", "abab", "aa", "a", "a{2", "x", "-", "A", "é", "1.5", "abcd", "aaab", "3.14", "x-y_z", "a{,2}", "aab", "a\nb", "John Smith", "555-1234", "foobaz", "a.b", "a\\b")

    /** pattern → one bit per subject (`RegExp.prototype.test` on each SUBJECTS entry, produced with Node). */
    private val EXPECT = listOf(
        "abc" to "011001000000000010000000000100000000000",
        "^abc$" to "010000000000000000000000000000000000000",
        "a.c" to "011001000000000010000000000100000000000",
        "a*" to "111111111111111111111111111111111111111",
        "^a*$" to "100010000000000000011000000000000000000",
        "(a|b)+c" to "011101100000000010000000000100000000000",
        "^(a|ab)*c$" to "010101000000000000000000000000000000000",
        "[a-z]+\\d{2,3}" to "000000011000000000000000000000000000000",
        "\\bfoo\\b" to "000000000100000000000000000000000000000",
        "\\Bfoo" to "000000000010000000000000000000000000000",
        "x?y" to "000000000001100000000000000000100000000",
        "^$" to "100000000000000000000000000000000000000",
        "colou?r" to "000000000000011000000000000000000000000",
        "[^0-9]+$" to "011111100111111011111011110110111110111",
        "^\\s*\\w+@\\w+\\.com\\s*$" to "000000000000000001000000000000000000000",
        "(?:ab){2}" to "000001000000000000100000000000000000000",
        "a{2,}" to "000010000000000000010000000010001000000",
        "a{,2}" to "000000000000000000000000000000010000000",
        "a{2" to "000000000000000000000100000000000000000",
        "[]" to "000000000000000000000000000000000000000",
        "[^]" to "011111111111111111111111111111111111111",
        "[a\\-z]" to "011111100110000010111101000110111101111",
        "\\x41" to "000000000000000000000000100000000000000",
        "\\u00e9" to "000000000000000000000000010000000000000",
        "[\\d.]+" to "000000011000000101000100001001010001010",
        "^.{3}$" to "010010000000000100000100001000001000011",
        "(a*)*b" to "011001100100000011100000000110001100111",
        "a|" to "111111111111111111111111111111111111111",
        "|b" to "111111111111111111111111111111111111111",
        "^(\\d+)(\\.\\d+)?$" to "000000000000000100000000001001000000000",
        "[\\w-]+" to "011111111111111111111111101111111111111",
        "x{0}" to "111111111111111111111111111111111111111",
        "a+?b" to "011001100000000010100000000110001000000",
        "a.*?b" to "011001100100000010100000000110001000011",
        "^[A-Z][a-z]+ [A-Z]" to "000000000000000000000000000000000010000",
        "\\d{3}-\\d{4}" to "000000000000000000000000000000000001000",
        "(foo|bar|baz)$" to "000000000010000000000000000000000000100",
        "a\\.b" to "000000000000000000000000000000000000010",
        "\\\\" to "000000000000000000000000000000000000001",
    )

    @Test fun agreesWithJavaScriptRegExpOnTheSupportedSubset() {
        for ((pattern, bits) in EXPECT) {
            val re = SafeRegex.compile(pattern)
            for ((i, s) in SUBJECTS.withIndex()) {
                assertEquals("/$pattern/ on ${s.replace("\n", "\\n")}", bits[i] == '1', re.test(s))
            }
        }
    }

    @Test fun staysLinearOnPatternsThatMakeBacktrackingEnginesExplode() {
        val t0 = System.currentTimeMillis()
        val evil = "a".repeat(10_000) + "b"
        assertFalse(SafeRegex.compile("^(a|a)*$").test(evil))
        assertFalse(SafeRegex.compile("^(a+)+$").test(evil))
        assertFalse(SafeRegex.compile("^(a|aa)+$").test(evil))
        assertTrue(SafeRegex.compile("(.*a){20}").test("a".repeat(5000)))
        // Through the expression language (the subject is capped at 10 000 code units).
        assertEquals(Value.FALSE, evalExpr("matches(s, \"^(a|a)*$\")", ExprEnv(mutableMapOf("s" to Value.Str("a".repeat(5000) + "b")))))
        assertTrue(System.currentTimeMillis() - t0 < 3000)
    }

    @Test fun rejectsUnsupportedOrOversizedSyntaxInsteadOfChangingItsMeaning() {
        val bad = mapOf(
            "(?=a)" to "lookaround and named groups are not supported",
            "(?!a)" to "lookaround and named groups are not supported",
            "(?<=a)b" to "lookaround and named groups are not supported",
            "(?<n>a)" to "lookaround and named groups are not supported",
            "(?i)abc" to "lookaround and named groups are not supported",
            "(a)\\1" to "back-references are not supported",
            "\\01" to "back-references are not supported",
            "\\p{L}" to "\\p is not supported",
            "\\k<n>" to "\\k is not supported",
            "a**" to "nothing to repeat",
            "*a" to "nothing to repeat",
            "^*" to "nothing to repeat",
            "(a" to "unterminated group",
            "a)" to "unmatched ')'",
            "[a" to "unterminated character class",
            "[z-a]" to "range out of order in character class",
            "a{3,2}" to "numbers out of order in {} quantifier",
            "a{200}" to "repetition count too large",
            "(a{100}){100}" to "pattern too complex",
            "[\\B]" to "\\B is not allowed in a class",
            "a\\" to "\\ at end of pattern",
            "x".repeat(201) to "pattern too long",
        )
        for ((pattern, message) in bad) {
            try {
                SafeRegex.compile(pattern)
                fail("expected /$pattern/ to be rejected")
            } catch (e: RegexError) {
                assertEquals(pattern, message, e.message)
            }
        }
        try {
            evalExpr("matches(\"a\", \"(?=a)\")", ExprEnv(mutableMapOf()))
            fail("expected lookahead to be rejected")
        } catch (e: ExprError) {
            assertEquals("invalid pattern: lookaround and named groups are not supported", e.message)
        }
    }

    @Test fun ecmaScriptDialectDetails() {
        // `.` excludes every LineTerminator, \s is the ECMAScript WhiteSpace set, \d \w \b are ASCII-only.
        assertFalse(SafeRegex.compile("^a.b$").test("a b"))
        assertTrue(SafeRegex.compile("a\\sb").test("a b"))
        assertTrue(SafeRegex.compile("a\\sb").test("a﻿b"))
        assertFalse(SafeRegex.compile("a\\sb").test("a\u0085b"))
        assertFalse(SafeRegex.compile("^\\d+$").test("١"))
        assertFalse(SafeRegex.compile("^\\w+$").test("naïve"))
        assertTrue(SafeRegex.compile("\\bna\\b").test("na ïve"))
        // Annex B: identity escapes, `\0`, literal `{`, `-` as a literal next to a class escape.
        assertTrue(SafeRegex.compile("\\A").test("A"))
        assertTrue(SafeRegex.compile("a\\0b").test("a\u0000b"))
        assertTrue(SafeRegex.compile("[\\w-.]+@").test("x-y.z@"))
        assertTrue(SafeRegex.compile("^[a-\\d]+$").test("a-7"))
        assertFalse(SafeRegex.compile("^[a-\\d]+$").test("b"))
        // Code-unit matching: an astral character is two units.
        assertTrue(SafeRegex.compile("^..$").test("😀"))
    }
}
