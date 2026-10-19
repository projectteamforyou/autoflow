package com.projectteamforyou.autoflow.secrets

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * `{{secret:name}}` values, encrypted with an AES-256/GCM key that lives in the Android Keystore (hardware-backed where
 * the device has a TEE/StrongBox) and never leaves it. Only ciphertext + IV are written to app-private preferences,
 * which are excluded from cloud backup and device transfer (res/xml/data_extraction_rules.xml).
 *
 * Secret values are never logged, never put into run variables or events, and never sent to the web layer:
 * `secret_list` returns names only.
 */
class SecretStore(context: Context) {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    companion object {
        private const val PREFS = "autoflow.secrets"
        private const val KEY_ALIAS = "autoflow.secrets.v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG = "AutoFlowSecrets"
        private val NAME_RE = Regex("^[A-Za-z0-9_.-]{1,64}$")

        @Volatile private var instance: SecretStore? = null
        fun get(context: Context): SecretStore = instance ?: synchronized(this) { instance ?: SecretStore(context).also { instance = it } }
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return gen.generateKey()
    }

    fun validName(name: String) = NAME_RE.matches(name)

    @Synchronized
    fun set(name: String, value: String) {
        require(validName(name)) { "secret names use letters, digits, _ . - (max 64)" }
        require(value.length <= 10_000) { "secret is too long" }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val ct = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        val blob = Base64.encodeToString(cipher.iv, Base64.NO_WRAP) + ":" + Base64.encodeToString(ct, Base64.NO_WRAP)
        prefs.edit().putString("s.$name", blob).apply()
    }

    @Synchronized
    fun get(name: String): String? {
        val blob = prefs.getString("s.$name", null) ?: return null
        return try {
            val (iv, ct) = blob.split(':', limit = 2).map { Base64.decode(it, Base64.NO_WRAP) }
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, iv))
            String(cipher.doFinal(ct), Charsets.UTF_8)
        } catch (e: Exception) {
            // Key invalidated (e.g. device credential reset) or tampered data: treat as missing, never crash a run.
            Log.w(TAG, "secret \"$name\" could not be decrypted (${e.javaClass.simpleName})")
            null
        }
    }

    @Synchronized
    fun delete(name: String) {
        prefs.edit().remove("s.$name").apply()
    }

    @Synchronized
    fun names(): List<String> = prefs.all.keys.filter { it.startsWith("s.") }.map { it.removePrefix("s.") }.sorted()
}
