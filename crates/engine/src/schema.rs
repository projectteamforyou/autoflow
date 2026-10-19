//! AutoFlow automation schema (v1) — mirrors `packages/core/src/schema.ts`.
//!
//! Serde attributes reproduce the zod schema: discriminated unions on `type` / `kind`,
//! camelCase field names and identical defaults, so a JSON document produced by the
//! TypeScript core (for example `packages/core/fixtures/*.json`) round-trips unchanged.
//! [`parse_flow`] additionally enforces every zod constraint (lengths, ranges, regexes,
//! loop refinements, duplicate step ids) and reports issues with zod-style paths.

use crate::value::{utf16_len, Value};
use indexmap::IndexMap;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;

/// Schema version written by this engine.
pub const SCHEMA_VERSION: &str = "1.0";

/// Target platforms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    /// Windows desktop (this engine).
    Windows,
    /// Android (Kotlin executor).
    Android,
    /// Browser sandbox.
    Web,
}

impl Platform {
    /// Lowercase name used in messages (`"windows"`).
    pub fn as_str(self) -> &'static str {
        match self {
            Platform::Windows => "windows",
            Platform::Android => "android",
            Platform::Web => "web",
        }
    }
}

/* ------------------------------------------------------------------ targets */

/// Coordinate space of a point or region.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Space {
    /// Physical screen pixels.
    #[default]
    Screen,
    /// Relative to the matched window.
    Window,
    /// 0..1 of the screen.
    Normalized,
}

/// How a point is picked inside a region.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Pick {
    /// The region's center.
    #[default]
    Center,
    /// A random point (explicit opt-in for testing/accessibility).
    Random,
}

/// Axis-aligned rectangle.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    /// Left.
    pub x: f64,
    /// Top.
    pub y: f64,
    /// Width.
    pub w: f64,
    /// Height.
    pub h: f64,
}

/// UI Automation / accessibility selector.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementSelector {
    /// Process / package name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
    /// Window title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub window: Option<String>,
    /// Accessible name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Control type / role.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    /// Automation id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub automation_id: Option<String>,
    /// Visible text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// Index among matches.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<u32>,
}

/// Image template reference.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ImageTarget {
    /// Locally stored template image id.
    #[serde(rename = "ref")]
    pub reference: String,
    /// Match confidence 0.5..1.
    #[serde(default = "default_confidence")]
    pub confidence: f64,
    /// Optional search region.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<Rect>,
}

fn default_confidence() -> f64 {
    0.9
}

/// Where an input action lands.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Target {
    /// A point.
    Point {
        /// X coordinate.
        x: f64,
        /// Y coordinate.
        y: f64,
        /// Coordinate space.
        #[serde(default)]
        space: Space,
        /// Monitor index (multi-monitor, Windows).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        monitor: Option<u32>,
    },
    /// The current pointer position.
    Current,
    /// A region.
    Region {
        /// Left.
        x: f64,
        /// Top.
        y: f64,
        /// Width (> 0).
        w: f64,
        /// Height (> 0).
        h: f64,
        /// Coordinate space.
        #[serde(default)]
        space: Space,
        /// Center or random point.
        #[serde(default)]
        pick: Pick,
    },
    /// A UI element.
    Element {
        /// Selector.
        selector: ElementSelector,
    },
    /// A template image on screen.
    Image(ImageTarget),
}

/* ------------------------------------------------------------------- errors */

/// Per-step error strategy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ErrorStrategy {
    /// Fail the run.
    #[default]
    Stop,
    /// Log and skip.
    Continue,
    /// Retry with backoff.
    Retry,
    /// Jump to a top-level step.
    Goto,
}

/// Per-step error policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnError {
    /// Strategy.
    #[serde(default)]
    pub strategy: ErrorStrategy,
    /// Retries for `retry` (0..10).
    #[serde(default)]
    pub retries: u32,
    /// Backoff unit in ms; attempt *n* waits `n × backoffMs`.
    #[serde(default = "default_backoff")]
    pub backoff_ms: u64,
    /// Top-level step id for `goto`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub goto_step_id: Option<String>,
}

fn default_backoff() -> u64 {
    500
}

/* -------------------------------------------------------------------- steps */

/// Mouse buttons.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MouseButton {
    /// Left.
    #[default]
    Left,
    /// Right.
    Right,
    /// Middle.
    Middle,
    /// Back (X1).
    X1,
    /// Forward (X2).
    X2,
}

impl MouseButton {
    /// Lowercase name.
    pub fn as_str(self) -> &'static str {
        match self {
            MouseButton::Left => "left",
            MouseButton::Right => "right",
            MouseButton::Middle => "middle",
            MouseButton::X1 => "x1",
            MouseButton::X2 => "x2",
        }
    }
}

/// Keyboard modifiers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Modifier {
    /// Control.
    Ctrl,
    /// Alt.
    Alt,
    /// Shift.
    Shift,
    /// Windows / Command key.
    Meta,
}

impl Modifier {
    /// Lowercase name.
    pub fn as_str(self) -> &'static str {
        match self {
            Modifier::Ctrl => "ctrl",
            Modifier::Alt => "alt",
            Modifier::Shift => "shift",
            Modifier::Meta => "meta",
        }
    }
}

/// Key step action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum KeyAction {
    /// Down + up.
    #[default]
    Press,
    /// Down only.
    Down,
    /// Up only.
    Up,
}

/// Log levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    /// Info.
    #[default]
    Info,
    /// Warning.
    Warn,
    /// Error.
    Error,
}

