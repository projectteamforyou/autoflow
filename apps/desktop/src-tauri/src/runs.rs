//! Starting and controlling native runs.
//!
//! Runs execute on their own threads in the Rust engine, so they keep going while the window is
//! hidden. Every engine event is forwarded as `BridgeEvent::Run`, and the final result as
//! `BridgeEvent::RunEnded`.

use crate::platform;
use crate::state::{emit, lock, AppState, Hooks, RunEntry};
use autoflow_engine::bridge::BridgeEvent;
use autoflow_engine::risk::RiskReport;
use autoflow_engine::schema::{Flow, Platform};
use autoflow_engine::{FlowRun, InputBackend, MockBackend, RunControl, RunEvent, RunHandle, RunOptions, Value};
use indexmap::IndexMap;
use std::collections::HashMap;
use std::sync::{Arc, OnceLock};
use std::time::Instant;
use tauri::{AppHandle, Manager};

/// Who started a run, which decides how approvals work.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// The web app, which already showed the pre-run sheet.
    Ui {
        /// Risky steps approved.
        approved_risk: bool,
        /// Screen change approved.
        approved_screen: bool,
    },
    /// A person pressed a hotkey or a Keyforge mapping: approvals use a native dialog.
    Attended,
    /// Schedules and app/device events: nobody to ask, so nothing risky is approved.
    Unattended,
}

fn permission_text(key: &str) -> &str {
    match key {
        "perm.input" => "control the mouse and keyboard",
        "perm.clipboard" => "read or change the clipboard",
        "perm.apps" => "open apps",
        "perm.browser" => "open web pages",
        "perm.windows" => "move or close windows",
        "perm.network" => "send data over the internet",
        "perm.files" => "read or change files",
        "perm.screen" => "read the screen",
        "perm.notifications" => "show notifications",
        other => other,
    }
}

fn risk_question(name: &str, report: &RiskReport) -> String {
    let perms: Vec<&str> = report.permissions.iter().map(|p| permission_text(p)).collect();
    format!(
        "\u{201c}{name}\u{201d} includes steps that need your approval (risk score {}/100).\n\nIt can: {}.\n\nRun it now?",
        report.score,
        perms.join(", ")
    )
}

