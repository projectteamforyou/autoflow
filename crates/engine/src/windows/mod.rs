//! Windows platform layer (compiled only on Windows).
//!
//! - [`WindowsBackend`] — the [`crate::InputBackend`] used for real runs: `SendInput` mouse and
//!   keyboard (absolute virtual-desktop coordinates, per-monitor DPI aware), Unicode typing,
//!   clipboard, `ShellExecuteW`, window management, UI Automation element targets, OCR
//!   (`Windows.Media.Ocr`), template image search, file and HTTP actions.
//! - [`hotkeys::HotkeyService`] — global hotkeys via `RegisterHotKey` on a message-loop thread
//!   (emergency stop Ctrl+Alt+Esc by default).
//! - [`hooks::HookService`] — `WH_KEYBOARD_LL` / `WH_MOUSE_LL` hooks for recording and Keyforge
//!   remapping; events injected by AutoFlow carry [`INJECTED_MARKER`] and are ignored.
//! - [`credentials`] — Windows Credential Manager for `{{secret:…}}` values (`AutoFlow:` prefix).
//!
//! Safety rules enforced here: AutoFlow never automates the secure desktop (UAC prompts, the
//! lock screen, Ctrl+Alt+Del) — input actions fail with a `permission` error while it is active —
//! and never elevates (`runas`).

pub mod backend;
pub mod capture;
pub mod clipboard;
pub mod credentials;
pub mod device;
pub mod hooks;
pub mod hotkeys;
pub mod input;
pub mod keyforge;
pub mod keymap;
pub mod ocr;
pub mod picker;
pub mod process;
pub mod recorder;
pub mod screen;
pub mod shell;
pub mod uia;
pub mod window;

pub use backend::{Host, WindowsBackend};

/// `dwExtraInfo` stamped on every event AutoFlow injects ("AFLW"); hooks skip such events so
/// remapping and recording never see AutoFlow's own output.
pub const INJECTED_MARKER: usize = 0x4146_4C57;

/// NUL-terminated UTF-16 copy of `s` for Win32 APIs.
pub(crate) fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Converts a UTF-16 buffer up to the first NUL.
pub(crate) fn from_wide(buf: &[u16]) -> String {
    let end = buf.iter().position(|c| *c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}

/// Makes the process per-monitor DPI aware (v2) so every coordinate is in physical pixels.
/// Safe to call repeatedly; a manifest-declared awareness (Tauri) wins and is kept.
pub fn init_process() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        use ::windows::Win32::UI::HiDpi::{SetProcessDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
        // SAFETY: plain Win32 call with a constant context; failure (already set) is harmless.
        let _ignored = unsafe { SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    });
}
