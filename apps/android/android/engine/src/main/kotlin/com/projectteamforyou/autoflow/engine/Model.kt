package com.projectteamforyou.autoflow.engine

import kotlinx.serialization.json.JsonObject

/*
 * Kotlin model of the AutoFlow schema v1 (packages/core/src/schema.ts). Every field carries the zod default already
 * applied by [FlowParser], so the executor never has to guess.
 */

const val SCHEMA_VERSION = "1.0"

enum class Platform(val json: String) { WINDOWS("windows"), ANDROID("android"), WEB("web") }

/* ------------------------------------------------------------------ targets */

sealed class Target {
    abstract val kind: String

    /** space: screen | window | normalized | display; [display] references a monitor (see Displays.kt). */
    data class Point(val x: Double, val y: Double, val space: String = "screen", val monitor: Int? = null, val display: DisplayRef? = null) : Target() {
        override val kind get() = "point"
    }

    object Current : Target() {
        override val kind get() = "current"
    }

    data class Region(
        val x: Double, val y: Double, val w: Double, val h: Double,
        val space: String = "screen", val pick: String = "center", val display: DisplayRef? = null,
    ) : Target() {
        override val kind get() = "region"
    }

    data class ElementSelector(
        val app: String? = null, val window: String? = null, val name: String? = null, val role: String? = null,
        val automationId: String? = null, val text: String? = null, val index: Int? = null,
    )

    data class Element(val selector: ElementSelector) : Target() {
        override val kind get() = "element"
    }

    data class Rect(val x: Double, val y: Double, val w: Double, val h: Double)

    data class Image(val ref: String, val confidence: Double = 0.9, val region: Rect? = null, val display: DisplayRef? = null) : Target() {
        override val kind get() = "image"
    }
}

/* ------------------------------------------------------------------- errors */

data class OnError(
    val strategy: String = "stop", // stop | continue | retry | goto
    val retries: Int = 0,
    val backoffMs: Long = 500,
    val gotoStepId: String? = null,
    /** fixed | linear | exponential; null = linear (the legacy behaviour). */
    val backoff: String? = null,
    val maxBackoffMs: Long? = null,
    /** 0..1: each delay is reduced by a random share of up to `jitter`. */
    val jitter: Double? = null,
)

/** Delay before retry [attempt] (1-based) — `retryDelayMs` in engine.ts. Draws a random number only when jitter > 0. */
fun retryDelayMs(policy: OnError, attempt: Int, random: () -> Double): Long {
    val base = policy.backoffMs
    var d = when (policy.backoff ?: "linear") {
        "fixed" -> base
        "exponential" -> base * (1L shl (attempt - 1).coerceIn(0, 32))
        else -> base * attempt
    }
    policy.maxBackoffMs?.let { d = minOf(d, it) }
    val j = policy.jitter ?: 0.0
    if (j > 0) d -= Math.floor(d.toDouble() * j * random()).toLong()
    return maxOf(0L, d)
}

/** mulberry32 — bit-identical to `mulberry32` in engine.ts and `Mulberry32` in the Rust engine. */
class Mulberry32(seed: Long) {
    private var a: Int = seed.toInt()

    fun next(): Double {
        a += 0x6D2B79F5
        var t = (a xor (a ushr 15)) * (1 or a)
        t = (t + (t xor (t ushr 7)) * (61 or t)) xor t
        return ((t xor (t ushr 14)).toLong() and 0xFFFFFFFFL).toDouble() / 4294967296.0
    }
}

/** Opt-in humanization of input actions (`humanize` in schema.ts). */
data class Humanize(val offsetPx: Int = 0, val delayMs: Long = 0, val seed: Long? = null)

/** Applies the humanize offset to pixel point targets (`humanizeTarget` in engine.ts). */
fun humanizeTarget(t: Target, offsetPx: Int, rnd: () -> Double): Target {
    if (offsetPx <= 0 || t !is Target.Point || t.space == "normalized") return t
    fun off(): Double = minOf(2.0 * offsetPx, Math.floor(rnd() * (2 * offsetPx + 1))) - offsetPx
    val dx = off()
    val dy = off()
    return t.copy(x = t.x + dx, y = t.y + dy)
}

