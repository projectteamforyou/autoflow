package com.projectteamforyou.autoflow.system

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.projectteamforyou.autoflow.MainActivity
import com.projectteamforyou.autoflow.a11y.AutoFlowAccessibilityService

/** Settings deep links and PendingIntents used across the app. */
object Intents {
    fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** The settings page for a bridge `open_settings` page / `permission_request` permission. */
    fun settings(context: Context, page: String): Intent {
        val pkg = context.packageName
        val appDetails = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", pkg, null))
        val i = when (page) {
            "accessibility", "inputMonitoring" -> accessibilitySettings(context)
            "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.fromParts("package", pkg, null))
            "notifications" -> Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg)
            "notificationListener" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
            // The list page needs no REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission (a Play-restricted permission).
            "batteryOptimization" -> Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            "exactAlarm" -> if (Build.VERSION.SDK_INT >= 31) Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.fromParts("package", pkg, null)) else appDetails
            else -> appDetails
        }
        return i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }

    private fun accessibilitySettings(context: Context): Intent {
        val i = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        // Android 11+ honours a highlight of our own entry (AOSP ":settings:fragment_args_key").
        val component = ComponentName(context, AutoFlowAccessibilityService::class.java).flattenToString()
        i.putExtra(":settings:fragment_args_key", component)
        i.putExtra(":settings:show_fragment_args", android.os.Bundle().apply { putString(":settings:fragment_args_key", component) })
        return i
    }

    fun start(context: Context, intent: Intent): Boolean = try {
        context.startActivity(intent)
        true
    } catch (_: Exception) {
        try {
            context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            true
        } catch (_: Exception) {
            false
        }
    }
}
