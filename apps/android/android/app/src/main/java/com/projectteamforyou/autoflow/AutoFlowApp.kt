package com.projectteamforyou.autoflow

import android.app.Application
import com.projectteamforyou.autoflow.system.Notifications
import com.projectteamforyou.autoflow.triggers.TriggerEngine

class AutoFlowApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        // Restores synced triggers (device events, hotkeys, app events) whenever the process starts — e.g. when Android
        // binds the accessibility service after a reboot or an app update.
        TriggerEngine.init(this)
    }
}
