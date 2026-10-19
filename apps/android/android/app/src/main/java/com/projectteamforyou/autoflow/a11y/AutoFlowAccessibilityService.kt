package com.projectteamforyou.autoflow.a11y

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.accessibilityservice.GestureDescription
import android.app.KeyguardManager
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import com.projectteamforyou.autoflow.MainActivity
import com.projectteamforyou.autoflow.bridge.BridgeEvents
import com.projectteamforyou.autoflow.engine.BackendException
import com.projectteamforyou.autoflow.engine.ErrorCategory
import com.projectteamforyou.autoflow.engine.Target
import com.projectteamforyou.autoflow.keyforge.HotkeyRouter
import com.projectteamforyou.autoflow.keyforge.ProfileManager
import com.projectteamforyou.autoflow.run.RunManager
import com.projectteamforyou.autoflow.triggers.TriggerEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * AutoFlow's accessibility service — the only way an Android app may perform taps and swipes for the user.
 *
 * It is enabled by the user in Settings › Accessibility after an in-app prominent disclosure, and it does exactly what
 * the user's own flows ask for:
 * - dispatchGesture for tap, double tap, long press (holdMs), swipe/drag and scroll (as a swipe),
 * - performGlobalAction for androidGlobal steps (Back, Home, Recents, notifications, quick settings…),
 * - ACTION_SET_TEXT into the focused editable field for type steps (append semantics, see [TextInput]),
 * - a floating Halt button (TYPE_ACCESSIBILITY_OVERLAY) while a run is active,
 * - hardware-keyboard hotkeys / Keyforge mappings, app-event triggers, the point picker and the recorder.
 *
 * It never acts on protected system screens ([ProtectedScreens]); it never reads screen content except to find the
 * focused text field or an element a flow explicitly targets, and nothing it sees is stored or sent anywhere.
 */
class AutoFlowAccessibilityService : AccessibilityService() {
    companion object {
        private const val TAG = "AutoFlowA11y"

        @Volatile var instance: AutoFlowAccessibilityService? = null
            private set
    }

    val main = Handler(Looper.getMainLooper())
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    lateinit var overlays: Overlays
        private set
    lateinit var text: TextInput
        private set
    lateinit var keys: KeyActions
        private set

    @Volatile var foregroundPackage: String? = null
        private set
    @Volatile var foregroundClass: String? = null
        private set

    override fun onServiceConnected() {
        super.onServiceConnected()
        overlays = Overlays(this)
        text = TextInput(this)
        keys = KeyActions(this)
        instance = this
        updateKeyFiltering()
        onRunsChanged()
        BridgeEvents.permission("accessibility", true)
        Log.i(TAG, "connected")
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        shutdown()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        shutdown()
        super.onDestroy()
    }

    private fun shutdown() {
        if (instance !== this) return
        instance = null
        if (::overlays.isInitialized) overlays.removeAll()
        scope.cancel()
        BridgeEvents.permission("accessibility", false)
    }

