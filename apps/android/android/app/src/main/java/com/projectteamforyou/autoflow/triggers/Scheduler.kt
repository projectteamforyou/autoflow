package com.projectteamforyou.autoflow.triggers

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.projectteamforyou.autoflow.R
import com.projectteamforyou.autoflow.engine.Cron
import com.projectteamforyou.autoflow.engine.Flow
import com.projectteamforyou.autoflow.engine.Trigger
import com.projectteamforyou.autoflow.run.RunManager
import com.projectteamforyou.autoflow.system.DeviceState
import com.projectteamforyou.autoflow.system.Notifications
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.ZonedDateTime
import java.util.concurrent.TimeUnit

/**
 * Schedule triggers. WorkManager periodic work for intervals ≥ 15 minutes (Android's minimum); exact alarms only when
 * the user granted "Alarms & reminders" (SCHEDULE_EXACT_ALARM is never assumed); cron times without that permission
 * run as inexact one-shot work that Android may delay to save battery.
 */
object Scheduler {
    private const val TAG = "AutoFlowScheduler"
    const val MIN_PERIODIC_MS = 15 * 60_000L
    private const val KEY_FLOW = "flowId"
    /** Per flow, the time (epoch ms) of the occurrence a one-shot alarm or one-shot work is currently set for. */
    private const val PREFS = "autoflow.schedule"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun noteNext(context: Context, flowId: String, at: Long) = prefs(context).edit().putLong(flowId, at).apply()

    private fun workName(id: String) = "schedule-$id"

    fun reconcile(context: Context, previous: Collection<Flow>, next: Collection<Flow>) {
        val nextById = next.associateBy { it.id }
        for (p in previous) {
            val n = nextById[p.id]
            if (p.trigger is Trigger.Schedule && (n == null || n.trigger != p.trigger)) cancel(context, p.id)
        }
        val prevById = previous.associateBy { it.id }
        for (n in next) {
            if (n.trigger !is Trigger.Schedule) continue
            // Unchanged schedules keep their pending work (KEEP); changed ones were cancelled above.
            scheduleNext(context, n, replace = prevById[n.id]?.trigger != n.trigger)
        }
    }

    fun cancel(context: Context, flowId: String) {
        WorkManager.getInstance(context).cancelUniqueWork(workName(flowId))
        context.getSystemService(AlarmManager::class.java)?.cancel(alarmIntent(context, flowId))
        prefs(context).edit().remove(flowId).apply()
    }

    private fun alarmIntent(context: Context, flowId: String): PendingIntent = PendingIntent.getBroadcast(
        context, flowId.hashCode(),
        Intent(context, AlarmReceiver::class.java).setAction("com.projectteamforyou.autoflow.SCHEDULE").putExtra(KEY_FLOW, flowId),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** Schedules the next firing of [flow]; called on sync, after each firing and after boot. */
    fun scheduleNext(context: Context, flow: Flow, replace: Boolean = true) {
        val t = flow.trigger as? Trigger.Schedule ?: return
        val now = System.currentTimeMillis()
        val end = t.endAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() }
        if (end != null && end <= now) {
            cancel(context, flow.id)
            return
        }
        val start = t.startAt?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: now
        val wm = WorkManager.getInstance(context)
        val exact = DeviceState.canScheduleExactAlarms(context)
        val cron = t.cron
        val everyMs = t.everyMs
        when {
            cron != null -> {
                val from = ZonedDateTime.now().let { z -> if (start > now) ZonedDateTime.ofInstant(Instant.ofEpochMilli(start - 60_000), z.zone) else z }
                val at = runCatching { Cron.parse(cron).next(from) }.getOrNull()?.toInstant()?.toEpochMilli() ?: return
                if (end != null && at > end) return
                noteNext(context, flow.id, at)
                if (exact) setAlarm(context, flow.id, at) else oneShot(context, flow.id, at - now)
            }
            everyMs != null && everyMs >= MIN_PERIODIC_MS -> {
                val req = PeriodicWorkRequestBuilder<ScheduleWorker>(everyMs, TimeUnit.MILLISECONDS)
                    .setInitialDelay(maxOf(start - now, everyMs), TimeUnit.MILLISECONDS)
                    .setInputData(workDataOf(KEY_FLOW to flow.id))
                    .addTag("autoflow-schedule")
                    .build()
                wm.enqueueUniquePeriodicWork(workName(flow.id), if (replace) ExistingPeriodicWorkPolicy.UPDATE else ExistingPeriodicWorkPolicy.KEEP, req)
            }
            everyMs != null && exact -> {
                val at = maxOf(start, now + everyMs)
                noteNext(context, flow.id, at)
                setAlarm(context, flow.id, at)
            }
            else -> Log.w(TAG, "${flow.id}: interval under 15 minutes without exact-alarm permission — not scheduled")
        }
    }

