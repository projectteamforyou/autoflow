//! Starting and controlling native runs.
//!
//! Runs execute on their own threads in the Rust engine, so they keep going while the window is
//! hidden. Every engine event is forwarded as `BridgeEvent::Run`, and the final result as
//! `BridgeEvent::RunEnded`.
//!
//! Runs started by a trigger (hotkey, Keyforge, schedule, app/device event) have nobody watching
//! the app, so a failure — or a start that did not happen — is also shown as a notification.
//! Risky steps approved once in the app are remembered ([`crate::approvals`]) so such runs can
//! start at all.

use crate::approvals;
use crate::platform;
use crate::state::{emit, lock, notify_flow_problem, AppState, Hooks, RunEntry};
use autoflow_engine::bridge::BridgeEvent;
use autoflow_engine::risk::RiskReport;
use autoflow_engine::schema::{Flow, Platform};
use autoflow_engine::{
    ErrorCategory, FlowRun, InputBackend, MockBackend, RunControl, RunError, RunEvent, RunHandle, RunOptions, RunResult, RunStatus, Value,
};
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
        /// A temporary variant of a saved flow ("run from here", "run only this step"): it must
        /// not replace the copy triggers start, nor the approval stored for the full flow.
        transient: bool,
    },
    /// A person pressed a hotkey or a Keyforge mapping: approvals use a native dialog, unless
    /// exactly these steps were already approved in the app.
    Attended,
    /// Schedules and app/device events: nobody to ask, so risky steps only pass when exactly
    /// these steps were approved in the app before.
    Unattended,
}

/// Why a run did not start.
enum StartError {
    /// `preventOverlap` / `cooldownMs` skipped a trigger-initiated start (expected, not a fault).
    Skipped(String),
    /// The run could not be started.
    Failed(String),
}

/// Stores the approval of a flow's risky steps (memory and `approved.json`).
fn remember_approval(app: &AppHandle, flow_id: &str, steps_hash: &str) {
    let state = app.state::<AppState>();
    let mut approved = lock(&state.approved);
    if approvals::remember(&mut approved, flow_id, steps_hash) {
        if let Err(e) = approvals::save(&state.approved_path, &approved) {
            eprintln!("autoflow: cannot save the approval: {e}");
        }
    }
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
    try_start(app, flow, inputs, origin, dry_run).map_err(|e| match e {
        StartError::Skipped(reason) | StartError::Failed(reason) => reason,
    })
}

