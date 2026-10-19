package com.projectteamforyou.autoflow.triggers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.projectteamforyou.autoflow.engine.Trigger

/**
 * BOOT_COMPLETED / MY_PACKAGE_REPLACED: restores schedules (alarms do not survive a reboot) and fires
 * `deviceEvent: bootCompleted` flows — only when the user left "start with the device" (autostart_set) on.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        TriggerEngine.init(context)
        if (!TriggerEngine.autostart(context)) return
        val flows = TriggerEngine.all()
        flows.filter { it.trigger is Trigger.Schedule }.forEach { Scheduler.scheduleNext(context, it, replace = false) }
        DeviceEventMonitor.reconcile(context, flows.any { it.trigger is Trigger.DeviceEvent })
        if (action == Intent.ACTION_BOOT_COMPLETED) TriggerEngine.onDeviceEvent(context, "bootCompleted")
    }
}

/**
 * Notification triggers. Only package name and title/text of new notifications are compared, in memory, against the
 * user's own trigger rules; nothing is stored, logged or sent. Requires the user to grant notification access.
 */
class NotificationTriggerService : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        sbn ?: return
        if (sbn.packageName == packageName) return
        TriggerEngine.init(this)
        if (TriggerEngine.all().none { it.trigger is Trigger.Notification }) return
        val extras = sbn.notification?.extras
        val text = listOfNotNull(
            extras?.getCharSequence(android.app.Notification.EXTRA_TITLE),
            extras?.getCharSequence(android.app.Notification.EXTRA_TEXT),
            extras?.getCharSequence(android.app.Notification.EXTRA_BIG_TEXT),
        ).joinToString("\n")
        TriggerEngine.onNotification(this, sbn.packageName, text)
    }
}
