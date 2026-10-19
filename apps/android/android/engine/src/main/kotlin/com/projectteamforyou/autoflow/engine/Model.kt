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

    data class Point(val x: Double, val y: Double, val space: String = "screen", val monitor: Int? = null) : Target() {
        override val kind get() = "point"
    }

    object Current : Target() {
        override val kind get() = "current"
    }

    data class Region(
        val x: Double, val y: Double, val w: Double, val h: Double,
        val space: String = "screen", val pick: String = "center",
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

    data class Image(val ref: String, val confidence: Double = 0.9, val region: Rect? = null) : Target() {
        override val kind get() = "image"
    }
}

/* ------------------------------------------------------------------- errors */

data class OnError(
    val strategy: String = "stop", // stop | continue | retry | goto
    val retries: Int = 0,
    val backoffMs: Long = 500,
    val gotoStepId: String? = null,
)

/* -------------------------------------------------------------------- steps */

data class StepMeta(
    val id: String,
    val label: String? = null,
    val disabled: Boolean = false,
    val breakpoint: Boolean = false,
    val onError: OnError? = null,
)

data class Hotkey(val key: String, val modifiers: List<String> = emptyList())

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

    data class WaitFor(override val meta: StepMeta, val condition: String, val pollMs: Long = 250, val timeoutMs: Long = 10_000) : Step() {
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

    data class Ocr(override val meta: StepMeta, val region: Target.Rect, val resultVar: String) : Step() { override val type get() = "ocr" }

    data class FindImage(override val meta: StepMeta, val target: Target.Image, val resultVar: String, val timeoutMs: Long = 5000) : Step() {
        override val type get() = "findImage"
    }

    data class RunFlow(override val meta: StepMeta, val flowId: String) : Step() { override val type get() = "runFlow" }
    data class SwitchProfile(override val meta: StepMeta, val profileId: String) : Step() { override val type get() = "switchProfile" }
    data class Stop(override val meta: StepMeta, val reason: String? = null) : Step() { override val type get() = "stop" }
    data class Break(override val meta: StepMeta) : Step() { override val type get() = "break" }
    data class Continue(override val meta: StepMeta) : Step() { override val type get() = "continue" }

    data class If(override val meta: StepMeta, val condition: String, val then: List<Step> = emptyList(), val otherwise: List<Step> = emptyList()) : Step() {
        override val type get() = "if"
    }

    data class Loop(
        override val meta: StepMeta, val mode: String, val count: Long? = null, val condition: String? = null,
        val indexVar: String? = null, val body: List<Step> = emptyList(),
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
    "openUrl", "window", "androidGlobal", "http", "file", "ocr", "findImage", "runFlow", "switchProfile", "stop", "break", "continue",
    "if", "loop", "forEach", "try", "group",
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
    val screen: ScreenRef? = null,
    val favorite: Boolean = false,
    val folder: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val revision: Long = 0,
    /** The JSON the flow was parsed from (kept so it can be persisted for triggers without re-encoding). */
    val source: JsonObject? = null,
)
