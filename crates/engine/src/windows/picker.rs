//! Full-screen crosshair overlay for `pick_point`: dims every monitor, waits for a left click
//! (right click / Esc cancels) and returns the point in physical virtual-desktop pixels.

use super::{screen, wide};
use crate::engine::{BackendError, ErrorCategory};
use ::windows::core::PCWSTR;
use ::windows::Win32::Foundation::{COLORREF, HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
use ::windows::Win32::Graphics::Gdi::{GetStockObject, BLACK_BRUSH, HBRUSH};
use ::windows::Win32::System::LibraryLoader::GetModuleHandleW;
use ::windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, GetMessageW, LoadCursorW, PostQuitMessage,
    RegisterClassExW, SetCursor, SetForegroundWindow, SetLayeredWindowAttributes, SetTimer, TranslateMessage, IDC_CROSS, LWA_ALPHA, MSG,
    WM_DESTROY, WM_KEYDOWN, WM_LBUTTONDOWN, WM_RBUTTONDOWN, WM_SETCURSOR, WM_TIMER, WNDCLASSEXW, WS_EX_LAYERED, WS_EX_TOOLWINDOW,
    WS_EX_TOPMOST, WS_POPUP, WS_VISIBLE,
};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

static BUSY: AtomicBool = AtomicBool::new(false);
static RESULT: Mutex<Option<Result<(i32, i32), String>>> = Mutex::new(None);

fn finish(hwnd: HWND, r: Result<(i32, i32), String>) {
    *RESULT.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = Some(r);
    // SAFETY: destroying our own overlay window on its thread.
    let _ignored = unsafe { DestroyWindow(hwnd) };
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    match msg {
        WM_SETCURSOR => {
            // SAFETY: system cursor resource.
            if let Ok(c) = unsafe { LoadCursorW(None, IDC_CROSS) } {
                // SAFETY: valid cursor handle.
                unsafe { SetCursor(Some(c)) };
            }
            LRESULT(1)
        }
        WM_LBUTTONDOWN => {
            let mut p = POINT::default();
            // SAFETY: `p` is a valid out-param.
            let r = unsafe { GetCursorPos(&mut p) }.map(|()| (p.x, p.y)).map_err(|e| e.to_string());
            finish(hwnd, r);
            LRESULT(0)
        }
        WM_RBUTTONDOWN => {
            finish(hwnd, Err("cancelled".into()));
            LRESULT(0)
        }
        WM_KEYDOWN if wparam.0 == 0x1B => {
            finish(hwnd, Err("cancelled".into()));
            LRESULT(0)
        }
        WM_TIMER => {
            finish(hwnd, Err("timed out".into()));
            LRESULT(0)
        }
        WM_DESTROY => {
            // SAFETY: ends this thread's message loop.
            unsafe { PostQuitMessage(0) };
            LRESULT(0)
        }
        // SAFETY: default handling for every other message.
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

fn run_overlay(timeout: Duration) -> Result<(), String> {
    let class = wide("AutoFlowPointPicker");
    let title = wide("AutoFlow — click a point (Esc to cancel)");
    let v = screen::virtual_screen();
    // SAFETY: registers and creates a window owned by this thread, then pumps its messages.
    unsafe {
        let module = GetModuleHandleW(PCWSTR::null()).map_err(|e| e.to_string())?;
        let instance = HINSTANCE(module.0);
        let wc = WNDCLASSEXW {
            cbSize: u32::try_from(std::mem::size_of::<WNDCLASSEXW>()).unwrap_or(80),
            lpfnWndProc: Some(proc),
            hInstance: instance,
            hbrBackground: HBRUSH(GetStockObject(BLACK_BRUSH).0),
            lpszClassName: PCWSTR(class.as_ptr()),
            ..Default::default()
        };
        // Returns 0 when the class already exists from an earlier pick, which is fine.
        let _atom = RegisterClassExW(&wc);
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_LAYERED | WS_EX_TOOLWINDOW,
            PCWSTR(class.as_ptr()),
            PCWSTR(title.as_ptr()),
            WS_POPUP | WS_VISIBLE,
            v.left,
            v.top,
            v.right - v.left,
            v.bottom - v.top,
            None,
            None,
            Some(instance),
            None,
        )
        .map_err(|e| e.to_string())?;
        SetLayeredWindowAttributes(hwnd, COLORREF(0), 70, LWA_ALPHA).map_err(|e| e.to_string())?;
        let _fg = SetForegroundWindow(hwnd);
        SetTimer(Some(hwnd), 1, u32::try_from(timeout.as_millis()).unwrap_or(u32::MAX), None);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            let _translated = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
    Ok(())
}

/// Shows the overlay and waits for a click (at most `timeout`).
pub fn pick_point(timeout: Duration) -> Result<(i32, i32), BackendError> {
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err(BackendError::new(ErrorCategory::User, "a point is already being picked"));
    }
    *RESULT.lock().unwrap_or_else(std::sync::PoisonError::into_inner) = None;
    let joined = std::thread::Builder::new().name("autoflow-picker".into()).spawn(move || run_overlay(timeout)).map(|j| j.join());
    BUSY.store(false, Ordering::SeqCst);
    match joined {
        Ok(Ok(Ok(()))) => {}
        Ok(Ok(Err(e))) => return Err(BackendError::new(ErrorCategory::Environment, format!("cannot show the picker: {e}"))),
        _ => return Err(BackendError::new(ErrorCategory::Internal, "the picker thread failed")),
    }
    match RESULT.lock().unwrap_or_else(std::sync::PoisonError::into_inner).take() {
        Some(Ok(p)) => Ok(p),
        Some(Err(why)) => Err(BackendError::new(ErrorCategory::User, format!("point picking {why}"))),
        None => Err(BackendError::new(ErrorCategory::User, "point picking cancelled")),
    }
}
