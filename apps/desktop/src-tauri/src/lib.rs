//! AutoFlow for Windows — Tauri 2 shell.
//!
//! - Frontend: the AutoFlow web app build (`apps/web/dist`), talking to native code through the
//!   bridge in `packages/core/src/bridge.ts` ([`commands`]) and the `autoflow://event` channel.
//! - Runs execute in the Rust engine (`autoflow_engine`) on background threads, so they keep
//!   going while the window is hidden in the tray.
//! - Safety: Halt (Ctrl+Alt+Esc by default, or the tray menu) stops every run within one sleep
//!   slice; the secure desktop is never automated.
//! - Single instance, start-up registration (autostart), window position memory (window-state).

pub mod commands;
pub mod platform;
pub mod runs;
pub mod state;
pub mod tray;
pub mod triggers;

use state::{lock, AppState, Hooks};
use std::sync::Arc;
use tauri::{Manager, RunEvent, WindowEvent};

/// Shows and focuses the main window.
pub fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _shown = w.show();
        let _unminimized = w.unminimize();
        let _focused = w.set_focus();
    }
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    platform::init();
    let images_dir = app.path().app_data_dir().map(|d| d.join("images")).unwrap_or_else(|_| std::env::temp_dir().join("autoflow-images"));
    let _created = std::fs::create_dir_all(&images_dir);
    app.manage(AppState::new(images_dir));
    let handle = app.handle().clone();

    let hk_app = handle.clone();
    match platform::Hotkeys::start(Arc::new(move |id| triggers::on_hotkey(&hk_app, id))) {
        Ok(h) => {
            *lock(&app.state::<AppState>().hotkeys) = Some(h);
            if let Err(e) = triggers::register_halt(&handle) {
                eprintln!("autoflow: emergency stop hotkey unavailable: {e}");
            }
        }
        Err(e) => eprintln!("autoflow: global hotkeys unavailable: {e}"),
    }
    match platform::Keyforge::start(Arc::new(Hooks { app: handle.clone() })) {
        Ok(k) => *lock(&app.state::<AppState>().keyforge) = Some(k),
        Err(e) => eprintln!("autoflow: Keyforge unavailable: {e}"),
    }
    triggers::spawn_watcher(handle.clone());
    tray::create(&handle)?;

    // Started by Windows at sign-in: stay in the tray.
    if std::env::args().any(|a| a == "--autostart") {
        if let Some(w) = app.get_webview_window("main") {
            let _hidden = w.hide();
        }
    }
    Ok(())
}

fn shutdown(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        runs::halt_all(app, "quit");
        // Dropping Keyforge restores pointer settings and removes hooks.
        lock(&state.keyforge).take();
        lock(&state.recorder).take();
        lock(&state.hotkeys).take();
    }
}

/// Builds and runs the app.
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| show_main(app)))
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        // Remember size/position, but never the hidden-in-tray visibility.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .setup(setup)
        .on_window_event(|window, event| {
            // Closing the window keeps AutoFlow (and running flows) alive in the tray.
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _hidden = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::device_info,
            commands::permissions_status,
            commands::permission_request,
            commands::run_start,
            commands::run_pause,
            commands::run_resume,
            commands::run_stop,
            commands::halt_all,
            commands::triggers_sync,
            commands::record_start,
            commands::record_stop,
            commands::pick_point,
            commands::profiles_apply,
            commands::secret_set,
            commands::secret_delete,
            commands::secret_list,
            commands::open_settings,
            commands::autostart_set,
        ]);
    match builder.build(tauri::generate_context!()) {
        Ok(app) => app.run(|handle, event| {
            if let RunEvent::Exit = event {
                shutdown(handle);
            }
        }),
        Err(e) => {
            eprintln!("autoflow: failed to start: {e}");
            std::process::exit(1);
        }
    }
}
