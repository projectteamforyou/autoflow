//! Template-image search used by `findImage` and image targets.
//!
//! Two-level zero-mean normalised cross-correlation: a coarse pass over a downscaled copy picks
//! candidates, which are refined at full resolution. Scores are in `[-1, 1]` and compared with
//! the step's `confidence`. Platform layers provide the screen pixels.

use crate::engine::{BackendError, ErrorCategory};
use std::path::Path;

/// Grayscale image with `f32` luma per pixel.
#[derive(Debug, Clone, PartialEq)]
pub struct Gray {
    /// Width.
    pub w: usize,
    /// Height.
    pub h: usize,
    /// Row-major pixels.
    pub px: Vec<f32>,
}

impl Gray {
    /// From BGRA bytes (top-down rows).
    pub fn from_bgra(w: usize, h: usize, bgra: &[u8]) -> Self {
        let px = bgra.chunks_exact(4).map(|p| 0.114 * f32::from(p[0]) + 0.587 * f32::from(p[1]) + 0.299 * f32::from(p[2])).collect();
        Self { w, h, px }
    }
}

/// Loads a PNG file as grayscale (alpha ignored).
pub fn load_png(path: &Path) -> Result<Gray, BackendError> {
    let file = std::fs::File::open(path)
        .map_err(|e| BackendError::new(ErrorCategory::Target, format!("template image {} not found: {e}", path.display())))?;
    let mut decoder = png::Decoder::new(std::io::BufReader::new(file));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder.read_info().map_err(|e| BackendError::action(format!("invalid PNG: {e}")))?;
    let mut buf = vec![0u8; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buf).map_err(|e| BackendError::action(format!("invalid PNG: {e}")))?;
    let (w, h) = (usize::try_from(frame.width).unwrap_or(0), usize::try_from(frame.height).unwrap_or(0));
    let channels = frame.color_type.samples();
    let data = &buf[..frame.buffer_size()];
    let px: Vec<f32> = match channels {
        1 | 2 => data.chunks_exact(channels).map(|p| f32::from(p[0])).collect(),
        _ => data.chunks_exact(channels).map(|p| 0.299 * f32::from(p[0]) + 0.587 * f32::from(p[1]) + 0.114 * f32::from(p[2])).collect(),
    };
    if w == 0 || h == 0 || px.len() != w * h {
        return Err(BackendError::action("template image is empty"));
    }
    Ok(Gray { w, h, px })
}

fn downscale(g: &Gray, s: usize) -> Gray {
    if s <= 1 {
        return g.clone();
    }
    let (w, h) = (g.w / s, g.h / s);
    let mut px = vec![0f32; w * h];
    #[allow(clippy::cast_precision_loss)]
    let area = (s * s) as f32;
    for y in 0..h {
        for x in 0..w {
            let mut acc = 0f32;
            for dy in 0..s {
                let row = (y * s + dy) * g.w;
                for dx in 0..s {
                    acc += g.px[row + x * s + dx];
                }
            }
            px[y * w + x] = acc / area;
        }
    }
    Gray { w, h, px }
}

fn zero_mean(t: &Gray) -> (Vec<f32>, f32) {
    #[allow(clippy::cast_precision_loss)]
    let mean = t.px.iter().sum::<f32>() / t.px.len().max(1) as f32;
    let z: Vec<f32> = t.px.iter().map(|v| v - mean).collect();
    let norm = z.iter().map(|v| v * v).sum::<f32>().sqrt();
    (z, norm)
}

/// Zero-mean NCC of the template (pre-centred `tz`, norm `tn`) at (x, y).
fn ncc_at(img: &Gray, tw: usize, th: usize, tz: &[f32], tn: f32, x: usize, y: usize) -> f32 {
    #[allow(clippy::cast_precision_loss)]
    let n = (tw * th) as f32;
    let (mut sum, mut sum_sq, mut cross) = (0f32, 0f32, 0f32);
    for ty in 0..th {
        let row = (y + ty) * img.w + x;
        let trow = ty * tw;
        for tx in 0..tw {
            let v = img.px[row + tx];
            sum += v;
            sum_sq += v * v;
            cross += v * tz[trow + tx];
        }
    }
    let var = (sum_sq - sum * sum / n).max(0.0);
    if var < 1e-3 || tn < 1e-3 {
        return 0.0;
    }
    cross / (var.sqrt() * tn)
}

/// Best match of `tpl` inside `img`: top-left position and score.
pub fn find_template(img: &Gray, tpl: &Gray) -> Option<(usize, usize, f32)> {
    if tpl.w > img.w || tpl.h > img.h || tpl.w == 0 || tpl.h == 0 {
        return None;
    }
    let s = (tpl.w.min(tpl.h) / 8).clamp(1, 4);
    let (ci, ct) = (downscale(img, s), downscale(tpl, s));
    let (cz, cn) = zero_mean(&ct);
    let mut candidates: Vec<(f32, usize, usize)> = Vec::new();
    for y in 0..=(ci.h.saturating_sub(ct.h)) {
        for x in 0..=(ci.w.saturating_sub(ct.w)) {
            let score = ncc_at(&ci, ct.w, ct.h, &cz, cn, x, y);
            if score > 0.4 {
                candidates.push((score, x, y));
            }
        }
    }
    candidates.sort_by(|a, b| b.0.total_cmp(&a.0));
    candidates.truncate(8);
    let (z, n) = zero_mean(tpl);
    let mut best: Option<(usize, usize, f32)> = None;
    let r = 2 * s;
    for (_, cx, cy) in candidates {
        let (fx, fy) = (cx * s, cy * s);
        for y in fy.saturating_sub(r)..=(fy + r).min(img.h - tpl.h) {
            for x in fx.saturating_sub(r)..=(fx + r).min(img.w - tpl.w) {
                let score = ncc_at(img, tpl.w, tpl.h, &z, n, x, y);
                if best.map_or(true, |b| score > b.2) {
                    best = Some((x, y, score));
                }
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pattern(w: usize, h: usize, seed: u32) -> Gray {
        let mut s = seed;
        let px = (0..w * h)
            .map(|_| {
                s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                f32::from(u8::try_from(s >> 24).unwrap_or(0))
            })
            .collect();
        Gray { w, h, px }
    }

    #[test]
    fn finds_a_planted_template() {
        let mut img = pattern(320, 200, 7);
        let tpl = pattern(40, 24, 99);
        let (ox, oy) = (213, 141);
        for y in 0..tpl.h {
            for x in 0..tpl.w {
                img.px[(oy + y) * img.w + ox + x] = tpl.px[y * tpl.w + x];
            }
        }
        let (x, y, score) = find_template(&img, &tpl).expect("found");
        assert_eq!((x, y), (ox, oy));
        assert!(score > 0.99, "score {score}");
    }

    #[test]
    fn rejects_absent_templates() {
        let img = pattern(200, 120, 3);
        let tpl = pattern(32, 32, 1234);
        assert!(find_template(&img, &tpl).map_or(true, |(_, _, s)| s < 0.9));
        assert!(find_template(&tpl, &img).is_none());
    }
}
