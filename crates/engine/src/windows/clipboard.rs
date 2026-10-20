//! Unicode text clipboard.

use crate::engine::{BackendError, ErrorCategory};
use ::windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use ::windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardData, OpenClipboard, SetClipboardData};
use ::windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
use ::windows::Win32::System::Ole::CF_UNICODETEXT;
use std::time::Duration;

/// Holds the clipboard open; closes it on drop.
struct Open;

impl Open {
    fn acquire() -> Result<Self, BackendError> {
        // Another app may hold the clipboard briefly; retry for ~500 ms.
        for _ in 0..25 {
            // SAFETY: no owner window; paired with CloseClipboard in Drop.
            if unsafe { OpenClipboard(None) }.is_ok() {
                return Ok(Open);
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        Err(BackendError::new(ErrorCategory::Environment, "the clipboard is busy (another app is using it)"))
    }
}

impl Drop for Open {
    fn drop(&mut self) {
        // SAFETY: the clipboard was opened by `acquire` on this thread.
        let _ignored = unsafe { CloseClipboard() };
    }
}

/// Reads the clipboard as text (empty when it holds no text).
pub fn get_text() -> Result<String, BackendError> {
    let _open = Open::acquire()?;
    // SAFETY: the clipboard is open; the handle is locked only while copying out of it.
    unsafe {
        let Ok(h) = GetClipboardData(u32::from(CF_UNICODETEXT.0)) else { return Ok(String::new()) };
        let hg = HGLOBAL(h.0);
        let p = GlobalLock(hg).cast::<u16>();
        if p.is_null() {
            return Ok(String::new());
        }
        // Never read past the allocation, even when another app stored text without a NUL.
        let max = (GlobalSize(hg) / 2).min(64 * 1024 * 1024);
        let mut len = 0usize;
        while len < max && *p.add(len) != 0 {
            len += 1;
        }
        let text = String::from_utf16_lossy(std::slice::from_raw_parts(p, len));
        let _unlocked = GlobalUnlock(hg);
        Ok(text)
    }
}

/// Replaces the clipboard with text.
pub fn set_text(text: &str) -> Result<(), BackendError> {
    let units: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let bytes = units.len() * 2;
    let fail = |what: &str, e: ::windows::core::Error| BackendError::new(ErrorCategory::Environment, format!("{what}: {e}"));
    let _open = Open::acquire()?;
    // SAFETY: the clipboard is open; the allocation is sized for `units` and ownership passes
    // to the system on a successful SetClipboardData.
    unsafe {
        EmptyClipboard().map_err(|e| fail("cannot clear the clipboard", e))?;
        let hg = GlobalAlloc(GMEM_MOVEABLE, bytes).map_err(|e| fail("out of memory", e))?;
        let p = GlobalLock(hg).cast::<u16>();
        if p.is_null() {
            return Err(BackendError::new(ErrorCategory::Environment, "cannot lock clipboard memory"));
        }
        std::ptr::copy_nonoverlapping(units.as_ptr(), p, units.len());
        let _unlocked = GlobalUnlock(hg);
        if let Err(e) = SetClipboardData(u32::from(CF_UNICODETEXT.0), Some(HANDLE(hg.0))) {
            // Ownership did not pass to the system; free the allocation ourselves.
            let _freed = GlobalFree(Some(hg));
            return Err(fail("cannot write the clipboard", e));
        }
    }
    Ok(())
}