/// Clipboard operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardOp {
    /// Write text.
    Set,
    /// Read text.
    Get,
}

/// Window operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowOp {
    /// Bring to front.
    Focus,
    /// Minimize.
    Minimize,
    /// Maximize.
    Maximize,
    /// Restore.
    Restore,
    /// Close (WM_CLOSE).
    Close,
    /// Move to rect.x/y.
    Move,
    /// Resize to rect.w/h.
    Resize,
}

/// Window match criteria.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct WindowMatch {
    /// Title substring (case-insensitive).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Process executable name, e.g. `msedge.exe`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<String>,
}

/// Android global actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AndroidAction {
    /// Back.
    Back,
    /// Home.
    Home,
    /// Recents.
    Recents,
    /// Notification shade.
    Notifications,
    /// Quick settings.
    QuickSettings,
    /// Lock screen.
    LockScreen,
    /// Screenshot.
    Screenshot,
    /// Power dialog.
    PowerDialog,
}

/// HTTP methods.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HttpMethod {
    /// GET.
    #[default]
    Get,
    /// POST.
    Post,
    /// PUT.
    Put,
    /// PATCH.
    Patch,
    /// DELETE.
    Delete,
}

impl HttpMethod {
    /// Uppercase name.
    pub fn as_str(self) -> &'static str {
        match self {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Delete => "DELETE",
        }
    }
}

/// File operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileOp {
    /// Read text.
    Read,
    /// Write text.
    Write,
    /// Append text.
    Append,
    /// Copy to dest.
    Copy,
    /// Move to dest.
    Move,
    /// Delete.
    Delete,
    /// Existence check.
    Exists,
}

/// Loop modes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoopMode {
    /// N times.
    Count,
    /// While a condition holds.
    While,
    /// Until stopped or a limit is hit.
    Forever,
}

/// A safe expression wrapper (`{ "expr": "…" }`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Condition {
    /// Expression source.
    pub expr: String,
}

/// One step of a flow: common fields plus the type-specific payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    /// Unique id within the flow (`[A-Za-z0-9_-]`, 1..64).
    pub id: String,
    /// Optional human label.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Disabled steps are skipped.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disabled: Option<bool>,
    /// Debugger breakpoint.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub breakpoint: Option<bool>,
    /// Error policy.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_error: Option<OnError>,
    /// Type-specific payload (`type` discriminator).
    #[serde(flatten)]
    pub kind: StepKind,
}

impl Step {
    /// True when the step is disabled.
    pub fn is_disabled(&self) -> bool {
        self.disabled == Some(true)
    }

    /// The `type` discriminator, e.g. `"click"`.
    pub fn type_name(&self) -> &'static str {
        self.kind.type_name()
    }

    /// Nested step lists (then/else, body, catch).
    pub fn child_lists(&self) -> Vec<&[Step]> {
        match &self.kind {
            StepKind::If { then, else_, .. } => vec![then, else_],
            StepKind::Loop { body, .. } | StepKind::ForEach { body, .. } | StepKind::Group { body, .. } => vec![body],
            StepKind::Try { body, catch, .. } => vec![body, catch],
            _ => Vec::new(),
        }
    }

    /// Targets referenced by the step (`target`, plus `from`/`to` for drags).
    pub fn targets(&self) -> Vec<&Target> {
        match &self.kind {
            StepKind::Click { target, .. } | StepKind::Move { target, .. } | StepKind::FindImage { target, .. } => vec![target],
            StepKind::Scroll { target, .. } => target.iter().collect(),
            StepKind::Drag { from, to, .. } => vec![from, to],
            _ => Vec::new(),
        }
    }
}

