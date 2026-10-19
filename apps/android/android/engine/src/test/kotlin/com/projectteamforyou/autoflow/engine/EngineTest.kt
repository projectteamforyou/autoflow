package com.projectteamforyou.autoflow.engine

import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Mirrors the "schema" and "engine" suites of packages/core/test/core.test.ts with a fake gesture sink. */
class EngineTest {
    companion object {
        /** Builds a flow document the way `createFlow` does: zod defaults come from the parser. */
        fun flowJson(steps: String, extra: String = ""): String =
            """{"schemaVersion":"1.0","id":"t","name":"t","createdAt":"2026-10-19T00:00:00.000Z","updatedAt":"2026-10-19T00:00:00.000Z",
               "steps":$steps${if (extra.isNotEmpty()) ",$extra" else ""}}"""

        fun mk(steps: String, extra: String = ""): Flow = FlowParser.parse(flowJson(steps, extra))

        const val CLICK = """{"kind":"point","x":10,"y":20,"space":"screen"}"""
    }

    class Outcome(val result: RunResult, val backend: FakeBackend, val events: List<RunEvent>)

    private fun run(
        flow: Flow,
        backend: FakeBackend = FakeBackend(),
        confirmRisk: (suspend (RiskReport) -> Boolean)? = null,
        confirmScreen: (suspend (ScreenInfo, ScreenInfo) -> Boolean)? = null,
        resolve: ((String) -> Flow?)? = null,
    ): Outcome = runBlocking {
        val events = ArrayList<RunEvent>()
        val r = FlowRun(
            flow, backend,
            RunOptions(
                clock = VirtualClock(1_000_000), skipCountdown = true, onEvent = { events.add(it) }, random = { 0.0 },
                confirmRisk = confirmRisk, confirmScreenChange = confirmScreen, resolveFlow = resolve,
            ),
        )
        Outcome(r.start(), backend, events)
    }

    @Test fun schemaValidatesAndRejectsBadInput() {
        try {
            FlowParser.parse("""{"name":"x"}""")
            fail("expected invalid flow")
        } catch (e: FlowParseException) {
            assertTrue(e.issues.isNotEmpty())
        }
        try {
            mk("""[{"id":"a","type":"wait","ms":1},{"id":"a","type":"wait","ms":1}]""")
            fail("expected duplicate id")
        } catch (e: FlowParseException) {
            assertTrue(e.message!!.contains("duplicate step id"))
        }
        try {
            mk("""[{"id":"l","type":"loop","mode":"count","body":[]}]""")
            fail("expected count loop without count to fail")
        } catch (e: FlowParseException) {
            assertTrue(e.message!!.contains("loop.count required"))
        }
        // defaults are applied like zod
        val f = mk("""[{"id":"c","type":"click","target":$CLICK}]""")
        val c = f.steps[0] as Step.Click
        assertEquals("left", c.button)
        assertEquals(1, c.clicks)
        assertEquals(3000L, f.limits.countdownMs)
        assertEquals(Hotkey("Escape", listOf("ctrl", "alt")), f.hotkeys.stop)
    }

    @Test fun loopsVariablesAndConditionsDeterministically() {
        val flow = mk(
            """[{"id":"v","type":"setVar","name":"n","value":"0"},
            {"id":"l","type":"loop","mode":"count","count":5,"indexVar":"i","body":[
              {"id":"inc","type":"setVar","name":"n","value":"n + i"},
              {"id":"if","type":"if","condition":{"expr":"i == 3"},"then":[{"id":"b","type":"break"}],"else":[]},
              {"id":"c","type":"click","target":$CLICK,"button":"left","clicks":1,"holdMs":0,"modifiers":[]}]}]""",
        )
        val o = run(flow)
        assertEquals(RunStatus.COMPLETED, o.result.status)
        assertEquals(Value.Num(6.0), o.result.vars["n"])
        assertEquals(3, o.backend.effects.count { it.action is InputAction.Click })
        assertEquals(listOf(10 to 20), o.backend.effects.first().points)
    }

    @Test fun maxActionsLimit() {
        val flow = mk(
            """[{"id":"l","type":"loop","mode":"forever","body":[{"id":"k","type":"key","key":"a"},{"id":"w","type":"wait","ms":1}]}]""",
            """"limits":{"maxActions":50}""",
        )
        val o = run(flow)
        assertEquals(RunStatus.FAILED, o.result.status)
        assertEquals(ErrorCategory.LIMIT, o.result.error?.category)
        assertEquals(51L, o.result.actions)
    }

    @Test fun maxDurationLimitWithVirtualTime() {
        val flow = mk("""[{"id":"l","type":"loop","mode":"forever","body":[{"id":"w","type":"wait","ms":1000}]}]""", """"limits":{"maxDurationMs":10000}""")
        val o = run(flow)
        assertEquals(RunStatus.FAILED, o.result.status)
        assertEquals(ErrorCategory.LIMIT, o.result.error?.category)
        assertTrue(o.result.durationMs >= 10_000)
        assertTrue(o.result.durationMs < 11_200)
    }

