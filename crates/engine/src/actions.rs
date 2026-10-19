//! File and HTTP actions shared by native backends.
//!
//! - File steps require absolute paths (a leading `~` expands to the user's home folder) and
//!   never follow the process working directory.
//! - HTTP steps allow only `http`/`https`, time out after 30 s, cap bodies at 10 MB and treat
//!   4xx/5xx responses as failures so `try`/`catch` and error policies see them. Requests run on
//!   a helper thread so a stop request returns within one slice even while the network hangs.

use crate::engine::{BackendError, ErrorCategory, RunControl, SLICE_MS};
use crate::schema::{FileOp, HttpMethod};
use crate::value::Value;
use indexmap::IndexMap;
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;

/// Largest file read or HTTP body accepted (bytes).
pub const MAX_BODY: u64 = 10 * 1024 * 1024;
/// HTTP timeout.
pub const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

fn io_error(context: &str, e: &std::io::Error) -> BackendError {
    let category = match e.kind() {
        std::io::ErrorKind::NotFound => ErrorCategory::Target,
        std::io::ErrorKind::PermissionDenied => ErrorCategory::Permission,
        _ => ErrorCategory::Action,
    };
    BackendError::new(category, format!("{context}: {e}"))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).map(PathBuf::from)
}

/// Resolves a step path: `~` → home, must be absolute afterwards.
pub fn resolve_path(raw: &str) -> Result<PathBuf, BackendError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(BackendError::new(ErrorCategory::Validation, "file path is empty"));
    }
    let path = if let Some(rest) = trimmed.strip_prefix('~') {
        let home = home_dir().ok_or_else(|| BackendError::new(ErrorCategory::Environment, "home folder is unknown"))?;
        home.join(rest.trim_start_matches(['/', '\\']))
    } else {
        PathBuf::from(trimmed)
    };
    if !path.is_absolute() {
        return Err(BackendError::new(ErrorCategory::Validation, format!("file path must be absolute: {trimmed}")));
    }
    Ok(path)
}

fn read_text(path: &Path) -> Result<String, BackendError> {
    let meta = std::fs::metadata(path).map_err(|e| io_error("cannot read file", &e))?;
    if meta.len() > MAX_BODY {
        return Err(BackendError::action(format!("file is larger than {} MB", MAX_BODY / 1024 / 1024)));
    }
    let bytes = std::fs::read(path).map_err(|e| io_error("cannot read file", &e))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Performs a `file` step.
pub fn file_action(op: FileOp, path: &str, dest: Option<&str>, content: Option<&str>) -> Result<Value, BackendError> {
    let p = resolve_path(path)?;
    let need_dest = || -> Result<PathBuf, BackendError> {
        let d = dest.filter(|d| !d.trim().is_empty()).ok_or_else(|| BackendError::new(ErrorCategory::Validation, "dest is required"))?;
        resolve_path(d)
    };
    match op {
        FileOp::Read => read_text(&p).map(Value::Str),
        FileOp::Exists => Ok(Value::Bool(p.exists())),
        FileOp::Write => {
            std::fs::write(&p, content.unwrap_or("")).map_err(|e| io_error("cannot write file", &e))?;
            Ok(Value::Null)
        }
        FileOp::Append => {
            let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&p).map_err(|e| io_error("cannot open file", &e))?;
            f.write_all(content.unwrap_or("").as_bytes()).map_err(|e| io_error("cannot append to file", &e))?;
            Ok(Value::Null)
        }
        FileOp::Copy => {
            let d = need_dest()?;
            std::fs::copy(&p, &d).map_err(|e| io_error("cannot copy file", &e))?;
            Ok(Value::Null)
        }
        FileOp::Move => {
            let d = need_dest()?;
            if std::fs::rename(&p, &d).is_err() {
                // Different volume: copy, then delete the source.
                std::fs::copy(&p, &d).map_err(|e| io_error("cannot move file", &e))?;
                std::fs::remove_file(&p).map_err(|e| io_error("cannot remove moved file", &e))?;
            }
            Ok(Value::Null)
        }
        FileOp::Delete => {
            if p.is_dir() {
                return Err(BackendError::new(ErrorCategory::Validation, "refusing to delete a folder"));
            }
            std::fs::remove_file(&p).map_err(|e| io_error("cannot delete file", &e))?;
            Ok(Value::Null)
        }
    }
}

