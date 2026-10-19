//! # autoflow_engine
//!
//! Native executor for AutoFlow flows. The TypeScript package `@autoflow/core` is the single
//! source of truth; this crate parses the exact same JSON and behaves the same:
//!
//! - [`schema`] — serde types mirroring the zod Flow schema, plus validation ([`parse_flow`]).
//! - [`expr`] — the safe expression language (`{{ }}` interpolation, secrets, limits).
//! - [`engine`] — the interpreter ([`FlowRun`]) with limits, pause/resume/stop, breakpoints,
//!   error policies, `runFlow`, risk approval and unsupported-step preflight.
//! - [`mock`] — a virtual-screen [`InputBackend`] for tests and dry runs.
//! - [`bridge`], [`input_profile`], [`record`] — types shared with the web app over the
//!   native bridge (`packages/core/src/bridge.ts`).
//! - [`remap`] — the platform-independent Keyforge remapping state machine.
//! - [`schedule`] — cron / interval evaluation for schedule triggers.
//! - [`actions`] — file and HTTP actions shared by native backends.
//! - [`imagematch`] — template-image search for `findImage`.
//! - `windows` (Windows only) — `SendInput`, clipboard, shell, window management, hotkeys,
//!   low-level hooks, UI Automation and Credential Manager.
#![warn(missing_docs)]
#![cfg_attr(not(windows), forbid(unsafe_code))]

pub mod actions;
pub mod bridge;
pub mod capabilities;
pub mod engine;
pub mod expr;
pub mod imagematch;
pub mod input_profile;
pub mod keys;
pub mod mock;
pub mod record;
pub mod remap;
pub mod risk;
pub mod schedule;
pub mod schema;
pub mod value;

#[cfg(windows)]
pub mod windows;

pub use engine::{
    preflight, run_flow, BackendError, Clock, ErrorCategory, FlowRun, InputAction, InputBackend, RealClock, RunControl, RunError, RunEvent,
    RunHandle, RunOptions, RunResult, RunState, RunStatus, ScreenInfo, VirtualClock,
};
pub use expr::{check_expr, eval_expr, interpolate, ExprEnv, ExprError, Vars};
pub use mock::{MockBackend, MockHandle};
pub use schema::{parse_flow, parse_flow_str, Flow, Platform, Step, StepKind, ValidationIssue};
pub use value::Value;

/// Version of this engine (reported in `device_info.engineVersion`).
pub const ENGINE_VERSION: &str = env!("CARGO_PKG_VERSION");
