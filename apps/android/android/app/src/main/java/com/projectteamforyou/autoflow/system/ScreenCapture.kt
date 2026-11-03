package com.projectteamforyou.autoflow.system

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.projectteamforyou.autoflow.bridge.BridgeEvents
import com.projectteamforyou.autoflow.engine.BackendException
import com.projectteamforyou.autoflow.engine.ErrorCategory
import com.projectteamforyou.autoflow.engine.dhash
import com.projectteamforyou.autoflow.engine.toHexColor
import kotlinx.coroutines.delay
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer

/**
 * Screen capture through MediaProjection — the Android counterpart of crates/engine/src/windows/capture.rs.
 *
 * The user grants capture in the system consent dialog (`permission_request { permission: "screenCapture" }`), which
 * Android asks for again every time the app process starts. The granted projection is kept for the whole process
 * lifetime in one mirror [VirtualDisplay] feeding an [ImageReader]; the newest frame stays acquired so a capture never
 * has to wait for the screen to change. [CaptureService] (a foreground service of type `mediaProjection`, mandatory
 * on Android 10+) owns the projection's foreground status and the "screen capture on" notification with its Stop.
 *
 * Captures are in physical pixels of the built-in display in the current rotation, like every other Android target.
 * Pixels are RGBA, top-down rows; the row-stride padding the compositor adds is stripped when the frame is read.
 */
object ScreenCapture {
    private const val TAG = "AutoFlowCapture"

    /** Largest region (in pixels) one capture / OCR may cover: 16 Mpx ≈ 64 MB of RGBA (same limit as Windows). */
    const val MAX_CAPTURE_PIXELS = 16_000_000L

    /** How long a capture waits for the first frame after the mirror (re)starts. */
    private const val FIRST_FRAME_TIMEOUT_MS = 2_500L

    /** Captured RGBA pixels (tightly packed, top-down rows), like `Capture` in capture.rs. */
    class Capture(val x: Int, val y: Int, val w: Int, val h: Int, val rgba: ByteArray) {
        /** RGB of the captured pixel (x, y) relative to the capture. */
        fun rgb(px: Int, py: Int): IntArray {
            val o = (py * w + px) * 4
            return intArrayOf(rgba[o].toInt() and 255, rgba[o + 1].toInt() and 255, rgba[o + 2].toInt() and 255)
        }

        /** The capture as an ARGB_8888 bitmap (RGBA byte order in memory, which is what ML Kit and PNG encoding need). */
        fun toBitmap(): Bitmap {
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bmp.copyPixelsFromBuffer(ByteBuffer.wrap(rgba))
            return bmp
        }
    }

    private val lock = Any()
    private var projection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var reader: ImageReader? = null
    private var latest: Image? = null
    private var frameW = 0
    private var frameH = 0
    private var thread: HandlerThread? = null
    private var handler: Handler? = null

    /** True while a granted projection is alive (the "screenCapture" permission is reported as granted). */
    val isActive: Boolean get() = synchronized(lock) { projection != null }

    /** The system consent dialog for screen capture. */
    fun consentIntent(context: Context): Intent =
        context.getSystemService(MediaProjectionManager::class.java).createScreenCaptureIntent()

    /**
     * Takes ownership of a freshly granted projection. Called by [CaptureService] right after `startForeground`
     * (Android 10+ refuses `getMediaProjection` without a running `mediaProjection` foreground service).
     */
    fun attach(context: Context, resultCode: Int, data: Intent): Boolean {
        val app = context.applicationContext
        val mp = try {
            app.getSystemService(MediaProjectionManager::class.java).getMediaProjection(resultCode, data)
        } catch (e: Exception) {
            Log.w(TAG, "getMediaProjection failed: ${e.javaClass.simpleName}: ${e.message}")
            null
        } ?: return false
        synchronized(lock) {
            releaseLocked()
            val t = HandlerThread("AutoFlowCapture").apply { start() }
            val h = Handler(t.looper)
            thread = t
            handler = h
            // Android 14+ requires the callback before createVirtualDisplay; onStop fires when the user ends the
            // capture from the status bar or the system revokes it (the projection is then unusable).
            mp.registerCallback(object : MediaProjection.Callback() {
                override fun onStop() {
                    stop("projection stopped")
                }
            }, h)
            projection = mp
            val s = DeviceState.screen(app)
            val dpi = app.resources.displayMetrics.densityDpi
            try {
                val r = newReader(s.width, s.height, h)
                virtualDisplay = mp.createVirtualDisplay(
                    "AutoFlow", s.width, s.height, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, r.surface, null, h,
                )
            } catch (e: Exception) {
                Log.w(TAG, "virtual display failed: ${e.javaClass.simpleName}: ${e.message}")
                releaseLocked()
                return false
            }
        }
        BridgeEvents.permission("screenCapture", true)
        return true
    }

