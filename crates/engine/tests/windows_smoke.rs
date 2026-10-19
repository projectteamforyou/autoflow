//! Smoke tests for the Win32 layer. They run on Windows (CI `windows-latest`) and under Wine;
//! nothing here moves the real pointer or types into other apps.
#![cfg(windows)]
#![allow(clippy::unwrap_used, clippy::expect_used)]

use autoflow_engine::schema::{default_stop_hotkey, Hotkey, Modifier};
use autoflow_engine::windows::{clipboard, credentials, hotkeys::HotkeyService, keymap, screen, shell};
use std::sync::Arc;

#[test]
fn credential_manager_round_trip() {
    let name = format!("smoke_{}", std::process::id());
    credentials::set(&name, "s3cret ✓").expect("write");
    assert_eq!(credentials::get(&name).as_deref(), Some("s3cret ✓"));
    assert!(credentials::list().contains(&name));
    credentials::delete(&name).expect("delete");
    assert_eq!(credentials::get(&name), None);
    credentials::delete(&name).expect("deleting twice is fine");
    assert!(credentials::set("../bad name", "x").is_err());
}

#[test]
fn key_names_map_to_virtual_keys() {
    let vk = |k: &str| keymap::key_spec(k).map(|s| (s.vk, s.extended));
    assert_eq!(vk("Enter"), Some((0x0D, false)));
    assert_eq!(vk("Escape"), Some((0x1B, false)));
    assert_eq!(vk("Esc"), Some((0x1B, false)));
    assert_eq!(vk("Space"), Some((0x20, false)));
    assert_eq!(vk(" "), Some((0x20, false)));
    assert_eq!(vk("a"), Some((0x41, false)));
    assert_eq!(vk("S"), Some((0x53, false)));
    assert_eq!(vk("7"), Some((0x37, false)));
    assert_eq!(vk("F5"), Some((0x74, false)));
    assert_eq!(vk("F24"), Some((0x87, false)));
    assert_eq!(vk("ArrowLeft"), Some((0x25, true)));
    assert_eq!(vk("MediaPlayPause"), Some((0xB3, true)));
    assert_eq!(vk("Meta"), Some((0x5B, true)));
    assert_eq!(keymap::key_name(0x1B, None), "Escape");
    assert_eq!(keymap::key_name(0x20, Some(" ")), " ");
    assert_eq!(keymap::key_name(0x41, Some("A")), "A");
    assert_eq!(keymap::key_name(0x70, None), "F1");
    assert_eq!(keymap::key_name(0xA2, None), "Control");
}

#[test]
fn absolute_coordinates_cover_the_virtual_desktop() {
    let v = screen::virtual_screen();
    if v.right - v.left < 2 {
        return; // headless
    }
    assert_eq!(screen::to_absolute(v.left, v.top), (0, 0));
    assert_eq!(screen::to_absolute(v.right - 1, v.bottom - 1), (65535, 65535));
}

#[test]
fn clipboard_round_trip_when_available() {
    if clipboard::set_text("AutoFlow ✓ 클립보드").is_err() {
        return; // no clipboard owner window (headless Wine)
    }
    assert_eq!(clipboard::get_text().expect("read"), "AutoFlow ✓ 클립보드");
}

#[test]
fn hotkey_service_starts_registers_and_stops() {
    let svc = HotkeyService::start(Arc::new(|_| {})).expect("thread");
    let rare = Hotkey { key: "F23".into(), modifiers: vec![Modifier::Ctrl, Modifier::Alt, Modifier::Shift] };
    let results = svc.set(vec![(1, default_stop_hotkey()), (2, rare)]);
    assert_eq!(results.len(), 2);
    let bad = svc.set(vec![(3, Hotkey { key: "NoSuchKey".into(), modifiers: vec![] })]);
    assert!(bad[0].1.as_ref().is_err_and(|e| e.contains("unknown key")));
    drop(svc);
}

#[test]
fn shell_rejects_unsafe_urls() {
    assert!(shell::open_url("file:///C:/Windows/System32/calc.exe").is_err());
    assert!(shell::open_url("javascript:alert(1)").is_err());
    assert_eq!(shell::quote_arg("a b"), "\"a b\"");
}
