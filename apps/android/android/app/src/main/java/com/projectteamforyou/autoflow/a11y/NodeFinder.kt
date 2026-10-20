package com.projectteamforyou.autoflow.a11y

import android.accessibilityservice.AccessibilityService
import android.graphics.Rect
import android.view.accessibility.AccessibilityNodeInfo
import com.projectteamforyou.autoflow.engine.Target

/**
 * Resolves `element` targets against the accessibility tree of the window in front. Matching (all given fields must
 * match, case-insensitive): text = visible text contains; name = content description or text equals;
 * automationId = view id ("com.app:id/send" or just "send"); role = class name suffix ("Button", "EditText");
 * app = package; index = n-th match in document order.
 */
object NodeFinder {
    private const val MAX_NODES = 5000

    fun matches(sel: Target.ElementSelector, pkg: String?, text: String?, desc: String?, viewId: String?, cls: String?): Boolean {
        if (sel.app != null && !sel.app.equals(pkg, ignoreCase = true)) return false
        val wantText = sel.text
        if (wantText != null && (text == null || !text.contains(wantText, ignoreCase = true))) return false
        if (sel.name != null && !(sel.name.equals(desc, ignoreCase = true) || sel.name.equals(text, ignoreCase = true))) return false
        if (sel.automationId != null) {
            val id = viewId ?: return false
            if (!(id.equals(sel.automationId, ignoreCase = true) || id.endsWith(":id/${sel.automationId}", ignoreCase = true))) return false
        }
        val role = sel.role
        if (role != null && (cls == null || !cls.endsWith(role, ignoreCase = true))) return false
        return true
    }

    fun find(service: AccessibilityService, sel: Target.ElementSelector): Rect? {
        val root = service.rootInActiveWindow ?: return null
        if (sel.app != null && !sel.app.equals(root.packageName?.toString(), ignoreCase = true)) return null
        val wanted = sel.index ?: 0
        var seen = 0
        var visited = 0
        val stack = ArrayDeque<AccessibilityNodeInfo>()
        stack.addLast(root)
        while (stack.isNotEmpty() && visited < MAX_NODES) {
            val n = stack.removeLast()
            visited++
            if (n.isVisibleToUser && matches(sel, n.packageName?.toString(), n.text?.toString(), n.contentDescription?.toString(), n.viewIdResourceName, n.className?.toString())) {
                if (seen == wanted) {
                    val r = Rect()
                    n.getBoundsInScreen(r)
                    if (!r.isEmpty) return r
                }
                seen++
            }
            for (i in n.childCount - 1 downTo 0) n.getChild(i)?.let { stack.addLast(it) }
        }
        return null
    }
}
