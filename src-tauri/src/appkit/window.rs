//! AppKit Native Stealth Window Layer
//!
//! Enforces 100% screen-share invisibility, fullscreen auxiliary overlay persistence,
//! and background transparency via native AppKit APIs.

#![allow(deprecated)]
#![allow(non_upper_case_globals)]
#![allow(non_snake_case)]
#![allow(unexpected_cfgs)]

#[cfg(target_os = "macos")]
use cocoa::appkit::{NSApp, NSColor, NSWindow, NSWindowCollectionBehavior};
#[cfg(target_os = "macos")]
use cocoa::base::{id, nil, BOOL, NO, YES};
#[cfg(target_os = "macos")]
use objc::{class, msg_send, sel, sel_impl};
#[cfg(target_os = "macos")]
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

/// Pid of the app the user was in when Sidekick took the keyboard for typing; 0 when unknown.
#[cfg(target_os = "macos")]
static PREVIOUS_APP_PID: AtomicI32 = AtomicI32::new(0);

/// True while Sidekick holds the keyboard because a text field asked for it.
#[cfg(target_os = "macos")]
static TYPING: AtomicBool = AtomicBool::new(false);

/// Stores the frontmost app's pid as the one to hand focus back to, unless it is Sidekick.
#[cfg(target_os = "macos")]
unsafe fn remember_frontmost_app() {
    let workspace: id = msg_send![class!(NSWorkspace), sharedWorkspace];
    let frontmost: id = msg_send![workspace, frontmostApplication];
    if !frontmost.is_null() {
        let pid: i32 = msg_send![frontmost, processIdentifier];
        if pid != std::process::id() as i32 {
            PREVIOUS_APP_PID.store(pid, Ordering::SeqCst);
        }
    }
}

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

/// Stops showing or clicking the window from activating Sidekick, so the app the user is in keeps
/// the keyboard. Uses the private `_setPreventsActivation:` that tauri-nspanel also relies on.
#[cfg(target_os = "macos")]
pub fn configure_non_activating<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    let ns_window = window.ns_window()? as id;
    if !ns_window.is_null() {
        unsafe {
            // Guarded: the method is private, so skip quietly if a future macOS drops it
            let responds: BOOL =
                msg_send![ns_window, respondsToSelector: sel!(_setPreventsActivation:)];
            if responds != NO {
                let _: () = msg_send![ns_window, _setPreventsActivation: YES];
            }
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn configure_non_activating<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    Ok(())
}

/// Shows the window without activating Sidekick or making it key.
#[cfg(target_os = "macos")]
pub fn show_without_activating<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    let ns_window = window.ns_window()? as id;
    if !ns_window.is_null() {
        unsafe {
            remember_frontmost_app();
            let _: () = msg_send![ns_window, orderFrontRegardless];
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn show_without_activating<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    window.show()
}

/// Makes Sidekick the active app so the text field just focused gets keys. Remembers the app the
/// user was in, so `release_key_focus` can hand the keyboard back to it.
#[cfg(target_os = "macos")]
pub fn focus_for_typing<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    let ns_window = window.ns_window()? as id;
    unsafe {
        let app: id = NSApp();
        if app.is_null() || ns_window.is_null() {
            return Ok(());
        }

        let active: BOOL = msg_send![app, isActive];
        if active == NO {
            remember_frontmost_app();
        }

        TYPING.store(true, Ordering::SeqCst);
        let _: () = msg_send![app, activateIgnoringOtherApps: YES];
        let _: () = msg_send![ns_window, makeKeyWindow];
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn focus_for_typing<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    Ok(())
}

/// Hands the keyboard back to the app the user was in, if Sidekick is still the active app.
#[cfg(target_os = "macos")]
pub fn release_key_focus<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    TYPING.store(false, Ordering::SeqCst);
    unsafe {
        let app: id = NSApp();
        if app.is_null() {
            return Ok(());
        }
        let active: BOOL = msg_send![app, isActive];
        if active == NO {
            return Ok(());
        }

        let pid = PREVIOUS_APP_PID.swap(0, Ordering::SeqCst);
        let previous: id = if pid != 0 {
            msg_send![class!(NSRunningApplication), runningApplicationWithProcessIdentifier: pid]
        } else {
            nil
        };
        if previous.is_null() {
            // Nothing to return to (or it quit): yield activation instead of keeping the keys.
            // `deactivate` is macOS 14+, so check before calling it.
            let can_deactivate: BOOL = msg_send![app, respondsToSelector: sel!(deactivate)];
            if can_deactivate != NO {
                let _: () = msg_send![app, deactivate];
            }
        } else {
            // Option 0: activate that app alone, without pulling all of its windows forward
            let _: BOOL = msg_send![previous, activateWithOptions: 0usize];
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn release_key_focus<R: tauri::Runtime>(
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), tauri::Error> {
    Ok(())
}

/// Called when the window becomes key. wry asks AppKit to activate the app when it creates the
/// web view, and macOS 14+ grants that late, on the first show; hand the keyboard straight back
/// unless a text field asked for it.
#[cfg(target_os = "macos")]
pub fn on_became_key<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    if !TYPING.load(Ordering::SeqCst) {
        let _ = release_key_focus(window);
    }
}

#[cfg(not(target_os = "macos"))]
pub fn on_became_key<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

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
