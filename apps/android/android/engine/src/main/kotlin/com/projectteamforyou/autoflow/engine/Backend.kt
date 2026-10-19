package com.projectteamforyou.autoflow.engine

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.selects.SelectClause1
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.yield

/** One platform action, the Kotlin mirror of `InputAction` in engine.ts. */
sealed class InputAction {
    abstract val type: String

    data class Click(val target: Target, val button: String, val clicks: Int, val holdMs: Long, val modifiers: List<String>) : InputAction() { override val type get() = "click" }
    data class Move(val target: Target, val durationMs: Long) : InputAction() { override val type get() = "move" }
    data class Drag(val from: Target, val to: Target, val durationMs: Long, val button: String) : InputAction() { override val type get() = "drag" }
    data class Scroll(val dx: Int, val dy: Int, val target: Target?) : InputAction() { override val type get() = "scroll" }
    data class Key(val key: String, val modifiers: List<String>, val action: String) : InputAction() { override val type get() = "key" }
    data class TypeText(val text: String, val perCharDelayMs: Long) : InputAction() { override val type get() = "type" }
    data class LaunchApp(val app: String, val args: List<String>) : InputAction() { override val type get() = "launchApp" }
    data class OpenUrl(val url: String) : InputAction() { override val type get() = "openUrl" }
    data class Window(val op: String, val title: String?, val app: String?, val rect: Target.Rect?) : InputAction() { override val type get() = "window" }
    data class AndroidGlobal(val action: String) : InputAction() { override val type get() = "androidGlobal" }
    data class ClipboardSet(val value: String) : InputAction() { override val type get() = "clipboardSet" }
    object ClipboardGet : InputAction() { override val type get() = "clipboardGet" }
    data class Notify(val title: String, val body: String) : InputAction() { override val type get() = "notify" }
    data class Http(val method: String, val url: String, val headers: Map<String, String>, val body: String?) : InputAction() { override val type get() = "http" }
    data class FileOp(val op: String, val path: String, val dest: String?, val content: String?) : InputAction() { override val type get() = "file" }
    data class Ocr(val region: Target.Rect) : InputAction() { override val type get() = "ocr" }
    /** [region] (virtual-desktop px) is set for display-scoped steps only. */
    data class FindImage(val ref: String, val confidence: Double, val timeoutMs: Long, val region: Target.Rect? = null) : InputAction() { override val type get() = "findImage" }
    data class SwitchProfile(val profileId: String) : InputAction() { override val type get() = "switchProfile" }
    /** Probe: color of one virtual-desktop pixel as "#rrggbb". */
    data class Pixel(val x: Double, val y: Double) : InputAction() { override val type get() = "pixel" }
    /** Probe: dHash (16 hex digits) of a virtual-desktop rectangle. */
    data class SceneHash(val region: Target.Rect) : InputAction() { override val type get() = "sceneHash" }
}

/**
 * Error raised by a backend. [category] maps onto the run error categories; [fatal] errors (e.g. a protected
 * system screen came to the front) end the run immediately and are never swallowed by retry/continue/try.
 */
open class BackendException(message: String, val category: ErrorCategory = ErrorCategory.ACTION, val fatal: Boolean = false) : Exception(message)

/**
 * A platform executor (Android accessibility, test fake…). Implementations must be cancellation-cooperative: when a
 * run is stopped, the coroutine running [perform] is cancelled and the run does not wait for it.
 */
interface Backend {
    val platform: Platform

    /** Performs one action; may return a value for get-style actions (clipboard, http, file…). */
    suspend fun perform(action: InputAction): Value?

    /** Asks the user a yes/no question (confirm step). */
    suspend fun confirm(message: String): Boolean

    suspend fun screen(): ScreenInfo? = null

    /** Connected monitors, any order (default: the screen as the only, primary display). */
    suspend fun displays(): List<DisplayInfo> {
        val s = screen() ?: return emptyList()
        return listOf(DisplayInfo("primary", "Built-in display", true, Target.Rect(0.0, 0.0, s.width.toDouble(), s.height.toDouble()), scale = s.scale))
    }

    /** Pointer position for Stage takeover detection (touch screens have none). */
    suspend fun pointerPosition(): Pair<Double, Double>? = null
}

/** One-shot abort flag that suspending code can race against (the Kotlin counterpart of AbortSignal). */
class AbortSignal {
    private val deferred = CompletableDeferred<Unit>()
    val aborted: Boolean get() = deferred.isCompleted
    fun abort() {
        deferred.complete(Unit)
    }
    suspend fun await() = deferred.await()
    val onAbort: SelectClause1<Unit> get() = deferred.onAwait
}

/** Thrown inside a run when it was stopped. */
object StopSignal : Exception("stopped", null, false, false) {
    private fun readResolve(): Any = StopSignal
}

interface Clock {
    fun now(): Long

    /** Sleeps [ms]; throws [StopSignal] as soon as [signal] aborts. */
    suspend fun sleep(ms: Long, signal: AbortSignal)
}

object RealClock : Clock {
    override fun now(): Long = System.currentTimeMillis()

    override suspend fun sleep(ms: Long, signal: AbortSignal) {
        if (signal.aborted) throw StopSignal
        if (ms <= 0) return
        val aborted = withTimeoutOrNull(ms) { signal.await() } != null
        if (aborted) throw StopSignal
    }
}

/** Virtual clock for tests, previews and simulations: sleeping advances time instantly. */
class VirtualClock(start: Long = 0) : Clock {
    @Volatile private var t = start
    override fun now(): Long = t
    fun advance(ms: Long) {
        t += ms
    }

    override suspend fun sleep(ms: Long, signal: AbortSignal) {
        if (signal.aborted) throw StopSignal
        t += ms
        yield()
        if (signal.aborted) throw StopSignal
    }
}
