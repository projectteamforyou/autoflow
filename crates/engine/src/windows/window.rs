//! Top-level window lookup (`EnumWindows`) and window operations.

use super::input;
use super::keymap::KeySpec;
use super::process::{exe_name, same_app, window_pid, window_title};
use crate::engine::{BackendError, ErrorCategory, RunControl};
use crate::schema::{Rect, WindowMatch, WindowOp};
use ::windows::core::BOOL;
use ::windows::Win32::Foundation::{HWND, LPARAM, RECT, WPARAM};
use ::windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowRect, IsIconic, IsWindowVisible, IsZoomed, PostMessageW, SetForegroundWindow, SetWindowPos, ShowWindow,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SW_MAXIMIZE, SW_MINIMIZE, SW_RESTORE, WM_CLOSE,
};
use std::time::{Duration, Instant};

/// A visible top-level window.
#[derive(Debug, Clone)]
pub struct WindowInfo {
    /// Handle.
    pub hwnd: HWND,
    /// Title.
    pub title: String,
    /// Executable name.
    pub app: String,
}

unsafe extern "system" fn collect(hwnd: HWND, data: LPARAM) -> BOOL {
    // SAFETY: `data` is the `&mut Vec<HWND>` passed by `windows()` during the synchronous call.
    let out = unsafe { &mut *(data.0 as *mut Vec<HWND>) };
    // SAFETY: plain Win32 query on a handle provided by EnumWindows.
    if unsafe { IsWindowVisible(hwnd) }.as_bool() {
        out.push(hwnd);
    }
    BOOL(1)
}

/// Visible top-level windows with a title, in Z order (topmost first).
pub fn windows() -> Vec<WindowInfo> {
    let mut handles: Vec<HWND> = Vec::new();
    // SAFETY: the callback only pushes into `handles`, which outlives the call.
    let _ok = unsafe { EnumWindows(Some(collect), LPARAM(std::ptr::addr_of_mut!(handles) as isize)) };
    handles
        .into_iter()
        .filter_map(|hwnd| {
            let title = window_title(hwnd);
            if title.is_empty() {
                return None;
            }
            let app = exe_name(window_pid(hwnd)).unwrap_or_default();
            Some(WindowInfo { hwnd, title, app })
        })
        .collect()
}

/// First window matching a title substring (case-insensitive) and/or executable name.
pub fn find(m: &WindowMatch) -> Option<WindowInfo> {
    let title = m.title.as_deref().map(str::to_lowercase).filter(|t| !t.is_empty());
    let app = m.app.as_deref().filter(|a| !a.trim().is_empty());
    if title.is_none() && app.is_none() {
        return None;
    }
    windows()
        .into_iter()
        .find(|w| title.as_ref().map_or(true, |t| w.title.to_lowercase().contains(t)) && app.map_or(true, |a| same_app(&w.app, a)))
}

/// Waits up to `timeout` for a matching window (apps launched just before take a moment).
pub fn wait_for(m: &WindowMatch, timeout: Duration, control: &RunControl) -> Result<WindowInfo, BackendError> {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(w) = find(m) {
            return Ok(w);
        }
        if Instant::now() >= deadline {
            let what = [m.title.as_deref().map(|t| format!("title \"{t}\"")), m.app.as_deref().map(|a| format!("app {a}"))]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(", ");
            return Err(BackendError::new(ErrorCategory::Target, format!("window not found ({what})")));
        }
        input::pause(100, control)?;
    }
}

/// Brings a window to the foreground (restoring it when minimized).
pub fn focus(hwnd: HWND) -> Result<(), BackendError> {
    // SAFETY: plain Win32 calls on a window handle.
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _was_visible = ShowWindow(hwnd, SW_RESTORE);
        }
        if SetForegroundWindow(hwnd).as_bool() {
            return Ok(());
        }
    }
    // Foreground lock: a synthetic Alt tap grants this process the right to switch windows.
    let alt = KeySpec { vk: 0x12, extended: false, implied: [false; 3] };
    input::key_press(alt, &[])?;
    // SAFETY: as above.
    if unsafe { SetForegroundWindow(hwnd) }.as_bool() {
        Ok(())
    } else {
        Err(BackendError::new(ErrorCategory::Permission, "Windows refused to switch to the window"))
    }
}

#[allow(clippy::cast_possible_truncation)]
fn px(v: f64) -> i32 {
    v.round().clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

/// Applies a window step.
pub fn apply(op: WindowOp, m: &WindowMatch, rect: Option<&Rect>, control: &RunControl) -> Result<(), BackendError> {
    let w = wait_for(m, Duration::from_secs(5), control)?;
    let hwnd = w.hwnd;
    let need_rect = || rect.ok_or_else(|| BackendError::new(ErrorCategory::Validation, "rect is required for move/resize"));
    // SAFETY: plain Win32 calls on a window handle obtained from EnumWindows.
    unsafe {
        match op {
            WindowOp::Focus => return focus(hwnd),
            WindowOp::Minimize => {
                let _prev = ShowWindow(hwnd, SW_MINIMIZE);
            }
            WindowOp::Maximize => {
                let _prev = ShowWindow(hwnd, SW_MAXIMIZE);
            }
            WindowOp::Restore => {
                let _prev = ShowWindow(hwnd, SW_RESTORE);
            }
            WindowOp::Close => {
                PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))
                    .map_err(|e| BackendError::action(format!("cannot close the window: {e}")))?;
            }
            WindowOp::Move | WindowOp::Resize => {
                let r = need_rect()?;
                if IsZoomed(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                    let _prev = ShowWindow(hwnd, SW_RESTORE);
                }
                let mut cur = RECT::default();
                GetWindowRect(hwnd, &mut cur).map_err(|e| BackendError::action(format!("cannot read window bounds: {e}")))?;
                let (x, y, cx, cy, flags) = if op == WindowOp::Move {
                    // A move step with a size also resizes (window-layout template).
                    let sized = r.w > 0.0 && r.h > 0.0;
                    let flags = if sized { SWP_NOZORDER | SWP_NOACTIVATE } else { SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE };
                    (px(r.x), px(r.y), px(r.w), px(r.h), flags)
                } else {
                    (cur.left, cur.top, px(r.w), px(r.h), SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE)
                };
                SetWindowPos(hwnd, None, x, y, cx, cy, flags).map_err(|e| BackendError::action(format!("cannot move the window: {e}")))?;
            }
        }
    }
    Ok(())
}
