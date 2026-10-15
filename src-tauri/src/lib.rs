//! Sidekick Core Library

pub mod appkit;
pub mod audio;
pub mod capture;
pub mod hotkeys;
pub mod storage;

use tauri::{Emitter, Manager};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn store_api_key(provider: String, key: String) -> Result<(), String> {
    storage::keychain::store_credential(&provider, &key)
}

#[tauri::command]
fn retrieve_api_key(provider: String) -> Result<String, String> {
    storage::keychain::retrieve_credential(&provider)
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
            // Ensure local ephemeral session.db exists
            let _ = storage::db::open_session_db();

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
            set_stt_engine,
            get_stt_engine,
            list_local_stt_models,
            download_stt_model,
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

    #[test]
    fn test_store_and_retrieve_api_key_commands() {
        storage::keychain::set_mock_mode(true);
        storage::keychain::clear_fallback();

        assert_eq!(retrieve_api_key("openrouter".into()).unwrap(), "");

        store_api_key("openrouter".into(), "sk-or-v1-my-secret-key".into()).unwrap();
        assert_eq!(
            retrieve_api_key("openrouter".into()).unwrap(),
            "sk-or-v1-my-secret-key"
        );

        // Clear key
        store_api_key("openrouter".into(), "".into()).unwrap();
        assert_eq!(retrieve_api_key("openrouter".into()).unwrap(), "");

        storage::keychain::set_mock_mode(false);
    }
}
