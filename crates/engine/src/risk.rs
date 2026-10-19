//! Static risk analysis — mirrors `packages/core/src/risk.ts`.

use crate::schema::{walk_steps, FileOp, Flow, HttpMethod, LoopMode, Step, StepKind, Trigger, WindowOp};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::sync::OnceLock;

/// Risk grade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    /// Score < 15.
    Low,
    /// 15 ≤ score < 40.
    Medium,
    /// Score ≥ 40.
    High,
}

/// One reason contributing to the score.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskFinding {
    /// Step id.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub step_id: Option<String>,
    /// i18n key, e.g. `risk.fileDelete`.
    pub key: String,
    /// Weight.
    pub weight: u32,
    /// Requires explicit approval before the run.
    pub needs_confirm: bool,
}

/// Result of [`analyze_risk`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskReport {
    /// 0..100.
    pub score: u32,
    /// Grade.
    pub level: RiskLevel,
    /// Reasons.
    pub findings: Vec<RiskFinding>,
    /// Any finding needs approval.
    pub needs_confirm: bool,
    /// Sorted permission labels.
    pub permissions: Vec<String>,
}

fn sensitive_url() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    #[allow(clippy::unwrap_used)] // constant pattern
    R.get_or_init(|| Regex::new(r"(?i)(pay|checkout|bank|transfer|wallet|purchase|billing|order|captcha|login|signin|auth)").unwrap())
}

fn secret_ref() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    #[allow(clippy::unwrap_used)] // constant pattern
    R.get_or_init(|| Regex::new(r"\{\{\s*secret:").unwrap())
}

fn step_findings(s: &Step) -> Vec<RiskFinding> {
    let f =
        |key: &str, weight: u32, needs_confirm: bool| RiskFinding { step_id: Some(s.id.clone()), key: key.into(), weight, needs_confirm };
    let mut out = Vec::new();
    match &s.kind {
        StepKind::File { op, .. } => out.push(match op {
            FileOp::Delete => f("risk.fileDelete", 35, true),
            FileOp::Write | FileOp::Move => f("risk.fileWrite", 20, true),
            FileOp::Append | FileOp::Copy => f("risk.fileWrite", 12, false),
            FileOp::Read | FileOp::Exists => f("risk.fileRead", 6, false),
        }),
        StepKind::Http { method, url, .. } => {
            if *method == HttpMethod::Get {
                out.push(f("risk.networkRead", 8, false));
            } else {
                out.push(f("risk.networkSend", 25, true));
            }
            if sensitive_url().is_match(url) {
                out.push(f("risk.sensitiveUrl", 20, true));
            }
        }
        StepKind::LaunchApp { .. } => out.push(f("risk.launchApp", 10, false)),
        StepKind::OpenUrl { url } => {
            if sensitive_url().is_match(url) {
                out.push(f("risk.sensitiveUrl", 15, true));
            }
        }
        StepKind::Type { text, .. } => {
            if secret_ref().is_match(text) {
                out.push(f("risk.secretInput", 10, false));
            }
        }
        StepKind::Window { op: WindowOp::Close, .. } => out.push(f("risk.windowClose", 12, false)),
        StepKind::AndroidGlobal { action } => {
            use crate::schema::AndroidAction;
            if matches!(action, AndroidAction::LockScreen | AndroidAction::PowerDialog) {
                out.push(f("risk.systemAction", 10, false));
            }
        }
        StepKind::Clipboard { op: crate::schema::ClipboardOp::Get, .. } => out.push(f("risk.clipboardRead", 8, false)),
        StepKind::Ocr { .. } | StepKind::FindImage { .. } | StepKind::PixelCheck { .. } | StepKind::WaitForPixel { .. } | StepKind::MatchScene { .. } => {
            out.push(f("risk.screenRead", 8, false));
        }
        StepKind::Loop { mode: LoopMode::Forever, .. } => out.push(f("risk.foreverLoop", 5, false)),
        _ => {}
    }
    if s.condition().is_some_and(crate::schema::Condition::probes_screen) {
        out.push(f("risk.screenRead", 8, false));
    }
    out
}

fn permission_of(step_type: &str) -> Option<&'static str> {
    Some(match step_type {
        "click" | "move" | "drag" | "scroll" | "key" | "type" => "perm.input",
        "clipboard" => "perm.clipboard",
        "launchApp" => "perm.apps",
        "openUrl" => "perm.browser",
        "window" => "perm.windows",
        "http" => "perm.network",
        "file" => "perm.files",
        "ocr" | "findImage" | "pixelCheck" | "waitForPixel" | "matchScene" => "perm.screen",
        "notify" => "perm.notifications",
        "androidGlobal" => "perm.accessibility",
        _ => return None,
    })
}

/// Scores what a flow can do (`analyzeRisk`).
pub fn analyze_risk(flow: &Flow) -> RiskReport {
    let mut findings = Vec::new();
    let mut perms = BTreeSet::new();
    walk_steps(&flow.steps, &mut |s, _, _| {
        if s.is_disabled() {
            return;
        }
        findings.extend(step_findings(s));
        if let Some(p) = permission_of(s.type_name()) {
            perms.insert(p.to_owned());
        }
        if s.condition().is_some_and(crate::schema::Condition::probes_screen) {
            perms.insert("perm.screen".to_owned());
        }
    });
    // Stage mode without the takeover pause keeps clicking even while the user grabs the mouse.
    if flow.stage.as_ref().is_some_and(|st| st.pause_on_takeover == Some(false)) {
        findings.push(RiskFinding { step_id: None, key: "risk.stageNoTakeover".into(), weight: 12, needs_confirm: false });
    }
    let global = |key: &str, weight: u32| RiskFinding { step_id: None, key: key.into(), weight, needs_confirm: false };
    if matches!(flow.trigger, Trigger::Location { .. }) {
        findings.push(global("risk.location", 10));
        perms.insert("perm.location".into());
    }
    if matches!(flow.trigger, Trigger::Notification { .. }) {
        findings.push(global("risk.notificationRead", 10));
        perms.insert("perm.notificationAccess".into());
    }
    if !matches!(flow.trigger, Trigger::Manual | Trigger::Hotkey { .. }) {
        findings.push(global("risk.unattended", 8));
    }
    if flow.limits.max_duration_ms > 3_600_000 {
        findings.push(global("risk.longRun", 5));
    }
    let score = findings.iter().map(|f| f.weight).sum::<u32>().min(100);
    let level = if score >= 40 {
        RiskLevel::High
    } else if score >= 15 {
        RiskLevel::Medium
    } else {
        RiskLevel::Low
    };
    let needs_confirm = findings.iter().any(|f| f.needs_confirm);
    RiskReport { score, level, findings, needs_confirm, permissions: perms.into_iter().collect() }
}
