//! Tauri commands implementing `BridgeCommands` from `packages/core/src/bridge.ts`.
//!
//! Command names are identical to the bridge (`invoke("run_start", { flow, approvedRisk, … })`);
//! argument keys arrive in camelCase and results serialize to the bridge's JSON shapes.
//! Errors reject the `invoke` promise with a human-readable string.

use crate::platform;
use crate::runs::{self, Origin};
use crate::state::{emit, lock, AppState};
use crate::triggers;
use autoflow_engine::bridge::{
    BridgeEvent, DeviceInfo, NativePermission, PermissionStatus, PickedPoint, ProfilesApplied, RecordingResult, RunStarted, TriggersSynced,
};
use autoflow_engine::input_profile::{parse_profile, InputProfile};
use autoflow_engine::record::RecordedEvent;
use autoflow_engine::schema::{parse_flow, Hotkey};
use autoflow_engine::Value;
use indexmap::IndexMap;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

/// `device_info`
#[tauri::command]
pub fn device_info(app: AppHandle) -> DeviceInfo {
    platform::device_info(&app.package_info().version.to_string())
}

fn status(permission: NativePermission) -> PermissionStatus {
    let (granted, detail) = match permission {
        NativePermission::InputMonitoring | NativePermission::Accessibility => (
            true,
            Some("Windows needs no permission for input automation. Apps running as administrator only accept input from an elevated AutoFlow, and the secure desktop (UAC, lock screen) is never automated.".to_owned()),
        ),
        NativePermission::Notifications => (true, Some("Turn notifications on or off in Settings › System › Notifications.".to_owned())),
        NativePermission::Overlay | NativePermission::BatteryOptimization => (true, None),
        NativePermission::Location | NativePermission::NotificationListener => (false, Some("Not available on Windows.".to_owned())),
    };
    PermissionStatus { permission, granted, detail }
}

const ALL_PERMISSIONS: [NativePermission; 7] = [
    NativePermission::Accessibility,
    NativePermission::Overlay,
    NativePermission::Notifications,
    NativePermission::Location,
    NativePermission::NotificationListener,
    NativePermission::BatteryOptimization,
    NativePermission::InputMonitoring,
];

/// `permissions_status`
#[tauri::command]
pub fn permissions_status() -> Vec<PermissionStatus> {
    ALL_PERMISSIONS.into_iter().map(status).collect()
}

/// `permission_request` — Windows has no runtime permission prompts; reports the status and
/// opens the matching Settings page for notifications.
#[tauri::command]
pub fn permission_request(app: AppHandle, permission: NativePermission) -> PermissionStatus {
    if permission == NativePermission::Notifications {
        let _opened = platform::open_settings("notifications");
    }
    let s = status(permission);
    emit(&app, &BridgeEvent::Permission { permission, granted: s.granted });
    s
}

/// `run_start`
#[tauri::command]
pub fn run_start(
    app: AppHandle,
    flow: serde_json::Value,
    inputs: Option<IndexMap<String, serde_json::Value>>,
    approved_risk: bool,
    approved_screen_change: bool,
    dry_run: Option<bool>,
) -> Result<RunStarted, String> {
    let flow = parse_flow(&flow).map_err(|issues| {
        let list: Vec<String> = issues.iter().take(5).map(ToString::to_string).collect();
        format!("invalid flow: {}", list.join("; "))
    })?;
    let inputs: IndexMap<String, Value> = inputs.unwrap_or_default().iter().map(|(k, v)| (k.clone(), Value::from_json(v))).collect();
    let origin = Origin::Ui { approved_risk, approved_screen: approved_screen_change };
    runs::start(&app, flow, inputs, origin, dry_run.unwrap_or(false)).map(|run_id| RunStarted { run_id })
}

/// `run_pause`
#[tauri::command]
pub fn run_pause(app: AppHandle, run_id: String) -> Result<(), String> {
    runs::handle(&app, &run_id).map(|h| h.pause())
}

/// `run_resume`
#[tauri::command]
pub fn run_resume(app: AppHandle, run_id: String) -> Result<(), String> {
    runs::handle(&app, &run_id).map(|h| h.resume())
}

