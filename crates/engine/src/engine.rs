//! Deterministic flow interpreter — mirrors `packages/core/src/engine.ts`.
//!
//! - Executes a validated [`Flow`] against an [`InputBackend`] (Windows `SendInput`, the mock
//!   backend in tests, a dry-run sandbox…).
//! - Enforces limits (duration, actions, iterations); stop is observed within one sleep slice
//!   (≤ 100 ms); pause/resume and debugger breakpoints; per-step error policies
//!   (stop / continue / retry / goto) and `try`/`catch`.
//! - Pre-run checks: unsupported steps, risky steps needing approval, screen-geometry drift.
//! - Emits [`RunEvent`]s whose JSON is identical to the TypeScript `RunEvent` union.
//! - Engine v2 (opt-in schema fields, same semantics as engine.ts): per-step `stepTimeoutMs`,
//!   retry backoff curves with cap and jitter, `limits.maxSteps` and seeded `humanize`.
//! - Multi-monitor (opt-in): display-relative targets are placed on absolute pixels here
//!   ([`crate::display`]), a missing display follows `onMissingDisplay`, Stage mode pauses when the
//!   user takes over the pointer, scene / pixel probes feed conditions, and loops can keep a
//!   `cooldownMs` rhythm.
//!
//! A run executes synchronously on the calling thread ([`FlowRun::start`]) or on a dedicated
//! thread ([`FlowRun::spawn`]); other threads control it through a cloneable [`RunHandle`]
//! backed by atomic flags and a condition variable.

use crate::capabilities::{compatibility, CompatIssue, Support};
use crate::display::{
    color_distance, display_ref_key, display_ref_label, find_display, hash_similarity, is_hash, on_display, parse_color, place_point,
    place_rect, rect_on_display, sort_displays, to_hex_color, DisplayInfo,
};
use crate::expr::{default_random, interpolate_with, ExprEnv, ExprError, Vars};
use crate::risk::{analyze_risk, RiskReport};
use crate::schema::{
    retry_delay_ms, Condition, DisplayRef, ErrorStrategy, FileOp, Flow, HttpMethod, Humanize, KeyAction, LogLevel, LoopMode, Modifier,
    MouseButton, Mulberry32, OnMissingDisplay, Platform, Rect, Scene, Space, Step, StepKind, Target, VarType, WindowMatch, WindowOp,
};
use crate::value::{js_number_to_string, Value};
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::Duration;

/// Long waits are sliced so pause, stop and limits are observed within this many ms.
pub const SLICE_MS: u64 = 100;

/* ----------------------------------------------------------------- backend */

/// One platform action requested by the interpreter (`InputAction` in engine.ts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[allow(missing_docs)]
pub enum InputAction {
    Click {
        target: Target,
        button: MouseButton,
        clicks: u32,
        hold_ms: u64,
        modifiers: Vec<Modifier>,
    },
    Move {
        target: Target,
        duration_ms: u64,
    },
    Drag {
        from: Target,
        to: Target,
        duration_ms: u64,
        button: MouseButton,
    },
    Scroll {
        dx: i64,
        dy: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target: Option<Target>,
    },
    Key {
        key: String,
        modifiers: Vec<Modifier>,
        action: KeyAction,
    },
    Type {
        text: String,
        per_char_delay_ms: u64,
    },
    LaunchApp {
        app: String,
        args: Vec<String>,
    },
    OpenUrl {
        url: String,
    },
    Window {
        op: WindowOp,
        #[serde(rename = "match")]
        match_: WindowMatch,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        rect: Option<Rect>,
    },
    AndroidGlobal {
        action: crate::schema::AndroidAction,
    },
    ClipboardSet {
        value: String,
    },
    ClipboardGet,
    Notify {
        title: String,
        body: String,
    },
    Http {
        method: HttpMethod,
        url: String,
        headers: IndexMap<String, String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body: Option<String>,
    },
    File {
        op: FileOp,
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dest: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
    },
    Ocr {
        region: Rect,
    },
    FindImage {
        #[serde(rename = "ref")]
        reference: String,
        confidence: f64,
        timeout_ms: u64,
        /// Search area in virtual-desktop px (display-scoped steps only).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        region: Option<Rect>,
    },
    SwitchProfile {
        profile_id: String,
    },
    /// Probe: color of one virtual-desktop pixel as `#rrggbb`.
    Pixel {
        x: f64,
        y: f64,
    },
    /// Probe: dHash (16 hex digits) of a virtual-desktop rectangle.
    SceneHash {
        region: Rect,
    },
}

impl InputAction {
    /// The `type` discriminator.
    pub fn type_name(&self) -> &'static str {
        match self {
            InputAction::Click { .. } => "click",
            InputAction::Move { .. } => "move",
            InputAction::Drag { .. } => "drag",
            InputAction::Scroll { .. } => "scroll",
            InputAction::Key { .. } => "key",
            InputAction::Type { .. } => "type",
            InputAction::LaunchApp { .. } => "launchApp",
            InputAction::OpenUrl { .. } => "openUrl",
            InputAction::Window { .. } => "window",
            InputAction::AndroidGlobal { .. } => "androidGlobal",
            InputAction::ClipboardSet { .. } => "clipboardSet",
            InputAction::ClipboardGet => "clipboardGet",
            InputAction::Notify { .. } => "notify",
            InputAction::Http { .. } => "http",
            InputAction::File { .. } => "file",
            InputAction::Ocr { .. } => "ocr",
            InputAction::FindImage { .. } => "findImage",
            InputAction::SwitchProfile { .. } => "switchProfile",
            InputAction::Pixel { .. } => "pixel",
            InputAction::SceneHash { .. } => "sceneHash",
        }
    }
}

/// Live screen geometry (primary / virtual screen).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ScreenInfo {
    /// Width in physical px.
    pub width: u32,
    /// Height in physical px.
    pub height: u32,
    /// Scale factor (1 = 96 DPI).
    pub scale: f64,
}

/// Error categories (`ErrorCategory` in engine.ts).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum ErrorCategory {
    Validation,
    Unsupported,
    Permission,
    Environment,
    Target,
    Limit,
    Expression,
    Action,
    User,
    Internal,
    Timeout,
    Display,
}

/// Error returned by an [`InputBackend`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackendError {
    /// Message shown in the ledger.
    pub message: String,
    /// Category (defaults to `action`).
    pub category: Option<ErrorCategory>,
    /// The action was interrupted because the run was stopped.
    pub aborted: bool,
}

impl BackendError {
    /// An `action` error.
    pub fn action(message: impl Into<String>) -> Self {
        Self { message: message.into(), category: None, aborted: false }
    }
    /// An error with an explicit category.
    pub fn new(category: ErrorCategory, message: impl Into<String>) -> Self {
        Self { message: message.into(), category: Some(category), aborted: false }
    }
    /// The run was stopped while the action was in progress.
    pub fn aborted() -> Self {
        Self { message: "stopped".into(), category: None, aborted: true }
    }
}

impl std::fmt::Display for BackendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for BackendError {}

/// Platform abstraction used by the interpreter (`Backend` in engine.ts).
///
/// Implementations must honour [`RunControl::is_stopped`] promptly in long actions (return
/// [`BackendError::aborted`]).
pub trait InputBackend: Send {
    /// Platform used for capability checks.
    fn platform(&self) -> Platform;
    /// Performs one action. Returns [`Value::Null`] for actions without a result.
    fn perform(&mut self, action: &InputAction, control: &RunControl) -> Result<Value, BackendError>;
    /// Asks the user a yes/no question (confirm step).
    fn confirm(&mut self, message: &str, control: &RunControl) -> Result<bool, BackendError>;
    /// Live screen geometry, if known.
    fn screen(&mut self) -> Option<ScreenInfo> {
        None
    }
    /// Connected monitors in virtual-desktop px, any order (default: the primary screen only).
    fn displays(&mut self) -> Vec<DisplayInfo> {
        self.screen()
            .map(|s| {
                vec![DisplayInfo::new("primary", true, Rect { x: 0.0, y: 0.0, w: f64::from(s.width), h: f64::from(s.height) }, s.scale)]
            })
            .unwrap_or_default()
    }
    /// Current pointer position (Stage takeover detection); `None` when there is no pointer.
    fn pointer_position(&mut self) -> Option<(f64, f64)> {
        None
    }
}

/* -------------------------------------------------------------------- clock */

/// Returned by [`Clock::sleep`] when the run was stopped during the sleep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Aborted;

