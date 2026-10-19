package com.projectteamforyou.autoflow.keyforge

import android.content.Context
import android.content.Intent
import android.util.Log
import com.projectteamforyou.autoflow.a11y.AutoFlowAccessibilityService
import com.projectteamforyou.autoflow.bridge.BridgeEvents
import com.projectteamforyou.autoflow.engine.Keyforge
import com.projectteamforyou.autoflow.triggers.TriggerEngine
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive

/**
 * Applies Keyforge profiles (`profiles_apply`) on Android: picks the active profile from the app in front and runs
 * hardware-key mappings through the accessibility service. `switchProfile` steps pin a profile until the next
 * profiles_apply or app change that matches another rule set.
 */
object ProfileManager {
    private const val TAG = "AutoFlowKeyforge"

    @Volatile private var profiles: List<Keyforge.Profile> = emptyList()
    @Volatile private var enabled = false
    @Volatile private var pinned: String? = null
    @Volatile private var foregroundApp: String? = null
    @Volatile private var active: Keyforge.Profile? = null

    fun hasMappings() = enabled && profiles.any { it.enabled && it.mappings.isNotEmpty() }

    /** Returns the active profile id and warnings for what Android cannot apply. */
    fun apply(json: JsonElement, enable: Boolean): Pair<String?, List<String>> {
        val (parsed, warnings) = Keyforge.parse(json as? JsonArray ?: JsonArray(emptyList()))
        profiles = parsed
        enabled = enable
        pinned = null
        val w = warnings.toMutableList()
        if (enable && parsed.any { it.mappings.isNotEmpty() } && AutoFlowAccessibilityService.instance == null) {
            w.add("Key mappings need the AutoFlow accessibility service and a hardware keyboard")
        }
        recompute()
        AutoFlowAccessibilityService.instance?.updateKeyFiltering()
        return active?.id to w
    }

    fun activate(profileId: String) {
        pinned = profileId
        recompute()
    }

    fun onForegroundApp(pkg: String) {
        foregroundApp = pkg
        if (pinned == null) recompute()
    }

    private fun recompute() {
        val next = if (!enabled) null else pinned?.let { id -> profiles.firstOrNull { it.id == id } }
            ?: Keyforge.resolveActive(profiles, Keyforge.Context(app = foregroundApp))
        if (next?.id != active?.id) {
            active = next
            BridgeEvents.profileActivated(next?.id)
        }
    }

    private fun mappingFor(combo: String) = active?.mappings?.firstOrNull { it.combo == combo }

    fun onKey(service: AutoFlowAccessibilityService, combo: String): Boolean {
        val m = mappingFor(combo) ?: return false
        perform(service, m)
        return true
    }

    fun onRepeat(service: AutoFlowAccessibilityService, combo: String): Boolean {
        val m = mappingFor(combo) ?: return false
        if (m.repeat == "whileHeld") perform(service, m)
        return true
    }

    private fun str(o: Keyforge.Output, k: String) = (o.json[k] as? JsonPrimitive)?.content

    private fun perform(service: AutoFlowAccessibilityService, m: Keyforge.Mapping) {
        try {
            val to = m.to
            when (to.kind) {
                "disabled" -> Unit
                "text" -> service.text.focusedEditable()?.let { n -> service.text.setText(n, service.text.currentText(n) + (str(to, "text") ?: "")) }
                "key" -> service.keys.send(str(to, "key") ?: return, (to.json["modifiers"] as? JsonArray)?.map { it.jsonPrimitive.content } ?: emptyList(), "press")
                "launch" -> launch(service, str(to, "app") ?: return)
                "flow" -> TriggerEngine.fireById(service, str(to, "flowId") ?: return, "keyforge")
                "media" -> service.keys.send(
                    when (str(to, "action")) {
                        "playPause" -> "MediaPlayPause"
                        "next" -> "MediaTrackNext"
                        "previous" -> "MediaTrackPrevious"
                        "volumeUp" -> "AudioVolumeUp"
                        "volumeDown" -> "AudioVolumeDown"
                        else -> "AudioVolumeMute"
                    },
                    emptyList(), "press",
                )
            }
        } catch (e: Exception) {
            Log.w(TAG, "mapping ${m.id} failed: ${e.message}")
        }
    }

    private fun launch(context: Context, pkg: String) {
        val i = context.packageManager.getLaunchIntentForPackage(pkg) ?: return
        context.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}
