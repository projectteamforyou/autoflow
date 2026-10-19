//! Platform glue. On Windows everything maps to `autoflow_engine::windows`; other targets get
//! inert fallbacks so the crate still builds (CI type-checks it on Linux) while real input stays
//! Windows-only.

use std::path::PathBuf;

/// Callbacks the platform layer needs from the app.
pub trait AppHooks: Send + Sync {
    /// Shows a desktop notification.
    fn notify(&self, title: &str, body: &str) -> Result<(), String>;
    /// Activates (forces) a Keyforge profile.
    fn switch_profile(&self, profile_id: &str) -> Result<(), String>;
    /// Folder holding template images (`<ref>.png`).
    fn images_dir(&self) -> PathBuf;
    /// Keyforge activated a profile.
    fn profile_activated(&self, profile_id: Option<&str>);
    /// A Keyforge mapping asked to start a flow.
    fn start_flow(&self, flow_id: &str);
}

/// Allowed characters of a template image reference (no paths).
pub fn safe_ref(reference: &str) -> Option<&str> {
    let ok = !reference.is_empty()
        && reference.len() <= 200
        && reference.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        && !reference.starts_with('.');
    ok.then_some(reference)
}

#[cfg(windows)]
mod imp {
    use super::{safe_ref, AppHooks};
    use autoflow_engine::bridge::DeviceInfo;
    use autoflow_engine::engine::{BackendError, ErrorCategory};
    use autoflow_engine::input_profile::InputProfile;
    use autoflow_engine::record::RecordedEvent;
    use autoflow_engine::schema::{Hotkey, Platform};
    use autoflow_engine::windows::{self as win, keyforge, recorder};
    use autoflow_engine::{InputBackend, RunControl, ScreenInfo};
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::Duration;

    struct EngineHost(Arc<dyn AppHooks>);

    impl win::Host for EngineHost {
        fn notify(&self, title: &str, body: &str) -> Result<(), BackendError> {
            self.0.notify(title, body).map_err(|e| BackendError::new(ErrorCategory::Environment, e))
        }
        fn switch_profile(&self, profile_id: &str) -> Result<(), BackendError> {
            self.0.switch_profile(profile_id).map_err(|e| BackendError::new(ErrorCategory::Target, e))
        }
        fn image_path(&self, reference: &str) -> Option<PathBuf> {
            safe_ref(reference).map(|r| self.0.images_dir().join(format!("{r}.png")))
        }
    }

    struct KfHost(Arc<dyn AppHooks>);

    impl keyforge::KeyforgeHost for KfHost {
        fn profile_activated(&self, profile_id: Option<&str>) {
            self.0.profile_activated(profile_id);
        }
        fn start_flow(&self, flow_id: &str) {
            self.0.start_flow(flow_id);
        }
    }

    /// Process-wide initialisation (DPI awareness).
    pub fn init() {
        win::init_process();
    }

    /// Real-input backend.
    pub fn real_backend(hooks: Arc<dyn AppHooks>) -> Result<Box<dyn InputBackend>, String> {
        Ok(Box::new(win::WindowsBackend::new(Arc::new(EngineHost(hooks)))))
    }

    /// Primary screen.
    pub fn screen_info() -> ScreenInfo {
        win::screen::primary_screen_info()
    }

    /// `device_info` payload.
    pub fn device_info(app_version: &str) -> DeviceInfo {
        let (os, version, build) = win::device::os_version();
        DeviceInfo {
            platform: Platform::Windows,
            os,
            os_version: version,
            app_version: app_version.to_owned(),
            engine_version: autoflow_engine::ENGINE_VERSION.to_owned(),
            screens: win::screen::device_screens(),
            api_level: Some(build),
            manufacturer: None,
            input_devices: win::device::input_devices(),
        }
    }

    /// Secret lookup for `{{secret:name}}`.
    pub fn secret_get(name: &str) -> Option<String> {
        win::credentials::get(name)
    }
    /// Stores a secret.
    pub fn secret_set(name: &str, value: &str) -> Result<(), String> {
        win::credentials::set(name, value).map_err(|e| e.message)
    }
    /// Deletes a secret.
    pub fn secret_delete(name: &str) -> Result<(), String> {
        win::credentials::delete(name).map_err(|e| e.message)
    }
    /// Secret names.
    pub fn secret_list() -> Vec<String> {
        win::credentials::list()
    }

