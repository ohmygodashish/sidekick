//! Sidekick Core Library

pub mod appkit;
pub mod audio;
pub mod capture;
pub mod hotkeys;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn store_api_key(_provider: String, _key: String) -> Result<(), String> {
    // In-memory / keychain placeholder until Task 13 native Keychain integration
    Ok(())
}

#[tauri::command]
fn retrieve_api_key(_provider: String) -> Result<Option<String>, String> {
    // In-memory / keychain placeholder until Task 13 native Keychain integration
    Ok(None)
}

#[tauri::command]
fn burn_session(app: tauri::AppHandle) -> Result<(), String> {
    // Instantly purge all active audio ring buffers and halt streams (SEC-003, REQ-004)
    if let Some(audio_state) = app.try_state::<audio::AudioState>() {
        audio_state.purge();
    }
    Ok(())
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
        ])
        .expect("failed to configure default global shortcuts")
        .with_handler(|app, shortcut, event| {
            if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                hotkeys::handle_shortcut(app, shortcut);
            }
        })
        .build();

    tauri::Builder::default()
        .manage(hotkeys::HotkeyState::default())
        .manage(audio::AudioState::default())
        .plugin(hotkey_plugin)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                // 1. Configure headless phantom accessory policy (zero Dock icon, excluded from Cmd+Tab, zero tray)
                appkit::configure_accessory_policy();

                // 2. Configure stealth overlay on the main window (Task 2 cleanup: safe wrapper)
                if let Some(main_window) = app.get_webview_window("main") {
                    appkit::configure_tauri_window(&main_window)?;
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            set_click_through,
            trigger_panic,
            set_window_opacity,
            set_layout_mode,
            get_hotkey_state,
            store_api_key,
            retrieve_api_key,
            burn_session,
            capture_active_window,
            start_audio_capture,
            stop_audio_capture,
            get_audio_capture_state,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_greet() {
        assert_eq!(greet("World"), "Hello, World! You've been greeted from Rust!");
    }
}
