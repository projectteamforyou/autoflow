package com.projectteamforyou.autoflow.engine

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Regression tests for the cross-engine audit: risk through "run flow", callee variables, long operator chains. */
class AuditFixTest {
    private fun flow(id: String, steps: String, vars: String = "[]", extra: String = ""): Flow = FlowParser.parse(
        """{"schemaVersion":"1.0","id":"$id","name":"$id",$extra"variables":$vars,"steps":$steps,"createdAt":"2026-10-19T00:00:00.000Z","updatedAt":"2026-10-19T00:00:00.000Z"}""",
    )

    private class Outcome(val result: RunResult, val backend: FakeBackend, val asked: List<RiskReport>)

    private fun run(f: Flow, flows: List<Flow> = emptyList(), approve: Boolean? = null, inputs: Map<String, Value> = emptyMap()): Outcome = runBlocking {
        val asked = ArrayList<RiskReport>()
        val backend = FakeBackend()
        val byId = flows.associateBy { it.id }
        val r = FlowRun(
            f, backend,
            RunOptions(
                clock = VirtualClock(0), skipCountdown = true, resolveFlow = { byId[it] }, secret = { "TOP" }, inputs = inputs,
                confirmRisk = approve?.let { answer -> { report: RiskReport -> asked.add(report); answer } },
            ),
        ).start()
        Outcome(r, backend, asked)
    }

    private val risky = flow(
        "f_b",
        """[{"id":"h","type":"http","method":"POST","url":"https://example.com/x","body":"{{secret:k}}"},{"id":"w","type":"file","op":"write","path":"/sdcard/x.txt","content":"x"}]""",
    )
    private val caller = flow("f_a", """[{"id":"r","type":"runFlow","flowId":"f_b"}]""", extra = """"trigger":{"type":"schedule","everyMs":60000},""")

    /* ------------------------------------------------------- 1. risk through runFlow */

    @Test fun calledFlowStepsNeedTheCallersApproval() {
        assertFalse("the caller alone has nothing to confirm", analyzeRisk(caller).needsConfirm)
        val report = analyzeRiskWithCalls(caller, { if (it == "f_b") risky else null })
        assertTrue(report.needsConfirm)
        assertEquals(setOf("risk.networkSend", "risk.secretExposed", "risk.fileWrite", "risk.unattended"), report.findings.map { it.key }.toSet())
        assertTrue(report.permissions.containsAll(listOf("perm.network", "perm.files")))
        // One list, the caller's trigger: the same report as a flow that holds the steps itself.
        assertEquals(analyzeRisk(caller.copy(steps = caller.steps + risky.steps)), report)

        // No approval callback (a trigger run nobody approved): the run fails before any step.
        val none = run(caller, listOf(risky))
        assertEquals(RunStatus.FAILED, none.result.status)
        assertEquals(ErrorCategory.USER, none.result.error?.category)
        assertTrue(none.result.error!!.message.startsWith("risky steps were not approved"))
        assertTrue(none.backend.effects.isEmpty())

        val refused = run(caller, listOf(risky), approve = false)
        assertEquals(RunStatus.FAILED, refused.result.status)
        assertEquals(1, refused.asked.size)
        assertTrue(refused.asked[0].findings.any { it.stepId == "h" && it.key == "risk.networkSend" })
        assertTrue(refused.backend.effects.isEmpty())

        val approved = run(caller, listOf(risky), approve = true)
        assertEquals(1, approved.asked.size)
        assertEquals(approved.result.error?.message, RunStatus.COMPLETED, approved.result.status)
    }