/// Time source of a run.
pub trait Clock: Send + Sync {
    /// Milliseconds (epoch for the real clock).
    fn now(&self) -> u64;
    /// Sleeps `ms`, returning early with [`Aborted`] when the run is stopped.
    fn sleep(&self, ms: u64, control: &RunControl) -> Result<(), Aborted>;
}

/// Wall clock; sleeps wake immediately when the run is stopped.
#[derive(Debug, Default, Clone, Copy)]
pub struct RealClock;

impl Clock for RealClock {
    fn now(&self) -> u64 {
        let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis());
        u64::try_from(ms).unwrap_or(u64::MAX)
    }
    fn sleep(&self, ms: u64, control: &RunControl) -> Result<(), Aborted> {
        let deadline = std::time::Instant::now() + Duration::from_millis(ms);
        loop {
            if control.is_stopped() {
                return Err(Aborted);
            }
            let now = std::time::Instant::now();
            if now >= deadline {
                return Ok(());
            }
            let slice = (deadline - now).min(Duration::from_millis(SLICE_MS));
            if control.wait_for_stop(slice) {
                return Err(Aborted);
            }
        }
    }
}

/// Virtual clock for tests, previews and simulations: sleeping advances time instantly.
#[derive(Debug, Default)]
pub struct VirtualClock {
    t: AtomicU64,
}

impl VirtualClock {
    /// A clock starting at `start` ms.
    pub fn new(start: u64) -> Self {
        Self { t: AtomicU64::new(start) }
    }
    /// Moves time forward.
    pub fn advance(&self, ms: u64) {
        self.t.fetch_add(ms, Ordering::SeqCst);
    }
}

impl Clock for VirtualClock {
    fn now(&self) -> u64 {
        self.t.load(Ordering::SeqCst)
    }
    fn sleep(&self, ms: u64, control: &RunControl) -> Result<(), Aborted> {
        if control.is_stopped() {
            return Err(Aborted);
        }
        self.advance(ms);
        if control.is_stopped() {
            return Err(Aborted);
        }
        Ok(())
    }
}

/* ------------------------------------------------------------------- events */

/// Run lifecycle states.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum RunState {
    Idle,
    Preflight,
    Countdown,
    Running,
    Paused,
    Stopped,
    Completed,
    Failed,
}

impl RunState {
    fn is_terminal(self) -> bool {
        matches!(self, RunState::Stopped | RunState::Completed | RunState::Failed)
    }
}

/// A run failure with location and category.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunError {
    /// Step id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    /// Step path (`0.body.1`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Message.
    pub message: String,
    /// Category.
    pub category: ErrorCategory,
}

impl RunError {
    fn new(category: ErrorCategory, message: impl Into<String>) -> Self {
        Self { step_id: None, path: None, message: message.into(), category }
    }
}

/// Structured run events (`RunEvent` in engine.ts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[allow(missing_docs)]
pub enum RunEvent {
    State {
        state: RunState,
        at: u64,
    },
    Countdown {
        remaining_ms: u64,
        at: u64,
    },
    StepStart {
        step_id: String,
        step_type: String,
        path: String,
        at: u64,
    },
    StepEnd {
        step_id: String,
        ok: bool,
        duration_ms: u64,
        at: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        attempts: Option<u32>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<RunError>,
    },
    Breakpoint {
        step_id: String,
        at: u64,
    },
    Log {
        level: LogLevel,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        step_id: Option<String>,
        at: u64,
    },
    Var {
        name: String,
        value: Value,
        at: u64,
    },
    Retry {
        step_id: String,
        attempt: u32,
        at: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        delay_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    Timeout {
        step_id: String,
        timeout_ms: u64,
        at: u64,
    },
    Error {
        error: RunError,
        at: u64,
    },
}

/// Final status of a run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum RunStatus {
    Completed,
    Stopped,
    Failed,
}

/// Outcome of a run (`RunResult` in engine.ts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    /// Final status.
    pub status: RunStatus,
    /// Stop reason or failure message.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Failure details.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RunError>,
    /// Input actions performed (including the one that exceeded the limit).
    pub actions: u64,
    /// Loop iterations.
    pub iterations: u64,
    /// Executed steps (attempts included), bounded by `limits.maxSteps`.
    pub steps: u64,
    /// `endedAt - startedAt`.
    pub duration_ms: u64,
    /// Final variables.
    pub vars: Vars,
    /// Start (after the countdown).
    pub started_at: u64,
    /// End.
    pub ended_at: u64,
}

/// Event listener. A panicking listener never breaks a run.
pub type EventSink = Arc<dyn Fn(&RunEvent) + Send + Sync>;
/// Resolves `{{secret:name}}` from the OS keystore.
pub type SecretResolver = Arc<dyn Fn(&str) -> Option<String> + Send + Sync>;
/// Resolves flows for `runFlow` steps.
pub type FlowResolver = Arc<dyn Fn(&str) -> Option<Flow> + Send + Sync>;
/// Approves the risky steps of a run.
pub type RiskApproval = Box<dyn FnMut(&RiskReport) -> bool + Send>;
/// Approves a changed screen geometry (recorded, live).
pub type ScreenApproval = Box<dyn FnMut(&ScreenInfo, &ScreenInfo) -> bool + Send>;
/// Random source in `[0, 1)`.
pub type RandomSource = Arc<dyn Fn() -> f64 + Send + Sync>;
/// onMissingDisplay "ask": may the run use the primary display instead of the one labelled?
pub type DisplayApproval = Box<dyn FnMut(&str) -> bool + Send>;

/// Options of a run (`RunOptions` in engine.ts).
#[derive(Default)]
pub struct RunOptions {
    /// Time source (default [`RealClock`]).
    pub clock: Option<Arc<dyn Clock>>,
    /// Random source (default: per-thread SplitMix64).
    pub random: Option<RandomSource>,
    /// Event listener.
    pub on_event: Option<EventSink>,
    /// Values for variables that declare a `prompt`.
    pub inputs: IndexMap<String, Value>,
    /// Secret resolver.
    pub secret: Option<SecretResolver>,
    /// Approves risky steps (absent = not approved).
    pub confirm_risk: Option<RiskApproval>,
    /// Approves a changed screen geometry (absent = not approved).
    pub confirm_screen_change: Option<ScreenApproval>,
    /// Flow resolver for `runFlow`.
    pub resolve_flow: Option<FlowResolver>,
    /// Honour breakpoints.
    pub debug: bool,
    /// Skip the pre-start countdown.
    pub skip_countdown: bool,
    /// Max nesting of `runFlow` (default 8).
    pub max_call_depth: Option<u32>,
    /// Answers onMissingDisplay "ask" (absent = the backend's confirm dialog asks).
    pub confirm_missing_display: Option<DisplayApproval>,
}

/* ---------------------------------------------------------------- control */

#[derive(Debug)]
struct ControlState {
    state: RunState,
    paused: bool,
    stop_reason: Option<String>,
    step_once: bool,
}

/// Shared stop / pause flags of one run.
#[derive(Debug)]
pub struct RunControl {
    stopped: AtomicBool,
    inner: Mutex<ControlState>,
    cv: Condvar,
}

impl Default for RunControl {
    fn default() -> Self {
        Self::new()
    }
}

impl RunControl {
    /// Fresh, idle control block.
    pub fn new() -> Self {
        Self {
            stopped: AtomicBool::new(false),
            inner: Mutex::new(ControlState { state: RunState::Idle, paused: false, stop_reason: None, step_once: false }),
            cv: Condvar::new(),
        }
    }

    fn lock(&self) -> MutexGuard<'_, ControlState> {
        // A poisoned lock only means a listener panicked; the data is still consistent.
        self.inner.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// True once a stop was requested.
    pub fn is_stopped(&self) -> bool {
        self.stopped.load(Ordering::SeqCst)
    }

    /// Current state.
    pub fn state(&self) -> RunState {
        self.lock().state
    }

    /// Waits up to `timeout` for a stop request; returns true when stopped.
    pub fn wait_for_stop(&self, timeout: Duration) -> bool {
        let guard = self.lock();
        if self.is_stopped() {
            return true;
        }
        let _unused = self.cv.wait_timeout(guard, timeout).unwrap_or_else(std::sync::PoisonError::into_inner);
        self.is_stopped()
    }

