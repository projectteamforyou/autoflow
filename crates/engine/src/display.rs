//! Multi-monitor model and scene math — mirrors `packages/core/src/displays.ts`.
//!
//! - Displays are reported in virtual-desktop pixels; flows reference them with a
//!   [`DisplayRef`] resolved against the canonical order (primary first, then left to right,
//!   top to bottom).
//! - Display-relative coordinates are placed with one rounding rule, `floor(v + 0.5)`, so the
//!   TypeScript, Kotlin and Rust engines land on the same pixel even left of the primary display.
//! - Scenes use a 64-bit difference hash (dHash) whose integer arithmetic is bit-identical to the
//!   TypeScript implementation (`fixtures/engine/dhash.json` checks it).

use crate::schema::{DisplayRef, Rect};
use serde::{Deserialize, Serialize};

/// Landscape or portrait.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
#[allow(missing_docs)]
pub enum Orientation {
    #[default]
    Landscape,
    Portrait,
}

/// One monitor (`DisplayInfo` in displays.ts).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    /// Stable id (Windows: device name such as `\\.\DISPLAY2`).
    pub id: String,
    /// Display name.
    pub name: String,
    /// Primary monitor.
    pub primary: bool,
    /// Bounds in virtual-desktop px.
    pub bounds: Rect,
    /// Bounds minus taskbars.
    pub work_area: Rect,
    /// DPI scale (1 = 96 DPI).
    pub scale: f64,
    /// Orientation.
    pub orientation: Orientation,
}

impl DisplayInfo {
    /// A display covering `bounds` (work area = bounds).
    pub fn new(id: impl Into<String>, primary: bool, bounds: Rect, scale: f64) -> Self {
        let id = id.into();
        let orientation = if bounds.w >= bounds.h { Orientation::Landscape } else { Orientation::Portrait };
        Self { name: id.clone(), id, primary, bounds, work_area: bounds, scale, orientation }
    }
}

/// Canonical order: primary first, then by left edge, then by top edge (stable).
pub fn sort_displays(list: &[DisplayInfo]) -> Vec<DisplayInfo> {
    let mut v = list.to_vec();
    v.sort_by(|a, b| {
        b.primary
            .cmp(&a.primary)
            .then(a.bounds.x.partial_cmp(&b.bounds.x).unwrap_or(std::cmp::Ordering::Equal))
            .then(a.bounds.y.partial_cmp(&b.bounds.y).unwrap_or(std::cmp::Ordering::Equal))
    });
    v
}

/// Finds a referenced display in an already sorted list.
pub fn find_display<'a>(sorted: &'a [DisplayInfo], r: &DisplayRef) -> Option<&'a DisplayInfo> {
    match r {
        DisplayRef::Index { index } => sorted.get(usize::try_from(*index).unwrap_or(usize::MAX)),
        DisplayRef::Name(n) if n == "primary" => sorted.first(),
        DisplayRef::Name(n) if n == "secondary" => sorted.get(1),
        DisplayRef::Name(n) => sorted.iter().find(|d| &d.id == n),
    }
}

/// Log label: `"secondary"`, `index 2`.
pub fn display_ref_label(r: &DisplayRef) -> String {
    match r {
        DisplayRef::Index { index } => format!("index {index}"),
        DisplayRef::Name(n) => format!("\"{n}\""),
    }
}

/// Key under which warnings and "ask" answers are remembered per run.
pub fn display_ref_key(r: &DisplayRef) -> String {
    match r {
        DisplayRef::Index { index } => format!("#{index}"),
        DisplayRef::Name(n) => n.clone(),
    }
}

/// The one rounding rule for pixels: half up, also for negative coordinates.
pub fn round_px(v: f64) -> f64 {
    (v + 0.5).floor()
}

/// True when pixel (x, y) lies on bounds `b`.
pub fn on_display(b: &Rect, x: f64, y: f64) -> bool {
    x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h
}

