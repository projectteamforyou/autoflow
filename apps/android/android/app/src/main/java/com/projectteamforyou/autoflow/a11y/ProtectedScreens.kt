package com.projectteamforyou.autoflow.a11y

/**
 * Screens AutoFlow must never act on (product rule "no system security screens", Play's Accessibility API policy):
 * the lock screen / keyguard, runtime-permission and app-install dialogs, credential pickers and every page of the
 * system Settings apps (accessibility, security, special app access, device admin…). Settings is blocked as a whole
 * because most of its pages share one activity class (SubSettings), so a per-page check could be bypassed.
 *
 * When one of these comes to the front, running flows fail with category "permission" and no gesture, key or text is
 * sent until it is gone.
 */
object ProtectedScreens {
    /** Packages blocked in full. */
    val PACKAGES: Set<String> = setOf(
        // runtime permission dialogs and permission settings
        "com.google.android.permissioncontroller",
        "com.android.permissioncontroller",
        // package installer / uninstall confirmation
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        // credential manager / passkeys, device lock & biometric prompts
        "com.android.credentialmanager",
        "com.google.android.gms.auth",
        // system Settings (AOSP + OEM forks) and OEM security centres
        "com.android.settings",
        "com.android.settings.intelligence",
        "com.samsung.android.settings",
        "com.samsung.android.biometrics.app.setting",
        "com.samsung.android.sm.devicesecurity",
        "com.miui.securitycenter",
        "com.miui.securitymanager",
        "com.coloros.safecenter",
        "com.oplus.safecenter",
        "com.huawei.systemmanager",
        "com.vivo.permissionmanager",
        "com.iqoo.secure",
        "com.android.managedprovisioning",
        "com.android.devicelockcontroller",
    )

    /** Window classes inside otherwise-allowed packages (System UI, Play services) that are security surfaces. */
    private val SENSITIVE_CLASS_HINTS = listOf("keyguard", "bouncer", "lockscreen", "biometric", "fingerprint", "credential", "authenticat")

    /** Packages where only [SENSITIVE_CLASS_HINTS] windows are blocked (the notification shade stays usable). */
    private val CLASS_CHECKED = setOf("com.android.systemui", "com.google.android.gms", "android")

    /**
     * Returns a user-facing reason when the foreground window is protected, or null when AutoFlow may act.
     * [keyguardLocked] blocks everything: no automation while the device is locked.
     */
    fun reason(packageName: String?, className: String?, keyguardLocked: Boolean): String? {
        if (keyguardLocked) return "the device is locked"
        val pkg = packageName ?: return null
        if (pkg in PACKAGES) return "a protected system screen ($pkg) is in front"
        if (pkg in CLASS_CHECKED) {
            val cls = className?.lowercase() ?: return null
            if (SENSITIVE_CLASS_HINTS.any { cls.contains(it) }) return "a protected system screen ($pkg) is in front"
        }
        return null
    }
}
