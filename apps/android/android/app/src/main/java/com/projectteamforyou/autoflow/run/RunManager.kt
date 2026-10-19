package com.projectteamforyou.autoflow.run

import android.content.Context
import android.util.Log
import com.projectteamforyou.autoflow.a11y.AutoFlowAccessibilityService
import com.projectteamforyou.autoflow.bridge.BridgeEvents
import com.projectteamforyou.autoflow.engine.Backend
import com.projectteamforyou.autoflow.engine.ErrorCategory
import com.projectteamforyou.autoflow.engine.Flow
import com.projectteamforyou.autoflow.engine.FlowRun
import com.projectteamforyou.autoflow.engine.RunError
import com.projectteamforyou.autoflow.engine.RunEvent
import com.projectteamforyou.autoflow.engine.RunOptions
import com.projectteamforyou.autoflow.engine.RunState
import com.projectteamforyou.autoflow.engine.Value
import com.projectteamforyou.autoflow.secrets.SecretStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap

/**
 * Owns every native run in the process. Runs execute on [Dispatchers.Default] (never the main thread); each one streams
 * its RunEvents to the bridge, keeps the foreground "run" notification current and shows the floating Halt button
 * while anything is running. The foreground service exists only while at least one run is active.
 */
object RunManager {
    private const val TAG = "AutoFlowRuns"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    class Active(val flow: Flow, val run: FlowRun, val origin: String) {
        @Volatile var state: RunState = RunState.IDLE
        @Volatile var countdownMs: Long = 0
        @Volatile var stepLabel: String? = null
        var job: Job? = null
    }

    private val runs = ConcurrentHashMap<String, Active>()
    private val lastTriggerStart = ConcurrentHashMap<String, Long>()

    /** Flows the native side knows (from triggers_sync and run_start's optional library) for runFlow steps. */
    private val library = ConcurrentHashMap<String, Flow>()

    fun rememberFlows(flows: Collection<Flow>) {
        flows.forEach { library[it.id] = it }
    }

    fun active(): Collection<Active> = runs.values
    fun hasActiveRuns() = runs.isNotEmpty()
    fun isActiveRun(runId: String) = runs.containsKey(runId)
    fun isRunning(flowId: String) = runs.values.any { it.flow.id == flowId }

    class StartRequest(
        val flow: Flow,
        val inputs: Map<String, Value> = emptyMap(),
        val approvedRisk: Boolean,
        val approvedScreenChange: Boolean,
        val dryRun: Boolean = false,
        /** "manual" (from the app) or the trigger type that started it. */
        val origin: String = "manual",
    )

    /** Starts a run and returns its id; events arrive on [BridgeEvents]. */
    fun start(context: Context, req: StartRequest): String {
        val app = context.applicationContext
        val backend: Backend = if (req.dryRun) DryRunBackend(app) else AndroidBackend(app)
        val secrets = SecretStore.get(app)
        var active: Active? = null
        val run = FlowRun(
            req.flow, backend,
            RunOptions(
                inputs = req.inputs,
                secret = { secrets.get(it) },
                confirmRisk = { req.approvedRisk },
                confirmScreenChange = { _, _ -> req.approvedScreenChange },
                resolveFlow = { id -> library[id] },
                onEvent = { e -> active?.let { onEvent(app, it, e) } },
            ),
        )
        val a = Active(req.flow, run, req.origin)
        active = a
        runs[run.id] = a
        RunService.update(app)
        a.job = scope.launch {
            val result = try {
                run.start()
            } finally {
                runs.remove(run.id)
            }
            BridgeEvents.runEnded(run.id, result.toJson())
            Log.i(TAG, "run ${run.id} (${req.origin}) ended: ${result.status.json}")
            RunService.update(app)
            AutoFlowAccessibilityService.instance?.onRunsChanged()
        }
        AutoFlowAccessibilityService.instance?.onRunsChanged()
        return run.id
    }

    /**
     * Trigger-initiated start, honouring limits.preventOverlap and limits.cooldownMs. Risk is treated as approved:
     * enabling a trigger in the app is the user's approval (the web UI shows the risk report before it syncs).
     * A recorded-screen mismatch is never auto-approved.
     */
    fun startFromTrigger(context: Context, flow: Flow, origin: String): String? {
        if (flow.limits.preventOverlap && isRunning(flow.id)) {
            Log.i(TAG, "skip ${flow.id}: already running")
            return null
        }
        val now = System.currentTimeMillis()
        val last = lastTriggerStart[flow.id]
        if (last != null && flow.limits.cooldownMs > 0 && now - last < flow.limits.cooldownMs) {
            Log.i(TAG, "skip ${flow.id}: cooldown")
            return null
        }
        lastTriggerStart[flow.id] = now
        return start(context, StartRequest(flow, approvedRisk = true, approvedScreenChange = false, origin = origin))
    }

    private fun onEvent(context: Context, a: Active, e: RunEvent) {
        when (e) {
            is RunEvent.State -> {
                a.state = e.state
                RunService.update(context)
            }
            is RunEvent.Countdown -> {
                a.countdownMs = e.remainingMs
                RunService.update(context)
            }
            is RunEvent.StepStart -> a.stepLabel = e.stepType
            else -> Unit
        }
        BridgeEvents.run(a.run.id, e.toJson())
    }

    fun pause(runId: String) = runs[runId]?.run?.pause()
    fun resume(runId: String) = runs[runId]?.run?.resume()
    fun stop(runId: String, reason: String = "user") = runs[runId]?.run?.stop(reason)

    fun pauseAll() = runs.values.forEach { it.run.pause() }
    fun resumeAll() = runs.values.forEach { it.run.resume() }

    /** Halt: stops every run immediately and cancels any gesture in flight. */
    fun haltAll(reason: String = "halt") {
        runs.values.forEach { it.run.stop(reason) }
        AutoFlowAccessibilityService.instance?.cancelGestures()
    }

    /** A protected system screen came to the front: every run that drives input fails with category "permission". */
    fun failAll(message: String) {
        runs.values.forEach { it.run.fail(RunError(message = message, category = ErrorCategory.PERMISSION)) }
        AutoFlowAccessibilityService.instance?.cancelGestures()
    }
}
