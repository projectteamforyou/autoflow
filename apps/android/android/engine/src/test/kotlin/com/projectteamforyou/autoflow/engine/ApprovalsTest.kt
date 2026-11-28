package com.projectteamforyou.autoflow.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ApprovalsTest {
    private fun flow(json: String): Flow = FlowParser.parse(Json.parseToJsonElement(json))

    private fun mk(id: String, steps: String, variables: String = "[]", extra: String = ""): Flow = flow(
        """{"schemaVersion":"1.0","id":"$id","name":"$id","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z",
           "variables":$variables,"steps":$steps$extra}""",
    )

    private val post = """[{"id":"h","type":"http","method":"POST","url":"https://example.com/x","headers":{},"body":"{{secret:k}}","timeoutMs":5000}]"""

    @Test
    fun sameStepsSameHashWhateverTheKeyOrderNameOrTrigger() {
        val a = mk("f_a", post)
        val b = flow(
            """{"steps":[{"type":"http","id":"h","url":"https://example.com/x","method":"POST","timeoutMs":5000,"body":"{{secret:k}}","headers":{}}],
               "name":"renamed","id":"f_a","schemaVersion":"1.0","createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-02-01T00:00:00.000Z",
               "trigger":{"type":"schedule","everyMs":3600000},"variables":[]}""",
        )
        val none: (String) -> Flow? = { null }
        assertNotNull(Approvals.stepsHash(a, none))
        assertEquals(Approvals.stepsHash(a, none), Approvals.stepsHash(b, none))
    }

    @Test
    fun anyStepOrVariableEditChangesTheHash() {
        val none: (String) -> Flow? = { null }
        val base = Approvals.stepsHash(mk("f_a", post, """[{"name":"u","type":"string","initial":"a"}]"""), none)
        assertNotEquals(base, Approvals.stepsHash(mk("f_a", post.replace("example.com/x", "example.com/y"), """[{"name":"u","type":"string","initial":"a"}]"""), none))
        assertNotEquals(base, Approvals.stepsHash(mk("f_a", post, """[{"name":"u","type":"string","initial":"b"}]"""), none))
    }

    @Test
    fun calledFlowsAreCoveredAndCyclesEnd() {
        val callee = mk("f_b", post)
        val caller = mk("f_a", """[{"id":"r","type":"runFlow","flowId":"f_b"},{"id":"r2","type":"runFlow","flowId":"f_a"},{"id":"r3","type":"runFlow","flowId":"f_missing"}]""")
        val lib = mutableMapOf("f_b" to callee, "f_a" to caller)
        val h1 = Approvals.stepsHash(caller) { lib[it] }
        // Editing the called flow asks again.
        lib["f_b"] = mk("f_b", post.replace("POST", "PUT"))
        val h2 = Approvals.stepsHash(caller) { lib[it] }
        assertNotEquals(h1, h2)
        // An unrelated flow does not matter.
        lib["f_z"] = mk("f_z", "[]")
        assertEquals(h2, Approvals.stepsHash(caller) { lib[it] })
        // A cycle back through the callee ends.
        lib["f_b"] = mk("f_b", """[{"id":"back","type":"runFlow","flowId":"f_a"}]""")
        assertNotNull(Approvals.stepsHash(caller) { lib[it] })
    }

    @Test
    fun aDisabledCallIsNotFollowedAndAFlowWithoutSourceIsNeverApproved() {
        val callee = mk("f_b", post)
        val caller = mk("f_a", """[{"id":"r","type":"runFlow","flowId":"f_b","disabled":true}]""")
        val alone = Approvals.stepsHash(caller) { null }
        assertEquals(alone, Approvals.stepsHash(caller) { if (it == "f_b") callee else null })
        val noSource = caller.copy(source = null)
        assertNull(Approvals.stepsHash(noSource) { null })
        assertFalse(Approvals.isApproved(mapOf("f_a" to "x"), "f_a", null))
        assertTrue(Approvals.isApproved(mapOf("f_a" to "x"), "f_a", "x"))
    }

    @Test
    fun canonicalJsonSortsKeysAtEveryLevel() {
        val e: JsonElement = Json.parseToJsonElement("""{"b":[{"y":1,"x":"é\"q"}],"a":null,"c":true}""")
        assertEquals("""{"a":null,"b":[{"x":"é\"q","y":1}],"c":true}""", Approvals.canonical(e))
    }
}
