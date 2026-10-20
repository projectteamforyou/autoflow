//! [`WindowsBackend`]: the real-input [`InputBackend`] for Windows.

use super::keymap::{modifier_vk, KeySpec};
use super::{capture, clipboard, input, ocr, screen, shell, uia, wide, window};
use crate::actions::{file_action, http_action};
use crate::display::DisplayInfo;
use crate::engine::{BackendError, ErrorCategory, InputAction, InputBackend, RunControl, ScreenInfo};
use crate::expr::default_random;
use crate::schema::{KeyAction, Platform, Target};
use crate::value::Value;
use ::windows::core::{BOOL, PCWSTR};
use ::windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use ::windows::Win32::System::Threading::GetCurrentThreadId;
use ::windows::Win32::UI::WindowsAndMessaging::{
    EnumThreadWindows, MessageBoxW, PostMessageW, IDYES, MB_ICONQUESTION, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO, WM_CLOSE,
};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

/// Services the desktop shell provides to runs.
pub trait Host: Send + Sync {
    /// Shows a notification (`notify` step).
    fn notify(&self, title: &str, body: &str) -> Result<(), BackendError>;
    /// Activates a Keyforge profile (`switchProfile` step).
    fn switch_profile(&self, profile_id: &str) -> Result<(), BackendError>;
    /// Local file of a template image reference (`findImage`, image targets).
    fn image_path(&self, reference: &str) -> Option<PathBuf>;
    /// Asks a yes/no question (`confirm` step). Defaults to a topmost message box.
    fn confirm(&self, message: &str, control: &RunControl) -> Result<bool, BackendError> {
        message_box_confirm(message, control)
    }
}

unsafe extern "system" fn close_window(hwnd: HWND, _: LPARAM) -> BOOL {
    // SAFETY: posting WM_CLOSE to a window of our own helper thread.
    let _ignored = unsafe { PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0)) };
    BOOL(1)
}

/// Topmost Yes/No message box that closes itself when the run is stopped.
pub fn message_box_confirm(message: &str, control: &RunControl) -> Result<bool, BackendError> {
    let (tx, rx) = mpsc::channel();
    let tid = Arc::new(AtomicU32::new(0));
    let tid2 = Arc::clone(&tid);
    let text = wide(message);
    let caption = wide("AutoFlow");
    std::thread::Builder::new()
        .name("autoflow-confirm".into())
        .spawn(move || {
            // SAFETY: strings are NUL-terminated and outlive the modal call.
            let answer = unsafe {
                tid2.store(GetCurrentThreadId(), Ordering::SeqCst);
                MessageBoxW(
                    None,
                    PCWSTR(text.as_ptr()),
                    PCWSTR(caption.as_ptr()),
                    MB_YESNO | MB_ICONQUESTION | MB_TOPMOST | MB_SETFOREGROUND,
                )
            };
            let _sent = tx.send(answer == IDYES);
        })
        .map_err(|e| BackendError::new(ErrorCategory::Internal, format!("cannot show the question: {e}")))?;
    loop {
        if control.is_stopped() {
            let id = tid.load(Ordering::SeqCst);
            if id != 0 {
                // SAFETY: enumerates the helper thread's windows to dismiss the message box.
                let _ignored = unsafe { EnumThreadWindows(id, Some(close_window), LPARAM(0)) };
            }
            return Err(BackendError::aborted());
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(answer) => return Ok(answer),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(BackendError::new(ErrorCategory::Internal, "the question closed unexpectedly"))
            }
        }
    }
}

/// Real input backend. Cheap to create; one per run.
///
/// Keys pressed by `key` steps with `action: "down"` (and their modifiers) are remembered until
/// the matching `up`; whatever is still held is released when the run is stopped and when the
/// backend is dropped at the end of the run, so a halted flow never leaves Shift/Win/… stuck.
pub struct WindowsBackend {
    host: Arc<dyn Host>,
    held: Vec<KeySpec>,
}

impl WindowsBackend {
    /// A backend using `host` for notifications, questions, profiles and template images.
    pub fn new(host: Arc<dyn Host>) -> Self {
        super::init_process();
        Self { host, held: Vec::new() }
    }

