package com.projectteamforyou.autoflow.engine

import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZoneOffset
import java.time.ZonedDateTime

class CronKeyforgeTest {
    private fun at(s: String) = ZonedDateTime.parse(s)
    private val t0 = ZonedDateTime.of(2026, 10, 19, 9, 30, 15, 0, ZoneOffset.UTC) // Monday

    @Test fun cronNext() {
        assertEquals(at("2026-10-19T09:31Z"), Cron.parse("* * * * *").next(t0))
        assertEquals(at("2026-10-19T09:45Z"), Cron.parse("*/15 * * * *").next(t0))
        assertEquals(at("2026-10-20T08:00Z"), Cron.parse("0 8 * * *").next(t0))
        assertEquals(at("2026-10-24T22:00Z"), Cron.parse("0 22 * * SAT").next(t0))
        assertEquals(at("2026-10-19T17:00Z"), Cron.parse("0 9-17 * * 1-5").next(at("2026-10-19T16:00Z")))
        assertEquals(at("2026-10-26T09:00Z"), Cron.parse("0 9 * * 1").next(t0))
        assertEquals(at("2026-11-01T00:00Z"), Cron.parse("@monthly").next(t0))
        assertEquals(at("2026-10-25T00:00Z"), Cron.parse("0 0 * * 7").next(t0))
        // day-of-month OR day-of-week when both are restricted
        assertEquals(at("2026-10-20T00:00Z"), Cron.parse("0 0 1 * TUE").next(t0))
        assertNull(Cron.parse("0 0 31 2 *").next(t0))
        assertTrue(runCatching { Cron.parse("61 * * * *") }.isFailure)
        assertTrue(runCatching { Cron.parse("* * *") }.isFailure)
    }

    @Test fun keyforgeProfiles() {
        val json = Json.parseToJsonElement(
            """[
            {"id":"base","name":"Base","priority":0,"rules":[],"layers":[{"id":"l","name":"L","mappings":[
              {"id":"m1","from":{"kind":"key","key":"F1","modifiers":[]},"to":{"kind":"text","text":"hello"}},
              {"id":"m2","from":{"kind":"mouse","button":"x1"},"to":{"kind":"key","key":"a"}}]}],
             "textExpansions":[{"id":"t","abbreviation":"brb","text":"be right back"}]},
            {"id":"chat","name":"Chat","priority":20,"rules":[{"kind":"app","app":"com.chat"}],"layers":[{"id":"l","name":"L","mappings":[
              {"id":"m3","from":{"kind":"key","key":"S","modifiers":["alt","ctrl"]},"to":{"kind":"flow","flowId":"f1"}}]}]}
            ]""",
        )
        val (profiles, warnings) = Keyforge.parse(json)
        assertEquals(2, profiles.size)
        assertEquals(listOf("f1"), listOf(profiles[1].mappings.single().to.json["flowId"].toString().trim('"')))
        assertEquals("ctrl+alt+s", profiles[1].mappings.single().combo)
        assertTrue(warnings.any { it.contains("m2") })
        assertTrue(warnings.any { it.contains("text expansion") })
        assertEquals("base", Keyforge.resolveActive(profiles, Keyforge.Context(app = "com.other"))?.id)
        assertEquals("chat", Keyforge.resolveActive(profiles, Keyforge.Context(app = "com.chat"))?.id)
        assertEquals("space", Keyforge.comboKey(" ", emptyList()))
        assertEquals("ctrl+alt+escape", Keyforge.comboKey("Escape", listOf("alt", "ctrl")))
    }
}
