//! Platform capability matrix — mirrors `packages/core/src/capabilities.ts`.
//!
//! Unsupported steps are blocked before a run starts, never silently skipped.

use crate::schema::{walk_steps, Platform, Step, Target};
use serde::{Deserialize, Serialize};

/// Support level of a step on a platform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Support {
    /// Fully supported.
    Supported,
    /// Works with caveats.
    Limited,
    /// Cannot run.
    Unsupported,
}

/// Support level plus the i18n key that explains it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CapabilityNote {
    /// Level.
    pub support: Support,
    /// i18n key.
    pub note_key: Option<&'static str>,
}

const S: CapabilityNote = CapabilityNote { support: Support::Supported, note_key: None };
const fn l(k: &'static str) -> CapabilityNote {
    CapabilityNote { support: Support::Limited, note_key: Some(k) }
}
const fn u(k: &'static str) -> CapabilityNote {
    CapabilityNote { support: Support::Unsupported, note_key: Some(k) }
}

/// `STEP_CAPABILITIES[type][platform]`.
pub fn step_capability(step_type: &str, platform: Platform) -> CapabilityNote {
    let row: [CapabilityNote; 3] = match step_type {
        "click" => [S, l("cap.click.android"), l("cap.sandbox")],
        "move" => [S, u("cap.move.android"), l("cap.sandbox")],
        "drag" => [S, S, l("cap.sandbox")],
        "scroll" => [S, l("cap.scroll.android"), l("cap.sandbox")],
        "key" => [S, l("cap.key.android"), l("cap.sandbox")],
        "type" => [S, l("cap.type.android"), l("cap.sandbox")],
        "clipboard" => [S, l("cap.clipboard.android"), l("cap.clipboard.web")],
        "launchApp" => [S, S, u("cap.launchApp.web")],
        "window" => [S, u("cap.window.android"), u("cap.native")],
        "androidGlobal" => [u("cap.androidOnly"), l("cap.androidGlobal"), l("cap.sandbox")],
        "http" => [S, S, l("cap.http.web")],
        "file" => [S, l("cap.file.android"), u("cap.native")],
        "ocr" => [S, l("cap.ocr.android"), u("cap.native")],
        "findImage" => [S, l("cap.findImage.android"), u("cap.native")],
        "switchProfile" => [S, l("cap.switchProfile.android"), u("cap.native")],
        _ => [S, S, S],
    };
    match platform {
        Platform::Windows => row[0],
        Platform::Android => row[1],
        Platform::Web => row[2],
    }
}

/// `TRIGGER_CAPABILITIES[type][platform]`.
pub fn trigger_capability(trigger_type: &str, platform: Platform) -> CapabilityNote {
    let row: [CapabilityNote; 3] = match trigger_type {
        "hotkey" => [S, l("cap.hotkey.android"), l("cap.hotkey.web")],
        "schedule" => [S, l("cap.schedule.android"), l("cap.schedule.web")],
        "appEvent" => [S, l("cap.appEvent.android"), u("cap.native")],
        "deviceEvent" => [l("cap.deviceEvent.windows"), S, u("cap.native")],
        "location" => [u("cap.location.windows"), l("cap.location.android"), u("cap.native")],
        "notification" => [u("cap.notification.windows"), l("cap.notification.android"), u("cap.native")],
        _ => [S, S, S],
    };
    match platform {
        Platform::Windows => row[0],
        Platform::Android => row[1],
        Platform::Web => row[2],
    }
}

/// `targetSupport()`.
pub fn target_support(t: &Target, platform: Platform) -> CapabilityNote {
    match (t, platform) {
        (Target::Element { .. }, Platform::Web) => u("cap.element.web"),
        (Target::Image(_), Platform::Web) => u("cap.native"),
        (Target::Current, Platform::Android) => u("cap.current.android"),
        _ => S,
    }
}

/// An enabled step that is not fully supported on a platform.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatIssue {
    /// Step id.
    pub step_id: String,
    /// Step type.
    pub step_type: String,
    /// Level.
    pub support: Support,
    /// i18n key.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note_key: Option<String>,
}

/// Lists every enabled step that is not fully supported on the platform.
pub fn compatibility(steps: &[Step], platform: Platform) -> Vec<CompatIssue> {
    let mut out = Vec::new();
    walk_steps(steps, &mut |s, _, _| {
        if s.is_disabled() {
            return;
        }
        let mut worst = step_capability(s.type_name(), platform);
        for t in s.targets() {
            let tc = target_support(t, platform);
            if tc.support > worst.support {
                worst = tc;
            }
        }
        if worst.support != Support::Supported {
            out.push(CompatIssue {
                step_id: s.id.clone(),
                step_type: s.type_name().to_owned(),
                support: worst.support,
                note_key: worst.note_key.map(str::to_owned),
            });
        }
    });
    out
}

/// True when no enabled step is unsupported.
pub fn is_runnable_on(steps: &[Step], platform: Platform) -> bool {
    !compatibility(steps, platform).iter().any(|i| i.support == Support::Unsupported)
}
