package com.projectteamforyou.autoflow.a11y

import android.os.Bundle
import android.view.accessibility.AccessibilityNodeInfo
import com.projectteamforyou.autoflow.engine.BackendException
import com.projectteamforyou.autoflow.engine.ErrorCategory
import kotlinx.coroutines.delay

/**
 * Typing into the focused editable field with ACTION_SET_TEXT.
 *
 * Append semantics: Android has no "insert at caret" accessibility action, so a type step reads the field's current
 * text, appends the new text and sets the result (then moves the caret to the end) — the same visible result as
 * typing at the end of the field. Exceptions: a field that shows only its hint counts as empty, and a password field
 * (whose real content apps never expose) is replaced, not appended to. With perCharDelayMs > 0 the text grows one
 * character at a time so apps that react to each keystroke see each one.
 */
class TextInput(private val service: AutoFlowAccessibilityService) {
    fun focusedEditable(): AccessibilityNodeInfo? {
        val node = service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return null
        return if (node.isEditable) node else null
    }

    fun currentText(node: AccessibilityNodeInfo): String = when {
        node.isPassword -> ""
        node.isShowingHintText -> ""
        else -> node.text?.toString() ?: ""
    }

    fun setText(node: AccessibilityNodeInfo, value: String) {
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, value) }
        if (!node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) {
            throw BackendException("the focused field did not accept text", ErrorCategory.TARGET)
        }
        val caret = Bundle().apply {
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, value.length)
            putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, value.length)
        }
        node.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, caret)
    }

    private fun require(): AccessibilityNodeInfo = focusedEditable()
        ?: throw BackendException("no text field is focused — add a tap on the field before typing", ErrorCategory.TARGET)

    suspend fun type(text: String, perCharDelayMs: Long) {
        val node = require()
        val base = currentText(node)
        if (perCharDelayMs <= 0 || text.length <= 1) {
            setText(node, base + text)
            return
        }
        // Grow by code point so emoji and surrogate pairs are never split.
        var i = 0
        while (i < text.length) {
            i = text.offsetByCodePoints(i, 1)
            node.refresh()
            setText(node, base + text.substring(0, i))
            if (i < text.length) delay(perCharDelayMs)
        }
    }

    /** Backspace: removes the last character (or the selection) of the focused field. */
    fun backspace() {
        val node = require()
        val cur = currentText(node)
        val start = node.textSelectionStart
        val end = node.textSelectionEnd
        val next = if (start in 0 until end && end <= cur.length) cur.removeRange(start, end)
        else if (cur.isEmpty()) cur else cur.substring(0, cur.offsetByCodePoints(cur.length, -1))
        setText(node, next)
    }

    fun perform(actionId: Int, args: Bundle? = null): Boolean = require().performAction(actionId, args)
}
