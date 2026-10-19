package com.projectteamforyou.autoflow.run

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import com.projectteamforyou.autoflow.a11y.AutoFlowAccessibilityService
import com.projectteamforyou.autoflow.engine.Backend
import com.projectteamforyou.autoflow.engine.BackendException
import com.projectteamforyou.autoflow.engine.ErrorCategory
import com.projectteamforyou.autoflow.engine.InputAction
import com.projectteamforyou.autoflow.engine.Platform
import com.projectteamforyou.autoflow.engine.ScreenInfo
import com.projectteamforyou.autoflow.engine.Target
import com.projectteamforyou.autoflow.engine.Value
import com.projectteamforyou.autoflow.keyforge.ProfileManager
import com.projectteamforyou.autoflow.system.DeviceState
import com.projectteamforyou.autoflow.system.Notifications
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runInterruptible
import kotlinx.coroutines.withContext
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.random.Random

/**
 * Executes engine actions on Android. Input (tap, long press, swipe, scroll, typing, key mapping, system actions) goes
 * through [AutoFlowAccessibilityService]; everything else uses ordinary platform APIs. Point targets: `normalized`
 * scales by the real display size in the current rotation; `screen` (and `window`, there are no desktop windows on
 * Android) are physical pixels.
 */
class AndroidBackend(private val context: Context) : Backend {
    override val platform = Platform.ANDROID

    override suspend fun screen(): ScreenInfo = DeviceState.screen(context)

    private fun a11y(): AutoFlowAccessibilityService = AutoFlowAccessibilityService.instance
        ?: throw BackendException(
            "AutoFlow's accessibility service is off. Turn it on in Settings › Accessibility › AutoFlow to run taps, swipes and typing.",
            ErrorCategory.PERMISSION,
        )

    /** Physical pixel for a target. */
    private fun point(t: Target, svc: AutoFlowAccessibilityService?): Pair<Float, Float> {
        val s = DeviceState.screen(context)
        return when (t) {
            is Target.Point -> if (t.space == "normalized") (t.x * s.width).toFloat() to (t.y * s.height).toFloat() else t.x.toFloat() to t.y.toFloat()
            is Target.Region -> {
                val sw = if (t.space == "normalized") s.width.toDouble() else 1.0
                val sh = if (t.space == "normalized") s.height.toDouble() else 1.0
                val fx = if (t.pick == "random") Random.nextDouble() else 0.5
                val fy = if (t.pick == "random") Random.nextDouble() else 0.5
                ((t.x + t.w * fx) * sw).toFloat() to ((t.y + t.h * fy) * sh).toFloat()
            }
            is Target.Element -> {
                val r = (svc ?: a11y()).findElement(t.selector)
                    ?: throw BackendException("no on-screen element matches ${describe(t.selector)}", ErrorCategory.TARGET)
                r.exactCenterX() to r.exactCenterY()
            }
            is Target.Image -> throw BackendException("image targets are not available on Android yet", ErrorCategory.UNSUPPORTED)
            Target.Current -> throw BackendException("Android has no pointer position; pick a point instead", ErrorCategory.UNSUPPORTED)
        }.also { (x, y) ->
            if (x < 0 || y < 0 || x > s.width || y > s.height) {
                throw BackendException("point ${x.roundToInt()},${y.roundToInt()} is outside the ${s.width}×${s.height} screen", ErrorCategory.TARGET)
            }
        }
    }

    private fun describe(sel: Target.ElementSelector) = listOfNotNull(
        sel.text?.let { "text \"$it\"" }, sel.name?.let { "name \"$it\"" }, sel.automationId?.let { "id \"$it\"" },
        sel.role?.let { "role $it" }, sel.app?.let { "in $it" },
    ).joinToString(", ").ifEmpty { "the selector" }

