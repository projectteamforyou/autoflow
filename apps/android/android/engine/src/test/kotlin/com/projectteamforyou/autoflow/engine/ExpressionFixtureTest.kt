package com.projectteamforyou.autoflow.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File
import java.time.ZoneOffset

/**
 * Expression conformance: replays packages/core/fixtures/engine/expressions.json (produced by the TypeScript
 * evaluator, scripts/emit-expressions.mjs) and requires the exact value or the exact error message for every case.
 * A semantic change in the TypeScript engine shows up as a fixture diff, which this evaluator then has to follow.
 */
class ExpressionFixtureTest {
    private val file: File by lazy {
        System.getProperty("autoflow.fixtures")?.let { File(it, "engine/expressions.json") }?.takeIf { it.isFile }
            ?: javaClass.classLoader.getResource("fixtures/engine/expressions.json")?.let { File(it.toURI()) }
            ?: error("packages/core/fixtures/engine/expressions.json not found — run `pnpm --filter @autoflow/core build` first")
    }

    /** A fixture variable: plain JSON, or `{"$repeat": [text, count]}` for a long string (kept small in the file). */
    private fun expand(e: JsonElement): Value = when {
        e is JsonObject && e.containsKey("\$repeat") -> {
            val r = e["\$repeat"]!!.jsonArray
            Value.Str(r[0].jsonPrimitive.content.repeat(r[1].jsonPrimitive.longOrNull!!.toInt()))
        }
        e is JsonArray -> Value.VList(e.map { expand(it) })
        else -> Value.fromJson(e)
    }

    @Test fun everyFixtureCaseMatchesTheTypeScriptEvaluator() {
        val fx = Json.parseToJsonElement(file.readText()).jsonObject
        val vars = fx["vars"]!!.jsonObject.mapValues { expand(it.value) }.toMutableMap()
        val cases = fx["cases"]!!.jsonArray.map { it.jsonObject }
        assertTrue("expected expression cases", cases.size > 40)
        assertTrue(cases.any { "matches(" in it["expr"]!!.jsonPrimitive.content })
        // Same clock and RNG as packages/core/test/expressions-fixture.test.ts (Date.UTC(2026, 0, 1), 0.5).
        val env = ExprEnv(vars, now = { 1_767_225_600_000L }, random = { 0.5 }, zone = ZoneOffset.UTC)
        val failures = ArrayList<String>()
        for (c in cases) {
            val expr = c["expr"]!!.jsonPrimitive.content
            val expect = c["expect"]!!.jsonObject
            val wantError = (expect["error"] as? JsonPrimitive)?.content
            val got = try {
                evalExpr(expr, env)
            } catch (e: ExprError) {
                if (wantError == null) failures.add("$expr: expected ${expect["value"]}, threw \"${e.message}\"")
                else if (e.message != wantError) failures.add("$expr: expected error \"$wantError\", got \"${e.message}\"")
                continue
            }
            if (wantError != null) failures.add("$expr: expected error \"$wantError\", got $got")
            else {
                val want = Value.fromJson(expect["value"])
                if (want != got) failures.add("$expr: expected $want, got $got")
            }
        }
        if (failures.isNotEmpty()) fail("${failures.size} of ${cases.size} cases differ:\n" + failures.joinToString("\n"))
    }
}