#[allow(clippy::too_many_lines)]
fn try_start(app: &AppHandle, flow: Flow, inputs: IndexMap<String, Value>, origin: Origin, dry_run: bool) -> Result<String, StartError> {
    let state = app.state::<AppState>();
    if !matches!(origin, Origin::Ui { .. }) {
        if flow.limits.prevent_overlap && lock(&state.runs).values().any(|r| r.flow_id == flow.id) {
            return Err(StartError::Skipped(format!("\u{201c}{}\u{201d} is already running", flow.name)));
        }
        let mut last = lock(&state.last_trigger);
        if let Some(t) = last.get(&flow.id) {
            if t.elapsed().as_millis() < u128::from(flow.limits.cooldown_ms) {
                return Err(StartError::Skipped(format!("\u{201c}{}\u{201d} is cooling down", flow.name)));
            }
        }
        last.insert(flow.id.clone(), Instant::now());
    }
    let transient = matches!(origin, Origin::Ui { transient: true, .. });
    let library: HashMap<String, Flow> = {
        let mut known = lock(&state.library);
        if transient {
            // Visible to this run only (a flow may call itself through runFlow).
            let mut local = known.clone();
            local.insert(flow.id.clone(), flow.clone());
            local
        } else {
            known.insert(flow.id.clone(), flow.clone());
            known.clone()
        }
    };

    let run_id: Arc<OnceLock<String>> = Arc::new(OnceLock::new());
    // The run's own control, so Halt / Stop also dismisses an approval dialog that is still open.
    let run_handle: Arc<OnceLock<RunHandle>> = Arc::new(OnceLock::new());
    let (sink_id, sink_app) = (Arc::clone(&run_id), app.clone());
    let name = flow.name.clone();
    // The approval covers exactly these steps: any edit changes the hash and asks again.
    let steps_hash = approvals::steps_hash(&flow);
    let remembered = steps_hash.as_deref().is_some_and(|h| approvals::is_approved(&lock(&state.approved), &flow.id, h));
    let (confirm_risk, confirm_screen): (autoflow_engine::engine::RiskApproval, autoflow_engine::engine::ScreenApproval) = match origin {
        Origin::Ui { approved_risk, approved_screen, transient } => {
            let (approval_app, approval_flow) = (app.clone(), flow.id.clone());
            (
                Box::new(move |_| {
                    // The engine only asks when the flow has steps that need approval. A real run
                    // approved in the pre-run sheet is remembered for trigger-started runs; a dry
                    // run performs nothing, so its approval does not count.
                    if approved_risk && !dry_run && !transient {
                        if let Some(hash) = &steps_hash {
                            remember_approval(&approval_app, &approval_flow, hash);
                        }
                    }
                    approved_risk
                }),
                Box::new(move |_, _| approved_screen),
            )
        }
        Origin::Attended => {
            let n2 = name.clone();
            let (h1, h2) = (Arc::clone(&run_handle), Arc::clone(&run_handle));
            let ask = |q: &str, h: &OnceLock<RunHandle>| match h.get() {
                Some(h) => platform::ask(q, h.control()),
                None => platform::ask(q, &RunControl::new()),
            };
            (
                Box::new(move |r| remembered || ask(&risk_question(&name, r), &h1)),
                Box::new(move |rec, live| {
                    let q = format!(
                        "\u{201c}{n2}\u{201d} was recorded on a {}×{} screen but this screen is {}×{}. Clicks may land in the wrong place.\n\nRun anyway?",
                        rec.width, rec.height, live.width, live.height
                    );
                    ask(&q, &h2)
                }),
            )
        }
        Origin::Unattended => (Box::new(move |_| remembered), Box::new(|_, _| false)),
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
        platform::real_backend(Arc::new(Hooks { app: app.clone() })).map_err(StartError::Failed)?
    };
    let (flow_id, flow_name) = (flow.id.clone(), flow.name.clone());
    let run = FlowRun::new(flow, backend, opts);
    let id = run.id().to_owned();
    let _set = run_id.set(id.clone());
    let _set_handle = run_handle.set(run.handle());
    lock(&state.runs).insert(id.clone(), RunEntry { handle: run.handle(), flow_id: flow_id.clone() });
    let (app2, id2) = (app.clone(), id.clone());
    let spawned = std::thread::Builder::new().name(format!("autoflow-{id}")).stack_size(8 * 1024 * 1024).spawn(move || {
        // A panic inside the engine must not leave a zombie entry in the run map: the web app would
        // keep showing the run as active with no RunEnded ever arriving.
        let result = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run.start())) {
            Ok(result) => result,
            Err(payload) => panicked(payload.as_ref()),
        };
        lock(&app2.state::<AppState>().runs).remove(&id2);
        // Nobody may be looking at the app when a trigger started the run: say that it failed.
        // Not for an answer the person at the keyboard just gave ("No" in the approval dialog), and not
        // again for the same failure of the same flow on every firing.
        let declined = origin == Origin::Attended && result.error.as_ref().is_some_and(|e| e.category == ErrorCategory::User);
        if !matches!(origin, Origin::Ui { .. }) && result.status == RunStatus::Failed && !declined {
            let message = result.error.as_ref().map_or_else(|| result.reason.clone().unwrap_or_default(), |e| e.message.clone());
            notify_flow_problem(&app2, &flow_id, &format!("\u{201c}{flow_name}\u{201d} failed"), &message);
        }
        emit(&app2, &BridgeEvent::RunEnded { run_id: id2, result });
    });
    if let Err(e) = spawned {
        lock(&state.runs).remove(&id);
        return Err(StartError::Failed(format!("cannot start the run: {e}")));
    }
    Ok(id)
}

/// The failed result emitted when the engine thread panics (category `internal`).
fn panicked(payload: &(dyn std::any::Any + Send)) -> RunResult {
    let what = payload
        .downcast_ref::<&str>()
        .map(|s| (*s).to_owned())
        .or_else(|| payload.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "unknown panic".to_owned());
    let message = format!("internal error: {what}");
    let now = u64::try_from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis())).unwrap_or(0);
    RunResult {
        status: RunStatus::Failed,
        reason: Some(message.clone()),
        error: Some(RunError { step_id: None, path: None, message, category: ErrorCategory::Internal }),
        actions: 0,
        iterations: 0,
        steps: 0,
        duration_ms: 0,
        vars: IndexMap::new(),
        started_at: now,
        ended_at: now,
    }
}

/// Starts a flow from the library by id (hotkeys, schedules, Keyforge).
///
/// Overlap / cooldown skips are expected and stay silent (a schedule firing while its flow still
/// runs must not raise a notification every time). A run that could not start has no run events
/// to report it, so it is shown as a notification.
pub fn start_known(app: &AppHandle, flow_id: &str, origin: Origin) -> Option<String> {
    let flow = lock(&app.state::<AppState>().library).get(flow_id).cloned()?;
    let name = flow.name.clone();
    match try_start(app, flow, IndexMap::new(), origin, false) {
        Ok(run_id) => Some(run_id),
        Err(StartError::Skipped(_)) => None,
        Err(StartError::Failed(reason)) => {
            notify_flow_problem(app, flow_id, &format!("\u{201c}{name}\u{201d} could not start"), &reason);
            None
        }
    }
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
