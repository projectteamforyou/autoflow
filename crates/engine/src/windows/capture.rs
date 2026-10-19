//! Screen capture (GDI `BitBlt`) in physical pixels, and on-screen template search.

use crate::engine::{BackendError, ErrorCategory, RunControl};
use crate::imagematch::{find_template, load_png, Gray};
use ::windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, ReleaseDC, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HGDIOBJ, SRCCOPY,
};
use std::path::Path;
use std::time::{Duration, Instant};

/// Captured BGRA pixels (top-down rows).
#[derive(Debug, Clone)]
pub struct Capture {
    /// Left in virtual-desktop px.
    pub x: i32,
    /// Top in virtual-desktop px.
    pub y: i32,
    /// Width.
    pub w: usize,
    /// Height.
    pub h: usize,
    /// BGRA bytes.
    pub bgra: Vec<u8>,
}

/// Captures a screen rectangle in physical pixels.
pub fn capture(x: i32, y: i32, w: i32, h: i32) -> Result<Capture, BackendError> {
    if w <= 0 || h <= 0 || w > 16_384 || h > 16_384 {
        return Err(BackendError::new(ErrorCategory::Validation, "capture region is empty or too large"));
    }
    let fail = |what: &str| BackendError::new(ErrorCategory::Environment, format!("screen capture failed: {what}"));
    let (uw, uh) = (usize::try_from(w).unwrap_or(0), usize::try_from(h).unwrap_or(0));
    let mut bgra = vec![0u8; uw * uh * 4];
    // SAFETY: GDI objects are created, used and released within this block; the DIB buffer is
    // sized for `w × h` 32-bit pixels.
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err(fail("no screen device context"));
        }
        let mem = CreateCompatibleDC(Some(screen));
        let bmp = CreateCompatibleBitmap(screen, w, h);
        let old = SelectObject(mem, HGDIOBJ(bmp.0));
        let blt = BitBlt(mem, 0, 0, w, h, Some(screen), x, y, SRCCOPY | CAPTUREBLT);
        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: u32::try_from(std::mem::size_of::<BITMAPINFOHEADER>()).unwrap_or(40),
                biWidth: w,
                biHeight: -h,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let lines = GetDIBits(mem, bmp, 0, u32::try_from(h).unwrap_or(0), Some(bgra.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        SelectObject(mem, old);
        let _deleted = DeleteObject(HGDIOBJ(bmp.0));
        let _deleted_dc = DeleteDC(mem);
        ReleaseDC(None, screen);
        blt.map_err(|e| fail(&e.to_string()))?;
        if lines == 0 {
            return Err(fail("could not read pixels"));
        }
    }
    Ok(Capture { x, y, w: uw, h: uh, bgra })
}

impl Capture {
    /// RGB of the captured pixel (x, y) relative to the capture.
    pub fn rgb(&self, x: usize, y: usize) -> [u8; 3] {
        let o = (y * self.w + x) * 4;
        [self.bgra[o + 2], self.bgra[o + 1], self.bgra[o]]
    }
}

/// Color of one virtual-desktop pixel as `#rrggbb` (pixel probes).
pub fn pixel_hex(x: i32, y: i32) -> Result<String, BackendError> {
    let shot = capture(x, y, 1, 1)?;
    Ok(crate::display::to_hex_color(shot.rgb(0, 0)))
}

/// dHash of a virtual-desktop rectangle (scene probes); same math as `dhash()` in displays.ts.
pub fn scene_hash(x: i32, y: i32, w: i32, h: i32) -> Result<String, BackendError> {
    let shot = capture(x, y, w, h)?;
    crate::display::dhash(shot.w, shot.h, |px, py| shot.rgb(px, py)).ok_or_else(|| BackendError::action("scene region is empty"))
}

/// Scene capture for the Stage panel: dHash plus a PNG thumbnail data URL.
pub fn scene_capture(x: i32, y: i32, w: i32, h: i32) -> Result<(String, String, u32, u32), BackendError> {
    let shot = capture(x, y, w, h)?;
    let hash =
        crate::display::dhash(shot.w, shot.h, |px, py| shot.rgb(px, py)).ok_or_else(|| BackendError::action("scene region is empty"))?;
    let thumb = crate::display::thumbnail_data_url(shot.w, shot.h, |px, py| shot.rgb(px, py), 160)
        .ok_or_else(|| BackendError::action("cannot encode the scene preview"))?;
    Ok((hash, thumb, u32::try_from(shot.w).unwrap_or(0), u32::try_from(shot.h).unwrap_or(0)))
}

/// Searches the screen (or `region`) for a PNG template until `timeout_ms` passes.
/// Returns the match centre in physical pixels, `None` when not found in time.
pub fn find_on_screen(
    template: &Path,
    confidence: f64,
    region: Option<(i32, i32, i32, i32)>,
    timeout_ms: u64,
    control: &RunControl,
) -> Result<Option<(i32, i32)>, BackendError> {
    let tpl = load_png(template)?;
    let (x, y, w, h) = region.unwrap_or_else(|| {
        let v = super::screen::virtual_screen();
        (v.left, v.top, v.right - v.left, v.bottom - v.top)
    });
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        let shot = capture(x, y, w, h)?;
        let img = Gray::from_bgra(shot.w, shot.h, &shot.bgra);
        if let Some((mx, my, score)) = find_template(&img, &tpl) {
            if f64::from(score) >= confidence {
                let cx = x + i32::try_from(mx + tpl.w / 2).unwrap_or(0);
                let cy = y + i32::try_from(my + tpl.h / 2).unwrap_or(0);
                return Ok(Some((cx, cy)));
            }
        }
        if Instant::now() >= deadline {
            return Ok(None);
        }
        super::input::pause(250, control)?;
    }
}
