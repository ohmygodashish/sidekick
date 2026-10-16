//! Sidekick Core Library

pub mod appkit;
pub mod audio;
pub mod capture;
pub mod hit_region;
pub mod hotkeys;
pub mod storage;

use tauri::{Emitter, Manager};

#[tauri::command]
fn store_api_key(provider: String, key: String) -> Result<(), String> {
    storage::config::store_api_key(&provider, &key)
}

#[tauri::command]
fn retrieve_api_key(provider: String) -> Result<String, String> {
    storage::config::retrieve_api_key(&provider)
}

#[tauri::command]
fn load_settings() -> Result<Option<String>, String> {
    storage::config::load_settings()
}

#[tauri::command]
fn save_settings(settings: String) -> Result<(), String> {
    storage::config::save_settings(&settings)
}

#[tauri::command]
fn burn_session(app: tauri::AppHandle) -> Result<(), String> {
    // 1. Instantly purge all active audio ring buffers and halt streams (SEC-003, REQ-004)
    if let Some(audio_state) = app.try_state::<audio::AudioState>() {
        audio_state.purge();
    }
    // 2. Eradicate SQLite session DB records & files (SEC-003, REQ-017)
    storage::db::burn_session()?;
    // 3. Emit session burned event to frontend
    let _ = app.emit("sidekick://session_burned", ());
    Ok(())
}

/// Sizes the window to the main screen's height and places it top-centre, just under the menu
/// bar. It never resizes after this; `hit_region` passes clicks through around the UI.
fn place_top_centre<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) -> tauri::Result<()> {
    let Some(monitor) = window.primary_monitor()?.or(window.current_monitor()?) else {
        return Ok(());
    };
    let area = monitor.work_area();
    let margin = (8.0 * monitor.scale_factor()) as u32;
    let width = window.outer_size()?.width;
    window.set_size(tauri::PhysicalSize::new(width, area.size.height.saturating_sub(2 * margin)))?;
    let x = area.position.x + (area.size.width as i32 - width as i32) / 2;
    window.set_position(tauri::PhysicalPosition::new(x, area.position.y + margin as i32))
}

use audio::commands::*;
use capture::capture_active_window;
use hotkeys::commands::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey_plugin = tauri_plugin_global_shortcut::Builder::new()
        .with_shortcuts([
            hotkeys::SHORTCUT_PANIC,
            hotkeys::SHORTCUT_TOGGLE_VISIBILITY,
            hotkeys::SHORTCUT_TOGGLE_CLICK_THROUGH,
            hotkeys::SHORTCUT_TOGGLE_LAYOUT_MODE,
            hotkeys::SHORTCUT_CAPTURE_ACTIVE_WINDOW,
            hotkeys::SHORTCUT_PICK_OPTIONS[0],
            hotkeys::SHORTCUT_PICK_OPTIONS[1],
            hotkeys::SHORTCUT_PICK_OPTIONS[2],
        ])
        .expect("failed to configure default global shortcuts")
        .with_handler(|app, shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                hotkeys::handle_shortcut(app, shortcut);
            }
        })
        .build();

    let builder = tauri::Builder::default();
    // Tauri activates the app at launch by default, which takes focus before the overlay is shown
    #[cfg(target_os = "macos")]
    let builder = builder.activate_ignoring_other_apps(false);

    builder
        .manage(hotkeys::HotkeyState::default())
        .manage(audio::AudioState::default())
        .manage(hit_region::HitRegions::default())
        .plugin(hotkey_plugin)
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event {
                if let Some(webview_window) = window.app_handle().get_webview_window(window.label()) {
                    appkit::window::on_became_key(&webview_window);
                }
            }
        })
        .setup(|app| {
            // Ensure local ephemeral session.db exists
            let _ = storage::db::open_session_db();

            if let Some(main_window) = app.get_webview_window("main") {
                place_top_centre(&main_window)?;
            }
            hit_region::spawn_poller(app.handle().clone());

            // Debug builds only: SIDEKICK_DEV_VISIBLE=1 skips screen-share hiding and shows the
            // window at launch, so the UI can be screenshotted while developing.
            let dev_visible =
                cfg!(debug_assertions) && std::env::var_os("SIDEKICK_DEV_VISIBLE").is_some();

            #[cfg(target_os = "macos")]
            {
                // 1. Configure headless phantom accessory policy (zero Dock icon, excluded from Cmd+Tab, zero tray)
                appkit::configure_accessory_policy();

                // 2. Showing and clicking the overlay never activate Sidekick (also in dev-visible mode)
                if let Some(main_window) = app.get_webview_window("main") {
                    appkit::configure_non_activating(&main_window)?;
                }

                // 3. Configure stealth overlay on the main window (Task 2 cleanup: safe wrapper)
                if let Some(main_window) = app.get_webview_window("main") {
                    if !dev_visible {
                        appkit::configure_tauri_window(&main_window)?;
                    }
                }
            }

            if dev_visible {
                if let Some(main_window) = app.get_webview_window("main") {
                    appkit::show_without_activating(&main_window)?;
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            set_click_through,
            hit_region::set_hit_regions,
            trigger_panic,
            hide_window,
            release_focus,
            focus_for_typing,
            set_window_opacity,
            set_layout_mode,
            get_hotkey_state,
            store_api_key,
            retrieve_api_key,
            load_settings,
            save_settings,
            burn_session,
            capture_active_window,
            start_audio_capture,
            stop_audio_capture,
            get_audio_capture_state,
            set_stt_engine,
            get_stt_engine,
            list_local_stt_models,
            download_stt_model,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
