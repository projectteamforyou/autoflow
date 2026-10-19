//! Executor behaviour, mirroring `describe("engine")` in packages/core/test/core.test.ts.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use autoflow_engine::{
    BackendError, ErrorCategory, FlowRun, InputAction, MockBackend, Platform, RealClock, RunEvent, RunOptions, RunState, RunStatus, Value,
};
use common::{approve_risk, mk, mk_with, run, run_with};
use serde_json::json;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

fn click(id: &str) -> serde_json::Value {
    json!({ "id": id, "type": "click", "target": { "kind": "point", "x": 10, "y": 20, "space": "screen" }, "button": "left", "clicks": 1, "holdMs": 0, "modifiers": [] })
}

#[test]
fn runs_loops_variables_and_conditions_deterministically() {
    let flow = mk(json!([
        { "id": "v", "type": "setVar", "name": "n", "value": "0" },
        { "id": "l", "type": "loop", "mode": "count", "count": 5, "indexVar": "i", "body": [
            { "id": "inc", "type": "setVar", "name": "n", "value": "n + i" },
            { "id": "if", "type": "if", "condition": { "expr": "i == 3" }, "then": [{ "id": "b", "type": "break" }], "else": [] },
            click("c")
        ]}
    ]));
    let r = run(flow);
    assert_eq!(r.result.status, RunStatus::Completed);
    assert_eq!(r.result.vars["n"], Value::Num(6.0));
    assert_eq!(r.mock.count("click"), 3);
}

#[test]
fn enforces_the_max_actions_limit() {
    let mut flow = mk(json!([{ "id": "l", "type": "loop", "mode": "forever", "body": [
        { "id": "k", "type": "key", "key": "a", "modifiers": [], "action": "press", "repeat": 1 },
        { "id": "w", "type": "wait", "ms": 1, "jitterMs": 0 }
    ]}]));
    flow.limits.max_actions = 50;
    let r = run(flow);
    assert_eq!(r.result.status, RunStatus::Failed);
    assert_eq!(r.result.error.as_ref().map(|e| e.category), Some(ErrorCategory::Limit));
    assert_eq!(r.result.actions, 51);
}

#[test]
fn enforces_the_max_duration_limit_with_virtual_time() {
    let mut flow =
        mk(json!([{ "id": "l", "type": "loop", "mode": "forever", "body": [{ "id": "w", "type": "wait", "ms": 1000, "jitterMs": 0 }] }]));
    flow.limits.max_duration_ms = 10_000;
    let started = Instant::now();
    let r = run(flow);
    assert_eq!(r.result.status, RunStatus::Failed);
    let err = r.result.error.as_ref().expect("error");
    assert_eq!(err.category, ErrorCategory::Limit);
    assert_eq!(err.message, "maximum run time reached (10s)");
    assert!(r.result.duration_ms >= 10_000 && r.result.duration_ms < 11_200, "{}", r.result.duration_ms);
    assert!(started.elapsed() < Duration::from_secs(2), "virtual time must not sleep for real");
}

#[test]
fn enforces_the_max_iterations_limit() {
    let mut flow =
        mk(json!([{ "id": "l", "type": "loop", "mode": "forever", "body": [{ "id": "w", "type": "wait", "ms": 1, "jitterMs": 0 }] }]));
    flow.limits.max_iterations = 20;
    let r = run(flow);
    assert_eq!(r.result.status, RunStatus::Failed);
    assert_eq!(r.result.iterations, 21);
    assert_eq!(r.result.error.unwrap().message, "maximum number of loop iterations reached (20)");
}

#[test]
fn stops_promptly_on_request() {
    let flow =
        mk(json!([{ "id": "l", "type": "loop", "mode": "forever", "body": [{ "id": "w", "type": "wait", "ms": 50, "jitterMs": 0 }] }]));
    let run = FlowRun::new(flow, Box::new(MockBackend::new(Platform::Web)), RunOptions { skip_countdown: true, ..RunOptions::default() });
    let (handle, join) = run.spawn().expect("thread");
    std::thread::sleep(Duration::from_millis(30));
    let t0 = Instant::now();
    handle.stop("test");
    let result = join.join().expect("run thread");
    assert!(t0.elapsed() < Duration::from_millis(500), "stop took {:?}", t0.elapsed());
    assert_eq!(result.status, RunStatus::Stopped);
    assert_eq!(result.reason.as_deref(), Some("test"));
}

