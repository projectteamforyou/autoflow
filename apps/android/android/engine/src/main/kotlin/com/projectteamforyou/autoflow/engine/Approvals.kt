package com.projectteamforyou.autoflow.engine

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.security.MessageDigest

/**
 * Remembered risk approvals for runs nobody is watching (the Android side of the desktop's approvals.rs).
 *
 * A flow with steps that need approval (HTTP, files, secrets leaving the keystore, …) is approved in the app's
 * pre-run sheet. That approval is remembered as `flow id → hash of what the flow would do`, so the same flow can later
 * start from a schedule, a device event or a hotkey without anyone to ask. Any edit to its steps or variables — or to
 * a flow it calls through "run flow" — changes the hash, and the flow has to be approved in the app again.
 *
 * Pure logic (no Android types): hashing and lookup. The app stores the map.
 */
object Approvals {
    /**
     * SHA-256 (lowercase hex) of the flow's steps and variables plus those of every flow it can reach through enabled
     * "run flow" steps (resolved with [resolveFlow], in id order). Hashed from the JSON the flow was parsed from with
     * object keys sorted, so the same flow always gives the same hash whatever order its fields arrived in.
     * Renaming a flow or changing its trigger keeps the approval. `null` when a flow has no source JSON: then nothing
     * is approved rather than every such flow sharing a hash.
     */
    fun stepsHash(flow: Flow, resolveFlow: (String) -> Flow?): String? {
        val own = flow.source ?: return null
        val parts = ArrayList<JsonElement>()
        parts.add(own["steps"] ?: JsonArray(emptyList()))
        parts.add(own["variables"] ?: JsonArray(emptyList()))
        val called = calledFlows(flow, resolveFlow)
        if (called.isNotEmpty()) {
            parts.add(
                JsonArray(
                    called.map { (id, f) ->
                        val src = f.source ?: return null
                        JsonArray(listOf(JsonPrimitive(id), src["steps"] ?: JsonArray(emptyList()), src["variables"] ?: JsonArray(emptyList())))
                    },
                ),
            )
        }
        val text = canonical(JsonArray(parts))
        return MessageDigest.getInstance("SHA-256").digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    }

    /** Whether exactly this hash was approved for [flowId]. */
    fun isApproved(approved: Map<String, String>, flowId: String, hash: String?): Boolean = hash != null && approved[flowId] == hash

    /**
     * Every flow [flow] can reach through enabled "run flow" steps, by id (sorted). Each flow is visited once, so call
     * cycles end; the caller itself and ids [resolveFlow] does not know are left out (a missing flow fails the run when
     * it is called, and it appearing later changes the hash). No depth limit: covering more can only ask again.
     */
    internal fun calledFlows(flow: Flow, resolveFlow: (String) -> Flow?): Map<String, Flow> {
        val called = sortedMapOf<String, Flow>()
        val pending = ArrayDeque<List<Step>>()
        pending.add(flow.steps)
        while (pending.isNotEmpty()) {
            walkSteps(pending.removeFirst()) { s, _, _ ->
                if (s !is Step.RunFlow || s.meta.disabled || s.flowId == flow.id || s.flowId in called) return@walkSteps
                val target = resolveFlow(s.flowId) ?: return@walkSteps
                called[s.flowId] = target
                pending.add(target.steps)
            }
        }
        return called
    }

    /** Compact JSON with object keys sorted at every level. */
    internal fun canonical(e: JsonElement): String = buildString { write(e, this) }

    private fun write(e: JsonElement, out: StringBuilder) {
        when (e) {
            is JsonObject -> {
                out.append('{')
                e.keys.sorted().forEachIndexed { i, k ->
                    if (i > 0) out.append(',')
                    out.append(JsonPrimitive(k).toString()).append(':')
                    write(e.getValue(k), out)
                }
                out.append('}')
            }
            is JsonArray -> {
                out.append('[')
                e.forEachIndexed { i, x ->
                    if (i > 0) out.append(',')
                    write(x, out)
                }
                out.append(']')
            }
            JsonNull -> out.append("null")
            is JsonPrimitive -> out.append(e.toString())
        }
    }
}
