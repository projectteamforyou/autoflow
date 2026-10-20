//! Static risk analysis — mirrors `packages/core/src/risk.ts`.

use crate::schema::{walk_steps, FileOp, Flow, HttpMethod, LoopMode, Step, StepKind, Trigger, WindowOp};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::net::Ipv4Addr;
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

/// `{{...}}` interpolation: the real target is only known at run time (`DYNAMIC` in risk.ts).
fn is_dynamic(s: &str) -> bool {
    s.contains("{{")
}

fn is_local_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, ..] = ip.octets();
    a == 127 || a == 10 || a == 0 || (a == 172 && (16..=31).contains(&b)) || (a == 192 && b == 168) || (a == 169 && b == 254)
}

/// True when an http URL points at this machine or a private / link-local network (`isLocalNetworkUrl`):
/// localhost, 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, `::1`, fc00::/7, fe80::/10.
/// The `url` crate is the WHATWG parser, like `new URL()` in TS, so both agree on odd spellings.
pub fn is_local_network_url(raw: &str) -> bool {
    let Ok(u) = url::Url::parse(raw) else { return false };
    match u.host() {
        Some(url::Host::Domain(d)) => {
            let d = d.to_ascii_lowercase();
            let d = d.strip_suffix('.').unwrap_or(&d);
            d == "localhost" || d.ends_with(".localhost")
        }
        Some(url::Host::Ipv4(ip)) => is_local_ipv4(ip),
        Some(url::Host::Ipv6(ip)) => {
            let h = ip.segments();
            ip.is_loopback()
                || ip.is_unspecified()
                || (h[0] & 0xfe00) == 0xfc00
                || (h[0] & 0xffc0) == 0xfe80
                || ip.to_ipv4_mapped().is_some_and(is_local_ipv4)
        }
        None => false,
    }
}

fn step_findings(s: &Step) -> Vec<RiskFinding> {
    let f =
        |key: &str, weight: u32, needs_confirm: bool| RiskFinding { step_id: Some(s.id.clone()), key: key.into(), weight, needs_confirm };
    let mut out = Vec::new();
    match &s.kind {
        StepKind::File { op, .. } => out.push(match op {
            FileOp::Delete => f("risk.fileDelete", 35, true),
            FileOp::Write | FileOp::Move => f("risk.fileWrite", 20, true),
            // append grows/creates files and copy can overwrite its destination: both change files.
            FileOp::Append | FileOp::Copy => f("risk.fileWrite", 12, true),
            FileOp::Read | FileOp::Exists => f("risk.fileRead", 6, false),
        }),
        StepKind::Http { method, url, headers, .. } => {
            if *method == HttpMethod::Get {
                out.push(f("risk.networkRead", 8, false));
            } else {
                out.push(f("risk.networkSend", 25, true));
            }
            if sensitive_url().is_match(url) {
                out.push(f("risk.sensitiveUrl", 20, true));
            }
            if is_dynamic(url) {
                out.push(f("risk.dynamicUrl", 10, true));
            }
            // Even a GET leaks whatever variables or secrets are interpolated into its headers.
            if headers.values().any(|v| is_dynamic(v)) {
                out.push(f("risk.requestVars", 10, true));
            }
            if is_local_network_url(url) {
                out.push(f("risk.localNetwork", 15, true));
            }
        }
        StepKind::LaunchApp { .. } => out.push(f("risk.launchApp", 10, false)),
        StepKind::OpenUrl { url } => {
            if sensitive_url().is_match(url) {
                out.push(f("risk.sensitiveUrl", 15, true));
            }
            if is_dynamic(url) {
                out.push(f("risk.dynamicUrl", 10, true));
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
        StepKind::Ocr { .. }
        | StepKind::FindImage { .. }
        | StepKind::PixelCheck { .. }
        | StepKind::WaitForPixel { .. }
        | StepKind::MatchScene { .. } => {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn flow(steps: serde_json::Value) -> Flow {
        let v = serde_json::json!({
            "schemaVersion": "1.0", "id": "f", "name": "x", "steps": steps,
            "createdAt": "2026-10-19T00:00:00.000Z", "updatedAt": "2026-10-19T00:00:00.000Z",
        });
        match crate::schema::parse_flow(&v) {
            Ok(f) => f,
            Err(issues) => panic!("invalid test flow: {issues:?}"),
        }
    }

    fn keys(r: &RiskReport) -> Vec<&str> {
        r.findings.iter().map(|f| f.key.as_str()).collect()
    }

    #[test]
    fn dynamic_open_url_needs_confirm() {
        let r = analyze_risk(&flow(serde_json::json!([{ "id": "o", "type": "openUrl", "url": "https://my{{'ba'}}nk.com/x" }])));
        assert!(r.needs_confirm, "{r:?}");
        assert!(keys(&r).contains(&"risk.dynamicUrl"));
        let r = analyze_risk(&flow(serde_json::json!([{ "id": "o", "type": "openUrl", "url": "https://example.com/" }])));
        assert!(!r.needs_confirm);
    }

    #[test]
    fn http_get_with_vars_or_local_host_needs_confirm() {
        let get = |url: &str, headers: serde_json::Value| {
            analyze_risk(&flow(serde_json::json!([{ "id": "h", "type": "http", "method": "GET", "url": url, "headers": headers }])))
        };
        assert!(!get("https://example.com/data", serde_json::json!({})).needs_confirm);
        let r = get("https://example.com/?q={{name}}", serde_json::json!({}));
        assert!(r.needs_confirm && keys(&r).contains(&"risk.dynamicUrl"));
        let r = get("https://example.com/", serde_json::json!({ "Authorization": "Bearer {{secret:tok}}" }));
        assert!(r.needs_confirm && keys(&r).contains(&"risk.requestVars"));
        for u in [
            "http://localhost:8080/",
            "http://LOCALHOST./",
            "http://api.localhost/",
            "http://127.0.0.1/",
            "http://2130706433/",
            "http://10.1.2.3/",
            "http://172.16.0.1/",
            "http://172.31.255.255/",
            "http://192.168.0.1/admin",
            "http://169.254.169.254/latest/meta-data",
            "http://0.0.0.0/",
            "http://[::1]/",
            "http://[fc00::1]/",
            "http://[fd12:3456::1]/",
            "http://[fe80::1]/",
            "http://[::ffff:192.168.1.1]/",
        ] {
            let r = get(u, serde_json::json!({}));
            assert!(r.needs_confirm && keys(&r).contains(&"risk.localNetwork"), "{u}: {r:?}");
        }
        for u in ["http://172.32.0.1/", "http://8.8.8.8/", "http://[2001:db8::1]/", "https://localhost.example.com/"] {
            assert!(!is_local_network_url(u), "{u}");
        }
    }

    #[test]
    fn append_and_copy_need_confirm() {
        for op in ["append", "copy"] {
            let r = analyze_risk(&flow(
                serde_json::json!([{ "id": "f", "type": "file", "op": op, "path": "a.txt", "dest": "b.txt", "content": "x" }]),
            ));
            assert!(r.needs_confirm, "{op}: {r:?}");
        }
        let r = analyze_risk(&flow(serde_json::json!([{ "id": "f", "type": "file", "op": "read", "path": "a.txt" }])));
        assert!(!r.needs_confirm);
    }
}