#[test]
fn stop_interrupts_long_waits_and_countdowns_within_one_slice() {
    // A 60 s wait must end within one 100 ms slice (plus scheduling slack).
    let flow = mk(json!([{ "id": "w", "type": "wait", "ms": 60000, "jitterMs": 0 }]));
    let (handle, join) =
        FlowRun::new(flow, Box::new(MockBackend::new(Platform::Windows)), RunOptions { skip_countdown: true, ..RunOptions::default() })
            .spawn()
            .expect("thread");
    std::thread::sleep(Duration::from_millis(80));
    let t0 = Instant::now();
    handle.stop("halt");
    let r = join.join().expect("run thread");
    assert!(t0.elapsed() < Duration::from_millis(250), "stop latency {:?}", t0.elapsed());
    assert_eq!(r.status, RunStatus::Stopped);

    // During the countdown.
    let flow = mk(json!([click("c")]));
    let (handle, join) = FlowRun::new(flow, Box::new(MockBackend::new(Platform::Windows)), RunOptions::default()).spawn().expect("thread");
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(handle.state(), RunState::Countdown);
    let t0 = Instant::now();
    handle.stop("user");
    let r = join.join().expect("run thread");
    assert!(t0.elapsed() < Duration::from_millis(250));
    assert_eq!(r.status, RunStatus::Stopped);
    assert_eq!(r.actions, 0);
}

#[test]
fn pauses_and_resumes() {
    let flow = mk(
        json!([{ "id": "l", "type": "loop", "mode": "count", "count": 3, "body": [{ "id": "w", "type": "wait", "ms": 20, "jitterMs": 0 }] }]),
    );
    let (handle, join) = FlowRun::new(
        flow,
        Box::new(MockBackend::new(Platform::Web)),
        RunOptions { skip_countdown: true, clock: Some(Arc::new(RealClock)), ..RunOptions::default() },
    )
    .spawn()
    .expect("thread");
    std::thread::sleep(Duration::from_millis(10));
    handle.pause();
    assert_eq!(handle.state(), RunState::Paused);
    std::thread::sleep(Duration::from_millis(50));
    assert_eq!(handle.state(), RunState::Paused);
    handle.resume();
    assert_eq!(join.join().expect("run thread").status, RunStatus::Completed);
}

#[test]
fn stop_while_paused_ends_the_run() {
    let flow = mk(json!([{ "id": "w", "type": "wait", "ms": 5000, "jitterMs": 0 }]));
    let (handle, join) =
        FlowRun::new(flow, Box::new(MockBackend::new(Platform::Web)), RunOptions { skip_countdown: true, ..RunOptions::default() })
            .spawn()
            .expect("thread");
    std::thread::sleep(Duration::from_millis(20));
    handle.pause();
    std::thread::sleep(Duration::from_millis(20));
    handle.stop("user");
    let r = join.join().expect("run thread");
    assert_eq!(r.status, RunStatus::Stopped);
}

#[test]
fn retries_continues_and_catches_errors() {
    let failures = Arc::new(AtomicI32::new(2));
    let f = Arc::clone(&failures);
    let backend = MockBackend::new(Platform::Web).with_hook(move |a| {
        if matches!(a, InputAction::Click { .. }) && f.fetch_sub(1, Ordering::SeqCst) > 0 {
            return Some(Err(BackendError::action("target missing")));
        }
        None
    });
    let flow = mk(json!([
        { "id": "c", "type": "click", "target": { "kind": "current" }, "button": "left", "clicks": 1, "holdMs": 0, "modifiers": [], "onError": { "strategy": "retry", "retries": 3, "backoffMs": 10 } },
        { "id": "t", "type": "try", "errorVar": "e", "body": [{ "id": "bad", "type": "setVar", "name": "x", "value": "1/0" }], "catch": [{ "id": "ok", "type": "setVar", "name": "caught", "value": "e" }] },
        { "id": "skip", "type": "setVar", "name": "y", "value": "unknownVar", "onError": { "strategy": "continue", "retries": 0, "backoffMs": 0 } },
        { "id": "end", "type": "setVar", "name": "done", "value": "true" }
    ]));
    let r = run_with(flow, backend, RunOptions::default());
    assert_eq!(r.result.status, RunStatus::Completed);
    assert_eq!(r.events.iter().filter(|e| matches!(e, RunEvent::Retry { .. })).count(), 2);
    assert!(r.result.vars["caught"].to_js_string().contains("division by zero"));
    assert_eq!(r.result.vars["done"], Value::Bool(true));
    let warn = r.events.iter().find_map(|e| match e {
        RunEvent::Log { message, .. } => Some(message.clone()),
        _ => None,
    });
    assert_eq!(warn.as_deref(), Some("step failed and was skipped: unknown variable \"unknownVar\""));
}