/// Starts a run. Trigger-initiated runs honour `preventOverlap` and `cooldownMs`.
pub fn start(app: &AppHandle, flow: Flow, inputs: IndexMap<String, Value>, origin: Origin, dry_run: bool) -> Result<String, String> {
    let state = app.state::<AppState>();
    if !matches!(origin, Origin::Ui { .. }) {
        if flow.limits.prevent_overlap && lock(&state.runs).values().any(|r| r.flow_id == flow.id) {
            return Err(format!("\u{201c}{}\u{201d} is already running", flow.name));
        }
        let mut last = lock(&state.last_trigger);
        if let Some(t) = last.get(&flow.id) {
            if t.elapsed().as_millis() < u128::from(flow.limits.cooldown_ms) {
                return Err(format!("\u{201c}{}\u{201d} is cooling down", flow.name));
            }
        }
        last.insert(flow.id.clone(), Instant::now());
    }
    lock(&state.library).insert(flow.id.clone(), flow.clone());
    let library: HashMap<String, Flow> = lock(&state.library).clone();

    let run_id: Arc<OnceLock<String>> = Arc::new(OnceLock::new());
    // The run's own control, so Halt / Stop also dismisses an approval dialog that is still open.
    let run_handle: Arc<OnceLock<RunHandle>> = Arc::new(OnceLock::new());
    let (sink_id, sink_app) = (Arc::clone(&run_id), app.clone());
    let name = flow.name.clone();
    let (confirm_risk, confirm_screen): (autoflow_engine::engine::RiskApproval, autoflow_engine::engine::ScreenApproval) = match origin {
        Origin::Ui { approved_risk, approved_screen } => (Box::new(move |_| approved_risk), Box::new(move |_, _| approved_screen)),
        Origin::Attended => {
            let n2 = name.clone();
            let (h1, h2) = (Arc::clone(&run_handle), Arc::clone(&run_handle));
            let ask = |q: &str, h: &OnceLock<RunHandle>| match h.get() {
                Some(h) => platform::ask(q, h.control()),
                None => platform::ask(q, &RunControl::new()),
            };
            (
                Box::new(move |r| ask(&risk_question(&name, r), &h1)),
                Box::new(move |rec, live| {
                    let q = format!(
                        "\u{201c}{n2}\u{201d} was recorded on a {}×{} screen but this screen is {}×{}. Clicks may land in the wrong place.\n\nRun anyway?",
                        rec.width, rec.height, live.width, live.height
                    );
                    ask(&q, &h2)
                }),
            )
        }
        Origin::Unattended => (Box::new(|_| false), Box::new(|_, _| false)),
    };
    let opts = RunOptions {
        on_event: Some(Arc::new(move |e: &RunEvent| {
            if let Some(id) = sink_id.get() {
                emit(&sink_app, &BridgeEvent::Run { run_id: id.clone(), event: e.clone() });
            }
        })),
        inputs,
        secret: Some(Arc::new(platform::secret_get)),
        resolve_flow: Some(Arc::new(move |id: &str| library.get(id).cloned())),
        confirm_risk: Some(confirm_risk),
        confirm_screen_change: Some(confirm_screen),
        // onMissingDisplay "ask": the backend's topmost dialog asks people; with nobody there the answer is no.
        confirm_missing_display: if origin == Origin::Unattended { Some(Box::new(|_: &str| false)) } else { None },
        ..RunOptions::default()
    };
    let backend: Box<dyn InputBackend> = if dry_run {
        let mock = MockBackend::new(Platform::Windows).with_screen(platform::screen_info());
        let displays = platform::displays();
        Box::new(if displays.is_empty() { mock } else { mock.with_displays(displays) })
    } else {
        platform::real_backend(Arc::new(Hooks { app: app.clone() }))?
    };
    let flow_id = flow.id.clone();
    let run = FlowRun::new(flow, backend, opts);
    let id = run.id().to_owned();
    let _set = run_id.set(id.clone());
    let _set_handle = run_handle.set(run.handle());
    lock(&state.runs).insert(id.clone(), RunEntry { handle: run.handle(), flow_id });
    let (app2, id2) = (app.clone(), id.clone());
    let spawned = std::thread::Builder::new().name(format!("autoflow-{id}")).stack_size(8 * 1024 * 1024).spawn(move || {
        let result = run.start();
        lock(&app2.state::<AppState>().runs).remove(&id2);
        emit(&app2, &BridgeEvent::RunEnded { run_id: id2, result });
    });
    if let Err(e) = spawned {
        lock(&state.runs).remove(&id);
        return Err(format!("cannot start the run: {e}"));
    }
    Ok(id)
}

/// Starts a flow from the library by id (hotkeys, schedules, Keyforge). Failures are dropped:
/// overlap/cooldown skips are expected and other errors surface as run events.
pub fn start_known(app: &AppHandle, flow_id: &str, origin: Origin) -> Option<String> {
    let flow = lock(&app.state::<AppState>().library).get(flow_id).cloned()?;
    start(app, flow, IndexMap::new(), origin, false).ok()
}

/// Stops every run and every Keyforge auto-repeat (Halt).
pub fn halt_all(app: &AppHandle, reason: &str) {
    let state = app.state::<AppState>();
    for r in lock(&state.runs).values() {
        r.handle.stop(reason);
    }
    if let Some(kf) = lock(&state.keyforge).as_ref() {
        kf.stop_repeats();
    };
}

/// Stops the runs of one flow.
pub fn stop_flow(app: &AppHandle, flow_id: &str) {
    for r in lock(&app.state::<AppState>().runs).values().filter(|r| r.flow_id == flow_id) {
        r.handle.stop("hotkey");
    }
}

/// Pauses running / resumes paused runs of one flow.
pub fn toggle_pause_flow(app: &AppHandle, flow_id: &str) {
    for r in lock(&app.state::<AppState>().runs).values().filter(|r| r.flow_id == flow_id) {
        if r.handle.state() == autoflow_engine::RunState::Paused {
            r.handle.resume();
        } else {
            r.handle.pause();
        }
    }
}

/// Looks up a run handle.
pub fn handle(app: &AppHandle, run_id: &str) -> Result<autoflow_engine::RunHandle, String> {
    lock(&app.state::<AppState>().runs).get(run_id).map(|r| r.handle.clone()).ok_or_else(|| format!("run \"{run_id}\" is not active"))
}
