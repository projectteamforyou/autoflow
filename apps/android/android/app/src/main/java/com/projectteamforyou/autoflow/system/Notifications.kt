package com.projectteamforyou.autoflow.system

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.projectteamforyou.autoflow.R
import java.util.concurrent.atomic.AtomicInteger

/** Notification channels and helpers. Channel names/descriptions are localized in res/values-*\/strings.xml. */
object Notifications {
    const val CHANNEL_RUNS = "runs"
    const val CHANNEL_FLOW = "flow_messages"
    const val CHANNEL_CONFIRM = "confirm"
    const val ID_RUN_SERVICE = 1001
    private val nextId = AtomicInteger(2000)

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CHANNEL_RUNS, context.getString(R.string.channel_runs), NotificationManager.IMPORTANCE_LOW).apply {
                    description = context.getString(R.string.channel_runs_desc)
                    setShowBadge(false)
                },
                NotificationChannel(CHANNEL_FLOW, context.getString(R.string.channel_flow), NotificationManager.IMPORTANCE_DEFAULT).apply {
                    description = context.getString(R.string.channel_flow_desc)
                },
                NotificationChannel(CHANNEL_CONFIRM, context.getString(R.string.channel_confirm), NotificationManager.IMPORTANCE_HIGH).apply {
                    description = context.getString(R.string.channel_confirm_desc)
                },
            ),
        )
    }

    fun canPost(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return false
        return NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    fun newId(): Int = nextId.incrementAndGet()

    /** A `notify` step. Returns false when the user has not allowed notifications. */
    fun postFlowMessage(context: Context, title: String, body: String): Boolean {
        if (!canPost(context)) return false
        val n = NotificationCompat.Builder(context, CHANNEL_FLOW)
            .setSmallIcon(R.drawable.ic_stat_autoflow)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(Intents.openApp(context))
            .build()
        try {
            NotificationManagerCompat.from(context).notify(newId(), n)
        } catch (_: SecurityException) {
            return false
        }
        return true
    }
}
