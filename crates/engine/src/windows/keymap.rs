//! W3C key names ⇄ Windows virtual-key codes.

use crate::keys::canonical_key;
use crate::schema::Modifier;
use ::windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyboardLayout, ToUnicodeEx, VkKeyScanW};

/// A key to inject.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KeySpec {
    /// Virtual-key code.
    pub vk: u16,
    /// Needs `KEYEVENTF_EXTENDEDKEY`.
    pub extended: bool,
    /// Modifiers the layout needs to produce the character (from `VkKeyScanW`).
    pub implied: [bool; 3],
}

const fn k(vk: u16, extended: bool) -> KeySpec {
    KeySpec { vk, extended, implied: [false; 3] }
}

/// Named keys: (canonical name, vk, extended).
const NAMED: &[(&str, u16, bool)] = &[
    ("Backspace", 0x08, false),
    ("Tab", 0x09, false),
    ("Clear", 0x0C, false),
    ("Enter", 0x0D, false),
    ("NumpadEnter", 0x0D, true),
    ("Shift", 0x10, false),
    ("Control", 0x11, false),
    ("Alt", 0x12, false),
    ("Pause", 0x13, false),
    ("CapsLock", 0x14, false),
    ("KanaMode", 0x15, false),
    ("HangulMode", 0x15, false),
    ("HanjaMode", 0x19, false),
    ("KanjiMode", 0x19, false),
    ("Escape", 0x1B, false),
    ("Convert", 0x1C, false),
    ("NonConvert", 0x1D, false),
    ("Space", 0x20, false),
    ("PageUp", 0x21, true),
    ("PageDown", 0x22, true),
    ("End", 0x23, true),
    ("Home", 0x24, true),
    ("ArrowLeft", 0x25, true),
    ("ArrowUp", 0x26, true),
    ("ArrowRight", 0x27, true),
    ("ArrowDown", 0x28, true),
    ("Select", 0x29, false),
    ("Execute", 0x2B, false),
    ("PrintScreen", 0x2C, true),
    ("Insert", 0x2D, true),
    ("Delete", 0x2E, true),
    ("Help", 0x2F, false),
    ("Meta", 0x5B, true),
    ("ContextMenu", 0x5D, true),
    ("Sleep", 0x5F, false),
    ("Numpad0", 0x60, false),
    ("Numpad1", 0x61, false),
    ("Numpad2", 0x62, false),
    ("Numpad3", 0x63, false),
    ("Numpad4", 0x64, false),
    ("Numpad5", 0x65, false),
    ("Numpad6", 0x66, false),
    ("Numpad7", 0x67, false),
    ("Numpad8", 0x68, false),
    ("Numpad9", 0x69, false),
    ("NumpadMultiply", 0x6A, false),
    ("NumpadAdd", 0x6B, false),
    ("NumpadSubtract", 0x6D, false),
    ("NumpadDecimal", 0x6E, false),
    ("NumpadDivide", 0x6F, true),
    ("NumLock", 0x90, true),
    ("ScrollLock", 0x91, false),
    ("AltGraph", 0xA5, true),
    ("BrowserBack", 0xA6, true),
    ("BrowserForward", 0xA7, true),
    ("BrowserRefresh", 0xA8, true),
    ("BrowserStop", 0xA9, true),
    ("BrowserSearch", 0xAA, true),
    ("BrowserFavorites", 0xAB, true),
    ("BrowserHome", 0xAC, true),
    ("AudioVolumeMute", 0xAD, true),
    ("AudioVolumeDown", 0xAE, true),
    ("AudioVolumeUp", 0xAF, true),
    ("MediaTrackNext", 0xB0, true),
    ("MediaTrackPrevious", 0xB1, true),
    ("MediaStop", 0xB2, true),
    ("MediaPlayPause", 0xB3, true),
    ("LaunchMail", 0xB4, true),
    ("LaunchMediaPlayer", 0xB5, true),
    ("LaunchApplication1", 0xB6, true),
    ("LaunchApplication2", 0xB7, true),
];

/// Virtual key for a modifier.
pub fn modifier_vk(m: Modifier) -> KeySpec {
    match m {
        Modifier::Ctrl => k(0x11, false),
        Modifier::Alt => k(0x12, false),
        Modifier::Shift => k(0x10, false),
        Modifier::Meta => k(0x5B, true),
    }
}

