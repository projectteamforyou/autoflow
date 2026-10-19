//! `ShellExecuteW`: URLs, apps and Settings pages. Never uses the `runas` (elevation) verb.

use super::wide;
use crate::engine::{BackendError, ErrorCategory};
use ::windows::core::PCWSTR;
use ::windows::Win32::UI::Shell::ShellExecuteW;
use ::windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

fn shell_open(file: &str, params: Option<&str>) -> Result<(), BackendError> {
    let verb = wide("open");
    let file_w = wide(file);
    let params_w = params.map(wide);
    // SAFETY: all strings are NUL-terminated buffers that outlive the call.
    let h = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(file_w.as_ptr()),
            params_w.as_ref().map_or(PCWSTR::null(), |p| PCWSTR(p.as_ptr())),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecuteW returns a value > 32 on success.
    let code = h.0 as isize;
    if code > 32 {
        return Ok(());
    }
    let (category, why) = match code {
        2 | 3 => (ErrorCategory::Target, "file or app not found"),
        5 => (ErrorCategory::Permission, "access denied"),
        31 => (ErrorCategory::Environment, "no app is associated with this item"),
        _ => (ErrorCategory::Action, "Windows could not open it"),
    };
    Err(BackendError::new(category, format!("{why}: {file}")))
}

/// Opens an http(s) or mailto URL in the default handler.
pub fn open_url(url: &str) -> Result<(), BackendError> {
    let parsed = url::Url::parse(url).map_err(|e| BackendError::new(ErrorCategory::Validation, format!("invalid URL: {e}")))?;
    if !matches!(parsed.scheme(), "http" | "https" | "mailto") {
        return Err(BackendError::new(ErrorCategory::Validation, "only http, https and mailto links can be opened"));
    }
    shell_open(parsed.as_str(), None)
}

/// Quotes one argument for `CommandLineToArgvW`.
pub fn quote_arg(a: &str) -> String {
    if !a.is_empty() && !a.contains([' ', '\t', '"']) {
        return a.to_owned();
    }
    let mut out = String::from('"');
    let mut backslashes = 0usize;
    for c in a.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// Launches an executable (path, name on PATH / App Paths) or a packaged app by AUMID
/// (`Publisher.App_hash!App`).
pub fn launch_app(app: &str, args: &[String]) -> Result<(), BackendError> {
    let app = app.trim();
    if app.is_empty() {
        return Err(BackendError::new(ErrorCategory::Validation, "app is empty"));
    }
    let is_aumid = app.contains('!') && !app.contains(['\\', '/']);
    let file = if is_aumid { format!("shell:AppsFolder\\{app}") } else { app.to_owned() };
    let params = (!args.is_empty()).then(|| args.iter().map(|a| quote_arg(a)).collect::<Vec<_>>().join(" "));
    shell_open(&file, params.as_deref())
}

/// Opens a Windows Settings page for a bridge permission page name.
pub fn open_settings(page: &str) -> Result<(), BackendError> {
    let uri = match page {
        "accessibility" => "ms-settings:easeofaccess",
        "notifications" | "notificationListener" | "overlay" => "ms-settings:notifications",
        "location" => "ms-settings:privacy-location",
        "batteryOptimization" => "ms-settings:batterysaver",
        "inputMonitoring" => "ms-settings:privacy",
        "startup" => "ms-settings:startupapps",
        _ => "ms-settings:appsfeatures",
    };
    shell_open(uri, None)
}

#[cfg(test)]
mod tests {
    use super::quote_arg;

    #[test]
    fn quotes_like_commandlinetoargvw() {
        assert_eq!(quote_arg("plain"), "plain");
        assert_eq!(quote_arg("with space"), "\"with space\"");
        assert_eq!(quote_arg("say \"hi\""), "\"say \\\"hi\\\"\"");
        assert_eq!(quote_arg("C:\\dir with space\\"), "\"C:\\dir with space\\\\\"");
        assert_eq!(quote_arg(""), "\"\"");
    }
}
