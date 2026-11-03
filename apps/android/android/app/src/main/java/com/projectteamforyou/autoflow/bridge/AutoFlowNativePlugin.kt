package com.projectteamforyou.autoflow.bridge

import android.Manifest
import android.app.Activity
import android.os.Build
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.projectteamforyou.autoflow.a11y.AccessibilityDisclosure
import com.projectteamforyou.autoflow.a11y.AutoFlowAccessibilityService
import com.projectteamforyou.autoflow.engine.BackendException
import com.projectteamforyou.autoflow.engine.FlowParseException
import com.projectteamforyou.autoflow.engine.FlowParser
import com.projectteamforyou.autoflow.engine.Target
import com.projectteamforyou.autoflow.engine.Value
import com.projectteamforyou.autoflow.engine.placeRect
import com.projectteamforyou.autoflow.keyforge.ProfileManager
import com.projectteamforyou.autoflow.run.RunManager
import com.projectteamforyou.autoflow.secrets.SecretStore
import com.projectteamforyou.autoflow.system.CaptureService
import com.projectteamforyou.autoflow.system.DeviceState
import com.projectteamforyou.autoflow.system.Intents
import com.projectteamforyou.autoflow.system.ScreenCapture
import com.projectteamforyou.autoflow.triggers.TriggerEngine
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import kotlin.math.roundToInt

/**
 * Capacitor plugin "AutoFlowNative" — the Android side of `BridgeCommands` in packages/core/src/bridge.ts.
 *
 * Method names are the bridge command names exactly (device_info, run_start, …). Because Capacitor resolves calls
 * with an object only, every command resolves `{ value: <result> }` (`{ value: null }` for void results); see
 * apps/android/web-bridge.ts for the typed adapter. Errors reject with `code` = an ErrorCategory
 * ("validation", "permission", "unsupported", "internal"…). Events are delivered on the "autoflow://event" listener
 * as BridgeEvent objects.
 */