/// Type-specific step payloads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[allow(missing_docs)]
pub enum StepKind {
    Click {
        target: Target,
        #[serde(default)]
        button: MouseButton,
        #[serde(default = "one_u32")]
        clicks: u32,
        #[serde(default)]
        hold_ms: u64,
        #[serde(default)]
        modifiers: Vec<Modifier>,
    },
    Move {
        target: Target,
        #[serde(default)]
        duration_ms: u64,
    },
    Drag {
        from: Target,
        to: Target,
        #[serde(default = "default_drag_ms")]
        duration_ms: u64,
        #[serde(default)]
        button: MouseButton,
    },
    Scroll {
        #[serde(default)]
        dx: i64,
        #[serde(default)]
        dy: i64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        target: Option<Target>,
    },
    Key {
        key: String,
        #[serde(default)]
        modifiers: Vec<Modifier>,
        #[serde(default)]
        action: KeyAction,
        #[serde(default = "one_u32")]
        repeat: u32,
    },
    Type {
        text: String,
        #[serde(default)]
        per_char_delay_ms: u64,
    },
    Wait {
        ms: u64,
        #[serde(default)]
        jitter_ms: u64,
    },
    WaitFor {
        condition: Condition,
        #[serde(default = "default_poll_ms")]
        poll_ms: u64,
        #[serde(default = "default_wait_timeout")]
        timeout_ms: u64,
    },
    SetVar {
        name: String,
        value: String,
    },
    Log {
        message: String,
        #[serde(default)]
        level: LogLevel,
    },
    Notify {
        title: String,
        #[serde(default)]
        body: String,
    },
    Confirm {
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result_var: Option<String>,
    },
    Clipboard {
        op: ClipboardOp,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        var: Option<String>,
    },
    LaunchApp {
        app: String,
        #[serde(default)]
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
        action: AndroidAction,
    },
    Http {
        #[serde(default)]
        method: HttpMethod,
        url: String,
        #[serde(default)]
        headers: IndexMap<String, String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        body: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result_var: Option<String>,
    },
    File {
        op: FileOp,
        path: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        dest: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result_var: Option<String>,
    },
    Ocr {
        region: Rect,
        result_var: String,
    },
    FindImage {
        target: Target,
        result_var: String,
        #[serde(default = "default_find_timeout")]
        timeout_ms: u64,
    },
    RunFlow {
        flow_id: String,
    },
    SwitchProfile {
        profile_id: String,
    },
    Stop {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Break,
    Continue,
    If {
        condition: Condition,
        #[serde(default)]
        then: Vec<Step>,
        #[serde(default, rename = "else")]
        else_: Vec<Step>,
    },
    Loop {
        mode: LoopMode,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        count: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        condition: Option<Condition>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        index_var: Option<String>,
        #[serde(default)]
        body: Vec<Step>,
    },
    ForEach {
        list: String,
        item_var: String,
        #[serde(default)]
        body: Vec<Step>,
    },
    Try {
        #[serde(default)]
        body: Vec<Step>,
        #[serde(default)]
        catch: Vec<Step>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error_var: Option<String>,
    },
    Group {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        collapsed: Option<bool>,
        #[serde(default)]
        body: Vec<Step>,
    },
}

fn one_u32() -> u32 {
    1
}
fn default_drag_ms() -> u64 {
    300
}
fn default_poll_ms() -> u64 {
    250
}
fn default_wait_timeout() -> u64 {
    10_000
}
fn default_find_timeout() -> u64 {
    5000
}

impl StepKind {
    /// The `type` discriminator.
    pub fn type_name(&self) -> &'static str {
        match self {
            StepKind::Click { .. } => "click",
            StepKind::Move { .. } => "move",
            StepKind::Drag { .. } => "drag",
            StepKind::Scroll { .. } => "scroll",
            StepKind::Key { .. } => "key",
            StepKind::Type { .. } => "type",
            StepKind::Wait { .. } => "wait",
            StepKind::WaitFor { .. } => "waitFor",
            StepKind::SetVar { .. } => "setVar",
            StepKind::Log { .. } => "log",
            StepKind::Notify { .. } => "notify",
            StepKind::Confirm { .. } => "confirm",
            StepKind::Clipboard { .. } => "clipboard",
            StepKind::LaunchApp { .. } => "launchApp",
            StepKind::OpenUrl { .. } => "openUrl",
            StepKind::Window { .. } => "window",
            StepKind::AndroidGlobal { .. } => "androidGlobal",
            StepKind::Http { .. } => "http",
            StepKind::File { .. } => "file",
            StepKind::Ocr { .. } => "ocr",
            StepKind::FindImage { .. } => "findImage",
            StepKind::RunFlow { .. } => "runFlow",
            StepKind::SwitchProfile { .. } => "switchProfile",
            StepKind::Stop { .. } => "stop",
            StepKind::Break => "break",
            StepKind::Continue => "continue",
            StepKind::If { .. } => "if",
            StepKind::Loop { .. } => "loop",
            StepKind::ForEach { .. } => "forEach",
            StepKind::Try { .. } => "try",
            StepKind::Group { .. } => "group",
        }
    }
}

/* ----------------------------------------------------------------- triggers */

/// A key combination.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Hotkey {
    /// W3C key name.
    pub key: String,
    /// Modifiers.
    #[serde(default)]
    pub modifiers: Vec<Modifier>,
}

impl Hotkey {
    /// `hotkeyToString()` from engine.ts, e.g. `Ctrl+Alt+Escape`.
    pub fn to_display_string(&self) -> String {
        let mut mods = self.modifiers.clone();
        mods.sort();
        let mut parts: Vec<String> = mods
            .iter()
            .map(|m| {
                let s = m.as_str();
                let mut c = s.chars();
                c.next().map_or_else(String::new, |f| f.to_uppercase().collect::<String>() + c.as_str())
            })
            .collect();
        let key = if utf16_len(&self.key) == 1 { self.key.to_uppercase() } else { self.key.clone() };
        parts.push(key);
        parts.join("+")
    }
}

/// Hotkey scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HotkeyScope {
    /// Everywhere.
    #[default]
    Global,
    /// Only while `app` is focused.
    App,
}

/// What starts a flow.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[allow(missing_docs)]
pub enum Trigger {
    Manual,
    Hotkey {
        hotkey: Hotkey,
        #[serde(default)]
        scope: HotkeyScope,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        app: Option<String>,
    },
    Schedule {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cron: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        every_ms: Option<u64>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        start_at: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        end_at: Option<String>,
    },
    AppEvent {
        event: AppEventKind,
        app: String,
    },
    DeviceEvent {
        event: DeviceEventKind,
    },
    Location {
        lat: f64,
        lng: f64,
        radius_m: f64,
        on: GeofenceEdge,
    },
    Notification {
        app: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        contains: Option<String>,
    },
}

impl Trigger {
    /// The `type` discriminator.
    pub fn type_name(&self) -> &'static str {
        match self {
            Trigger::Manual => "manual",
            Trigger::Hotkey { .. } => "hotkey",
            Trigger::Schedule { .. } => "schedule",
            Trigger::AppEvent { .. } => "appEvent",
            Trigger::DeviceEvent { .. } => "deviceEvent",
            Trigger::Location { .. } => "location",
            Trigger::Notification { .. } => "notification",
        }
    }
}

