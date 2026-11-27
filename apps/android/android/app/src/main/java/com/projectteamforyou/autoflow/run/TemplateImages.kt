package com.projectteamforyou.autoflow.run

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Base64
import java.io.File
import java.io.IOException
import java.util.zip.CRC32

/**
 * Template images referenced by flows (`findImage`, image targets): `<externalFilesDir>/AutoFlow/images/<ref>.png`.
 * [AndroidBackend] reads them; the bridge commands `image_import`, `image_list` and `image_delete` manage them.
 */
object TemplateImages {
    private const val MAX_BYTES = 4 * 1024 * 1024
    // A template is matched as ARGB + int + float copies (12 bytes per pixel): 2048×2048 is ~50 MB, 4096×4096 would
    // be ~200 MB and can exhaust the heap in the middle of a run.
    private const val MAX_SIDE = 2048
    private const val DATA_URL_PREFIX = "data:image/png;base64,"
    private val PNG_SIGNATURE = intArrayOf(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

    /** The same `<ref>.png` rule as the desktop's images folder (`safe_ref` in apps/desktop: letters, digits, `_ - .`). */
    fun isValidRef(ref: String): Boolean = ref.isNotEmpty() && ref.length <= 200 && !ref.startsWith('.') &&
        ref.all { (it.isLetterOrDigit() && it.code < 128) || it == '_' || it == '-' || it == '.' }

    /**
     * Windows device names (CON, PRN, AUX, NUL, COM0–9, LPT0–9; any case, with or without an extension) cannot be
     * file names on the desktop: the same test as `is_windows_device_name` in apps/desktop. Refused at import so an
     * image name used by a flow works on both platforms; images already stored stay listed, usable and deletable.
     */
    fun isWindowsDeviceName(ref: String): Boolean {
        val stem = ref.substringBefore('.').uppercase(java.util.Locale.ROOT)
        return stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" ||
            (stem.length == 4 && (stem.startsWith("COM") || stem.startsWith("LPT")) && stem[3] in '0'..'9')
    }

    /**
     * Whether [bytes] (already known to start with the PNG signature) is a complete PNG stream: IHDR first, at least
     * one IDAT, every chunk inside the data, and IEND present. Critical chunks must also pass their CRC. A truncated
     * download fails here; Android's decoder alone would hand back the rows it managed to read.
     */
    internal fun isCompletePng(bytes: ByteArray): Boolean {
        var pos = PNG_SIGNATURE.size
        var first = true
        var hasData = false
        val crc = CRC32()
        while (true) {
            if (bytes.size - pos < 12) return false // length + type + CRC
            val len = ((bytes[pos].toLong() and 0xFF) shl 24) or ((bytes[pos + 1].toLong() and 0xFF) shl 16) or
                ((bytes[pos + 2].toLong() and 0xFF) shl 8) or (bytes[pos + 3].toLong() and 0xFF)
            if (len > bytes.size - pos - 12) return false
            val n = len.toInt()
            val type = String(bytes, pos + 4, 4, Charsets.ISO_8859_1)
            if (first && (type != "IHDR" || n != 13)) return false
            first = false
            if (type[0] in 'A'..'Z') {
                crc.reset()
                crc.update(bytes, pos + 4, 4 + n)
                val at = pos + 8 + n
                val stored = ((bytes[at].toLong() and 0xFF) shl 24) or ((bytes[at + 1].toLong() and 0xFF) shl 16) or
                    ((bytes[at + 2].toLong() and 0xFF) shl 8) or (bytes[at + 3].toLong() and 0xFF)
                if (stored != crc.value) return false
            }
            if (type == "IDAT") hasData = true
            if (type == "IEND") return hasData
            pos += 12 + n
        }
    }

    /** AutoFlow's images folder (Android/data/<app>/files/AutoFlow/images); not created here. */
    fun dir(context: Context): File = File(File(context.getExternalFilesDir(null) ?: context.filesDir, "AutoFlow"), "images")

    private fun checkedRef(ref: String): String {
        if (!isValidRef(ref)) throw IllegalArgumentException("invalid image reference \"$ref\"")
        return ref
    }

    /** `image_import`: validates a `data:image/png;base64,…` URL and writes it as `<ref>.png` (replacing any old one). */
    fun save(context: Context, ref: String, dataUrl: String) {
        checkedRef(ref)
        if (isWindowsDeviceName(ref)) {
            throw IllegalArgumentException("\"$ref\" is a reserved device name on Windows and cannot be an image name")
        }
        if (!dataUrl.startsWith(DATA_URL_PREFIX)) throw IllegalArgumentException("dataUrl must be a data:image/png;base64 URL")
        // 4 base64 characters carry 3 bytes: refuse oversized input before decoding it.
        if (dataUrl.length - DATA_URL_PREFIX.length > MAX_BYTES / 3 * 4 + 8) throw IllegalArgumentException("image is larger than 4 MB")
        val bytes = Base64.decode(dataUrl.substring(DATA_URL_PREFIX.length), Base64.DEFAULT)
        if (bytes.size > MAX_BYTES) throw IllegalArgumentException("image is larger than 4 MB")
        if (bytes.size < PNG_SIGNATURE.size || PNG_SIGNATURE.indices.any { (bytes[it].toInt() and 0xFF) != PNG_SIGNATURE[it] }) {
            throw IllegalArgumentException("image is not a PNG")
        }
        val opts = BitmapFactory.Options()
        opts.inJustDecodeBounds = true
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)
        if (opts.outWidth <= 0 || opts.outHeight <= 0) throw IllegalArgumentException("image is not a readable PNG")
        if (opts.outWidth > MAX_SIDE || opts.outHeight > MAX_SIDE) {
            throw IllegalArgumentException("image is larger than ${MAX_SIDE}x$MAX_SIDE pixels")
        }
        if (!isCompletePng(bytes)) throw IllegalArgumentException("image is not a readable PNG (the file is incomplete or damaged)")
        val dir = dir(context)
        dir.mkdirs()
        if (!dir.isDirectory) throw IOException("could not create the images folder")
        // Temp file + rename in the same folder, so a reader never sees a half-written PNG. The leading dot keeps it
        // out of image_list (a ref never starts with a dot).
        val tmp = File(dir, ".$ref.png.tmp")
        try {
            tmp.writeBytes(bytes)
            // Decode what was stored, before it replaces any older image: a PNG the matcher cannot read is refused
            // now, not in the middle of a run.
            if (!decodes(tmp)) throw IllegalArgumentException("image is not a readable PNG")
            if (!tmp.renameTo(File(dir, "$ref.png"))) throw IOException("could not save the image")
        } finally {
            tmp.delete()
        }
    }