#[test]
fn blocks_unsupported_steps_before_running() {
    let flow = mk(json!([{ "id": "w", "type": "window", "op": "close", "match": { "title": "x" } }]));
    let r = run(flow);
    assert_eq!(r.result.status, RunStatus::Failed);
    let err = r.result.error.unwrap();
    assert_eq!(err.category, ErrorCategory::Unsupported);
    assert_eq!(err.message, "1 step(s) are not supported on web: window");
    assert!(r.mock.lock().effects.is_empty());

    let flow = mk(json!([{ "id": "g", "type": "androidGlobal", "action": "back" }, click("c")]));
    let r = run_with(flow, MockBackend::new(Platform::Windows), RunOptions::default());
    assert_eq!(r.result.error.unwrap().message, "1 step(s) are not supported on windows: androidGlobal");
    assert_eq!(r.mock.count("click"), 0);
}

#[test]
fn requires_approval_for_risky_steps() {
    let flow = mk(json!([{ "id": "h", "type": "http", "method": "POST", "url": "https://example.com/api", "headers": {} }]));
    let r = run(flow.clone());
    assert_eq!(r.result.error.unwrap().category, ErrorCategory::User);
    let r = run_with(flow, MockBackend::new(Platform::Web), approve_risk());
    assert_eq!(r.result.status, RunStatus::Completed);
}

#[test]
fn asks_before_running_when_the_screen_changed() {
    let steps = json!([{ "id": "c", "type": "click", "target": { "kind": "point", "x": 1, "y": 1, "space": "screen" }, "button": "left", "clicks": 1, "holdMs": 0, "modifiers": [] }]);
    let flow = mk_with(steps, json!({ "screen": { "width": 1920, "height": 1080, "scale": 1 } }));
    let r = run(flow.clone());
    let err = r.result.error.unwrap();
    assert_eq!(err.category, ErrorCategory::Environment);
    assert_eq!(err.message, "screen changed from 1920x1080@1 to 1280x800@1");
    let opts = RunOptions { confirm_screen_change: Some(Box::new(|_, _| true)), ..RunOptions::default() };
    assert_eq!(run_with(flow, MockBackend::new(Platform::Web), opts).result.status, RunStatus::Completed);
}

#[test]
fn stops_via_declined_confirm_and_stop_step() {
    let flow =
        mk(json!([{ "id": "q", "type": "confirm", "message": "ok?" }, { "id": "x", "type": "setVar", "name": "after", "value": "1" }]));
    let r = run_with(flow, MockBackend::new(Platform::Web).with_confirm(|_| false), RunOptions::default());
    assert_eq!(r.result.status, RunStatus::Stopped);
    assert_eq!(r.result.reason.as_deref(), Some("declined"));
    assert!(!r.result.vars.contains_key("after"));

    let r = run(mk(json!([{ "id": "s", "type": "stop", "reason": "done" }])));
    assert_eq!(r.result.status, RunStatus::Stopped);
    assert_eq!(r.result.reason.as_deref(), Some("done"));
}

#[test]
fn debug_breakpoints_pause_the_run() {
    let flow = mk(json!([
        { "id": "a", "type": "setVar", "name": "x", "value": "1" },
        { "id": "b", "type": "setVar", "name": "x", "value": "2", "breakpoint": true }
    ]));
    let (handle, join) = FlowRun::new(
        flow,
        Box::new(MockBackend::new(Platform::Web)),
        RunOptions { skip_countdown: true, debug: true, ..RunOptions::default() },
    )
    .spawn()
    .expect("thread");
    let deadline = Instant::now() + Duration::from_secs(2);
    while handle.state() != RunState::Paused && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(handle.state(), RunState::Paused);
    handle.resume();
    assert_eq!(join.join().expect("run thread").vars["x"], Value::Num(2.0));
}

#[test]
fn breakpoints_are_ignored_without_debug() {
    let flow = mk(json!([{ "id": "b", "type": "setVar", "name": "x", "value": "2", "breakpoint": true }]));
    assert_eq!(run(flow).result.status, RunStatus::Completed);
}

