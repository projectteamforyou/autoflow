package com.projectteamforyou.autoflow.run

import android.content.Context
import android.graphics.BitmapFactory
import android.util.Base64
import java.io.File
import java.io.IOException

/**
 * Template images referenced by flows (`findImage`, image targets): `<externalFilesDir>/AutoFlow/images/<ref>.png`.
 * [AndroidBackend] reads them; the bridge commands `image_import`, `image_list` and `image_delete` manage them.
 */
object TemplateImages {
    private const val MAX_BYTES = 4 * 1024 * 1024
    private const val MAX_SIDE = 4096
    private const val DATA_URL_PREFIX = "data:image/png;base64,"
    private val PNG_SIGNATURE = intArrayOf(0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)

    /** The same `<ref>.png` rule as the desktop's images folder (`safe_ref` in apps/desktop: letters, digits, `_ - .`). */
    fun isValidRef(ref: String): Boolean = ref.isNotEmpty() && ref.length <= 200 && !ref.startsWith('.') &&
        ref.all { (it.isLetterOrDigit() && it.code < 128) || it == '_' || it == '-' || it == '.' }

    /** AutoFlow's images folder (Android/data/<app>/files/AutoFlow/images); not created here. */
    fun dir(context: Context): File = File(File(context.getExternalFilesDir(null) ?: context.filesDir, "AutoFlow"), "images")

    private fun checkedRef(ref: String): String {
        if (!isValidRef(ref)) throw IllegalArgumentException("invalid image reference \"$ref\"")
        return ref
    }

    /** `image_import`: validates a `data:image/png;base64,…` URL and writes it as `<ref>.png` (replacing any old one). */
    fun save(context: Context, ref: String, dataUrl: String) {
        checkedRef(ref)
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
        val dir = dir(context)
        dir.mkdirs()
        if (!dir.isDirectory) throw IOException("could not create the images folder")
        // Temp file + rename in the same folder, so a reader never sees a half-written PNG. The leading dot keeps it
        // out of image_list (a ref never starts with a dot).
        val tmp = File(dir, ".$ref.png.tmp")
        try {
            tmp.writeBytes(bytes)
            if (!tmp.renameTo(File(dir, "$ref.png"))) throw IOException("could not save the image")
        } finally {
            tmp.delete()
        }
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
