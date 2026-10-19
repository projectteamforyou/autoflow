package com.projectteamforyou.autoflow.engine

import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * Every Atlas template in packages/core/fixtures must parse, be classified for Android exactly like the TypeScript
 * capability matrix says (index.json `platforms`), and run to completion (or to its own limits) on a fake gesture sink
 * with virtual time.
 */
class FixturesTest {
    private val dir: File by lazy {
        System.getProperty("autoflow.fixtures")?.let { File(it) }?.takeIf { File(it, "index.json").isFile }
            ?: javaClass.classLoader.getResource("fixtures/index.json")?.let { File(it.toURI()).parentFile }
            ?: error("packages/core/fixtures not found — run `pnpm --filter @autoflow/core build` first")
    }

    private val index: JsonArray by lazy { Json.parseToJsonElement(File(dir, "index.json").readText()).jsonArray }

    private fun load(id: String): Flow = FlowParser.parse(File(dir, "$id.json").readText())

    @Test fun everyFixtureParses() {
        val files = dir.listFiles { f -> f.name.endsWith(".json") && f.name != "index.json" }!!.sortedBy { it.name }
        assertTrue("expected fixtures in $dir", files.size >= 16)
        for (f in files) {
            val flow = FlowParser.parse(f.readText())
            assertEquals(f.nameWithoutExtension, flow.id.removePrefix("tpl_"))
            assertTrue(countSteps(flow.steps) > 0)
        }
        assertEquals(files.size, index.size)
    }

    @Test fun androidSupportMatchesTheCapabilityMatrix() {
        for (entry in index) {
            val o = entry.jsonObject
            val id = o["id"]!!.jsonPrimitive.content
            val platforms = o["platforms"]!!.jsonArray.map { it.jsonPrimitive.content }
            val flow = load(id)
            assertEquals("$id android support", "android" in platforms, isRunnableOn(flow.steps, Platform.ANDROID))
            assertEquals("$id web support", "web" in platforms, isRunnableOn(flow.steps, Platform.WEB))
        }
    }

    private fun runFixture(id: String, backend: FakeBackend = FakeBackend(), capDuration: Boolean = true): Pair<RunResult, FakeBackend> = runBlocking {
        val flow = load(id).let { if (!capDuration) it else it.copy(limits = it.limits.copy(maxDurationMs = minOf(it.limits.maxDurationMs, 120_000))) }
        val result = FlowRun(flow, backend, RunOptions(clock = VirtualClock(1_700_000_000_000), skipCountdown = true, random = { 0.0 }, confirmRisk = { true })).start()
        result to backend
    }

    @Test fun everyAndroidFixtureRuns() {
        for (entry in index) {
            val o: JsonObject = entry.jsonObject
            val id = o["id"]!!.jsonPrimitive.content
            val platforms = o["platforms"]!!.jsonArray.map { it.jsonPrimitive.content }
            val (result, _) = runFixture(id)
            if ("android" in platforms) {
                // Forever loops end at the duration limit; everything else completes.
                assertTrue("$id: ${result.status} ${result.error}", result.status == RunStatus.COMPLETED || result.error?.category == ErrorCategory.LIMIT)
            } else {
                assertEquals("$id must be blocked before running", ErrorCategory.UNSUPPORTED, result.error?.category)
            }
        }
    }

    @Test fun fixtureOutcomes() {
        val (clicker, b1) = runFixture("auto-clicker")
        assertEquals(RunStatus.COMPLETED, clicker.status)
        assertEquals(100, b1.effects.count { it.action is InputAction.Click })
        assertEquals(540 to 1200, b1.effects.first().points.single())

        val (swipe, b2) = runFixture("android-swipe-feed")
        assertEquals(ErrorCategory.LIMIT, swipe.error?.category)
        val drag = b2.effects.first()
        assertEquals(listOf(540 to 1800, 540 to 720), drag.points)

        val (sig, b3) = runFixture("signature")
        assertEquals(RunStatus.COMPLETED, sig.status)
        assertTrue(b3.typed.single().startsWith("Best regards,\nYour Name\n20"))

        val clip = FakeBackend().apply { clipboard = "a\nb  c" }
        val (cc, b4) = runFixture("copy-cleaner", clip)
        assertEquals(RunStatus.COMPLETED, cc.status)
        assertEquals("a b c", b4.clipboard)
        assertEquals("Clipboard cleaned" to "5 characters", b4.notifications.single())

        val (form, b5) = runFixture("form-filler")
        assertEquals(RunStatus.COMPLETED, form.status)
        assertEquals(listOf("Alice", "alice@example.com", "Bob", "bob@example.com"), b5.typed)
        assertEquals(4, b5.effects.count { it.action is InputAction.Key })

        val (status, b6) = runFixture("status-check")
        assertEquals(RunStatus.COMPLETED, status.status)
        assertEquals(Value.Str("simulated GET https://example.com"), status.vars["res"])
        assertTrue(b6.notifications.isEmpty())

        val (night, _) = runFixture("android-night-routine")
        assertEquals(RunStatus.COMPLETED, night.status)

        val (timer, b7) = runFixture("countdown-timer", capDuration = false)
        assertEquals(RunStatus.COMPLETED, timer.status)
        assertEquals(2, b7.notifications.size)

        val (hold, b8) = runFixture("hold-to-repeat", capDuration = false)
        assertEquals(RunStatus.COMPLETED, hold.status)
        assertEquals(1500, b8.effects.count { it.action is InputAction.Key })

        // ui-smoke recovers from a failing click through try/catch and still finishes
        var fails = 10
        val flaky = FakeBackend().apply { failNext = { a -> if (a is InputAction.Click && fails-- > 0) BackendException("no target", ErrorCategory.TARGET) else null } }
        val (smoke, b9) = runFixture("ui-smoke", flaky)
        assertEquals(RunStatus.COMPLETED, smoke.status)
        assertEquals("Smoke test failed" to "no target", b9.notifications.single())
    }
}
