//! Monitors, DPI and target resolution in physical virtual-desktop pixels.

use crate::bridge::DeviceScreen;
use crate::display::DisplayInfo;
use crate::engine::{BackendError, ErrorCategory, ScreenInfo};
use crate::schema::{Pick, Rect, Space, Target};
use crate::value::js_round;
use ::windows::core::BOOL;
use ::windows::Win32::Foundation::{LPARAM, POINT, RECT};
use ::windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, GetMonitorInfoW, HDC, HMONITOR, MONITORINFO, MONITORINFOEXW};
use ::windows::Win32::UI::HiDpi::{GetDpiForMonitor, MDT_EFFECTIVE_DPI};
use ::windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, GetSystemMetrics, GetWindowRect, MONITORINFOF_PRIMARY, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN,
    SM_XVIRTUALSCREEN, SM_YVIRTUALSCREEN,
};

/// One monitor in physical pixels.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Monitor {
    /// Bounds in virtual-desktop coordinates.
    pub rect: RECT,
    /// Work area (bounds minus taskbars).
    pub work: RECT,
    /// Primary monitor.
    pub primary: bool,
    /// Effective DPI scale (1.0 = 96 DPI).
    pub scale: f64,
    /// Device name (`\\.\DISPLAY1`), NUL-terminated UTF-16.
    pub device: [u16; 32],
}

impl Monitor {
    /// Width in px.
    pub fn width(&self) -> i32 {
        self.rect.right - self.rect.left
    }
    /// Height in px.
    pub fn height(&self) -> i32 {
        self.rect.bottom - self.rect.top
    }
    /// Stable display id: the device name, e.g. `\\.\DISPLAY2`.
    pub fn id(&self) -> String {
        super::from_wide(&self.device)
    }
}

fn to_rect(r: &RECT) -> Rect {
    Rect { x: f64::from(r.left), y: f64::from(r.top), w: f64::from(r.right - r.left), h: f64::from(r.bottom - r.top) }
}

unsafe extern "system" fn collect_monitor(hmon: HMONITOR, _hdc: HDC, _rect: *mut RECT, data: LPARAM) -> BOOL {
    // SAFETY: `data` is the `&mut Vec<Monitor>` passed by `monitors()` for the duration of the
    // synchronous EnumDisplayMonitors call.
    let out = unsafe { &mut *(data.0 as *mut Vec<Monitor>) };
    let mut ex = MONITORINFOEXW::default();
    ex.monitorInfo.cbSize = u32::try_from(std::mem::size_of::<MONITORINFOEXW>()).unwrap_or(104);
    // SAFETY: `ex` is a properly sized MONITORINFOEXW whose first member is the MONITORINFO the
    // API fills; cbSize tells it the extended layout (device name) is available.
    if unsafe { GetMonitorInfoW(hmon, std::ptr::addr_of_mut!(ex).cast::<MONITORINFO>()) }.as_bool() {
        let info = ex.monitorInfo;
        let (mut dx, mut dy) = (96u32, 96u32);
        // SAFETY: out-params are valid u32s.
        let scale = if unsafe { GetDpiForMonitor(hmon, MDT_EFFECTIVE_DPI, &mut dx, &mut dy) }.is_ok() { f64::from(dx) / 96.0 } else { 1.0 };
        out.push(Monitor {
            rect: info.rcMonitor,
            work: info.rcWork,
            primary: info.dwFlags & MONITORINFOF_PRIMARY != 0,
            scale,
            device: ex.szDevice,
        });
    }
    BOOL(1)
}

/// All monitors, primary first.
pub fn monitors() -> Vec<Monitor> {
    super::init_process();
    let mut out: Vec<Monitor> = Vec::new();
    // SAFETY: the callback only writes into `out`, which outlives the call.
    let _ok = unsafe { EnumDisplayMonitors(None, None, Some(collect_monitor), LPARAM(std::ptr::addr_of_mut!(out) as isize)) };
    out.sort_by_key(|m| (!m.primary, m.rect.left, m.rect.top));
    out
}

/// Bounds of the whole virtual desktop.
pub fn virtual_screen() -> RECT {
    // SAFETY: GetSystemMetrics has no preconditions.
    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        RECT { left: x, top: y, right: x + GetSystemMetrics(SM_CXVIRTUALSCREEN), bottom: y + GetSystemMetrics(SM_CYVIRTUALSCREEN) }
    }
}

/// Primary monitor geometry as reported to flows (`ScreenInfo`).
pub fn primary_screen_info() -> ScreenInfo {
    let mons = monitors();
    mons.first().map_or(ScreenInfo { width: 0, height: 0, scale: 1.0 }, |m| ScreenInfo {
        width: u32::try_from(m.width()).unwrap_or(0),
        height: u32::try_from(m.height()).unwrap_or(0),
        scale: m.scale,
    })
}

/// Monitors as `DisplayInfo` (`displays_list`, engine display resolution), primary first.
pub fn displays() -> Vec<DisplayInfo> {
    monitors()
        .into_iter()
        .enumerate()
        .map(|(i, m)| {
            let mut d = DisplayInfo::new(m.id(), m.primary, to_rect(&m.rect), m.scale);
            d.work_area = to_rect(&m.work);
            d.name = if m.primary { format!("Display {} (primary)", i + 1) } else { format!("Display {}", i + 1) };
            d
        })
        .collect()
}