    /** Ends the capture session (Stop in the notification, bridge, or the system's own stop). */
    fun stop(reason: String = "user") {
        val had = synchronized(lock) {
            val had = projection != null
            releaseLocked()
            had
        }
        if (had) {
            Log.i(TAG, "screen capture ended: $reason")
            BridgeEvents.permission("screenCapture", false)
        }
        CaptureService.stopIfRunning()
    }

    /** Must hold [lock]. */
    private fun releaseLocked() {
        latest?.let { runCatching { it.close() } }
        latest = null
        virtualDisplay?.let { runCatching { it.release() } }
        virtualDisplay = null
        reader?.let { runCatching { it.close() } }
        reader = null
        projection?.let { runCatching { it.stop() } }
        projection = null
        thread?.quitSafely()
        thread = null
        handler = null
        frameW = 0
        frameH = 0
    }

    /** Must hold [lock]. Creates the frame reader; the listener keeps only the newest frame acquired. */
    private fun newReader(w: Int, h: Int, h2: Handler): ImageReader {
        val r = ImageReader.newInstance(w, h, PixelFormat.RGBA_8888, 3)
        r.setOnImageAvailableListener({ src ->
            val img = try {
                src.acquireLatestImage()
            } catch (_: Exception) {
                null
            } ?: return@setOnImageAvailableListener
            synchronized(lock) {
                if (reader !== src) {
                    img.close()
                    return@synchronized
                }
                latest?.let { runCatching { it.close() } }
                latest = img
            }
        }, h2)
        reader = r
        frameW = w
        frameH = h
        return r
    }

    /** Must hold [lock]. Follows a rotation / fold: the mirror is resized and gets a fresh reader. */
    private fun ensureSizeLocked(context: Context): Boolean {
        val s = DeviceState.screen(context)
        if (s.width == frameW && s.height == frameH) return false
        val vd = virtualDisplay ?: return false
        val h = handler ?: return false
        latest?.let { runCatching { it.close() } }
        latest = null
        reader?.let { runCatching { it.close() } }
        val r = newReader(s.width, s.height, h)
        try {
            vd.resize(s.width, s.height, context.resources.displayMetrics.densityDpi)
            vd.surface = r.surface
        } catch (e: Exception) {
            Log.w(TAG, "virtual display resize failed: ${e.javaClass.simpleName}")
        }
        return true
    }

    private fun notEnabled(): BackendException = BackendException(
        "screen capture is not enabled — allow it in Settings › Permissions (Android asks again each time AutoFlow starts)",
        ErrorCategory.PERMISSION,
    )

    /**
     * Captures a screen rectangle in physical pixels. Suspends (cancellably) only while the first frame after
     * enabling or rotating is still on its way, so Stop/Halt never waits on a capture.
     */
    suspend fun capture(context: Context, x: Int, y: Int, w: Int, h: Int): Capture {
        if (w <= 0 || h <= 0 || w > 16_384 || h > 16_384) {
            throw BackendException("capture region is empty or too large", ErrorCategory.VALIDATION)
        }
        if (w.toLong() * h.toLong() > MAX_CAPTURE_PIXELS) {
            throw BackendException(
                "capture region is too large (${w}×${h} px); the limit is ${MAX_CAPTURE_PIXELS / 1_000_000} megapixels",
                ErrorCategory.VALIDATION,
            )
        }
        val app = context.applicationContext
        val deadline = SystemClock.elapsedRealtime() + FIRST_FRAME_TIMEOUT_MS
        while (true) {
            val result: Capture? = synchronized(lock) {
                if (projection == null) throw notEnabled()
                ensureSizeLocked(app)
                val img = latest ?: return@synchronized null
                read(img, x, y, w, h)
            }
            if (result != null) return result
            if (SystemClock.elapsedRealtime() >= deadline) {
                throw BackendException("screen capture failed: no frame arrived from the display", ErrorCategory.ENVIRONMENT)
            }
            delay(20)
        }
    }

