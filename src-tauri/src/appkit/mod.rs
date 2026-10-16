//! AppKit Native Integration Module
//!
//! Exposes native macOS stealth window configuration and headless accessory activation policy.

pub mod accessory;
pub mod window;

pub use accessory::configure_accessory_policy;
pub use window::{
    configure_non_activating, configure_stealth_window, configure_tauri_window, focus_for_typing,
    on_became_key, release_key_focus, set_window_opacity, show_without_activating,
    NSFloatingWindowLevel, NSWindowSharingType, NSWindowStealthExt,
};
