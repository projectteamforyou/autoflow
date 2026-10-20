//! Input recording for `record_start` / `record_stop`.
//!
//! The hook sink only timestamps and forwards events; a worker thread converts them into
//! [`RecordedEvent`]s, decides sensitivity (UI Automation `IsPassword` on the focused control,
//! falling back to foreground-window heuristics) and masks sensitive keys before anything leaves
//! the process. AutoFlow's own injected input is never recorded.

use super::hooks::{self, ms_since, HookSink, RawEvent};
use super::{process, screen, uia};
use crate::engine::ScreenInfo;
use crate::record::RecordedEvent;
use regex::Regex;
use std::collections::HashMap;
use std::sync::{mpsc, Arc, OnceLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const SINK: &str = "recorder";

/// Receives each recorded event as it happens (for live UI updates).
pub type RecordCallback = Arc<dyn Fn(&RecordedEvent) + Send + Sync>;

struct Sink {
    start: Instant,
    tx: mpsc::Sender<(u64, RawEvent)>,
}

impl HookSink for Sink {
    fn on_event(&self, e: &RawEvent) -> bool {
        let ours = match e {
            RawEvent::Key { ours, .. } | RawEvent::Button { ours, .. } | RawEvent::Wheel { ours, .. } => *ours,
        };
        if !ours {
            let _sent = self.tx.send((ms_since(self.start), e.clone()));
        }
        false
    }
}

fn sensitive_title() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    #[allow(clippy::unwrap_used)] // constant pattern
    R.get_or_init(|| {
        Regex::new(r"(?i)(password|passwort|mot de passe|contraseña|senha|비밀번호|암호|パスワード|密码|密碼|sign[ -]?in|log[ -]?in|로그인|credential|bitwarden|1password|keepass|lastpass)").unwrap()
    })
}

struct Sensitivity {
    checked_at: Option<Instant>,
    value: bool,
}

impl Sensitivity {
    fn current(&mut self) -> bool {
        if self.checked_at.is_some_and(|t| t.elapsed() < Duration::from_millis(250)) {
            return self.value;
        }
        let by_uia = uia::focused_is_password();
        self.value = by_uia.unwrap_or_else(|| process::foreground().is_some_and(|(_, title)| sensitive_title().is_match(&title)));
        self.checked_at = Some(Instant::now());
        self.value
    }
}

/// A running recording.
pub struct Recorder {
    worker: Option<JoinHandle<Vec<RecordedEvent>>>,
    screen: ScreenInfo,
}

impl Recorder {
    /// Installs the hooks and starts recording.
    ///
    /// # Errors
    /// Fails when the hooks cannot be installed.
    pub fn start(mask_sensitive: bool, on_event: RecordCallback) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<(u64, RawEvent)>();
        let worker = std::thread::Builder::new()
            .name("autoflow-recorder".into())
            .spawn(move || {
                let mut out = Vec::new();
                let mut sens = Sensitivity { checked_at: None, value: false };
                let mut held_sensitive: HashMap<u32, bool> = HashMap::new();
                // Monitors at recording start: each mouse event names the display it happened on.
                let displays = screen::displays();
                while let Ok((t, raw)) = rx.recv() {
                    let ev = match raw {
                        RawEvent::Key { vk, key, down, modifiers, .. } => {
                            let sensitive = if down {
                                let s = mask_sensitive && sens.current();
                                held_sensitive.insert(vk, s);
                                s
                            } else {
                                held_sensitive.remove(&vk).unwrap_or(false)
                            };
                            let sensitive = sensitive.then_some(true);
                            let e = if down {
                                RecordedEvent::KeyDown { t, key, modifiers, sensitive }
                            } else {
                                RecordedEvent::KeyUp { t, key, modifiers, sensitive }
                            };
                            e.masked()
                        }
                        RawEvent::Button { button, down, x, y, .. } => {
                            sens.checked_at = None; // a click can move focus
                            let display_id = screen::display_id_at(&displays, x, y);
                            if down {
                                RecordedEvent::MouseDown { t, x, y, button, display_id }
                            } else {
                                RecordedEvent::MouseUp { t, x, y, button, display_id }
                            }
                        }
                        RawEvent::Wheel { horizontal, delta, x, y, .. } => {
                            let display_id = screen::display_id_at(&displays, x, y);
                            if horizontal {
                                RecordedEvent::Wheel { t, dx: delta, dy: 0, x, y, display_id }
                            } else {
                                RecordedEvent::Wheel { t, dx: 0, dy: -delta, x, y, display_id }
                            }
                        }
                    };
                    let _ignored = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| on_event(&ev)));
                    out.push(ev);
                    if out.len() > 200_000 {
                        break;
                    }
                }
                out
            })
            .map_err(|e| format!("cannot start the recorder: {e}"))?;
        hooks::add_sink(SINK, Arc::new(Sink { start: Instant::now(), tx }))?;
        Ok(Self { worker: Some(worker), screen: screen::primary_screen_info() })
    }

    /// Stops recording and returns every event in time order.
    pub fn stop(mut self) -> (Vec<RecordedEvent>, ScreenInfo) {
        // Dropping the sink drops its sender, which ends the worker loop.
        hooks::remove_sink(SINK);
        let events = self.worker.take().and_then(|w| w.join().ok()).unwrap_or_default();
        (events, self.screen)
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        if self.worker.is_some() {
            hooks::remove_sink(SINK);
        }
    }
}
