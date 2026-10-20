//! Low-level keyboard and mouse hooks (`WH_KEYBOARD_LL`, `WH_MOUSE_LL`) on a dedicated
//! message-loop thread, fanned out to registered [`HookSink`]s (the recorder and Keyforge).
//!
//! The hook thread runs only while at least one sink is registered. Callbacks must stay fast
//! (Windows silently unhooks slow hooks), so sinks hand work to their own threads.

use super::keymap::{key_name, produced_text};
use super::INJECTED_MARKER;
use crate::schema::{Modifier, MouseButton};
use ::windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
use ::windows::Win32::System::Threading::GetCurrentThreadId;
use ::windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, GetKeyState};
use ::windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetForegroundWindow, GetMessageW, GetWindowThreadProcessId, PeekMessageW, PostThreadMessageW, SetWindowsHookExW,
    UnhookWindowsHookEx, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED, LLMHF_INJECTED, MSG, MSLLHOOKSTRUCT, PM_NOREMOVE, WH_KEYBOARD_LL,
    WH_MOUSE_LL, WM_KEYDOWN, WM_KEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_MBUTTONDOWN, WM_MBUTTONUP, WM_MOUSEHWHEEL, WM_MOUSEWHEEL, WM_QUIT,
    WM_RBUTTONDOWN, WM_RBUTTONUP, WM_SYSKEYDOWN, WM_SYSKEYUP, WM_USER, WM_XBUTTONDOWN, WM_XBUTTONUP,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex, RwLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// A physical (or foreign-injected) input event seen by the hooks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RawEvent {
    /// Key transition.
    Key {
        /// Virtual key.
        vk: u32,
        /// W3C key name (layout aware).
        key: String,
        /// Character produced (key down only).
        text: Option<String>,
        /// Key pressed (false = released).
        down: bool,
        /// Modifiers held besides this key.
        modifiers: Vec<Modifier>,
        /// Injected by any software.
        injected: bool,
        /// Injected by AutoFlow itself.
        ours: bool,
    },
    /// Mouse button transition.
    Button {
        /// Button.
        button: MouseButton,
        /// Pressed.
        down: bool,
        /// X (physical).
        x: i32,
        /// Y (physical).
        y: i32,
        /// Injected by any software.
        injected: bool,
        /// Injected by AutoFlow itself.
        ours: bool,
    },
    /// Wheel notch(es); `delta` uses the Windows sign (positive = up / right).
    Wheel {
        /// Horizontal wheel.
        horizontal: bool,
        /// Delta (120 per notch).
        delta: i32,
        /// X (physical).
        x: i32,
        /// Y (physical).
        y: i32,
        /// Injected by any software.
        injected: bool,
        /// Injected by AutoFlow itself.
        ours: bool,
    },
}

/// Receives hook events; returning `true` swallows the event.
pub trait HookSink: Send + Sync {
    /// Called on the hook thread. Must return within a few milliseconds.
    fn on_event(&self, e: &RawEvent) -> bool;
}

type Sinks = Vec<(&'static str, Arc<dyn HookSink>)>;

static SINKS: RwLock<Sinks> = RwLock::new(Vec::new());
static CAPS_ON: AtomicBool = AtomicBool::new(false);

struct HookThread {
    thread_id: u32,
    join: JoinHandle<()>,
}

static THREAD: Mutex<Option<HookThread>> = Mutex::new(None);

fn down(vk: i32) -> bool {
    // SAFETY: GetAsyncKeyState has no preconditions.
    let state = unsafe { GetAsyncKeyState(vk) };
    state < 0
}

fn held_modifiers(except_vk: u32) -> Vec<Modifier> {
    let mut m = Vec::new();
    let is = |group: &[u32]| group.contains(&except_vk);
    if !is(&[0x11, 0xA2, 0xA3]) && down(0x11) {
        m.push(Modifier::Ctrl);
    }
    if !is(&[0x12, 0xA4, 0xA5]) && down(0x12) {
        m.push(Modifier::Alt);
    }
    if !is(&[0x10, 0xA0, 0xA1]) && down(0x10) {
        m.push(Modifier::Shift);
    }
    if !is(&[0x5B, 0x5C]) && (down(0x5B) || down(0x5C)) {
        m.push(Modifier::Meta);
    }
    m
}

fn dispatch(e: &RawEvent) -> bool {
    let sinks = SINKS.read().unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut swallow = false;
    for (_, s) in sinks.iter() {
        // The hook procs are `extern "system"`: a panic unwinding out of them aborts the process (and
        // with it every run and the emergency stop). A failing sink is skipped and never swallows input.
        swallow |= std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| s.on_event(e))).unwrap_or(false);
    }
    swallow
}

unsafe extern "system" fn keyboard_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        // SAFETY: for HC_ACTION, lparam points to a KBDLLHOOKSTRUCT owned by the system.
        let k = unsafe { &*(lparam.0 as *const KBDLLHOOKSTRUCT) };
        let msg = u32::try_from(wparam.0).unwrap_or(0);
        let is_down = msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN;
        let is_up = msg == WM_KEYUP || msg == WM_SYSKEYUP;
        if is_down || is_up {
            let injected = k.flags.0 & LLKHF_INJECTED.0 != 0;
            let ours = injected && k.dwExtraInfo == INJECTED_MARKER;
            if is_down && k.vkCode == 0x14 && !injected {
                CAPS_ON.fetch_xor(true, Ordering::SeqCst);
            }
            let text = if is_down {
                let shift = down(0x10);
                let altgr = down(0xA5) && down(0x11);
                // SAFETY: plain Win32 queries.
                let thread = unsafe { GetWindowThreadProcessId(GetForegroundWindow(), None) };
                let ctrl_chord = down(0x11) && !altgr;
                if ctrl_chord {
                    None
                } else {
                    produced_text(k.vkCode, k.scanCode, shift, CAPS_ON.load(Ordering::SeqCst), altgr, thread)
                }
            } else {
                None
            };
            let e = RawEvent::Key {
                vk: k.vkCode,
                key: key_name(k.vkCode, text.as_deref()),
                text,
                down: is_down,
                modifiers: held_modifiers(k.vkCode),
                injected,
                ours,
            };
            if dispatch(&e) {
                return LRESULT(1);
            }
        }
    }
    // SAFETY: forwards to the next hook as required.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

