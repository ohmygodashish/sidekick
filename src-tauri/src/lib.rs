//! Sidekick Core Library

pub mod appkit;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                // 1. Configure headless phantom accessory policy (zero Dock icon, excluded from Cmd+Tab, zero tray)
                appkit::configure_accessory_policy();

                // 2. Configure stealth overlay on the main window
                if let Some(main_window) = app.get_webview_window("main") {
                    #[allow(deprecated)]
                    let ns_window = main_window
                        .ns_window()
                        .expect("failed to obtain native NSWindow handle") as cocoa::base::id;
                    appkit::configure_stealth_window(ns_window);
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![greet])
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