    @Test fun riskWalkEndsOnCyclesUnknownIdsAndDisabledCalls() {
        val a = flow("f_a", """[{"id":"r","type":"runFlow","flowId":"f_b"},{"id":"u","type":"runFlow","flowId":"f_missing"}]""")
        val b = flow("f_b", """[{"id":"r2","type":"runFlow","flowId":"f_a"},{"id":"r3","type":"runFlow","flowId":"f_b"},{"id":"d","type":"file","op":"delete","path":"/sdcard/x"}]""")
        var lookups = 0
        val report = analyzeRiskWithCalls(a, { lookups++; mapOf("f_a" to a, "f_b" to b)[it] })
        assertEquals(listOf("risk.fileDelete"), report.findings.map { it.key })
        assertEquals("f_b and f_missing are looked up once; the caller itself never", 2, lookups)

        val self = flow("f_s", """[{"id":"r","type":"runFlow","flowId":"f_s"}]""")
        assertEquals(analyzeRisk(self), analyzeRiskWithCalls(self, { self }))

        val off = flow("f_o", """[{"id":"r","type":"runFlow","flowId":"f_b","disabled":true}]""")
        assertFalse(analyzeRiskWithCalls(off, { b }).needsConfirm)

        // Depth limit 8: f0 → f1 → … → f9, the delete sits in f9 (nine calls deep) and is out of reach; f8's is found.
        fun chain(deleteAt: Int) = (0..9).associate { i ->
            val call = if (i < 9) """{"id":"c$i","type":"runFlow","flowId":"f${i + 1}"}""" else """{"id":"n","type":"wait","ms":1}"""
            val del = if (i == deleteAt) "," + """{"id":"d","type":"file","op":"delete","path":"/sdcard/x"}""" else ""
            "f$i" to flow("f$i", "[$call$del]")
        }
        chain(9).let { m -> assertFalse(analyzeRiskWithCalls(m.getValue("f0"), { m[it] }).needsConfirm) }
        chain(8).let { m -> assertTrue(analyzeRiskWithCalls(m.getValue("f0"), { m[it] }).needsConfirm) }
    }

    @Test fun flowWithoutRunFlowIsUnchanged() {
        val plain = flow("f_p", """[{"id":"h","type":"http","method":"GET","url":"https://example.com/"},{"id":"w","type":"wait","ms":1}]""")
        assertEquals(analyzeRisk(plain), analyzeRiskWithCalls(plain, { error("nothing to resolve") }))
        assertEquals(analyzeRisk(risky), analyzeRiskWithCalls(risky, { null }))
        assertEquals(FlowRun.preflight(plain, Platform.ANDROID).risk, FlowRun.preflight(plain, Platform.ANDROID) { null }.risk)
        // No risky step anywhere: nobody is asked.
        val calm = flow("f_c", """[{"id":"s","type":"setVar","name":"y","value":"1"}]""")
        val out = run(flow("f_a", """[{"id":"r","type":"runFlow","flowId":"f_c"}]"""), listOf(calm), approve = false)
        assertEquals(RunStatus.COMPLETED, out.result.status)
        assertTrue(out.asked.isEmpty())
    }

    /* ------------------------------------------------------- 2. callee variables */

    private val greeter = flow(
        "f_g", """[{"id":"s","type":"setVar","name":"out","value":"greeting + '!'"}]""",
        vars = """[{"name":"greeting","type":"string","initial":"hi"},{"name":"n","type":"number","initial":"5"},{"name":"flag","type":"boolean","initial":"true"},{"name":"blank","type":"list"}]""",
    )
    private val callsGreeter = """[{"id":"r","type":"runFlow","flowId":"f_g"}]"""

    @Test fun calledFlowGetsItsDeclaredVariables() {
        val out = run(flow("f_a", callsGreeter), listOf(greeter))
        assertEquals(out.result.error?.message, RunStatus.COMPLETED, out.result.status)
        assertEquals(Value.Str("hi!"), out.result.vars["out"])
        // Same conversion as at run start: number from a string, boolean from "true", type default without an initial.
        assertEquals(Value.Num(5.0), out.result.vars["n"])
        assertEquals(Value.TRUE, out.result.vars["flag"])
        assertEquals(Value.VList(emptyList()), out.result.vars["blank"])
    }