#[test]
fn runs_nested_flows_and_goto_error_recovery() {
    let child = mk_with(json!([{ "id": "cc", "type": "setVar", "name": "fromChild", "value": "'yes'" }]), json!({ "id": "child" }));
    let flow = mk_with(
        json!([
            { "id": "start", "type": "setVar", "name": "tries", "value": "tries + 1" },
            { "id": "call", "type": "runFlow", "flowId": "child" },
            { "id": "fail", "type": "setVar", "name": "z", "value": "tries < 3 ? 1/0 : 1", "onError": { "strategy": "goto", "gotoStepId": "start", "retries": 0, "backoffMs": 0 } }
        ]),
        json!({ "variables": [{ "name": "tries", "type": "number", "initial": 0 }] }),
    );
    let opts = RunOptions { resolve_flow: Some(Arc::new(move |id: &str| (id == "child").then(|| child.clone()))), ..RunOptions::default() };
    let r = run_with(flow, MockBackend::new(Platform::Web), opts);
    assert_eq!(r.result.status, RunStatus::Completed);
    assert_eq!(r.result.vars["tries"], Value::Num(3.0));
    assert_eq!(r.result.vars["fromChild"], Value::Str("yes".into()));
}

#[test]
fn run_flow_reports_missing_and_recursive_flows() {
    let flow = mk(json!([{ "id": "call", "type": "runFlow", "flowId": "nope" }]));
    let r = run(flow);
    let err = r.result.error.unwrap();
    assert_eq!(err.message, "flow \"nope\" not found");
    assert_eq!(err.category, ErrorCategory::Validation);

    let me = mk_with(json!([{ "id": "self", "type": "runFlow", "flowId": "f_test" }]), json!({}));
    let resolver = me.clone();
    let opts = RunOptions { resolve_flow: Some(Arc::new(move |_| Some(resolver.clone()))), ..RunOptions::default() };
    let r = run_with(me, MockBackend::new(Platform::Web), opts);
    let err = r.result.error.unwrap();
    assert_eq!(err.category, ErrorCategory::Limit);
    assert_eq!(err.message, "runFlow nesting too deep");
}

