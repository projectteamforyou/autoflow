package com.projectteamforyou.autoflow.triggers

import android.content.Context
import android.util.Log
import com.projectteamforyou.autoflow.a11y.AutoFlowAccessibilityService
import com.projectteamforyou.autoflow.bridge.BridgeEvents
import com.projectteamforyou.autoflow.engine.Flow
import com.projectteamforyou.autoflow.engine.FlowParser
import com.projectteamforyou.autoflow.engine.Hotkey
import com.projectteamforyou.autoflow.engine.Keyforge
import com.projectteamforyou.autoflow.engine.Platform
import com.projectteamforyou.autoflow.engine.Trigger
import com.projectteamforyou.autoflow.engine.isRunnableOn
import com.projectteamforyou.autoflow.keyforge.HotkeyRouter
import com.projectteamforyou.autoflow.run.RunManager
import com.projectteamforyou.autoflow.system.DeviceState
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * Native trigger registry (`triggers_sync`). Flows are persisted to app-private storage so schedules, device events and
 * hotkeys keep working when the WebView is gone, after a reboot (if autostart is on) and after app updates.
 *
 * Android support per trigger (capabilities.ts android column):
 * - schedule: WorkManager periodic work (≥ 15 min); shorter intervals and cron times use exact alarms only when the
 *   user granted "Alarms & reminders", otherwise cron falls back to inexact one-shot work.
 * - deviceEvent: charging, battery low, Wi-Fi, Bluetooth/wired headset (audio devices), input devices, boot.
 * - appEvent: the app in front, observed by the accessibility service.
 * - hotkey: hardware keyboard keys through the accessibility service.
 * - notification: notification access (NotificationListenerService), matched on-device and never stored.
 * - location: not available on Android yet (reported as failed, never silently ignored).
 */
object TriggerEngine {
    private const val TAG = "AutoFlowTriggers"
    private const val FILE = "triggers.json"
    private const val PREFS = "autoflow.triggers"

    @Volatile private var flows: Map<String, Flow> = emptyMap()
    @Volatile private var initialized = false

    fun all(): Collection<Flow> = flows.values

    @Synchronized
    fun init(context: Context) {
        if (initialized) return
        initialized = true
        val f = File(context.filesDir, FILE)
        if (f.isFile) {
            try {
                val o = FlowParser.json.parseToJsonElement(f.readText()).jsonObject
                load(context, o["flows"] as? JsonArray ?: JsonArray(emptyList()), o["emergencyStop"]?.let { hotkeyOf(it) })
            } catch (e: Exception) {
                Log.w(TAG, "stored triggers unreadable: ${e.message}")
            }
        }
    }

    private fun hotkeyOf(e: JsonElement): Hotkey? = try {
        val o = e.jsonObject
        Hotkey(
            (o["key"] as kotlinx.serialization.json.JsonPrimitive).content,
            (o["modifiers"] as? JsonArray)?.map { (it as kotlinx.serialization.json.JsonPrimitive).content } ?: emptyList(),
        )
    } catch (_: Exception) {
        null
    }

