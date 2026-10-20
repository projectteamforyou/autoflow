package com.projectteamforyou.autoflow.engine

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.Job
import kotlinx.coroutines.selects.select
import java.time.ZoneId
import kotlin.random.Random

/**
 * Deterministic flow interpreter — the Kotlin port of `FlowRun` in packages/core/src/engine.ts.
 *
 * Same semantics: limits (duration, actions, iterations), countdown, pause/resume/stop with waits sliced to
 * [SLICE_MS], breakpoints and single-stepping, per-step error policies (stop/continue/retry/goto), try/catch,
 * if/loop/forEach/group/break/continue/stop, runFlow nesting, pre-run checks (unsupported steps, risk approval,
 * screen geometry drift) and the same RunEvent stream. Engine v2 (opt-in schema fields, verified against the
 * TypeScript engine by ConformanceTest): per-step `stepTimeoutMs`, retry backoff curves with cap and jitter,
 * `limits.maxSteps` and seeded `humanize`. Multi-monitor (opt-in, see Displays.kt): display-relative targets are placed
 * on absolute pixels here, a missing display follows `onMissingDisplay`, Stage mode pauses on a pointer takeover,
 * scene / pixel probes feed conditions, and loops can keep a `cooldownMs` rhythm.
 *
 * Threading: [start] suspends until the run ends and can run on any dispatcher; [pause], [resume], [stop] and
 * [stepOver] are thread-safe and may be called from any thread.
 */
