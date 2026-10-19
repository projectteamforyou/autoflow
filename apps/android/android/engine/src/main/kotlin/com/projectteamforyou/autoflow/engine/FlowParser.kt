package com.projectteamforyou.autoflow.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.net.URI

data class ValidationIssue(val path: String, val message: String)

class FlowParseException(val issues: List<ValidationIssue>) :
    IllegalArgumentException(issues.take(5).joinToString("; ") { "${it.path.ifEmpty { "flow" }}: ${it.message}" })

/**
 * Validates and decodes a Flow document with the same rules and defaults as the zod schema in
 * packages/core/src/schema.ts (`parseFlow`). Unknown keys are ignored, like zod's default object parsing.
 */
object FlowParser {
    val json = Json { ignoreUnknownKeys = true; isLenient = false }

    fun parse(text: String): Flow = parse(json.parseToJsonElement(text))

    fun parse(element: JsonElement): Flow {
        val issues = ArrayList<ValidationIssue>()
        val obj = element as? JsonObject ?: throw FlowParseException(listOf(ValidationIssue("", "expected object")))
        val flow = Reader(obj, "", issues).flow()
        if (issues.isNotEmpty() || flow == null) throw FlowParseException(issues.ifEmpty { listOf(ValidationIssue("", "invalid flow")) })
        val dup = duplicateIds(flow.steps)
        if (dup.isNotEmpty()) throw FlowParseException(dup.map { ValidationIssue("steps", "duplicate step id \"$it\"") })
        return flow
    }

    /** Non-throwing variant mirroring `parseFlow` → `{ ok, flow } | { ok: false, issues }`. */
    fun tryParse(element: JsonElement): Result<Flow> = runCatching { parse(element) }

    fun duplicateIds(steps: List<Step>): List<String> {
        val seen = HashSet<String>()
        val dup = LinkedHashSet<String>()
        walkSteps(steps) { s, _, _ -> if (!seen.add(s.id)) dup.add(s.id) }
        return dup.toList()
    }
}

private val ID_RE = Regex("^[A-Za-z0-9_-]+$")
private val VAR_RE = Regex("^[A-Za-z_][A-Za-z0-9_]*$")
private val COLOR_RE = Regex("^#[0-9a-fA-F]{6}$")
private val DATETIME_RE = Regex("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$")
private const val MS_MAX = 86_400_000L

private class Reader(val o: JsonObject, val path: String, val issues: MutableList<ValidationIssue>) {
    fun p(key: String) = if (path.isEmpty()) key else "$path.$key"
    fun fail(key: String, msg: String) {
        issues.add(ValidationIssue(p(key), msg))
    }

    fun has(key: String) = o[key] != null && o[key] !is JsonNull

    fun child(key: String): Reader? {
        val e = o[key] ?: return null
        if (e !is JsonObject) {
            fail(key, "expected object")
            return null
        }
        return Reader(e, p(key), issues)
    }

    fun str(key: String, required: Boolean = true, min: Int = 0, max: Int = Int.MAX_VALUE, re: Regex? = null, reMsg: String = "invalid"): String? {
        val e = o[key]
        if (e == null || e is JsonNull) {
            if (required) fail(key, "Required")
            return null
        }
        if (e !is JsonPrimitive || !e.isString) {
            fail(key, "Expected string")
            return null
        }
        val s = e.content
        if (s.length < min) fail(key, "String must contain at least $min character(s)")
        if (s.length > max) fail(key, "String must contain at most $max character(s)")
        if (re != null && !re.matches(s)) fail(key, reMsg)
        return s
    }

    fun id(key: String, required: Boolean = true) = str(key, required, 1, 64, ID_RE, "id must be [A-Za-z0-9_-]")
    fun varName(key: String, required: Boolean = true) = str(key, required, 1, 48, VAR_RE, "invalid variable name")
    fun expr(key: String, required: Boolean = true) = str(key, required, 0, 2000)

