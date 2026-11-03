package com.projectteamforyou.autoflow.run

import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import com.google.mlkit.common.MlKitException
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.projectteamforyou.autoflow.engine.BackendException
import com.projectteamforyou.autoflow.engine.ErrorCategory
import kotlinx.coroutines.suspendCancellableCoroutine
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * Text recognition with ML Kit Text Recognition v2 in its unbundled form: the models live in Google Play services,
 * not in the APK. The Android counterpart of crates/engine/src/windows/ocr.rs (lines joined with `\n`).
 *
 * An `ocr` step carries no language, so the script is picked from the device locale (Korean, Japanese and Chinese
 * recognizers also read Latin text; everything else uses the Latin recognizer), like Windows uses the user profile
 * languages.
 */
object TextRecognizers {
    private const val GMS_PACKAGE = "com.google.android.gms"

    private enum class Script { LATIN, KOREAN, JAPANESE, CHINESE }

    private val clients = HashMap<Script, TextRecognizer>()

    private fun scriptFor(context: Context): Script {
        val locales = context.resources.configuration.locales
        val locale: Locale = if (locales.isEmpty) Locale.getDefault() else locales[0]
        return when (locale.language.lowercase(Locale.ROOT)) {
            "ko" -> Script.KOREAN
            "ja" -> Script.JAPANESE
            "zh" -> Script.CHINESE
            else -> Script.LATIN
        }
    }

    @Synchronized
    private fun client(script: Script): TextRecognizer = clients.getOrPut(script) {
        when (script) {
            Script.LATIN -> TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
            Script.KOREAN -> TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
            Script.JAPANESE -> TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
            Script.CHINESE -> TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
        }
    }

    private fun playServicesInstalled(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(GMS_PACKAGE, 0)
        true
    } catch (_: PackageManager.NameNotFoundException) {
        false
    }

    /** Recognises the text in [bitmap]; lines are joined with `\n` (the whole text when ML Kit reports no lines). */
    suspend fun recognize(context: Context, bitmap: Bitmap): String {
        if (!playServicesInstalled(context)) {
            throw BackendException("text recognition needs Google Play services on this device", ErrorCategory.UNSUPPORTED)
        }
        val recognizer = try {
            client(scriptFor(context))
        } catch (e: Exception) {
            throw BackendException("text recognition is not available: ${e.message ?: e.javaClass.simpleName}", ErrorCategory.ENVIRONMENT)
        }
        val result: Text = suspendCancellableCoroutine { cont ->
            recognizer.process(InputImage.fromBitmap(bitmap, 0))
                .addOnSuccessListener { text -> if (cont.isActive) cont.resume(text) }
                .addOnFailureListener { e -> if (cont.isActive) cont.resumeWithException(translate(e)) }
                .addOnCanceledListener { if (cont.isActive) cont.resumeWithException(BackendException("text recognition was cancelled", ErrorCategory.ACTION)) }
        }
        val lines = ArrayList<String>()
        for (block in result.textBlocks) for (line in block.lines) lines.add(line.text)
        return if (lines.isEmpty()) result.text else lines.joinToString("\n")
    }

    private fun translate(e: Exception): BackendException = when {
        e is BackendException -> e
        e is MlKitException && e.errorCode == MlKitException.UNAVAILABLE ->
            BackendException(
                "text recognition needs Google Play services on this device (its text module may still be downloading — try again in a minute)",
                ErrorCategory.UNSUPPORTED,
            )
        else -> BackendException("text recognition failed: ${e.message ?: e.javaClass.simpleName}", ErrorCategory.ENVIRONMENT)
    }
}