/// App lifecycle events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum AppEventKind {
    Launched,
    Closed,
    Focused,
}

/// Device events.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum DeviceEventKind {
    Charging,
    BatteryLow,
    WifiConnected,
    WifiDisconnected,
    BluetoothConnected,
    HeadsetPlugged,
    BootCompleted,
    DeviceConnected,
    DeviceDisconnected,
}

/// Geofence edge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum GeofenceEdge {
    Enter,
    Exit,
}

/* ------------------------------------------------------------------- limits */

/// Guardrails enforced on every run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    /// Hard wall-clock limit for one run.
    #[serde(default = "default_max_duration")]
    pub max_duration_ms: u64,
    /// Upper bound on input actions per run.
    #[serde(default = "default_max_actions")]
    pub max_actions: u64,
    /// Upper bound on loop iterations per run.
    #[serde(default = "default_max_iterations")]
    pub max_iterations: u64,
    /// Visible countdown before the first input action.
    #[serde(default = "default_countdown")]
    pub countdown_ms: u64,
    /// Skip a new trigger while this flow is already running.
    #[serde(default = "default_true")]
    pub prevent_overlap: bool,
    /// Minimum time between two trigger-initiated runs.
    #[serde(default)]
    pub cooldown_ms: u64,
}

fn default_max_duration() -> u64 {
    600_000
}
fn default_max_actions() -> u64 {
    100_000
}
fn default_max_iterations() -> u64 {
    1_000_000
}
fn default_countdown() -> u64 {
    3000
}
fn default_true() -> bool {
    true
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_duration_ms: default_max_duration(),
            max_actions: default_max_actions(),
            max_iterations: default_max_iterations(),
            countdown_ms: default_countdown(),
            prevent_overlap: true,
            cooldown_ms: 0,
        }
    }
}

/// Variable types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum VarType {
    #[default]
    String,
    Number,
    Boolean,
    List,
}

/// Declared flow variable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct VariableDef {
    /// Name.
    pub name: String,
    /// Type.
    #[serde(rename = "type", default)]
    pub var_type: VarType,
    /// Initial value.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub initial: Option<Value>,
    /// Ask the user before the run.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
}

/// Start / pause / stop hotkeys of a flow.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FlowHotkeys {
    /// Start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub start: Option<Hotkey>,
    /// Pause / resume.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pause: Option<Hotkey>,
    /// Stop (default Ctrl+Alt+Escape).
    #[serde(default = "default_stop_hotkey")]
    pub stop: Hotkey,
}

/// The default emergency stop: Ctrl+Alt+Escape.
pub fn default_stop_hotkey() -> Hotkey {
    Hotkey { key: "Escape".into(), modifiers: vec![Modifier::Ctrl, Modifier::Alt] }
}

impl Default for FlowHotkeys {
    fn default() -> Self {
        Self { start: None, pause: None, stop: default_stop_hotkey() }
    }
}

/// Recorded screen geometry.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ScreenRef {
    /// Width in px.
    pub width: u32,
    /// Height in px.
    pub height: u32,
    /// Scale factor.
    #[serde(default = "default_scale")]
    pub scale: f64,
}

fn default_scale() -> f64 {
    1.0
}

/// Easy / Pro editing mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum FlowMode {
    #[default]
    Easy,
    Pro,
}

/// One automation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Flow {
    /// Always `"1.0"`.
    pub schema_version: String,
    /// Flow id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Description.
    #[serde(default)]
    pub description: String,
    /// Tags.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Icon name.
    #[serde(default = "default_icon")]
    pub icon: String,
    /// `#RRGGBB`.
    #[serde(default = "default_color")]
    pub color: String,
    /// Target platforms.
    #[serde(default = "default_targets")]
    pub targets: Vec<Platform>,
    /// Editing mode.
    #[serde(default)]
    pub mode: FlowMode,
    /// Trigger.
    #[serde(default = "default_trigger")]
    pub trigger: Trigger,
    /// Run hotkeys.
    #[serde(default)]
    pub hotkeys: FlowHotkeys,
    /// Guardrails.
    #[serde(default)]
    pub limits: Limits,
    /// Declared variables.
    #[serde(default)]
    pub variables: Vec<VariableDef>,
    /// Steps.
    pub steps: Vec<Step>,
    /// Screen geometry at recording time.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen: Option<ScreenRef>,
    /// Favorite flag.
    #[serde(default)]
    pub favorite: bool,
    /// Folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folder: Option<String>,
    /// ISO-8601 UTC timestamp.
    pub created_at: String,
    /// ISO-8601 UTC timestamp.
    pub updated_at: String,
    /// Monotonic edit counter.
    #[serde(default)]
    pub revision: u64,
}

fn default_icon() -> String {
    "bolt".into()
}
fn default_color() -> String {
    "#7C5CFF".into()
}
fn default_targets() -> Vec<Platform> {
    vec![Platform::Windows, Platform::Android, Platform::Web]
}
fn default_trigger() -> Trigger {
    Trigger::Manual
}

/* --------------------------------------------------------------- utilities */

/// Depth-first walk over every step, including nested ones (`walkSteps`).
pub fn walk_steps<'a>(list: &'a [Step], visit: &mut dyn FnMut(&'a Step, usize, Option<&'a Step>)) {
    fn go<'a>(list: &'a [Step], visit: &mut dyn FnMut(&'a Step, usize, Option<&'a Step>), depth: usize, parent: Option<&'a Step>) {
        for s in list {
            visit(s, depth, parent);
            for child in s.child_lists() {
                go(child, visit, depth + 1, Some(s));
            }
        }
    }
    go(list, visit, 0, None);
}

