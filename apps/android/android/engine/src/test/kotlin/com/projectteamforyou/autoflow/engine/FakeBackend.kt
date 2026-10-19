package com.projectteamforyou.autoflow.engine

import kotlinx.coroutines.delay

/**
 * A gesture sink that records every action against a virtual screen (the JVM twin of SandboxBackend). Optional
 * emulated monitors and scripted probe answers (pixels keyed "x,y", scene hashes keyed "x,y,w,h": each probe takes the
 * next value, the last one repeats) drive the multi-monitor conformance cases.
 */
class FakeBackend(
    override val platform: Platform = Platform.ANDROID,
    private val screenInfo: ScreenInfo = ScreenInfo(1080, 2400, 2.75),
    private val confirmAnswer: (String) -> Boolean = { true },
    private val actionDelayMs: Long = 0,
    private val displayList: List<DisplayInfo>? = null,
    pixels: Map<String, List<String>> = emptyMap(),
    sceneHashes: Map<String, List<String>> = emptyMap(),
) : Backend {
    data class Effect(val action: InputAction, val points: List<Pair<Int, Int>>)

    val effects = ArrayList<Effect>()
    val typed = ArrayList<String>()
    val notifications = ArrayList<Pair<String, String>>()
    /** Probes in call order: [x, y] pixels and [x, y, w, h] scene regions. */
    val probes = ArrayList<List<Double>>()
    var clipboard = ""
    var failNext: ((InputAction) -> Exception?)? = null
    var pointer: Pair<Int, Int> = screenInfo.width / 2 to screenInfo.height / 2
    private val pixels = pixels.mapValues { it.value.toMutableList() }
    private val scenes = sceneHashes.mapValues { it.value.toMutableList() }

    fun resolve(t: Target): Pair<Int, Int> = when (t) {
        is Target.Point -> if (t.space == "normalized") Pair(Math.round(t.x * screenInfo.width).toInt(), Math.round(t.y * screenInfo.height).toInt())
        else Pair(Math.round(t.x).toInt(), Math.round(t.y).toInt())
        is Target.Region -> {
            val sw = if (t.space == "normalized") screenInfo.width.toDouble() else 1.0
            val sh = if (t.space == "normalized") screenInfo.height.toDouble() else 1.0
            Pair(Math.round(t.x * sw + t.w * sw / 2).toInt(), Math.round(t.y * sh + t.h * sh / 2).toInt())
        }
        is Target.Current -> pointer
        else -> Pair(screenInfo.width / 2, screenInfo.height / 2)
    }

    private fun next(map: Map<String, MutableList<String>>, key: String, fallback: String): String {
        val seq = map[key] ?: return fallback
        return if (seq.size > 1) seq.removeAt(0) else seq.firstOrNull() ?: fallback
    }

    override suspend fun screen(): ScreenInfo = screenInfo

    override suspend fun displays(): List<DisplayInfo> = displayList ?: super.displays()

    override suspend fun pointerPosition(): Pair<Double, Double> = pointer.first.toDouble() to pointer.second.toDouble()

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
            is InputAction.Pixel -> {
                probes.add(listOf(action.x, action.y))
                result = Value.Str(next(pixels, "${jsNumberToString(action.x)},${jsNumberToString(action.y)}", "#000000"))
            }
            is InputAction.SceneHash -> {
                val r = action.region
                probes.add(listOf(r.x, r.y, r.w, r.h))
                val key = listOf(r.x, r.y, r.w, r.h).joinToString(",") { jsNumberToString(it) }
                result = Value.Str(next(scenes, key, "0000000000000000"))
            }
            else -> Unit
        }
        points.lastOrNull()?.let { pointer = it }
        effects.add(Effect(action, points))
        return result
    }

    override suspend fun confirm(message: String): Boolean = confirmAnswer(message)
}