    @Test fun stopsPromptlyOnRequest() = runBlocking {
        val flow = mk("""[{"id":"l","type":"loop","mode":"forever","body":[{"id":"w","type":"wait","ms":50}]}]""")
        val r = FlowRun(flow, FakeBackend(), RunOptions(skipCountdown = true))
        val done = async { r.start() }
        delay(30)
        val t0 = System.currentTimeMillis()
        r.stop("test")
        val result = done.await()
        assertTrue(System.currentTimeMillis() - t0 < 500)
        assertEquals(RunStatus.STOPPED, result.status)
        assertEquals("test", result.reason)
    }

    @Test fun stopInterruptsALongBackendAction() = runBlocking {
        val flow = mk("""[{"id":"c","type":"click","target":$CLICK}]""")
        val r = FlowRun(flow, FakeBackend(actionDelayMs = 60_000), RunOptions(skipCountdown = true))
        val done = async { r.start() }
        delay(50)
        val t0 = System.currentTimeMillis()
        r.stop("halt")
        val result = done.await()
        assertTrue(System.currentTimeMillis() - t0 < 500)
        assertEquals(RunStatus.STOPPED, result.status)
    }

    @Test fun pausesAndResumes() = runBlocking {
        val flow = mk("""[{"id":"l","type":"loop","mode":"count","count":3,"body":[{"id":"w","type":"wait","ms":20}]}]""")
        val r = FlowRun(flow, FakeBackend(), RunOptions(skipCountdown = true))
        val done = async { r.start() }
        delay(10)
        r.pause()
        assertEquals(RunState.PAUSED, r.currentState)
        delay(50)
        assertEquals(RunState.PAUSED, r.currentState)
        r.resume()
        assertEquals(RunStatus.COMPLETED, done.await().status)
    }

    @Test fun countdownIsEmittedAndStoppable() = runBlocking {
        val flow = mk("""[{"id":"c","type":"click","target":$CLICK}]""", """"limits":{"countdownMs":3000}""")
        val events = ArrayList<RunEvent>()
        val o = FlowRun(flow, FakeBackend(), RunOptions(clock = VirtualClock(), onEvent = { events.add(it) })).start()
        assertEquals(RunStatus.COMPLETED, o.status)
        assertEquals(listOf(3000L, 2000L, 1000L), events.filterIsInstance<RunEvent.Countdown>().map { it.remainingMs })
    }

    @Test fun retriesContinuesAndCatches() {
        var failures = 2
        val backend = FakeBackend()
        backend.failNext = { a -> if (a is InputAction.Click && failures-- > 0) BackendException("target missing", ErrorCategory.TARGET) else null }
        val flow = mk(
            """[{"id":"c","type":"click","target":$CLICK,"onError":{"strategy":"retry","retries":3,"backoffMs":10}},
            {"id":"t","type":"try","errorVar":"e","body":[{"id":"bad","type":"setVar","name":"x","value":"1/0"}],"catch":[{"id":"ok","type":"setVar","name":"caught","value":"e"}]},
            {"id":"skip","type":"setVar","name":"y","value":"unknownVar","onError":{"strategy":"continue","retries":0,"backoffMs":0}},
            {"id":"end","type":"setVar","name":"done","value":"true"}]""",
        )
        val o = run(flow, backend)
        assertEquals(RunStatus.COMPLETED, o.result.status)
        assertEquals(2, o.events.count { it is RunEvent.Retry })
        assertTrue(toStr(o.result.vars["caught"]!!).contains("division by zero"))
        assertEquals(Value.TRUE, o.result.vars["done"])
    }

    @Test fun fatalBackendErrorsBypassErrorPolicies() {
        val backend = FakeBackend()
        backend.failNext = { BackendException("protected screen", ErrorCategory.PERMISSION, fatal = true) }
        val flow = mk(
            """[{"id":"t","type":"try","body":[{"id":"c","type":"click","target":$CLICK,"onError":{"strategy":"continue"}}],"catch":[{"id":"x","type":"setVar","name":"caught","value":"1"}]}]""",
        )
        val o = run(flow, backend)
        assertEquals(RunStatus.FAILED, o.result.status)
        assertEquals(ErrorCategory.PERMISSION, o.result.error?.category)
        assertNull(o.result.vars["caught"])
    }

    @Test fun blocksUnsupportedStepsBeforeRunning() {
        val o = run(mk("""[{"id":"w","type":"window","op":"close","match":{"title":"x"}}]"""))
        assertEquals(RunStatus.FAILED, o.result.status)
        assertEquals(ErrorCategory.UNSUPPORTED, o.result.error?.category)
        assertTrue(o.backend.effects.isEmpty())
        // Android cannot click "the current pointer position" or move a pointer.
        assertEquals(ErrorCategory.UNSUPPORTED, run(mk("""[{"id":"c","type":"click","target":{"kind":"current"}}]""")).result.error?.category)
        assertEquals(ErrorCategory.UNSUPPORTED, run(mk("""[{"id":"m","type":"move","target":$CLICK}]""")).result.error?.category)
    }

