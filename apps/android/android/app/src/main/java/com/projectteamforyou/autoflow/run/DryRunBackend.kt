package com.projectteamforyou.autoflow.run

import android.content.Context
import com.projectteamforyou.autoflow.engine.Backend
import com.projectteamforyou.autoflow.engine.InputAction
import com.projectteamforyou.autoflow.engine.Platform
import com.projectteamforyou.autoflow.engine.ScreenInfo
import com.projectteamforyou.autoflow.engine.Value
import com.projectteamforyou.autoflow.system.DeviceState

/**
 * `run_start { dryRun: true }`: runs the real engine (timing, variables, branches, limits) without touching the
 * screen, the network or files — results are simulated exactly like the TypeScript SandboxBackend.
 */
class DryRunBackend(private val context: Context) : Backend {
    override val platform = Platform.ANDROID
    private var clipboard = ""
    private val files = HashMap<String, String>()

    override suspend fun screen(): ScreenInfo = DeviceState.screen(context)

    override suspend fun perform(action: InputAction): Value? = when (action) {
        is InputAction.ClipboardSet -> { clipboard = action.value; null }
        InputAction.ClipboardGet -> Value.Str(clipboard)
        is InputAction.Http -> Value.Str("simulated ${action.method} ${action.url}")
        is InputAction.FileOp -> when (action.op) {
            "write" -> { files[action.path] = action.content ?: ""; null }
            "append" -> { files[action.path] = (files[action.path] ?: "") + (action.content ?: ""); null }
            "read" -> Value.Str(files[action.path] ?: "")
            "exists" -> Value.of(files.containsKey(action.path))
            "delete" -> { files.remove(action.path); null }
            else -> null
        }
        is InputAction.Ocr -> Value.Str("")
        is InputAction.FindImage -> Value.Null
        else -> null
    }

    override suspend fun confirm(message: String): Boolean = true
}
