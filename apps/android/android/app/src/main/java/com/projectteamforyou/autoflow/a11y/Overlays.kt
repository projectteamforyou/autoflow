package com.projectteamforyou.autoflow.a11y

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.projectteamforyou.autoflow.MainActivity
import com.projectteamforyou.autoflow.R
import com.projectteamforyou.autoflow.run.RunManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Windows drawn by the accessibility service (TYPE_ACCESSIBILITY_OVERLAY — no "draw over other apps" permission).
 * All view work happens on the main thread.
 */
class Overlays(private val service: AutoFlowAccessibilityService) {
    private val wm = service.getSystemService(WindowManager::class.java)
    private val density = service.resources.displayMetrics.density
    private fun dp(v: Int) = (v * density).toInt()

    private val bg = Color.parseColor("#0B0B1A")
    private val primary = Color.parseColor("#7C5CFF")
    private val danger = Color.parseColor("#EF4444")

    val recorder = Recorder(service, this)

    private fun params(w: Int, h: Int, touchable: Boolean = true, focusable: Boolean = false) = WindowManager.LayoutParams(
        w, h, WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        (if (focusable) 0 else WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE) or
            (if (touchable) 0 else WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE) or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
        PixelFormat.TRANSLUCENT,
    )

    fun add(view: View, p: WindowManager.LayoutParams) = try {
        wm.addView(view, p)
        true
    } catch (_: Exception) {
        false
    }

    fun remove(view: View?) {
        if (view?.isAttachedToWindow == true) try {
            wm.removeView(view)
        } catch (_: Exception) {
        }
    }

    fun update(view: View, p: WindowManager.LayoutParams) {
        if (view.isAttachedToWindow) try {
            wm.updateViewLayout(view, p)
        } catch (_: Exception) {
        }
    }

    fun removeAll() {
        remove(halt)
        halt = null
        recorder.stopOverlay()
        picker?.let { remove(it) }
        picker = null
        pendingPick?.cancel()
        confirmView?.let { remove(it) }
    }

    /* ---------------------------------------------------------------- Halt */

    private var halt: View? = null
    private var haltParams: WindowManager.LayoutParams? = null