/* -------------------------------------------------------------------- steps */

data class StepMeta(
    val id: String,
    val label: String? = null,
    val disabled: Boolean = false,
    val breakpoint: Boolean = false,
    val onError: OnError? = null,
    /** Per-attempt timeout (category timeout, subject to onError); apart from waitFor/findImage `timeoutMs`. */
    val stepTimeoutMs: Long? = null,
)

data class Hotkey(val key: String, val modifiers: List<String> = emptyList())

/** "Does the display region look like the remembered scene?" */
data class SceneCondition(val name: String, val minSimilarity: Double = 0.9, val not: Boolean = false)

/** "Does this pixel have that color?" (each RGB channel within [tolerance]). */
data class PixelCondition(val at: Target.Point, val color: String, val tolerance: Int = 24, val not: Boolean = false)

/** A condition holds when every present part holds, checked scene → pixel → expr. */
data class Condition(val expr: String = "true", val scene: SceneCondition? = null, val pixel: PixelCondition? = null) {
    val probesScreen: Boolean get() = scene != null || pixel != null
}

sealed class Step {
    abstract val meta: StepMeta
    abstract val type: String
    val id: String get() = meta.id

    data class Click(
        override val meta: StepMeta, val target: Target, val button: String = "left", val clicks: Int = 1,
        val holdMs: Long = 0, val modifiers: List<String> = emptyList(),
    ) : Step() { override val type get() = "click" }

    data class Move(override val meta: StepMeta, val target: Target, val durationMs: Long = 0) : Step() { override val type get() = "move" }

    data class Drag(override val meta: StepMeta, val from: Target, val to: Target, val durationMs: Long = 300, val button: String = "left") : Step() {
        override val type get() = "drag"
    }

    data class Scroll(override val meta: StepMeta, val dx: Int = 0, val dy: Int = 0, val target: Target? = null) : Step() { override val type get() = "scroll" }

    data class Key(
        override val meta: StepMeta, val key: String, val modifiers: List<String> = emptyList(),
        val action: String = "press", val repeat: Int = 1,
    ) : Step() { override val type get() = "key" }

    data class Type(override val meta: StepMeta, val text: String, val perCharDelayMs: Long = 0) : Step() { override val type get() = "type" }

    data class Wait(override val meta: StepMeta, val ms: Long, val jitterMs: Long = 0) : Step() { override val type get() = "wait" }

    data class WaitFor(override val meta: StepMeta, val condition: Condition, val pollMs: Long = 250, val timeoutMs: Long = 10_000) : Step() {
        override val type get() = "waitFor"
    }

    data class SetVar(override val meta: StepMeta, val name: String, val value: String) : Step() { override val type get() = "setVar" }

    data class Log(override val meta: StepMeta, val message: String, val level: String = "info") : Step() { override val type get() = "log" }

    data class Notify(override val meta: StepMeta, val title: String, val body: String = "") : Step() { override val type get() = "notify" }

    data class Confirm(override val meta: StepMeta, val message: String, val resultVar: String? = null) : Step() { override val type get() = "confirm" }

    data class Clipboard(override val meta: StepMeta, val op: String, val value: String? = null, val variable: String? = null) : Step() {
        override val type get() = "clipboard"
    }

    data class LaunchApp(override val meta: StepMeta, val app: String, val args: List<String> = emptyList()) : Step() { override val type get() = "launchApp" }

    data class OpenUrl(override val meta: StepMeta, val url: String) : Step() { override val type get() = "openUrl" }

    data class Window(
        override val meta: StepMeta, val op: String, val matchTitle: String? = null, val matchApp: String? = null,
        val rect: Target.Rect? = null,
    ) : Step() { override val type get() = "window" }

    data class AndroidGlobal(override val meta: StepMeta, val action: String) : Step() { override val type get() = "androidGlobal" }

