package com.projectteamforyou.autoflow.system

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.projectteamforyou.autoflow.R

/**
 * Foreground service of type `mediaProjection` that exists only while the user has screen capture enabled.
 *
 * Android 10+ refuses `MediaProjectionManager.getMediaProjection` unless a foreground service of this type is already
 * running, and Android 14+ additionally requires the `FOREGROUND_SERVICE_MEDIA_PROJECTION` permission. The service
 * takes the consent result from [AutoFlowNativePlugin][com.projectteamforyou.autoflow.bridge.AutoFlowNativePlugin],
 * calls `startForeground` first and only then hands the result to [ScreenCapture.attach]. Its notification always
 * offers Stop, which ends the capture session.
 */
class CaptureService : Service() {
    companion object {
        private const val TAG = "AutoFlowCaptureService"
        private const val ACTION_START = "com.projectteamforyou.autoflow.action.CAPTURE_START"
        private const val ACTION_STOP = "com.projectteamforyou.autoflow.action.CAPTURE_STOP"
        private const val EXTRA_RESULT_CODE = "resultCode"
        private const val EXTRA_RESULT_DATA = "resultData"

        /** Starts the service with the consent result; it attaches the projection once it is in the foreground. */
        fun start(context: Context, resultCode: Int, data: Intent): Boolean {
            val app = context.applicationContext
            val intent = Intent(app, CaptureService::class.java)
                .setAction(ACTION_START)
                .putExtra(EXTRA_RESULT_CODE, resultCode)
                .putExtra(EXTRA_RESULT_DATA, data)
            return try {
                ContextCompat.startForegroundService(app, intent)
                true
            } catch (e: Exception) {
                Log.w(TAG, "capture service not started: ${e.javaClass.simpleName}: ${e.message}")
                false
            }
        }

        fun stopIfRunning() {
            val svc = instance ?: return
            svc.stopSelf()
        }

        @Volatile private var instance: CaptureService? = null

        private fun stopAction(context: Context): PendingIntent = PendingIntent.getService(
            context, 3, Intent(context, CaptureService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        private fun buildNotification(context: Context): Notification = NotificationCompat.Builder(context, Notifications.CHANNEL_RUNS)
            .setSmallIcon(R.drawable.ic_stat_autoflow)
            .setContentTitle(context.getString(R.string.capture_notification_title))
            .setContentText(context.getString(R.string.capture_notification_text))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setContentIntent(Intents.openApp(context))
            .addAction(0, context.getString(R.string.capture_action_stop), stopAction(context))
            .build()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // startForeground first, always: a started FGS must call it within seconds even if it is about to stop.
        try {
            ServiceCompat.startForeground(
                this, Notifications.ID_CAPTURE_SERVICE, buildNotification(this),
                if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION else 0,
            )
        } catch (e: Exception) {
            Log.w(TAG, "startForeground failed: ${e.javaClass.simpleName}: ${e.message}")
            ScreenCapture.stop("foreground service refused")
            stopSelf()
            return START_NOT_STICKY
        }
        when (intent?.action) {
            ACTION_START -> {
                val code = intent.getIntExtra(EXTRA_RESULT_CODE, Int.MIN_VALUE)
                @Suppress("DEPRECATION")
                val data = intent.getParcelableExtra<Intent>(EXTRA_RESULT_DATA)
                val ok = code != Int.MIN_VALUE && data != null && ScreenCapture.attach(this, code, data)
                if (!ok) {
                    Log.w(TAG, "screen capture could not be attached")
                    stopSelf()
                }
            }
            ACTION_STOP -> ScreenCapture.stop("notification")
            else -> if (!ScreenCapture.isActive) stopSelf()
        }
        // Never restarted by the system on its own: a consent result cannot be replayed.
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        // The projection cannot outlive its foreground service (Android stops it anyway); keep our state in sync.
        if (ScreenCapture.isActive) ScreenCapture.stop("service destroyed")
        super.onDestroy()
    }

    override fun onTimeout(startId: Int, fgsType: Int) {
        ScreenCapture.stop("timeout")
        stopSelf()
    }
}