    fn track_down(&mut self, spec: KeySpec, modifiers: &[crate::schema::Modifier]) {
        let implied = input::all_modifiers(spec, modifiers);
        for k in implied.iter().map(|m| modifier_vk(*m)).chain(std::iter::once(spec)) {
            if !self.held.iter().any(|h| h.vk == k.vk) {
                self.held.push(k);
            }
        }
    }

    fn track_up(&mut self, spec: KeySpec, modifiers: &[crate::schema::Modifier]) {
        let released: Vec<u16> =
            input::all_modifiers(spec, modifiers).iter().map(|m| modifier_vk(*m).vk).chain(std::iter::once(spec.vk)).collect();
        self.held.retain(|h| !released.contains(&h.vk));
    }

    /// Releases every key still held down by this run (most recent first).
    pub fn release_all(&mut self) {
        let held = std::mem::take(&mut self.held);
        if !held.is_empty() {
            let _ignored = input::keys_up(&held.into_iter().rev().collect::<Vec<_>>());
        }
    }

    fn template(&self, reference: &str) -> Result<PathBuf, BackendError> {
        self.host
            .image_path(reference)
            .filter(|p| p.exists())
            .ok_or_else(|| BackendError::new(ErrorCategory::Target, format!("template image \"{reference}\" is not on this PC")))
    }

    fn resolve(&self, t: &Target, control: &RunControl) -> Result<(i32, i32), BackendError> {
        let p = match screen::resolve_basic(t, &default_random)? {
            Some(p) => p,
            None => match t {
                Target::Element { selector } => {
                    let r = uia::find_element(selector)?;
                    ((r.left + r.right) / 2, (r.top + r.bottom) / 2)
                }
                Target::Image(img) => {
                    let path = self.template(&img.reference)?;
                    let region = img.region.map(|r| {
                        #[allow(clippy::cast_possible_truncation)]
                        let i = |v: f64| v.round() as i32;
                        (i(r.x), i(r.y), i(r.w), i(r.h))
                    });
                    capture::find_on_screen(&path, img.confidence, region, 3000, control)?.ok_or_else(|| {
                        BackendError::new(ErrorCategory::Target, format!("image \"{}\" not found on screen", img.reference))
                    })?
                }
                _ => return Err(BackendError::new(ErrorCategory::Internal, "unresolved target")),
            },
        };
        if !screen::on_screen(p.0, p.1) {
            return Err(BackendError::new(ErrorCategory::Target, format!("point ({}, {}) is outside every monitor", p.0, p.1)));
        }
        Ok(p)
    }
}

impl InputBackend for WindowsBackend {
    fn platform(&self) -> Platform {
        Platform::Windows
    }

    fn screen(&mut self) -> Option<ScreenInfo> {
        Some(screen::primary_screen_info())
    }

    fn displays(&mut self) -> Vec<DisplayInfo> {
        screen::displays()
    }

    fn pointer_position(&mut self) -> Option<(f64, f64)> {
        screen::cursor_pos().ok().map(|(x, y)| (f64::from(x), f64::from(y)))
    }

    fn perform(&mut self, action: &InputAction, control: &RunControl) -> Result<Value, BackendError> {
        if control.is_stopped() {
            self.release_all();
            return Err(BackendError::aborted());
        }
        let r = self.perform_inner(action, control);
        if control.is_stopped() || r.as_ref().is_err_and(|e| e.aborted) {
            self.release_all();
        }
        r
    }

    fn confirm(&mut self, message: &str, control: &RunControl) -> Result<bool, BackendError> {
        self.host.confirm(message, control)
    }
}

impl Drop for WindowsBackend {
    fn drop(&mut self) {
        self.release_all();
    }
}