    @Test fun callerVariableOfTheSameNameIsKept() {
        val a = flow("f_a", callsGreeter, vars = """[{"name":"greeting","type":"string","initial":"hello"}]""")
        assertEquals(Value.Str("hello!"), run(a, listOf(greeter)).result.vars["out"])
        // Set by an earlier step rather than declared: still kept.
        val b = flow("f_a", """[{"id":"s0","type":"setVar","name":"greeting","value":"'yo'"},{"id":"r","type":"runFlow","flowId":"f_g"}]""")
        assertEquals(Value.Str("yo!"), run(b, listOf(greeter)).result.vars["out"])
        // A second call does not reset what the first call's steps changed.
        val counter = flow("f_k", """[{"id":"s","type":"setVar","name":"k","value":"k + 1"}]""", vars = """[{"name":"k","type":"number","initial":0}]""")
        val twice = flow("f_a", """[{"id":"r1","type":"runFlow","flowId":"f_k"},{"id":"r2","type":"runFlow","flowId":"f_k"}]""")
        assertEquals(Value.Num(2.0), run(twice, listOf(counter)).result.vars["k"])
    }

    @Test fun runInputsDoNotApplyToCalleeVariables() {
        val out = run(flow("f_a", callsGreeter), listOf(greeter), inputs = mapOf("greeting" to Value.Str("input")))
        assertEquals(Value.Str("hi!"), out.result.vars["out"])
    }

    @Test fun calleeNumberVariableFailsLikeAtRunStart() {
        val bad = flow("f_g", """[{"id":"s","type":"setVar","name":"out","value":"n"}]""", vars = """[{"name":"n","type":"number","initial":"abc"}]""")
        val out = run(flow("f_a", callsGreeter), listOf(bad))
        assertEquals(RunStatus.FAILED, out.result.status)
        assertEquals("variable \"n\": \"abc\" is not a number", out.result.error?.message)
        assertEquals(ErrorCategory.EXPRESSION, out.result.error?.category)
        assertNull(out.result.vars["out"])
    }

    /* ------------------------------------------------------- 3. long operator chains */

    private fun chainOf(term: String, op: String, n: Int = 900): String = (0..n).joinToString(op) { term }

    @Test fun longOperatorChainsEvaluate() {
        val env = ExprEnv(mutableMapOf("s" to Value.Str("a"), "t" to Value.TRUE))
        fun eval(src: String): Value {
            assertTrue("source fits the limit", src.length <= MAX_SOURCE)
            return evaluate(parseExpr(src), env)
        }
        assertEquals(Value.Num(1.0), eval(chainOf("1", "*")))
        assertEquals(Value.Num(1.0), eval(chainOf("1", "*", 999))) // the audit's case: 1999 characters
        assertEquals(Value.Num(901.0), eval(chainOf("1", "+")))
        assertEquals(Value.Num(-899.0), eval(chainOf("1", "-")))
        assertEquals(Value.TRUE, eval(chainOf("t", "&&", 600)))
        assertEquals(Value.Num(0.0), eval("0&&" + chainOf("t", "&&", 600)))
        assertEquals(Value.Num(1.0), eval(chainOf("0", "||", 600) + "||1"))
        assertEquals(Value.Str("a".repeat(901)), eval(chainOf("s", "+")))
        assertEquals(Value.Str("a".repeat(451)), eval(chainOf("'a'", "+", 450)))
    }

    @Test fun chainsKeepOrderShortCircuitAndBudget() {
        val env = ExprEnv(mutableMapOf())
        fun eval(src: String) = evaluate(parseExpr(src), env)
        assertEquals(Value.Num(-4.0), eval("1-2-3"))
        assertEquals(Value.Num(7.0), eval("1+2*3"))
        assertEquals(Value.Str("3a12"), eval("1+2+'a'+1+2"))
        assertEquals(Value.Num(0.0), eval("0 && missing && 1/0")) // the right side is never evaluated
        assertEquals(Value.Num(2.0), eval("2 || missing || 1/0"))
        assertEquals("unknown variable \"missing\"", runCatching { eval("1 && missing && 2") }.exceptionOrNull()?.message)
        assertEquals("division by zero", runCatching { eval("1+2/0+missing") }.exceptionOrNull()?.message)
        // 64 nested parentheses/unary operators stay the limit, with the same message as expr.ts.
        assertEquals("expression too deep", runCatching { eval("(".repeat(70) + "1" + ")".repeat(70)) }.exceptionOrNull()?.message)
        assertEquals("expression too deep", runCatching { eval("-".repeat(70) + "1") }.exceptionOrNull()?.message)
    }
}