    /// Blocks while paused; returns [`Aborted`] when stopped.
    pub fn wait_while_paused(&self) -> Result<(), Aborted> {
        let mut guard = self.lock();
        while guard.paused && !self.is_stopped() {
            guard = self.cv.wait_timeout(guard, Duration::from_millis(SLICE_MS)).unwrap_or_else(std::sync::PoisonError::into_inner).0;
        }
        if self.is_stopped() {
            Err(Aborted)
        } else {
            Ok(())
        }
    }
}

struct RunShared {
    id: String,
    control: RunControl,
    clock: Arc<dyn Clock>,
    sink: Option<EventSink>,
}

impl RunShared {
    fn emit(&self, e: RunEvent) {
        if let Some(sink) = &self.sink {
            let _ignored = catch_unwind(AssertUnwindSafe(|| sink(&e)));
        }
    }
    fn set_state(&self, s: RunState) {
        self.control.lock().state = s;
        self.emit(RunEvent::State { state: s, at: self.clock.now() });
    }
    fn pause(&self) {
        {
            let mut g = self.control.lock();
            if g.state != RunState::Running {
                return;
            }
            g.paused = true;
            g.state = RunState::Paused;
        }
        self.emit(RunEvent::State { state: RunState::Paused, at: self.clock.now() });
    }
    fn resume(&self) {
        {
            let mut g = self.control.lock();
            if g.state != RunState::Paused {
                return;
            }
            g.state = RunState::Running;
            g.paused = false;
        }
        self.emit(RunEvent::State { state: RunState::Running, at: self.clock.now() });
        self.control.cv.notify_all();
    }
    fn step_over(&self) {
        {
            let mut g = self.control.lock();
            if g.state != RunState::Paused {
                return;
            }
            g.step_once = true;
        }
        self.resume();
    }
    fn stop(&self, reason: &str) {
        {
            let mut g = self.control.lock();
            if g.state.is_terminal() {
                return;
            }
            g.stop_reason = Some(reason.to_owned());
            g.paused = false;
            self.control.stopped.store(true, Ordering::SeqCst);
        }
        self.control.cv.notify_all();
    }
    fn take_step_once(&self) -> bool {
        std::mem::take(&mut self.control.lock().step_once)
    }
}

/// Cloneable, thread-safe handle controlling a run.
#[derive(Clone)]
pub struct RunHandle {
    shared: Arc<RunShared>,
}

impl RunHandle {
    /// Run id (`run_xxxxxxxx`).
    pub fn id(&self) -> &str {
        &self.shared.id
    }
    /// Current state.
    pub fn state(&self) -> RunState {
        self.shared.control.state()
    }
    /// Pauses a running run (no-op otherwise).
    pub fn pause(&self) {
        self.shared.pause();
    }
    /// Resumes a paused run.
    pub fn resume(&self) {
        self.shared.resume();
    }
    /// While paused at a breakpoint: execute exactly one more step, then pause again.
    pub fn step_over(&self) {
        self.shared.step_over();
    }
    /// Requests a stop; observed within one sleep slice.
    pub fn stop(&self, reason: &str) {
        self.shared.stop(reason);
    }
    /// The control block (for backends).
    pub fn control(&self) -> &RunControl {
        &self.shared.control
    }
}

/* ------------------------------------------------------------- control flow */

/// Non-local exits inside the interpreter (`Interrupt` / `RunFailure` / abort in engine.ts).
#[derive(Debug)]
enum Signal {
    Break,
    Continue,
    Stop(String),
    Goto(String),
    Abort,
    Fail(RunError),
    /// A step deadline passed; carries the deadline id so only its owner handles it.
    Timeout(u64),
}

impl From<ExprError> for Signal {
    fn from(e: ExprError) -> Self {
        let category = if e.host { ErrorCategory::Action } else { ErrorCategory::Expression };
        Signal::Fail(RunError::new(category, e.message))
    }
}

impl From<Aborted> for Signal {
    fn from(_: Aborted) -> Self {
        Signal::Abort
    }
}

type Flowing<T = ()> = Result<T, Signal>;

fn to_run_error(mut e: RunError, step_id: &str, path: &str) -> RunError {
    if e.step_id.is_none() {
        e.step_id = Some(step_id.to_owned());
    }
    if e.path.is_none() {
        e.path = Some(path.to_owned());
    }
    e
}

/// Result of the static pre-run checks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preflight {
    /// Every not-fully-supported step.
    pub compat: Vec<CompatIssue>,
    /// Unsupported steps (block the run).
    pub blocked: Vec<CompatIssue>,
    /// Risk report.
    pub risk: RiskReport,
}

/// Static pre-run checks shared by every surface (`FlowRun.preflight`).
pub fn preflight(flow: &Flow, platform: Platform) -> Preflight {
    let compat = compatibility(&flow.steps, platform);
    let blocked = compat.iter().filter(|c| c.support == Support::Unsupported).cloned().collect();
    Preflight { compat, blocked, risk: analyze_risk(flow) }
}

fn new_run_id() -> String {
    const ALPHABET: &[u8] = b"0123456789abcdefghijklmnopqrstuvwxyz";
    let mut s = String::from("run_");
    for _ in 0..8 {
        #[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
        let i = (default_random() * 36.0) as usize % 36;
        s.push(char::from(ALPHABET[i]));
    }
    s
}

/* -------------------------------------------------------------------- run */

/// One active step timeout.
#[derive(Debug, Clone)]
struct Deadline {
    id: u64,
    timeout_ms: u64,
    /// The step times out once the clock is strictly past this instant.
    at: u64,
}

/// Applies the humanize offset to pixel point targets (`humanizeTarget` in engine.ts).
pub fn humanize_target(t: &Target, offset_px: u32, rnd: &mut dyn FnMut() -> f64) -> Target {
    match t {
        Target::Point { x, y, space, monitor, display } if offset_px > 0 && *space != Space::Normalized => {
            let max = f64::from(offset_px);
            let mut off = || ((rnd() * (2.0 * max + 1.0)).floor()).min(2.0 * max) - max;
            let dx = off();
            let dy = off();
            Target::Point { x: x + dx, y: y + dy, space: *space, monitor: *monitor, display: display.clone() }
        }
        other => other.clone(),
    }
}

/// Default takeover distance in px (`TAKEOVER_PX`).
const TAKEOVER_PX: u32 = 24;

/// One execution of a flow (`FlowRun` in engine.ts). Can be started once.
pub struct FlowRun {
    flow: Arc<Flow>,
    backend: Box<dyn InputBackend>,
    opts: RunOptions,
    shared: Arc<RunShared>,
    vars: Vars,
    actions: u64,
    iterations: u64,
    started_at: u64,
    call_depth: u32,
    steps: u64,
    deadlines: Vec<Deadline>,
    next_deadline: u64,
    humanize: Option<Humanize>,
    human_rng: Option<Mulberry32>,
    /// Where AutoFlow last put the pointer (Stage takeover detection).
    last_pointer: Option<(f64, f64)>,
    display_warned: HashSet<String>,
    display_answers: HashMap<String, bool>,
}

impl FlowRun {
    /// Prepares a run. Nothing happens until [`FlowRun::start`] or [`FlowRun::spawn`].
    pub fn new(flow: Flow, backend: Box<dyn InputBackend>, mut opts: RunOptions) -> Self {
        let clock: Arc<dyn Clock> = opts.clock.take().unwrap_or_else(|| Arc::new(RealClock));
        let sink = opts.on_event.clone();
        let shared = Arc::new(RunShared { id: new_run_id(), control: RunControl::new(), clock, sink });
        let humanize = flow.humanize.filter(|h| h.offset_px > 0 || h.delay_ms > 0);
        let human_rng = flow.humanize.and_then(|h| h.seed).map(Mulberry32::new);
        Self {
            flow: Arc::new(flow),
            backend,
            opts,
            shared,
            vars: Vars::new(),
            actions: 0,
            iterations: 0,
            started_at: 0,
            call_depth: 0,
            steps: 0,
            deadlines: Vec::new(),
            next_deadline: 0,
            humanize,
            human_rng,
            last_pointer: None,
            display_warned: HashSet::new(),
            display_answers: HashMap::new(),
        }
    }

    /// Run id.
    pub fn id(&self) -> &str {
        &self.shared.id
    }

    /// A handle for pause / resume / stop from other threads.
    pub fn handle(&self) -> RunHandle {
        RunHandle { shared: Arc::clone(&self.shared) }
    }