    override fun onInterrupt() = Unit

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        event ?: return
        when (event.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> onWindowChanged(event.packageName?.toString(), event.className?.toString())
            AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED -> if (::overlays.isInitialized) overlays.recorder.onTextChanged(event)
        }
    }

    private fun onWindowChanged(pkg: String?, cls: String?) {
        pkg ?: return
        // Our own overlay windows are not "the app in front".
        if (pkg == packageName && cls != MainActivity::class.java.name) return
        val previous = foregroundPackage
        foregroundPackage = pkg
        foregroundClass = cls
        val reason = ProtectedScreens.reason(pkg, cls, keyguardLocked())
        if (reason != null && RunManager.hasActiveRuns()) {
            RunManager.failAll("AutoFlow stopped because $reason. Flows never act on lock, permission or Settings screens.")
        }
        if (previous != pkg) {
            TriggerEngine.onForegroundApp(this, previous, pkg)
            ProfileManager.onForegroundApp(pkg)
        }
    }

    override fun onKeyEvent(event: KeyEvent): Boolean = HotkeyRouter.onKeyEvent(this, event)

    /** Key filtering is requested only while hotkeys or Keyforge mappings exist (least privilege). */
    fun updateKeyFiltering() {
        val info = serviceInfo ?: return
        val want = HotkeyRouter.needsKeyEvents()
        val has = info.flags and AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS != 0
        if (want != has) {
            info.flags = if (want) info.flags or AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS else info.flags and AccessibilityServiceInfo.FLAG_REQUEST_FILTER_KEY_EVENTS.inv()
            serviceInfo = info
        }
    }

    fun onRunsChanged() {
        main.post { if (::overlays.isInitialized) overlays.setHaltVisible(RunManager.hasActiveRuns()) }
    }

    /* ------------------------------------------------------------- guards */

    private fun keyguardLocked(): Boolean = getSystemService(KeyguardManager::class.java)?.isKeyguardLocked ?: false

    /** Throws a fatal "permission" error when the screen in front must not be automated. */
    fun guardProtectedScreen() {
        val root = try {
            rootInActiveWindow
        } catch (_: Exception) {
            null
        }
        val pkg = root?.packageName?.toString() ?: foregroundPackage
        val cls = if (pkg == foregroundPackage) foregroundClass else null
        ProtectedScreens.reason(pkg, cls, keyguardLocked())?.let {
            throw BackendException("AutoFlow will not act because $it.", ErrorCategory.PERMISSION, fatal = true)
        }
    }

    fun guardPackage(pkg: String) {
        ProtectedScreens.reason(pkg, null, false)?.let {
            throw BackendException("flows cannot open protected system apps ($pkg)", ErrorCategory.PERMISSION, fatal = true)
        }
    }

    /* ----------------------------------------------------------- gestures */

    private suspend fun dispatch(gesture: GestureDescription) = suspendCancellableCoroutine { cont ->
        val accepted = dispatchGesture(
            gesture,
            object : GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    if (cont.isActive) cont.resume(Unit)
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    if (cont.isActive) cont.resumeWithException(BackendException("the gesture was interrupted (the screen changed or was touched)", ErrorCategory.TARGET))
                }
            },
            main,
        )
        if (!accepted && cont.isActive) cont.resumeWithException(BackendException("Android refused the gesture", ErrorCategory.ACTION))
    }

    private fun duration(ms: Long): Long = ms.coerceIn(1L, GestureDescription.getMaxGestureDuration())

    /** Tap, double/triple tap (one gesture, strokes 120 ms apart) or long press when [holdMs] > 0. */
    suspend fun tap(x: Float, y: Float, holdMs: Long, clicks: Int) {
        val path = Path().apply { moveTo(x, y) }
        val press = if (holdMs > 0) duration(holdMs) else 40L
        val builder = GestureDescription.Builder()
        for (i in 0 until clicks.coerceIn(1, 3)) builder.addStroke(GestureDescription.StrokeDescription(path, i * (press + 80L), press))
        overlays.withHaltClear(listOf(x to y)) { dispatch(builder.build()) }
    }

    suspend fun swipe(x1: Float, y1: Float, x2: Float, y2: Float, durationMs: Long) {
        val path = Path().apply {
            moveTo(x1, y1)
            lineTo(x2, y2)
        }
        val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration(maxOf(durationMs, 50L)))).build()
        overlays.withHaltClear(listOf(x1 to y1, x2 to y2)) { dispatch(g) }
    }

    /** Cancels any in-flight gesture (Halt): a new 1 ms touch on our own Halt button supersedes it harmlessly. */
    fun cancelGestures() {
        main.post {
            if (!::overlays.isInitialized) return@post
            val c = overlays.haltCenter() ?: return@post
            val p = Path().apply { moveTo(c.first, c.second) }
            dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(p, 0, 1)).build(), null, null)
        }
    }

    fun globalAction(action: String) {
        val id = when (action) {
            "back" -> GLOBAL_ACTION_BACK
            "home" -> GLOBAL_ACTION_HOME
            "recents" -> GLOBAL_ACTION_RECENTS
            "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
            "quickSettings" -> GLOBAL_ACTION_QUICK_SETTINGS
            "powerDialog" -> GLOBAL_ACTION_POWER_DIALOG
            "lockScreen" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_LOCK_SCREEN else unsupported(action)
            "screenshot" -> if (Build.VERSION.SDK_INT >= 28) GLOBAL_ACTION_TAKE_SCREENSHOT else unsupported(action)
            else -> unsupported(action)
        }
        if (!performGlobalAction(id)) throw BackendException("Android refused the $action action", ErrorCategory.ACTION)
    }

    private fun unsupported(action: String): Nothing =
        throw BackendException("\"$action\" needs Android 9 or later", ErrorCategory.UNSUPPORTED)

    fun findElement(selector: Target.ElementSelector): Rect? = NodeFinder.find(this, selector)
}