    /** A full decode of [file], the way ImageMatch.loadTemplate reads it. The size is already capped at [MAX_SIDE]. */
    private fun decodes(file: File): Boolean {
        val opts = BitmapFactory.Options()
        opts.inPreferredConfig = android.graphics.Bitmap.Config.ARGB_8888
        val bmp: android.graphics.Bitmap? = try {
            BitmapFactory.decodeFile(file.path, opts)
        } catch (_: OutOfMemoryError) {
            // OutOfMemoryError is not an Exception: nothing further up would catch it.
            throw IllegalArgumentException("image is too large for this device")
        }
        if (bmp == null) return false
        val ok = bmp.width > 0 && bmp.height > 0
        bmp.recycle()
        return ok
    }

    /** `image_list`: refs (file names without `.png`), sorted. */
    fun list(context: Context): List<String> {
        val names = dir(context).list() ?: return emptyList()
        return names.filter { it.endsWith(".png") }.map { it.removeSuffix(".png") }.filter { isValidRef(it) }.sorted()
    }

    /** `image_delete`: removes `<ref>.png`; a ref that does not exist is not an error. */
    fun delete(context: Context, ref: String) {
        val f = File(dir(context), "${checkedRef(ref)}.png")
        if (f.exists() && !f.delete()) throw IOException("could not delete the image")
    }
}
