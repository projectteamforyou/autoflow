package com.projectteamforyou.autoflow.engine

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.ZonedDateTime

/**
 * Keyforge on Android (limited): hardware-keyboard key → output remapping, chosen per foreground app / time / device
 * like `resolveActiveProfile` in packages/core/src/input-profile.ts. Android accessibility can only observe hardware
 * keys, so mouse/wheel sources, layers and text expansion are reported as warnings instead of being half-applied.
 */
object Keyforge {
    /** Canonical "ctrl+alt+s" form: modifiers in ctrl, alt, shift, meta order, key lower-cased, " " ↔ "space". */
    fun comboKey(key: String, modifiers: Collection<String>): String {
        val order = listOf("ctrl", "alt", "shift", "meta")
        val k = when {
            key == " " || key.equals("Space", ignoreCase = true) || key.equals("Spacebar", ignoreCase = true) -> "space"
            key.equals("Esc", ignoreCase = true) -> "escape"
            else -> key.lowercase()
        }
        return (order.filter { it in modifiers } + k).joinToString("+")
    }

    sealed class Rule {
        data class App(val app: String, val window: String?) : Rule()
        data class Time(val fromMin: Int, val toMin: Int, val days: List<Int>) : Rule()
        data class Device(val name: String) : Rule()
    }

    /** What a remapped key does. [json] is the original `to` object so the platform layer can read extra fields. */
    data class Output(val kind: String, val json: JsonObject)

    data class Mapping(val id: String, val combo: String, val to: Output, val repeat: String, val repeatMs: Long)

    data class Profile(val id: String, val name: String, val enabled: Boolean, val priority: Int, val rules: List<Rule>, val mappings: List<Mapping>)

    data class Context(val app: String? = null, val window: String? = null, val device: String? = null, val now: ZonedDateTime = ZonedDateTime.now())

    private val SUPPORTED_OUTPUTS = setOf("key", "text", "launch", "flow", "media", "disabled")

    private fun JsonObject.str(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.list(k: String): JsonArray = (this[k] as? JsonArray) ?: JsonArray(emptyList())
    private fun JsonObject.mods(): List<String> = list("modifiers").mapNotNull { (it as? JsonPrimitive)?.content }

    /** Parses `profiles_apply` input; returns the usable profiles and human-readable warnings for what Android cannot do. */
    fun parse(profiles: JsonElement): Pair<List<Profile>, List<String>> {
        val warnings = ArrayList<String>()
        val out = ArrayList<Profile>()
        for (p in (profiles as? JsonArray) ?: JsonArray(emptyList())) {
            val o = (p as? JsonObject) ?: continue
            val id = o.str("id") ?: continue
            val name = o.str("name") ?: id
            val rules = o.list("rules").mapNotNull { r ->
                val ro = r.jsonObject
                when (ro.str("kind")) {
                    "app" -> Rule.App(ro.str("app") ?: return@mapNotNull null, ro.str("window"))
                    "time" -> {
                        fun mins(s: String?) = s?.split(":")?.let { (it[0].toIntOrNull() ?: 0) * 60 + (it.getOrNull(1)?.toIntOrNull() ?: 0) } ?: 0
                        Rule.Time(mins(ro.str("from")), mins(ro.str("to")), ro["days"]?.jsonArray?.mapNotNull { it.jsonPrimitive.intOrNull } ?: (0..6).toList())
                    }
                    "device" -> Rule.Device(ro.str("name") ?: return@mapNotNull null)
                    else -> null
                }
            }
            val layers = o.list("layers")
            if (layers.size > 1) warnings.add("$name: only the first layer is used on Android (layers need a hardware hook)")
            val mappings = ArrayList<Mapping>()
            val base = layers.firstOrNull()?.jsonObject
            for (m in base?.list("mappings") ?: JsonArray(emptyList())) {
                val mo = m.jsonObject
                if ((mo["enabled"] as? JsonPrimitive)?.booleanOrNull == false) continue
                val mid = mo.str("id") ?: continue
                val from = mo["from"]?.jsonObject ?: continue
                val to = mo["to"]?.jsonObject ?: continue
                if (from.str("kind") != "key") {
                    warnings.add("$name/$mid: ${from.str("kind")} sources cannot be read on Android — only hardware keyboard keys")
                    continue
                }
                val kind = to.str("kind") ?: continue
                if (kind !in SUPPORTED_OUTPUTS) {
                    warnings.add("$name/$mid: \"$kind\" outputs are not available on Android")
                    continue
                }
                mappings.add(
                    Mapping(
                        mid, comboKey(from.str("key") ?: continue, from.mods()), Output(kind, to),
                        mo.str("repeat") ?: "none", ((mo["repeatMs"] as? JsonPrimitive)?.content?.toLongOrNull() ?: 100L).coerceIn(10, 60_000),
                    ),
                )
            }
            if (o.list("textExpansions").isNotEmpty()) warnings.add("$name: text expansion is not available on Android")
            out.add(
                Profile(
                    id, name, (o["enabled"] as? JsonPrimitive)?.booleanOrNull ?: true,
                    (o["priority"] as? JsonPrimitive)?.intOrNull ?: 10, rules, mappings,
                ),
            )
        }
        return out to warnings
    }

    private fun matches(r: Rule, ctx: Context): Boolean = when (r) {
        is Rule.App -> ctx.app != null && ctx.app.equals(r.app, ignoreCase = true) &&
            (r.window == null || (ctx.window ?: "").lowercase().contains(r.window.lowercase()))
        is Rule.Device -> ctx.device != null && ctx.device.lowercase().contains(r.name.lowercase())
        is Rule.Time -> {
            val day = ctx.now.dayOfWeek.value % 7
            val cur = ctx.now.hour * 60 + ctx.now.minute
            day in r.days && if (r.fromMin <= r.toMin) cur >= r.fromMin && cur < r.toMin else cur >= r.fromMin || cur < r.toMin
        }
    }

    /** Enabled, all rules match (no rules = fallback), highest priority wins, then the more specific one. */
    fun resolveActive(profiles: List<Profile>, ctx: Context): Profile? = profiles
        .filter { p -> p.enabled && (p.rules.isEmpty() || p.rules.all { matches(it, ctx) }) }
        .sortedWith(compareByDescending<Profile> { it.priority }.thenByDescending { it.rules.size })
        .firstOrNull()
}
