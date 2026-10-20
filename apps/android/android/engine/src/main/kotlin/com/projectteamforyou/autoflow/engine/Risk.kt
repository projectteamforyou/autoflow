package com.projectteamforyou.autoflow.engine

/** Static risk analysis — port of packages/core/src/risk.ts (same weights, keys and thresholds). */
data class RiskFinding(val stepId: String?, val key: String, val weight: Int, val needsConfirm: Boolean)

data class RiskReport(val score: Int, val level: String, val findings: List<RiskFinding>, val needsConfirm: Boolean, val permissions: List<String>)

private val SENSITIVE_URL = Regex("(pay|checkout|bank|transfer|wallet|purchase|billing|order|captcha|login|signin|auth)", RegexOption.IGNORE_CASE)
private val SECRET_REF = Regex("\\{\\{\\s*secret:")
/** `{{...}}` interpolation: the real target is only known at run time, so keyword checks can be dodged. */
private val DYNAMIC = Regex("\\{\\{")

private fun isLocalIpv4(o: List<Int>): Boolean {
    val a = o[0]
    val b = o[1]
    return a == 127 || a == 10 || a == 0 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
}

/**
 * Same rule as isLocalNetworkUrl in packages/core/src/risk.ts: localhost, 127/8, 10/8, 172.16/12, 192.168/16,
 * 169.254/16, 0/8, ::1, fc00::/7, fe80::/10 and IPv4-mapped IPv6. Never resolves DNS.
 */
fun isLocalNetworkUrl(url: String): Boolean {
    var host = runCatching { java.net.URI(url.trim()).host }.getOrNull()?.lowercase() ?: return false
    host = host.trimEnd('.')
    if (host == "localhost" || host.endsWith(".localhost")) return true
    // WHATWG URL parsing reads a bare number as an IPv4 address (http://2130706433/ is 127.0.0.1).
    host.toLongOrNull()?.let { n -> return n in 0..0xFFFFFFFFL && isLocalIpv4(listOf((n shr 24).toInt() and 255, (n shr 16).toInt() and 255)) }
    Regex("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$").matchEntire(host)?.let { m -> return isLocalIpv4(m.groupValues.drop(1).map { it.toInt() }) }
    if (host.startsWith("[") && host.endsWith("]")) {
        val bytes = runCatching { java.net.InetAddress.getByName(host.substring(1, host.length - 1)).address }.getOrNull() ?: return false
        if (bytes.size == 4) return isLocalIpv4(bytes.map { it.toInt() and 255 })
        val u = bytes.map { it.toInt() and 255 }
        if (u.subList(0, 15).all { it == 0 } && (u[15] == 0 || u[15] == 1)) return true
        if ((u[0] and 0xfe) == 0xfc || (u[0] == 0xfe && (u[1] and 0xc0) == 0x80)) return true
        if (u.subList(0, 10).all { it == 0 } && u[10] == 0xff && u[11] == 0xff) return isLocalIpv4(u.subList(12, 16))
    }
    return false
}

private fun stepFindings(s: Step): List<RiskFinding> {
    val f = ArrayList<RiskFinding>()
    fun add(key: String, w: Int, confirm: Boolean) = f.add(RiskFinding(s.id, key, w, confirm))
    when (s) {
        is Step.File -> when (s.op) {
            "delete" -> add("risk.fileDelete", 35, true)
            "write", "move" -> add("risk.fileWrite", 20, true)
            // append grows/creates files and copy can overwrite its destination: both change files.
            "append", "copy" -> add("risk.fileWrite", 12, true)
            else -> add("risk.fileRead", 6, false)
        }
        is Step.Http -> {
            if (s.method == "GET") add("risk.networkRead", 8, false) else add("risk.networkSend", 25, true)
            if (SENSITIVE_URL.containsMatchIn(s.url)) add("risk.sensitiveUrl", 20, true)
            if (DYNAMIC.containsMatchIn(s.url)) add("risk.dynamicUrl", 10, true)
            // Even a GET leaks whatever variables or secrets are interpolated into its headers.
            if (s.headers.values.any { DYNAMIC.containsMatchIn(it) }) add("risk.requestVars", 10, true)
            if (isLocalNetworkUrl(s.url)) add("risk.localNetwork", 15, true)
        }
        is Step.LaunchApp -> add("risk.launchApp", 10, false)
        is Step.OpenUrl -> {
            if (SENSITIVE_URL.containsMatchIn(s.url)) add("risk.sensitiveUrl", 15, true)
            if (DYNAMIC.containsMatchIn(s.url)) add("risk.dynamicUrl", 10, true)
        }
        is Step.Type -> if (SECRET_REF.containsMatchIn(s.text)) add("risk.secretInput", 10, false)
        is Step.Window -> if (s.op == "close") add("risk.windowClose", 12, false)
        is Step.AndroidGlobal -> if (s.action == "lockScreen" || s.action == "powerDialog") add("risk.systemAction", 10, false)
        is Step.Clipboard -> if (s.op == "get") add("risk.clipboardRead", 8, false)
        is Step.Ocr, is Step.FindImage, is Step.PixelCheck, is Step.WaitForPixel, is Step.MatchScene -> add("risk.screenRead", 8, false)
        is Step.Loop -> if (s.mode == "forever") add("risk.foreverLoop", 5, false)
        else -> Unit
    }
    if (s.condition()?.probesScreen == true) add("risk.screenRead", 8, false)
    return f
}

private val PERMISSION_OF = mapOf(
    "click" to "perm.input", "move" to "perm.input", "drag" to "perm.input", "scroll" to "perm.input", "key" to "perm.input", "type" to "perm.input",
    "clipboard" to "perm.clipboard", "launchApp" to "perm.apps", "openUrl" to "perm.browser", "window" to "perm.windows", "http" to "perm.network",
    "file" to "perm.files", "ocr" to "perm.screen", "findImage" to "perm.screen", "notify" to "perm.notifications", "androidGlobal" to "perm.accessibility",
    "pixelCheck" to "perm.screen", "waitForPixel" to "perm.screen", "matchScene" to "perm.screen",
)

fun analyzeRisk(flow: Flow): RiskReport {
    val findings = ArrayList<RiskFinding>()
    val perms = sortedSetOf<String>()
    walkSteps(flow.steps) { s, _, _ ->
        if (s.meta.disabled) return@walkSteps
        findings.addAll(stepFindings(s))
        PERMISSION_OF[s.type]?.let { perms.add(it) }
        if (s.condition()?.probesScreen == true) perms.add("perm.screen")
    }
    // Stage mode without the takeover pause keeps clicking even while the user grabs the mouse.
    if (flow.stage?.pauseOnTakeover == false) findings.add(RiskFinding(null, "risk.stageNoTakeover", 12, false))
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