unsafe extern "system" fn mouse_proc(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 {
        let msg = u32::try_from(wparam.0).unwrap_or(0);
        // SAFETY: for HC_ACTION, lparam points to an MSLLHOOKSTRUCT owned by the system.
        let m = unsafe { &*(lparam.0 as *const MSLLHOOKSTRUCT) };
        let injected = m.flags & LLMHF_INJECTED != 0;
        let ours = injected && m.dwExtraInfo == INJECTED_MARKER;
        let hi = i16::from_ne_bytes(u16::try_from(m.mouseData >> 16).unwrap_or(0).to_ne_bytes());
        let (x, y) = (m.pt.x, m.pt.y);
        let button = |b: MouseButton, down: bool| Some(RawEvent::Button { button: b, down, x, y, injected, ours });
        let e = match msg {
            WM_LBUTTONDOWN => button(MouseButton::Left, true),
            WM_LBUTTONUP => button(MouseButton::Left, false),
            WM_RBUTTONDOWN => button(MouseButton::Right, true),
            WM_RBUTTONUP => button(MouseButton::Right, false),
            WM_MBUTTONDOWN => button(MouseButton::Middle, true),
            WM_MBUTTONUP => button(MouseButton::Middle, false),
            WM_XBUTTONDOWN | WM_XBUTTONUP => {
                let b = if hi == 2 { MouseButton::X2 } else { MouseButton::X1 };
                button(b, msg == WM_XBUTTONDOWN)
            }
            WM_MOUSEWHEEL | WM_MOUSEHWHEEL => {
                Some(RawEvent::Wheel { horizontal: msg == WM_MOUSEHWHEEL, delta: i32::from(hi), x, y, injected, ours })
            }
            _ => None,
        };
        if let Some(e) = e {
            if dispatch(&e) {
                return LRESULT(1);
            }
        }
    }
    // SAFETY: forwards to the next hook as required.
    unsafe { CallNextHookEx(None, code, wparam, lparam) }
}

fn start_thread() -> Result<HookThread, String> {
    let (ready_tx, ready_rx) = mpsc::channel::<Result<u32, String>>();
    // SAFETY: reads the toggle state once to seed CapsLock tracking.
    CAPS_ON.store(unsafe { GetKeyState(0x14) } & 1 != 0, Ordering::SeqCst);
    let join = std::thread::Builder::new()
        .name("autoflow-hooks".into())
        .spawn(move || {
            // SAFETY: hooks are installed, pumped and removed on this thread.
            unsafe {
                let mut msg = MSG::default();
                let _has = PeekMessageW(&mut msg, None, WM_USER, WM_USER, PM_NOREMOVE);
                let module = GetModuleHandleW(None).ok().map(|m| ::windows::Win32::Foundation::HINSTANCE(m.0));
                let kb = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_proc), module, 0);
                let ms = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_proc), module, 0);
                match (&kb, &ms) {
                    (Ok(_), Ok(_)) => {
                        let _sent = ready_tx.send(Ok(GetCurrentThreadId()));
                    }
                    _ => {
                        let _sent = ready_tx.send(Err("Windows refused to install the input hooks".into()));
                    }
                }
                if kb.is_ok() && ms.is_ok() {
                    while GetMessageW(&mut msg, None, 0, 0).0 > 0 {}
                }
                if let Ok(h) = kb {
                    let _ignored = UnhookWindowsHookEx(h);
                }
                if let Ok(h) = ms {
                    let _ignored = UnhookWindowsHookEx(h);
                }
            }
        })
        .map_err(|e| format!("cannot start the hook thread: {e}"))?;
    let thread_id = ready_rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "hook thread did not start".to_owned())??;
    Ok(HookThread { thread_id, join })
}

/// Registers (or replaces) a sink and makes sure the hooks are running.
pub fn add_sink(name: &'static str, sink: Arc<dyn HookSink>) -> Result<(), String> {
    {
        let mut sinks = SINKS.write().unwrap_or_else(std::sync::PoisonError::into_inner);
        sinks.retain(|(n, _)| *n != name);
        sinks.push((name, sink));
    }
    let mut t = THREAD.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if t.is_none() {
        match start_thread() {
            Ok(h) => *t = Some(h),
            Err(e) => {
                SINKS.write().unwrap_or_else(std::sync::PoisonError::into_inner).retain(|(n, _)| *n != name);
                return Err(e);
            }
        }
    }
    Ok(())
}

/// Removes a sink; the hooks stop when none remain.
pub fn remove_sink(name: &'static str) {
    let empty = {
        let mut sinks = SINKS.write().unwrap_or_else(std::sync::PoisonError::into_inner);
        sinks.retain(|(n, _)| *n != name);
        sinks.is_empty()
    };
    if empty {
        let handle = THREAD.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take();
        if let Some(h) = handle {
            // SAFETY: asks the hook thread's loop to exit; it unhooks itself.
            let _ignored = unsafe { PostThreadMessageW(h.thread_id, WM_QUIT, WPARAM(0), LPARAM(0)) };
            let _joined = h.join.join();
        }
    }
}

/// Milliseconds since an instant, saturating.
pub(crate) fn ms_since(start: Instant) -> u64 {
    u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
}