    @Test fun requiresApprovalForRiskySteps() {
        val flow = mk("""[{"id":"h","type":"http","method":"POST","url":"https://example.com/api","headers":{}}]""")
        assertEquals(ErrorCategory.USER, run(flow).result.error?.category)
        assertEquals(RunStatus.COMPLETED, run(flow, confirmRisk = { true }).result.status)
    }

    @Test fun asksWhenTheScreenChanged() {
        val flow = mk("""[{"id":"c","type":"click","target":{"kind":"point","x":1,"y":1,"space":"screen"}}]""", """"screen":{"width":1920,"height":1080,"scale":1}""")
        assertEquals(ErrorCategory.ENVIRONMENT, run(flow).result.error?.category)
        assertEquals(RunStatus.COMPLETED, run(flow, confirmScreen = { _, _ -> true }).result.status)
        // normalized coordinates survive a screen change without asking
        val norm = mk("""[{"id":"c","type":"click","target":{"kind":"point","x":0.5,"y":0.5,"space":"normalized"}}]""", """"screen":{"width":1920,"height":1080,"scale":1}""")
        val o = run(norm)
        assertEquals(RunStatus.COMPLETED, o.result.status)
        assertEquals(listOf(540 to 1200), o.backend.effects.single().points)
    }

    @Test fun declinedConfirmAndStopStep() {
        val r1 = run(mk("""[{"id":"q","type":"confirm","message":"ok?"},{"id":"x","type":"setVar","name":"after","value":"1"}]"""), FakeBackend(confirmAnswer = { false }))
        assertEquals(RunStatus.STOPPED, r1.result.status)
        assertNull(r1.result.vars["after"])
        val r2 = run(mk("""[{"id":"s","type":"stop","reason":"done"}]"""))
        assertEquals(RunStatus.STOPPED, r2.result.status)
        assertEquals("done", r2.result.reason)
    }

    @Test fun debugBreakpointsPause() = runBlocking {
        val flow = mk("""[{"id":"a","type":"setVar","name":"x","value":"1"},{"id":"b","type":"setVar","name":"x","value":"2","breakpoint":true}]""")
        val r = FlowRun(flow, FakeBackend(), RunOptions(skipCountdown = true, debug = true))
        val done = async { r.start() }
        delay(30)
        assertEquals(RunState.PAUSED, r.currentState)
        r.resume()
        assertEquals(Value.Num(2.0), done.await().vars["x"])
    }

    @Test fun nestedFlowsAndGotoRecovery() {
        val child = mk("""[{"id":"cc","type":"setVar","name":"fromChild","value":"'yes'"}]""")
        val flow = mk(
            """[{"id":"start","type":"setVar","name":"tries","value":"tries + 1"},
            {"id":"call","type":"runFlow","flowId":"child"},
            {"id":"fail","type":"setVar","name":"z","value":"tries < 3 ? 1/0 : 1","onError":{"strategy":"goto","gotoStepId":"start","retries":0,"backoffMs":0}}]""",
            """"variables":[{"name":"tries","type":"number","initial":0}]""",
        )
        val o = run(flow, resolve = { if (it == "child") child else null })
        assertEquals(RunStatus.COMPLETED, o.result.status)
        assertEquals(Value.Num(3.0), o.result.vars["tries"])
        assertEquals(Value.Str("yes"), o.result.vars["fromChild"])
    }

    @Test fun typedTextIsInterpolatedWithSecrets() = runBlocking {
        val flow = mk("""[{"id":"t","type":"type","text":"user {{name}} pw {{secret:pw}}"}]""", """"variables":[{"name":"name","initial":"ann"}]""")
        val backend = FakeBackend()
        val result = FlowRun(flow, backend, RunOptions(clock = VirtualClock(), skipCountdown = true, secret = { if (it == "pw") "hunter2" else null })).start()
        assertEquals(RunStatus.COMPLETED, result.status)
        assertEquals(listOf("user ann pw hunter2"), backend.typed)
        // secrets never land in run variables or events
        assertFalse(result.toJson().toString().contains("hunter2"))
    }

    @Test fun eventsHaveTheTypeScriptShape() {
        val o = run(mk("""[{"id":"v","type":"setVar","name":"n","value":"[1, 'a', true, null]"},{"id":"g","type":"log","message":"n={{n}}"}]"""))
        val json = o.events.map { it.toJson() }
        val state = json.first()
        assertEquals("state", state["type"]!!.toString().trim('"'))
        assertEquals("preflight", state["state"]!!.toString().trim('"'))
        val v = json.first { it["type"].toString() == "\"var\"" }
        assertEquals("""{"type":"var","name":"n","value":[1,"a",true,null],"at":1000000}""", v.toString())
        val log = json.first { it["type"].toString() == "\"log\"" }
        assertEquals("""{"type":"log","level":"info","message":"n=1,a,true,","stepId":"g","at":1000000}""", log.toString())
        val res: JsonObject = Json.parseToJsonElement(o.result.toJson().toString()).jsonObject
        assertEquals(setOf("status", "actions", "iterations", "durationMs", "vars", "startedAt", "endedAt"), res.keys)
    }
}