/// Id of the display containing (x, y), if any.
pub fn display_id_at(list: &[DisplayInfo], x: i32, y: i32) -> Option<String> {
    list.iter().find(|d| crate::display::on_display(&d.bounds, f64::from(x), f64::from(y))).map(|d| d.id.clone())
}

/// Monitor list for `device_info`.
pub fn device_screens() -> Vec<DeviceScreen> {
    monitors()
        .into_iter()
        .map(|m| DeviceScreen {
            width: u32::try_from(m.width()).unwrap_or(0),
            height: u32::try_from(m.height()).unwrap_or(0),
            scale: m.scale,
            x: m.rect.left,
            y: m.rect.top,
            primary: m.primary,
        })
        .collect()
}

/// Current pointer position.
pub fn cursor_pos() -> Result<(i32, i32), BackendError> {
    let mut p = POINT::default();
    // SAFETY: `p` is a valid out-param.
    unsafe { GetCursorPos(&mut p) }.map_err(|e| BackendError::new(ErrorCategory::Environment, format!("cannot read pointer: {e}")))?;
    Ok((p.x, p.y))
}

fn foreground_rect() -> Result<RECT, BackendError> {
    // SAFETY: plain Win32 calls; `r` is a valid out-param.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_invalid() {
            return Err(BackendError::new(ErrorCategory::Target, "no foreground window for a window-relative target"));
        }
        let mut r = RECT::default();
        GetWindowRect(hwnd, &mut r).map_err(|e| BackendError::new(ErrorCategory::Target, format!("cannot read window bounds: {e}")))?;
        Ok(r)
    }
}

fn monitor_rect(index: Option<u32>) -> Result<RECT, BackendError> {
    let mons = monitors();
    let i = usize::try_from(index.unwrap_or(0)).unwrap_or(usize::MAX);
    mons.get(i).map(|m| m.rect).ok_or_else(|| {
        BackendError::new(ErrorCategory::Environment, format!("monitor {} is not connected ({} found)", index.unwrap_or(0), mons.len()))
    })
}

/// Origin and size used to place a point/region in `space`.
fn frame(space: Space, monitor: Option<u32>) -> Result<(f64, f64, f64, f64), BackendError> {
    let r = match space {
        Space::Window => foreground_rect()?,
        Space::Normalized => monitor_rect(monitor)?,
        // The engine places display-space targets; a stray one is treated as screen pixels.
        Space::Screen | Space::Display => {
            if monitor.is_some() {
                monitor_rect(monitor)?
            } else {
                return Ok((0.0, 0.0, 1.0, 1.0));
            }
        }
    };
    let (w, h) = (f64::from(r.right - r.left), f64::from(r.bottom - r.top));
    Ok(match space {
        Space::Normalized => (f64::from(r.left), f64::from(r.top), w, h),
        _ => (f64::from(r.left), f64::from(r.top), 1.0, 1.0),
    })
}

#[allow(clippy::cast_possible_truncation)]
fn px(v: f64) -> i32 {
    js_round(v).clamp(f64::from(i32::MIN), f64::from(i32::MAX)) as i32
}

/// Resolves a point/region/current target to physical virtual-desktop pixels. Element and image
/// targets are resolved by the backend (UI Automation / screen search).
pub fn resolve_basic(t: &Target, random: &dyn Fn() -> f64) -> Result<Option<(i32, i32)>, BackendError> {
    Ok(Some(match t {
        Target::Point { x, y, space, monitor, .. } => {
            let (ox, oy, sx, sy) = frame(*space, *monitor)?;
            (px(ox + x * sx), px(oy + y * sy))
        }
        Target::Region { x, y, w, h, space, pick, .. } => {
            let (ox, oy, sx, sy) = frame(*space, None)?;
            let (x, y, w, h) = (ox + x * sx, oy + y * sy, w * sx, h * sy);
            if *pick == Pick::Random {
                (px(x + random() * w), px(y + random() * h))
            } else {
                (px(x + w / 2.0), px(y + h / 2.0))
            }
        }
        Target::Current => cursor_pos()?,
        Target::Element { .. } | Target::Image(_) => return Ok(None),
    }))
}

/// Converts a physical point to `SendInput` absolute coordinates over the virtual desktop
/// (0..=65535 on each axis, `MOUSEEVENTF_VIRTUALDESK`).
pub fn to_absolute(x: i32, y: i32) -> (i32, i32) {
    let v = virtual_screen();
    let norm = |p: i32, lo: i32, size: i32| -> i32 {
        let span = f64::from(size.saturating_sub(1).max(1));
        // In f64: `p - lo` in i32 overflows for far-off points left of a negative desktop origin.
        let n = ((f64::from(p) - f64::from(lo)) * 65535.0 / span).round();
        #[allow(clippy::cast_possible_truncation)]
        let out = n.clamp(0.0, 65535.0) as i32;
        out
    };
    (norm(x, v.left, v.right - v.left), norm(y, v.top, v.bottom - v.top))
}

/// True when the point lies on some monitor.
pub fn on_screen(x: i32, y: i32) -> bool {
    monitors().iter().any(|m| x >= m.rect.left && x < m.rect.right && y >= m.rect.top && y < m.rect.bottom)
}