    fun num(key: String, required: Boolean = true, min: Double = Double.NEGATIVE_INFINITY, max: Double = Double.POSITIVE_INFINITY, int: Boolean = false, positive: Boolean = false): Double? {
        val e = o[key]
        if (e == null || e is JsonNull) {
            if (required) fail(key, "Required")
            return null
        }
        val d = (e as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull
        if (d == null || !d.isFinite()) {
            fail(key, "Expected number")
            return null
        }
        if (int && d != Math.floor(d)) fail(key, "Expected integer, received float")
        if (d < min) fail(key, "Number must be greater than or equal to ${jsNumberToString(min)}")
        if (d > max) fail(key, "Number must be less than or equal to ${jsNumberToString(max)}")
        if (positive && d <= 0) fail(key, "Number must be greater than 0")
        return d
    }

    fun long(key: String, default: Long?, min: Long = Long.MIN_VALUE, max: Long = Long.MAX_VALUE): Long? =
        num(key, required = default == null, min = min.toDouble(), max = max.toDouble(), int = true)?.toLong() ?: default

    fun int(key: String, default: Int?, min: Int = Int.MIN_VALUE, max: Int = Int.MAX_VALUE): Int? =
        num(key, required = default == null, min = min.toDouble(), max = max.toDouble(), int = true)?.toInt() ?: default

    fun ms(key: String, default: Long?) = long(key, default, 0, MS_MAX)

    fun bool(key: String, default: Boolean?): Boolean? {
        val e = o[key]
        if (e == null || e is JsonNull) {
            if (default == null) fail(key, "Required")
            return default
        }
        val b = (e as? JsonPrimitive)?.takeIf { !it.isString }?.booleanOrNull
        if (b == null) fail(key, "Expected boolean")
        return b ?: default
    }

    fun enum(key: String, values: List<String>, default: String?): String? {
        val e = o[key]
        if (e == null || e is JsonNull) {
            if (default == null) fail(key, "Required")
            return default
        }
        val s = (e as? JsonPrimitive)?.takeIf { it.isString }?.content
        if (s == null || s !in values) {
            fail(key, "Invalid enum value. Expected ${values.joinToString(" | ") { "'$it'" }}")
            return default
        }
        return s
    }

    fun literal(key: String, value: String): String? {
        val s = str(key) ?: return null
        if (s != value) fail(key, "Invalid literal value, expected \"$value\"")
        return s
    }

    fun array(key: String, max: Int = Int.MAX_VALUE, min: Int = 0, required: Boolean = false): JsonArray? {
        val e = o[key]
        if (e == null || e is JsonNull) {
            if (required) fail(key, "Required")
            return null
        }
        if (e !is JsonArray) {
            fail(key, "Expected array")
            return null
        }
        if (e.size > max) fail(key, "Array must contain at most $max element(s)")
        if (e.size < min) fail(key, "Array must contain at least $min element(s)")
        return e
    }

    fun stringList(key: String, max: Int, itemMax: Int, allowed: List<String>? = null): List<String>? {
        val a = array(key, max) ?: return null
        return a.mapIndexedNotNull { i, e ->
            val s = (e as? JsonPrimitive)?.takeIf { it.isString }?.content
            when {
                s == null -> { fail("$key.$i", "Expected string"); null }
                s.length > itemMax -> { fail("$key.$i", "String must contain at most $itemMax character(s)"); null }
                allowed != null && s !in allowed -> { fail("$key.$i", "Invalid enum value"); null }
                else -> s
            }
        }
    }

    fun url(key: String): String? {
        val s = str(key, max = 2048) ?: return null
        val ok = runCatching { URI(s) }.getOrNull()?.let { it.scheme != null && (it.scheme !in listOf("http", "https") || !it.host.isNullOrEmpty()) } ?: false
        if (!ok) fail(key, "Invalid url")
        return s
    }

    fun datetime(key: String, required: Boolean): String? = str(key, required, re = DATETIME_RE, reMsg = "Invalid datetime")

    /* -------------------------------------------------------------- shapes */

    fun rect(key: String, required: Boolean = true): Target.Rect? {
        val r = child(key) ?: run { if (required && !has(key)) fail(key, "Required"); return null }
        val x = r.num("x"); val y = r.num("y"); val w = r.num("w"); val h = r.num("h")
        return if (x != null && y != null && w != null && h != null) Target.Rect(x, y, w, h) else null
    }

    fun hotkey(key: String, required: Boolean = true): Hotkey? {
        val r = child(key) ?: run { if (required && !has(key)) fail(key, "Required"); return null }
        val k = r.str("key", min = 1, max = 32) ?: return null
        return Hotkey(k, r.stringList("modifiers", 4, 10, MODIFIERS) ?: emptyList())
    }

    fun target(key: String, required: Boolean = true): Target? {
        val r = child(key) ?: run { if (required && !has(key)) fail(key, "Required"); return null }
        return r.targetBody()
    }

    fun targetBody(): Target? {
        val spaces = listOf("screen", "window", "normalized")
        return when (enum("kind", listOf("point", "current", "region", "element", "image"), null)) {
            "point" -> {
                val x = num("x"); val y = num("y")
                val space = enum("space", spaces, "screen")!!
                val monitor = int("monitor", -1, 0, 16)?.takeIf { it >= 0 }
                if (x != null && y != null) Target.Point(x, y, space, monitor) else null
            }
            "current" -> Target.Current
            "region" -> {
                val x = num("x"); val y = num("y"); val w = num("w", positive = true); val h = num("h", positive = true)
                val space = enum("space", spaces, "screen")!!
                val pick = enum("pick", listOf("center", "random"), "center")!!
                if (x != null && y != null && w != null && h != null) Target.Region(x, y, w, h, space, pick) else null
            }
            "element" -> {
                val s = child("selector") ?: run { fail("selector", "Required"); return null }
                Target.Element(
                    Target.ElementSelector(
                        app = s.str("app", false, max = 260), window = s.str("window", false, max = 260), name = s.str("name", false, max = 260),
                        role = s.str("role", false, max = 64), automationId = s.str("automationId", false, max = 260),
                        text = s.str("text", false, max = 260), index = s.int("index", -1, 0, 999)?.takeIf { it >= 0 },
                    ),
                )
            }
            "image" -> imageBody()
            else -> null
        }
    }

    fun imageBody(): Target.Image? {
        val ref = str("ref", max = 200) ?: return null
        val conf = num("confidence", required = false, min = 0.5, max = 1.0) ?: 0.9
        val region = if (has("region")) rect("region") else null
        return Target.Image(ref, conf, region)
    }

    fun onError(): OnError? {
        val r = child("onError") ?: return null
        return OnError(
            strategy = r.enum("strategy", listOf("stop", "continue", "retry", "goto"), "stop")!!,
            retries = r.int("retries", 0, 0, 10)!!,
            backoffMs = r.ms("backoffMs", 500)!!,
            gotoStepId = r.id("gotoStepId", required = false),
        )
    }

    fun steps(key: String, required: Boolean): List<Step>? {
        val a = array(key, max = 2000, required = required) ?: return if (required) null else emptyList()
        return a.mapIndexedNotNull { i, e ->
            if (e !is JsonObject) {
                fail("$key.$i", "Expected object")
                null
            } else {
                Reader(e, p("$key.$i"), issues).step()
            }
        }
    }

    fun step(): Step? {
        val type = str("type") ?: return null
        if (type !in STEP_TYPES) {
            fail("type", "Invalid discriminator value. Expected ${STEP_TYPES.joinToString(" | ") { "'$it'" }}")
            return null
        }
        val stepId = id("id") ?: return null
        val meta = StepMeta(
            id = stepId,
            label = str("label", false, max = 120),
            disabled = bool("disabled", false)!!,
            breakpoint = bool("breakpoint", false)!!,
            onError = onError(),
        )
        return when (type) {
            "click" -> Step.Click(
                meta, target("target") ?: return null, enum("button", BUTTONS, "left")!!, int("clicks", 1, 1, 3)!!,
                ms("holdMs", 0)!!, stringList("modifiers", 4, 10, MODIFIERS) ?: emptyList(),
            )
            "move" -> Step.Move(meta, target("target") ?: return null, ms("durationMs", 0)!!)
            "drag" -> {
                val from = target("from"); val to = target("to")
                if (from == null || to == null) return null
                Step.Drag(meta, from, to, ms("durationMs", 300)!!, enum("button", BUTTONS, "left")!!)
            }
            "scroll" -> Step.Scroll(meta, int("dx", 0, -10000, 10000)!!, int("dy", 0, -10000, 10000)!!, if (has("target")) target("target") else null)
            "key" -> Step.Key(
                meta, str("key", min = 1, max = 32) ?: return null, stringList("modifiers", 4, 10, MODIFIERS) ?: emptyList(),
                enum("action", listOf("press", "down", "up"), "press")!!, int("repeat", 1, 1, 1000)!!,
            )
            "type" -> Step.Type(meta, str("text", max = 10000) ?: return null, ms("perCharDelayMs", 0)!!)
            "wait" -> Step.Wait(meta, ms("ms", null) ?: return null, ms("jitterMs", 0)!!)
            "waitFor" -> Step.WaitFor(meta, condition() ?: return null, long("pollMs", 250, 50, 60_000)!!, ms("timeoutMs", 10_000)!!)
            "setVar" -> Step.SetVar(meta, varName("name") ?: return null, expr("value") ?: return null)
            "log" -> Step.Log(meta, str("message", max = 2000) ?: return null, enum("level", listOf("info", "warn", "error"), "info")!!)
            "notify" -> Step.Notify(meta, str("title", max = 120) ?: return null, str("body", false, max = 1000) ?: "")
            "confirm" -> Step.Confirm(meta, str("message", max = 500) ?: return null, varName("resultVar", false))
            "clipboard" -> Step.Clipboard(meta, enum("op", listOf("set", "get"), null) ?: return null, str("value", false, max = 10000), varName("var", false))
            "launchApp" -> Step.LaunchApp(meta, str("app", min = 1, max = 260) ?: return null, stringList("args", 16, 260) ?: emptyList())
            "openUrl" -> Step.OpenUrl(meta, url("url") ?: return null)
            "window" -> {
                val op = enum("op", listOf("focus", "minimize", "maximize", "restore", "close", "move", "resize"), null) ?: return null
                val m = child("match") ?: run { fail("match", "Required"); return null }
                Step.Window(meta, op, m.str("title", false, max = 260), m.str("app", false, max = 260), if (has("rect")) rect("rect") else null)
            }
            "androidGlobal" -> Step.AndroidGlobal(
                meta, enum("action", listOf("back", "home", "recents", "notifications", "quickSettings", "lockScreen", "screenshot", "powerDialog"), null) ?: return null,
            )
            "http" -> {
                val headers = LinkedHashMap<String, String>()
                child("headers")?.let { h -> h.o.keys.forEach { k -> h.str(k, max = 2000)?.let { headers[k] = it } } }
                Step.Http(
                    meta, enum("method", listOf("GET", "POST", "PUT", "PATCH", "DELETE"), "GET")!!, url("url") ?: return null, headers,
                    str("body", false, max = 100_000), varName("resultVar", false),
                )
            }
            "file" -> Step.File(
                meta, enum("op", listOf("read", "write", "append", "copy", "move", "delete", "exists"), null) ?: return null,
                str("path", max = 1024) ?: return null, str("dest", false, max = 1024), str("content", false, max = 1_000_000), varName("resultVar", false),
            )
            "ocr" -> Step.Ocr(meta, rect("region") ?: return null, varName("resultVar") ?: return null)
            "findImage" -> {
                val t = child("target") ?: run { fail("target", "Required"); return null }
                if (t.enum("kind", listOf("image"), null) == null) return null
                Step.FindImage(meta, t.imageBody() ?: return null, varName("resultVar") ?: return null, ms("timeoutMs", 5000)!!)
            }
            "runFlow" -> Step.RunFlow(meta, id("flowId") ?: return null)
            "switchProfile" -> Step.SwitchProfile(meta, id("profileId") ?: return null)
            "stop" -> Step.Stop(meta, str("reason", false, max = 200))
            "break" -> Step.Break(meta)
            "continue" -> Step.Continue(meta)
            "if" -> Step.If(meta, condition() ?: return null, steps("then", false) ?: emptyList(), steps("else", false) ?: emptyList())
            "loop" -> {
                val mode = enum("mode", listOf("count", "while", "forever"), null) ?: return null
                val count = if (has("count")) long("count", null, 1, 10_000_000) else null
                val cond = if (has("condition")) condition() else null
                if (mode == "count" && count == null) fail("", "loop.count required for mode=count")
                if (mode == "while" && cond == null) fail("", "loop.condition required for mode=while")
                Step.Loop(meta, mode, count, cond, varName("indexVar", false), steps("body", false) ?: emptyList())
            }
            "forEach" -> Step.ForEach(meta, expr("list") ?: return null, varName("itemVar") ?: return null, steps("body", false) ?: emptyList())
            "try" -> Step.Try(meta, steps("body", false) ?: emptyList(), steps("catch", false) ?: emptyList(), varName("errorVar", false))
            "group" -> Step.Group(meta, str("name", max = 120) ?: return null, if (has("collapsed")) bool("collapsed", false) else null, steps("body", false) ?: emptyList())
            else -> null
        }
    }

    fun condition(): String? {
        val c = child("condition") ?: run { fail("condition", "Required"); return null }
        return c.expr("expr")
    }

    fun trigger(): Trigger {
        val r = child("trigger") ?: return Trigger.Manual
        return when (r.enum("type", listOf("manual", "hotkey", "schedule", "appEvent", "deviceEvent", "location", "notification"), null)) {
            "hotkey" -> Trigger.HotkeyTrigger(r.hotkey("hotkey") ?: Hotkey("?"), r.enum("scope", listOf("global", "app"), "global")!!, r.str("app", false, max = 260))
            "schedule" -> Trigger.Schedule(
                r.str("cron", false, max = 120), r.long("everyMs", -1, 60_000)?.takeIf { it >= 0 },
                r.datetime("startAt", false), r.datetime("endAt", false),
            )
            "appEvent" -> Trigger.AppEvent(r.enum("event", listOf("launched", "closed", "focused"), null) ?: "launched", r.str("app", max = 260) ?: "")
            "deviceEvent" -> Trigger.DeviceEvent(r.enum("event", DEVICE_EVENTS, null) ?: "charging")
            "location" -> Trigger.Location(
                r.num("lat", min = -90.0, max = 90.0) ?: 0.0, r.num("lng", min = -180.0, max = 180.0) ?: 0.0,
                r.num("radiusM", min = 50.0, max = 50_000.0) ?: 50.0, r.enum("on", listOf("enter", "exit"), null) ?: "enter",
            )
            "notification" -> Trigger.Notification(r.str("app", max = 260) ?: "", r.str("contains", false, max = 200))
            else -> Trigger.Manual
        }
    }

    fun limits(): Limits {
        val r = child("limits") ?: return Limits()
        val d = Limits()
        return Limits(
            maxDurationMs = r.long("maxDurationMs", d.maxDurationMs, 1000, 7 * MS_MAX)!!,
            maxActions = r.long("maxActions", d.maxActions, 1, 100_000_000)!!,
            maxIterations = r.long("maxIterations", d.maxIterations, 1, 100_000_000)!!,
            countdownMs = r.long("countdownMs", d.countdownMs, 0, 60_000)!!,
            preventOverlap = r.bool("preventOverlap", d.preventOverlap)!!,
            cooldownMs = r.ms("cooldownMs", d.cooldownMs)!!,
        )
    }

    fun variables(): List<VariableDef> {
        val a = array("variables", max = 200) ?: return emptyList()
        return a.mapIndexedNotNull { i, e ->
            val r = (e as? JsonObject)?.let { Reader(it, p("variables.$i"), issues) } ?: run { fail("variables.$i", "Expected object"); return@mapIndexedNotNull null }
            val name = r.varName("name") ?: return@mapIndexedNotNull null
            val initial = r.o["initial"]?.takeIf { it !is JsonNull }?.let { Value.fromJson(it) }
            VariableDef(name, r.enum("type", listOf("string", "number", "boolean", "list"), "string")!!, initial, r.str("prompt", false, max = 200))
        }
    }

    fun flow(): Flow? {
        literal("schemaVersion", SCHEMA_VERSION)
        val flowId = id("id")
        val name = str("name", min = 1, max = 120)
        val steps = steps("steps", true)
        val createdAt = datetime("createdAt", true)
        val updatedAt = datetime("updatedAt", true)
        val hk = child("hotkeys")
        val hotkeys = if (hk == null) FlowHotkeys() else FlowHotkeys(
            start = if (hk.has("start")) hk.hotkey("start") else null,
            pause = if (hk.has("pause")) hk.hotkey("pause") else null,
            stop = if (hk.has("stop")) hk.hotkey("stop") ?: FlowHotkeys().stop else FlowHotkeys().stop,
        )
        val screen = child("screen")?.let { s ->
            val w = s.num("width", int = true, positive = true)
            val h = s.num("height", int = true, positive = true)
            val sc = s.num("scale", required = false, positive = true) ?: 1.0
            if (w != null && h != null) ScreenRef(w.toInt(), h.toInt(), sc) else null
        }
        val flow = Flow(
            id = flowId ?: "",
            name = name ?: "",
            description = str("description", false, max = 4000) ?: "",
            tags = stringList("tags", 20, 32) ?: emptyList(),
            icon = str("icon", false, max = 32) ?: "bolt",
            color = str("color", false, re = COLOR_RE) ?: "#7C5CFF",
            targets = (if (has("targets")) array("targets", min = 1)?.let { stringList("targets", 3, 10, Platform.entries.map { it.json }) } else null)
                ?: listOf("windows", "android", "web"),
            mode = enum("mode", listOf("easy", "pro"), "easy")!!,
            trigger = trigger(),
            hotkeys = hotkeys,
            limits = limits(),
            variables = variables(),
            steps = steps ?: emptyList(),
            screen = screen,
            favorite = bool("favorite", false)!!,
            folder = str("folder", false, max = 120),
            createdAt = createdAt ?: "",
            updatedAt = updatedAt ?: "",
            revision = long("revision", 0, 0)!!,
            source = o,
        )
        return if (flowId == null || name == null || steps == null || createdAt == null || updatedAt == null) null else flow
    }

    companion object {
        val BUTTONS = listOf("left", "right", "middle", "x1", "x2")
        val MODIFIERS = listOf("ctrl", "alt", "shift", "meta")
        val DEVICE_EVENTS = listOf(
            "charging", "batteryLow", "wifiConnected", "wifiDisconnected", "bluetoothConnected", "headsetPlugged", "bootCompleted",
            "deviceConnected", "deviceDisconnected",
        )
    }
}