    /// Opens a Settings page.
    pub fn open_settings(page: &str) -> Result<(), String> {
        win::shell::open_settings(page).map_err(|e| e.message)
    }

    /// Crosshair overlay.
    pub fn pick_point() -> Result<(i32, i32), String> {
        win::picker::pick_point(Duration::from_secs(60)).map_err(|e| e.message)
    }

    /// Native yes/no dialog (used to approve risky hotkey-started runs).
    pub fn ask(message: &str, control: &RunControl) -> bool {
        win::backend::message_box_confirm(message, control).unwrap_or(false)
    }

    /// Foreground `(app, title)`.
    pub fn foreground() -> Option<(String, String)> {
        win::process::foreground()
    }
    /// Lower-cased running process names.
    pub fn running_processes() -> std::collections::HashSet<String> {
        win::process::running_processes()
    }
    /// `(on AC, battery %)`.
    pub fn power_status() -> Option<(bool, Option<u8>)> {
        win::process::power_status()
    }
    /// Case-insensitive executable comparison.
    pub fn same_app(a: &str, b: &str) -> bool {
        win::process::same_app(a, b)
    }

    /// Global hotkeys.
    pub struct Hotkeys(win::hotkeys::HotkeyService);

    impl Hotkeys {
        /// Starts the hotkey thread.
        pub fn start(cb: Arc<dyn Fn(i32) + Send + Sync>) -> Result<Self, String> {
            win::hotkeys::HotkeyService::start(cb).map(Hotkeys)
        }
        /// Replaces all bindings.
        pub fn set(&self, bindings: Vec<(i32, Hotkey)>) -> Vec<(i32, Result<(), String>)> {
            self.0.set(bindings)
        }
    }

    /// Recording session.
    pub struct Recorder(recorder::Recorder);

    impl Recorder {
        /// Starts recording.
        pub fn start(mask: bool, cb: Arc<dyn Fn(&RecordedEvent) + Send + Sync>) -> Result<Self, String> {
            recorder::Recorder::start(mask, cb).map(Recorder)
        }
        /// Stops and returns the events.
        pub fn stop(self) -> (Vec<RecordedEvent>, ScreenInfo) {
            self.0.stop()
        }
    }

    /// Keyforge service.
    pub struct Keyforge(keyforge::Keyforge);

