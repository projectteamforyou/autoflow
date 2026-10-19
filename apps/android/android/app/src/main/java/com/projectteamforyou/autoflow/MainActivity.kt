package com.projectteamforyou.autoflow

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.projectteamforyou.autoflow.bridge.AutoFlowNativePlugin

/** Hosts the web app (apps/web/dist) and registers the native AutoFlow bridge. */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(AutoFlowNativePlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
