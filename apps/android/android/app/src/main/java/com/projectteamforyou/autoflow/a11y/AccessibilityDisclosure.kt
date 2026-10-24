package com.projectteamforyou.autoflow.a11y

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import com.projectteamforyou.autoflow.R
import com.projectteamforyou.autoflow.system.DeviceState
import com.projectteamforyou.autoflow.system.Intents

/**
 * Google Play "prominent disclosure" for the AccessibilityService API (User Data policy).
 *
 * A native dialog, shown inside the app during normal use and always before AutoFlow sends the user to Android's
 * Accessibility settings: on first launch, and from every path that opens those settings (bridge
 * `permission_request` / `open_settings`). It names the data the service accesses, what it is used for and that it is
 * not collected or shared, and asks for an explicit Agree / No thanks. Back and taps outside do not dismiss it.
 */
object AccessibilityDisclosure {
    private const val PREFS = "autoflow.a11y"
    private const val KEY_ACCEPTED = "disclosure_accepted_v1"
    private const val KEY_FIRST_RUN_SHOWN = "disclosure_first_run_shown_v1"

    @Volatile private var showing = false

    fun accepted(context: Context): Boolean = prefs(context).getBoolean(KEY_ACCEPTED, false)

    /**
     * Shows the disclosure (on the UI thread) and calls [onResult] with the user's answer. On Agree it also opens
     * Android Settings › Accessibility with AutoFlow's entry highlighted. Never short-circuits on an earlier Agree:
     * the user sees what they agree to every time AutoFlow sends them to that screen.
     */
    fun request(activity: Activity, onResult: (agreed: Boolean) -> Unit) {
        activity.runOnUiThread {
            if (activity.isFinishing || activity.isDestroyed || showing) return@runOnUiThread onResult(false)
            showing = true
            AlertDialog.Builder(activity)
                .setTitle(R.string.a11y_disclosure_title)
                .setMessage(R.string.a11y_disclosure_body)
                .setCancelable(false)
                .setPositiveButton(R.string.a11y_disclosure_agree) { _, _ ->
                    prefs(activity).edit().putBoolean(KEY_ACCEPTED, true).apply()
                    Intents.start(activity, Intents.settings(activity, "accessibility"))
                    onResult(true)
                }
                .setNegativeButton(R.string.a11y_disclosure_decline) { _, _ -> onResult(false) }
                .setOnDismissListener { showing = false }
                .show()
        }
    }

    /** First launch: explain the service once, up front, if it is not on yet. Later requests come from the app's UI. */
    fun maybeShowOnFirstRun(activity: Activity) {
        val p = prefs(activity)
        if (p.getBoolean(KEY_FIRST_RUN_SHOWN, false) || DeviceState.accessibilityEnabled(activity)) return
        p.edit().putBoolean(KEY_FIRST_RUN_SHOWN, true).apply()
        request(activity) { }
    }

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