    data class Http(
        override val meta: StepMeta, val method: String = "GET", val url: String, val headers: Map<String, String> = emptyMap(),
        val body: String? = null, val resultVar: String? = null,
    ) : Step() { override val type get() = "http" }

    data class File(
        override val meta: StepMeta, val op: String, val path: String, val dest: String? = null, val content: String? = null,
        val resultVar: String? = null,
    ) : Step() { override val type get() = "file" }

    data class Ocr(override val meta: StepMeta, val region: Target.Rect, val resultVar: String, val display: DisplayRef? = null) : Step() { override val type get() = "ocr" }

    data class FindImage(override val meta: StepMeta, val target: Target.Image, val resultVar: String, val timeoutMs: Long = 5000) : Step() {
        override val type get() = "findImage"
    }

    /** resultVar = true/false with [color], else the color as "#rrggbb". */
    data class PixelCheck(override val meta: StepMeta, val at: Target.Point, val color: String?, val tolerance: Int = 24, val resultVar: String) : Step() {
        override val type get() = "pixelCheck"
    }

    data class WaitForPixel(
        override val meta: StepMeta, val at: Target.Point, val color: String, val tolerance: Int = 24, val not: Boolean = false,
        val pollMs: Long = 250, val timeoutMs: Long? = null,
    ) : Step() { override val type get() = "waitForPixel" }

    data class MatchScene(
        override val meta: StepMeta, val scenes: List<String>?, val minSimilarity: Double = 0.9, val resultVar: String, val similarityVar: String? = null,
    ) : Step() { override val type get() = "matchScene" }

    data class RunFlow(override val meta: StepMeta, val flowId: String) : Step() { override val type get() = "runFlow" }
    data class SwitchProfile(override val meta: StepMeta, val profileId: String) : Step() { override val type get() = "switchProfile" }
    data class Stop(override val meta: StepMeta, val reason: String? = null) : Step() { override val type get() = "stop" }
    data class Break(override val meta: StepMeta) : Step() { override val type get() = "break" }
    data class Continue(override val meta: StepMeta) : Step() { override val type get() = "continue" }

    data class If(override val meta: StepMeta, val condition: Condition, val then: List<Step> = emptyList(), val otherwise: List<Step> = emptyList()) : Step() {
        override val type get() = "if"
    }

    data class Loop(
        override val meta: StepMeta, val mode: String, val count: Long? = null, val condition: Condition? = null,
        val indexVar: String? = null, val body: List<Step> = emptyList(), val cooldownMs: Long? = null,
    ) : Step() { override val type get() = "loop" }

    data class ForEach(override val meta: StepMeta, val list: String, val itemVar: String, val body: List<Step> = emptyList()) : Step() {
        override val type get() = "forEach"
    }

    data class Try(override val meta: StepMeta, val body: List<Step> = emptyList(), val catchSteps: List<Step> = emptyList(), val errorVar: String? = null) : Step() {
        override val type get() = "try"
    }

    data class Group(override val meta: StepMeta, val name: String, val collapsed: Boolean? = null, val body: List<Step> = emptyList()) : Step() {
        override val type get() = "group"
    }

    /** Child step lists, in the order schema.ts `childLists` returns them. */
    fun children(): List<List<Step>> = when (this) {
        is If -> listOf(then, otherwise)
        is Loop -> listOf(body)
        is ForEach -> listOf(body)
        is Group -> listOf(body)
        is Try -> listOf(body, catchSteps)
        else -> emptyList()
    }

    /** The step's own condition (if / waitFor / loop). */
    fun condition(): Condition? = when (this) {
        is If -> condition
        is WaitFor -> condition
        is Loop -> condition
        else -> null
    }

    /** Every target this step points at (used by capability and screen checks). */
    fun targets(): List<Target> = when (this) {
        is Click -> listOf(target)
        is Move -> listOf(target)
        is Drag -> listOf(from, to)
        is Scroll -> listOfNotNull(target)
        is FindImage -> listOf(target)
        else -> emptyList()
    }
}

