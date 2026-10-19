package com.projectteamforyou.autoflow.run

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.projectteamforyou.autoflow.R
import com.projectteamforyou.autoflow.a11y.AutoFlowAccessibilityService
import com.projectteamforyou.autoflow.engine.BackendException
import com.projectteamforyou.autoflow.engine.ErrorCategory
import com.projectteamforyou.autoflow.system.Notifications
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.ConcurrentHashMap

/**
 * `confirm` steps: asks the user Yes/No. With the accessibility service on, a small dialog is drawn over the current
 * app (TYPE_ACCESSIBILITY_OVERLAY); otherwise a high-priority notification with Yes/No actions is posted. Stopping
 * the run removes the question.
 */
object ConfirmBroker {
    private const val EXTRA_ID = "id"
    private const val EXTRA_ANSWER = "answer"
    private val pending = ConcurrentHashMap<Int, CompletableDeferred<Boolean>>()

    suspend fun ask(context: Context, message: String): Boolean {
        AutoFlowAccessibilityService.instance?.let { svc ->
            return svc.overlays.confirm(message)
        }
        if (!Notifications.canPost(context)) {
            throw BackendException("a confirm step needs the accessibility service or notifications to ask you", ErrorCategory.PERMISSION)
        }
        val id = Notifications.newId()
        val answer = CompletableDeferred<Boolean>()
        pending[id] = answer
        try {
            withContext(Dispatchers.Main) { post(context, id, message) }
            return answer.await()
        } finally {
            pending.remove(id)
            NotificationManagerCompat.from(context).cancel(id)
        }
    }

    private fun post(context: Context, id: Int, message: String) {
        fun action(yes: Boolean) = PendingIntent.getBroadcast(
            context, id * 2 + if (yes) 1 else 0,
            Intent(context, AnswerReceiver::class.java).putExtra(EXTRA_ID, id).putExtra(EXTRA_ANSWER, yes),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(context, Notifications.CHANNEL_CONFIRM)
            .setSmallIcon(R.drawable.ic_stat_autoflow)
            .setContentTitle(context.getString(R.string.confirm_title))
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setOngoing(true)
            .addAction(0, context.getString(R.string.confirm_yes), action(true))
            .addAction(0, context.getString(R.string.confirm_no), action(false))
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, n)
        } catch (_: SecurityException) {
            pending.remove(id)?.complete(false)
        }
    }

    class AnswerReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val id = intent.getIntExtra(EXTRA_ID, -1)
            pending.remove(id)?.complete(intent.getBooleanExtra(EXTRA_ANSWER, false))
            NotificationManagerCompat.from(context).cancel(id)
        }
    }
}