/// Number of steps including nested ones.
pub fn count_steps(list: &[Step]) -> usize {
    let mut n = 0;
    walk_steps(list, &mut |_, _, _| n += 1);
    n
}

/// Step ids that occur more than once, in walk order.
pub fn find_duplicate_ids(list: &[Step]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut dup: Vec<String> = Vec::new();
    walk_steps(list, &mut |s, _, _| {
        if !seen.insert(s.id.as_str()) && !dup.iter().any(|d| d == &s.id) {
            dup.push(s.id.clone());
        }
    });
    dup
}

/// Finds a step by id anywhere in the tree.
pub fn find_step<'a>(list: &'a [Step], step_id: &str) -> Option<&'a Step> {
    let mut found = None;
    walk_steps(list, &mut |s, _, _| {
        if found.is_none() && s.id == step_id {
            found = Some(s);
        }
    });
    found
}

/* -------------------------------------------------------------- validation */

/// One schema violation with a zod-style dotted path (`steps.0.target.x`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ValidationIssue {
    /// Dotted path.
    pub path: String,
    /// Message.
    pub message: String,
}

impl std::fmt::Display for ValidationIssue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        if self.path.is_empty() {
            f.write_str(&self.message)
        } else {
            write!(f, "{}: {}", self.path, self.message)
        }
    }
}

/// Rewrites integral floating-point JSON numbers (`3.0`, `1e3`) as integers so integer
/// fields accept every number JavaScript considers an integer.
pub fn normalize_numbers(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::Number(n) => {
            if n.is_f64() {
                if let Some(f) = n.as_f64() {
                    if f.fract() == 0.0 && f.abs() < 9.0e15 {
                        #[allow(clippy::cast_possible_truncation)]
                        let i = f as i64;
                        *v = serde_json::Value::from(i);
                    }
                }
            }
        }
        serde_json::Value::Array(a) => a.iter_mut().for_each(normalize_numbers),
        serde_json::Value::Object(o) => o.values_mut().for_each(normalize_numbers),
        _ => {}
    }
}

fn serde_issue<E: std::fmt::Display>(err: &serde_path_to_error::Error<E>) -> ValidationIssue {
    use serde_path_to_error::Segment;
    let path = err
        .path()
        .iter()
        .filter_map(|seg| match seg {
            Segment::Seq { index } => Some(index.to_string()),
            Segment::Map { key } => Some(key.clone()),
            Segment::Enum { variant } => Some(variant.clone()),
            Segment::Unknown => None,
        })
        .collect::<Vec<_>>()
        .join(".");
    ValidationIssue { path, message: err.inner().to_string() }
}

/// Parses and validates a flow document (`parseFlow`).
pub fn parse_flow(data: &serde_json::Value) -> Result<Flow, Vec<ValidationIssue>> {
    let mut data = data.clone();
    normalize_numbers(&mut data);
    let flow: Flow = serde_path_to_error::deserialize(data).map_err(|e| vec![serde_issue(&e)])?;
    let issues = validate_flow(&flow);
    if !issues.is_empty() {
        return Err(issues);
    }
    let dup = find_duplicate_ids(&flow.steps);
    if !dup.is_empty() {
        return Err(dup
            .into_iter()
            .map(|d| ValidationIssue { path: "steps".into(), message: format!("duplicate step id \"{d}\"") })
            .collect());
    }
    Ok(flow)
}

/// Parses a flow from JSON text.
pub fn parse_flow_str(json: &str) -> Result<Flow, Vec<ValidationIssue>> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|e| vec![ValidationIssue { path: String::new(), message: format!("invalid JSON: {e}") }])?;
    parse_flow(&v)
}

fn re(pattern: &'static str, cell: &'static OnceLock<Regex>) -> &'static Regex {
    #[allow(clippy::unwrap_used)] // constant patterns, exercised by tests
    cell.get_or_init(|| Regex::new(pattern).unwrap())
}

fn id_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"^[A-Za-z0-9_-]+$", &R)
}
fn var_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"^[A-Za-z_][A-Za-z0-9_]*$", &R)
}
fn color_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"^#[0-9a-fA-F]{6}$", &R)
}
fn datetime_re() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    re(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$", &R)
}

/// Collects zod-equivalent constraint violations.
#[derive(Default)]
pub(crate) struct Validator {
    pub(crate) issues: Vec<ValidationIssue>,
}

