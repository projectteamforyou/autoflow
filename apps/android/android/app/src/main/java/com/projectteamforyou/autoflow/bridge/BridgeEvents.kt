package com.projectteamforyou.autoflow.bridge

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.concurrent.CopyOnWriteArraySet

/**
 * Process-wide fan-out of `BridgeEvent`s (packages/core/src/bridge.ts). The Capacitor plugin subscribes while the
 * WebView is alive and forwards each event to JS as the "autoflow://event" listener; native parts (run notification,
 * Halt overlay) subscribe too.
 */
object BridgeEvents {
    const val EVENT_NAME = "autoflow://event"

    private val listeners = CopyOnWriteArraySet<(JsonObject) -> Unit>()

    fun subscribe(listener: (JsonObject) -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    fun emit(event: JsonObject) {
        for (l in listeners) {
            try {
                l(event)
            } catch (_: Throwable) {
                /* one broken listener must not starve the others */
            }
        }
    }

    fun run(runId: String, event: JsonElement) = emit(buildJsonObject { put("kind", "run"); put("runId", runId); put("event", event) })
    fun runEnded(runId: String, result: JsonElement) = emit(buildJsonObject { put("kind", "runEnded"); put("runId", runId); put("result", result) })
    fun hotkey(action: String, flowId: String? = null) = emit(buildJsonObject { put("kind", "hotkey"); put("action", action); flowId?.let { put("flowId", it) } })
    fun permission(permission: String, granted: Boolean) = emit(buildJsonObject { put("kind", "permission"); put("permission", permission); put("granted", granted) })
    fun recording(event: JsonObject) = emit(buildJsonObject { put("kind", "recording"); put("event", event) })
    fun profileActivated(profileId: String?) = emit(buildJsonObject { put("kind", "profileActivated"); put("profileId", profileId?.let { kotlinx.serialization.json.JsonPrimitive(it) } ?: kotlinx.serialization.json.JsonNull) })
    fun pointPicked(x: Int, y: Int, screen: JsonObject) = emit(buildJsonObject { put("kind", "pointPicked"); put("x", x); put("y", y); put("screen", screen) })
}