/// A point in `space` ("normalized", "display" or "screen") relative to `b`, in absolute px.
pub fn place_point(b: &Rect, x: f64, y: f64, space: &str) -> (f64, f64) {
    match space {
        "normalized" => (round_px(b.x + x * b.w), round_px(b.y + y * b.h)),
        "display" => (round_px(b.x + x), round_px(b.y + y)),
        _ => (round_px(x), round_px(y)),
    }
}

/// A rectangle in `space` relative to `b`, in absolute px (at least 1×1).
pub fn place_rect(b: &Rect, r: &Rect, space: &str) -> Rect {
    let (sx, sy) = if space == "normalized" { (b.w, b.h) } else { (1.0, 1.0) };
    let (ox, oy) = if space == "screen" { (0.0, 0.0) } else { (b.x, b.y) };
    Rect { x: round_px(ox + r.x * sx), y: round_px(oy + r.y * sy), w: round_px(r.w * sx).max(1.0), h: round_px(r.h * sy).max(1.0) }
}

/// True when `r` lies completely on `b`.
pub fn rect_on_display(b: &Rect, r: &Rect) -> bool {
    r.x >= b.x && r.y >= b.y && r.x + r.w <= b.x + b.w && r.y + r.h <= b.y + b.h
}

/* -------------------------------------------------------------------- colors */

/// Parses `#rrggbb` (any case).
pub fn parse_color(hex: &str) -> Option<[u8; 3]> {
    let digits = hex.strip_prefix('#')?;
    if digits.len() != 6 || !digits.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let n = u32::from_str_radix(digits, 16).ok()?;
    let [_, r, g, b] = n.to_be_bytes();
    Some([r, g, b])
}

/// `#rrggbb` in lowercase.
pub fn to_hex_color(c: [u8; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])
}

/// Largest per-channel difference.
pub fn color_distance(a: [u8; 3], b: [u8; 3]) -> u32 {
    a.iter().zip(b.iter()).map(|(x, y)| u32::from(x.abs_diff(*y))).max().unwrap_or(0)
}

/* --------------------------------------------------------------------- dHash */

/// Integer luma (BT.601 weights, rounded) — `luma()` in displays.ts.
pub fn luma(r: u8, g: u8, b: u8) -> u64 {
    (u64::from(r) * 299 + u64::from(g) * 587 + u64::from(b) * 114 + 500) / 1000
}

fn span(i: usize, n: usize, size: usize) -> (usize, usize) {
    let a = i * size / n;
    let b = size.min((a + 1).max((i + 1) * size / n));
    (a.min(size - 1), b)
}

/// 64-bit difference hash of a `w`×`h` image read through `rgb(x, y)` — `dhash()` in displays.ts:
/// integer luma, 9×8 box average, bit `y·8+x` = cell (x, y) brighter than cell (x+1, y), 16
/// lowercase hex digits with bit 0 most significant. `None` for an empty image.
pub fn dhash(w: usize, h: usize, rgb: impl Fn(usize, usize) -> [u8; 3]) -> Option<String> {
    if w == 0 || h == 0 {
        return None;
    }
    let mut cells = [0u64; 72];
    for cy in 0..8 {
        let (y0, y1) = span(cy, 8, h);
        for cx in 0..9 {
            let (x0, x1) = span(cx, 9, w);
            let mut sum = 0u64;
            for y in y0..y1 {
                for x in x0..x1 {
                    let [r, g, b] = rgb(x, y);
                    sum += luma(r, g, b);
                }
            }
            let count = u64::try_from((y1 - y0) * (x1 - x0)).unwrap_or(1).max(1);
            cells[cy * 9 + cx] = sum / count;
        }
    }
    let mut bits: u64 = 0;
    for bit in 0..64 {
        let (y, x) = (bit / 8, bit % 8);
        bits = (bits << 1) | u64::from(cells[y * 9 + x] > cells[y * 9 + x + 1]);
    }
    Some(format!("{bits:016x}"))
}

/// dHash of packed RGB(A) bytes (`channels` 3 or 4, rows top to bottom).
pub fn dhash_bytes(pixels: &[u8], w: usize, h: usize, channels: usize) -> Option<String> {
    if pixels.len() < w * h * channels || channels < 3 {
        return None;
    }
    dhash(w, h, |x, y| {
        let o = (y * w + x) * channels;
        [pixels[o], pixels[o + 1], pixels[o + 2]]
    })
}

