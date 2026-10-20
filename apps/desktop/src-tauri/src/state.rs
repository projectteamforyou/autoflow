//! Shared application state managed by Tauri.

use crate::platform::{self, AppHooks};
use crate::triggers::TriggerTable;
use autoflow_engine::bridge::{BridgeEvent, BRIDGE_EVENT};
use autoflow_engine::schema::{default_stop_hotkey, Flow, Hotkey};
use autoflow_engine::RunHandle;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::Instant;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

/// Poison-tolerant lock: a panicked holder never wedges the app.
pub fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// One active run.
pub struct RunEntry {
    /// Control handle.
    pub handle: RunHandle,
    /// Flow id.
    pub flow_id: String,
}

/// Everything the commands share.
pub struct AppState {
    /// Active runs by run id.
    pub runs: Mutex<HashMap<String, RunEntry>>,
    /// Known flows (from `triggers_sync` and `run_start`) for `runFlow` and triggers.
    pub library: Mutex<HashMap<String, Flow>>,
    /// Registered triggers.
    pub triggers: Mutex<TriggerTable>,
    /// Last trigger-initiated start per flow (cooldown).
    pub last_trigger: Mutex<HashMap<String, Instant>>,
    /// Global hotkey service.
    pub hotkeys: Mutex<Option<platform::Hotkeys>>,
    /// Keyforge service.
    pub keyforge: Mutex<Option<platform::Keyforge>>,
    /// Active recording.
    pub recorder: Mutex<Option<platform::Recorder>>,
    /// Emergency stop combination.
    pub emergency: Mutex<Hotkey>,
    /// Flow hotkeys (for Keyforge conflict checks).
    pub flow_hotkeys: Mutex<Vec<(String, Hotkey)>>,
    /// Template images folder.
    pub images_dir: PathBuf,
}

impl AppState {
    /// Empty state.
    pub fn new(images_dir: PathBuf) -> Self {
        Self {
            runs: Mutex::new(HashMap::new()),
            library: Mutex::new(HashMap::new()),
            triggers: Mutex::new(TriggerTable::default()),
            last_trigger: Mutex::new(HashMap::new()),
            hotkeys: Mutex::new(None),
            keyforge: Mutex::new(None),
            recorder: Mutex::new(None),
            emergency: Mutex::new(default_stop_hotkey()),
            flow_hotkeys: Mutex::new(Vec::new()),
            images_dir,
        }
    }
}

/// Sends a bridge event to the web app (best effort).
pub fn emit(app: &AppHandle, event: &BridgeEvent) {
    let _ignored = app.emit(BRIDGE_EVENT, event);
}

/// [`AppHooks`] backed by the Tauri app.
pub struct Hooks {
    /// App handle.
    pub app: AppHandle,
}

impl AppHooks for Hooks {
    fn notify(&self, title: &str, body: &str) -> Result<(), String> {
        self.app.notification().builder().title(title).body(body).show().map_err(|e| format!("cannot show the notification: {e}"))
    }

    fn switch_profile(&self, profile_id: &str) -> Result<(), String> {
        let state = self.app.state::<AppState>();
        let kf = lock(&state.keyforge);
        match kf.as_ref() {
            Some(k) => k.force(Some(profile_id.to_owned())),
            None => Err("Keyforge is not running".into()),
        }
    }

    fn images_dir(&self) -> PathBuf {
        self.app.state::<AppState>().images_dir.clone()
    }

    fn profile_activated(&self, profile_id: Option<&str>) {
        emit(&self.app, &BridgeEvent::ProfileActivated { profile_id: profile_id.map(str::to_owned) });
    }

    fn start_flow(&self, flow_id: &str) {
        crate::runs::start_known(&self.app, flow_id, crate::runs::Origin::Attended);
    }
}
