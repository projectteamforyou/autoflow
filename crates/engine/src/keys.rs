//! Key names. Flows use W3C `KeyboardEvent.key`-style names (`"a"`, `"Enter"`, `"F5"`,
//! `"ArrowLeft"`, `"MediaPlayPause"`) plus a few friendly aliases (`"Space"`, `"Esc"`).
//! [`canonical_key`] maps every accepted spelling to one canonical name so hotkeys, remaps and
//! the platform key tables compare reliably.

/// Canonical name for a key, or `None` when the name is empty.
///
/// - Single characters are kept as-is except ASCII letters, which are lower-cased
///   (`"S"` and `"s"` are the same physical key).
/// - Named keys are matched case-insensitively against the W3C list and common aliases.
pub fn canonical_key(name: &str) -> Option<String> {
    if name.is_empty() {
        return None;
    }
    let mut chars = name.chars();
    if let (Some(c), None) = (chars.next(), chars.next()) {
        if c == ' ' {
            return Some("Space".into());
        }
        return Some(if c.is_ascii_alphabetic() { c.to_ascii_lowercase().to_string() } else { c.to_string() });
    }
    let lower = name.to_ascii_lowercase();
    let alias = match lower.as_str() {
        "esc" => "Escape",
        "return" => "Enter",
        "spacebar" | "space" => "Space",
        "del" => "Delete",
        "ins" => "Insert",
        "pgup" => "PageUp",
        "pgdn" | "pgdown" => "PageDown",
        "left" => "ArrowLeft",
        "right" => "ArrowRight",
        "up" => "ArrowUp",
        "down" => "ArrowDown",
        "ctrl" | "control" => "Control",
        "win" | "windows" | "os" | "super" | "cmd" | "command" | "meta" => "Meta",
        "option" => "Alt",
        "apps" | "menu" => "ContextMenu",
        "prtsc" | "printscreen" | "print" => "PrintScreen",
        "break" => "Pause",
        "volumeup" => "AudioVolumeUp",
        "volumedown" => "AudioVolumeDown",
        "volumemute" | "mute" => "AudioVolumeMute",
        "medianexttrack" | "medianext" => "MediaTrackNext",
        "mediaprevioustrack" | "mediaprev" | "mediaprevious" => "MediaTrackPrevious",
        _ => "",
    };
    if !alias.is_empty() {
        return Some(alias.to_owned());
    }
    if let Some(found) = NAMED_KEYS.iter().find(|k| k.eq_ignore_ascii_case(name)) {
        return Some((*found).to_owned());
    }
    // F1..F24
    if let Some(n) = lower.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()) {
        if (1..=24).contains(&n) {
            return Some(format!("F{n}"));
        }
    }
    // Digit / letter codes ("Digit1", "KeyA") as produced by KeyboardEvent.code.
    if let Some(d) = name.strip_prefix("Digit").filter(|d| d.len() == 1 && d.as_bytes()[0].is_ascii_digit()) {
        return Some(d.to_owned());
    }
    if let Some(k) = name.strip_prefix("Key").filter(|k| k.len() == 1 && k.as_bytes()[0].is_ascii_alphabetic()) {
        return Some(k.to_ascii_lowercase());
    }
    Some(name.to_owned())
}

/// True for keys that produce a character when typed without Ctrl/Alt/Meta.
pub fn is_printable(name: &str) -> bool {
    name.chars().count() == 1
}

/// True for modifier keys.
pub fn is_modifier(name: &str) -> bool {
    matches!(name, "Control" | "Alt" | "Shift" | "Meta" | "AltGraph")
}

/// Named (non-character) keys recognised by the engine.
pub const NAMED_KEYS: &[&str] = &[
    "Enter",
    "Tab",
    "Escape",
    "Backspace",
    "Delete",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "ArrowDown",
    "Space",
    "CapsLock",
    "NumLock",
    "ScrollLock",
    "PrintScreen",
    "Pause",
    "ContextMenu",
    "Control",
    "Shift",
    "Alt",
    "AltGraph",
    "Meta",
    "MediaPlayPause",
    "MediaStop",
    "MediaTrackNext",
    "MediaTrackPrevious",
    "AudioVolumeUp",
    "AudioVolumeDown",
    "AudioVolumeMute",
    "BrowserBack",
    "BrowserForward",
    "BrowserRefresh",
    "BrowserStop",
    "BrowserSearch",
    "BrowserFavorites",
    "BrowserHome",
    "LaunchMail",
    "LaunchMediaPlayer",
    "LaunchApplication1",
    "LaunchApplication2",
    "Numpad0",
    "Numpad1",
    "Numpad2",
    "Numpad3",
    "Numpad4",
    "Numpad5",
    "Numpad6",
    "Numpad7",
    "Numpad8",
    "Numpad9",
    "NumpadAdd",
    "NumpadSubtract",
    "NumpadMultiply",
    "NumpadDivide",
    "NumpadDecimal",
    "NumpadEnter",
    "HangulMode",
    "HanjaMode",
    "KanaMode",
    "KanjiMode",
    "Convert",
    "NonConvert",
    "Sleep",
    "Help",
    "Clear",
    "Select",
    "Execute",
];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_aliases() {
        assert_eq!(canonical_key("Esc").as_deref(), Some("Escape"));
        assert_eq!(canonical_key(" ").as_deref(), Some("Space"));
        assert_eq!(canonical_key("space").as_deref(), Some("Space"));
        assert_eq!(canonical_key("S").as_deref(), Some("s"));
        assert_eq!(canonical_key("f12").as_deref(), Some("F12"));
        assert_eq!(canonical_key("arrowleft").as_deref(), Some("ArrowLeft"));
        assert_eq!(canonical_key("KeyQ").as_deref(), Some("q"));
        assert_eq!(canonical_key(";").as_deref(), Some(";"));
        assert_eq!(canonical_key(""), None);
    }
}