    override suspend fun perform(action: InputAction): Value? {
        when (action) {
            is InputAction.Click -> {
                val svc = a11y()
                svc.guardProtectedScreen()
                val (x, y) = point(action.target, svc)
                // Right click → long press (the Android context-menu gesture); other buttons tap.
                val hold = if (action.holdMs == 0L && action.button == "right") 600L else action.holdMs
                svc.tap(x, y, hold, action.clicks)
            }
            is InputAction.Drag -> {
                val svc = a11y()
                svc.guardProtectedScreen()
                val (x1, y1) = point(action.from, svc)
                val (x2, y2) = point(action.to, svc)
                svc.swipe(x1, y1, x2, y2, action.durationMs)
            }
            is InputAction.Scroll -> {
                val svc = a11y()
                svc.guardProtectedScreen()
                val s = DeviceState.screen(context)
                val (cx, cy) = action.target?.let { point(it, svc) } ?: ((s.width / 2f) to (s.height / 2f))
                // One wheel notch (120) ≈ a quarter screen. Positive dy scrolls content down → the finger moves up.
                fun dist(units: Int, size: Int) = (units / 120f * size * 0.25f).coerceIn(-size * 0.8f, size * 0.8f)
                val ddx = dist(action.dx, s.width)
                val ddy = dist(action.dy, s.height)
                if (abs(ddx) < 1 && abs(ddy) < 1) return null
                val x1 = (cx + ddx / 2).coerceIn(1f, s.width - 1f)
                val y1 = (cy + ddy / 2).coerceIn(1f, s.height - 1f)
                val x2 = (cx - ddx / 2).coerceIn(1f, s.width - 1f)
                val y2 = (cy - ddy / 2).coerceIn(1f, s.height - 1f)
                svc.swipe(x1, y1, x2, y2, 300)
            }
            is InputAction.Move -> throw BackendException("Android has no mouse pointer to move", ErrorCategory.UNSUPPORTED)
            is InputAction.Key -> {
                val svc = a11y()
                svc.guardProtectedScreen()
                svc.keys.send(action.key, action.modifiers, action.action)
            }
            is InputAction.TypeText -> {
                val svc = a11y()
                svc.guardProtectedScreen()
                svc.text.type(action.text, action.perCharDelayMs)
            }
            is InputAction.AndroidGlobal -> {
                val svc = a11y()
                svc.guardProtectedScreen()
                svc.globalAction(action.action)
            }
            is InputAction.LaunchApp -> launchApp(action.app, action.args)
            is InputAction.OpenUrl -> openUrl(action.url)
            is InputAction.ClipboardSet -> withContext(Dispatchers.Main) {
                context.getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("AutoFlow", action.value))
            }
            InputAction.ClipboardGet -> return withContext(Dispatchers.Main) {
                val clip = context.getSystemService(ClipboardManager::class.java).primaryClip
                    ?: throw BackendException(
                        "Android lets only the app in front (or the keyboard) read the clipboard; open AutoFlow first or use a clipboard set step",
                        ErrorCategory.ENVIRONMENT,
                    )
                Value.Str(if (clip.itemCount > 0) clip.getItemAt(0).coerceToText(context)?.toString() ?: "" else "")
            }
            is InputAction.Notify -> if (!Notifications.postFlowMessage(context, action.title, action.body)) {
                throw BackendException("notifications are turned off for AutoFlow", ErrorCategory.PERMISSION)
            }
            is InputAction.Http -> return http(action)
            is InputAction.FileOp -> return file(action)
            is InputAction.Ocr -> throw BackendException("text recognition (OCR) is not available on Android yet", ErrorCategory.UNSUPPORTED)
            is InputAction.FindImage -> throw BackendException("image search is not available on Android yet", ErrorCategory.UNSUPPORTED)
            is InputAction.SwitchProfile -> ProfileManager.activate(action.profileId)
            is InputAction.Window -> throw BackendException("Android has no desktop windows", ErrorCategory.UNSUPPORTED)
        }
        return null
    }

    override suspend fun confirm(message: String): Boolean = ConfirmBroker.ask(context, message)

    /* --------------------------------------------------------------- intents */

    private fun startActivity(intent: Intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        // Starting from the accessibility service's context is exempt from background-activity-start limits.
        val host: Context = AutoFlowAccessibilityService.instance ?: context
        try {
            host.startActivity(intent)
        } catch (e: Exception) {
            throw BackendException("could not open: ${e.message ?: e.javaClass.simpleName}", ErrorCategory.ACTION)
        }
    }

    private fun launchApp(pkg: String, args: List<String>) {
        AutoFlowAccessibilityService.instance?.guardPackage(pkg)
        val intent = context.packageManager.getLaunchIntentForPackage(pkg)
            ?: throw BackendException("app \"$pkg\" is not installed or has no launcher screen", ErrorCategory.TARGET)
        // Android apps take no argv: the first argument may be a URI to open with that app, the rest ride along as extras.
        args.firstOrNull()?.takeIf { it.contains("://") }?.let { intent.action = Intent.ACTION_VIEW; intent.data = Uri.parse(it) }
        if (args.isNotEmpty()) intent.putExtra("com.projectteamforyou.autoflow.ARGS", args.toTypedArray())
        startActivity(intent)
    }

    private fun openUrl(url: String) {
        val uri = Uri.parse(url)
        if (uri.scheme !in setOf("http", "https", "mailto", "tel", "geo", "market")) {
            throw BackendException("only http(s), mailto, tel, geo and market links can be opened", ErrorCategory.ACTION)
        }
        startActivity(Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE))
    }

    /* ------------------------------------------------------------------ http */

    private suspend fun http(a: InputAction.Http): Value = runInterruptible(Dispatchers.IO) {
        val url = try {
            URL(a.url)
        } catch (e: java.net.MalformedURLException) {
            throw BackendException("invalid URL", ErrorCategory.VALIDATION)
        }
        // Only network requests: file:, jar: or content-like schemes must never reach app-private data.
        if (url.protocol != "http" && url.protocol != "https") {
            throw BackendException("only http and https URLs are allowed", ErrorCategory.VALIDATION)
        }
        val conn = url.openConnection() as? HttpURLConnection
            ?: throw BackendException("only http and https URLs are allowed", ErrorCategory.VALIDATION)
        try {
            conn.requestMethod = a.method
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", "AutoFlow-Android")
            a.headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (a.body != null && a.method != "GET") {
                conn.doOutput = true
                conn.outputStream.use { it.write(a.body!!.toByteArray(Charsets.UTF_8)) }
            }
            val code = conn.responseCode
            val stream = if (code >= 400) conn.errorStream else conn.inputStream
            val text = stream?.use { readCapped(it, 1_000_000) } ?: ""
            if (code >= 400) throw BackendException("HTTP $code from ${URL(a.url).host}", ErrorCategory.ACTION)
            Value.Str(text)
        } catch (e: BackendException) {
            throw e
        } catch (e: java.io.IOException) {
            throw BackendException("request failed: ${e.message ?: e.javaClass.simpleName}", ErrorCategory.ACTION)
        } finally {
            conn.disconnect()
        }
    }

    private fun readCapped(input: java.io.InputStream, max: Int): String {
        val out = java.io.ByteArrayOutputStream()
        val buf = ByteArray(8192)
        while (out.size() < max) {
            val n = input.read(buf, 0, minOf(buf.size, max - out.size()))
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toString("UTF-8")
    }

    /* ------------------------------------------------------------------ file */

    /** Files are limited to AutoFlow's own folder (Android/data/<app>/files/AutoFlow): no broad storage permission. */
    private fun sandboxed(path: String): File {
        val root = File(context.getExternalFilesDir(null) ?: context.filesDir, "AutoFlow").apply { mkdirs() }
        val rel = path.removePrefix("/").removePrefix("AutoFlow/")
        val f = File(root, rel).canonicalFile
        val base = root.canonicalPath
        // Compare whole path segments: a plain prefix test would accept a sibling such as "AutoFlowOther".
        if (f.path != base && !f.path.startsWith(base + File.separator)) {
            throw BackendException("on Android, flows can only use files inside AutoFlow's own folder", ErrorCategory.PERMISSION)
        }
        return f
    }

    private suspend fun file(a: InputAction.FileOp): Value? = withContext(Dispatchers.IO) {
        val f = sandboxed(a.path)
        when (a.op) {
            "read" -> Value.Str(if (f.isFile) f.readText() else throw BackendException("file not found: ${a.path}", ErrorCategory.TARGET))
            "write" -> { f.parentFile?.mkdirs(); f.writeText(a.content ?: ""); null }
            "append" -> { f.parentFile?.mkdirs(); f.appendText(a.content ?: ""); null }
            "exists" -> Value.of(f.exists())
            "delete" -> { f.delete(); null }
            "copy", "move" -> {
                val dest = sandboxed(a.dest ?: throw BackendException("${a.op} needs a destination", ErrorCategory.VALIDATION))
                if (!f.isFile) throw BackendException("file not found: ${a.path}", ErrorCategory.TARGET)
                dest.parentFile?.mkdirs()
                f.copyTo(dest, overwrite = true)
                if (a.op == "move") f.delete()
                null
            }
            else -> throw BackendException("unknown file operation ${a.op}", ErrorCategory.VALIDATION)
        }
    }
}