    /// Runs the flow to completion on a new thread.
    ///
    /// # Errors
    /// Fails only if the OS cannot create the thread.
    pub fn spawn(self) -> std::io::Result<(RunHandle, std::thread::JoinHandle<RunResult>)> {
        let handle = self.handle();
        let join = std::thread::Builder::new()
            .name(format!("autoflow-{}", self.shared.id))
            .stack_size(8 * 1024 * 1024)
            .spawn(move || self.start())?;
        Ok((handle, join))
    }

    /// Runs the flow to completion on the current thread.
    pub fn start(mut self) -> RunResult {
        let clock = Arc::clone(&self.shared.clock);
        self.started_at = clock.now();
        self.shared.set_state(RunState::Preflight);
        let flow = Arc::clone(&self.flow);
        let outcome = self.run_all(&flow);
        match outcome {
            Ok(()) => self.finish(RunStatus::Completed, None, None),
            Err(sig) => self.handle_terminal(sig),
        }
    }

    fn run_all(&mut self, flow: &Flow) -> Flowing {
        self.preflight_checks(flow)?;
        self.init_vars(flow);
        let countdown = flow.limits.countdown_ms;
        if !self.opts.skip_countdown && countdown > 0 {
            self.shared.set_state(RunState::Countdown);
            let mut remaining = countdown;
            while remaining > 0 {
                self.emit(RunEvent::Countdown { remaining_ms: remaining, at: self.now() });
                let slice = remaining.min(1000);
                self.clock_sleep(slice)?;
                remaining -= slice;
            }
        }
        self.started_at = self.now();
        self.shared.set_state(RunState::Running);
        self.run_top_level(&flow.steps)
    }

    /* ------------------------------------------------------------ internals */

    fn now(&self) -> u64 {
        self.shared.clock.now()
    }

    fn emit(&self, e: RunEvent) {
        self.shared.emit(e);
    }

    fn clock_sleep(&self, ms: u64) -> Flowing {
        // Sub-slices keep stop latency ≤ SLICE_MS for every clock implementation.
        let mut remaining = ms;
        while remaining > 0 {
            let slice = remaining.min(SLICE_MS);
            self.shared.clock.sleep(slice, &self.shared.control)?;
            remaining -= slice;
        }
        if self.shared.control.is_stopped() {
            return Err(Signal::Abort);
        }
        Ok(())
    }

    fn preflight_checks(&mut self, flow: &Flow) -> Flowing {
        let platform = self.backend.platform();
        let pf = preflight(flow, platform);
        if let Some(first) = pf.blocked.first() {
            let types: Vec<&str> = pf.blocked.iter().map(|b| b.step_type.as_str()).collect();
            return Err(Signal::Fail(RunError {
                step_id: Some(first.step_id.clone()),
                path: None,
                message: format!("{} step(s) are not supported on {}: {}", pf.blocked.len(), platform.as_str(), types.join(", ")),
                category: ErrorCategory::Unsupported,
            }));
        }
        if pf.risk.needs_confirm {
            let ok = self.opts.confirm_risk.as_mut().is_some_and(|f| f(&pf.risk));
            if !ok {
                return Err(Signal::Fail(RunError::new(ErrorCategory::User, "risky steps were not approved")));
            }
        }
        if let Some(rec) = flow.screen {
            if let Some(live) = self.backend.screen() {
                let rec = ScreenInfo { width: rec.width, height: rec.height, scale: rec.scale };
                let changed = live.width != rec.width || live.height != rec.height || (live.scale - rec.scale).abs() > 0.01;
                if changed && uses_screen_coordinates(&flow.steps) {
                    let ok = self.opts.confirm_screen_change.as_mut().is_some_and(|f| f(&rec, &live));
                    if !ok {
                        return Err(Signal::Fail(RunError::new(
                            ErrorCategory::Environment,
                            format!(
                                "screen changed from {}x{}@{} to {}x{}@{}",
                                rec.width,
                                rec.height,
                                js_number_to_string(rec.scale),
                                live.width,
                                live.height,
                                js_number_to_string(live.scale)
                            ),
                        )));
                    }
                }
            }
        }
        // A missing stage fails (or falls back, or asks) before the countdown, not at the first click.
        if let Some(st) = &flow.stage {
            self.display(&st.display)?;
        }
        Ok(())
    }

    /* ---------------------------------------------------------- displays */

    fn display_list(&mut self) -> Vec<DisplayInfo> {
        sort_displays(&self.backend.displays())
    }

    /// Resolves a display reference, applying `onMissingDisplay` when it is not connected.
    fn display(&mut self, r: &DisplayRef) -> Flowing<DisplayInfo> {
        let list = self.display_list();
        if let Some(d) = find_display(&list, r) {
            return Ok(d.clone());
        }
        let key = display_ref_key(r);
        let label = display_ref_label(r);
        let Some(primary) = list.first().cloned() else {
            return Err(Signal::Fail(RunError::new(ErrorCategory::Display, format!("display {label} is not connected"))));
        };
        let use_primary = match self.flow.on_missing_display.unwrap_or_default() {
            OnMissingDisplay::Fail => false,
            OnMissingDisplay::Primary => true,
            OnMissingDisplay::Ask => {
                if let Some(ok) = self.display_answers.get(&key) {
                    *ok
                } else {
                    let ok = if let Some(f) = self.opts.confirm_missing_display.as_mut() {
                        f(&label)
                    } else {
                        let msg = format!("Display {label} is not connected. Use the primary display instead?");
                        match self.backend.confirm(&msg, &self.shared.control) {
                            Ok(ok) => ok,
                            Err(e) if e.aborted => return Err(Signal::Abort),
                            Err(e) => return Err(Signal::Fail(RunError::new(e.category.unwrap_or(ErrorCategory::Action), e.message))),
                        }
                    };
                    self.display_answers.insert(key.clone(), ok);
                    ok
                }
            }
        };
        if !use_primary {
            return Err(Signal::Fail(RunError::new(ErrorCategory::Display, format!("display {label} is not connected"))));
        }
        if self.display_warned.insert(key) {
            self.emit(RunEvent::Log {
                level: LogLevel::Warn,
                message: format!("display {label} is not connected; using the primary display"),
                step_id: None,
                at: self.now(),
            });
        }
        Ok(primary)
    }

    /// Places display-relative point/region/image targets on absolute pixels (`place` in
    /// engine.ts). Targets without a display reference outside Stage mode are returned unchanged.
    fn place(&mut self, t: &Target) -> Flowing<Target> {
        match t {
            Target::Image(img) => {
                let Some(r) = &img.display else { return Ok(t.clone()) };
                let d = self.display(r)?;
                let region = img.region.as_ref().map_or(d.bounds, |reg| place_rect(&d.bounds, reg, "display"));
                let mut out = img.clone();
                out.display = None;
                out.region = Some(region);
                Ok(Target::Image(out))
            }
            Target::Point { space, display, .. } | Target::Region { space, display, .. } if *space != Space::Window => {
                let stage = self.flow.stage.as_ref().map(|s| s.display.clone());
                let r = match display {
                    Some(r) => r.clone(),
                    None if *space == Space::Display || (*space == Space::Normalized && stage.is_some()) => {
                        stage.unwrap_or_else(|| DisplayRef::Name("primary".into()))
                    }
                    None => return Ok(t.clone()),
                };
                let d = self.display(&r)?;
                let b = d.bounds;
                match t {
                    Target::Point { x, y, .. } => {
                        let (px, py) = place_point(&b, *x, *y, space.as_str());
                        if !on_display(&b, px, py) {
                            return Err(Signal::Fail(RunError::new(
                                ErrorCategory::Display,
                                format!(
                                    "point ({}, {}) is outside display {}",
                                    js_number_to_string(px),
                                    js_number_to_string(py),
                                    display_ref_label(&r)
                                ),
                            )));
                        }
                        Ok(Target::Point { x: px, y: py, space: Space::Screen, monitor: None, display: None })
                    }
                    Target::Region { x, y, w, h, pick, .. } => {
                        let rr = place_rect(&b, &Rect { x: *x, y: *y, w: *w, h: *h }, space.as_str());
                        if !rect_on_display(&b, &rr) {
                            return Err(Signal::Fail(RunError::new(
                                ErrorCategory::Display,
                                format!(
                                    "region ({}, {}) {}x{} is outside display {}",
                                    js_number_to_string(rr.x),
                                    js_number_to_string(rr.y),
                                    js_number_to_string(rr.w),
                                    js_number_to_string(rr.h),
                                    display_ref_label(&r)
                                ),
                            )));
                        }
                        Ok(Target::Region { x: rr.x, y: rr.y, w: rr.w, h: rr.h, space: Space::Screen, pick: *pick, display: None })
                    }
                    _ => Ok(t.clone()),
                }
            }
            _ => Ok(t.clone()),
        }
    }