impl Validator {
    pub(crate) fn issue(&mut self, path: &str, message: impl Into<String>) {
        self.issues.push(ValidationIssue { path: path.to_owned(), message: message.into() });
    }
    pub(crate) fn len(&mut self, path: &str, s: &str, min: usize, max: usize) -> bool {
        let n = utf16_len(s);
        if n < min {
            self.issue(path, format!("String must contain at least {min} character(s)"));
            return false;
        }
        if n > max {
            self.issue(path, format!("String must contain at most {max} character(s)"));
            return false;
        }
        true
    }
    pub(crate) fn max(&mut self, path: &str, s: &str, max: usize) {
        self.len(path, s, 0, max);
    }
    pub(crate) fn opt_max(&mut self, path: &str, s: Option<&String>, max: usize) {
        if let Some(s) = s {
            self.max(path, s, max);
        }
    }
    pub(crate) fn id(&mut self, path: &str, s: &str) {
        if self.len(path, s, 1, 64) && !id_re().is_match(s) {
            self.issue(path, "id must be [A-Za-z0-9_-]");
        }
    }
    pub(crate) fn plain_id(&mut self, path: &str, s: &str) {
        if self.len(path, s, 1, 64) && !id_re().is_match(s) {
            self.issue(path, "Invalid");
        }
    }
    pub(crate) fn var_name(&mut self, path: &str, s: &str) {
        if self.len(path, s, 1, 48) && !var_re().is_match(s) {
            self.issue(path, "invalid variable name");
        }
    }
    pub(crate) fn opt_var(&mut self, path: &str, s: Option<&String>) {
        if let Some(s) = s {
            self.var_name(path, s);
        }
    }
    pub(crate) fn range_u(&mut self, path: &str, n: u64, min: u64, max: u64) {
        if n < min {
            self.issue(path, format!("Number must be greater than or equal to {min}"));
        } else if n > max {
            self.issue(path, format!("Number must be less than or equal to {max}"));
        }
    }
    pub(crate) fn range_i(&mut self, path: &str, n: i64, min: i64, max: i64) {
        if n < min {
            self.issue(path, format!("Number must be greater than or equal to {min}"));
        } else if n > max {
            self.issue(path, format!("Number must be less than or equal to {max}"));
        }
    }
    pub(crate) fn range_f(&mut self, path: &str, n: f64, min: f64, max: f64) {
        if n.is_nan() || n < min {
            self.issue(path, format!("Number must be greater than or equal to {}", crate::value::js_number_to_string(min)));
        } else if n > max {
            self.issue(path, format!("Number must be less than or equal to {}", crate::value::js_number_to_string(max)));
        }
    }
    pub(crate) fn finite(&mut self, path: &str, n: f64) {
        if !n.is_finite() {
            self.issue(path, "Expected number, received nan");
        }
    }
    pub(crate) fn positive(&mut self, path: &str, n: f64) {
        if n.is_nan() || n <= 0.0 {
            self.issue(path, "Number must be greater than 0");
        }
    }
    pub(crate) fn ms(&mut self, path: &str, n: u64) {
        self.range_u(path, n, 0, 86_400_000);
    }
    pub(crate) fn arr_max(&mut self, path: &str, n: usize, max: usize) {
        if n > max {
            self.issue(path, format!("Array must contain at most {max} element(s)"));
        }
    }
    pub(crate) fn arr_min(&mut self, path: &str, n: usize, min: usize) {
        if n < min {
            self.issue(path, format!("Array must contain at least {min} element(s)"));
        }
    }
    pub(crate) fn url(&mut self, path: &str, s: &str) {
        self.max(path, s, 2048);
        if url::Url::parse(s).is_err() {
            self.issue(path, "Invalid url");
        }
    }
    pub(crate) fn datetime(&mut self, path: &str, s: &str) {
        if !datetime_re().is_match(s) || chrono::DateTime::parse_from_rfc3339(s).is_err() {
            self.issue(path, "Invalid datetime");
        }
    }
    pub(crate) fn hotkey(&mut self, path: &str, h: &Hotkey) {
        self.len(&format!("{path}.key"), &h.key, 1, 32);
        self.arr_max(&format!("{path}.modifiers"), h.modifiers.len(), 4);
    }
    fn rect(&mut self, path: &str, r: &Rect) {
        for (k, v) in [("x", r.x), ("y", r.y), ("w", r.w), ("h", r.h)] {
            self.finite(&format!("{path}.{k}"), v);
        }
    }

    fn target(&mut self, path: &str, t: &Target) {
        match t {
            Target::Point { x, y, monitor, .. } => {
                self.finite(&format!("{path}.x"), *x);
                self.finite(&format!("{path}.y"), *y);
                if let Some(m) = monitor {
                    self.range_u(&format!("{path}.monitor"), u64::from(*m), 0, 16);
                }
            }
            Target::Current => {}
            Target::Region { x, y, w, h, .. } => {
                self.finite(&format!("{path}.x"), *x);
                self.finite(&format!("{path}.y"), *y);
                self.positive(&format!("{path}.w"), *w);
                self.positive(&format!("{path}.h"), *h);
            }
            Target::Element { selector } => {
                let p = format!("{path}.selector");
                for (k, v, max) in [
                    ("app", &selector.app, 260),
                    ("window", &selector.window, 260),
                    ("name", &selector.name, 260),
                    ("role", &selector.role, 64),
                    ("automationId", &selector.automation_id, 260),
                    ("text", &selector.text, 260),
                ] {
                    self.opt_max(&format!("{p}.{k}"), v.as_ref(), max);
                }
                if let Some(i) = selector.index {
                    self.range_u(&format!("{p}.index"), u64::from(i), 0, 999);
                }
            }
            Target::Image(img) => self.image(path, img),
        }
    }

    fn image(&mut self, path: &str, img: &ImageTarget) {
        self.max(&format!("{path}.ref"), &img.reference, 200);
        self.range_f(&format!("{path}.confidence"), img.confidence, 0.5, 1.0);
        if let Some(r) = &img.region {
            self.rect(&format!("{path}.region"), r);
        }
    }

    fn steps(&mut self, path: &str, list: &[Step]) {
        self.arr_max(path, list.len(), 2000);
        for (i, s) in list.iter().enumerate() {
            self.step(&format!("{path}.{i}"), s);
        }
    }

    fn expr(&mut self, path: &str, s: &str) {
        self.max(path, s, 2000);
    }

