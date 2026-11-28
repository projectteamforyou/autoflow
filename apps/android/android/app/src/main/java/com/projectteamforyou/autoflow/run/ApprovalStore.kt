package com.projectteamforyou.autoflow.run

import android.content.Context
import android.content.SharedPreferences

/**
 * Flows whose risky steps were approved in the app: flow id → [com.projectteamforyou.autoflow.engine.Approvals.stepsHash]
 * at approval time, in private SharedPreferences. A trigger-started run (schedule, device event, hotkey) of a flow that
 * needs approval starts only when exactly these steps — and those of the flows it calls — were approved; otherwise it
 * fails with "risky steps were not approved", and the failure notification asks the user to run it once from the app.
 * Same rule as the Windows app's approved.json.
 */
object ApprovalStore {
    private const val PREFS = "autoflow.approvals"

    private fun prefs(context: Context): SharedPreferences = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun all(context: Context): Map<String, String> =
        prefs(context).all.mapNotNull { (k, v) -> (v as? String)?.let { k to it } }.toMap()

    /** Remembers an approval; a no-op when exactly this hash is already stored. */
    fun remember(context: Context, flowId: String, hash: String) {
        val p = prefs(context)
        if (p.getString(flowId, null) == hash) return
        p.edit().putString(flowId, hash).apply()
    }
}
