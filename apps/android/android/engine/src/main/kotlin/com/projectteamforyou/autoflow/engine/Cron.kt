package com.projectteamforyou.autoflow.engine

import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/**
 * Standard 5-field cron (minute hour day-of-month month day-of-week) in the device's local time zone, as used by
 * schedule triggers. Supports `*`, numbers, ranges `a-b`, steps `*&#47;n` / `a-b/n`, lists, and JAN–DEC / SUN–SAT names.
 * Day-of-week accepts 0–7 (0 and 7 are Sunday). When both day fields are restricted, either may match (Vixie cron).
 */
class Cron private constructor(
    private val minutes: BooleanArray,
    private val hours: BooleanArray,
    private val days: BooleanArray,
    private val months: BooleanArray,
    private val weekdays: BooleanArray,
    private val domRestricted: Boolean,
    private val dowRestricted: Boolean,
) {
    companion object {
        private val MONTHS = listOf("JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC")
        private val DAYS = listOf("SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT")
        private val MACROS = mapOf(
            "@hourly" to "0 * * * *", "@daily" to "0 0 * * *", "@midnight" to "0 0 * * *", "@weekly" to "0 0 * * 0",
            "@monthly" to "0 0 1 * *", "@yearly" to "0 0 1 1 *", "@annually" to "0 0 1 1 *",
        )

        fun parse(expr: String): Cron {
            val src = MACROS[expr.trim().lowercase()] ?: expr.trim()
            val f = src.split(Regex("\\s+"))
            require(f.size == 5) { "cron needs 5 fields (minute hour day month weekday), got ${f.size}" }
            val dow = field(f[4], 0, 7, DAYS)
            if (dow[7]) dow[0] = true
            return Cron(
                field(f[0], 0, 59), field(f[1], 0, 23), field(f[2], 1, 31), field(f[3], 1, 12, MONTHS, offset = 1), dow.copyOf(7),
                domRestricted = f[2] != "*" && f[2] != "?", dowRestricted = f[4] != "*" && f[4] != "?",
            )
        }

        private fun value(token: String, names: List<String>?, offset: Int): Int {
            names?.indexOf(token.uppercase())?.takeIf { it >= 0 }?.let { return it + offset }
            return token.toIntOrNull() ?: throw IllegalArgumentException("invalid cron value \"$token\"")
        }

        private fun field(spec: String, min: Int, max: Int, names: List<String>? = null, offset: Int = 0): BooleanArray {
            val out = BooleanArray(max + 1)
            for (part in spec.split(',')) {
                require(part.isNotEmpty()) { "empty cron list item" }
                val (range, stepText) = part.split('/').let { it[0] to it.getOrNull(1) }
                val step = stepText?.toIntOrNull()?.takeIf { it > 0 } ?: if (stepText == null) 1 else throw IllegalArgumentException("invalid cron step \"$stepText\"")
                val (lo, hi) = when {
                    range == "*" || range == "?" -> min to max
                    range.contains('-') -> range.split('-').let { value(it[0], names, offset) to value(it[1], names, offset) }
                    else -> value(range, names, offset).let { it to if (stepText != null) max else it }
                }
                require(lo in min..max && hi in min..max && lo <= hi) { "cron value out of range in \"$part\" ($min-$max)" }
                for (v in lo..hi step step) out[v] = true
            }
            return out
        }
    }

    private fun dayMatches(t: ZonedDateTime): Boolean {
        val dom = days[t.dayOfMonth]
        val dow = weekdays[t.dayOfWeek.value % 7]
        return when {
            domRestricted && dowRestricted -> dom || dow
            domRestricted -> dom
            dowRestricted -> dow
            else -> true
        }
    }

    /** The first matching minute strictly after [after], or null if none within ~5 years (e.g. "0 0 31 2 *"). */
    fun next(after: ZonedDateTime): ZonedDateTime? {
        var t = after.truncatedTo(ChronoUnit.MINUTES).plusMinutes(1)
        val limit = after.plusYears(5)
        while (t.isBefore(limit)) {
            if (!months[t.monthValue]) {
                t = t.withDayOfMonth(1).truncatedTo(ChronoUnit.DAYS).plusMonths(1)
                continue
            }
            if (!dayMatches(t)) {
                t = t.truncatedTo(ChronoUnit.DAYS).plusDays(1)
                continue
            }
            if (!hours[t.hour]) {
                t = t.truncatedTo(ChronoUnit.HOURS).plusHours(1)
                continue
            }
            if (!minutes[t.minute]) {
                t = t.plusMinutes(1)
                continue
            }
            return t
        }
        return null
    }
}