/// Maps a key name to a virtual key. Characters not on the active layout return `None`
/// (callers type them with `KEYEVENTF_UNICODE`).
pub fn key_spec(name: &str) -> Option<KeySpec> {
    let canon = canonical_key(name)?;
    if let Some((_, vk, ext)) = NAMED.iter().find(|(n, _, _)| *n == canon) {
        return Some(k(*vk, *ext));
    }
    if let Some(n) = canon.strip_prefix('F').and_then(|n| n.parse::<u16>().ok()) {
        if (1..=24).contains(&n) {
            return Some(k(0x6F + n, false));
        }
    }
    let mut chars = canon.chars();
    let (Some(c), None) = (chars.next(), chars.next()) else { return None };
    if c.is_ascii_alphabetic() {
        return Some(k(u16::from(c.to_ascii_uppercase() as u8), false));
    }
    if c.is_ascii_digit() {
        return Some(k(u16::from(c as u8), false));
    }
    let mut units = [0u16; 2];
    let encoded = c.encode_utf16(&mut units);
    if encoded.len() != 1 {
        return None;
    }
    // SAFETY: VkKeyScanW has no preconditions.
    let r = unsafe { VkKeyScanW(units[0]) };
    if r == -1 {
        return None;
    }
    let [lo, hi] = r.to_le_bytes();
    if lo == 0xFF {
        return None;
    }
    Some(KeySpec { vk: u16::from(lo), extended: false, implied: [hi & 1 != 0, hi & 2 != 0, hi & 4 != 0] })
}

/// W3C key name of a physical key, given the character it produced (if any).
pub fn key_name(vk: u32, text: Option<&str>) -> String {
    let printable = text.filter(|t| t.chars().count() == 1 && !t.chars().any(char::is_control));
    let fixed = match vk {
        0xA0 | 0xA1 | 0x10 => Some("Shift"),
        0xA2 | 0xA3 | 0x11 => Some("Control"),
        0xA4 | 0x12 => Some("Alt"),
        0xA5 => Some("AltGraph"),
        0x5B | 0x5C => Some("Meta"),
        0x0D => Some("Enter"),
        0x20 => Some(" "),
        _ => None,
    };
    if let Some(n) = fixed {
        return n.to_owned();
    }
    // Numpad digits/operators produce characters (NumLock on); W3C reports the character.
    if (0x60..=0x6F).contains(&vk) {
        if let Some(t) = printable {
            return t.to_owned();
        }
    }
    if let Some((n, _, _)) = NAMED.iter().find(|(_, v, _)| u32::from(*v) == vk) {
        return (*n).to_owned();
    }
    if (0x70..=0x87).contains(&vk) {
        return format!("F{}", vk - 0x6F);
    }
    if let Some(t) = printable {
        return t.to_owned();
    }
    if (0x41..=0x5A).contains(&vk) || (0x30..=0x39).contains(&vk) {
        return char::from_u32(vk).map_or_else(|| format!("Unidentified{vk}"), |c| c.to_ascii_lowercase().to_string());
    }
    "Unidentified".to_owned()
}

/// Character produced by `vk` with the given modifier state on the foreground thread's layout,
/// without disturbing dead-key state (`ToUnicodeEx` flag 0x4).
pub fn produced_text(vk: u32, scan: u32, shift: bool, caps: bool, altgr: bool, layout_thread: u32) -> Option<String> {
    let mut state = [0u8; 256];
    if shift {
        state[0x10] = 0x80;
    }
    if caps {
        state[0x14] = 0x01;
    }
    if altgr {
        state[0x11] = 0x80;
        state[0x12] = 0x80;
    }
    let mut buf = [0u16; 8];
    // SAFETY: buffers are valid for the call; flag 0x4 keeps the kernel keyboard state intact.
    let n = unsafe {
        let hkl = GetKeyboardLayout(layout_thread);
        ToUnicodeEx(vk, scan, &state, &mut buf, 0x4, Some(hkl))
    };
    if n <= 0 {
        return None;
    }
    let s = String::from_utf16_lossy(&buf[..usize::try_from(n).unwrap_or(0).min(buf.len())]);
    (!s.is_empty()).then_some(s)
}
