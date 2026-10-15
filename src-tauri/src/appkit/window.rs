//! AppKit Native Stealth Window Layer
//!
//! Enforces 100% screen-share invisibility, fullscreen auxiliary overlay persistence,
//! and background transparency via native AppKit APIs.

#![allow(deprecated)]
#![allow(non_upper_case_globals)]
#![allow(non_snake_case)]
#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSColor, NSWindow, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil, NO};
#[cfg(target_os = "macos")]
use objc::{msg_send, sel, sel_impl};

/// NSWindowSharingType representation according to macOS AppKit specifications:
/// - `NSWindowSharingNone` (0): The window contents cannot be read by screen capture APIs (Zoom, Meet, Teams, OBS, QuickTime).
/// - `NSWindowSharingReadOnly` (1): The window contents can only be read by the owning process.
/// - `NSWindowSharingReadWrite` (2): The window contents can be read and written.
#[repr(usize)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NSWindowSharingType {
    NSWindowSharingNone = 0,
    NSWindowSharingReadOnly = 1,
    NSWindowSharingReadWrite = 2,
}

/// Level of a floating window above standard application windows and fullscreen spaces.
/// In macOS AppKit, `NSFloatingWindowLevel` corresponds to `kCGFloatingWindowLevel` = 3.
pub const NSFloatingWindowLevel: i64 = 3;

/// Extension trait providing native `NSWindow` stealth and sharing configuration.
pub trait NSWindowStealthExt {
    /// Configures the sharing type for this `NSWindow`.
    /// Calling with `NSWindowSharingType::NSWindowSharingNone` guarantees 100% invisibility
    /// to screen sharing and recording software (Zoom, Google Meet, Microsoft Teams, OBS, QuickTime, etc.).
    unsafe fn setSharingType_(self, sharing_type: NSWindowSharingType);
}

#[cfg(target_os = "macos")]
impl NSWindowStealthExt for id {
    unsafe fn setSharingType_(self, sharing_type: NSWindowSharingType) {
        if !self.is_null() {
            let _: () = msg_send![self, setSharingType: sharing_type as usize];
        }
    }
}

/// Configures the native macOS `NSWindow` for stealth overlay operation:
/// 1. Sets sharing type to `NSWindowSharingNone` (100% invisible to screen recording/sharing).
/// 2. Sets window level to `NSFloatingWindowLevel` (floats above fullscreen applications and IDEs).
/// 3. Sets collection behavior to `NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorCanJoinAllSpaces`
///    (persists across all virtual desktops / spaces and stays above fullscreen apps).
/// 4. Sets background color to clear and window opacity to non-opaque (`setOpaque_(NO)`).
#[cfg(target_os = "macos")]
pub fn configure_stealth_window(ns_window: id) {
    if ns_window.is_null() {
        return;
    }
    unsafe {
        // Exclude window from all screen sharing, recording, and capture APIs (REQ-001, AC-001)
        ns_window.setSharingType_(NSWindowSharingType::NSWindowSharingNone);

        // Ensure window floats above fullscreen spaces (REQ-003)
        ns_window.setLevel_(NSFloatingWindowLevel as i64);

        // Make overlay persistent across all spaces and usable with fullscreen auxiliary windows (REQ-003)
        ns_window.setCollectionBehavior_(
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces,
        );

        // Configure transparent background and disable window-level drop shadow
        ns_window.setOpaque_(NO);
        let clear_color = NSColor::clearColor(nil);
        ns_window.setBackgroundColor_(clear_color);
        let _: () = msg_send![ns_window, setHasShadow: NO];
    }
}

/// Helper to configure stealth properties directly from a Tauri `WebviewWindow`.
#[cfg(target_os = "macos")]
pub fn configure_tauri_window<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    let ns_window = window.ns_window()? as id;
    configure_stealth_window(ns_window);
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_tauri_window<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    Ok(())
}

/// Sets the native macOS window opacity / alpha value.
///
/// `alpha` is clamped between 0.0 (completely transparent) and 1.0 (fully opaque).
#[cfg(target_os = "macos")]
pub fn set_window_opacity<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    alpha: f64,
) -> Result<(), tauri::Error> {
    let ns_window = window.ns_window()? as id;
    if !ns_window.is_null() {
        let clamped = alpha.clamp(0.0, 1.0);
        unsafe {
            ns_window.setAlphaValue_(clamped as cocoa::appkit::CGFloat);
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn set_window_opacity<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
    _alpha: f64,
) -> Result<(), tauri::Error> {
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_stealth_window(_ns_window: *mut std::ffi::c_void) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sharing_type_values() {
        assert_eq!(NSWindowSharingType::NSWindowSharingNone as usize, 0);
        assert_eq!(NSWindowSharingType::NSWindowSharingReadOnly as usize, 1);
        assert_eq!(NSWindowSharingType::NSWindowSharingReadWrite as usize, 2);
    }

    #[test]
    fn test_floating_window_level() {
        assert_eq!(NSFloatingWindowLevel, 3);
    }

    #[test]
    fn test_nil_window_safety() {
        #[cfg(target_os = "macos")]
        {
            let nil_window: cocoa::base::id = cocoa::base::nil;
            configure_stealth_window(nil_window);
        }
    }

    #[test]
    fn test_collection_behavior_bitmask() {
        #[cfg(target_os = "macos")]
        {
            use cocoa::appkit::NSWindowCollectionBehavior;
            let behavior = NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
                | NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces;
            assert!(behavior.bits() > 0);
        }
    }
}