    @SuppressLint("ClickableViewAccessibility")
    fun setHaltVisible(visible: Boolean) {
        if (!visible) {
            remove(halt)
            halt = null
            return
        }
        if (halt != null) return
        val size = dp(56)
        val v = TextView(service).apply {
            text = "■"
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            gravity = Gravity.CENTER
            contentDescription = service.getString(R.string.halt_button)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(danger)
                setStroke(dp(3), Color.WHITE)
            }
            elevation = dp(6).toFloat()
        }
        val p = params(size, size).apply {
            gravity = Gravity.TOP or Gravity.END
            x = dp(12)
            y = (service.resources.displayMetrics.heightPixels * 0.35f).toInt()
        }
        // Tap = Halt (stop every run). Drag = move the button out of the way.
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var moved = false
        v.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY; startX = p.x; startY = p.y; moved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (moved || dx * dx + dy * dy > dp(8) * dp(8)) {
                        moved = true
                        p.x = (startX - dx).toInt()
                        p.y = (startY + dy).toInt()
                        update(v, p)
                    }
                }
                MotionEvent.ACTION_UP -> if (!moved) RunManager.haltAll("halt button")
            }
            true
        }
        if (add(v, p)) {
            halt = v
            haltParams = p
        }
    }

    /** Center of the Halt button in screen px (for cancelling gestures), or null when hidden. */
    fun haltCenter(): Pair<Float, Float>? {
        val v = halt ?: return null
        val loc = IntArray(2)
        v.getLocationOnScreen(loc)
        return (loc[0] + v.width / 2f) to (loc[1] + v.height / 2f)
    }

    /** Runs [block] with the Halt button hidden if any gesture point would land on it. */
    suspend fun <T> withHaltClear(points: List<Pair<Float, Float>>, block: suspend () -> T): T {
        val hide = withContext(Dispatchers.Main.immediate) {
            val v = halt ?: return@withContext false
            val loc = IntArray(2)
            v.getLocationOnScreen(loc)
            val pad = dp(8)
            val hit = points.any { (x, y) -> x >= loc[0] - pad && x <= loc[0] + v.width + pad && y >= loc[1] - pad && y <= loc[1] + v.height + pad }
            if (hit) v.visibility = View.GONE
            hit
        }
        try {
            return block()
        } finally {
            if (hide) withContext(Dispatchers.Main.immediate) { halt?.visibility = View.VISIBLE }
        }
    }

    /* ------------------------------------------------------------- confirm */

    private var confirmView: View? = null

    suspend fun confirm(message: String): Boolean {
        val answer = CompletableDeferred<Boolean>()
        val view = withContext(Dispatchers.Main) {
            val card = LinearLayout(service).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(20), dp(18), dp(20), dp(12))
                background = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(bg); setStroke(dp(1), primary) }
                elevation = dp(8).toFloat()
                addView(TextView(service).apply {
                    text = service.getString(R.string.confirm_title)
                    setTextColor(Color.parseColor("#A3A3C2"))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
                })
                addView(TextView(service).apply {
                    text = message
                    setTextColor(Color.WHITE)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
                    setPadding(0, dp(6), 0, dp(12))
                })
                addView(LinearLayout(service).apply {
                    gravity = Gravity.END
                    addView(Button(service).apply { text = service.getString(R.string.confirm_no); setOnClickListener { answer.complete(false) } })
                    addView(Button(service).apply { text = service.getString(R.string.confirm_yes); setOnClickListener { answer.complete(true) } })
                })
            }
            val frame = FrameLayout(service).apply {
                setBackgroundColor(Color.parseColor("#66000000"))
                addView(card, FrameLayout.LayoutParams(dp(320), ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER))
            }
            add(frame, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
            confirmView = frame
            frame
        }
        try {
            return answer.await()
        } finally {
            withContext(Dispatchers.Main + kotlinx.coroutines.NonCancellable) {
                remove(view)
                if (confirmView === view) confirmView = null
            }
        }
    }

    /* -------------------------------------------------------- point picker */

    private var picker: View? = null
    private var pendingPick: CompletableDeferred<Pair<Int, Int>>? = null

    /** Full-screen crosshair; resolves with the touched point in physical px, or throws when cancelled. */
    @SuppressLint("ClickableViewAccessibility")
    suspend fun pickPoint(): Pair<Int, Int> {
        val result = CompletableDeferred<Pair<Int, Int>>()
        withContext(Dispatchers.Main) {
            pendingPick?.cancel()
            picker?.let { remove(it) }
            pendingPick = result
            val v = object : FrameLayout(service) {
                var px = -1f
                var py = -1f
                val line = Paint().apply { color = primary; strokeWidth = dp(2).toFloat() }
                init {
                    setWillNotDraw(false)
                    setBackgroundColor(Color.parseColor("#33000000"))
                }
                override fun onDraw(c: Canvas) {
                    if (px >= 0) {
                        c.drawLine(px, 0f, px, height.toFloat(), line)
                        c.drawLine(0f, py, width.toFloat(), py, line)
                    }
                }
            }
            v.addView(TextView(service).apply {
                text = service.getString(R.string.pick_point_hint)
                setTextColor(Color.WHITE)
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
                setPadding(dp(16), dp(10), dp(16), dp(10))
                background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(bg) }
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP or Gravity.CENTER_HORIZONTAL).apply { topMargin = dp(64) })
            v.addView(Button(service).apply {
                text = service.getString(R.string.action_cancel)
                setOnClickListener { result.cancel() }
            }, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply { bottomMargin = dp(64) })
            v.setOnTouchListener { _, e ->
                v.px = e.x
                v.py = e.y
                v.invalidate()
                if (e.actionMasked == MotionEvent.ACTION_UP) result.complete(e.rawX.toInt() to e.rawY.toInt())
                true
            }
            add(v, params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT).apply {
                if (android.os.Build.VERSION.SDK_INT >= 28) layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            })
            picker = v
        }
        try {
            return result.await()
        } finally {
            withContext(Dispatchers.Main + kotlinx.coroutines.NonCancellable) {
                picker?.let { remove(it) }
                picker = null
                if (pendingPick === result) pendingPick = null
            }
        }
    }

    /** Brings the AutoFlow app to the front (after picking/recording, the web UI continues there). */
    fun openApp() {
        try {
            service.startActivity(Intent(service, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT))
        } catch (_: Exception) {
        }
    }

    internal fun paramsFor(touchable: Boolean) = params(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, touchable)
    internal fun dpx(v: Int) = dp(v)
    internal val brandBg get() = bg
}
