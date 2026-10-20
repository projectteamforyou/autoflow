//! `SendInput` primitives. Every injected event is stamped with [`INJECTED_MARKER`].
//!
//! Anything pressed is released by a guard even when a stop request interrupts a hold or drag,
//! so an aborted run never leaves a mouse button or modifier stuck down.

use super::keymap::{modifier_vk, KeySpec};
use super::{from_wide, screen, INJECTED_MARKER};
use crate::engine::{BackendError, ErrorCategory, RunControl};
use crate::schema::{Modifier, MouseButton};
use ::windows::Win32::Foundation::HANDLE;
use ::windows::Win32::System::StationsAndDesktops::{
    CloseDesktop, GetUserObjectInformationW, OpenInputDesktop, DESKTOP_CONTROL_FLAGS, DESKTOP_READOBJECTS, UOI_NAME,
};
use ::windows::Win32::UI::Input::KeyboardAndMouse::{
    MapVirtualKeyW, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, INPUT_MOUSE, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY,
    KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, MAPVK_VK_TO_VSC, MOUSEEVENTF_ABSOLUTE, MOUSEEVENTF_HWHEEL, MOUSEEVENTF_LEFTDOWN,
    MOUSEEVENTF_LEFTUP, MOUSEEVENTF_MIDDLEDOWN, MOUSEEVENTF_MIDDLEUP, MOUSEEVENTF_MOVE, MOUSEEVENTF_RIGHTDOWN, MOUSEEVENTF_RIGHTUP,
    MOUSEEVENTF_VIRTUALDESK, MOUSEEVENTF_WHEEL, MOUSEEVENTF_XDOWN, MOUSEEVENTF_XUP, MOUSEINPUT, MOUSE_EVENT_FLAGS, VIRTUAL_KEY,
};
use std::time::Duration;

/// Refuses to inject while the secure desktop (UAC consent, lock screen, Ctrl+Alt+Del) or any
/// other non-default desktop has input focus.
pub fn ensure_default_desktop() -> Result<(), BackendError> {
    let refuse = || {
        BackendError::new(
            ErrorCategory::Permission,
            "the secure desktop (UAC prompt, lock screen or sign-in) is active — AutoFlow never automates it",
        )
    };
    // SAFETY: the desktop handle is closed before returning; buffers are valid for the calls.
    unsafe {
        let desk = OpenInputDesktop(DESKTOP_CONTROL_FLAGS(0), false, DESKTOP_READOBJECTS).map_err(|_| refuse())?;
        let mut buf = [0u16; 64];
        let size = u32::try_from(std::mem::size_of_val(&buf)).unwrap_or(128);
        let named = GetUserObjectInformationW(HANDLE(desk.0), UOI_NAME, Some(buf.as_mut_ptr().cast()), size, None);
        let _closed = CloseDesktop(desk);
        named.map_err(|_| refuse())?;
        if !from_wide(&buf).eq_ignore_ascii_case("Default") {
            return Err(refuse());
        }
    }
    Ok(())
}

fn mouse(dx: i32, dy: i32, data: i32, flags: MOUSE_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_MOUSE,
        Anonymous: INPUT_0 {
            mi: MOUSEINPUT {
                dx,
                dy,
                mouseData: u32::from_ne_bytes(data.to_ne_bytes()),
                dwFlags: flags,
                time: 0,
                dwExtraInfo: INJECTED_MARKER,
            },
        },
    }
}

fn keybd(vk: u16, scan: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), wScan: scan, dwFlags: flags, time: 0, dwExtraInfo: INJECTED_MARKER } },
    }
}

/// Sends a batch of inputs atomically.
pub fn send(inputs: &[INPUT]) -> Result<(), BackendError> {
    if inputs.is_empty() {
        return Ok(());
    }
    let size = i32::try_from(std::mem::size_of::<INPUT>()).unwrap_or(40);
    // SAFETY: `inputs` is a valid slice of initialised INPUT structures.
    let sent = unsafe { SendInput(inputs, size) };
    if usize::try_from(sent).unwrap_or(0) != inputs.len() {
        return Err(BackendError::new(
            ErrorCategory::Permission,
            "Windows blocked the input (the target app may be running as administrator, or a secure desktop is active)",
        ));
    }
    Ok(())
}

fn key_event(spec: KeySpec, up: bool) -> INPUT {
    // SAFETY: MapVirtualKeyW has no preconditions.
    let scan = unsafe { MapVirtualKeyW(u32::from(spec.vk), MAPVK_VK_TO_VSC) };
    let mut flags = KEYBD_EVENT_FLAGS(0);
    if spec.extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    keybd(spec.vk, u16::try_from(scan).unwrap_or(0), flags)
}

