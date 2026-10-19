package com.projectteamforyou.autoflow.a11y

import com.projectteamforyou.autoflow.engine.Target
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtectedScreensTest {
    @Test fun blocksSecuritySurfaces() {
        assertNotNull(ProtectedScreens.reason("com.android.settings", "com.android.settings.SubSettings", false))
        assertNotNull(ProtectedScreens.reason("com.google.android.permissioncontroller", "GrantPermissionsActivity", false))
        assertNotNull(ProtectedScreens.reason("com.android.packageinstaller", null, false))
        assertNotNull(ProtectedScreens.reason("com.android.systemui", "com.android.systemui.keyguard.KeyguardBouncer", false))
        assertNotNull(ProtectedScreens.reason("com.example.app", "MainActivity", keyguardLocked = true))
    }

    @Test fun allowsOrdinaryApps() {
        assertNull(ProtectedScreens.reason("com.example.app", "MainActivity", false))
        assertNull(ProtectedScreens.reason("com.android.systemui", "android.widget.FrameLayout", false))
        assertNull(ProtectedScreens.reason(null, null, false))
    }

    @Test fun elementSelectors() {
        val sel = Target.ElementSelector(text = "send", role = "Button")
        assertTrue(NodeFinder.matches(sel, "com.chat", "Send now", null, null, "android.widget.Button"))
        assertFalse(NodeFinder.matches(sel, "com.chat", "Send now", null, null, "android.widget.TextView"))
        val byId = Target.ElementSelector(automationId = "submit", app = "com.shop")
        assertTrue(NodeFinder.matches(byId, "com.shop", null, null, "com.shop:id/submit", null))
        assertFalse(NodeFinder.matches(byId, "com.other", null, null, "com.shop:id/submit", null))
    }
}