    data class SyncResult(val registered: List<String>, val failed: List<Pair<String, String>>) {
        fun toJson(): JsonObject = buildJsonObject {
            put("registered", buildJsonArray { registered.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
            put("failed", buildJsonArray { failed.forEach { (id, reason) -> add(buildJsonObject { put("flowId", id); put("reason", reason) }) } })
        }
    }

    /** `triggers_sync`: replaces the registered set. */
    @Synchronized
    fun sync(context: Context, flowsJson: JsonArray, emergencyStop: JsonElement?): SyncResult {
        val result = load(context, flowsJson, emergencyStop?.let { hotkeyOf(it) })
        val store = buildJsonObject {
            put("flows", JsonArray(flows.values.mapNotNull { it.source }))
            emergencyStop?.let { put("emergencyStop", it) }
        }
        File(context.filesDir, FILE).writeText(store.toString())
        return result
    }

    private fun load(context: Context, flowsJson: JsonArray, emergency: Hotkey?): SyncResult {
        val registered = ArrayList<String>()
        val failed = ArrayList<Pair<String, String>>()
        val next = LinkedHashMap<String, Flow>()
        for (e in flowsJson) {
            val flow = try {
                FlowParser.parse(e)
            } catch (ex: Exception) {
                failed.add(((e as? JsonObject)?.get("id") as? kotlinx.serialization.json.JsonPrimitive)?.content.orEmpty() to "invalid flow: ${ex.message}")
                continue
            }
            next[flow.id] = flow
            val reason = unsupportedReason(context, flow)
            if (reason == null) registered.add(flow.id) else if (flow.trigger !is Trigger.Manual) failed.add(flow.id to reason)
        }
        val previous = flows
        flows = next
        RunManager.rememberFlows(next.values)
        HotkeyRouter.setEmergencyStop(emergency)
        Scheduler.reconcile(context, previous.values, next.values)
        DeviceEventMonitor.reconcile(context, next.values.any { it.trigger is Trigger.DeviceEvent })
        AutoFlowAccessibilityService.instance?.updateKeyFiltering()
        return SyncResult(registered.filter { flows[it]?.trigger !is Trigger.Manual }, failed)
    }

    private fun unsupportedReason(context: Context, flow: Flow): String? {
        if (!isRunnableOn(flow.steps, Platform.ANDROID)) return "contains steps that cannot run on Android"
        return when (val t = flow.trigger) {
            is Trigger.Location -> "location triggers are not available on Android yet"
            is Trigger.Notification -> if (!DeviceState.notificationListenerEnabled(context)) "needs notification access (Settings › Notifications › Device & app notifications)" else null
            is Trigger.Schedule -> {
                val cron = t.cron
                val everyMs = t.everyMs
                when {
                cron == null && everyMs == null -> "schedule needs cron or everyMs"
                cron != null && runCatching { com.projectteamforyou.autoflow.engine.Cron.parse(cron) }.isFailure -> "invalid cron \"$cron\""
                everyMs != null && everyMs < Scheduler.MIN_PERIODIC_MS && !DeviceState.canScheduleExactAlarms(context) ->
                    "intervals under 15 minutes need the Alarms & reminders permission"
                else -> null
                }
            }
            else -> null
        }
    }

    fun hasHotkeyTriggers() = flows.values.any { it.trigger is Trigger.HotkeyTrigger }

    /* ------------------------------------------------------------- firing */

    fun fireById(context: Context, flowId: String, origin: String): Boolean {
        val flow = flows[flowId] ?: return false
        return fire(context, flow, origin)
    }

    fun fire(context: Context, flow: Flow, origin: String): Boolean {
        val id = RunManager.startFromTrigger(context, flow, origin) ?: return false
        Log.i(TAG, "${flow.id} started by $origin as $id")
        return true
    }

    fun onHotkey(context: Context, combo: String): Boolean {
        var hit = false
        for (f in flows.values) {
            val t = f.trigger as? Trigger.HotkeyTrigger ?: continue
            if (Keyforge.comboKey(t.hotkey.key, t.hotkey.modifiers) != combo) continue
            if (t.scope == "app" && t.app != null && !t.app.equals(AutoFlowAccessibilityService.instance?.foregroundPackage, ignoreCase = true)) continue
            hit = true
            BridgeEvents.hotkey("start", f.id)
            fire(context, f, "hotkey")
        }
        // Running flows' own stop hotkeys.
        for (a in RunManager.active()) {
            val h = a.flow.hotkeys.stop
            if (Keyforge.comboKey(h.key, h.modifiers) == combo) {
                a.run.stop("hotkey")
                BridgeEvents.hotkey("stop", a.flow.id)
                hit = true
            }
        }
        return hit
    }

    fun onForegroundApp(context: Context, previous: String?, current: String) {
        for (f in flows.values) {
            val t = f.trigger as? Trigger.AppEvent ?: continue
            val fires = when (t.event) {
                "launched", "focused" -> t.app.equals(current, ignoreCase = true)
                "closed" -> previous != null && t.app.equals(previous, ignoreCase = true)
                else -> false
            }
            if (fires) fire(context, f, "appEvent")
        }
    }

    fun onDeviceEvent(context: Context, event: String) {
        for (f in flows.values) {
            val t = f.trigger as? Trigger.DeviceEvent ?: continue
            if (t.event == event) fire(context, f, "deviceEvent")
        }
    }

    fun onNotification(context: Context, pkg: String, text: String) {
        for (f in flows.values) {
            val t = f.trigger as? Trigger.Notification ?: continue
            if (!t.app.equals(pkg, ignoreCase = true)) continue
            val needle = t.contains
            if (needle != null && !text.contains(needle, ignoreCase = true)) continue
            fire(context, f, "notification")
        }
    }

    /* ------------------------------------------------------------ autostart */

    fun autostart(context: Context): Boolean = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean("autostart", true)
    fun setAutostart(context: Context, enabled: Boolean) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean("autostart", enabled).apply()
    }
}
