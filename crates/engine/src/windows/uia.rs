//! UI Automation: password-field detection (recording) and element targets.
//!
//! COM is initialised lazily per thread (MTA). Never call these from a low-level hook callback;
//! UIA calls can block on other processes.

use super::window;
use crate::engine::{BackendError, ErrorCategory};
use crate::schema::{ElementSelector, WindowMatch};
use ::windows::Win32::Foundation::RECT;
use ::windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use ::windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, IUIAutomationElement, TreeScope_Descendants};
use ::windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
use std::cell::RefCell;

thread_local! {
    static AUTOMATION: RefCell<Option<IUIAutomation>> = const { RefCell::new(None) };
}

fn automation() -> Result<IUIAutomation, BackendError> {
    AUTOMATION.with(|cell| {
        if let Some(a) = cell.borrow().as_ref() {
            return Ok(a.clone());
        }
        // SAFETY: COM initialisation for this thread; RPC_E_CHANGED_MODE (already STA) is fine.
        let _hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        // SAFETY: creates the in-process UI Automation client object.
        let a: IUIAutomation = unsafe { CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e| BackendError::new(ErrorCategory::Environment, format!("UI Automation is unavailable: {e}")))?;
        *cell.borrow_mut() = Some(a.clone());
        Ok(a)
    })
}

/// Whether the focused control is a password field (`None` when UIA cannot tell).
pub fn focused_is_password() -> Option<bool> {
    let a = automation().ok()?;
    // SAFETY: COM calls on valid interface pointers.
    unsafe {
        let el = a.GetFocusedElement().ok()?;
        el.CurrentIsPassword().ok().map(|b| b.as_bool())
    }
}

fn control_type_id(role: &str) -> Option<i32> {
    let r = role.trim().to_ascii_lowercase().replace(['_', '-', ' '], "");
    Some(match r.as_str() {
        "button" => 50000,
        "calendar" => 50001,
        "checkbox" => 50002,
        "combobox" => 50003,
        "edit" | "textbox" | "input" | "textfield" => 50004,
        "hyperlink" | "link" => 50005,
        "image" => 50006,
        "listitem" => 50007,
        "list" => 50008,
        "menu" => 50009,
        "menubar" => 50010,
        "menuitem" => 50011,
        "progressbar" => 50012,
        "radiobutton" | "radio" => 50013,
        "scrollbar" => 50014,
        "slider" => 50015,
        "spinner" => 50016,
        "statusbar" => 50017,
        "tab" => 50018,
        "tabitem" => 50019,
        "text" | "label" => 50020,
        "toolbar" => 50021,
        "tooltip" => 50022,
        "tree" => 50023,
        "treeitem" => 50024,
        "group" => 50026,
        "datagrid" | "grid" => 50028,
        "dataitem" | "row" => 50029,
        "document" => 50030,
        "splitbutton" => 50031,
        "window" => 50032,
        "pane" => 50033,
        "table" => 50036,
        _ => return None,
    })
}

fn matches(el: &IUIAutomationElement, sel: &ElementSelector, role: Option<i32>) -> bool {
    // SAFETY: COM property reads on a valid element.
    unsafe {
        if let Some(name) = &sel.name {
            match el.CurrentName() {
                Ok(n) if n.to_string().eq_ignore_ascii_case(name) => {}
                _ => return false,
            }
        }
        if let Some(text) = &sel.text {
            match el.CurrentName() {
                Ok(n) if n.to_string().to_lowercase().contains(&text.to_lowercase()) => {}
                _ => return false,
            }
        }
        if let Some(id) = &sel.automation_id {
            match el.CurrentAutomationId() {
                Ok(a) if a == id.as_str() => {}
                _ => return false,
            }
        }
        if let Some(role) = role {
            match el.CurrentControlType() {
                Ok(t) if t.0 == role => {}
                _ => return false,
            }
        }
    }
    true
}

/// Finds an element and returns its bounding rectangle (physical pixels).
pub fn find_element(sel: &ElementSelector) -> Result<RECT, BackendError> {
    let a = automation()?;
    let role = sel.role.as_deref().and_then(control_type_id);
    let has_window = sel.window.is_some() || sel.app.is_some();
    // SAFETY: COM calls on valid interface pointers; handles come from EnumWindows / the shell.
    unsafe {
        let root = if has_window {
            let w = window::find(&WindowMatch { title: sel.window.clone(), app: sel.app.clone() })
                .ok_or_else(|| BackendError::new(ErrorCategory::Target, "the element's window was not found"))?;
            a.ElementFromHandle(w.hwnd)
        } else {
            a.ElementFromHandle(GetForegroundWindow())
        }
        .map_err(|e| BackendError::new(ErrorCategory::Target, format!("cannot inspect the window: {e}")))?;
        let cond = a.CreateTrueCondition().map_err(|e| BackendError::new(ErrorCategory::Environment, e.to_string()))?;
        let all = root
            .FindAll(TreeScope_Descendants, &cond)
            .map_err(|e| BackendError::new(ErrorCategory::Target, format!("cannot list elements: {e}")))?;
        let n = all.Length().unwrap_or(0).min(20_000);
        let want = usize::try_from(sel.index.unwrap_or(0)).unwrap_or(0);
        let mut seen = 0usize;
        for i in 0..n {
            let Ok(el) = all.GetElement(i) else { continue };
            if !matches(&el, sel, role) {
                continue;
            }
            if seen == want {
                let r = el.CurrentBoundingRectangle().map_err(|e| BackendError::new(ErrorCategory::Target, e.to_string()))?;
                if r.right <= r.left || r.bottom <= r.top {
                    return Err(BackendError::new(ErrorCategory::Target, "the element is not visible"));
                }
                return Ok(r);
            }
            seen += 1;
        }
    }
    Err(BackendError::new(ErrorCategory::Target, "element not found"))
}