@CapacitorPlugin(
    name = "AutoFlowNative",
    permissions = [Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class AutoFlowNativePlugin : Plugin() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var unsubscribe: (() -> Unit)? = null
    private val lastPermissions = HashMap<String, Boolean>()

    override fun load() {
        TriggerEngine.init(context)
        unsubscribe = BridgeEvents.subscribe { event ->
            val js = JSObject(event.toString())
            bridge?.executeOnMainThread { notifyListeners(BridgeEvents.EVENT_NAME, js) }
        }
        snapshotPermissions(emit = false)
    }

    override fun handleOnDestroy() {
        unsubscribe?.invoke()
        scope.cancel()
        super.handleOnDestroy()
    }

    /** Returning from Settings: report every permission whose state changed. */
    override fun handleOnResume() {
        super.handleOnResume()
        snapshotPermissions(emit = true)
    }

    private fun snapshotPermissions(emit: Boolean) {
        for (p in DeviceState.PERMISSIONS) {
            val granted = (DeviceState.permissionStatus(context, p)["granted"] as JsonPrimitive).booleanOrNull ?: false
            if (emit && lastPermissions[p] != null && lastPermissions[p] != granted) BridgeEvents.permission(p, granted)
            lastPermissions[p] = granted
        }
    }

    /* -------------------------------------------------------------- helpers */

    private fun args(call: PluginCall): JsonObject = FlowParser.json.parseToJsonElement(call.data.toString()).jsonObject

    private fun ok(call: PluginCall, value: JsonElement = JsonNull) {
        call.resolve(JSObject(buildJsonObject { put("value", value) }.toString()))
    }

    private fun fail(call: PluginCall, message: String, code: String) = call.reject(message, code)

    private fun JsonObject.bool(k: String) = (this[k] as? JsonPrimitive)?.booleanOrNull ?: false
    private fun JsonObject.string(k: String) = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content

    /** Runs [block] off the main thread and maps exceptions to rejections. */
    private fun async(call: PluginCall, block: suspend () -> JsonElement) {
        scope.launch {
            try {
                ok(call, withContext(Dispatchers.Default) { block() })
            } catch (e: CancellationException) {
                fail(call, "cancelled", "user")
            } catch (e: FlowParseException) {
                fail(call, e.message ?: "invalid flow", "validation")
            } catch (e: BackendException) {
                fail(call, e.message ?: "failed", e.category.json)
            } catch (e: IllegalArgumentException) {
                fail(call, e.message ?: "invalid arguments", "validation")
            } catch (e: Exception) {
                fail(call, e.message ?: e.javaClass.simpleName, "internal")
            }
        }
    }

    private fun a11yOrReject(call: PluginCall): AutoFlowAccessibilityService? {
        val svc = AutoFlowAccessibilityService.instance
        if (svc == null) fail(call, "Turn on AutoFlow in Settings › Accessibility first", "permission")
        return svc
    }

    /* ------------------------------------------------------------- commands */

    @PluginMethod
    fun device_info(call: PluginCall) = async(call) { DeviceState.deviceInfo(context) }

    @PluginMethod
    fun permissions_status(call: PluginCall) = async(call) {
        buildJsonArray { DeviceState.PERMISSIONS.forEach { add(DeviceState.permissionStatus(context, it)) } }
    }

    @PluginMethod
    fun permission_request(call: PluginCall) {
        val permission = args(call).string("permission") ?: return fail(call, "permission is required", "validation")
        if (permission !in DeviceState.PERMISSIONS) return fail(call, "unknown permission $permission", "validation")
        if (permission == "notifications" && Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "onNotificationPermission")
            return
        }
        if (permission == "screenCapture") {
            // Granted in the system consent dialog, per process start; never through Settings.
            if (ScreenCapture.isActive) return ok(call, DeviceState.permissionStatus(context, permission))
            requestScreenCapture(call)
            return
        }
        val status = DeviceState.permissionStatus(context, permission)
        if (status["granted"] != JsonPrimitive(true) && permission in A11Y_PAGES) {
            // Play policy: the prominent disclosure always comes before Android's Accessibility settings.
            val act = activity ?: return fail(call, "AutoFlow is not in the foreground", "environment")
            AccessibilityDisclosure.request(act) { agreed -> ok(call, JsonObject(status + ("declined" to JsonPrimitive(!agreed)))) }
            return
        }
        if (status["granted"] != JsonPrimitive(true) && permission !in setOf("location", "overlay")) {
            // Special-access permissions can only be granted by the user in Settings.
            Intents.start(context, Intents.settings(context, permission))
        }
        ok(call, status)
    }

    @PermissionCallback
    private fun onNotificationPermission(call: PluginCall) {
        val status = DeviceState.permissionStatus(context, "notifications")
        BridgeEvents.permission("notifications", status["granted"] == JsonPrimitive(true))
        ok(call, status)
    }

    /** Screen capture: the system consent dialog; [CaptureService] then takes the projection into the foreground. */
    private fun requestScreenCapture(call: PluginCall) {
        if (activity == null) return fail(call, "AutoFlow is not in the foreground", "environment")
        try {
            startActivityForResult(call, ScreenCapture.consentIntent(context), "onScreenCaptureResult")
        } catch (e: Exception) {
            fail(call, "screen capture is not available on this device: ${e.message ?: e.javaClass.simpleName}", "unsupported")
        }
    }

    @ActivityCallback
    private fun onScreenCaptureResult(call: PluginCall?, result: ActivityResult) {
        val data = result.data
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            if (call != null) ok(call, JsonObject(DeviceState.permissionStatus(context, "screenCapture") + ("declined" to JsonPrimitive(true))))
            return
        }
        val started = CaptureService.start(context, result.resultCode, data)
        scope.launch {
            // getMediaProjection runs inside the foreground service (Android 10+ rule); give it a moment to attach.
            var waited = 0
            while (started && !ScreenCapture.isActive && waited < 4000) {
                delay(50)
                waited += 50
            }
            if (call != null) ok(call, DeviceState.permissionStatus(context, "screenCapture"))
        }
    }

    @PluginMethod
    fun run_start(call: PluginCall) = async(call) {
        val a = args(call)
        val flow = FlowParser.parse(a["flow"] ?: throw IllegalArgumentException("flow is required"))
        (a["library"] as? JsonArray)?.let { lib -> RunManager.rememberFlows(lib.mapNotNull { runCatching { FlowParser.parse(it) }.getOrNull() }) }
        val inputs = (a["inputs"] as? JsonObject)?.mapValues { (_, v) -> Value.fromJson(v) } ?: emptyMap()
        val runId = RunManager.start(
            context,
            RunManager.StartRequest(flow, inputs, a.bool("approvedRisk"), a.bool("approvedScreenChange"), a.bool("dryRun")),
        )
        buildJsonObject { put("runId", runId) }
    }

    @PluginMethod
    fun run_pause(call: PluginCall) {
        RunManager.pause(args(call).string("runId") ?: return fail(call, "runId is required", "validation"))
        ok(call)
    }

    @PluginMethod
    fun run_resume(call: PluginCall) {
        RunManager.resume(args(call).string("runId") ?: return fail(call, "runId is required", "validation"))
        ok(call)
    }

    @PluginMethod
    fun run_stop(call: PluginCall) {
        val a = args(call)
        RunManager.stop(a.string("runId") ?: return fail(call, "runId is required", "validation"), a.string("reason") ?: "user")
        ok(call)
    }

    @PluginMethod
    fun halt_all(call: PluginCall) {
        RunManager.haltAll("halt")
        BridgeEvents.hotkey("halt")
        ok(call)
    }

    @PluginMethod
    fun triggers_sync(call: PluginCall) = async(call) {
        val a = args(call)
        TriggerEngine.sync(context, a["flows"] as? JsonArray ?: JsonArray(emptyList()), a["emergencyStop"]).toJson()
    }

    @PluginMethod
    fun record_start(call: PluginCall) {
        val svc = a11yOrReject(call) ?: return
        val mask = (args(call)["maskSensitive"] as? JsonPrimitive)?.booleanOrNull ?: true
        scope.launch {
            svc.overlays.recorder.start(mask)
            ok(call)
        }
    }

    @PluginMethod
    fun record_stop(call: PluginCall) {
        val svc = AutoFlowAccessibilityService.instance
        scope.launch {
            val events = svc?.overlays?.recorder?.stop() ?: emptyList()
            ok(call, buildJsonObject { put("events", JsonArray(events)); put("screen", DeviceState.screen(context).toJson()) })
        }
    }

    @PluginMethod
    fun pick_point(call: PluginCall) {
        val svc = a11yOrReject(call) ?: return
        scope.launch {
            try {
                val (x, y) = svc.overlays.pickPoint()
                val screen = DeviceState.screen(context).toJson()
                BridgeEvents.pointPicked(x, y, screen)
                svc.overlays.openApp()
                ok(call, buildJsonObject { put("x", x); put("y", y); put("screen", screen) })
            } catch (e: CancellationException) {
                fail(call, "point picking was cancelled", "user")
            }
        }
    }

    /** The built-in display only (Android has no extended desktop); ids match the engine's default display. */
    @PluginMethod
    fun displays_list(call: PluginCall) = async(call) { JsonArray(listOf(DeviceState.displayJson(context))) }

    /** One display: nothing to tell apart. */
    @PluginMethod
    fun displays_identify(call: PluginCall) = ok(call)

    @PluginMethod
    fun deck_pin(call: PluginCall) = fail(call, "Android has a single display; Stage mode needs a second monitor on Windows", "unsupported")

    /** Captures a normalized region of the built-in display as a Scene: dHash + PNG thumbnail (needs screen capture). */
    @PluginMethod
    fun scene_capture(call: PluginCall) = async(call) {
        val a = args(call)
        val displayId = a.string("displayId") ?: "primary"
        if (displayId != "primary") throw IllegalArgumentException("display \"$displayId\" is not connected")
        val r = a["region"] as? JsonObject ?: throw IllegalArgumentException("region is required")
        fun num(k: String): Double = (r[k] as? JsonPrimitive)?.doubleOrNull ?: Double.NaN
        val region = Target.Rect(num("x"), num("y"), num("w"), num("h"))
        fun unit(v: Double) = v.isFinite() && v >= 0.0 && v <= 1.0
        if (!(unit(region.x) && unit(region.y) && unit(region.w) && unit(region.h)) || region.w <= 0.0 || region.h <= 0.0) {
            throw IllegalArgumentException("the scene region must be a normalized rectangle inside the display")
        }
        // Same placement and clamping as the engine's scene probes (scene_rect in apps/desktop).
        val s = DeviceState.screen(context)
        val b = Target.Rect(0.0, 0.0, s.width.toDouble(), s.height.toDouble())
        val r0 = placeRect(b, region, "normalized")
        val rect = r0.copy(w = maxOf(1.0, minOf(r0.w, b.x + b.w - r0.x)), h = maxOf(1.0, minOf(r0.h, b.y + b.h - r0.y)))
        val cap = ScreenCapture.sceneCapture(context, rect.x.roundToInt(), rect.y.roundToInt(), rect.w.roundToInt(), rect.h.roundToInt())
        buildJsonObject { put("hash", cap.hash); put("thumb", cap.thumb); put("width", cap.width); put("height", cap.height) }
    }

    @PluginMethod
    fun profiles_apply(call: PluginCall) = async(call) {
        val a = args(call)
        val (active, warnings) = ProfileManager.apply(a["profiles"] ?: JsonArray(emptyList()), a.bool("enabled"))
        buildJsonObject {
            put("active", active?.let { JsonPrimitive(it) } ?: JsonNull)
            put("warnings", buildJsonArray { warnings.forEach { add(JsonPrimitive(it)) } })
        }
    }

    @PluginMethod
    fun secret_set(call: PluginCall) = async(call) {
        val a = args(call)
        SecretStore.get(context).set(a.string("name") ?: throw IllegalArgumentException("name is required"), a.string("value") ?: throw IllegalArgumentException("value is required"))
        JsonNull
    }

    @PluginMethod
    fun secret_delete(call: PluginCall) = async(call) {
        SecretStore.get(context).delete(args(call).string("name") ?: throw IllegalArgumentException("name is required"))
        JsonNull
    }

    @PluginMethod
    fun secret_list(call: PluginCall) = async(call) {
        buildJsonArray { SecretStore.get(context).names().forEach { add(JsonPrimitive(it)) } }
    }

    @PluginMethod
    fun open_settings(call: PluginCall) {
        val page = args(call).string("page") ?: "app"
        if (page == "screenCapture") {
            if (ScreenCapture.isActive) ok(call) else requestScreenCapture(call)
            return
        }
        if (page in A11Y_PAGES) {
            val act = activity ?: return fail(call, "AutoFlow is not in the foreground", "environment")
            AccessibilityDisclosure.request(act) { agreed -> ok(call, buildJsonObject { put("declined", !agreed) }) }
            return
        }
        if (!Intents.start(context, Intents.settings(context, page))) return fail(call, "could not open settings", "environment")
        ok(call)
    }

    @PluginMethod
    fun open_external(call: PluginCall) {
        val url = args(call).string("url") ?: ""
        if (!url.startsWith("https://") || url.length > 2048) return fail(call, "only https links can be opened", "validation")
        val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url))
            .addCategory(android.content.Intent.CATEGORY_BROWSABLE)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(intent)
        } catch (_: Exception) {
            return fail(call, "no browser is available", "environment")
        }
        ok(call)
    }

    @PluginMethod
    fun autostart_set(call: PluginCall) {
        TriggerEngine.setAutostart(context, args(call).bool("enabled"))
        ok(call)
    }
}

/** Bridge pages and permissions that lead to Android's Accessibility settings. */
private val A11Y_PAGES = setOf("accessibility", "inputMonitoring")