fn implied_modifiers(spec: KeySpec) -> Vec<Modifier> {
    let mut out = Vec::new();
    if spec.implied[0] {
        out.push(Modifier::Shift);
    }
    if spec.implied[1] {
        out.push(Modifier::Ctrl);
    }
    if spec.implied[2] {
        out.push(Modifier::Alt);
    }
    out
}

fn all_modifiers(spec: KeySpec, modifiers: &[Modifier]) -> Vec<Modifier> {
    let mut mods = modifiers.to_vec();
    for m in implied_modifiers(spec) {
        if !mods.contains(&m) {
            mods.push(m);
        }
    }
    mods
}

/// Presses (down + up) a key with modifiers.
pub fn key_press(spec: KeySpec, modifiers: &[Modifier]) -> Result<(), BackendError> {
    let mods = all_modifiers(spec, modifiers);
    let mut batch: Vec<INPUT> = mods.iter().map(|m| key_event(modifier_vk(*m), false)).collect();
    batch.push(key_event(spec, false));
    batch.push(key_event(spec, true));
    batch.extend(mods.iter().rev().map(|m| key_event(modifier_vk(*m), true)));
    send(&batch)
}

/// Sends only the down (or only the up) transition, modifiers included.
pub fn key_transition(spec: KeySpec, modifiers: &[Modifier], up: bool) -> Result<(), BackendError> {
    let mods = all_modifiers(spec, modifiers);
    let batch: Vec<INPUT> = if up {
        std::iter::once(key_event(spec, true)).chain(mods.iter().rev().map(|m| key_event(modifier_vk(*m), true))).collect()
    } else {
        mods.iter().map(|m| key_event(modifier_vk(*m), false)).chain(std::iter::once(key_event(spec, false))).collect()
    };
    send(&batch)
}

/// Releases (`up = true`) or re-presses physically held modifiers around a remapped key.
pub fn modifiers_transition(modifiers: &[Modifier], up: bool) -> Result<(), BackendError> {
    send(&modifiers.iter().map(|m| key_event(modifier_vk(*m), up)).collect::<Vec<_>>())
}