    /// Placement on displays, then humanization (in that order in every engine).
    fn target(&mut self, t: &Target) -> Flowing<Target> {
        let placed = self.place(t)?;
        Ok(self.human_target(&placed))
    }

    /// Remembers where an input action left the pointer (unknown for non-pixel targets).
    fn track(&mut self, t: Option<&Target>) {
        self.last_pointer = match t {
            Some(Target::Point { x, y, space: Space::Screen, .. }) => Some((*x, *y)),
            _ => None,
        };
    }

    /// Stage guard: once AutoFlow placed the pointer, a pointer that moved more than
    /// `takeoverPx` or left the stage display means the user took over — the run pauses.
    fn check_takeover(&mut self) -> Flowing {
        let Some(st) = self.flow.stage.clone() else { return Ok(()) };
        let Some((lx, ly)) = self.last_pointer else { return Ok(()) };
        if st.pause_on_takeover == Some(false) {
            return Ok(());
        }
        let Some((px, py)) = self.backend.pointer_position() else { return Ok(()) };
        let limit = f64::from(st.takeover_px.unwrap_or(TAKEOVER_PX));
        let (dx, dy) = (px - lx, py - ly);
        let stage = self.display(&st.display)?;
        let off = !on_display(&stage.bounds, px, py);
        if !off && dx * dx + dy * dy <= limit * limit {
            return Ok(());
        }
        self.last_pointer = None;
        let message = if off { "takeover: pointer left the stage display, run paused" } else { "takeover: pointer moved, run paused" };
        self.emit(RunEvent::Log { level: LogLevel::Warn, message: message.into(), step_id: None, at: self.now() });
        self.shared.pause();
        self.gate()
    }

    /// Absolute pixel of a probe position (pixel conditions and steps).
    fn probe_point(&mut self, at: &Target) -> Flowing<(f64, f64)> {
        let Target::Point { x, y, space, display, .. } = at else {
            return Err(Signal::Fail(RunError::new(ErrorCategory::Validation, "pixel positions must be points")));
        };
        if *space == Space::Window {
            return Err(Signal::Fail(RunError::new(ErrorCategory::Validation, "pixel positions cannot be window-relative")));
        }
        let r = match display {
            Some(r) => r.clone(),
            None if *space == Space::Screen => return Ok(place_point(&Rect { x: 0.0, y: 0.0, w: 0.0, h: 0.0 }, *x, *y, "screen")),
            None => self.flow.stage.as_ref().map_or_else(|| DisplayRef::Name("primary".into()), |s| s.display.clone()),
        };
        let d = self.display(&r)?;
        let (px, py) = place_point(&d.bounds, *x, *y, space.as_str());
        if !on_display(&d.bounds, px, py) {
            return Err(Signal::Fail(RunError::new(
                ErrorCategory::Display,
                format!("point ({}, {}) is outside display {}", js_number_to_string(px), js_number_to_string(py), display_ref_label(&r)),
            )));
        }
        Ok((px, py))
    }

    fn read_pixel(&mut self, at: &Target) -> Flowing<[u8; 3]> {
        let (x, y) = self.probe_point(at)?;
        let v = self.perform(&InputAction::Pixel { x, y })?;
        match &v {
            Value::Str(s) => parse_color(s),
            _ => None,
        }
        .ok_or_else(|| Signal::Fail(RunError::new(ErrorCategory::Unsupported, "this device cannot read screen pixels")))
    }

    fn scene(&self, name: &str) -> Flowing<Scene> {
        self.flow
            .scenes
            .iter()
            .flatten()
            .find(|s| s.name == name)
            .cloned()
            .ok_or_else(|| Signal::Fail(RunError::new(ErrorCategory::Validation, format!("scene \"{name}\" is not defined in this flow"))))
    }

    /// Similarity (0..1) between the live display region of a scene and its remembered hash.
    fn scene_similarity(&mut self, s: &Scene) -> Flowing<f64> {
        let r = s
            .display
            .clone()
            .or_else(|| self.flow.stage.as_ref().map(|st| st.display.clone()))
            .unwrap_or(DisplayRef::Name("primary".into()));
        let b = self.display(&r)?.bounds;
        let mut rr = place_rect(&b, &s.region, "normalized");
        rr.w = rr.w.min(b.x + b.w - rr.x).max(1.0);
        rr.h = rr.h.min(b.y + b.h - rr.y).max(1.0);
        let v = self.perform(&InputAction::SceneHash { region: rr })?;
        match &v {
            Value::Str(h) if is_hash(h) => Ok(hash_similarity(&h.to_ascii_lowercase(), &s.hash)),
            _ => Err(Signal::Fail(RunError::new(ErrorCategory::Unsupported, "this device cannot capture the screen for scenes"))),
        }
    }

    /// Evaluates a condition: scene, then pixel, then expression (short-circuit AND).
    fn holds(&mut self, c: &Condition) -> Flowing<bool> {
        if let Some(sc) = &c.scene {
            let scene = self.scene(&sc.name)?;
            let showing = self.scene_similarity(&scene)? >= sc.min_similarity;
            if showing == (sc.not == Some(true)) {
                return Ok(false);
            }
        }
        if let Some(px) = &c.pixel {
            let want = parse_color(&px.color).unwrap_or([0, 0, 0]);
            let matched = color_distance(self.read_pixel(&px.at)?, want) <= px.tolerance;
            if matched == (px.not == Some(true)) {
                return Ok(false);
            }
        }
        Ok(self.eval(&c.expr)?.truthy())
    }

    fn init_vars(&mut self, flow: &Flow) {
        for v in &flow.variables {
            let input = self.opts.inputs.get(&v.name).filter(|x| !matches!(x, Value::Null));
            let mut val = input.cloned().or_else(|| v.initial.clone()).unwrap_or_else(|| default_for(v.var_type));
            match v.var_type {
                VarType::Number => val = Value::Num(val.to_js_number()),
                VarType::Boolean => val = Value::Bool(val == Value::Bool(true) || val == Value::Str("true".into())),
                VarType::String | VarType::List => {}
            }
            self.vars.insert(v.name.clone(), val);
        }
    }

    fn run_top_level(&mut self, steps: &[Step]) -> Flowing {
        let mut i = 0;
        let mut gotos: u64 = 0;
        while i < steps.len() {
            match self.run_step(&steps[i], &i.to_string()) {
                Ok(()) | Err(Signal::Break | Signal::Continue) => i += 1,
                Err(Signal::Goto(target)) => {
                    let Some(idx) = steps.iter().position(|s| s.id == target) else {
                        return Err(Signal::Fail(RunError::new(
                            ErrorCategory::Validation,
                            format!("goto target \"{target}\" not found at top level"),
                        )));
                    };
                    gotos += 1;
                    if gotos > self.flow.limits.max_iterations {
                        return Err(Signal::Fail(RunError::new(ErrorCategory::Limit, "too many error jumps")));
                    }
                    i = idx;
                }
                Err(other) => return Err(other),
            }
        }
        Ok(())
    }

    fn run_list(&mut self, steps: &[Step], path: &str) -> Flowing {
        for (i, s) in steps.iter().enumerate() {
            self.run_step(s, &format!("{path}.{i}"))?;
        }
        Ok(())
    }

    fn gate(&self) -> Flowing {
        let control = &self.shared.control;
        if control.is_stopped() {
            return Err(Signal::Abort);
        }
        let max = self.flow.limits.max_duration_ms;
        if self.now().saturating_sub(self.started_at) > max {
            #[allow(clippy::cast_precision_loss)]
            let secs = crate::value::js_round(max as f64 / 1000.0);
            return Err(Signal::Fail(RunError::new(
                ErrorCategory::Limit,
                format!("maximum run time reached ({}s)", js_number_to_string(secs)),
            )));
        }
        self.check_deadlines()?;
        control.wait_while_paused()?;
        Ok(())
    }

    /// The outermost expired deadline wins, so an enclosing step's timeout is never swallowed.
    fn check_deadlines(&self) -> Flowing {
        let now = self.now();
        match self.deadlines.iter().find(|d| now > d.at) {
            Some(d) => Err(Signal::Timeout(d.id)),
            None => Ok(()),
        }
    }

