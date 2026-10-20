//! Native bridge payloads — mirrors `packages/core/src/bridge.ts`.
//!
//! The Tauri shell exposes the `BridgeCommands` as commands with these argument/result shapes
//! and emits [`BridgeEvent`]s on the [`BRIDGE_EVENT`] channel.

pub use crate::display::DisplayInfo;
use crate::engine::{RunEvent, RunResult, ScreenInfo};
use crate::record::RecordedEvent;
use crate::schema::Platform;
use serde::{Deserialize, Serialize};

/// Event channel name.
pub const BRIDGE_EVENT: &str = "autoflow://event";

/// Hotkey actions reported to the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum HotkeyAction {
    Start,
    Pause,
    Stop,
    Halt,
}

/// Native permissions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(missing_docs)]
pub enum NativePermission {
    Accessibility,
    Overlay,
    Notifications,
    Location,
    NotificationListener,
    BatteryOptimization,
    InputMonitoring,
}

/// Events pushed from native to the UI.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[allow(missing_docs)]
pub enum BridgeEvent {
    Run {
        run_id: String,
        event: RunEvent,
    },
    RunEnded {
        run_id: String,
        result: RunResult,
    },
    Hotkey {
        action: HotkeyAction,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        flow_id: Option<String>,
    },
    Recording {
        event: RecordedEvent,
    },
    Permission {
        permission: NativePermission,
        granted: bool,
    },
    /// `profileId` is always present (`null` when no profile is active).
    ProfileActivated {
        profile_id: Option<String>,
    },
    PointPicked {
        x: i32,
        y: i32,
        screen: ScreenInfo,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        display_id: Option<String>,
    },
    /// Monitors were added, removed, moved or rescaled.
    Displays {
        displays: Vec<DisplayInfo>,
    },
}

/// Status of one permission.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionStatus {
    /// Permission.
    pub permission: NativePermission,
    /// Granted.
    pub granted: bool,
    /// Extra detail.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

/// One monitor.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DeviceScreen {
    /// Width in physical px.
    pub width: u32,
    /// Height in physical px.
    pub height: u32,
    /// Scale factor.
    pub scale: f64,
    /// Left in virtual-desktop px.
    pub x: i32,
    /// Top in virtual-desktop px.
    pub y: i32,
    /// Primary monitor.
    pub primary: bool,
}

/// Input device kinds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum InputDeviceKind {
    Keyboard,
    Mouse,
    Touch,
    Gamepad,
    Other,
}

/// One input device.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InputDevice {
    /// Stable id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Kind.
    pub kind: InputDeviceKind,
    /// USB vendor id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor_id: Option<u32>,
    /// USB product id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_id: Option<u32>,
}

/// `device_info` result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceInfo {
    /// Platform.
    pub platform: Platform,
    /// OS name.
    pub os: String,
    /// OS version.
    pub os_version: String,
    /// App version.
    pub app_version: String,
    /// Engine version.
    pub engine_version: String,
    /// Monitors.
    pub screens: Vec<DeviceScreen>,
    /// Windows build number.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_level: Option<u32>,
    /// Manufacturer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manufacturer: Option<String>,
    /// Input devices.
    pub input_devices: Vec<InputDevice>,
}

/// `run_start` result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStarted {
    /// Run id.
    pub run_id: String,
}

/// A trigger that could not be registered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerFailure {
    /// Flow id.
    pub flow_id: String,
    /// Reason.
    pub reason: String,
}

/// `triggers_sync` result.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct TriggersSynced {
    /// Flow ids now watched.
    pub registered: Vec<String>,
    /// Failures.
    pub failed: Vec<TriggerFailure>,
}

/// `record_stop` result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecordingResult {
    /// Events in time order.
    pub events: Vec<RecordedEvent>,
    /// Screen at recording time.
    pub screen: ScreenInfo,
}

/// `pick_point` result.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedPoint {
    /// X in virtual-desktop physical px.
    pub x: i32,
    /// Y in virtual-desktop physical px.
    pub y: i32,
    /// Screen info.
    pub screen: ScreenInfo,
    /// Display the point lies on.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_id: Option<String>,
}

/// `scene_capture` result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SceneCaptured {
    /// dHash, 16 lowercase hex digits.
    pub hash: String,
    /// PNG thumbnail as a data URL (≤ `MAX_SCENE_THUMB_CHARS`).
    pub thumb: String,
    /// Captured width in px.
    pub width: u32,
    /// Captured height in px.
    pub height: u32,
}

/// `profiles_apply` result.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ProfilesApplied {
    /// Active profile id.
    pub active: Option<String>,
    /// Conflict warnings.
    pub warnings: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_activated_keeps_null() {
        let e = BridgeEvent::ProfileActivated { profile_id: None };
        assert_eq!(serde_json::to_string(&e).expect("serializes"), r#"{"kind":"profileActivated","profileId":null}"#);
        let h = BridgeEvent::Hotkey { action: HotkeyAction::Halt, flow_id: None };
        assert_eq!(serde_json::to_string(&h).expect("serializes"), r#"{"kind":"hotkey","action":"halt"}"#);
    }

    #[test]
    fn displays_event_and_picked_point_use_bridge_names() {
        let d = crate::display::DisplayInfo::new(
            "\\\\.\\DISPLAY2",
            false,
            crate::schema::Rect { x: 1920.0, y: 0.0, w: 1280.0, h: 1024.0 },
            1.25,
        );
        let v = serde_json::to_value(BridgeEvent::Displays { displays: vec![d] }).expect("serializes");
        assert_eq!(v["kind"], "displays");
        assert_eq!(v["displays"][0]["workArea"]["w"], 1280.0);
        assert_eq!(v["displays"][0]["orientation"], "landscape");
        let p = PickedPoint { x: 1, y: 2, screen: ScreenInfo { width: 3, height: 4, scale: 1.0 }, display_id: Some("A".into()) };
        assert_eq!(serde_json::to_value(p).expect("serializes")["displayId"], "A");
    }
}