class FlowRun(
    private val flow: Flow,
    private val backend: Backend,
    private val opts: RunOptions = RunOptions(),
) {
    val id: String = opts.runId ?: newRunId()

    @Volatile var currentState: RunState = RunState.IDLE
        private set

    private val lock = Any()
    private val signal = AbortSignal()
    @Volatile private var pauseGate: CompletableDeferred<Unit>? = null
    @Volatile private var stepOnce = false
    @Volatile private var stopReason: String? = null
    @Volatile private var externalError: RunError? = null
    private val vars = LinkedHashMap<String, Value>()
    private var actions = 0L
    private var iterations = 0L
    private var stepCount = 0L

    /** One active step timeout; the step times out once the clock is strictly past [at]. */
    private class Deadline(val id: Long, val timeoutMs: Long, val at: Long)

    private val deadlines = ArrayList<Deadline>()
    private var nextDeadline = 0L
    private val humanize: Humanize? = flow.humanize?.takeIf { it.offsetPx > 0 || it.delayMs > 0 }
    private val humanRng: Mulberry32? = flow.humanize?.seed?.let { Mulberry32(it) }
    private var startedAt = 0L
    private var callDepth = 0
    /** Where AutoFlow last put the pointer (Stage takeover detection). */
    private var lastPointer: Pair<Double, Double>? = null
    private val displayWarned = HashSet<String>()
    private val displayAnswers = HashMap<String, Boolean>()
    private val clock = opts.clock
    private val env = ExprEnv(vars, now = { clock.now() }, random = opts.random, zone = opts.zone)

    companion object {
        /** Stop latency target is 500 ms; long waits are sliced so pause/stop/limits are observed quickly. */
        const val SLICE_MS = 100L
        /** Default pointer movement (px) that counts as the user taking over a Stage run. */
        const val TAKEOVER_PX = 24
        private val INPUT_TYPES = setOf("click", "move", "drag", "scroll", "key", "type")

        data class Preflight(val compat: List<CompatIssue>, val blocked: List<CompatIssue>, val risk: RiskReport)

        /** Static pre-run checks shared by every surface. */
        fun preflight(flow: Flow, platform: Platform): Preflight {
            val compat = compatibility(flow.steps, platform)
            return Preflight(compat, compat.filter { it.support == Support.UNSUPPORTED }, analyzeRisk(flow))
        }

        fun newRunId(): String {
            val chars = "abcdefghijklmnopqrstuvwxyz0123456789"
            return "run_" + (1..8).map { chars[Random.nextInt(chars.length)] }.joinToString("")
        }
    }

    fun pause() {
        synchronized(lock) {
            if (currentState != RunState.RUNNING) return
            pauseGate = CompletableDeferred()
            setState(RunState.PAUSED)
        }
    }

    fun resume() {
        synchronized(lock) {
            if (currentState != RunState.PAUSED) return
            setState(RunState.RUNNING)
            val g = pauseGate
            pauseGate = null
            g?.complete(Unit)
        }
    }

    /** In debug mode while paused at a breakpoint: execute exactly one more step, then pause again. */
    fun stepOver() {
        synchronized(lock) {
            if (currentState != RunState.PAUSED) return
            stepOnce = true
            resume()
        }
    }

    fun stop(reason: String = "user") {
        synchronized(lock) {
            if (currentState.terminal) return
            if (stopReason == null) stopReason = reason
            signal.abort()
            val g = pauseGate
            pauseGate = null
            g?.complete(Unit)
        }
    }

    /**
     * Ends the run as failed with [error] (e.g. a protected system screen came to the front). Like [stop], it takes
     * effect within one sleep slice and interrupts an in-flight backend action.
     */
    fun fail(error: RunError) {
        synchronized(lock) {
            if (currentState.terminal || externalError != null) return
            externalError = error
            signal.abort()
            val g = pauseGate
            pauseGate = null
            g?.complete(Unit)
        }
    }

    suspend fun start(): RunResult {
        synchronized(lock) {
            check(currentState == RunState.IDLE) { "a FlowRun can only be started once" }
            startedAt = clock.now()
            setState(RunState.PREFLIGHT)
        }
        return try {
            preflightChecks()
            initVars()
            if (!opts.skipCountdown && flow.limits.countdownMs > 0) {
                setState(RunState.COUNTDOWN)
                var remaining = flow.limits.countdownMs
                while (remaining > 0) {
                    emit(RunEvent.Countdown(remaining, clock.now()))
                    val slice = minOf(remaining, 1000L)
                    clock.sleep(slice, signal)
                    remaining -= slice
                }
            }
            synchronized(lock) {
                if (signal.aborted) throw StopSignal
                startedAt = clock.now()
                setState(RunState.RUNNING)
            }
            runTopLevel(flow.steps)
            finish(RunStatus.COMPLETED)
        } catch (e: Throwable) {
            handleTerminal(e)
        }
    }

    /* ------------------------------------------------------------ internals */

    private suspend fun preflightChecks() {
        val (_, blocked, risk) = preflight(flow, backend.platform)
        if (blocked.isNotEmpty()) {
            throw RunFailure(
                RunError(
                    stepId = blocked[0].stepId,
                    message = "${blocked.size} step(s) are not supported on ${backend.platform.json}: ${blocked.joinToString(", ") { it.stepType }}",
                    category = ErrorCategory.UNSUPPORTED,
                ),
            )
        }
        if (risk.needsConfirm) {
            val ok = opts.confirmRisk?.invoke(risk) ?: false
            if (!ok) throw RunFailure(RunError(message = "risky steps were not approved", category = ErrorCategory.USER))
        }
        val rec = flow.screen
        if (rec != null) {
            val live = abortable { backend.screen() }
            if (live != null && (live.width != rec.width || live.height != rec.height || Math.abs(live.scale - rec.scale) > 0.01) && usesScreenCoordinates(flow.steps)) {
                val recorded = ScreenInfo(rec.width, rec.height, rec.scale)
                val ok = opts.confirmScreenChange?.invoke(recorded, live) ?: false
                if (!ok) {
                    throw RunFailure(
                        RunError(
                            message = "screen changed from ${rec.width}x${rec.height}@${jsNumberToString(rec.scale)} to ${live.width}x${live.height}@${jsNumberToString(live.scale)}",
                            category = ErrorCategory.ENVIRONMENT,
                        ),
                    )
                }
            }
        }
        // A missing stage fails (or falls back, or asks) before the countdown, not at the first tap.
        flow.stage?.let { display(it.display) }
    }

    /* ---------------------------------------------------------- displays */

    private suspend fun displayList(): List<DisplayInfo> = sortDisplays(abortable { backend.displays() })

    /** Resolves a display reference, applying `onMissingDisplay` when it is not connected. */
    private suspend fun display(ref: DisplayRef): DisplayInfo {
        val list = displayList()
        findDisplay(list, ref)?.let { return it }
        val primary = list.firstOrNull()
        val use = when {
            primary == null -> false
            flow.onMissingDisplay == "primary" -> true
            flow.onMissingDisplay == "ask" -> displayAnswers[ref.key] ?: run {
                val ok = opts.confirmMissingDisplay?.invoke(ref.label)
                    ?: abortable { backend.confirm("Display ${ref.label} is not connected. Use the primary display instead?") }
                displayAnswers[ref.key] = ok
                ok
            }
            else -> false
        }
        if (!use || primary == null) throw RunFailure(RunError(message = "display ${ref.label} is not connected", category = ErrorCategory.DISPLAY))
        if (displayWarned.add(ref.key)) {
            emit(RunEvent.Log("warn", "display ${ref.label} is not connected; using the primary display", null, clock.now()))
        }
        return primary
    }

    private fun outside(what: String, ref: DisplayRef): RunFailure =
        RunFailure(RunError(message = "$what is outside display ${ref.label}", category = ErrorCategory.DISPLAY))

    /** Places display-relative point/region/image targets on absolute pixels; other targets are returned unchanged. */
    private suspend fun place(t: Target): Target {
        if (t is Target.Image) {
            val ref = t.display ?: return t
            val d = display(ref)
            return t.copy(display = null, region = t.region?.let { placeRect(d.bounds, it, "display") } ?: d.bounds)
        }
        val (space, own) = when (t) {
            is Target.Point -> t.space to t.display
            is Target.Region -> t.space to t.display
            else -> return t
        }
        if (space == "window") return t
        val stage = flow.stage?.display
        val ref = own ?: (if (space == "display" || (space == "normalized" && stage != null)) stage ?: DisplayRef.PRIMARY else return t)
        val b = display(ref).bounds
        return when (t) {
            is Target.Point -> {
                val (px, py) = placePoint(b, t.x, t.y, space)
                if (!onDisplay(b, px, py)) throw outside("point (${jsNumberToString(px)}, ${jsNumberToString(py)})", ref)
                Target.Point(px, py, "screen")
            }
            is Target.Region -> {
                val r = placeRect(b, Target.Rect(t.x, t.y, t.w, t.h), space)
                if (!rectOnDisplay(b, r)) {
                    throw outside("region (${jsNumberToString(r.x)}, ${jsNumberToString(r.y)}) ${jsNumberToString(r.w)}x${jsNumberToString(r.h)}", ref)
                }
                Target.Region(r.x, r.y, r.w, r.h, "screen", t.pick)
            }
            else -> t
        }
    }

    /** Placement on displays, then humanization (in that order in every engine). */
    private suspend fun target(t: Target): Target {
        val placed = place(t)
        return humanize?.let { humanizeTarget(placed, it.offsetPx, ::humanRandom) } ?: placed
    }

    private fun track(t: Target?) {
        lastPointer = if (t is Target.Point && t.space == "screen") t.x to t.y else null
    }

    /** Stage guard: a pointer that moved more than `takeoverPx` or left the stage display pauses the run. */
    private suspend fun checkTakeover() {
        val st = flow.stage ?: return
        val last = lastPointer ?: return
        if (st.pauseOnTakeover == false) return
        val p = abortable { backend.pointerPosition() } ?: return
        val limit = (st.takeoverPx ?: TAKEOVER_PX).toDouble()
        val dx = p.first - last.first
        val dy = p.second - last.second
        val off = !onDisplay(display(st.display).bounds, p.first, p.second)
        if (!off && dx * dx + dy * dy <= limit * limit) return
        lastPointer = null
        emit(RunEvent.Log("warn", if (off) "takeover: pointer left the stage display, run paused" else "takeover: pointer moved, run paused", null, clock.now()))
        pause()
        gate()
    }

    private suspend fun probePoint(at: Target.Point): Pair<Double, Double> {
        if (at.space == "window") throw RunFailure(RunError(message = "pixel positions cannot be window-relative", category = ErrorCategory.VALIDATION))
        val ref = at.display ?: (if (at.space == "screen") return placePoint(Target.Rect(0.0, 0.0, 0.0, 0.0), at.x, at.y, "screen") else flow.stage?.display ?: DisplayRef.PRIMARY)
        val b = display(ref).bounds
        val (px, py) = placePoint(b, at.x, at.y, at.space)
        if (!onDisplay(b, px, py)) throw outside("point (${jsNumberToString(px)}, ${jsNumberToString(py)})", ref)
        return px to py
    }

    private suspend fun readPixel(at: Target.Point): IntArray {
        val (x, y) = probePoint(at)
        return parseColor((perform(InputAction.Pixel(x, y)) as? Value.Str)?.v)
            ?: throw RunFailure(RunError(message = "this device cannot read screen pixels", category = ErrorCategory.UNSUPPORTED))
    }

    private fun scene(name: String): Scene = flow.scenes.orEmpty().firstOrNull { it.name == name }
        ?: throw RunFailure(RunError(message = "scene \"$name\" is not defined in this flow", category = ErrorCategory.VALIDATION))

    private suspend fun sceneSimilarity(s: Scene): Double {
        val b = display(s.display ?: flow.stage?.display ?: DisplayRef.PRIMARY).bounds
        val r0 = placeRect(b, s.region, "normalized")
        val r = r0.copy(w = maxOf(1.0, minOf(r0.w, b.x + b.w - r0.x)), h = maxOf(1.0, minOf(r0.h, b.y + b.h - r0.y)))
        val v = (perform(InputAction.SceneHash(r)) as? Value.Str)?.v
        if (!isHash(v)) throw RunFailure(RunError(message = "this device cannot capture the screen for scenes", category = ErrorCategory.UNSUPPORTED))
        return hashSimilarity(v!!.lowercase(), s.hash)
    }

    /** Evaluates a condition: scene, then pixel, then expression (short-circuit AND). */
    private suspend fun holds(c: Condition): Boolean {
        c.scene?.let { sc ->
            val showing = sceneSimilarity(scene(sc.name)) >= sc.minSimilarity
            if (showing == sc.not) return false
        }
        c.pixel?.let { px ->
            val matched = colorDistance(readPixel(px.at), parseColor(px.color) ?: intArrayOf(0, 0, 0)) <= px.tolerance
            if (matched == px.not) return false
        }
        return truthy(evalExpr(c.expr, env))
    }

    private fun initVars() {
        for (v in flow.variables) {
            var value: Value = opts.inputs[v.name] ?: v.initial ?: defaultFor(v.type)
            if (v.type == "number") value = Value.Num(jsCoerceNumber(value))
            if (v.type == "boolean") value = Value.of(value == Value.TRUE || value == Value.Str("true"))
            vars[v.name] = value
        }
    }

    private suspend fun runTopLevel(steps: List<Step>) {
        var i = 0
        var gotos = 0L
        while (i < steps.size) {
            try {
                runStep(steps[i], "$i")
                i++
            } catch (e: Interrupt) {
                when (e.kind) {
                    Interrupt.Kind.GOTO -> {
                        val idx = steps.indexOfFirst { it.id == e.value }
                        if (idx < 0) throw RunFailure(RunError(message = "goto target \"${e.value}\" not found at top level", category = ErrorCategory.VALIDATION))
                        if (++gotos > flow.limits.maxIterations) throw RunFailure(RunError(message = "too many error jumps", category = ErrorCategory.LIMIT))
                        i = idx
                    }
                    Interrupt.Kind.BREAK, Interrupt.Kind.CONTINUE -> i++
                    Interrupt.Kind.STOP -> throw e
                }
            }
        }
    }

    private suspend fun runList(steps: List<Step>, path: String) {
        for (i in steps.indices) runStep(steps[i], "$path.$i")
    }

    private suspend fun gate() {
        if (signal.aborted) throw StopSignal
        if (clock.now() - startedAt > flow.limits.maxDurationMs) {
            throw RunFailure(RunError(message = "maximum run time reached (${Math.round(flow.limits.maxDurationMs / 1000.0)}s)", category = ErrorCategory.LIMIT))
        }
        checkDeadlines()
        while (true) {
            val g = pauseGate ?: break
            select<Unit> {
                g.onAwait {}
                signal.onAbort {}
            }
        }
        if (signal.aborted) throw StopSignal
    }

    private suspend fun sleep(ms: Long) {
        var remaining = maxOf(0L, ms)
        while (remaining > 0) {
            gate()
            val slice = minOf(remaining, SLICE_MS, untilDeadline())
            clock.sleep(slice, signal)
            remaining -= slice
        }
    }

    /** The outermost expired deadline wins, so an enclosing step's timeout is never swallowed inside it. */
    private fun checkDeadlines() {
        val now = clock.now()
        deadlines.firstOrNull { now > it.at }?.let { throw StepTimeoutSignal(it.id) }
    }

    /** Time until the nearest deadline expires (exclusive), so sleeps end exactly when it does. */
    private fun untilDeadline(): Long {
        val now = clock.now()
        return maxOf(1L, deadlines.minOfOrNull { it.at + 1 - now } ?: Long.MAX_VALUE)
    }

    private fun countStep() {
        stepCount++
        val max = flow.limits.maxSteps
        if (max != null && stepCount > max) {
            throw RunFailure(RunError(message = "maximum number of steps reached ($max)", category = ErrorCategory.LIMIT))
        }
    }

    /** One attempt of [step] under its optional deadline; returns the deadline it ran with. */
    private suspend fun attempt(step: Step, path: String, own: Array<Deadline?>) {
        countStep()
        val timeoutMs = step.meta.stepTimeoutMs ?: return exec(step, path)
        val d = Deadline(++nextDeadline, timeoutMs, clock.now() + timeoutMs)
        own[0] = d
        deadlines.add(d)
        try {
            exec(step, path)
        } finally {
            deadlines.remove(d)
        }
        // Work that ended after the deadline (an action that could not be interrupted) still timed out.
        if (clock.now() > d.at) throw StepTimeoutSignal(d.id)
    }

    private fun humanRandom(): Double = humanRng?.next() ?: (opts.random ?: Math::random)()

    /** Humanization: optional bounded random delay before an input action. */
    private suspend fun humanDelay() {
        val h = humanize ?: return
        if (h.delayMs > 0) sleep(minOf(h.delayMs, Math.floor(humanRandom() * (h.delayMs + 1)).toLong()))
    }


    private suspend fun runStep(step: Step, path: String) {
        if (step.meta.disabled) return
        gate()
        if (opts.debug && (step.meta.breakpoint || stepOnce)) {
            stepOnce = false
            emit(RunEvent.Breakpoint(step.id, clock.now()))
            pause()
            gate()
        }
        val t0 = clock.now()
        emit(RunEvent.StepStart(step.id, step.type, path, t0))
        val policy = step.meta.onError
        var attempt = 0
        while (true) {
            val own = arrayOfNulls<Deadline>(1)
            try {
                attempt(step, path, own)
                emit(RunEvent.StepEnd(step.id, true, clock.now() - t0, clock.now(), attempts = if (attempt > 0) attempt + 1 else null))
                return
            } catch (e: Throwable) {
                if (e is Interrupt || e is StopSignal || e is CancellationException || signal.aborted) throw e
                // Somebody else's deadline (an enclosing step): let it unwind to its owner.
                val d = own[0]
                if (e is StepTimeoutSignal && (d == null || e.deadlineId != d.id)) throw e
                val err = if (e is StepTimeoutSignal && d != null) {
                    emit(RunEvent.Timeout(step.id, d.timeoutMs, clock.now()))
                    RunError(step.id, path, "step timed out after ${d.timeoutMs} ms", ErrorCategory.TIMEOUT)
                } else {
                    toRunError(e, step.id, path)
                }
                if (err.category == ErrorCategory.LIMIT || isFatal(e)) throw RunFailure(err, fatal = isFatal(e))
                if (policy?.strategy == "retry" && attempt < policy.retries) {
                    attempt++
                    val delayMs = retryDelayMs(policy, attempt, opts.random ?: Math::random)
                    emit(RunEvent.Retry(step.id, attempt, clock.now(), delayMs, err.message))
                    sleep(delayMs)
                    continue
                }
                emit(RunEvent.StepEnd(step.id, false, clock.now() - t0, clock.now(), attempts = attempt + 1, error = err))
                if (policy?.strategy == "continue") {
                    emit(RunEvent.Log("warn", "step failed and was skipped: ${err.message}", step.id, clock.now()))
                    return
                }
                if (policy?.strategy == "goto" && policy.gotoStepId != null) {
                    emit(RunEvent.Log("warn", "step failed, jumping to ${policy.gotoStepId}: ${err.message}", step.id, clock.now()))
                    throw Interrupt(Interrupt.Kind.GOTO, policy.gotoStepId)
                }
                throw RunFailure(err)
            }
        }
    }

    private fun countAction() {
        if (++actions > flow.limits.maxActions) {
            throw RunFailure(RunError(message = "maximum number of actions reached (${flow.limits.maxActions})", category = ErrorCategory.LIMIT))
        }
    }

    private fun countIteration() {
        if (++iterations > flow.limits.maxIterations) {
            throw RunFailure(RunError(message = "maximum number of loop iterations reached (${flow.limits.maxIterations})", category = ErrorCategory.LIMIT))
        }
    }

    private fun text(s: String, maskSecrets: Boolean = false): String = interpolate(s, env, maskSecrets, opts.secret)

    private fun setVar(name: String, value: Value) {
        vars[name] = value
        emit(RunEvent.Var(name, value, clock.now()))
    }

    /**
     * Runs backend work in its own job and races it against stop: a stopped run returns at once and the backend job
     * is cancelled without waiting for it (an in-flight HTTP request or gesture never delays Halt).
     */
    private suspend fun <T> abortable(block: suspend () -> T): T {
        if (signal.aborted) throw StopSignal
        // A standalone job (not a child of the caller): the caller never waits for it, and it is always cancelled
        // in `finally`, so a stopped or cancelled run cannot leak backend work.
        val job = Job()
        val scope = CoroutineScope(currentCoroutineContext().minusKey(Job) + job)
        val work = scope.async { block() }
        // With the wall clock, a hanging action is preempted when the innermost step deadline passes.
        val nearest = if (clock === RealClock) deadlines.minByOrNull { it.at } else null
        val timer = nearest?.let { d -> scope.async { delay(maxOf(0L, d.at + 1 - clock.now())); d.id } }
        try {
            return select {
                work.onAwait { it }
                signal.onAbort { throw StopSignal }
                if (timer != null) timer.onAwait { id -> throw StepTimeoutSignal(id) }
            }
        } finally {
            job.cancel()
        }
    }

    private suspend fun perform(action: InputAction): Value? = abortable { backend.perform(action) }

    private suspend fun exec(s: Step, path: String) {
        if (s.type in INPUT_TYPES) {
            countAction()
            checkTakeover()
            if (s !is Step.Key) humanDelay()
        }
        when (s) {
            is Step.Click -> {
                val t = target(s.target)
                perform(InputAction.Click(t, s.button, s.clicks, s.holdMs, s.modifiers))
                track(t)
            }
            is Step.Move -> {
                val t = target(s.target)
                perform(InputAction.Move(t, s.durationMs))
                track(t)
            }
            is Step.Drag -> {
                val from = target(s.from)
                val to = target(s.to)
                perform(InputAction.Drag(from, to, s.durationMs, s.button))
                track(to)
            }
            is Step.Scroll -> {
                val t = s.target?.let { place(it) }
                perform(InputAction.Scroll(s.dx, s.dy, t))
                if (t != null) track(t)
            }
            is Step.Key -> for (i in 0 until s.repeat) {
                if (i > 0) {
                    gate()
                    countAction()
                }
                humanDelay()
                perform(InputAction.Key(s.key, s.modifiers, s.action))
            }
            is Step.Type -> perform(InputAction.TypeText(text(s.text), s.perCharDelayMs))
            is Step.Wait -> {
                val jitter = if (s.jitterMs > 0) Math.floor((opts.random ?: Math::random)() * (s.jitterMs + 1)).toLong() else 0L
                sleep(s.ms + jitter)
            }
            is Step.WaitFor -> {
                val deadline = clock.now() + s.timeoutMs
                while (true) {
                    if (holds(s.condition)) return
                    if (clock.now() >= deadline) throw RunFailure(RunError(s.id, path, "condition not met within ${s.timeoutMs} ms", ErrorCategory.TARGET))
                    sleep(s.pollMs)
                }
            }
            is Step.SetVar -> setVar(s.name, evalExpr(s.value, env))
            // Log lines end up in the run ledger: secrets are verified but never written out.
            is Step.Log -> emit(RunEvent.Log(s.level, text(s.message, maskSecrets = true), s.id, clock.now()))
            is Step.Notify -> perform(InputAction.Notify(text(s.title), text(s.body)))
            is Step.Confirm -> {
                val message = text(s.message)
                val ok = abortable { backend.confirm(message) }
                if (s.resultVar != null) setVar(s.resultVar, Value.of(ok)) else if (!ok) throw Interrupt(Interrupt.Kind.STOP, "declined")
            }
            is Step.Clipboard -> if (s.op == "set") {
                perform(InputAction.ClipboardSet(text(s.value ?: "")))
            } else {
                val v = perform(InputAction.ClipboardGet)
                if (s.variable != null) setVar(s.variable, v ?: Value.Str(""))
            }
            is Step.LaunchApp -> perform(InputAction.LaunchApp(s.app, s.args))
            is Step.OpenUrl -> perform(InputAction.OpenUrl(text(s.url)))
            is Step.Window -> perform(InputAction.Window(s.op, s.matchTitle, s.matchApp, s.rect))
            is Step.AndroidGlobal -> perform(InputAction.AndroidGlobal(s.action))
            is Step.Http -> {
                val headers = s.headers.mapValues { (_, v) -> text(v) }
                val res = perform(InputAction.Http(s.method, text(s.url), headers, s.body?.let { text(it) }))
                if (s.resultVar != null) setVar(s.resultVar, res ?: Value.Null)
            }
            is Step.File -> {
                val res = perform(InputAction.FileOp(s.op, text(s.path), s.dest?.let { if (it.isEmpty()) it else text(it) }, s.content?.let { text(it) }))
                if (s.resultVar != null) setVar(s.resultVar, res ?: Value.Null)
            }
            is Step.Ocr -> {
                val region = s.display?.let { placeRect(display(it).bounds, s.region, "display") } ?: s.region
                val res = perform(InputAction.Ocr(region))
                setVar(s.resultVar, Value.Str(toStr(res ?: Value.Str(""))))
            }
            is Step.FindImage -> {
                // The search region is only passed for display-scoped steps (older flows keep searching the whole screen).
                val region = if (s.target.display != null) (place(s.target) as? Target.Image)?.region else null
                val res = perform(InputAction.FindImage(s.target.ref, s.target.confidence, s.timeoutMs, region))
                setVar(s.resultVar, res ?: Value.Null)
            }
            is Step.PixelCheck -> {
                val c = readPixel(s.at)
                setVar(s.resultVar, s.color?.let { Value.of(colorDistance(c, parseColor(it) ?: intArrayOf(0, 0, 0)) <= s.tolerance) } ?: Value.Str(toHexColor(c)))
            }
            is Step.WaitForPixel -> {
                val deadline = s.timeoutMs?.let { clock.now() + it }
                val want = parseColor(s.color) ?: intArrayOf(0, 0, 0)
                while (true) {
                    val matched = colorDistance(readPixel(s.at), want) <= s.tolerance
                    if (matched != s.not) return
                    if (deadline != null && clock.now() >= deadline) {
                        throw RunFailure(RunError(s.id, path, "pixel condition not met within ${s.timeoutMs} ms", ErrorCategory.TARGET))
                    }
                    sleep(s.pollMs)
                }
            }
            is Step.MatchScene -> {
                val names = s.scenes ?: flow.scenes.orEmpty().map { it.name }
                var bestName = ""
                var bestSim = -1.0
                for (name in names) {
                    val sim = sceneSimilarity(scene(name))
                    if (sim > bestSim) {
                        bestSim = sim
                        bestName = name
                    }
                }
                setVar(s.resultVar, Value.Str(if (bestSim >= s.minSimilarity) bestName else ""))
                if (s.similarityVar != null) setVar(s.similarityVar, Value.Num(maxOf(0.0, bestSim)))
            }
            is Step.SwitchProfile -> perform(InputAction.SwitchProfile(s.profileId))
            is Step.RunFlow -> {
                val target = opts.resolveFlow?.invoke(s.flowId)
                    ?: throw RunFailure(RunError(s.id, path, "flow \"${s.flowId}\" not found", ErrorCategory.VALIDATION))
                if (callDepth >= opts.maxCallDepth) throw RunFailure(RunError(s.id, path, "runFlow nesting too deep", ErrorCategory.LIMIT))
                callDepth++
                try {
                    runList(target.steps, "$path>${s.flowId}")
                } finally {
                    callDepth--
                }
            }
            is Step.Stop -> throw Interrupt(Interrupt.Kind.STOP, s.reason ?: "stop step")
            is Step.Break -> throw Interrupt(Interrupt.Kind.BREAK)
            is Step.Continue -> throw Interrupt(Interrupt.Kind.CONTINUE)
            is Step.Group -> runList(s.body, path)
            is Step.If -> if (holds(s.condition)) runList(s.then, "$path.then") else runList(s.otherwise, "$path.else")
            is Step.Loop -> {
                var i = 0L
                var roundStart = 0L
                while (true) {
                    if (s.mode == "count" && i >= (s.count ?: 0L)) return
                    val cooldown = s.cooldownMs ?: 0L
                    if (cooldown > 0 && i > 0) {
                        val rest = roundStart + cooldown - clock.now()
                        if (rest > 0) sleep(rest)
                    }
                    if (s.mode == "while" && !holds(s.condition!!)) return
                    countIteration()
                    roundStart = clock.now()
                    if (s.indexVar != null) setVar(s.indexVar, Value.Num(i.toDouble()))
                    try {
                        runList(s.body, "$path.body")
                    } catch (e: Interrupt) {
                        if (e.kind == Interrupt.Kind.BREAK) return
                        if (e.kind != Interrupt.Kind.CONTINUE) throw e
                    }
                    i++
                    // A loop whose body never waits would spin; always yield so stop/pause stay responsive.
                    gate()
                    if (s.body.isEmpty()) sleep(SLICE_MS)
                }
            }
            is Step.ForEach -> {
                val list = evalExpr(s.list, env)
                val items = (list as? Value.VList)?.items ?: listOf(list)
                for (item in items) {
                    countIteration()
                    setVar(s.itemVar, item)
                    try {
                        runList(s.body, "$path.body")
                    } catch (e: Interrupt) {
                        if (e.kind == Interrupt.Kind.BREAK) return
                        if (e.kind != Interrupt.Kind.CONTINUE) throw e
                    }
                    gate()
                }
            }
            is Step.Try -> try {
                runList(s.body, "$path.body")
            } catch (e: Throwable) {
                if (e is Interrupt || e is StepTimeoutSignal || e is StopSignal || e is CancellationException || signal.aborted) throw e
                val err = toRunError(e, s.id, path)
                if (err.category == ErrorCategory.LIMIT || isFatal(e)) throw e
                if (s.errorVar != null) setVar(s.errorVar, Value.Str(err.message))
                runList(s.catchSteps, "$path.catch")
            }
        }
    }

    private fun handleTerminal(e: Throwable): RunResult {
        externalError?.let { err ->
            emit(RunEvent.Error(err, clock.now()))
            return finish(RunStatus.FAILED, err.message, err)
        }
        if (e is StopSignal || signal.aborted) return finish(RunStatus.STOPPED, stopReason ?: "user")
        if (e is Interrupt && e.kind == Interrupt.Kind.STOP) return finish(RunStatus.STOPPED, e.value)
        if (e is Interrupt) return finish(RunStatus.COMPLETED)
        if (e is CancellationException) return finish(RunStatus.STOPPED, stopReason ?: "cancelled")
        if (e is StepTimeoutSignal) {
            val err = RunError(message = "step timed out", category = ErrorCategory.TIMEOUT)
            emit(RunEvent.Error(err, clock.now()))
            return finish(RunStatus.FAILED, err.message, err)
        }
        val err = if (e is RunFailure) e.runError else toRunError(e)
        emit(RunEvent.Error(err, clock.now()))
        return finish(RunStatus.FAILED, err.message, err)
    }

    private fun finish(status: RunStatus, reason: String? = null, error: RunError? = null): RunResult {
        synchronized(lock) {
            setState(
                when (status) {
                    RunStatus.COMPLETED -> RunState.COMPLETED
                    RunStatus.STOPPED -> RunState.STOPPED
                    RunStatus.FAILED -> RunState.FAILED
                },
            )
        }
        val endedAt = clock.now()
        deadlines.clear()
        return RunResult(status, reason, error, actions, iterations, endedAt - startedAt, LinkedHashMap(vars), startedAt, endedAt, stepCount)
    }

    private fun setState(s: RunState) {
        currentState = s
        emit(RunEvent.State(s, clock.now()))
    }

    private fun emit(e: RunEvent) {
        try {
            opts.onEvent?.invoke(e)
        } catch (_: Throwable) {
            /* a broken listener must never break a run */
        }
    }
}

