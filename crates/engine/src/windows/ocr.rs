//! Text recognition with the built-in `Windows.Media.Ocr` engine (user profile languages).

use super::capture::capture;
use crate::engine::{BackendError, ErrorCategory};
use ::windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use ::windows::Media::Ocr::OcrEngine;
use ::windows::Storage::Streams::DataWriter;
use ::windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

/// Recognises text in a screen rectangle (physical pixels). Lines are joined with `\n`.
pub fn recognize(x: i32, y: i32, w: i32, h: i32) -> Result<String, BackendError> {
    let shot = capture(x, y, w, h)?;
    let env = |what: &str, e: ::windows::core::Error| BackendError::new(ErrorCategory::Environment, format!("{what}: {e}"));
    // SAFETY: COM/WinRT initialisation for this thread (idempotent).
    let _hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let writer = DataWriter::new().map_err(|e| env("OCR buffer", e))?;
    writer.WriteBytes(&shot.bgra).map_err(|e| env("OCR buffer", e))?;
    let buffer = writer.DetachBuffer().map_err(|e| env("OCR buffer", e))?;
    let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w, h).map_err(|e| env("OCR bitmap", e))?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|e| env("no OCR language is installed (Settings › Time & language › Language)", e))?;
    let result = engine.RecognizeAsync(&bitmap).and_then(|op| op.get()).map_err(|e| env("text recognition failed", e))?;
    let mut lines = Vec::new();
    if let Ok(list) = result.Lines() {
        for line in list {
            if let Ok(t) = line.Text() {
                lines.push(t.to_string());
            }
        }
    }
    if lines.is_empty() {
        return Ok(result.Text().map(|t| t.to_string()).unwrap_or_default());
    }
    Ok(lines.join("\n"))
}