    #[allow(clippy::too_many_lines)]
    fn step(&mut self, p: &str, s: &Step) {
        self.id(&format!("{p}.id"), &s.id);
        self.opt_max(&format!("{p}.label"), s.label.as_ref(), 120);
        if let Some(oe) = &s.on_error {
            self.range_u(&format!("{p}.onError.retries"), u64::from(oe.retries), 0, 10);
            self.ms(&format!("{p}.onError.backoffMs"), oe.backoff_ms);
            if let Some(g) = &oe.goto_step_id {
                self.id(&format!("{p}.onError.gotoStepId"), g);
            }
        }
        let f = |k: &str| format!("{p}.{k}");
        match &s.kind {
            StepKind::Click { target, clicks, hold_ms, modifiers, .. } => {
                self.target(&f("target"), target);
                self.range_u(&f("clicks"), u64::from(*clicks), 1, 3);
                self.ms(&f("holdMs"), *hold_ms);
                self.arr_max(&f("modifiers"), modifiers.len(), 4);
            }
            StepKind::Move { target, duration_ms } => {
                self.target(&f("target"), target);
                self.ms(&f("durationMs"), *duration_ms);
            }
            StepKind::Drag { from, to, duration_ms, .. } => {
                self.target(&f("from"), from);
                self.target(&f("to"), to);
                self.ms(&f("durationMs"), *duration_ms);
            }
            StepKind::Scroll { dx, dy, target } => {
                self.range_i(&f("dx"), *dx, -10_000, 10_000);
                self.range_i(&f("dy"), *dy, -10_000, 10_000);
                if let Some(t) = target {
                    self.target(&f("target"), t);
                }
            }
            StepKind::Key { key, modifiers, repeat, .. } => {
                self.len(&f("key"), key, 1, 32);
                self.arr_max(&f("modifiers"), modifiers.len(), 4);
                self.range_u(&f("repeat"), u64::from(*repeat), 1, 1000);
            }
            StepKind::Type { text, per_char_delay_ms } => {
                self.max(&f("text"), text, 10_000);
                self.ms(&f("perCharDelayMs"), *per_char_delay_ms);
            }
            StepKind::Wait { ms, jitter_ms } => {
                self.ms(&f("ms"), *ms);
                self.ms(&f("jitterMs"), *jitter_ms);
            }
            StepKind::WaitFor { condition, poll_ms, timeout_ms } => {
                self.expr(&f("condition.expr"), &condition.expr);
                self.range_u(&f("pollMs"), *poll_ms, 50, 60_000);
                self.ms(&f("timeoutMs"), *timeout_ms);
            }
            StepKind::SetVar { name, value } => {
                self.var_name(&f("name"), name);
                self.expr(&f("value"), value);
            }
            StepKind::Log { message, .. } => self.max(&f("message"), message, 2000),
            StepKind::Notify { title, body } => {
                self.max(&f("title"), title, 120);
                self.max(&f("body"), body, 1000);
            }
            StepKind::Confirm { message, result_var } => {
                self.max(&f("message"), message, 500);
                self.opt_var(&f("resultVar"), result_var.as_ref());
            }
            StepKind::Clipboard { value, var, .. } => {
                self.opt_max(&f("value"), value.as_ref(), 10_000);
                self.opt_var(&f("var"), var.as_ref());
            }
            StepKind::LaunchApp { app, args } => {
                self.len(&f("app"), app, 1, 260);
                self.arr_max(&f("args"), args.len(), 16);
                for (i, a) in args.iter().enumerate() {
                    self.max(&format!("{p}.args.{i}"), a, 260);
                }
            }
            StepKind::OpenUrl { url } => self.url(&f("url"), url),
            StepKind::Window { match_, rect, .. } => {
                self.opt_max(&f("match.title"), match_.title.as_ref(), 260);
                self.opt_max(&f("match.app"), match_.app.as_ref(), 260);
                if let Some(r) = rect {
                    self.rect(&f("rect"), r);
                }
            }
            StepKind::AndroidGlobal { .. } | StepKind::Break | StepKind::Continue => {}
            StepKind::Http { url, headers, body, result_var, .. } => {
                self.url(&f("url"), url);
                for (k, v) in headers {
                    self.max(&format!("{p}.headers.{k}"), v, 2000);
                }
                self.opt_max(&f("body"), body.as_ref(), 100_000);
                self.opt_var(&f("resultVar"), result_var.as_ref());
            }
            StepKind::File { path, dest, content, result_var, .. } => {
                self.max(&f("path"), path, 1024);
                self.opt_max(&f("dest"), dest.as_ref(), 1024);
                self.opt_max(&f("content"), content.as_ref(), 1_000_000);
                self.opt_var(&f("resultVar"), result_var.as_ref());
            }
            StepKind::Ocr { region, result_var } => {
                self.rect(&f("region"), region);
                self.var_name(&f("resultVar"), result_var);
            }
            StepKind::FindImage { target, result_var, timeout_ms } => {
                match target {
                    Target::Image(img) => self.image(&f("target"), img),
                    _ => self.issue(&f("target.kind"), "Invalid literal value, expected \"image\""),
                }
                self.var_name(&f("resultVar"), result_var);
                self.ms(&f("timeoutMs"), *timeout_ms);
            }
            StepKind::RunFlow { flow_id } => self.id(&f("flowId"), flow_id),
            StepKind::SwitchProfile { profile_id } => self.id(&f("profileId"), profile_id),
            StepKind::Stop { reason } => self.opt_max(&f("reason"), reason.as_ref(), 200),
            StepKind::If { condition, then, else_ } => {
                self.expr(&f("condition.expr"), &condition.expr);
                self.steps(&f("then"), then);
                self.steps(&f("else"), else_);
            }
            StepKind::Loop { mode, count, condition, index_var, body } => {
                if let Some(c) = count {
                    self.range_u(&f("count"), *c, 1, 10_000_000);
                }
                if let Some(c) = condition {
                    self.expr(&f("condition.expr"), &c.expr);
                }
                self.opt_var(&f("indexVar"), index_var.as_ref());
                self.steps(&f("body"), body);
                if *mode == LoopMode::Count && count.is_none() {
                    self.issue(p, "loop.count required for mode=count");
                }
                if *mode == LoopMode::While && condition.is_none() {
                    self.issue(p, "loop.condition required for mode=while");
                }
            }
            StepKind::ForEach { list, item_var, body } => {
                self.expr(&f("list"), list);
                self.var_name(&f("itemVar"), item_var);
                self.steps(&f("body"), body);
            }
            StepKind::Try { body, catch, error_var } => {
                self.steps(&f("body"), body);
                self.steps(&f("catch"), catch);
                self.opt_var(&f("errorVar"), error_var.as_ref());
            }
            StepKind::Group { name, body, .. } => {
                self.max(&f("name"), name, 120);
                self.steps(&f("body"), body);
            }
        }
    }

