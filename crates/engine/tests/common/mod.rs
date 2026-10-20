//! Shared helpers for the integration tests.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use autoflow_engine::{parse_flow, Flow, FlowRun, MockBackend, MockHandle, Platform, RunEvent, RunOptions, RunResult, VirtualClock};
use serde_json::{json, Value as Json};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// `packages/core/fixtures`, resolved from this crate's manifest directory.
pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/core/fixtures")
}

/// Builds a flow like `createFlow({ name: "t", steps })` in the TS tests.
pub fn mk(steps: Json) -> Flow {
    mk_with(steps, json!({}))
}

/// Like [`mk`], merging extra top-level fields.
pub fn mk_with(steps: Json, extra: Json) -> Flow {
    let mut doc = json!({
        "schemaVersion": "1.0",
        "id": "f_test",
        "name": "t",
        "steps": steps,
        "createdAt": "2026-10-19T00:00:00.000Z",
        "updatedAt": "2026-10-19T00:00:00.000Z",
    });
    if let (Some(d), Some(e)) = (doc.as_object_mut(), extra.as_object()) {
        for (k, v) in e {
            d.insert(k.clone(), v.clone());
        }
    }
    match parse_flow(&doc) {
        Ok(f) => f,
        Err(issues) => panic!("invalid test flow: {issues:?}"),
    }
}

/// Output of [`run`].
pub struct Ran {
    pub result: RunResult,
    pub events: Vec<RunEvent>,
    pub mock: MockHandle,
}

/// Runs with a virtual clock at 1 000 000, no countdown and `random() = 0`, like the TS tests.
pub fn run_with(flow: Flow, backend: MockBackend, mut opts: RunOptions) -> Ran {
    let clock = Arc::new(VirtualClock::new(1_000_000));
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let mock = backend.handle();
    let backend = backend.with_clock(clock.clone());
    opts.clock = Some(clock);
    opts.skip_countdown = true;
    opts.on_event = Some(Arc::new(move |e: &RunEvent| sink.lock().unwrap().push(e.clone())));
    if opts.random.is_none() {
        opts.random = Some(Arc::new(|| 0.0));
    }
    let result = FlowRun::new(flow, Box::new(backend), opts).start();
    let events = events.lock().unwrap().clone();
    Ran { result, events, mock }
}

/// Runs on the web platform (the TS `SandboxBackend` default).
pub fn run(flow: Flow) -> Ran {
    run_with(flow, MockBackend::new(Platform::Web), RunOptions::default())
}

/// Approves risky steps.
pub fn approve_risk() -> RunOptions {
    RunOptions { confirm_risk: Some(Box::new(|_| true)), ..RunOptions::default() }
}