    /** Must hold [lock]. Copies the region out of the frame, dropping the row-stride padding; clamps to the screen. */
    private fun read(img: Image, x: Int, y: Int, w: Int, h: Int): Capture {
        val plane = img.planes[0]
        val buf = plane.buffer
        // Positioned through java.nio.Buffer: the covariant ByteBuffer overrides only exist on Android 14+.
        val pos: java.nio.Buffer = buf
        val ps = plane.pixelStride
        val rs = plane.rowStride
        val fw = img.width
        val fh = img.height
        val x0 = x.coerceIn(0, fw)
        val y0 = y.coerceIn(0, fh)
        val x1 = (x + w).coerceIn(0, fw)
        val y1 = (y + h).coerceIn(0, fh)
        if (x1 <= x0 || y1 <= y0) {
            throw BackendException("capture region (${x}, ${y}, ${w}×${h}) is outside the ${fw}×${fh} screen", ErrorCategory.TARGET)
        }
        val cw = x1 - x0
        val ch = y1 - y0
        val out = ByteArray(cw * ch * 4)
        if (ps == 4) {
            for (row in 0 until ch) {
                pos.position((y0 + row) * rs + x0 * 4)
                buf.get(out, row * cw * 4, cw * 4)
            }
        } else {
            for (row in 0 until ch) {
                val base = (y0 + row) * rs
                for (col in 0 until cw) {
                    val src = base + (x0 + col) * ps
                    val dst = (row * cw + col) * 4
                    out[dst] = buf.get(src)
                    out[dst + 1] = buf.get(src + 1)
                    out[dst + 2] = buf.get(src + 2)
                    out[dst + 3] = buf.get(src + 3)
                }
            }
        }
        pos.rewind()
        return Capture(x0, y0, cw, ch, out)
    }

    /** Color of one screen pixel as `#rrggbb` (pixel probes). */
    suspend fun pixelHex(context: Context, x: Int, y: Int): String {
        val shot = capture(context, x, y, 1, 1)
        return toHexColor(shot.rgb(0, 0))
    }

    /** dHash of a screen rectangle (scene probes); same math as `dhash()` in displays.ts and capture.rs. */
    suspend fun sceneHash(context: Context, x: Int, y: Int, w: Int, h: Int): String {
        val shot = capture(context, x, y, w, h)
        return dhash(shot.w, shot.h) { px, py -> shot.rgb(px, py) }
            ?: throw BackendException("scene region is empty", ErrorCategory.ACTION)
    }

    /** Scene capture for the Stage panel: dHash plus a PNG thumbnail data URL (≤ MAX_SCENE_THUMB_CHARS). */
    suspend fun sceneCapture(context: Context, x: Int, y: Int, w: Int, h: Int): SceneCaptured {
        val shot = capture(context, x, y, w, h)
        val hash = dhash(shot.w, shot.h) { px, py -> shot.rgb(px, py) }
            ?: throw BackendException("scene region is empty", ErrorCategory.ACTION)
        val thumb = thumbnailDataUrl(shot, 160)
            ?: throw BackendException("cannot encode the scene preview", ErrorCategory.ACTION)
        return SceneCaptured(hash, thumb, shot.w, shot.h)
    }

    class SceneCaptured(val hash: String, val thumb: String, val width: Int, val height: Int)

    /** Largest inline scene thumbnail (`MAX_SCENE_THUMB_CHARS` in schema.ts). */
    private const val MAX_SCENE_THUMB_CHARS = 24 * 1024

    /** Nearest-neighbour thumbnail as a PNG data URL, shrunk until it fits — `thumbnail_data_url` in display.rs. */
    private fun thumbnailDataUrl(shot: Capture, maxW: Int): String? {
        val w = shot.w
        val h = shot.h
        if (w == 0 || h == 0) return null
        var tw = maxOf(1, minOf(maxW, w))
        while (true) {
            val th = maxOf(1, (h * tw + w - 1) / w)
            val px = IntArray(tw * th)
            for (ty in 0 until th) {
                val sy = ((ty * h + h / 2) / th) % h
                for (tx in 0 until tw) {
                    val sx = ((tx * w + w / 2) / tw) % w
                    val c = shot.rgb(sx, sy)
                    px[ty * tw + tx] = (0xFF shl 24) or (c[0] shl 16) or (c[1] shl 8) or c[2]
                }
            }
            val bmp = Bitmap.createBitmap(px, tw, th, Bitmap.Config.ARGB_8888)
            val bytes = ByteArrayOutputStream()
            val encoded = bmp.compress(Bitmap.CompressFormat.PNG, 100, bytes)
            bmp.recycle()
            if (!encoded) return null
            val url = "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP)
            if (url.length <= MAX_SCENE_THUMB_CHARS || tw <= 8) {
                return if (url.length <= MAX_SCENE_THUMB_CHARS) url else null
            }
            tw = tw * 2 / 3
        }
    }
}