/** Options for one run; the Kotlin counterpart of `RunOptions` in engine.ts. */
class RunOptions(
    val clock: Clock = RealClock,
    val random: (() -> Double)? = null,
    val onEvent: ((RunEvent) -> Unit)? = null,
    /** Values for variables that declare a `prompt`, collected by the UI before the run. */
    val inputs: Map<String, Value> = emptyMap(),
    /** Secret resolver for {{secret:name}} — values come from the Android Keystore, never from the flow. */
    val secret: ((String) -> String?)? = null,
    val confirmRisk: (suspend (RiskReport) -> Boolean)? = null,
    val confirmScreenChange: (suspend (ScreenInfo, ScreenInfo) -> Boolean)? = null,
    /** onMissingDisplay "ask": may the run use the primary display instead of the one labelled? Default: backend confirm. */
    val confirmMissingDisplay: (suspend (String) -> Boolean)? = null,
    val resolveFlow: ((String) -> Flow?)? = null,
    val debug: Boolean = false,
    val skipCountdown: Boolean = false,
    val maxCallDepth: Int = 8,
    val zone: ZoneId = ZoneId.systemDefault(),
    val runId: String? = null,
)

class Interrupt(val kind: Kind, val value: String? = null) : Exception(kind.name, null, false, false) {
    enum class Kind { BREAK, CONTINUE, STOP, GOTO }
}

