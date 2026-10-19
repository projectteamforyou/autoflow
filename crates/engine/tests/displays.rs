//! Multi-monitor behaviour beyond the shared conformance cases: Stage takeover pause, the "ask"
//! callback, validation and lossless round-trips of the new optional fields.
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use autoflow_engine::display::DisplayInfo;
use autoflow_engine::engine::{ErrorCategory, InputAction, RunEvent, RunOptions, RunState, VirtualClock};
use autoflow_engine::schema::{normalize_numbers, Rect};
use autoflow_engine::{parse_flow, FlowRun, MockBackend, Platform, RunStatus};
use common::{approve_risk, mk_with, run_with};
use serde_json::json;
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn desk() -> Vec<DisplayInfo> {
    vec![
        DisplayInfo::new("MAIN", true, Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1080.0 }, 1.0),
        DisplayInfo::new("SIDE", false, Rect { x: 1920.0, y: 0.0, w: 1280.0, h: 1024.0 }, 1.0),
    ]
}

#[test]
fn stage_run_pauses_when_the_user_takes_over_the_pointer() {
    let flow = mk_with(
        json!([
            { "id": "a", "type": "click", "target": { "kind": "point", "x": 0.5, "y": 0.5, "space": "normalized" } },
            { "id": "n", "type": "notify", "title": "x" },
            { "id": "b", "type": "click", "target": { "kind": "point", "x": 0.6, "y": 0.5, "space": "normalized" } }
        ]),
        json!({ "stage": { "display": "secondary" } }),
    );
    let mock = MockBackend::new(Platform::Windows).with_displays(desk());
    let handle = mock.handle();
    let grab = handle.clone();
    // The user grabs the mouse on the deck while the notification shows.
    let mock = mock.with_hook(move |a: &InputAction| {
        if matches!(a, InputAction::Notify { .. }) {
            grab.lock().pointer = (100, 100);
        }
        None
    });
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&events);
    let opts = RunOptions {
        clock: Some(Arc::new(VirtualClock::new(0))),
        skip_countdown: true,
        on_event: Some(Arc::new(move |e: &RunEvent| sink.lock().unwrap().push(e.clone()))),
        ..approve_risk()
    };
    let (run, join) = FlowRun::new(flow, Box::new(mock), opts).spawn().expect("thread");
    let mut paused = false;
    for _ in 0..200 {
        if run.state() == RunState::Paused {
            paused = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    assert!(paused, "the run did not pause on takeover");
    assert_eq!(handle.count("click"), 1);
    run.resume();
    let result = join.join().expect("run thread");
    assert_eq!(result.status, RunStatus::Completed);
    assert_eq!(handle.count("click"), 2);
    let logs: Vec<String> = events
        .lock()
        .unwrap()
        .iter()
        .filter_map(|e| match e {
            RunEvent::Log { message, .. } => Some(message.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(logs, vec!["takeover: pointer left the stage display, run paused".to_owned()]);
}

#[test]
fn ask_callback_decides_and_is_asked_once() {
    let flow = mk_with(
        json!([{ "id": "l", "type": "loop", "mode": "count", "count": 3, "body": [
            { "id": "c", "type": "click", "target": { "kind": "point", "x": 0.5, "y": 0.5, "space": "normalized", "display": { "index": 4 } } }
        ] }]),
        json!({ "onMissingDisplay": "ask" }),
    );
    let asked = Arc::new(Mutex::new(Vec::new()));
    let seen = Arc::clone(&asked);
    let opts = RunOptions {
        confirm_missing_display: Some(Box::new(move |label: &str| {
            seen.lock().unwrap().push(label.to_owned());
            true
        })),
        ..approve_risk()
    };
    let ran = run_with(flow.clone(), MockBackend::new(Platform::Windows).with_displays(desk()), opts);
    assert_eq!(ran.result.status, RunStatus::Completed);
    assert_eq!(*asked.lock().unwrap(), vec!["index 4".to_owned()]);
    assert_eq!(ran.mock.lock().effects.iter().filter(|e| e.points == vec![(960, 540)]).count(), 3);

    let declined = RunOptions { confirm_missing_display: Some(Box::new(|_: &str| false)), ..approve_risk() };
    let ran = run_with(flow, MockBackend::new(Platform::Windows).with_displays(desk()), declined);
    assert_eq!(ran.result.error.as_ref().map(|e| e.category), Some(ErrorCategory::Display));
    assert!(ran.mock.lock().effects.is_empty());
}

#[test]
fn new_fields_validate_and_round_trip() {
    let doc = json!({
        "schemaVersion": "1.0", "id": "f", "name": "t",
        "createdAt": "2026-10-19T00:00:00.000Z", "updatedAt": "2026-10-19T00:00:00.000Z",
        "stage": { "display": "SIDE", "pauseOnTakeover": false, "takeoverPx": 40 },
        "onMissingDisplay": "primary",
        "scenes": [{ "name": "lobby", "display": { "index": 1 }, "region": { "x": 0, "y": 0.1, "w": 1, "h": 0.9 }, "hash": "ffffffffffcfffff", "thumb": "data:image/png;base64,iVBORw0KGgo=" }],
        "steps": [
            { "id": "w", "type": "waitFor", "condition": { "expr": "true", "scene": { "name": "lobby", "minSimilarity": 0.85, "not": true } }, "pollMs": 250, "timeoutMs": 1000 },
            { "id": "p", "type": "waitForPixel", "at": { "kind": "point", "x": 5, "y": 5, "space": "display", "display": "SIDE" }, "color": "#00FF00", "tolerance": 10, "not": true, "pollMs": 100 },
            { "id": "c", "type": "pixelCheck", "at": { "kind": "point", "x": 0.5, "y": 0.5, "space": "normalized" }, "tolerance": 24, "resultVar": "col" },
            { "id": "m", "type": "matchScene", "scenes": ["lobby"], "minSimilarity": 0.9, "resultVar": "s", "similarityVar": "sim" },
            { "id": "l", "type": "loop", "mode": "forever", "cooldownMs": 1000, "body": [
                { "id": "i", "type": "if", "condition": { "expr": "true", "pixel": { "at": { "kind": "point", "x": 1, "y": 2, "space": "screen" }, "color": "#123456", "tolerance": 0 } }, "then": [], "else": [] }
            ] },
            { "id": "o", "type": "ocr", "region": { "x": 0, "y": 0, "w": 10, "h": 10 }, "resultVar": "t", "display": "secondary" },
            { "id": "f", "type": "findImage", "target": { "kind": "image", "ref": "x", "confidence": 0.9, "display": { "index": 0 } }, "resultVar": "r", "timeoutMs": 5000 }
        ]
    });
    let flow = parse_flow(&doc).expect("valid");
    let mut back = serde_json::to_value(&flow).unwrap();
    for k in
        ["description", "tags", "icon", "color", "targets", "mode", "trigger", "hotkeys", "limits", "variables", "favorite", "revision"]
    {
        back.as_object_mut().unwrap().remove(k);
    }
    let (mut want, mut got) = (doc.clone(), back);
    normalize_numbers(&mut want);
    normalize_numbers(&mut got);
    assert_eq!(got, want);

    let bad = |patch: serde_json::Value| {
        let mut d = doc.clone();
        for (k, v) in patch.as_object().unwrap() {
            d[k] = v.clone();
        }
        parse_flow(&d).is_err()
    };
    assert!(bad(json!({ "scenes": [{ "name": "a", "region": { "x": 0.5, "y": 0, "w": 0.6, "h": 1 }, "hash": "ffffffffffcfffff" }] })));
    assert!(bad(json!({ "scenes": [{ "name": "a", "region": { "x": 0, "y": 0, "w": 1, "h": 1 }, "hash": "nothex" }] })));
    let big = format!("data:image/png;base64,{}", "A".repeat(30_000));
    assert!(bad(
        json!({ "scenes": [{ "name": "a", "region": { "x": 0, "y": 0, "w": 1, "h": 1 }, "hash": "ffffffffffcfffff", "thumb": big }] })
    ));
    let dup = json!({ "name": "a", "region": { "x": 0, "y": 0, "w": 1, "h": 1 }, "hash": "ffffffffffcfffff" });
    assert!(bad(json!({ "scenes": [dup.clone(), dup] })));
    assert!(bad(json!({ "stage": { "display": { "index": 40 } } })));
    assert!(bad(json!({ "steps": [{ "id": "p", "type": "pixelCheck", "at": { "kind": "current" }, "resultVar": "x" }] })));
    assert!(bad(json!({ "steps": [{ "id": "p", "type": "waitForPixel", "at": { "kind": "point", "x": 1, "y": 1 }, "color": "red" }] })));
}

#[test]
fn screen_probes_are_blocked_on_android_and_scored() {
    let flow = mk_with(
        json!([{ "id": "i", "type": "if", "condition": { "pixel": { "at": { "kind": "point", "x": 1, "y": 1 }, "color": "#ffffff" } }, "then": [], "else": [] }]),
        json!({ "stage": { "display": "secondary", "pauseOnTakeover": false } }),
    );
    let pf = autoflow_engine::preflight(&flow, Platform::Android);
    assert_eq!(pf.blocked.len(), 1);
    assert_eq!(pf.blocked[0].note_key.as_deref(), Some("cap.screenProbe.android"));
    let keys: Vec<&str> = pf.risk.findings.iter().map(|f| f.key.as_str()).collect();
    assert!(keys.contains(&"risk.stageNoTakeover") && keys.contains(&"risk.screenRead"), "{keys:?}");
    assert!(pf.risk.permissions.contains(&"perm.screen".to_owned()));
    assert!(autoflow_engine::preflight(&flow, Platform::Windows).blocked.is_empty());
}
