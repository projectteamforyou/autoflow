package com.projectteamforyou.autoflow.engine

import kotlinx.coroutines.delay

/** A gesture sink that records every action against a virtual screen (the JVM twin of SandboxBackend). */
class FakeBackend(
    override val platform: Platform = Platform.ANDROID,
    private val screenInfo: ScreenInfo = ScreenInfo(1080, 2400, 2.75),
    private val confirmAnswer: (String) -> Boolean = { true },
    private val actionDelayMs: Long = 0,
) : Backend {
    data class Effect(val action: InputAction, val points: List<Pair<Int, Int>>)

    val effects = ArrayList<Effect>()
    val typed = ArrayList<String>()
    val notifications = ArrayList<Pair<String, String>>()
    var clipboard = ""
    var failNext: ((InputAction) -> Exception?)? = null

    fun resolve(t: Target): Pair<Int, Int> = when (t) {
        is Target.Point -> if (t.space == "normalized") Pair(Math.round(t.x * screenInfo.width).toInt(), Math.round(t.y * screenInfo.height).toInt())
        else Pair(Math.round(t.x).toInt(), Math.round(t.y).toInt())
        is Target.Region -> {
            val sw = if (t.space == "normalized") screenInfo.width.toDouble() else 1.0
            val sh = if (t.space == "normalized") screenInfo.height.toDouble() else 1.0
            Pair(Math.round(t.x * sw + t.w * sw / 2).toInt(), Math.round(t.y * sh + t.h * sh / 2).toInt())
        }
        else -> Pair(screenInfo.width / 2, screenInfo.height / 2)
    }

    override suspend fun screen(): ScreenInfo = screenInfo

    override suspend fun perform(action: InputAction): Value? {
        failNext?.invoke(action)?.let { throw it }
        if (actionDelayMs > 0) delay(actionDelayMs)
        val points = ArrayList<Pair<Int, Int>>()
        var result: Value? = null
        when (action) {
            is InputAction.Click -> points.add(resolve(action.target))
            is InputAction.Move -> points.add(resolve(action.target))
            is InputAction.Drag -> { points.add(resolve(action.from)); points.add(resolve(action.to)) }
            is InputAction.Scroll -> action.target?.let { points.add(resolve(it)) }
            is InputAction.TypeText -> typed.add(action.text)
            is InputAction.ClipboardSet -> clipboard = action.value
            InputAction.ClipboardGet -> result = Value.Str(clipboard)
            is InputAction.Notify -> notifications.add(action.title to action.body)
            is InputAction.Http -> result = Value.Str("simulated ${action.method} ${action.url}")
            is InputAction.Ocr -> result = Value.Str("")
            is InputAction.FindImage -> result = Value.Null
            else -> Unit
        }
        effects.add(Effect(action, points))
        return result
    }

    override suspend fun confirm(message: String): Boolean = confirmAnswer(message)
}
