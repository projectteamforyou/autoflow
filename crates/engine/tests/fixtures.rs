//! Every shared fixture in `packages/core/fixtures` must parse, round-trip to the same JSON and
//! run in the mock backend (forever loops end with a limit failure).
#![allow(clippy::unwrap_used, clippy::expect_used)]

mod common;

use autoflow_engine::schema::normalize_numbers;
use autoflow_engine::{parse_flow, ErrorCategory, MockBackend, Platform, RunStatus};
use common::{approve_risk, fixtures_dir, run_with};
use serde_json::Value as Json;

fn load(name: &str) -> Json {
    let path = fixtures_dir().join(name);
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{name} is not JSON: {e}"))
}

struct Entry {
    id: String,
    platforms: Vec<Platform>,
}

fn index() -> Vec<Entry> {
    let idx = load("index.json");
    idx.as_array()
        .expect("index is an array")
        .iter()
        .map(|e| Entry {
            id: e["id"].as_str().expect("id").to_owned(),
            platforms: serde_json::from_value(e["platforms"].clone()).expect("platforms"),
        })
        .collect()
}

#[test]
fn every_fixture_file_is_indexed_and_parses() {
    let ids: Vec<String> = index().into_iter().map(|e| e.id).collect();
    assert!(ids.len() >= 16, "expected the 16 official templates, got {}", ids.len());
    let mut files = 0;
    for entry in std::fs::read_dir(fixtures_dir()).expect("fixtures dir") {
        let name = entry.expect("dir entry").file_name().to_string_lossy().into_owned();
        if !name.ends_with(".json") || name == "index.json" {
            continue;
        }
        files += 1;
        let id = name.trim_end_matches(".json");
        assert!(ids.iter().any(|i| i == id), "{name} is missing from index.json");
        if let Err(issues) = parse_flow(&load(&name)) {
            panic!("{name} failed to parse: {issues:?}");
        }
    }
    assert_eq!(files, ids.len());
}

#[test]
fn fixtures_round_trip_to_identical_json() {
    for e in index() {
        let mut original = load(&format!("{}.json", e.id));
        let flow = parse_flow(&original).expect("parses");
        let mut back = serde_json::to_value(&flow).expect("serializes");
        normalize_numbers(&mut original);
        normalize_numbers(&mut back);
        assert_eq!(back, original, "{} does not round-trip", e.id);
    }
}

#[test]
fn fixtures_run_in_the_mock_backend() {
    for e in index() {
        let mut flow = parse_flow(&load(&format!("{}.json", e.id))).expect("parses");
        flow.limits.max_duration_ms = flow.limits.max_duration_ms.min(120_000);
        // Same platform choice as the TypeScript test, plus Windows whenever the template targets it.
        let ts_platform = if e.platforms.contains(&Platform::Web) { Platform::Web } else { e.platforms[0] };
        let mut platforms = vec![ts_platform];
        if e.platforms.contains(&Platform::Windows) && ts_platform != Platform::Windows {
            platforms.push(Platform::Windows);
        }
        for platform in platforms {
            let ran = run_with(flow.clone(), MockBackend::new(platform), approve_risk());
            let r = &ran.result;
            match r.status {
                RunStatus::Completed => {}
                RunStatus::Failed => {
                    let err = r.error.as_ref().expect("failed runs carry an error");
                    assert_eq!(err.category, ErrorCategory::Limit, "{} on {platform:?}: {}", e.id, err.message);
                }
                RunStatus::Stopped => panic!("{} on {platform:?} stopped unexpectedly: {:?}", e.id, r.reason),
            }
            assert!(r.duration_ms <= 120_000 + 1_000, "{} ran {} ms of virtual time", e.id, r.duration_ms);
        }
    }
}

#[test]
fn template_specific_outcomes() {
    let run_fixture = |id: &str| {
        let flow = parse_flow(&load(&format!("{id}.json"))).expect("parses");
        run_with(flow, MockBackend::new(Platform::Windows), approve_risk())
    };

    let r = run_fixture("auto-clicker");
    assert_eq!(r.result.status, RunStatus::Completed);
    assert_eq!(r.mock.count("click"), 100);

    let r = run_fixture("form-filler");
    assert_eq!(r.result.status, RunStatus::Completed);
    assert_eq!(r.mock.lock().typed, vec!["Alice", "alice@example.com", "Bob", "bob@example.com"]);
    assert_eq!(r.mock.lock().confirms, vec!["Submit Alice?", "Submit Bob?"]);

    let r = run_fixture("multi-point");
    assert_eq!(r.result.status, RunStatus::Failed);
    assert_eq!(r.result.error.as_ref().map(|e| e.category), Some(ErrorCategory::Limit));

    let r = run_fixture("copy-cleaner");
    assert_eq!(r.result.status, RunStatus::Completed);

    // Android-only template is blocked on Windows before any input happens.
    let flow = parse_flow(&load("android-night-routine.json")).expect("parses");
    let blocked = run_with(flow, MockBackend::new(Platform::Windows), approve_risk());
    if blocked.result.status == RunStatus::Failed {
        assert_eq!(blocked.result.error.as_ref().map(|e| e.category), Some(ErrorCategory::Unsupported));
        assert!(blocked.mock.lock().effects.is_empty());
    }
}
