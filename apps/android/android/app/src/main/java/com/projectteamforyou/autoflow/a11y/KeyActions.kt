package com.projectteamforyou.autoflow.a11y

import android.media.AudioManager
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import com.projectteamforyou.autoflow.engine.BackendException
import com.projectteamforyou.autoflow.engine.ErrorCategory

/**
 * `key` steps on Android (limited: accessibility services cannot inject key events). Supported:
 * - printable characters and Space → appended to the focused field (Shift upper-cases letters);
 * - Enter (IME action on Android 11+, newline otherwise), Tab / Shift+Tab (move focus), Backspace;
 * - Ctrl+A / C / X / V → select all / copy / cut / paste in the focused field;
 * - ArrowLeft/Right (caret by character), ArrowUp/Down (by line), PageUp/PageDown (scroll the focused list);
 * - Escape / BrowserBack → Back, BrowserHome → Home;
 * - media and volume keys → the system media session / volume.
 * `down` acts like `press`; `up` is a no-op. Anything else fails with category "unsupported".
 */
class KeyActions(private val service: AutoFlowAccessibilityService) {
    private val text get() = service.text

    fun send(key: String, modifiers: List<String>, action: String) {
        if (action == "up") return
        val ctrl = "ctrl" in modifiers || "meta" in modifiers
        val shift = "shift" in modifiers
        if (ctrl) {
            val id = when (key.lowercase()) {
                "a" -> null.also { selectAll() }
                "c" -> AccessibilityNodeInfo.ACTION_COPY
                "x" -> AccessibilityNodeInfo.ACTION_CUT
                "v" -> AccessibilityNodeInfo.ACTION_PASTE
                else -> unsupported(key, modifiers)
            }
            if (id != null && !text.perform(id)) throw BackendException("the focused field refused Ctrl+${key.uppercase()}", ErrorCategory.TARGET)
            return
        }
        if ("alt" in modifiers) unsupported(key, modifiers)
        when (key) {
            "Enter" -> enter()
            "Tab" -> moveFocus(if (shift) View.FOCUS_BACKWARD else View.FOCUS_FORWARD)
            "Backspace" -> text.backspace()
            "Escape", "BrowserBack", "GoBack" -> service.globalAction("back")
            "BrowserHome" -> service.globalAction("home")
            "ArrowLeft", "ArrowRight" -> caret(AccessibilityNodeInfo.MOVEMENT_GRANULARITY_CHARACTER, key == "ArrowRight")
            "ArrowUp", "ArrowDown" -> caret(AccessibilityNodeInfo.MOVEMENT_GRANULARITY_LINE, key == "ArrowDown")
            "PageDown", "PageUp" -> scroll(key == "PageDown")
            "MediaPlayPause" -> media(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            "MediaPlay" -> media(KeyEvent.KEYCODE_MEDIA_PLAY)
            "MediaPause" -> media(KeyEvent.KEYCODE_MEDIA_PAUSE)
            "MediaStop" -> media(KeyEvent.KEYCODE_MEDIA_STOP)
            "MediaTrackNext" -> media(KeyEvent.KEYCODE_MEDIA_NEXT)
            "MediaTrackPrevious" -> media(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            "AudioVolumeUp" -> volume(AudioManager.ADJUST_RAISE)
            "AudioVolumeDown" -> volume(AudioManager.ADJUST_LOWER)
            "AudioVolumeMute" -> volume(AudioManager.ADJUST_TOGGLE_MUTE)
            "Space", " " -> append(" ")
            else -> if (key.codePointCount(0, key.length) == 1) append(if (shift) key.uppercase() else key) else unsupported(key, modifiers)
        }
    }

    private fun unsupported(key: String, modifiers: List<String>): Nothing =
        throw BackendException("the key ${(modifiers + key).joinToString("+")} cannot be sent on Android", ErrorCategory.UNSUPPORTED)

    private fun append(s: String) {
        val node = text.focusedEditable() ?: throw BackendException("no text field is focused — add a tap on the field first", ErrorCategory.TARGET)
        text.setText(node, text.currentText(node) + s)
    }

    private fun enter() {
        val node = text.focusedEditable() ?: throw BackendException("no text field is focused for Enter", ErrorCategory.TARGET)
        if (Build.VERSION.SDK_INT >= 30 && node.actionList.any { it.id == AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id }) {
            node.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
        } else if (node.isMultiLine) {
            text.setText(node, text.currentText(node) + "\n")
        } else {
            throw BackendException("this field has no Enter action on this Android version", ErrorCategory.UNSUPPORTED)
        }
    }

    private fun selectAll() {
        val node = text.focusedEditable() ?: throw BackendException("no text field is focused", ErrorCategory.TARGET)
        val len = text.currentText(node).length
        node.performAction(
            AccessibilityNodeInfo.ACTION_SET_SELECTION,
            Bundle().apply {
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, 0)
                putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, len)
            },
        )
    }

    private fun moveFocus(direction: Int) {
        val from = service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: throw BackendException("nothing is focused to move from", ErrorCategory.TARGET)
        val next = from.focusSearch(direction) ?: throw BackendException("there is no next field", ErrorCategory.TARGET)
        if (!next.performAction(AccessibilityNodeInfo.ACTION_FOCUS)) next.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun caret(granularity: Int, forward: Boolean) {
        val args = Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_MOVEMENT_GRANULARITY_INT, granularity)
            putBoolean(AccessibilityNodeInfo.ACTION_ARGUMENT_EXTEND_SELECTION_BOOLEAN, false)
        }
        text.perform(if (forward) AccessibilityNodeInfo.ACTION_NEXT_AT_MOVEMENT_GRANULARITY else AccessibilityNodeInfo.ACTION_PREVIOUS_AT_MOVEMENT_GRANULARITY, args)
    }

    private fun scroll(forward: Boolean) {
        val root = service.rootInActiveWindow ?: throw BackendException("no window to scroll", ErrorCategory.TARGET)
        val stack = ArrayDeque<AccessibilityNodeInfo>().apply { addLast(root) }
        var visited = 0
        while (stack.isNotEmpty() && visited++ < 3000) {
            val n = stack.removeFirst()
            if (n.isScrollable && n.isVisibleToUser) {
                n.performAction(if (forward) AccessibilityNodeInfo.ACTION_SCROLL_FORWARD else AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD)
                return
            }
            for (i in 0 until n.childCount) n.getChild(i)?.let { stack.addLast(it) }
        }
        throw BackendException("nothing on screen can scroll", ErrorCategory.TARGET)
    }

    private fun media(code: Int) {
        val am = service.getSystemService(AudioManager::class.java)
        val t = SystemClock.uptimeMillis()
        am.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_DOWN, code, 0))
        am.dispatchMediaKeyEvent(KeyEvent(t, t, KeyEvent.ACTION_UP, code, 0))
    }

    private fun volume(direction: Int) {
        service.getSystemService(AudioManager::class.java).adjustSuggestedStreamVolume(direction, AudioManager.USE_DEFAULT_STREAM_TYPE, AudioManager.FLAG_SHOW_UI)
    }
}