    /// Time until the nearest deadline expires (exclusive), so sleeps end exactly when it does.
    fn until_deadline(&self) -> u64 {
        let now = self.now();
        self.deadlines.iter().map(|d| (d.at + 1).saturating_sub(now)).min().unwrap_or(u64::MAX).max(1)
    }

    fn sleep(&self, ms: u64) -> Flowing {
        let mut remaining = ms;
        while remaining > 0 {
            self.gate()?;
            let slice = remaining.min(SLICE_MS).min(self.until_deadline());
            self.shared.clock.sleep(slice, &self.shared.control)?;
            remaining -= slice;
        }
        Ok(())
    }

    fn count_step(&mut self) -> Flowing {
        self.steps += 1;
        if let Some(max) = self.flow.limits.max_steps {
            if self.steps > max {
                return Err(Signal::Fail(RunError::new(ErrorCategory::Limit, format!("maximum number of steps reached ({max})"))));
            }
        }
        Ok(())
    }

    /// One attempt of a step, with its optional deadline.
    fn attempt(&mut self, step: &Step, path: &str) -> Result<(), (Signal, Option<Deadline>)> {
        self.count_step().map_err(|e| (e, None))?;
        let Some(timeout_ms) = step.step_timeout_ms else {
            return self.exec(step, path).map_err(|e| (e, None));
        };
        self.next_deadline += 1;
        let d = Deadline { id: self.next_deadline, timeout_ms, at: self.now().saturating_add(timeout_ms) };
        self.deadlines.push(d.clone());
        let r = self.exec(step, path);
        self.deadlines.retain(|x| x.id != d.id);
        match r {
            // Work that ended after the deadline (an action that could not be interrupted) still timed out.
            Ok(()) if self.now() > d.at => Err((Signal::Timeout(d.id), Some(d))),
            Ok(()) => Ok(()),
            Err(e) => Err((e, Some(d))),
        }
    }

    fn human_random(&mut self) -> f64 {
        match self.human_rng.as_mut() {
            Some(r) => r.next_f64(),
            None => self.random(),
        }
    }

    /// Humanization: optional bounded random delay before an input action.
    fn human_delay(&mut self) -> Flowing {
        if let Some(h) = self.humanize {
            if h.delay_ms > 0 {
                #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                let d = (self.human_random() * (h.delay_ms as f64 + 1.0)).floor() as u64;
                self.sleep(d.min(h.delay_ms))?;
            }
        }
        Ok(())
    }

    fn human_target(&mut self, t: &Target) -> Target {
        match self.humanize {
            Some(h) if h.offset_px > 0 => {
                let mut draws = Vec::with_capacity(2);
                if matches!(t, Target::Point { space, .. } if *space != Space::Normalized) {
                    draws.push(self.human_random());
                    draws.push(self.human_random());
                }
                let mut it = draws.into_iter();
                humanize_target(t, h.offset_px, &mut || it.next().unwrap_or(0.0))
            }
            _ => t.clone(),
        }
    }

    fn run_step(&mut self, step: &Step, path: &str) -> Flowing {
        if step.is_disabled() {
            return Ok(());
        }
        self.gate()?;
        if self.opts.debug {
            let once = self.shared.take_step_once();
            if step.breakpoint == Some(true) || once {
                self.emit(RunEvent::Breakpoint { step_id: step.id.clone(), at: self.now() });
                self.shared.pause();
                self.gate()?;
            }
        }
        let t0 = self.now();
        self.emit(RunEvent::StepStart { step_id: step.id.clone(), step_type: step.type_name().to_owned(), path: path.to_owned(), at: t0 });
        let policy = step.on_error.clone();
        let mut attempt: u32 = 0;
        loop {
            let err = match self.attempt(step, path) {
                Ok(()) => {
                    let at = self.now();
                    let attempts = (attempt > 0).then_some(attempt + 1);
                    self.emit(RunEvent::StepEnd {
                        step_id: step.id.clone(),
                        ok: true,
                        duration_ms: at.saturating_sub(t0),
                        at,
                        attempts,
                        error: None,
                    });
                    return Ok(());
                }
                Err((Signal::Timeout(id), Some(d))) if id == d.id && !self.shared.control.is_stopped() => {
                    self.emit(RunEvent::Timeout { step_id: step.id.clone(), timeout_ms: d.timeout_ms, at: self.now() });
                    RunError {
                        step_id: Some(step.id.clone()),
                        path: Some(path.to_owned()),
                        message: format!("step timed out after {} ms", d.timeout_ms),
                        category: ErrorCategory::Timeout,
                    }
                }
                Err((Signal::Fail(e), _)) if !self.shared.control.is_stopped() => to_run_error(e, &step.id, path),
                Err((Signal::Fail(_) | Signal::Timeout(_), _)) if self.shared.control.is_stopped() => return Err(Signal::Abort),
                Err((other, _)) => return Err(other),
            };
            if err.category == ErrorCategory::Limit {
                return Err(Signal::Fail(err));
            }
            if let Some(p) = &policy {
                if p.strategy == ErrorStrategy::Retry && attempt < p.retries {
                    attempt += 1;
                    let mut rnd = || self.random();
                    let delay_ms = retry_delay_ms(p, attempt, &mut rnd);
                    self.emit(RunEvent::Retry {
                        step_id: step.id.clone(),
                        attempt,
                        at: self.now(),
                        delay_ms: Some(delay_ms),
                        error: Some(err.message.clone()),
                    });
                    self.sleep(delay_ms)?;
                    continue;
                }
            }
            let at = self.now();
            self.emit(RunEvent::StepEnd {
                step_id: step.id.clone(),
                ok: false,
                duration_ms: at.saturating_sub(t0),
                at,
                attempts: Some(attempt + 1),
                error: Some(err.clone()),
            });
            match &policy {
                Some(p) if p.strategy == ErrorStrategy::Continue => {
                    self.emit(RunEvent::Log {
                        level: LogLevel::Warn,
                        message: format!("step failed and was skipped: {}", err.message),
                        step_id: Some(step.id.clone()),
                        at: self.now(),
                    });
                    return Ok(());
                }
                Some(p) if p.strategy == ErrorStrategy::Goto && p.goto_step_id.is_some() => {
                    let target = p.goto_step_id.clone().unwrap_or_default();
                    self.emit(RunEvent::Log {
                        level: LogLevel::Warn,
                        message: format!("step failed, jumping to {target}: {}", err.message),
                        step_id: Some(step.id.clone()),
                        at: self.now(),
                    });
                    return Err(Signal::Goto(target));
                }
                _ => return Err(Signal::Fail(err)),
            }
        }
    }

    fn count_action(&mut self) -> Flowing {
        self.actions += 1;
        if self.actions > self.flow.limits.max_actions {
            return Err(Signal::Fail(RunError::new(
                ErrorCategory::Limit,
                format!("maximum number of actions reached ({})", self.flow.limits.max_actions),
            )));
        }
        Ok(())
    }

    fn count_iteration(&mut self) -> Flowing {
        self.iterations += 1;
        if self.iterations > self.flow.limits.max_iterations {
            return Err(Signal::Fail(RunError::new(
                ErrorCategory::Limit,
                format!("maximum number of loop iterations reached ({})", self.flow.limits.max_iterations),
            )));
        }
        Ok(())
    }

    fn random(&self) -> f64 {
        self.opts.random.as_ref().map_or_else(default_random, |r| r())
    }

    fn with_env<T>(&self, f: impl FnOnce(&ExprEnv<'_>) -> T) -> T {
        let clock = &self.shared.clock;
        #[allow(clippy::cast_precision_loss)]
        let now = || clock.now() as f64;
        let random = || self.random();
        f(&ExprEnv { vars: &self.vars, now: &now, random: &random })
    }

    fn eval(&self, src: &str) -> Flowing<Value> {
        Ok(self.with_env(|env| crate::expr::eval_expr(src, env))?)
    }

    fn text(&self, s: &str) -> Flowing<String> {
        self.text_with(s, false)
    }

    /// `mask_secrets`: secrets must exist but render as the mask (log lines end up in the ledger).
    fn text_with(&self, s: &str, mask_secrets: bool) -> Flowing<String> {
        let resolver: crate::expr::SecretLookup<'_> = match self.opts.secret.as_deref() {
            Some(f) => Some(f),
            None => None,
        };
        Ok(self.with_env(|env| interpolate_with(s, env, resolver, mask_secrets))?)
    }

