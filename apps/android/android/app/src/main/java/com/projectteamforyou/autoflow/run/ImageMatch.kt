package com.projectteamforyou.autoflow.run

import android.graphics.BitmapFactory
import com.projectteamforyou.autoflow.engine.BackendException
import com.projectteamforyou.autoflow.engine.ErrorCategory
import com.projectteamforyou.autoflow.system.ScreenCapture
import java.io.File
import kotlin.math.sqrt

/**
 * Template-image search used by `findImage` and image targets — a line-for-line port of crates/engine/src/imagematch.rs
 * so a template scores the same on Windows and Android.
 *
 * Two-level zero-mean normalised cross-correlation: a coarse pass over a downscaled copy picks candidates, which are
 * refined at full resolution. Scores are in [-1, 1] and compared with the step's `confidence`.
 */
object ImageMatch {
    /** Grayscale image with float luma per pixel (row-major). */
    class Gray(val w: Int, val h: Int, val px: FloatArray)

    /** Thrown by [findTemplate] when [stopped] reports the run was stopped mid-search. */
    class Stopped : RuntimeException("stopped")

    /** From a screen capture (RGBA bytes, top-down rows): 0.299 R + 0.587 G + 0.114 B. */
    fun fromCapture(c: ScreenCapture.Capture): Gray {
        val n = c.w * c.h
        val px = FloatArray(n)
        val b = c.rgba
        for (i in 0 until n) {
            val o = i * 4
            px[i] = 0.299f * (b[o].toInt() and 255) + 0.587f * (b[o + 1].toInt() and 255) + 0.114f * (b[o + 2].toInt() and 255)
        }
        return Gray(c.w, c.h, px)
    }

    /** Loads a PNG (or any bitmap Android decodes) as grayscale; alpha is ignored like `load_png`. */
    fun loadTemplate(file: File): Gray {
        if (!file.isFile) throw BackendException("template image ${file.path} not found", ErrorCategory.TARGET)
        val opts = BitmapFactory.Options().apply { inPreferredConfig = android.graphics.Bitmap.Config.ARGB_8888 }
        val bmp = BitmapFactory.decodeFile(file.path, opts) ?: throw BackendException("invalid PNG: ${file.name}", ErrorCategory.ACTION)
        val w = bmp.width
        val h = bmp.height
        if (w == 0 || h == 0) {
            bmp.recycle()
            throw BackendException("template image is empty", ErrorCategory.ACTION)
        }
        val argb = IntArray(w * h)
        bmp.getPixels(argb, 0, w, 0, 0, w, h)
        bmp.recycle()
        val px = FloatArray(w * h)
        for (i in argb.indices) {
            val c = argb[i]
            px[i] = 0.299f * ((c shr 16) and 255) + 0.587f * ((c shr 8) and 255) + 0.114f * (c and 255)
        }
        return Gray(w, h, px)
    }

    private fun downscale(g: Gray, s: Int): Gray {
        if (s <= 1) return g
        val w = g.w / s
        val h = g.h / s
        val px = FloatArray(w * h)
        val area = (s * s).toFloat()
        for (y in 0 until h) {
            for (x in 0 until w) {
                var acc = 0f
                for (dy in 0 until s) {
                    val row = (y * s + dy) * g.w
                    for (dx in 0 until s) acc += g.px[row + x * s + dx]
                }
                px[y * w + x] = acc / area
            }
        }
        return Gray(w, h, px)
    }

    /** Template minus its mean, and the norm of that. */
    private fun zeroMean(t: Gray): Pair<FloatArray, Float> {
        var sum = 0f
        for (v in t.px) sum += v
        val mean = sum / maxOf(1, t.px.size).toFloat()
        val z = FloatArray(t.px.size) { t.px[it] - mean }
        var sq = 0f
        for (v in z) sq += v * v
        return z to sqrt(sq)
    }

    /** Zero-mean NCC of the template (pre-centred [tz], norm [tn]) at (x, y). */
    private fun nccAt(img: Gray, tw: Int, th: Int, tz: FloatArray, tn: Float, x: Int, y: Int): Float {
        val n = (tw * th).toFloat()
        var sum = 0f
        var sumSq = 0f
        var cross = 0f
        for (ty in 0 until th) {
            val row = (y + ty) * img.w + x
            val trow = ty * tw
            for (tx in 0 until tw) {
                val v = img.px[row + tx]
                sum += v
                sumSq += v * v
                cross += v * tz[trow + tx]
            }
        }
        val variance = maxOf(sumSq - sum * sum / n, 0f)
        if (variance < 1e-3f || tn < 1e-3f) return 0f
        return cross / (sqrt(variance) * tn)
    }

    /** Best match: top-left x, y and score. */
    class Match(val x: Int, val y: Int, val score: Float)

    /**
     * Best match of [tpl] inside [img], or null when the template is larger than the image. A full-screen search can
     * take a while, so [stopped] is checked once per row and [Stopped] is thrown as soon as it reports true.
     */
    fun findTemplate(img: Gray, tpl: Gray, stopped: () -> Boolean): Match? {
        if (tpl.w > img.w || tpl.h > img.h || tpl.w == 0 || tpl.h == 0) return null
        val s = (minOf(tpl.w, tpl.h) / 8).coerceIn(1, 4)
        val ci = downscale(img, s)
        val ct = downscale(tpl, s)
        val (cz, cn) = zeroMean(ct)
        // (score, x, y) candidates from the coarse pass.
        val candidates = ArrayList<FloatArray>()
        val maxCy = maxOf(0, ci.h - ct.h)
        val maxCx = maxOf(0, ci.w - ct.w)
        for (y in 0..maxCy) {
            if (stopped()) throw Stopped()
            for (x in 0..maxCx) {
                val score = nccAt(ci, ct.w, ct.h, cz, cn, x, y)
                if (score > 0.4f) candidates.add(floatArrayOf(score, x.toFloat(), y.toFloat()))
            }
        }
        candidates.sortByDescending { it[0] }
        val top = if (candidates.size > 8) candidates.subList(0, 8) else candidates
        val (z, n) = zeroMean(tpl)
        var best: Match? = null
        val r = 2 * s
        val maxY = img.h - tpl.h
        val maxX = img.w - tpl.w
        for (c in top) {
            val fx = c[1].toInt() * s
            val fy = c[2].toInt() * s
            for (y in maxOf(0, fy - r)..minOf(fy + r, maxY)) {
                if (stopped()) throw Stopped()
                for (x in maxOf(0, fx - r)..minOf(fx + r, maxX)) {
                    val score = nccAt(img, tpl.w, tpl.h, z, n, x, y)
                    val b = best
                    if (b == null || score > b.score) best = Match(x, y, score)
                }
            }
        }
        return best
    }
}