/// Runs `work` on a helper thread, returning [`BackendError::aborted`] as soon as the run is
/// stopped (the helper finishes in the background and its result is dropped).
pub fn run_interruptible<T: Send + 'static>(
    control: &RunControl,
    work: impl FnOnce() -> Result<T, BackendError> + Send + 'static,
) -> Result<T, BackendError> {
    let (tx, rx) = mpsc::channel();
    std::thread::Builder::new()
        .name("autoflow-io".into())
        .spawn(move || {
            let _ignored = tx.send(work());
        })
        .map_err(|e| BackendError::new(ErrorCategory::Internal, format!("cannot start worker: {e}")))?;
    loop {
        if control.is_stopped() {
            return Err(BackendError::aborted());
        }
        match rx.recv_timeout(Duration::from_millis(SLICE_MS / 2)) {
            Ok(r) => return r,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err(BackendError::new(ErrorCategory::Internal, "worker ended unexpectedly"))
            }
        }
    }
}

fn check_http_url(url: &str) -> Result<(), BackendError> {
    let parsed = url::Url::parse(url).map_err(|e| BackendError::new(ErrorCategory::Validation, format!("invalid URL: {e}")))?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err(BackendError::new(ErrorCategory::Validation, "only http and https URLs are allowed"));
    }
    Ok(())
}

#[cfg(feature = "net")]
fn http_blocking(method: HttpMethod, url: &str, headers: &IndexMap<String, String>, body: Option<&str>) -> Result<Value, BackendError> {
    use ureq::Agent;
    let agent: Agent = Agent::config_builder()
        .timeout_global(Some(HTTP_TIMEOUT))
        .http_status_as_error(false)
        .user_agent(concat!("AutoFlow/", env!("CARGO_PKG_VERSION")))
        .build()
        .into();
    let net = |e: ureq::Error| BackendError::new(ErrorCategory::Environment, format!("request failed: {e}"));
    let mut resp = match method {
        HttpMethod::Get | HttpMethod::Delete => {
            let mut req = if method == HttpMethod::Get { agent.get(url) } else { agent.delete(url) };
            for (k, v) in headers {
                req = req.header(k.as_str(), v.as_str());
            }
            match body {
                Some(b) if method == HttpMethod::Delete => req.force_send_body().send(b.as_bytes()).map_err(net)?,
                _ => req.call().map_err(net)?,
            }
        }
        HttpMethod::Post | HttpMethod::Put | HttpMethod::Patch => {
            let mut req = match method {
                HttpMethod::Post => agent.post(url),
                HttpMethod::Put => agent.put(url),
                _ => agent.patch(url),
            };
            for (k, v) in headers {
                req = req.header(k.as_str(), v.as_str());
            }
            req.send(body.unwrap_or("").as_bytes()).map_err(net)?
        }
    };
    let status = resp.status();
    let text = resp
        .body_mut()
        .with_config()
        .limit(MAX_BODY)
        .read_to_string()
        .map_err(|e| BackendError::action(format!("cannot read response: {e}")))?;
    if status.as_u16() >= 400 {
        return Err(BackendError::action(format!("HTTP {} {}", status.as_u16(), status.canonical_reason().unwrap_or(""))));
    }
    Ok(Value::Str(text))
}

#[cfg(not(feature = "net"))]
fn http_blocking(_: HttpMethod, _: &str, _: &IndexMap<String, String>, _: Option<&str>) -> Result<Value, BackendError> {
    Err(BackendError::new(ErrorCategory::Environment, "HTTP support is not built into this engine"))
}

/// Performs an `http` step and returns the response body.
pub fn http_action(
    control: &RunControl,
    method: HttpMethod,
    url: &str,
    headers: &IndexMap<String, String>,
    body: Option<&str>,
) -> Result<Value, BackendError> {
    check_http_url(url)?;
    let (url, headers, body) = (url.to_owned(), headers.clone(), body.map(str::to_owned));
    run_interruptible(control, move || http_blocking(method, &url, &headers, body.as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_round_trip() {
        let dir = std::env::temp_dir().join(format!("autoflow-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let f = dir.join("a.txt");
        let fs = f.to_string_lossy().into_owned();
        file_action(FileOp::Write, &fs, None, Some("hi")).expect("write");
        file_action(FileOp::Append, &fs, None, Some("!")).expect("append");
        assert_eq!(file_action(FileOp::Read, &fs, None, None).expect("read"), Value::Str("hi!".into()));
        let g = dir.join("b.txt").to_string_lossy().into_owned();
        file_action(FileOp::Move, &fs, Some(&g), None).expect("move");
        assert_eq!(file_action(FileOp::Exists, &fs, None, None).expect("exists"), Value::Bool(false));
        file_action(FileOp::Delete, &g, None, None).expect("delete");
        let e = file_action(FileOp::Read, &g, None, None).expect_err("missing");
        assert_eq!(e.category, Some(ErrorCategory::Target));
        assert!(file_action(FileOp::Read, "relative.txt", None, None).is_err());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_non_http_urls() {
        let c = RunControl::new();
        let e = http_action(&c, HttpMethod::Get, "file:///etc/passwd", &IndexMap::new(), None).expect_err("blocked");
        assert_eq!(e.category, Some(ErrorCategory::Validation));
    }
}