    fn set_var(&mut self, name: &str, value: Value) {
        self.vars.insert(name.to_owned(), value.clone());
        self.emit(RunEvent::Var { name: name.to_owned(), value, at: self.now() });
    }

    fn perform(&mut self, action: &InputAction) -> Flowing<Value> {
        match self.backend.perform(action, &self.shared.control) {
            Ok(v) => Ok(v),
            Err(e) if e.aborted => Err(Signal::Abort),
            Err(e) => Err(Signal::Fail(RunError::new(e.category.unwrap_or(ErrorCategory::Action), e.message))),
        }
    }

    #[allow(clippy::too_many_lines)]
    fn exec(&mut self, s: &Step, path: &str) -> Flowing {
        if matches!(
            s.kind,
            StepKind::Click { .. }
                | StepKind::Move { .. }
                | StepKind::Drag { .. }
                | StepKind::Scroll { .. }
                | StepKind::Key { .. }
                | StepKind::Type { .. }
        ) {
            self.count_action()?;
            self.check_takeover()?;
            if !matches!(s.kind, StepKind::Key { .. }) {
                self.human_delay()?;
            }
        }
        match &s.kind {
            StepKind::Click { target, button, clicks, hold_ms, modifiers } => {
                let target = self.target(target)?;
                self.perform(&InputAction::Click {
                    target: target.clone(),
                    button: *button,
                    clicks: *clicks,
                    hold_ms: *hold_ms,
                    modifiers: modifiers.clone(),
                })?;
                self.track(Some(&target));
            }
            StepKind::Move { target, duration_ms } => {
                let target = self.target(target)?;
                self.perform(&InputAction::Move { target: target.clone(), duration_ms: *duration_ms })?;
                self.track(Some(&target));
            }
            StepKind::Drag { from, to, duration_ms, button } => {
                let from = self.target(from)?;
                let to = self.target(to)?;
                self.perform(&InputAction::Drag { from, to: to.clone(), duration_ms: *duration_ms, button: *button })?;
                self.track(Some(&to));
            }
            StepKind::Scroll { dx, dy, target } => {
                let target = match target {
                    Some(t) => Some(self.place(t)?),
                    None => None,
                };
                self.perform(&InputAction::Scroll { dx: *dx, dy: *dy, target: target.clone() })?;
                if target.is_some() {
                    self.track(target.as_ref());
                }
            }
            StepKind::Key { key, modifiers, action, repeat } => {
                for i in 0..*repeat {
                    if i > 0 {
                        self.gate()?;
                        self.count_action()?;
                    }
                    self.human_delay()?;
                    self.perform(&InputAction::Key { key: key.clone(), modifiers: modifiers.clone(), action: *action })?;
                }
            }
            StepKind::Type { text, per_char_delay_ms } => {
                let text = self.text(text)?;
                self.perform(&InputAction::Type { text, per_char_delay_ms: *per_char_delay_ms })?;
            }
            StepKind::Wait { ms, jitter_ms } => {
                let jitter = if *jitter_ms > 0 {
                    #[allow(clippy::cast_precision_loss, clippy::cast_possible_truncation, clippy::cast_sign_loss)]
                    let j = (self.random() * (*jitter_ms as f64 + 1.0)).floor() as u64;
                    j
                } else {
                    0
                };
                self.sleep(ms + jitter)?;
            }
            StepKind::WaitFor { condition, poll_ms, timeout_ms } => {
                let deadline = self.now() + timeout_ms;
                loop {
                    if self.holds(condition)? {
                        return Ok(());
                    }
                    if self.now() >= deadline {
                        return Err(Signal::Fail(RunError {
                            step_id: Some(s.id.clone()),
                            path: Some(path.to_owned()),
                            message: format!("condition not met within {timeout_ms} ms"),
                            category: ErrorCategory::Target,
                        }));
                    }
                    self.sleep(*poll_ms)?;
                }
            }
            StepKind::SetVar { name, value } => {
                let v = self.eval(value)?;
                self.set_var(name, v);
            }
            StepKind::Log { message, level } => {
                let message = self.text_with(message, true)?;
                self.emit(RunEvent::Log { level: *level, message, step_id: Some(s.id.clone()), at: self.now() });
            }
            StepKind::Notify { title, body } => {
                let (title, body) = (self.text(title)?, self.text(body)?);
                self.perform(&InputAction::Notify { title, body })?;
            }
            StepKind::Confirm { message, result_var } => {
                let message = self.text(message)?;
                let ok = match self.backend.confirm(&message, &self.shared.control) {
                    Ok(ok) => ok,
                    Err(e) if e.aborted => return Err(Signal::Abort),
                    Err(e) => return Err(Signal::Fail(RunError::new(e.category.unwrap_or(ErrorCategory::Action), e.message))),
                };
                if let Some(var) = result_var {
                    self.set_var(var, Value::Bool(ok));
                } else if !ok {
                    return Err(Signal::Stop("declined".into()));
                }
            }
            StepKind::Clipboard { op, value, var } => {
                if *op == crate::schema::ClipboardOp::Set {
                    let value = self.text(value.as_deref().unwrap_or(""))?;
                    self.perform(&InputAction::ClipboardSet { value })?;
                } else {
                    let v = self.perform(&InputAction::ClipboardGet)?;
                    if let Some(var) = var {
                        let v = if v == Value::Null { Value::Str(String::new()) } else { v };
                        self.set_var(var, v);
                    }
                }
            }
            StepKind::LaunchApp { app, args } => {
                self.perform(&InputAction::LaunchApp { app: app.clone(), args: args.clone() })?;
            }
            StepKind::OpenUrl { url } => {
                let url = self.text(url)?;
                self.perform(&InputAction::OpenUrl { url })?;
            }
            StepKind::Window { op, match_, rect } => {
                self.perform(&InputAction::Window { op: *op, match_: match_.clone(), rect: *rect })?;
            }
            StepKind::AndroidGlobal { action } => {
                self.perform(&InputAction::AndroidGlobal { action: *action })?;
            }
            StepKind::Http { method, url, headers, body, result_var } => {
                let mut h = IndexMap::new();
                for (k, v) in headers {
                    h.insert(k.clone(), self.text(v)?);
                }
                let url = self.text(url)?;
                let body = match body {
                    Some(b) => Some(self.text(b)?),
                    None => None,
                };
                let res = self.perform(&InputAction::Http { method: *method, url, headers: h, body })?;
                if let Some(var) = result_var {
                    self.set_var(var, res);
                }
            }
            StepKind::File { op, path: file_path, dest, content, result_var } => {
                let file_path = self.text(file_path)?;
                let dest = match dest.as_deref() {
                    Some(d) if !d.is_empty() => Some(self.text(d)?),
                    Some(d) => Some(d.to_owned()),
                    None => None,
                };
                let content = match content {
                    Some(c) => Some(self.text(c)?),
                    None => None,
                };
                let res = self.perform(&InputAction::File { op: *op, path: file_path, dest, content })?;
                if let Some(var) = result_var {
                    self.set_var(var, res);
                }
            }
            StepKind::Ocr { region, result_var, display } => {
                let region = match display {
                    Some(r) => place_rect(&self.display(r)?.bounds, region, "display"),
                    None => *region,
                };
                let res = self.perform(&InputAction::Ocr { region })?;
                self.set_var(result_var, Value::Str(res.to_js_string()));
            }
            StepKind::FindImage { target, result_var, timeout_ms } => {
                let (reference, confidence, scoped) = match target {
                    Target::Image(img) => (img.reference.clone(), img.confidence, img.display.is_some()),
                    _ => (String::new(), 0.9, false),
                };
                // The search region is only passed for display-scoped steps (older flows keep searching the whole screen).
                let region = if scoped {
                    match self.place(target)? {
                        Target::Image(img) => img.region,
                        _ => None,
                    }
                } else {
                    None
                };
                let res = self.perform(&InputAction::FindImage { reference, confidence, timeout_ms: *timeout_ms, region })?;
                self.set_var(result_var, res);
            }
            StepKind::PixelCheck { at, color, tolerance, result_var } => {
                let c = self.read_pixel(at)?;
                let v = match color {
                    Some(want) => Value::Bool(color_distance(c, parse_color(want).unwrap_or([0, 0, 0])) <= *tolerance),
                    None => Value::Str(to_hex_color(c)),
                };
                self.set_var(result_var, v);
            }
            StepKind::WaitForPixel { at, color, tolerance, not, poll_ms, timeout_ms } => {
                let deadline = timeout_ms.map(|t| self.now() + t);
                let want = parse_color(color).unwrap_or([0, 0, 0]);
                loop {
                    let matched = color_distance(self.read_pixel(at)?, want) <= *tolerance;
                    if matched != (*not == Some(true)) {
                        return Ok(());
                    }
                    if let Some(d) = deadline {
                        if self.now() >= d {
                            return Err(Signal::Fail(RunError {
                                step_id: Some(s.id.clone()),
                                path: Some(path.to_owned()),
                                message: format!("pixel condition not met within {} ms", timeout_ms.unwrap_or(0)),
                                category: ErrorCategory::Target,
                            }));
                        }
                    }
                    self.sleep(*poll_ms)?;
                }
            }
            StepKind::MatchScene { scenes, min_similarity, result_var, similarity_var } => {
                let names: Vec<String> = match scenes {
                    Some(list) => list.clone(),
                    None => self.flow.scenes.iter().flatten().map(|sc| sc.name.clone()).collect(),
                };
                let (mut best_name, mut best_sim) = (String::new(), -1.0_f64);
                for name in names {
                    let scene = self.scene(&name)?;
                    let sim = self.scene_similarity(&scene)?;
                    if sim > best_sim {
                        best_sim = sim;
                        best_name = name;
                    }
                }
                let result = if best_sim >= *min_similarity { best_name } else { String::new() };
                self.set_var(result_var, Value::Str(result));
                if let Some(var) = similarity_var {
                    self.set_var(var, Value::Num(best_sim.max(0.0)));
                }
            }
            StepKind::SwitchProfile { profile_id } => {
                self.perform(&InputAction::SwitchProfile { profile_id: profile_id.clone() })?;
            }
            StepKind::RunFlow { flow_id } => {
                let max = self.opts.max_call_depth.unwrap_or(8);
                let target = self.opts.resolve_flow.as_ref().and_then(|r| r(flow_id));
                let Some(target) = target else {
                    return Err(Signal::Fail(RunError {
                        step_id: Some(s.id.clone()),
                        path: Some(path.to_owned()),
                        message: format!("flow \"{flow_id}\" not found"),
                        category: ErrorCategory::Validation,
                    }));
                };
                if self.call_depth >= max {
                    return Err(Signal::Fail(RunError {
                        step_id: Some(s.id.clone()),
                        path: Some(path.to_owned()),
                        message: "runFlow nesting too deep".into(),
                        category: ErrorCategory::Limit,
                    }));
                }
                self.call_depth += 1;
                let r = self.run_list(&target.steps, &format!("{path}>{flow_id}"));
                self.call_depth -= 1;
                r?;
            }
            StepKind::Stop { reason } => return Err(Signal::Stop(reason.clone().unwrap_or_else(|| "stop step".into()))),
            StepKind::Break => return Err(Signal::Break),
            StepKind::Continue => return Err(Signal::Continue),
            StepKind::Group { body, .. } => self.run_list(body, path)?,
            StepKind::If { condition, then, else_ } => {
                if self.holds(condition)? {
                    self.run_list(then, &format!("{path}.then"))?;
                } else {
                    self.run_list(else_, &format!("{path}.else"))?;
                }
            }
            StepKind::Loop { mode, count, condition, index_var, cooldown_ms, body } => {
                let body_path = format!("{path}.body");
                let mut i: u64 = 0;
                let mut round_start: u64 = 0;
                loop {
                    if *mode == LoopMode::Count && i >= count.unwrap_or(0) {
                        return Ok(());
                    }
                    if let Some(cd) = cooldown_ms.filter(|c| *c > 0 && i > 0) {
                        let rest = (round_start + cd).saturating_sub(self.now());
                        if rest > 0 {
                            self.sleep(rest)?;
                        }
                    }
                    if *mode == LoopMode::While {
                        let holds = match condition {
                            Some(c) => self.holds(c)?,
                            None => false,
                        };
                        if !holds {
                            return Ok(());
                        }
                    }
                    self.count_iteration()?;
                    round_start = self.now();
                    if let Some(var) = index_var {
                        #[allow(clippy::cast_precision_loss)]
                        self.set_var(var, Value::Num(i as f64));
                    }
                    match self.run_list(body, &body_path) {
                        Ok(()) | Err(Signal::Continue) => {}
                        Err(Signal::Break) => return Ok(()),
                        Err(other) => return Err(other),
                    }
                    i += 1;
                    // A loop whose body never waits would spin; always yield so stop/pause stay responsive.
                    self.gate()?;
                    if body.is_empty() {
                        self.sleep(SLICE_MS)?;
                    }
                }
            }
            StepKind::ForEach { list, item_var, body } => {
                let items = match self.eval(list)? {
                    Value::List(l) => l,
                    other => vec![other],
                };
                let body_path = format!("{path}.body");
                for item in items {
                    self.count_iteration()?;
                    self.set_var(item_var, item);
                    match self.run_list(body, &body_path) {
                        Ok(()) | Err(Signal::Continue) => {}
                        Err(Signal::Break) => return Ok(()),
                        Err(other) => return Err(other),
                    }
                    self.gate()?;
                }
            }
            StepKind::Try { body, catch, error_var } => match self.run_list(body, &format!("{path}.body")) {
                Ok(()) => {}
                Err(Signal::Fail(e)) if !self.shared.control.is_stopped() => {
                    let err = to_run_error(e.clone(), &s.id, path);
                    if err.category == ErrorCategory::Limit {
                        return Err(Signal::Fail(e));
                    }
                    if let Some(var) = error_var {
                        self.set_var(var, Value::Str(err.message));
                    }
                    self.run_list(catch, &format!("{path}.catch"))?;
                }
                Err(Signal::Fail(_)) => return Err(Signal::Abort),
                Err(other) => return Err(other),
            },
        }
        Ok(())
    }