#[test]
fn for_each_wait_for_and_interpolation() {
    let flow = mk_with(
        json!([
            { "id": "each", "type": "forEach", "list": "split(csv, ',')", "itemVar": "it", "body": [
                { "id": "t", "type": "type", "text": "<{{ upper(it) }}>", "perCharDelayMs": 0 },
                { "id": "c", "type": "if", "condition": { "expr": "it == 'b'" }, "then": [{ "id": "k", "type": "continue" }], "else": [] },
                { "id": "log", "type": "log", "message": "item {{it}}", "level": "info" }
            ]},
            { "id": "wf", "type": "waitFor", "condition": { "expr": "false" }, "pollMs": 250, "timeoutMs": 1000, "onError": { "strategy": "continue", "retries": 0, "backoffMs": 0 } },
            { "id": "pw", "type": "type", "text": "pw={{secret:main}}", "perCharDelayMs": 0 }
        ]),
        json!({ "variables": [{ "name": "csv", "type": "string", "initial": "a,b,c" }] }),
    );
    let opts = RunOptions { secret: Some(Arc::new(|n: &str| (n == "main").then(|| "s3cret".to_owned()))), ..RunOptions::default() };
    let r = run_with(flow, MockBackend::new(Platform::Windows), opts);
    assert_eq!(r.result.status, RunStatus::Completed, "{:?}", r.result.error);
    assert_eq!(r.mock.lock().typed, vec!["<A>", "<B>", "<C>", "pw=s3cret"]);
    let logs: Vec<String> = r
        .events
        .iter()
        .filter_map(|e| match e {
            RunEvent::Log { message, .. } => Some(message.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(logs, vec!["item a", "item c", "step failed and was skipped: condition not met within 1000 ms"]);
    // Secrets never appear in events.
    assert!(!serde_json::to_string(&r.events).unwrap().contains("s3cret"));
}

#[test]
fn missing_secret_fails_with_expression_error() {
    let r = run(mk(json!([{ "id": "pw", "type": "type", "text": "{{secret:none}}", "perCharDelayMs": 0 }])));
    let err = r.result.error.unwrap();
    assert_eq!(err.category, ErrorCategory::Expression);
    assert_eq!(err.message, "secret \"none\" is not available on this device");
    assert_eq!(err.step_id.as_deref(), Some("pw"));
    assert_eq!(err.path.as_deref(), Some("0"));
}

#[test]
fn countdown_emits_events_then_runs() {
    let flow = mk(json!([click("c")]));
    let clock = Arc::new(autoflow_engine::VirtualClock::new(0));
    let events = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let opts = RunOptions {
        clock: Some(clock),
        on_event: Some(Arc::new(move |e: &RunEvent| sink.lock().unwrap().push(e.clone()))),
        ..RunOptions::default()
    };
    let r = FlowRun::new(flow, Box::new(MockBackend::new(Platform::Windows)), opts).start();
    assert_eq!(r.status, RunStatus::Completed);
    assert_eq!(r.started_at, 3000);
    let events = events.lock().unwrap();
    let countdown: Vec<u64> = events
        .iter()
        .filter_map(|e| match e {
            RunEvent::Countdown { remaining_ms, .. } => Some(*remaining_ms),
            _ => None,
        })
        .collect();
    assert_eq!(countdown, vec![3000, 2000, 1000]);
    let states: Vec<RunState> = events
        .iter()
        .filter_map(|e| match e {
            RunEvent::State { state, .. } => Some(*state),
            _ => None,
        })
        .collect();
    assert_eq!(states, vec![RunState::Preflight, RunState::Countdown, RunState::Running, RunState::Completed]);
}

#[test]
fn events_and_results_serialize_like_typescript() {
    let flow = mk(json!([{ "id": "v", "type": "setVar", "name": "n", "value": "1 + 1" }]));
    let r = run(flow);
    let v = serde_json::to_value(&r.events).unwrap();
    assert_eq!(v[0], json!({ "type": "state", "state": "preflight", "at": 1_000_000 }));
    assert_eq!(v[2], json!({ "type": "stepStart", "stepId": "v", "stepType": "setVar", "path": "0", "at": 1_000_000 }));
    assert_eq!(v[3], json!({ "type": "var", "name": "n", "value": 2, "at": 1_000_000 }));
    assert_eq!(v[4], json!({ "type": "stepEnd", "stepId": "v", "ok": true, "durationMs": 0, "at": 1_000_000 }));
    let res = serde_json::to_value(&r.result).unwrap();
    assert_eq!(
        res,
        json!({ "status": "completed", "actions": 0, "iterations": 0, "durationMs": 0, "vars": { "n": 2 }, "startedAt": 1_000_000, "endedAt": 1_000_000 })
    );

    let failed = run(mk(json!([{ "id": "x", "type": "setVar", "name": "n", "value": "1/0" }])));
    let res = serde_json::to_value(&failed.result).unwrap();
    assert_eq!(res["error"], json!({ "stepId": "x", "path": "0", "message": "division by zero", "category": "expression" }));
    assert_eq!(res["reason"], json!("division by zero"));
    let last_error = failed.events.iter().rev().find(|e| matches!(e, RunEvent::Error { .. })).unwrap();
    assert_eq!(serde_json::to_value(last_error).unwrap()["type"], json!("error"));
}

#[test]
fn disabled_steps_are_skipped_and_not_preflighted() {
    let flow = mk(json!([
        { "id": "w", "type": "window", "op": "close", "match": { "title": "x" }, "disabled": true },
        { "id": "s", "type": "setVar", "name": "ok", "value": "true" }
    ]));
    let r = run(flow);
    assert_eq!(r.result.status, RunStatus::Completed);
    assert_eq!(r.result.vars["ok"], Value::Bool(true));
}

#[test]
fn limit_errors_are_not_caught_by_try() {
    let mut flow = mk(json!([{ "id": "t", "type": "try", "body": [
        { "id": "l", "type": "loop", "mode": "forever", "body": [click("c")] }
    ], "catch": [{ "id": "never", "type": "setVar", "name": "caught", "value": "true" }] }]));
    flow.limits.max_actions = 5;
    let r = run(flow);
    assert_eq!(r.result.status, RunStatus::Failed);
    assert_eq!(r.result.error.unwrap().category, ErrorCategory::Limit);
    assert!(!r.result.vars.contains_key("caught"));
}

#[test]
fn key_repeat_counts_every_press() {
    let flow = mk(json!([{ "id": "k", "type": "key", "key": "Tab", "modifiers": ["shift"], "action": "press", "repeat": 4 }]));
    let r = run(flow);
    assert_eq!(r.result.actions, 4);
    assert_eq!(r.mock.count("key"), 4);
}

#[test]
fn variable_initialisation_follows_types_and_inputs() {
    let flow = mk_with(
        json!([]),
        json!({ "variables": [
            { "name": "a", "type": "number", "initial": "42" },
            { "name": "b", "type": "boolean", "initial": "true" },
            { "name": "c", "type": "list" },
            { "name": "d", "type": "string", "prompt": "Name?" }
        ] }),
    );
    let mut inputs = indexmap::IndexMap::new();
    inputs.insert("d".to_owned(), Value::Str("Kim".into()));
    let r = run_with(flow, MockBackend::new(Platform::Web), RunOptions { inputs, ..RunOptions::default() });
    let v = &r.result.vars;
    assert_eq!(v["a"], Value::Num(42.0));
    assert_eq!(v["b"], Value::Bool(true));
    assert_eq!(v["c"], Value::List(vec![]));
    assert_eq!(v["d"], Value::Str("Kim".into()));
}