val STEP_TYPES = listOf(
    "click", "move", "drag", "scroll", "key", "type", "wait", "waitFor", "setVar", "log", "notify", "confirm", "clipboard", "launchApp",
    "openUrl", "window", "androidGlobal", "http", "file", "ocr", "findImage", "pixelCheck", "waitForPixel", "matchScene", "runFlow",
    "switchProfile", "stop", "break", "continue", "if", "loop", "forEach", "try", "group",
)

/** Depth-first walk over every step, including nested ones. */
fun walkSteps(list: List<Step>, depth: Int = 0, parent: Step? = null, visit: (Step, Int, Step?) -> Unit) {
    for (s in list) {
        visit(s, depth, parent)
        for (child in s.children()) walkSteps(child, depth + 1, s, visit)
    }
}

fun countSteps(list: List<Step>): Int {
    var n = 0
    walkSteps(list) { _, _, _ -> n++ }
    return n
}

fun findStep(list: List<Step>, id: String): Step? {
    var found: Step? = null
    walkSteps(list) { s, _, _ -> if (found == null && s.id == id) found = s }
    return found
}

/* ----------------------------------------------------------------- triggers */

sealed class Trigger {
    abstract val type: String

    object Manual : Trigger() { override val type get() = "manual" }
    data class HotkeyTrigger(val hotkey: Hotkey, val scope: String = "global", val app: String? = null) : Trigger() { override val type get() = "hotkey" }
    data class Schedule(val cron: String? = null, val everyMs: Long? = null, val startAt: String? = null, val endAt: String? = null) : Trigger() {
        override val type get() = "schedule"
    }
    data class AppEvent(val event: String, val app: String) : Trigger() { override val type get() = "appEvent" }
    data class DeviceEvent(val event: String) : Trigger() { override val type get() = "deviceEvent" }
    data class Location(val lat: Double, val lng: Double, val radiusM: Double, val on: String) : Trigger() { override val type get() = "location" }
    data class Notification(val app: String, val contains: String? = null) : Trigger() { override val type get() = "notification" }
}

/* ------------------------------------------------------------------- limits */

data class Limits(
    val maxDurationMs: Long = 10 * 60_000L,
    val maxActions: Long = 100_000,
    val maxIterations: Long = 1_000_000,
    val countdownMs: Long = 3000,
    val preventOverlap: Boolean = true,
    val cooldownMs: Long = 0,
    /** Deterministic watchdog: maximum executed steps (attempts included); null = unlimited. */
    val maxSteps: Long? = null,
)

data class VariableDef(val name: String, val type: String = "string", val initial: Value? = null, val prompt: String? = null)

data class ScreenRef(val width: Int, val height: Int, val scale: Double = 1.0)

data class FlowHotkeys(val start: Hotkey? = null, val pause: Hotkey? = null, val stop: Hotkey = Hotkey("Escape", listOf("ctrl", "alt")))

data class Flow(
    val schemaVersion: String = SCHEMA_VERSION,
    val id: String,
    val name: String,
    val description: String = "",
    val tags: List<String> = emptyList(),
    val icon: String = "bolt",
    val color: String = "#7C5CFF",
    val targets: List<String> = listOf("windows", "android", "web"),
    val mode: String = "easy",
    val trigger: Trigger = Trigger.Manual,
    val hotkeys: FlowHotkeys = FlowHotkeys(),
    val limits: Limits = Limits(),
    val variables: List<VariableDef> = emptyList(),
    val steps: List<Step>,
    val humanize: Humanize? = null,
    /** Multi-monitor Stage mode. */
    val stage: Stage? = null,
    /** fail (default) | primary | ask. */
    val onMissingDisplay: String? = null,
    val scenes: List<Scene>? = null,
    val screen: ScreenRef? = null,
    val favorite: Boolean = false,
    val folder: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val revision: Long = 0,
    /** The JSON the flow was parsed from (kept so it can be persisted for triggers without re-encoding). */
    val source: JsonObject? = null,
)
