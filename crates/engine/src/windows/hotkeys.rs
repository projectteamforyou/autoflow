//! Global hotkeys via `RegisterHotKey` on a dedicated message-loop thread.
//!
//! The owner registers a full set of bindings at once ([`HotkeyService::set`]); each binding is
//! an integer id the callback receives on `WM_HOTKEY`. The default emergency stop is
//! Ctrl+Alt+Esc ([`crate::schema::default_stop_hotkey`]).

use super::keymap::key_spec;
use crate::schema::{Hotkey, Modifier};
use ::windows::Win32::Foundation::{LPARAM, WPARAM};
use ::windows::Win32::System::Threading::GetCurrentThreadId;
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, MOD_SHIFT, MOD_WIN,
};
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_APP, WM_HOTKEY, WM_QUIT, WM_USER,
};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

const WM_APP_COMMAND: u32 = WM_APP + 0x41;

/// Callback receiving the id of a pressed hotkey (runs on the hotkey thread; keep it short).
pub type HotkeyCallback = Arc<dyn Fn(i32) + Send + Sync>;

type Reply = mpsc::Sender<Vec<(i32, Result<(), String>)>>;

enum Command {
    Set(Vec<(i32, Hotkey)>, Reply),
}

/// Owns the hotkey thread; unregisters everything when dropped.
pub struct HotkeyService {
    thread_id: u32,
    tx: mpsc::Sender<Command>,
    join: Option<JoinHandle<()>>,
}

fn modifiers(mods: &[Modifier]) -> HOT_KEY_MODIFIERS {
    let mut m = MOD_NOREPEAT;
    for x in mods {
        m |= match x {
            Modifier::Ctrl => MOD_CONTROL,
            Modifier::Alt => MOD_ALT,
            Modifier::Shift => MOD_SHIFT,
            Modifier::Meta => MOD_WIN,
        };
    }
    m
}

fn register(id: i32, h: &Hotkey) -> Result<(), String> {
    let spec = key_spec(&h.key).ok_or_else(|| format!("unknown key \"{}\"", h.key))?;
    // SAFETY: thread-level registration (no window) on the thread that runs the message loop.
    unsafe { RegisterHotKey(None, id, modifiers(&h.modifiers), u32::from(spec.vk)) }
        .map_err(|_| format!("{} is already used by Windows or another app", h.to_display_string()))
}

impl HotkeyService {
    /// Starts the message-loop thread.
    ///
    /// # Errors
    /// Fails when the thread cannot be created.
    pub fn start(on_hotkey: HotkeyCallback) -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<Command>();
        let (ready_tx, ready_rx) = mpsc::channel::<u32>();
        let join = std::thread::Builder::new()
            .name("autoflow-hotkeys".into())
            .spawn(move || {
                let mut msg = MSG::default();
                // SAFETY: creates this thread's message queue before announcing the thread id.
                unsafe {
                    let _has = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
                    let _sent = ready_tx.send(GetCurrentThreadId());
                }
                let mut registered: Vec<i32> = Vec::new();
                loop {
                    // SAFETY: standard message loop on this thread.
                    let r = unsafe { GetMessageW(&mut msg, None, 0, 0) };
                    if r.0 <= 0 {
                        break;
                    }
                    match msg.message {
                        WM_HOTKEY => {
                            let id = i32::try_from(msg.wParam.0).unwrap_or(-1);
                            let cb = Arc::clone(&on_hotkey);
                            let _ignored = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| cb(id)));
                        }
                        WM_APP_COMMAND => {
                            while let Ok(Command::Set(bindings, reply)) = rx.try_recv() {
                                for id in registered.drain(..) {
                                    // SAFETY: ids were registered on this thread.
                                    let _ignored = unsafe { UnregisterHotKey(None, id) };
                                }
                                let mut results = Vec::with_capacity(bindings.len());
                                for (id, h) in bindings {
                                    let r = register(id, &h);
                                    if r.is_ok() {
                                        registered.push(id);
                                    }
                                    results.push((id, r));
                                }
                                let _sent = reply.send(results);
                            }
                        }
                        _ => {}
                    }
                }
                for id in registered {
                    // SAFETY: ids were registered on this thread.
                    let _ignored = unsafe { UnregisterHotKey(None, id) };
                }
            })
            .map_err(|e| format!("cannot start the hotkey thread: {e}"))?;
        let thread_id = ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "hotkey thread did not start".to_owned())?;
        Ok(Self { thread_id, tx, join: Some(join) })
    }

    /// Replaces every registered hotkey; returns per-binding results.
    pub fn set(&self, bindings: Vec<(i32, Hotkey)>) -> Vec<(i32, Result<(), String>)> {
        let ids: Vec<i32> = bindings.iter().map(|(id, _)| *id).collect();
        let (reply_tx, reply_rx) = mpsc::channel();
        let fail_all = |why: &str| ids.iter().map(|id| (*id, Err(why.to_owned()))).collect();
        if self.tx.send(Command::Set(bindings, reply_tx)).is_err() {
            return fail_all("hotkey thread stopped");
        }
        // SAFETY: wakes the message loop of the hotkey thread.
        if unsafe { PostThreadMessageW(self.thread_id, WM_APP_COMMAND, WPARAM(0), LPARAM(0)) }.is_err() {
            return fail_all("hotkey thread is not responding");
        }
        reply_rx.recv_timeout(Duration::from_secs(5)).unwrap_or_else(|_| fail_all("hotkey thread timed out"))
    }
}

impl Drop for HotkeyService {
    fn drop(&mut self) {
        // SAFETY: asks the loop to exit; unregistration happens on its own thread.
        let _ignored = unsafe { PostThreadMessageW(self.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
        if let Some(j) = self.join.take() {
            let _joined = j.join();
        }
    }
}