class RunFailure(val runError: RunError, val fatal: Boolean = false) : Exception(runError.message)

/** A step deadline passed; only the step that owns [deadlineId] handles it. */
class StepTimeoutSignal(val deadlineId: Long) : Exception("step timed out", null, false, false)

private fun isFatal(e: Throwable) = (e is BackendException && e.fatal) || (e is RunFailure && e.fatal)

private fun defaultFor(t: String): Value = when (t) {
    "number" -> Value.Num(0.0)
    "boolean" -> Value.FALSE
    "list" -> Value.VList(emptyList())
    else -> Value.Str("")
}

fun toRunError(e: Throwable, stepId: String? = null, path: String? = null): RunError = when (e) {
    is RunFailure -> RunError(e.runError.stepId ?: stepId, e.runError.path ?: path, e.runError.message, e.runError.category)
    is ExprError -> RunError(stepId, path, e.message ?: "expression error", ErrorCategory.EXPRESSION)
    is BackendException -> RunError(stepId, path, e.message ?: "action failed", e.category)
    else -> RunError(stepId, path, e.message ?: e.toString(), ErrorCategory.ACTION)
}

fun usesScreenCoordinates(steps: List<Step>): Boolean {
    var uses = false
    walkSteps(steps) { s, _, _ ->
        if (s.targets().any { (it is Target.Point && it.space == "screen") || (it is Target.Region && it.space == "screen") }) uses = true
    }
    return uses
}