impl WindowsBackend {
    #[allow(clippy::too_many_lines)]
    fn perform_inner(&mut self, action: &InputAction, control: &RunControl) -> Result<Value, BackendError> {
        let is_input = matches!(
            action,
            InputAction::Click { .. }
                | InputAction::Move { .. }
                | InputAction::Drag { .. }
                | InputAction::Scroll { .. }
                | InputAction::Key { .. }
                | InputAction::Type { .. }
        );
        if is_input {
            input::ensure_default_desktop()?;
        }
        match action {
            InputAction::Click { target, button, clicks, hold_ms, modifiers } => {
                let (x, y) = self.resolve(target, control)?;
                input::move_to(x, y)?;
                input::click(*button, *clicks, *hold_ms, modifiers, control)?;
            }
            InputAction::Move { target, duration_ms } => {
                let to = self.resolve(target, control)?;
                if *duration_ms > 0 {
                    input::glide_to(screen::cursor_pos()?, to, *duration_ms, control)?;
                } else {
                    input::move_to(to.0, to.1)?;
                }
            }
            InputAction::Drag { from, to, duration_ms, button } => {
                let a = self.resolve(from, control)?;
                let b = self.resolve(to, control)?;
                input::move_to(a.0, a.1)?;
                input::button(*button, false)?;
                let guard = input::HeldGuard::new(Some(*button), &[]);
                input::pause(30, control)?;
                input::glide_to(a, b, (*duration_ms).max(20), control)?;
                guard.release()?;
            }
            InputAction::Scroll { dx, dy, target } => {
                if let Some(t) = target {
                    let (x, y) = self.resolve(t, control)?;
                    input::move_to(x, y)?;
                }
                input::wheel(*dx, *dy)?;
            }
            InputAction::Key { key, modifiers, action } => match super::keymap::key_spec(key) {
                Some(spec) => match action {
                    KeyAction::Press => input::key_press(spec, modifiers)?,
                    KeyAction::Down => {
                        input::key_transition(spec, modifiers, false)?;
                        self.track_down(spec, modifiers);
                    }
                    KeyAction::Up => {
                        input::key_transition(spec, modifiers, true)?;
                        self.track_up(spec, modifiers);
                    }
                },
                None if key.chars().count() == 1 && *action == KeyAction::Press && modifiers.is_empty() => {
                    input::type_text(key, 0, control)?;
                }
                None => return Err(BackendError::new(ErrorCategory::Validation, format!("unknown key \"{key}\""))),
            },
            InputAction::Type { text, per_char_delay_ms } => input::type_text(text, *per_char_delay_ms, control)?,
            InputAction::LaunchApp { app, args } => shell::launch_app(app, args)?,
            InputAction::OpenUrl { url } => shell::open_url(url)?,
            InputAction::Window { op, match_, rect } => window::apply(*op, match_, rect.as_ref(), control)?,
            InputAction::AndroidGlobal { .. } => {
                return Err(BackendError::new(ErrorCategory::Unsupported, "Android system actions are not available on Windows"));
            }
            InputAction::ClipboardSet { value } => clipboard::set_text(value)?,
            InputAction::ClipboardGet => return clipboard::get_text().map(Value::Str),
            InputAction::Notify { title, body } => self.host.notify(title, body)?,
            InputAction::Http { method, url, headers, body } => return http_action(control, *method, url, headers, body.as_deref()),
            InputAction::File { op, path, dest, content } => return file_action(*op, path, dest.as_deref(), content.as_deref()),
            InputAction::Ocr { region } => {
                #[allow(clippy::cast_possible_truncation)]
                let i = |v: f64| v.round() as i32;
                return ocr::recognize(i(region.x), i(region.y), i(region.w), i(region.h)).map(Value::Str);
            }
            InputAction::FindImage { reference, confidence, timeout_ms, region } => {
                let path = self.template(reference)?;
                #[allow(clippy::cast_possible_truncation)]
                let region = region.map(|r| (r.x.round() as i32, r.y.round() as i32, r.w.round() as i32, r.h.round() as i32));
                return Ok(capture::find_on_screen(&path, *confidence, region, *timeout_ms, control)?
                    .map_or(Value::Null, |(x, y)| Value::List(vec![Value::from(i64::from(x)), Value::from(i64::from(y))])));
            }
            #[allow(clippy::cast_possible_truncation)]
            InputAction::Pixel { x, y } => return capture::pixel_hex(x.round() as i32, y.round() as i32).map(Value::Str),
            #[allow(clippy::cast_possible_truncation)]
            InputAction::SceneHash { region: r } => {
                let i = |v: f64| v.round() as i32;
                return capture::scene_hash(i(r.x), i(r.y), i(r.w), i(r.h)).map(Value::Str);
            }
            InputAction::SwitchProfile { profile_id } => self.host.switch_profile(profile_id)?,
        }
        Ok(Value::Null)
    }
}