    fn handle_terminal(&mut self, sig: Signal) -> RunResult {
        if self.shared.control.is_stopped() {
            let reason = self.shared.control.lock().stop_reason.clone().unwrap_or_else(|| "user".into());
            return self.finish(RunStatus::Stopped, Some(reason), None);
        }
        match sig {
            Signal::Stop(reason) => self.finish(RunStatus::Stopped, Some(reason), None),
            Signal::Abort => self.finish(RunStatus::Stopped, Some("user".into()), None),
            Signal::Break | Signal::Continue | Signal::Goto(_) => self.finish(RunStatus::Completed, None, None),
            Signal::Fail(err) => {
                self.emit(RunEvent::Error { error: err.clone(), at: self.now() });
                let msg = err.message.clone();
                self.finish(RunStatus::Failed, Some(msg), Some(err))
            }
            Signal::Timeout(_) => {
                let err = RunError::new(ErrorCategory::Timeout, "step timed out");
                self.emit(RunEvent::Error { error: err.clone(), at: self.now() });
                self.finish(RunStatus::Failed, Some(err.message.clone()), Some(err))
            }
        }
    }

    fn finish(&mut self, status: RunStatus, reason: Option<String>, error: Option<RunError>) -> RunResult {
        self.shared.set_state(match status {
            RunStatus::Completed => RunState::Completed,
            RunStatus::Stopped => RunState::Stopped,
            RunStatus::Failed => RunState::Failed,
        });
        let ended_at = self.now();
        RunResult {
            status,
            reason,
            error,
            actions: self.actions,
            iterations: self.iterations,
            steps: self.steps,
            duration_ms: ended_at.saturating_sub(self.started_at),
            vars: self.vars.clone(),
            started_at: self.started_at,
            ended_at,
        }
    }
}

fn default_for(t: VarType) -> Value {
    match t {
        VarType::Number => Value::Num(0.0),
        VarType::Boolean => Value::Bool(false),
        VarType::List => Value::List(Vec::new()),
        VarType::String => Value::Str(String::new()),
    }
}

/// True when any step targets points/regions in `screen` space (`usesScreenCoordinates`).
pub fn uses_screen_coordinates(steps: &[Step]) -> bool {
    let mut uses = false;
    crate::schema::walk_steps(steps, &mut |s, _, _| {
        for t in s.targets() {
            if matches!(t, Target::Point { space: Space::Screen, .. } | Target::Region { space: Space::Screen, .. }) {
                uses = true;
            }
        }
    });
    uses
}

/// Convenience: run a flow to completion on the current thread.
pub fn run_flow(flow: Flow, backend: Box<dyn InputBackend>, opts: RunOptions) -> RunResult {
    FlowRun::new(flow, backend, opts).start()
}