    fn trigger(&mut self, t: &Trigger) {
        match t {
            Trigger::Manual => {}
            Trigger::Hotkey { hotkey, app, .. } => {
                self.hotkey("trigger.hotkey", hotkey);
                self.opt_max("trigger.app", app.as_ref(), 260);
            }
            Trigger::Schedule { cron, every_ms, start_at, end_at } => {
                self.opt_max("trigger.cron", cron.as_ref(), 120);
                if let Some(e) = every_ms {
                    self.range_u("trigger.everyMs", *e, 60_000, u64::MAX);
                }
                if let Some(s) = start_at {
                    self.datetime("trigger.startAt", s);
                }
                if let Some(s) = end_at {
                    self.datetime("trigger.endAt", s);
                }
            }
            Trigger::AppEvent { app, .. } => self.max("trigger.app", app, 260),
            Trigger::DeviceEvent { .. } => {}
            Trigger::Location { lat, lng, radius_m, .. } => {
                self.range_f("trigger.lat", *lat, -90.0, 90.0);
                self.range_f("trigger.lng", *lng, -180.0, 180.0);
                self.range_f("trigger.radiusM", *radius_m, 50.0, 50_000.0);
            }
            Trigger::Notification { app, contains } => {
                self.max("trigger.app", app, 260);
                self.opt_max("trigger.contains", contains.as_ref(), 200);
            }
        }
    }
}

/// Checks every zod constraint that serde's typing does not already enforce.
pub fn validate_flow(flow: &Flow) -> Vec<ValidationIssue> {
    let mut v = Validator::default();
    if flow.schema_version != SCHEMA_VERSION {
        v.issue("schemaVersion", format!("Invalid literal value, expected \"{SCHEMA_VERSION}\""));
    }
    v.id("id", &flow.id);
    v.len("name", &flow.name, 1, 120);
    v.max("description", &flow.description, 4000);
    v.arr_max("tags", flow.tags.len(), 20);
    for (i, t) in flow.tags.iter().enumerate() {
        v.max(&format!("tags.{i}"), t, 32);
    }
    v.max("icon", &flow.icon, 32);
    if !color_re().is_match(&flow.color) {
        v.issue("color", "Invalid");
    }
    v.arr_min("targets", flow.targets.len(), 1);
    v.trigger(&flow.trigger);
    if let Some(h) = &flow.hotkeys.start {
        v.hotkey("hotkeys.start", h);
    }
    if let Some(h) = &flow.hotkeys.pause {
        v.hotkey("hotkeys.pause", h);
    }
    v.hotkey("hotkeys.stop", &flow.hotkeys.stop);
    let l = &flow.limits;
    v.range_u("limits.maxDurationMs", l.max_duration_ms, 1000, 7 * 86_400_000);
    v.range_u("limits.maxActions", l.max_actions, 1, 100_000_000);
    v.range_u("limits.maxIterations", l.max_iterations, 1, 100_000_000);
    v.range_u("limits.countdownMs", l.countdown_ms, 0, 60_000);
    v.ms("limits.cooldownMs", l.cooldown_ms);
    v.arr_max("variables", flow.variables.len(), 200);
    for (i, var) in flow.variables.iter().enumerate() {
        v.var_name(&format!("variables.{i}.name"), &var.name);
        v.opt_max(&format!("variables.{i}.prompt"), var.prompt.as_ref(), 200);
        if let Some(init) = &var.initial {
            let ok = match init {
                Value::Str(_) | Value::Num(_) | Value::Bool(_) => true,
                Value::List(items) => items.iter().all(|x| matches!(x, Value::Str(_) | Value::Num(_))),
                Value::Null => false,
            };
            if !ok {
                v.issue(&format!("variables.{i}.initial"), "Invalid input");
            }
        }
    }
    v.steps("steps", &flow.steps);
    if let Some(s) = &flow.screen {
        if s.width == 0 {
            v.issue("screen.width", "Number must be greater than 0");
        }
        if s.height == 0 {
            v.issue("screen.height", "Number must be greater than 0");
        }
        v.positive("screen.scale", s.scale);
    }
    v.opt_max("folder", flow.folder.as_ref(), 120);
    v.datetime("createdAt", &flow.created_at);
    v.datetime("updatedAt", &flow.updated_at);
    v.issues
}
