package com.projectteamforyou.autoflow

import android.os.Build
import android.os.Bundle
import android.webkit.WebSettings
import android.webkit.WebView
import com.getcapacitor.BridgeActivity
import com.projectteamforyou.autoflow.a11y.AccessibilityDisclosure
import com.projectteamforyou.autoflow.bridge.AutoFlowNativePlugin

/** Hosts the web app (apps/web/dist) and registers the native AutoFlow bridge. */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(AutoFlowNativePlugin::class.java)
        super.onCreate(savedInstanceState)
        hardenWebView()
        // capacitor.config.json keeps WebView debugging off (it applies to release builds too); debug builds turn it
        // back on so CI can drive the UI over Chrome DevTools (scripts/play/demo-video.mjs). Release builds never do.
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)
        // Play policy: explain the Accessibility service up front, inside the app, before it is ever requested.
        if (savedInstanceState == null) window.decorView.postDelayed({ AccessibilityDisclosure.maybeShowOnFirstRun(this) }, 700)
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
