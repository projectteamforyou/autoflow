package com.projectteamforyou.autoflow.engine

/**
 * Platform capability matrix — port of packages/core/src/capabilities.ts. Unsupported steps are blocked before a run
 * starts, never silently skipped.
 */
enum class Support(val rank: Int, val json: String) { SUPPORTED(0, "supported"), LIMITED(1, "limited"), UNSUPPORTED(2, "unsupported") }

data class CapabilityNote(val support: Support, val noteKey: String? = null)

private val S = CapabilityNote(Support.SUPPORTED)
private fun l(key: String) = CapabilityNote(Support.LIMITED, key)
private fun u(key: String) = CapabilityNote(Support.UNSUPPORTED, key)

/** step type → (windows, android, web) */
val STEP_CAPABILITIES: Map<String, Map<Platform, CapabilityNote>> = mapOf(
    "click" to row(S, l("cap.click.android"), l("cap.sandbox")),
    "move" to row(S, u("cap.move.android"), l("cap.sandbox")),
    "drag" to row(S, S, l("cap.sandbox")),
    "scroll" to row(S, l("cap.scroll.android"), l("cap.sandbox")),
    "key" to row(S, l("cap.key.android"), l("cap.sandbox")),
    "type" to row(S, l("cap.type.android"), l("cap.sandbox")),
    "wait" to row(S, S, S),
    "waitFor" to row(S, S, S),
    "setVar" to row(S, S, S),
    "log" to row(S, S, S),
    "notify" to row(S, S, S),
    "confirm" to row(S, S, S),
    "clipboard" to row(S, l("cap.clipboard.android"), l("cap.clipboard.web")),
    "launchApp" to row(S, S, u("cap.launchApp.web")),
    "openUrl" to row(S, S, S),
    "window" to row(S, u("cap.window.android"), u("cap.native")),
    "androidGlobal" to row(u("cap.androidOnly"), l("cap.androidGlobal"), l("cap.sandbox")),
    "http" to row(S, S, l("cap.http.web")),
    "file" to row(S, l("cap.file.android"), u("cap.native")),
    "ocr" to row(S, l("cap.ocr.android"), u("cap.native")),
    "findImage" to row(S, l("cap.findImage.android"), u("cap.native")),
    "runFlow" to row(S, S, S),
    "switchProfile" to row(S, l("cap.switchProfile.android"), u("cap.native")),
    "stop" to row(S, S, S),
    "break" to row(S, S, S),
    "continue" to row(S, S, S),
    "if" to row(S, S, S),
    "loop" to row(S, S, S),
    "forEach" to row(S, S, S),
    "try" to row(S, S, S),
    "group" to row(S, S, S),
)

val TRIGGER_CAPABILITIES: Map<String, Map<Platform, CapabilityNote>> = mapOf(
    "manual" to row(S, S, S),
    "hotkey" to row(S, l("cap.hotkey.android"), l("cap.hotkey.web")),
    "schedule" to row(S, l("cap.schedule.android"), l("cap.schedule.web")),
    "appEvent" to row(S, l("cap.appEvent.android"), u("cap.native")),
    "deviceEvent" to row(l("cap.deviceEvent.windows"), S, u("cap.native")),
    "location" to row(u("cap.location.windows"), l("cap.location.android"), u("cap.native")),
    "notification" to row(u("cap.notification.windows"), l("cap.notification.android"), u("cap.native")),
)

private fun row(w: CapabilityNote, a: CapabilityNote, web: CapabilityNote) = mapOf(Platform.WINDOWS to w, Platform.ANDROID to a, Platform.WEB to web)

fun targetSupport(t: Target, platform: Platform): CapabilityNote = when {
    t is Target.Element && platform == Platform.WEB -> u("cap.element.web")
    t is Target.Image && platform == Platform.WEB -> u("cap.native")
    t is Target.Current && platform == Platform.ANDROID -> u("cap.current.android")
    else -> S
}

data class CompatIssue(val stepId: String, val stepType: String, val support: Support, val noteKey: String?)

/** Lists every enabled step that is not fully supported on the platform. */
fun compatibility(steps: List<Step>, platform: Platform): List<CompatIssue> {
    val out = ArrayList<CompatIssue>()
    walkSteps(steps) { s, _, _ ->
        if (s.meta.disabled) return@walkSteps
        var worst = STEP_CAPABILITIES.getValue(s.type).getValue(platform)
        // capabilities.ts collects `step.target` (click/move/scroll/findImage) plus drag from/to.
        for (t in s.targets()) {
            val tc = targetSupport(t, platform)
            if (tc.support.rank > worst.support.rank) worst = tc
        }
        if (worst.support != Support.SUPPORTED) out.add(CompatIssue(s.id, s.type, worst.support, worst.noteKey))
    }
    return out
}

fun isRunnableOn(steps: List<Step>, platform: Platform): Boolean = compatibility(steps, platform).none { it.support == Support.UNSUPPORTED }