    private fun oneShot(context: Context, flowId: String, delayMs: Long) {
        val req = OneTimeWorkRequestBuilder<ScheduleWorker>()
            .setInitialDelay(maxOf(0, delayMs), TimeUnit.MILLISECONDS)
            .setInputData(workDataOf(KEY_FLOW to flowId, "oneShot" to true))
            .addTag("autoflow-schedule")
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(workName(flowId), ExistingWorkPolicy.REPLACE, req)
    }

    private fun setAlarm(context: Context, flowId: String, at: Long) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        try {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarmIntent(context, flowId))
        } catch (e: SecurityException) {
            // Permission revoked between the check and the call: fall back to inexact work.
            oneShot(context, flowId, at - System.currentTimeMillis())
        }
    }

    /**
     * A retried one-shot worker: the flow is not started again, but the following occurrence must exist. If the first
     * attempt died before it rescheduled, nothing would fire until the next sync or boot. Idempotent: when the first
     * attempt (or a sync since) already set a later occurrence, that one is kept as it is.
     */
    fun ensureNextScheduled(context: Context, flowId: String) {
        TriggerEngine.init(context)
        val flow = TriggerEngine.all().firstOrNull { it.id == flowId } ?: return
        if (flow.trigger !is Trigger.Schedule) return
        // An alarm or delayed work never runs before its time, so a noted time in the future was set after this firing.
        if (prefs(context).getLong(flowId, 0L) > System.currentTimeMillis()) return
        scheduleNext(context, flow)
    }

    /** Fires a scheduled flow and (for one-shot kinds) schedules the following occurrence. */
    suspend fun fireScheduled(context: Context, flowId: String, rescheduleAfter: Boolean) {
        TriggerEngine.init(context)
        val flow = TriggerEngine.all().firstOrNull { it.id == flowId } ?: return
        val t = flow.trigger as? Trigger.Schedule ?: return
        val now = System.currentTimeMillis()
        val startOk = t.startAt?.let { runCatching { Instant.parse(it).toEpochMilli() <= now }.getOrDefault(true) } ?: true
        val endOk = t.endAt?.let { runCatching { Instant.parse(it).toEpochMilli() > now }.getOrDefault(true) } ?: true
        if (rescheduleAfter) scheduleNext(context, flow)
        if (!startOk || !endOk) return
        val runId = RunManager.startFromTrigger(context, flow, "schedule") ?: return
        // Keep the worker (and so the process) alive while the run lasts, within WorkManager's 10-minute budget.
        val deadline = System.currentTimeMillis() + 9 * 60_000L
        while (RunManager.isActiveRun(runId) && System.currentTimeMillis() < deadline) delay(500)
    }

    class ScheduleWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
        override suspend fun doWork(): Result {
            val id = inputData.getString(KEY_FLOW) ?: return Result.success()
            // The system may stop this worker while it waits for the run (expedited jobs have a small quota) and
            // WorkManager then runs it again: the flow already started, so a retry must not start it a second time.
            // The following occurrence is still made sure of: the first attempt may have died before scheduling it.
            if (runAttemptCount > 0) {
                if (inputData.getBoolean("oneShot", false)) ensureNextScheduled(applicationContext, id)
                return Result.success()
            }
            fireScheduled(applicationContext, id, rescheduleAfter = inputData.getBoolean("oneShot", false))
            return Result.success()
        }

        /**
         * Only asked for expedited work (the hand-off from [AlarmReceiver]) on Android 11 and older, where WorkManager
         * runs it in its own foreground service; Android 12+ uses expedited jobs and never shows this.
         */
        override suspend fun getForegroundInfo(): ForegroundInfo = ForegroundInfo(
            Notifications.ID_SCHEDULE_WORKER,
            NotificationCompat.Builder(applicationContext, Notifications.CHANNEL_RUNS)
                .setSmallIcon(R.drawable.ic_stat_autoflow)
                .setContentTitle(applicationContext.getString(R.string.app_name))
                .setContentText(applicationContext.getString(R.string.channel_runs))
                .setOngoing(true)
                .build(),
        )
    }

    class AlarmReceiver : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val id = intent.getStringExtra(KEY_FLOW) ?: return
            // Hand over to a one-shot worker at once (a receiver only gets ~10 s; the run may last minutes).
            // Expedited: ordinary work is deferred in Doze, which would undo setExactAndAllowWhileIdle. No initial
            // delay and no constraints (expedited work allows neither); out of quota it runs as ordinary work.
            val req = OneTimeWorkRequestBuilder<ScheduleWorker>()
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setInputData(workDataOf(KEY_FLOW to id, "oneShot" to true))
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("${workName(id)}-now", ExistingWorkPolicy.REPLACE, req)
        }
    }
}
