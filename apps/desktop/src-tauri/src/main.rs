// AskAlf Desktop — Tauri Entry Point
//
// Spawns the standalone AskAlf server as a sidecar process,
// waits for it to be healthy, then opens the dashboard in a webview.
// System tray icon for background operation.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    Manager,
    tray::{TrayIconBuilder, MouseButton, MouseButtonState, TrayIconEvent},
    menu::{Menu, MenuItem},
};
use tauri_plugin_shell::ShellExt;
use std::time::Duration;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Build system tray
            let quit = MenuItem::with_id(app, "quit", "Quit AskAlf", true, None::<&str>)?;
            let show = MenuItem::with_id(app, "show", "Open Dashboard", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "quit" => {
                            app.exit(0);
                        }
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Spawn the AskAlf server sidecar
            let shell = app.shell();
            let sidecar = shell
                .sidecar("askalf-server")
                .expect("failed to find askalf-server sidecar");

            let (mut _rx, _child) = sidecar
                .spawn()
                .expect("failed to spawn askalf-server sidecar");

            println!("[AskAlf Desktop] Server sidecar spawned");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AskAlf Desktop");
}
