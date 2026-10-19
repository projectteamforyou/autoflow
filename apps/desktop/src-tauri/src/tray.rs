//! System tray: show the window, Halt every run, quit.

use crate::runs;
use crate::state::emit;
use autoflow_engine::bridge::{BridgeEvent, HotkeyAction};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::AppHandle;

/// Creates the tray icon and its menu.
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show AutoFlow", true, None::<&str>)?;
    let halt = MenuItem::with_id(app, "halt", "Halt all runs (Ctrl+Alt+Esc)", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit AutoFlow", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &halt, &sep, &quit])?;
    let mut builder = TrayIconBuilder::with_id("autoflow")
        .tooltip("AutoFlow")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => crate::show_main(app),
            "halt" => {
                runs::halt_all(app, "halt");
                emit(app, &BridgeEvent::Hotkey { action: HotkeyAction::Halt, flow_id: None });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                crate::show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
