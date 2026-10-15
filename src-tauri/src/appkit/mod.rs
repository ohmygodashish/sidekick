//! AppKit Native Integration Module
//!
//! Exposes native macOS stealth window configuration and headless accessory activation policy.

pub mod accessory;
pub mod window;

pub use accessory::configure_accessory_policy;
pub use window::{
    configure_stealth_window, configure_tauri_window, NSFloatingWindowLevel, NSWindowSharingType,
    NSWindowStealthExt,
};