/// Types text with `KEYEVENTF_UNICODE` (layout independent). `\n` and `\t` become Enter / Tab.
pub fn type_text(text: &str, per_char_delay_ms: u64, control: &RunControl) -> Result<(), BackendError> {
    let mut batch = Vec::new();
    let flush = |batch: &mut Vec<INPUT>| -> Result<(), BackendError> {
        let r = send(batch);
        batch.clear();
        r
    };
    let mut prev_cr = false;
    for c in text.chars() {
        if control.is_stopped() {
            return Err(BackendError::aborted());
        }
        match c {
            '\r' => {
                prev_cr = true;
                batch.push(key_event(KeySpec { vk: 0x0D, extended: false, implied: [false; 3] }, false));
                batch.push(key_event(KeySpec { vk: 0x0D, extended: false, implied: [false; 3] }, true));
            }
            '\n' if prev_cr => prev_cr = false,
            '\n' | '\t' => {
                prev_cr = false;
                let spec = KeySpec { vk: if c == '\n' { 0x0D } else { 0x09 }, extended: false, implied: [false; 3] };
                batch.push(key_event(spec, false));
                batch.push(key_event(spec, true));
            }
            _ => {
                prev_cr = false;
                let mut units = [0u16; 2];
                for u in c.encode_utf16(&mut units) {
                    batch.push(keybd(0, *u, KEYEVENTF_UNICODE));
                    batch.push(keybd(0, *u, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
                }
            }
        }
        if per_char_delay_ms > 0 {
            flush(&mut batch)?;
            pause(per_char_delay_ms, control)?;
        } else if batch.len() >= 64 {
            flush(&mut batch)?;
        }
    }
    flush(&mut batch)
}

/// Moves the pointer to a physical virtual-desktop point.
pub fn move_to(x: i32, y: i32) -> Result<(), BackendError> {
    let (ax, ay) = screen::to_absolute(x, y);
    send(&[mouse(ax, ay, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK)])
}

/// Moves smoothly over `duration_ms` (≈ 100 Hz), honouring stop requests.
pub fn glide_to(from: (i32, i32), to: (i32, i32), duration_ms: u64, control: &RunControl) -> Result<(), BackendError> {
    let steps = (duration_ms / 10).clamp(1, 2000);
    for i in 1..=steps {
        if control.is_stopped() {
            return Err(BackendError::aborted());
        }
        #[allow(clippy::cast_precision_loss)]
        let f = i as f64 / steps as f64;
        #[allow(clippy::cast_possible_truncation)]
        let p = |a: i32, b: i32| (f64::from(a) + (f64::from(b) - f64::from(a)) * f).round() as i32;
        move_to(p(from.0, to.0), p(from.1, to.1))?;
        if i < steps {
            std::thread::sleep(Duration::from_millis(duration_ms / steps));
        }
    }
    Ok(())
}

fn button_flags(button: MouseButton, up: bool) -> (MOUSE_EVENT_FLAGS, i32) {
    match (button, up) {
        (MouseButton::Left, false) => (MOUSEEVENTF_LEFTDOWN, 0),
        (MouseButton::Left, true) => (MOUSEEVENTF_LEFTUP, 0),
        (MouseButton::Right, false) => (MOUSEEVENTF_RIGHTDOWN, 0),
        (MouseButton::Right, true) => (MOUSEEVENTF_RIGHTUP, 0),
        (MouseButton::Middle, false) => (MOUSEEVENTF_MIDDLEDOWN, 0),
        (MouseButton::Middle, true) => (MOUSEEVENTF_MIDDLEUP, 0),
        (MouseButton::X1, false) => (MOUSEEVENTF_XDOWN, 1),
        (MouseButton::X1, true) => (MOUSEEVENTF_XUP, 1),
        (MouseButton::X2, false) => (MOUSEEVENTF_XDOWN, 2),
        (MouseButton::X2, true) => (MOUSEEVENTF_XUP, 2),
    }
}

/// Presses or releases a mouse button at the current position.
pub fn button(button: MouseButton, up: bool) -> Result<(), BackendError> {
    let (flags, data) = button_flags(button, up);
    send(&[mouse(0, 0, data, flags)])
}

/// Releases a button (and modifiers) when dropped unless disarmed.
pub struct HeldGuard {
    button: Option<MouseButton>,
    modifiers: Vec<Modifier>,
}

impl HeldGuard {
    /// Arms the guard.
    pub fn new(button: Option<MouseButton>, modifiers: &[Modifier]) -> Self {
        Self { button, modifiers: modifiers.to_vec() }
    }
    /// Releases now and disarms.
    pub fn release(mut self) -> Result<(), BackendError> {
        self.release_inner()
    }
    fn release_inner(&mut self) -> Result<(), BackendError> {
        let mut r = Ok(());
        if let Some(b) = self.button.take() {
            r = button(b, true);
        }
        let mods = std::mem::take(&mut self.modifiers);
        if !mods.is_empty() {
            let m = modifiers_transition(&mods.into_iter().rev().collect::<Vec<_>>(), true);
            r = r.and(m);
        }
        r
    }
}

impl Drop for HeldGuard {
    fn drop(&mut self) {
        let _ignored = self.release_inner();
    }
}

/// Clicks `clicks` times (optionally holding for `hold_ms`) with modifiers held.
pub fn click(btn: MouseButton, clicks: u32, hold_ms: u64, modifiers: &[Modifier], control: &RunControl) -> Result<(), BackendError> {
    modifiers_transition(modifiers, false)?;
    let mod_guard = HeldGuard::new(None, modifiers);
    for i in 0..clicks.max(1) {
        if control.is_stopped() {
            return Err(BackendError::aborted());
        }
        button(btn, false)?;
        let guard = HeldGuard::new(Some(btn), &[]);
        if hold_ms > 0 {
            pause(hold_ms, control)?;
        }
        guard.release()?;
        if i + 1 < clicks {
            std::thread::sleep(Duration::from_millis(30));
        }
    }
    mod_guard.release()
}

/// Wheel scroll. `dy > 0` scrolls down and `dx > 0` scrolls right (web convention); values are
/// wheel delta units (120 = one notch).
pub fn wheel(dx: i64, dy: i64) -> Result<(), BackendError> {
    let mut batch = Vec::new();
    let clamp = |v: i64| i32::try_from(v.clamp(-1_000_000, 1_000_000)).unwrap_or(0);
    if dy != 0 {
        batch.push(mouse(0, 0, -clamp(dy), MOUSEEVENTF_WHEEL));
    }
    if dx != 0 {
        batch.push(mouse(0, 0, clamp(dx), MOUSEEVENTF_HWHEEL));
    }
    send(&batch)
}

/// Waits `ms`, returning [`BackendError::aborted`] as soon as the run is stopped.
pub fn pause(ms: u64, control: &RunControl) -> Result<(), BackendError> {
    let deadline = std::time::Instant::now() + Duration::from_millis(ms);
    loop {
        let now = std::time::Instant::now();
        if now >= deadline {
            return Ok(());
        }
        if control.wait_for_stop((deadline - now).min(Duration::from_millis(crate::engine::SLICE_MS))) {
            return Err(BackendError::aborted());
        }
    }
}
