package com.projectteamforyou.autoflow.engine

/*
 * Multi-monitor model and scene math — port of packages/core/src/displays.ts.
 *
 * Android has a single built-in display, but flows written on Windows may reference others: the engine resolves
 * references with the same canonical order and `onMissingDisplay` policy as every other engine, and places
 * display-relative coordinates with the shared rounding rule floor(v + 0.5). The dHash below is bit-identical to the
 * TypeScript and Rust implementations (fixtures/engine/dhash.json); Android itself cannot capture the screen, so scene
 * and pixel probes are blocked by the capability matrix there.
 */

/** A monitor reference: "primary", "secondary", a display id, or `{ index }` into the canonical order. */
sealed class DisplayRef {
    data class Index(val index: Int) : DisplayRef()
    data class Name(val name: String) : DisplayRef()

    /** Log label: `"secondary"`, `index 2`. */
    val label: String get() = when (this) {
        is Index -> "index $index"
        is Name -> "\"$name\""
    }

    /** Key under which warnings and "ask" answers are remembered per run. */
    val key: String get() = when (this) {
        is Index -> "#$index"
        is Name -> name
    }

    companion object {
        val PRIMARY = Name("primary")
    }
}

data class DisplayInfo(
    val id: String,
    val name: String,
    val primary: Boolean,
    val bounds: Target.Rect,
    val workArea: Target.Rect = bounds,
    val scale: Double = 1.0,
    val orientation: String = if (bounds.w >= bounds.h) "landscape" else "portrait",
)

/** Stage mode: the display a flow plays on. */
data class Stage(val display: DisplayRef, val pauseOnTakeover: Boolean? = null, val takeoverPx: Int? = null)

/** A remembered screen region with its perceptual hash. */
data class Scene(val name: String, val display: DisplayRef?, val region: Target.Rect, val hash: String, val thumb: String? = null)

/** Canonical order: primary first, then by left edge, then by top edge (stable). */
fun sortDisplays(list: List<DisplayInfo>): List<DisplayInfo> =
    list.sortedWith(compareBy<DisplayInfo>({ !it.primary }, { it.bounds.x }, { it.bounds.y }))

fun findDisplay(sorted: List<DisplayInfo>, ref: DisplayRef): DisplayInfo? = when (ref) {
    is DisplayRef.Index -> sorted.getOrNull(ref.index)
    is DisplayRef.Name -> when (ref.name) {
        "primary" -> sorted.firstOrNull()
        "secondary" -> sorted.getOrNull(1)
        else -> sorted.firstOrNull { it.id == ref.name }
    }
}

/** The one rounding rule for pixels: half up, also for negative coordinates. */
fun roundPx(v: Double): Double = Math.floor(v + 0.5)

fun onDisplay(b: Target.Rect, x: Double, y: Double): Boolean = x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h

fun placePoint(b: Target.Rect, x: Double, y: Double, space: String): Pair<Double, Double> = when (space) {
    "normalized" -> roundPx(b.x + x * b.w) to roundPx(b.y + y * b.h)
    "display" -> roundPx(b.x + x) to roundPx(b.y + y)
    else -> roundPx(x) to roundPx(y)
}

fun placeRect(b: Target.Rect, r: Target.Rect, space: String): Target.Rect {
    val sx = if (space == "normalized") b.w else 1.0
    val sy = if (space == "normalized") b.h else 1.0
    val ox = if (space == "screen") 0.0 else b.x
    val oy = if (space == "screen") 0.0 else b.y
    return Target.Rect(roundPx(ox + r.x * sx), roundPx(oy + r.y * sy), maxOf(1.0, roundPx(r.w * sx)), maxOf(1.0, roundPx(r.h * sy)))
}

fun rectOnDisplay(b: Target.Rect, r: Target.Rect): Boolean = r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h

private val HEX_COLOR = Regex("^#[0-9a-fA-F]{6}$")
private val HASH = Regex("^[0-9a-fA-F]{16}$")

/** Parses `#rrggbb` (any case) into r, g, b. */
fun parseColor(hex: String?): IntArray? {
    if (hex == null || !HEX_COLOR.matches(hex)) return null
    val n = hex.substring(1).toInt(16)
    return intArrayOf((n shr 16) and 255, (n shr 8) and 255, n and 255)
}

fun toHexColor(c: IntArray): String = "#" + c.joinToString("") { it.coerceIn(0, 255).toString(16).padStart(2, '0') }

fun colorDistance(a: IntArray, b: IntArray): Int = maxOf(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))

/** Integer luma (BT.601 weights, rounded). */
fun luma(r: Int, g: Int, b: Int): Long = (r * 299L + g * 587L + b * 114L + 500L) / 1000L

private fun span(i: Int, n: Int, size: Int): Pair<Int, Int> {
    val a = (i.toLong() * size / n).toInt()
    val b = minOf(size, maxOf(a + 1, ((i + 1).toLong() * size / n).toInt()))
    return minOf(a, size - 1) to b
}

/**
 * 64-bit difference hash of a [w]×[h] image read through [rgb] (returns r, g, b): integer luma, 9×8 box average, bit
 * y·8+x set when cell (x, y) is brighter than cell (x+1, y), 16 lowercase hex digits with bit 0 most significant.
 */
fun dhash(w: Int, h: Int, rgb: (Int, Int) -> IntArray): String? {
    if (w < 1 || h < 1) return null
    val cells = LongArray(72)
    for (cy in 0 until 8) {
        val (y0, y1) = span(cy, 8, h)
        for (cx in 0 until 9) {
            val (x0, x1) = span(cx, 9, w)
            var sum = 0L
            for (y in y0 until y1) for (x in x0 until x1) {
                val c = rgb(x, y)
                sum += luma(c[0], c[1], c[2])
            }
            cells[cy * 9 + cx] = sum / ((y1 - y0).toLong() * (x1 - x0))
        }
    }
    val sb = StringBuilder(16)
    for (nib in 0 until 16) {
        var v = 0
        for (k in 0 until 4) {
            val bit = nib * 4 + k
            val y = bit / 8
            val x = bit % 8
            v = (v shl 1) or (if (cells[y * 9 + x] > cells[y * 9 + x + 1]) 1 else 0)
        }
        sb.append(v.toString(16))
    }
    return sb.toString()
}

/** dHash of packed RGB(A) bytes ([channels] 3 or 4). */
fun dhashBytes(pixels: ByteArray, w: Int, h: Int, channels: Int): String? {
    if (pixels.size < w * h * channels || channels < 3) return null
    return dhash(w, h) { x, y ->
        val o = (y * w + x) * channels
        intArrayOf(pixels[o].toInt() and 255, pixels[o + 1].toInt() and 255, pixels[o + 2].toInt() and 255)
    }
}

fun isHash(s: String?): Boolean = s != null && HASH.matches(s)

/** Differing bits between two 16-digit hashes (64 when either is malformed). */
fun hammingDistance(a: String, b: String): Int {
    if (!isHash(a) || !isHash(b)) return 64
    return java.lang.Long.bitCount(java.lang.Long.parseUnsignedLong(a, 16) xor java.lang.Long.parseUnsignedLong(b, 16))
}

fun hashSimilarity(a: String, b: String): Double = (64 - hammingDistance(a, b)) / 64.0