    impl Keyforge {
        /// Starts Keyforge.
        pub fn start(hooks: Arc<dyn AppHooks>) -> Result<Self, String> {
            keyforge::Keyforge::start(Arc::new(KfHost(hooks))).map(Keyforge)
        }
        /// Applies profiles.
        pub fn apply(
            &self,
            profiles: Vec<InputProfile>,
            enabled: bool,
            flow_hotkeys: &[(String, Hotkey)],
            emergency: Hotkey,
        ) -> (Option<String>, Vec<String>) {
            self.0.apply(profiles, enabled, flow_hotkeys, emergency)
        }
        /// Forces a profile.
        pub fn force(&self, id: Option<String>) -> Result<(), String> {
            self.0.force(id)
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::AppHooks;
    use autoflow_engine::bridge::DeviceInfo;
    use autoflow_engine::input_profile::InputProfile;
    use autoflow_engine::record::RecordedEvent;
    use autoflow_engine::schema::{Hotkey, Platform};
    use autoflow_engine::{InputBackend, RunControl, ScreenInfo};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    const ONLY_WINDOWS: &str = "this feature is only available in the Windows build";

    static SECRETS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

    /// Process-wide initialisation (nothing to do).
    pub fn init() {}

    /// Real input is Windows-only.
    pub fn real_backend(_hooks: Arc<dyn AppHooks>) -> Result<Box<dyn InputBackend>, String> {
        Err(ONLY_WINDOWS.into())
    }

    /// A nominal Full-HD screen.
    pub fn screen_info() -> ScreenInfo {
        ScreenInfo { width: 1920, height: 1080, scale: 1.0 }
    }

    /// Minimal device info.
    pub fn device_info(app_version: &str) -> DeviceInfo {
        DeviceInfo {
            platform: Platform::Windows,
            os: std::env::consts::OS.into(),
            os_version: "unknown".into(),
            app_version: app_version.to_owned(),
            engine_version: autoflow_engine::ENGINE_VERSION.to_owned(),
            screens: Vec::new(),
            api_level: None,
            manufacturer: None,
            input_devices: Vec::new(),
        }
    }

    fn with_secrets<T>(f: impl FnOnce(&mut HashMap<String, String>) -> T) -> T {
        let mut g = SECRETS.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        f(g.get_or_insert_with(HashMap::new))
    }
    /// In-memory secret (development builds only).
    pub fn secret_get(name: &str) -> Option<String> {
        with_secrets(|s| s.get(name).cloned())
    }
    /// In-memory secret (development builds only).
    pub fn secret_set(name: &str, value: &str) -> Result<(), String> {
        with_secrets(|s| s.insert(name.to_owned(), value.to_owned()));
        Ok(())
    }
    /// In-memory secret (development builds only).
    pub fn secret_delete(name: &str) -> Result<(), String> {
        with_secrets(|s| s.remove(name));
        Ok(())
    }
    /// In-memory secret names.
    pub fn secret_list() -> Vec<String> {
        let mut v = with_secrets(|s| s.keys().cloned().collect::<Vec<_>>());
        v.sort();
        v
    }
    /// Unsupported.
    pub fn open_settings(_page: &str) -> Result<(), String> {
        Err(ONLY_WINDOWS.into())
    }
    /// Unsupported.
    pub fn pick_point() -> Result<(i32, i32), String> {
        Err(ONLY_WINDOWS.into())
    }
    /// No native dialog: never approves.
    pub fn ask(_message: &str, _control: &RunControl) -> bool {
        false
    }
    /// Unknown.
    pub fn foreground() -> Option<(String, String)> {
        None
    }
    /// Unknown.
    pub fn running_processes() -> std::collections::HashSet<String> {
        std::collections::HashSet::new()
    }
    /// Unknown.
    pub fn power_status() -> Option<(bool, Option<u8>)> {
        None
    }
    /// Case-insensitive comparison.
    pub fn same_app(a: &str, b: &str) -> bool {
        a.eq_ignore_ascii_case(b)
    }

    /// Hotkeys are unavailable.
    pub struct Hotkeys;
    impl Hotkeys {
        /// Unsupported.
        pub fn start(_cb: Arc<dyn Fn(i32) + Send + Sync>) -> Result<Self, String> {
            Err(ONLY_WINDOWS.into())
        }
        /// Unsupported.
        pub fn set(&self, bindings: Vec<(i32, Hotkey)>) -> Vec<(i32, Result<(), String>)> {
            bindings.into_iter().map(|(id, _)| (id, Err(ONLY_WINDOWS.to_owned()))).collect()
        }
    }

    /// Recording is unavailable.
    pub struct Recorder;
    impl Recorder {
        /// Unsupported.
        pub fn start(_mask: bool, _cb: Arc<dyn Fn(&RecordedEvent) + Send + Sync>) -> Result<Self, String> {
            Err(ONLY_WINDOWS.into())
        }
        /// Nothing recorded.
        pub fn stop(self) -> (Vec<RecordedEvent>, ScreenInfo) {
            (Vec::new(), screen_info())
        }
    }

    /// Keyforge is unavailable.
    pub struct Keyforge;
    impl Keyforge {
        /// Unsupported.
        pub fn start(_hooks: Arc<dyn AppHooks>) -> Result<Self, String> {
            Err(ONLY_WINDOWS.into())
        }
        /// No-op.
        pub fn apply(&self, _p: Vec<InputProfile>, _e: bool, _f: &[(String, Hotkey)], _h: Hotkey) -> (Option<String>, Vec<String>) {
            (None, vec![ONLY_WINDOWS.to_owned()])
        }
        /// Unsupported.
        pub fn force(&self, _id: Option<String>) -> Result<(), String> {
            Err(ONLY_WINDOWS.into())
        }
    }
}

pub use imp::*;
