//! AppKit Headless Phantom Accessory Policy
//!
//! Enforces headless phantom operation:
//! - Activates `NSApplicationActivationPolicyAccessory` to hide the application from the Dock and `Cmd + Tab` switcher.
//! - Enforces zero persistent tray/status bar presence.

#![allow(deprecated)]

#[cfg(target_os = "macos")]
use cocoa::appkit::{
    NSApp, NSApplication,
    NSApplicationActivationPolicy::NSApplicationActivationPolicyAccessory,
};

/// Configures headless phantom operation for Sidekick:
/// Sets the macOS application activation policy to Accessory (`NSApplicationActivationPolicyAccessory`).
///
/// Effects:
/// 1. Excludes the application icon completely from the macOS Dock.
/// 2. Excludes the application completely from the `Cmd + Tab` application switcher.
/// 3. Ensures 100% headless phantom operation with NO Menu Bar / Status Bar / System Tray icon.
///
/// Sidekick is summoned exclusively via global hotkeys (e.g. `Cmd + Shift + Space`),
/// and settings are accessible only from within the summoned overlay UI.
pub fn configure_accessory_policy() {
    #[cfg(target_os = "macos")]
    unsafe {
        let app = NSApp();
        app.setActivationPolicy_(NSApplicationActivationPolicyAccessory);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_configure_accessory_policy() {
        // Calling configure_accessory_policy should succeed safely on macOS
        configure_accessory_policy();
    }
}
