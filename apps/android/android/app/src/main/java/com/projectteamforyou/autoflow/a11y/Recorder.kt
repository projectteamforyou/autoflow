package com.projectteamforyou.autoflow.a11y

import android.accessibilityservice.GestureDescription
import android.annotation.SuppressLint
import android.graphics.Color
import android.graphics.Path
import android.graphics.drawable.GradientDrawable
import android.os.SystemClock
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.FrameLayout
import android.widget.TextView
import com.projectteamforyou.autoflow.R
import com.projectteamforyou.autoflow.bridge.BridgeEvents
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Recording on Android. Accessibility cannot observe other apps' touches, so while recording a transparent overlay
 * receives each touch, records it (mouseDown/mouseUp with physical px, like the desktop recorder's RecordedEvent) and
 * immediately replays the same tap or swipe into the app underneath with dispatchGesture. Typed text is taken from
 * text-change events; in password fields only placeholders flagged `sensitive` are recorded — never the characters —
 * so packages/core record.ts turns them into {{secret:…}}.
 *
 * Recording only happens between record_start and record_stop (or the on-screen Done chip), with a visible banner.
 */
class Recorder(private val service: AutoFlowAccessibilityService, private val overlays: Overlays) {
    private val events = ArrayList<JsonObject>()
    private var overlay: FrameLayout? = null
    private var params: WindowManager.LayoutParams? = null
    private var t0 = 0L
    @Volatile var active = false
        private set
    private var maskSensitive = true

    private fun now() = SystemClock.uptimeMillis() - t0

    private fun record(e: JsonObject) {
        synchronized(events) { if (events.size < 20_000) events.add(e) }
        BridgeEvents.recording(e)
    }

    @SuppressLint("ClickableViewAccessibility")
    fun start(maskSensitive: Boolean) {
        stopOverlay()
        synchronized(events) { events.clear() }
        this.maskSensitive = maskSensitive
        t0 = SystemClock.uptimeMillis()
        active = true
        val root = FrameLayout(service)
        val banner = TextView(service).apply {
            text = service.getString(R.string.recording_banner)
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            setPadding(overlays.dpx(16), overlays.dpx(8), overlays.dpx(16), overlays.dpx(8))
            background = GradientDrawable().apply { cornerRadius = overlays.dpx(18).toFloat(); setColor(Color.parseColor("#EF4444")) }
            setOnClickListener {
                stopOverlay()
                overlays.openApp()
            }
        }
        root.addView(banner, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = overlays.dpx(40) })
        val path = Path()
        var downAt = 0L
        var sx = 0f
        var sy = 0f
        var lx = 0f
        var ly = 0f
        root.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downAt = SystemClock.uptimeMillis()
                    sx = e.rawX; sy = e.rawY; lx = sx; ly = sy
                    path.reset()
                    path.moveTo(sx, sy)
                    record(buildJsonObject { put("t", now()); put("kind", "mouseDown"); put("x", sx.toInt()); put("y", sy.toInt()); put("button", "left") })
                }
                MotionEvent.ACTION_MOVE -> {
                    lx = e.rawX; ly = e.rawY
                    path.lineTo(lx, ly)
                }
                MotionEvent.ACTION_UP -> {
                    lx = e.rawX; ly = e.rawY
                    path.lineTo(lx, ly)
                    record(buildJsonObject { put("t", now()); put("kind", "mouseUp"); put("x", lx.toInt()); put("y", ly.toInt()); put("button", "left") })
                    replay(Path(path), (SystemClock.uptimeMillis() - downAt).coerceIn(1, 10_000))
                }
            }
            true
        }
        val p = overlays.paramsFor(touchable = true)
        if (overlays.add(root, p)) {
            overlay = root
            params = p
        }
    }

    /** Passes the recorded touch through: overlay untouchable → same gesture → touchable again. */
    private fun replay(path: Path, durationMs: Long) {
        val v = overlay ?: return
        val p = params ?: return
        p.flags = p.flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
        overlays.update(v, p)
        val g = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, durationMs.coerceAtMost(GestureDescription.getMaxGestureDuration()))).build()
        val restore = Runnable {
            if (overlay === v) {
                p.flags = p.flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
                overlays.update(v, p)
            }
        }
        val ok = service.dispatchGesture(
            g,
            object : android.accessibilityservice.AccessibilityService.GestureResultCallback() {
                override fun onCompleted(d: GestureDescription?) = restore.run()
                override fun onCancelled(d: GestureDescription?) = restore.run()
            },
            service.main,
        )
        if (!ok) restore.run()
    }

    fun onTextChanged(e: AccessibilityEvent) {
        if (!active) return
        val added = e.addedCount
        if (added <= 0 && e.removedCount > 0) {
            repeat(e.removedCount.coerceAtMost(50)) { key("Backspace", sensitive = e.isPassword) }
            return
        }
        if (added <= 0) return
        if (e.isPassword && maskSensitive) {
            // Never record password characters: placeholders only.
            repeat(added.coerceAtMost(200)) { key("x", sensitive = true) }
            return
        }
        val text = e.text.joinToString("")
        val from = e.fromIndex.coerceAtLeast(0)
        val chunk = if (from + added <= text.length) text.substring(from, from + added) else text.takeLast(added)
        var i = 0
        while (i < chunk.length) {
            val n = chunk.offsetByCodePoints(i, 1)
            val c = chunk.substring(i, n)
            key(if (c == "\n") "Enter" else c, sensitive = e.isPassword)
            i = n
        }
    }

    private fun key(k: String, sensitive: Boolean) {
        val t = now()
        val mods = buildJsonArray { }
        record(buildJsonObject { put("t", t); put("kind", "keyDown"); put("key", k); put("modifiers", mods); if (sensitive) put("sensitive", true) })
        record(buildJsonObject { put("t", t + 1); put("kind", "keyUp"); put("key", k); put("modifiers", mods); if (sensitive) put("sensitive", true) })
    }

    fun stopOverlay() {
        active = false
        overlay?.let { overlays.remove(it) }
        overlay = null
        params = null
    }

    /** Ends recording and returns everything recorded since start. */
    fun stop(): List<JsonObject> {
        stopOverlay()
        return synchronized(events) { ArrayList(events).also { events.clear() } }
    }
}
