package com.projectteamforyou.autoflow.run

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.projectteamforyou.autoflow.R
import com.projectteamforyou.autoflow.engine.RunState
import com.projectteamforyou.autoflow.system.Intents
import com.projectteamforyou.autoflow.system.Notifications

/**
 * Foreground service that exists only while at least one flow is running (type `specialUse`, see the
 * PROPERTY_SPECIAL_USE_FGS_SUBTYPE in the manifest and docs/PLAY_RELEASE.md). It keeps a user-started automation alive
 * while the user is in another app and always offers Stop in the notification. `shortService` is not used because
 * runs legitimately last longer than its 3-minute budget (default limit is 10 minutes).
 */
class RunService : Service() {
    companion object {
        private const val TAG = "AutoFlowRunService"
        const val ACTION_STOP_ALL = "com.projectteamforyou.autoflow.action.STOP_ALL"
        const val ACTION_PAUSE_ALL = "com.projectteamforyou.autoflow.action.PAUSE_ALL"
        const val ACTION_RESUME_ALL = "com.projectteamforyou.autoflow.action.RESUME_ALL"
        private const val ACTION_REFRESH = "com.projectteamforyou.autoflow.action.REFRESH"

        @Volatile private var running = false
        @Volatile private var lastUpdate = 0L

        /** Starts, refreshes or stops the service to match RunManager. Throttled to ~4 updates/s. */
        fun update(context: Context) {
            val app = context.applicationContext
            if (!RunManager.hasActiveRuns()) {
                if (running) app.stopService(Intent(app, RunService::class.java))
                return
            }
            val now = SystemClock.elapsedRealtime()
            if (running && now - lastUpdate < 250) return
            lastUpdate = now
            if (running) {
                // Already foreground: just refresh the notification.
                if (Notifications.canPost(app)) {
                    try {
                        NotificationManagerCompat.from(app).notify(Notifications.ID_RUN_SERVICE, buildNotification(app))
                    } catch (_: SecurityException) {
                    }
                }
                return
            }
            try {
                ContextCompat.startForegroundService(app, Intent(app, RunService::class.java).setAction(ACTION_REFRESH))
            } catch (e: Exception) {
                // Android 12+ refuses background FGS starts unless exempt. The run still proceeds: the process is kept
                // alive by the bound accessibility service, and Halt stays reachable from the floating button.
                Log.w(TAG, "foreground service not started: ${e.javaClass.simpleName}")
            }
        }

        private fun action(context: Context, action: String, code: Int): PendingIntent = PendingIntent.getService(
            context, code, Intent(context, RunService::class.java).setAction(action), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        fun buildNotification(context: Context): Notification {
            val runs = RunManager.active().toList()
            val first = runs.firstOrNull()
            val title = when {
                runs.size > 1 -> context.getString(R.string.run_notification_many, runs.size)
                first != null -> context.getString(R.string.run_notification_one, first.flow.name)
                else -> context.getString(R.string.app_name)
            }
            val text = when (first?.state) {
                RunState.COUNTDOWN -> context.getString(R.string.run_state_countdown, ((first.countdownMs + 999) / 1000).toInt())
                RunState.PAUSED -> context.getString(R.string.run_state_paused)
                else -> context.getString(R.string.run_state_running)
            }
            val paused = runs.isNotEmpty() && runs.all { it.state == RunState.PAUSED }
            return NotificationCompat.Builder(context, Notifications.CHANNEL_RUNS)
                .setSmallIcon(R.drawable.ic_stat_autoflow)
                .setContentTitle(title)
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(Intents.openApp(context))
                .addAction(0, context.getString(R.string.action_stop), action(context, ACTION_STOP_ALL, 1))
                .addAction(
                    0,
                    context.getString(if (paused) R.string.action_resume else R.string.action_pause),
                    action(context, if (paused) ACTION_RESUME_ALL else ACTION_PAUSE_ALL, 2),
                )
                .build()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // startForeground first, always: a started FGS must call it within seconds even if it is about to stop.
        try {
            ServiceCompat.startForeground(
                this, Notifications.ID_RUN_SERVICE, buildNotification(this),
                if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
            )
            running = true
        } catch (e: Exception) {
            Log.w(TAG, "startForeground failed: ${e.javaClass.simpleName}")
            stopSelf()
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_STOP_ALL -> RunManager.haltAll("notification")
            ACTION_PAUSE_ALL -> RunManager.pauseAll()
            ACTION_RESUME_ALL -> RunManager.resumeAll()
        }
        if (!RunManager.hasActiveRuns()) stopSelf()
        // Never restarted by the system on its own: a run cannot resume after the process died.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        // Not reached for specialUse; kept so a future type change cannot leave runs without a stop.
        RunManager.haltAll("timeout")
        stopSelf()
    }
}
