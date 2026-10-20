//! Process helpers: executable names, foreground app, running processes, power state.

use super::from_wide;
use ::windows::core::PWSTR;
use ::windows::Win32::Foundation::{CloseHandle, HWND};
use ::windows::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use ::windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
use ::windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};
use ::windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId};
use std::collections::HashSet;

/// Executable file name (e.g. `msedge.exe`) of a process id.
pub fn exe_name(pid: u32) -> Option<String> {
    // SAFETY: the handle is closed before returning; the buffer is valid for the call.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = u32::try_from(buf.len()).unwrap_or(1024);
        let ok = QueryFullProcessImageNameW(h, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _closed = CloseHandle(h);
        if !ok {
            return None;
        }
        let path = String::from_utf16_lossy(&buf[..usize::try_from(len).unwrap_or(0).min(buf.len())]);
        path.rsplit(['\\', '/']).next().map(str::to_owned)
    }
}

/// Window title.
pub fn window_title(hwnd: HWND) -> String {
    // SAFETY: the buffer is sized from GetWindowTextLengthW.
    unsafe {
        let n = GetWindowTextLengthW(hwnd);
        if n <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; usize::try_from(n).unwrap_or(0) + 1];
        let got = GetWindowTextW(hwnd, &mut buf);
        String::from_utf16_lossy(&buf[..usize::try_from(got).unwrap_or(0).min(buf.len())])
    }
}

/// Process id owning a window.
pub fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    // SAFETY: `pid` is a valid out-param.
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

/// Foreground window's executable name and title.
pub fn foreground() -> Option<(String, String)> {
    // SAFETY: plain Win32 call.
    let hwnd = unsafe { GetForegroundWindow() };
    if hwnd.is_invalid() {
        return None;
    }
    let app = exe_name(window_pid(hwnd)).unwrap_or_default();
    Some((app, window_title(hwnd)))
}

/// Lower-cased executable names of all running processes.
pub fn running_processes() -> HashSet<String> {
    let mut out = HashSet::new();
    // SAFETY: the snapshot handle is closed before returning; the entry struct is sized.
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: u32::try_from(std::mem::size_of::<PROCESSENTRY32W>()).unwrap_or(568), ..Default::default() };
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                out.insert(from_wide(&e.szExeFile).to_lowercase());
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _closed = CloseHandle(snap);
    }
    out
}

/// `(on AC power, battery percent)` when known.
pub fn power_status() -> Option<(bool, Option<u8>)> {
    let mut s = SYSTEM_POWER_STATUS::default();
    // SAFETY: `s` is a valid out-param.
    unsafe { GetSystemPowerStatus(&mut s) }.ok()?;
    let ac = s.ACLineStatus == 1;
    let pct = (s.BatteryLifePercent <= 100).then_some(s.BatteryLifePercent);
    Some((ac, pct))
}

/// Case-insensitive app match: `msedge`, `msedge.exe` and `MSEDGE.EXE` are the same app.
pub fn same_app(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        let l = s.trim().to_lowercase();
        let l = l.rsplit(['\\', '/']).next().unwrap_or("").to_owned();
        l.strip_suffix(".exe").map_or(l.clone(), str::to_owned)
    };
    norm(a) == norm(b)
}
