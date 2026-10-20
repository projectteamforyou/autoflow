package com.projectteamforyou.autoflow.engine

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/*
 * Run events and results with exactly the JSON shape of `RunEvent` / `RunResult` in packages/core/src/engine.ts, so
 * the web UI renders native runs with the same code as sandbox runs.
 */

enum class RunState(val json: String) {
    IDLE("idle"), PREFLIGHT("preflight"), COUNTDOWN("countdown"), RUNNING("running"), PAUSED("paused"),
    STOPPED("stopped"), COMPLETED("completed"), FAILED("failed");

    val terminal: Boolean get() = this == STOPPED || this == COMPLETED || this == FAILED
}

enum class ErrorCategory(val json: String) {
    VALIDATION("validation"), UNSUPPORTED("unsupported"), PERMISSION("permission"), ENVIRONMENT("environment"), TARGET("target"),
    LIMIT("limit"), EXPRESSION("expression"), ACTION("action"), USER("user"), INTERNAL("internal"), TIMEOUT("timeout"), DISPLAY("display");

    companion object {
        fun of(s: String?): ErrorCategory? = entries.firstOrNull { it.json == s }
    }
}

data class RunError(val stepId: String? = null, val path: String? = null, val message: String, val category: ErrorCategory) {
    fun toJson(): JsonObject = buildJsonObject {
        stepId?.let { put("stepId", it) }
        path?.let { put("path", it) }
        put("message", message)
        put("category", category.json)
    }
}

sealed class RunEvent {
    abstract val at: Long
    abstract fun toJson(): JsonObject

    data class State(val state: RunState, override val at: Long) : RunEvent() {
        override fun toJson() = buildJsonObject { put("type", "state"); put("state", state.json); put("at", at) }
    }

    data class Countdown(val remainingMs: Long, override val at: Long) : RunEvent() {
        override fun toJson() = buildJsonObject { put("type", "countdown"); put("remainingMs", remainingMs); put("at", at) }
    }

    data class StepStart(val stepId: String, val stepType: String, val path: String, override val at: Long) : RunEvent() {
        override fun toJson() = buildJsonObject { put("type", "stepStart"); put("stepId", stepId); put("stepType", stepType); put("path", path); put("at", at) }
    }

    data class StepEnd(
        val stepId: String, val ok: Boolean, val durationMs: Long, override val at: Long,
        val attempts: Int? = null, val error: RunError? = null,
    ) : RunEvent() {
        override fun toJson() = buildJsonObject {
            put("type", "stepEnd"); put("stepId", stepId); put("ok", ok); put("durationMs", durationMs); put("at", at)
            attempts?.let { put("attempts", it) }
            error?.let { put("error", it.toJson()) }
        }
    }

    data class Breakpoint(val stepId: String, override val at: Long) : RunEvent() {
        override fun toJson() = buildJsonObject { put("type", "breakpoint"); put("stepId", stepId); put("at", at) }
    }

    data class Log(val level: String, val message: String, val stepId: String?, override val at: Long) : RunEvent() {
        override fun toJson() = buildJsonObject {
            put("type", "log"); put("level", level); put("message", message); stepId?.let { put("stepId", it) }; put("at", at)
        }
    }

    data class Var(val name: String, val value: Value, override val at: Long) : RunEvent() {
        override fun toJson() = buildJsonObject { put("type", "var"); put("name", name); put("value", value.toJson()); put("at", at) }
    }

    data class Retry(val stepId: String, val attempt: Int, override val at: Long, val delayMs: Long? = null, val error: String? = null) : RunEvent() {
        override fun toJson() = buildJsonObject {
            put("type", "retry"); put("stepId", stepId); put("attempt", attempt); put("at", at)
            delayMs?.let { put("delayMs", it) }
            error?.let { put("error", it) }
        }
    }

    data class Timeout(val stepId: String, val timeoutMs: Long, override val at: Long) : RunEvent() {
        override fun toJson() = buildJsonObject { put("type", "timeout"); put("stepId", stepId); put("timeoutMs", timeoutMs); put("at", at) }
    }

    data class Error(val error: RunError, override val at: Long) : RunEvent() {
        override fun toJson() = buildJsonObject { put("type", "error"); put("error", error.toJson()); put("at", at) }
    }
}

enum class RunStatus(val json: String) { COMPLETED("completed"), STOPPED("stopped"), FAILED("failed") }

data class RunResult(
    val status: RunStatus,
    val reason: String? = null,
    val error: RunError? = null,
    val actions: Long,
    val iterations: Long,
    val durationMs: Long,
    val vars: Map<String, Value>,
    val startedAt: Long,
    val endedAt: Long,
    /** Executed steps (attempts included), bounded by limits.maxSteps. */
    val steps: Long = 0,
) {
    fun toJson(): JsonObject = buildJsonObject {
        put("status", status.json)
        reason?.let { put("reason", it) }
        error?.let { put("error", it.toJson()) }
        put("actions", actions)
        put("iterations", iterations)
        put("steps", steps)
        put("durationMs", durationMs)
        put("vars", JsonObject(vars.mapValues { (_, v) -> v.toJson() }))
        put("startedAt", startedAt)
        put("endedAt", endedAt)
    }
}

data class ScreenInfo(val width: Int, val height: Int, val scale: Double) {
    fun toJson(): JsonObject = buildJsonObject {
        put("width", width); put("height", height); put("scale", JsonPrimitive(scale) as JsonElement)
    }
}
