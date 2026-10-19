package com.projectteamforyou.autoflow.keyforge

import android.view.KeyEvent
import com.projectteamforyou.autoflow.a11y.AutoFlowAccessibilityService
import com.projectteamforyou.autoflow.bridge.BridgeEvents
import com.projectteamforyou.autoflow.engine.Hotkey
import com.projectteamforyou.autoflow.engine.Keyforge
import com.projectteamforyou.autoflow.run.RunManager
import com.projectteamforyou.autoflow.triggers.TriggerEngine
import java.util.concurrent.ConcurrentHashMap

/**
 * Hardware-keyboard hotkeys (Android "limited" hotkey support): the emergency stop (Halt), flow hotkey triggers and
 * Keyforge mappings. Only keys that match are consumed; every other key passes through untouched and nothing is
 * recorded or logged.
 */
object HotkeyRouter {
    @Volatile private var emergency: String? = Keyforge.comboKey("Escape", listOf("ctrl", "alt"))
    private val consumedDown = ConcurrentHashMap.newKeySet<Int>()

    fun setEmergencyStop(h: Hotkey?) {
        emergency = h?.let { Keyforge.comboKey(it.key, it.modifiers) }
    }

    fun needsKeyEvents(): Boolean = TriggerEngine.hasHotkeyTriggers() || ProfileManager.hasMappings()

    /** W3C KeyboardEvent.key-style name for an Android key code. */
    fun keyName(e: KeyEvent): String? = when (e.keyCode) {
        KeyEvent.KEYCODE_ESCAPE -> "Escape"
        KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "Enter"
        KeyEvent.KEYCODE_TAB -> "Tab"
        KeyEvent.KEYCODE_SPACE -> "Space"
        KeyEvent.KEYCODE_DEL -> "Backspace"
        KeyEvent.KEYCODE_FORWARD_DEL -> "Delete"
        KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
        KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
        KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
        KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
        KeyEvent.KEYCODE_MOVE_HOME -> "Home"
        KeyEvent.KEYCODE_MOVE_END -> "End"
        KeyEvent.KEYCODE_PAGE_UP -> "PageUp"
        KeyEvent.KEYCODE_PAGE_DOWN -> "PageDown"
        KeyEvent.KEYCODE_INSERT -> "Insert"
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "MediaPlayPause"
        KeyEvent.KEYCODE_MEDIA_NEXT -> "MediaTrackNext"
        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "MediaTrackPrevious"
        KeyEvent.KEYCODE_MEDIA_STOP -> "MediaStop"
        KeyEvent.KEYCODE_VOLUME_UP -> "AudioVolumeUp"
        KeyEvent.KEYCODE_VOLUME_DOWN -> "AudioVolumeDown"
        KeyEvent.KEYCODE_VOLUME_MUTE -> "AudioVolumeMute"
        in KeyEvent.KEYCODE_F1..KeyEvent.KEYCODE_F12 -> "F${e.keyCode - KeyEvent.KEYCODE_F1 + 1}"
        in KeyEvent.KEYCODE_A..KeyEvent.KEYCODE_Z -> ('a' + (e.keyCode - KeyEvent.KEYCODE_A)).toString()
        in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> ('0' + (e.keyCode - KeyEvent.KEYCODE_0)).toString()
        else -> e.unicodeChar.takeIf { it > 0 }?.let { String(Character.toChars(it)) }
    }

    private fun modifiers(e: KeyEvent) = buildList {
        if (e.isCtrlPressed) add("ctrl")
        if (e.isAltPressed) add("alt")
        if (e.isShiftPressed) add("shift")
        if (e.isMetaPressed) add("meta")
    }

    fun onKeyEvent(service: AutoFlowAccessibilityService, e: KeyEvent): Boolean {
        if (e.action == KeyEvent.ACTION_UP) return consumedDown.remove(e.keyCode)
        if (e.action != KeyEvent.ACTION_DOWN) return false
        val name = keyName(e) ?: return false
        val combo = Keyforge.comboKey(name, modifiers(e))
        val handled = when {
            e.repeatCount > 0 -> consumedDown.contains(e.keyCode) && ProfileManager.onRepeat(service, combo)
            combo == emergency -> {
                RunManager.haltAll("emergency stop")
                BridgeEvents.hotkey("halt")
                true
            }
            TriggerEngine.onHotkey(service, combo) -> true
            else -> ProfileManager.onKey(service, combo)
        }
        if (handled) consumedDown.add(e.keyCode)
        return handled
    }
}
