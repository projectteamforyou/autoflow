//! Template images (`<app data>/images/<ref>.png`) used by `findImage` steps and image targets.
//!
//! The web app hands over a PNG as a data URL (`image_import`); it is checked here — reference
//! name, size, a real PNG the template search can decode — so a broken file is refused when it is
//! added rather than failing a run later. Pure logic (no Tauri types).

use crate::platform::safe_ref;
use autoflow_engine::imagematch::check_png;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};

/// Largest accepted PNG file.
pub const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;
/// Largest accepted width / height in px.
pub const MAX_IMAGE_SIDE: u32 = 4096;

const DATA_URL_PREFIX: &str = "data:image/png;base64,";
const BAD_REF: &str = "image names may only use letters, digits, _ - and . (at most 200 characters, not starting with a dot)";

fn checked_ref(reference: &str) -> Result<&str, String> {
    safe_ref(reference).ok_or_else(|| BAD_REF.to_owned())
}

/// Decodes a `data:image/png;base64,…` URL into the PNG bytes (at most [`MAX_IMAGE_BYTES`]).
pub fn decode_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url.strip_prefix(DATA_URL_PREFIX).ok_or("the image must be a PNG data URL (data:image/png;base64,…)")?;
    // Checked on the encoded text first, so an oversized upload is refused before it is decoded.
    if encoded.len() > MAX_IMAGE_BYTES.div_ceil(3) * 4 {
        return Err(format!("the image is larger than {} MB", MAX_IMAGE_BYTES / (1024 * 1024)));
    }
    let bytes = STANDARD.decode(encoded).map_err(|e| format!("the image data is not valid base64: {e}"))?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(format!("the image is larger than {} MB", MAX_IMAGE_BYTES / (1024 * 1024)));
    }
    Ok(bytes)
}

/// Stores a template image as `<dir>/<ref>.png`, replacing an existing one.
///
/// The file is written under a temporary name and renamed, so a run that looks the image up at
/// the same moment sees either the old or the new image, never a partial file.
pub fn import(dir: &Path, reference: &str, data_url: &str) -> Result<(), String> {
    static NEXT_TMP: AtomicU32 = AtomicU32::new(0);
    let reference = checked_ref(reference)?;
    let bytes = decode_data_url(data_url)?;
    check_png(&bytes, MAX_IMAGE_SIDE).map_err(|e| e.message)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create the images folder: {e}"))?;
    // Not a `.png` name, so a leftover temporary file never shows up in `list`.
    let tmp = dir.join(format!("{reference}.png.{}.tmp", NEXT_TMP.fetch_add(1, Ordering::Relaxed)));
    let stored = std::fs::write(&tmp, &bytes).and_then(|()| std::fs::rename(&tmp, dir.join(format!("{reference}.png"))));
    stored.map_err(|e| {
        let _removed = std::fs::remove_file(&tmp);
        format!("cannot save the image: {e}")
    })
}

/// References of the stored template images (file stems of `*.png`), sorted.
pub fn list(dir: &Path) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut refs: Vec<String> = entries
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let is_png = path.is_file() && path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("png"));
            let stem = path.file_stem()?.to_str()?;
            (is_png && safe_ref(stem).is_some()).then(|| stem.to_owned())
        })
        .collect();
    refs.sort();
    refs.dedup();
    refs
}

/// Deletes a stored template image. Deleting one that is not there is not an error.
pub fn delete(dir: &Path, reference: &str) -> Result<(), String> {
    let reference = checked_ref(reference)?;
    match std::fs::remove_file(dir.join(format!("{reference}.png"))) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot delete the image: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1×1 grayscale PNG.
    const PIXEL: &str =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNoAAAAggCBd81ytgAAAABJRU5ErkJggg==";

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("autoflow-images-{name}-{}", std::process::id()));
        let _removed = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn imports_lists_and_deletes() {
        let dir = temp_dir("roundtrip");
        assert!(list(&dir).is_empty());
        import(&dir, "ok-button", PIXEL).expect("import");
        import(&dir, "a.b_1", PIXEL).expect("import");
        import(&dir, "ok-button", PIXEL).expect("replace");
        std::fs::write(dir.join("notes.txt"), b"x").expect("write");
        std::fs::write(dir.join("left.png.3.tmp"), b"x").expect("write");
        assert_eq!(list(&dir), ["a.b_1", "ok-button"]);
        assert!(autoflow_engine::imagematch::load_png(&dir.join("ok-button.png")).is_ok());
        delete(&dir, "ok-button").expect("delete");
        delete(&dir, "ok-button").expect("deleting a missing image is fine");
        assert_eq!(list(&dir), ["a.b_1"]);
        let _removed = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_bad_names_and_bad_images() {
        let dir = temp_dir("refused");
        for bad in ["", "..", "../x", "a/b", "a\\b", ".hidden", "sp ace", "C:x"] {
            assert!(import(&dir, bad, PIXEL).is_err(), "{bad:?} must be refused");
            assert!(delete(&dir, bad).is_err(), "{bad:?} must be refused");
        }
        assert!(import(&dir, "x", "data:image/jpeg;base64,AAAA").is_err());
        assert!(import(&dir, "x", "data:image/png;base64,!!!!").is_err());
        // Valid base64, not a PNG.
        assert!(import(&dir, "x", "data:image/png;base64,aGVsbG8gd29ybGQ=").is_err());
        let huge = format!("{DATA_URL_PREFIX}{}", "A".repeat(MAX_IMAGE_BYTES.div_ceil(3) * 4 + 4));
        assert!(decode_data_url(&huge).expect_err("too large").contains("larger than 4 MB"));
        assert!(list(&dir).is_empty());
        let _removed = std::fs::remove_dir_all(&dir);
    }
}
