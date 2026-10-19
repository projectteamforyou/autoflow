package com.projectteamforyou.autoflow

import android.os.Build
import android.os.Bundle
import android.webkit.WebSettings
import com.getcapacitor.BridgeActivity
import com.projectteamforyou.autoflow.bridge.AutoFlowNativePlugin

/** Hosts the web app (apps/web/dist) and registers the native AutoFlow bridge. */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(AutoFlowNativePlugin::class.java)
        super.onCreate(savedInstanceState)
        hardenWebView()
    }

    /**
     * The app is served by Capacitor's local https server, so the WebView needs no file:// or content:// access, no
     * geolocation and no script-opened windows. Turning them off removes ways for injected content to read local
     * files or spawn windows outside the app's origin.
     */
    @Suppress("DEPRECATION")
    private fun hardenWebView() {
        val settings = bridge?.webView?.settings ?: return
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.allowFileAccessFromFileURLs = false
        settings.allowUniversalAccessFromFileURLs = false
        settings.setGeolocationEnabled(false)
        settings.javaScriptCanOpenWindowsAutomatically = false
        settings.setSupportMultipleWindows(false)
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) settings.safeBrowsingEnabled = true
    }
}
