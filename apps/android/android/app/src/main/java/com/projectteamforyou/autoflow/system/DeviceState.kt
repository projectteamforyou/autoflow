package com.projectteamforyou.autoflow.system

import android.app.AlarmManager
import android.content.ComponentName
import android.content.Context
import android.hardware.input.InputManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.DisplayMetrics
import android.view.InputDevice
import android.view.WindowManager
import androidx.core.app.NotificationManagerCompat
import com.projectteamforyou.autoflow.BuildConfig
import com.projectteamforyou.autoflow.a11y.AutoFlowAccessibilityService
import com.projectteamforyou.autoflow.engine.ScreenInfo
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

const val ENGINE_VERSION = "1.0.0"

/** Screen geometry, permission status and device info for the bridge (`device_info`, `permissions_status`). */
object DeviceState {
    /** Real (full) display size in physical px, in the current rotation, plus density as scale. */
    fun screen(context: Context): ScreenInfo {
        val wm = context.getSystemService(WindowManager::class.java)
        val density = context.resources.displayMetrics.density.toDouble()
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.maximumWindowMetrics.bounds
            ScreenInfo(b.width(), b.height(), density)
        } else {
            val m = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(m)
            ScreenInfo(m.widthPixels, m.heightPixels, density)
        }
    }

    /** The built-in display as a bridge `DisplayInfo` (id "primary", like the engine's default display). */
    fun displayJson(context: Context): JsonObject {
        val s = screen(context)
        val bounds = buildJsonObject { put("x", 0); put("y", 0); put("w", s.width); put("h", s.height) }
        return buildJsonObject {
            put("id", "primary")
            put("name", "Built-in display")
            put("primary", true)
            put("bounds", bounds)
            put("workArea", bounds)
            put("scale", s.scale)
            put("orientation", if (s.width >= s.height) "landscape" else "portrait")
        }
    }

    fun accessibilityEnabled(context: Context): Boolean {
        val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
        val me = ComponentName(context, AutoFlowAccessibilityService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }

    fun notificationListenerEnabled(context: Context): Boolean =
        NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.packageName)

    fun ignoringBatteryOptimizations(context: Context): Boolean =
        context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) ?: false

    fun canScheduleExactAlarms(context: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || (context.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() ?: false)

    /** OEMs known to kill background work beyond stock Android's battery optimization. */
    private fun oemHint(): String? = when (Build.MANUFACTURER.lowercase()) {
        "samsung" -> "Samsung: Settings › Battery › Background usage limits › Never sleeping apps › add AutoFlow"
        "xiaomi", "redmi", "poco" -> "Xiaomi: App info › Battery saver › No restrictions, and enable Autostart"
        "huawei", "honor" -> "Huawei/Honor: App launch › AutoFlow › Manage manually (allow all)"
        "oppo", "realme", "oneplus" -> "OPPO/realme/OnePlus: App info › Battery usage › Allow background activity"
        "vivo" -> "vivo: Battery › Background power consumption › allow AutoFlow"
        else -> null
    }

    fun permissionStatus(context: Context, permission: String): JsonObject {
        val (granted, detail) = when (permission) {
            "accessibility" -> {
                val on = accessibilityEnabled(context)
                on to if (on && AutoFlowAccessibilityService.instance == null) "enabled, waiting for Android to connect the service" else null
            }
            "overlay" -> true to "AutoFlow draws its stop button through the accessibility service; no overlay permission is needed"
            "notifications" -> Notifications.canPost(context) to null
            "location" -> false to "location triggers are not available on Android yet"
            "notificationListener" -> notificationListenerEnabled(context) to null
            "batteryOptimization" -> ignoringBatteryOptimizations(context) to listOfNotNull(
                "exactAlarms=${if (canScheduleExactAlarms(context)) "granted" else "denied"}",
                oemHint(),
            ).joinToString(" · ")
            "inputMonitoring" -> accessibilityEnabled(context) to "hardware keyboard keys only, through the accessibility service"
            else -> false to "unknown permission"
        }
        return buildJsonObject {
            put("permission", permission)
            put("granted", granted)
            detail?.let { put("detail", it) }
        }
    }

    val PERMISSIONS = listOf("accessibility", "overlay", "notifications", "location", "notificationListener", "batteryOptimization", "inputMonitoring")

    fun deviceInfo(context: Context): JsonObject {
        val s = screen(context)
        val im = context.getSystemService(InputManager::class.java)
        return buildJsonObject {
            put("platform", "android")
            put("os", "Android")
            put("osVersion", Build.VERSION.RELEASE ?: "")
            put("appVersion", BuildConfig.VERSION_NAME)
            put("engineVersion", ENGINE_VERSION)
            put(
                "screens",
                buildJsonArray {
                    add(buildJsonObject { put("width", s.width); put("height", s.height); put("scale", s.scale); put("x", 0); put("y", 0); put("primary", true) })
                },
            )
            put("apiLevel", Build.VERSION.SDK_INT)
            put("manufacturer", Build.MANUFACTURER ?: "")
            put(
                "inputDevices",
                buildJsonArray {
                    for (id in im?.inputDeviceIds ?: IntArray(0)) {
                        val d = im?.getInputDevice(id) ?: continue
                        if (d.isVirtual) continue
                        add(
                            buildJsonObject {
                                put("id", d.descriptor ?: id.toString())
                                put("name", d.name ?: "")
                                put("kind", kindOf(d))
                                if (d.vendorId != 0) put("vendorId", d.vendorId)
                                if (d.productId != 0) put("productId", d.productId)
                            },
                        )
                    }
                },
            )
        }
    }

    fun kindOf(d: InputDevice): String {
        fun has(src: Int) = d.sources and src == src
        return when {
            has(InputDevice.SOURCE_GAMEPAD) || has(InputDevice.SOURCE_JOYSTICK) -> "gamepad"
            has(InputDevice.SOURCE_MOUSE) -> "mouse"
            has(InputDevice.SOURCE_TOUCHSCREEN) -> "touch"
            has(InputDevice.SOURCE_KEYBOARD) && d.keyboardType == InputDevice.KEYBOARD_TYPE_ALPHABETIC -> "keyboard"
            else -> "other"
        }
    }
}
