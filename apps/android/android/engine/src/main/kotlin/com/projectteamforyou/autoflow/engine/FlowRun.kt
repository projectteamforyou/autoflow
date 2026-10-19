package com.projectteamforyou.autoflow.engine

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.async
import kotlinx.coroutines.currentCoroutineContext
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
 * screen geometry drift) and the same RunEvent stream.
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
    private var startedAt = 0L
    private var callDepth = 0
    private val clock = opts.clock
    private val env = ExprEnv(vars, now = { clock.now() }, random = opts.random, zone = opts.zone)

    companion object {
        /** Stop latency target is 500 ms; long waits are sliced so pause/stop/limits are observed quickly. */
        const val SLICE_MS = 100L
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
            val slice = minOf(remaining, SLICE_MS)
            clock.sleep(slice, signal)
            remaining -= slice
        }
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
            try {
                exec(step, path)
                emit(RunEvent.StepEnd(step.id, true, clock.now() - t0, clock.now()))
                return
            } catch (e: Throwable) {
                if (e is Interrupt || e is StopSignal || e is CancellationException || signal.aborted) throw e
                val err = toRunError(e, step.id, path)
                if (err.category == ErrorCategory.LIMIT || isFatal(e)) throw RunFailure(err, fatal = isFatal(e))
                if (policy?.strategy == "retry" && attempt < policy.retries) {
                    attempt++
                    emit(RunEvent.Retry(step.id, attempt, clock.now()))
                    sleep(policy.backoffMs * attempt)
                    continue
                }
                emit(RunEvent.StepEnd(step.id, false, clock.now() - t0, clock.now()))
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

    private fun text(s: String): String = interpolate(s, env, opts.secret)

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
        val work = CoroutineScope(currentCoroutineContext().minusKey(Job) + job).async { block() }
        try {
            return select {
                work.onAwait { it }
                signal.onAbort { throw StopSignal }
            }
        } finally {
            job.cancel()
        }
    }

    private suspend fun perform(action: InputAction): Value? = abortable { backend.perform(action) }

    private suspend fun exec(s: Step, path: String) {
        if (s.type in INPUT_TYPES) countAction()
        when (s) {
            is Step.Click -> perform(InputAction.Click(s.target, s.button, s.clicks, s.holdMs, s.modifiers))
            is Step.Move -> perform(InputAction.Move(s.target, s.durationMs))
            is Step.Drag -> perform(InputAction.Drag(s.from, s.to, s.durationMs, s.button))
            is Step.Scroll -> perform(InputAction.Scroll(s.dx, s.dy, s.target))
            is Step.Key -> for (i in 0 until s.repeat) {
                if (i > 0) {
                    gate()
                    countAction()
                }
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
                    if (truthy(evalExpr(s.condition, env))) return
                    if (clock.now() >= deadline) throw RunFailure(RunError(s.id, path, "condition not met within ${s.timeoutMs} ms", ErrorCategory.TARGET))
                    sleep(s.pollMs)
                }
            }
            is Step.SetVar -> setVar(s.name, evalExpr(s.value, env))
            is Step.Log -> emit(RunEvent.Log(s.level, text(s.message), s.id, clock.now()))
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
                val res = perform(InputAction.Ocr(s.region))
                setVar(s.resultVar, Value.Str(toStr(res ?: Value.Str(""))))
            }
            is Step.FindImage -> {
                val res = perform(InputAction.FindImage(s.target.ref, s.target.confidence, s.timeoutMs))
                setVar(s.resultVar, res ?: Value.Null)
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
            is Step.If -> if (truthy(evalExpr(s.condition, env))) runList(s.then, "$path.then") else runList(s.otherwise, "$path.else")
            is Step.Loop -> {
                var i = 0L
                while (true) {
                    if (s.mode == "count" && i >= (s.count ?: 0L)) return
                    if (s.mode == "while" && !truthy(evalExpr(s.condition!!, env))) return
                    countIteration()
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
                if (e is Interrupt || e is StopSignal || e is CancellationException || signal.aborted) throw e
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
        return RunResult(status, reason, error, actions, iterations, endedAt - startedAt, LinkedHashMap(vars), startedAt, endedAt)
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
