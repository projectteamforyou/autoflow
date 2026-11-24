package com.projectteamforyou.autoflow.engine

/** Static risk analysis — port of packages/core/src/risk.ts (same weights, keys and thresholds). */
data class RiskFinding(val stepId: String?, val key: String, val weight: Int, val needsConfirm: Boolean)

data class RiskReport(val score: Int, val level: String, val findings: List<RiskFinding>, val needsConfirm: Boolean, val permissions: List<String>)

private val SENSITIVE_URL = Regex("(pay|checkout|bank|transfer|wallet|purchase|billing|order|captcha|login|signin|auth)", RegexOption.IGNORE_CASE)
/** A stored secret leaving the vault: typed, copied, shown or sent anywhere (`SECRET` in risk.ts). */
private val SECRET_REF = Regex("\\{\\{\\s*secret:")
/** `{{...}}` interpolation: the real target is only known at run time, so keyword checks can be dodged. */
private val DYNAMIC = Regex("\\{\\{")

private fun isLocalIpv4(o: List<Int>): Boolean {
    val a = o[0]
    val b = o[1]
    return a == 127 || a == 10 || a == 0 || (a == 172 && b in 16..31) || (a == 192 && b == 168) || (a == 169 && b == 254)
}

private val URL_SCHEME_RE = Regex("^[A-Za-z][A-Za-z0-9+.-]*:")
private val SPECIAL_SCHEMES = setOf("http", "https", "ws", "wss", "ftp")

/**
 * The host of a URL the way WHATWG `new URL(url).hostname` reports it for the special schemes (http, https, ws, wss,
 * ftp): leading/trailing C0 controls and spaces trimmed, tabs/newlines removed, `\` treated as `/`, user info and
 * port stripped, percent-escapes decoded, lower-cased. Null when the URL would not parse (no scheme, empty host,
 * whitespace in the host) or has no host (mailto:, file: and other opaque addresses). java.net.URI cannot be used:
 * it is RFC 2396 and refuses the template URLs flows contain (`{{var}}`, spaces).
 */
internal fun whatwgHostname(url: String): String? {
    val s = url.trim { it <= ' ' }.filter { it != '\t' && it != '\n' && it != '\r' }
    val m = URL_SCHEME_RE.find(s) ?: return null
    if (m.value.dropLast(1).lowercase() !in SPECIAL_SCHEMES) return null
    var i = m.value.length
    while (i < s.length && (s[i] == '/' || s[i] == '\\')) i++
    val end = s.indexOfAny(charArrayOf('/', '\\', '?', '#'), i).let { if (it < 0) s.length else it }
    val authority = s.substring(i, end).substringAfterLast('@')
    val host = if (authority.startsWith("[")) {
        if (']' !in authority) return null // "[::1" is a parse failure
        authority.substringBefore(']') + "]"
    } else authority.substringBeforeLast(':')
    if (host.isEmpty() || host.any { it <= ' ' }) return null
    if (host.startsWith("[")) return host.lowercase()
    return percentDecode(host).lowercase()
}

private fun percentDecode(s: String): String {
    if ('%' !in s) return s
    val bytes = java.io.ByteArrayOutputStream()
    var i = 0
    while (i < s.length) {
        val c = s[i]
        val hex = if (c == '%' && i + 2 < s.length) s.substring(i + 1, i + 3).toIntOrNull(16) else null
        if (hex != null) {
            bytes.write(hex)
            i += 3
        } else {
            bytes.write(c.toString().toByteArray(Charsets.UTF_8))
            i++
        }
    }
    return bytes.toByteArray().toString(Charsets.UTF_8)
}

/**
 * WHATWG IPv4 number parser: decimal, `0x`-hex or leading-zero octal; null when the part is not a number. An empty
 * part is not a number, except that `0x` alone is 0.
 */
private fun ipv4Number(part: String): Long? {
    if (part.isEmpty()) return null
    var p = part
    var radix = 10
    if (p.length >= 2 && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) {
        p = p.substring(2)
        radix = 16
        if (p.isEmpty()) return 0
    } else if (p.length >= 2 && p[0] == '0') {
        p = p.substring(1)
        radix = 8
    }
    if (p.any { it == '+' || it == '-' }) return null
    return p.toLongOrNull(radix)
}

/**
 * WHATWG IPv4 parser, the one `new URL().hostname` applies before serializing a host: up to four dot-separated
 * numbers (decimal, hex `0x…` or octal `0…`), the last of which fills the remaining bytes, so `0x7f000001`,
 * `0177.0.0.1`, `127.1` and `2130706433` all are 127.0.0.1. Returns the four octets, or null when the host is a
 * domain name (or an out-of-range IPv4 literal, which WHATWG rejects as a URL altogether).
 */
internal fun whatwgIpv4(host: String): List<Int>? {
    val parts = host.split('.').toMutableList()
    if (parts.size > 1 && parts.last().isEmpty()) parts.removeAt(parts.size - 1)
    if (parts.size > 4) return null
    val numbers = parts.map { ipv4Number(it) ?: return null }
    if (numbers.dropLast(1).any { it > 255 }) return null
    var pow = 1L
    repeat(5 - numbers.size) { pow *= 256 }
    if (numbers.last() >= pow) return null
    var ipv4 = numbers.last()
    for ((i, n) in numbers.dropLast(1).withIndex()) {
        var f = 1L
        repeat(3 - i) { f *= 256 }
        ipv4 += n * f
    }
    return listOf((ipv4 shr 24).toInt() and 255, (ipv4 shr 16).toInt() and 255, (ipv4 shr 8).toInt() and 255, ipv4.toInt() and 255)
}

/**
 * Same rule as isLocalNetworkUrl in packages/core/src/risk.ts: localhost, 127/8, 10/8, 172.16/12, 192.168/16,
 * 169.254/16, 0/8, ::1, fc00::/7, fe80::/10 and IPv4-mapped IPv6. Hosts are read the WHATWG way (`new URL` in TS,
 * the `url` crate in Rust), so every spelling of an IPv4 literal is caught. Never resolves DNS.
 */
fun isLocalNetworkUrl(url: String): Boolean {
    var host = whatwgHostname(url) ?: return false
    host = host.trimEnd('.')
    if (host == "localhost" || host.endsWith(".localhost")) return true
    whatwgIpv4(host)?.let { return isLocalIpv4(it) }
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
            if (s.body != null && SECRET_REF.containsMatchIn(s.body)) add("risk.secretExposed", 20, true)
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
        is Step.Clipboard -> {
            if (s.op == "get") add("risk.clipboardRead", 8, false)
            if (s.op == "set" && s.value != null && SECRET_REF.containsMatchIn(s.value)) add("risk.secretExposed", 20, true)
        }
        is Step.Notify -> if (SECRET_REF.containsMatchIn(s.title) || SECRET_REF.containsMatchIn(s.body)) add("risk.secretExposed", 20, true)
        is Step.Confirm -> if (SECRET_REF.containsMatchIn(s.message)) add("risk.secretExposed", 20, true)
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