/// `run_stop`
#[tauri::command]
pub fn run_stop(app: AppHandle, run_id: String, reason: Option<String>) -> Result<(), String> {
    runs::handle(&app, &run_id).map(|h| h.stop(reason.as_deref().unwrap_or("user")))
}

/// `halt_all`
#[tauri::command]
pub fn halt_all(app: AppHandle) {
    runs::halt_all(&app, "halt");
}

/// `triggers_sync`
#[tauri::command]
pub fn triggers_sync(app: AppHandle, flows: Vec<serde_json::Value>, emergency_stop: Hotkey) -> TriggersSynced {
    triggers::sync(&app, &flows, emergency_stop)
}

/// `record_start`
#[tauri::command]
pub fn record_start(app: AppHandle, state: State<'_, AppState>, mask_sensitive: bool) -> Result<(), String> {
    let mut slot = lock(&state.recorder);
    if slot.is_some() {
        return Err("a recording is already in progress".into());
    }
    let emitter = app.clone();
    let cb = Arc::new(move |e: &RecordedEvent| emit(&emitter, &BridgeEvent::Recording { event: e.clone() }));
    *slot = Some(platform::Recorder::start(mask_sensitive, cb)?);
    Ok(())
}

/// `record_stop`
#[tauri::command]
pub fn record_stop(state: State<'_, AppState>) -> Result<RecordingResult, String> {
    let rec = lock(&state.recorder).take().ok_or("no recording is in progress")?;
    let (events, screen) = rec.stop();
    Ok(RecordingResult { events, screen })
}

/// `pick_point` — hides AutoFlow, shows the crosshair overlay and restores the window.
#[tauri::command]
pub async fn pick_point(app: AppHandle) -> Result<PickedPoint, String> {
    let window = app.get_webview_window("main");
    if let Some(w) = &window {
        let _hidden = w.hide();
    }
    let picked = tauri::async_runtime::spawn_blocking(platform::pick_point).await.map_err(|e| format!("picker failed: {e}"))?;
    if let Some(w) = &window {
        let _shown = w.show();
        let _focused = w.set_focus();
    }
    let (x, y) = picked?;
    let screen = platform::screen_info();
    emit(&app, &BridgeEvent::PointPicked { x, y, screen });
    Ok(PickedPoint { x, y, screen })
}

/// `profiles_apply`
#[tauri::command]
pub fn profiles_apply(state: State<'_, AppState>, profiles: Vec<serde_json::Value>, enabled: bool) -> Result<ProfilesApplied, String> {
    let mut warnings = Vec::new();
    let mut valid: Vec<InputProfile> = Vec::new();
    for raw in &profiles {
        match parse_profile(raw) {
            Ok(p) => valid.push(p),
            Err(issues) => {
                let id = raw.get("id").and_then(serde_json::Value::as_str).unwrap_or("?");
                warnings.push(format!("profile {id} was skipped: {}", issues.first().map_or_else(String::new, ToString::to_string)));
            }
        }
    }
    let flow_hotkeys = lock(&state.flow_hotkeys).clone();
    let emergency = lock(&state.emergency).clone();
    let kf = lock(&state.keyforge);
    let kf = kf.as_ref().ok_or("Keyforge is not available")?;
    let (active, mut w) = kf.apply(valid, enabled, &flow_hotkeys, emergency);
    warnings.append(&mut w);
    Ok(ProfilesApplied { active, warnings })
}

/// `secret_set`
#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    platform::secret_set(&name, &value)
}

/// `secret_delete`
#[tauri::command]
pub fn secret_delete(name: String) -> Result<(), String> {
    platform::secret_delete(&name)
}

/// `secret_list`
#[tauri::command]
pub fn secret_list() -> Vec<String> {
    platform::secret_list()
}

/// `open_settings`
#[tauri::command]
pub fn open_settings(page: String) -> Result<(), String> {
    platform::open_settings(&page)
}

/// `autostart_set`
#[tauri::command]
pub fn autostart_set(app: AppHandle, enabled: bool) -> Result<(), String> {
    let launcher = app.autolaunch();
    let r = if enabled { launcher.enable() } else { launcher.disable() };
    r.map_err(|e| format!("cannot change start-up registration: {e}"))
}
