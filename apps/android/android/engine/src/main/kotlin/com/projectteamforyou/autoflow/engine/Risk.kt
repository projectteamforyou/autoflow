package com.projectteamforyou.autoflow.engine

/** Static risk analysis — port of packages/core/src/risk.ts (same weights, keys and thresholds). */
data class RiskFinding(val stepId: String?, val key: String, val weight: Int, val needsConfirm: Boolean)

data class RiskReport(val score: Int, val level: String, val findings: List<RiskFinding>, val needsConfirm: Boolean, val permissions: List<String>)

private val SENSITIVE_URL = Regex("(pay|checkout|bank|transfer|wallet|purchase|billing|order|captcha|login|signin|auth)", RegexOption.IGNORE_CASE)
private val SECRET_REF = Regex("\\{\\{\\s*secret:")

private fun stepFindings(s: Step): List<RiskFinding> {
    val f = ArrayList<RiskFinding>()
    fun add(key: String, w: Int, confirm: Boolean) = f.add(RiskFinding(s.id, key, w, confirm))
    when (s) {
        is Step.File -> when (s.op) {
            "delete" -> add("risk.fileDelete", 35, true)
            "write", "move" -> add("risk.fileWrite", 20, true)
            "append", "copy" -> add("risk.fileWrite", 12, false)
            else -> add("risk.fileRead", 6, false)
        }
        is Step.Http -> {
            if (s.method == "GET") add("risk.networkRead", 8, false) else add("risk.networkSend", 25, true)
            if (SENSITIVE_URL.containsMatchIn(s.url)) add("risk.sensitiveUrl", 20, true)
        }
        is Step.LaunchApp -> add("risk.launchApp", 10, false)
        is Step.OpenUrl -> if (SENSITIVE_URL.containsMatchIn(s.url)) add("risk.sensitiveUrl", 15, true)
        is Step.Type -> if (SECRET_REF.containsMatchIn(s.text)) add("risk.secretInput", 10, false)
        is Step.Window -> if (s.op == "close") add("risk.windowClose", 12, false)
        is Step.AndroidGlobal -> if (s.action == "lockScreen" || s.action == "powerDialog") add("risk.systemAction", 10, false)
        is Step.Clipboard -> if (s.op == "get") add("risk.clipboardRead", 8, false)
        is Step.Ocr, is Step.FindImage -> add("risk.screenRead", 8, false)
        is Step.Loop -> if (s.mode == "forever") add("risk.foreverLoop", 5, false)
        else -> Unit
    }
    return f
}

private val PERMISSION_OF = mapOf(
    "click" to "perm.input", "move" to "perm.input", "drag" to "perm.input", "scroll" to "perm.input", "key" to "perm.input", "type" to "perm.input",
    "clipboard" to "perm.clipboard", "launchApp" to "perm.apps", "openUrl" to "perm.browser", "window" to "perm.windows", "http" to "perm.network",
    "file" to "perm.files", "ocr" to "perm.screen", "findImage" to "perm.screen", "notify" to "perm.notifications", "androidGlobal" to "perm.accessibility",
)

fun analyzeRisk(flow: Flow): RiskReport {
    val findings = ArrayList<RiskFinding>()
    val perms = sortedSetOf<String>()
    walkSteps(flow.steps) { s, _, _ ->
        if (s.meta.disabled) return@walkSteps
        findings.addAll(stepFindings(s))
        PERMISSION_OF[s.type]?.let { perms.add(it) }
    }
    when (flow.trigger) {
        is Trigger.Location -> {
            findings.add(RiskFinding(null, "risk.location", 10, false))
            perms.add("perm.location")
        }
        is Trigger.Notification -> {
            findings.add(RiskFinding(null, "risk.notificationRead", 10, false))
            perms.add("perm.notificationAccess")
        }
        else -> Unit
    }
    if (flow.trigger !is Trigger.Manual && flow.trigger !is Trigger.HotkeyTrigger) findings.add(RiskFinding(null, "risk.unattended", 8, false))
    if (flow.limits.maxDurationMs > 3_600_000) findings.add(RiskFinding(null, "risk.longRun", 5, false))
    val score = minOf(100, findings.sumOf { it.weight })
    val level = if (score >= 40) "high" else if (score >= 15) "medium" else "low"
    return RiskReport(score, level, findings, findings.any { it.needsConfirm }, perms.toList())
}