fn parse_hash(s: &str) -> Option<u64> {
    (s.len() == 16 && s.bytes().all(|b| b.is_ascii_hexdigit())).then(|| u64::from_str_radix(s, 16).ok()).flatten()
}

/// Differing bits between two 16-digit hashes (64 when either is malformed).
pub fn hamming_distance(a: &str, b: &str) -> u32 {
    match (parse_hash(a), parse_hash(b)) {
        (Some(x), Some(y)) => (x ^ y).count_ones(),
        _ => 64,
    }
}

/// `(64 − distance) / 64`.
pub fn hash_similarity(a: &str, b: &str) -> f64 {
    f64::from(64 - hamming_distance(a, b)) / 64.0
}

/// True for a well-formed 16-digit hash.
pub fn is_hash(s: &str) -> bool {
    parse_hash(s).is_some()
}

/* ----------------------------------------------------------------- thumbnail */

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard base64 with padding.
pub fn base64(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], chunk.get(1).copied().unwrap_or(0), chunk.get(2).copied().unwrap_or(0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            if i <= chunk.len() {
                out.push(char::from(B64[((n >> (18 - 6 * i)) & 63) as usize]));
            } else {
                out.push('=');
            }
        }
    }
    out
}

/// A small PNG preview of a `w`×`h` image as a `data:image/png;base64,…` URL that fits
/// `MAX_SCENE_THUMB_CHARS` (the width shrinks from `max_w` until it does). `None` for an empty image.
pub fn thumbnail_data_url(w: usize, h: usize, rgb: impl Fn(usize, usize) -> [u8; 3], max_w: usize) -> Option<String> {
    if w == 0 || h == 0 {
        return None;
    }
    let mut tw = max_w.min(w).max(1);
    loop {
        let th = (h * tw).div_ceil(w).max(1);
        let mut pixels = Vec::with_capacity(tw * th * 3);
        for ty in 0..th {
            for tx in 0..tw {
                pixels.extend_from_slice(&rgb((tx * w + w / 2) / tw.max(1) % w, (ty * h + h / 2) / th.max(1) % h));
            }
        }
        let mut png_bytes = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut png_bytes, u32::try_from(tw).ok()?, u32::try_from(th).ok()?);
            enc.set_color(png::ColorType::Rgb);
            enc.set_depth(png::BitDepth::Eight);
            let mut writer = enc.write_header().ok()?;
            writer.write_image_data(&pixels).ok()?;
        }
        let url = format!("data:image/png;base64,{}", base64(&png_bytes));
        if url.len() <= crate::schema::MAX_SCENE_THUMB_CHARS || tw <= 8 {
            return (url.len() <= crate::schema::MAX_SCENE_THUMB_CHARS).then_some(url);
        }
        tw = tw * 2 / 3;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding_is_half_up_for_negative_coordinates() {
        assert!((round_px(-1069.5) - (-1069.0)).abs() < f64::EPSILON);
        assert!((round_px(2.5) - 3.0).abs() < f64::EPSILON);
    }

    #[test]
    fn base64_and_thumbnails() {
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"M"), "TQ==");
        #[allow(clippy::cast_possible_truncation)]
        let url = thumbnail_data_url(1920, 1080, |x, y| [(x % 256) as u8, (y % 256) as u8, ((x * y) % 256) as u8], 160).expect("thumb");
        assert!(url.starts_with("data:image/png;base64,iVBOR"));
        assert!(url.len() <= crate::schema::MAX_SCENE_THUMB_CHARS);
    }

    #[test]
    fn colors_parse_and_compare() {
        assert_eq!(parse_color("#2ECC71"), Some([0x2e, 0xcc, 0x71]));
        assert_eq!(parse_color("2ecc71"), None);
        assert_eq!(to_hex_color([1, 2, 255]), "#0102ff");
        assert_eq!(color_distance([0, 10, 20], [5, 0, 20]), 10);
    }
}
