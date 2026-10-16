//! Silent Active-Window Capture Engine
//!
//! Captures the frontmost active application window without camera sounds,
//! crosshairs, or focus disruption using macOS CoreGraphics Quartz Window Services (REQ-013, AC-003).

use serde::{Deserialize, Serialize};

/// Data contract for active window vision capture
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WindowCaptureResponse {
    pub base64_image: String,
    pub window_title: Option<String>,
    pub app_name: Option<String>,
    pub width: u32,
    pub height: u32,
}

/// Metadata describing a window queried from macOS CoreGraphics
#[derive(Debug, Clone, PartialEq)]
pub struct WindowInfo {
    pub window_id: u32,
    pub pid: i64,
    pub layer: i32,
    pub app_name: Option<String>,
    pub window_title: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub alpha: f64,
    pub is_onscreen: bool,
}

/// Determines if a window is an interactive user application window
/// (filtering out Sidekick, menubar, desktop, dock, system overlays, and zero-size helper rects).
pub fn is_valid_active_window(info: &WindowInfo, own_pid: i64) -> bool {
    // 1. Exclude Sidekick's own process
    if info.pid == own_pid || info.pid <= 0 {
        return false;
    }

    // 2. Normal application windows must reside on standard window layer 0 (kCGNormalWindowLevel)
    if info.layer != 0 {
        return false;
    }

    // 3. Exclude completely or nearly transparent windows
    if info.alpha < 0.05 {
        return false;
    }

    // 4. Exclude windows flagged as offscreen
    if !info.is_onscreen {
        return false;
    }

    // 5. Exclude windows smaller than minimum usable interactive size (50x50)
    if info.width < 50.0 || info.height < 50.0 {
        return false;
    }

    // 6. Exclude known macOS system processes, overlays, and menubar items
    if let Some(ref app) = info.app_name {
        let app_lower = app.trim().to_lowercase();
        if app_lower.is_empty() {
            return false;
        }

        let excluded_apps = [
            "window server",
            "dock",
            "systemuiserver",
            "control center",
            "controlcenter",
            "notification center",
            "notificationcenter",
            "spotlight",
            "wallpaper",
            "screencapture",
            "textinputmenuagent",
            "sidekick",
            "loginwindow",
        ];
        if excluded_apps.iter().any(|&e| app_lower == e) {
            return false;
        }
    } else {
        // Interactive application windows must have an application owner name
        return false;
    }

    true
}

/// Identifies the frontmost valid active application window from an ordered list of windows.
pub fn find_frontmost_active_window(windows: &[WindowInfo], own_pid: i64) -> Option<&WindowInfo> {
    windows.iter().find(|w| is_valid_active_window(w, own_pid))
}

/// Longest edge, in px, of a captured window image sent to the answer provider
pub const MAX_CAPTURE_EDGE: u32 = 1280;

/// Size that fits `w` x `h` within a `max` longest edge, keeping the aspect ratio. Never upscales.
pub fn fit_within(w: u32, h: u32, max: u32) -> (u32, u32) {
    if w.max(h) <= max {
        return (w, h);
    }
    let scale = max as f64 / w.max(h) as f64;
    (
        ((w as f64 * scale).round() as u32).max(1),
        ((h as f64 * scale).round() as u32).max(1),
    )
}

#[cfg(target_os = "macos")]
pub mod macos_capture {
    use super::*;
    #[allow(deprecated)]
    use cocoa::base::{id, nil};
    use core_foundation::base::TCFType;
    use core_foundation::dictionary::CFDictionary;
    use core_foundation::number::CFNumber;
    use core_foundation::string::CFString;
    use core_foundation_sys::array::CFArrayGetValueAtIndex;
    use core_foundation_sys::dictionary::{CFDictionaryGetValueIfPresent, CFDictionaryRef};
    use core_foundation_sys::number::kCFBooleanTrue;
    use core_graphics::access::ScreenCaptureAccess;
    use core_graphics::base::kCGImageAlphaPremultipliedLast;
    use core_graphics::color_space::CGColorSpace;
    use core_graphics::context::{CGContext, CGInterpolationQuality};
    use core_graphics::geometry::{CGPoint, CGRect, CGSize};
    pub use core_graphics::image::CGImage;
    use core_graphics::window::*;
    use foreign_types::ForeignType;
    use objc::rc::autoreleasepool;
    use objc::{class, msg_send, sel, sel_impl};
    use std::ffi::c_void;
    use std::ptr;

    // AppKit's JPEG compression-factor key (AppKit is already loaded for NSBitmapImageRep)
    #[allow(deprecated)]
    extern "C" {
        static NSImageCompressionFactor: id;
    }

    unsafe fn get_i64(
        dict: CFDictionaryRef,
        key: core_foundation::string::CFStringRef,
    ) -> Option<i64> {
        let mut val: *const c_void = ptr::null();
        if CFDictionaryGetValueIfPresent(dict, key as *const _, &mut val) != 0 && !val.is_null() {
            let num = CFNumber::wrap_under_get_rule(val as _);
            num.to_i64()
        } else {
            None
        }
    }

    unsafe fn get_f64(
        dict: CFDictionaryRef,
        key: core_foundation::string::CFStringRef,
    ) -> Option<f64> {
        let mut val: *const c_void = ptr::null();
        if CFDictionaryGetValueIfPresent(dict, key as *const _, &mut val) != 0 && !val.is_null() {
            let num = CFNumber::wrap_under_get_rule(val as _);
            num.to_f64()
        } else {
            None
        }
    }

    unsafe fn get_string(
        dict: CFDictionaryRef,
        key: core_foundation::string::CFStringRef,
    ) -> Option<String> {
        let mut val: *const c_void = ptr::null();
        if CFDictionaryGetValueIfPresent(dict, key as *const _, &mut val) != 0 && !val.is_null() {
            let s = CFString::wrap_under_get_rule(val as _);
            let rust_s = s.to_string().trim().to_string();
            if rust_s.is_empty() {
                None
            } else {
                Some(rust_s)
            }
        } else {
            None
        }
    }

    unsafe fn get_bool(
        dict: CFDictionaryRef,
        key: core_foundation::string::CFStringRef,
    ) -> Option<bool> {
        let mut val: *const c_void = ptr::null();
        if CFDictionaryGetValueIfPresent(dict, key as *const _, &mut val) != 0 && !val.is_null() {
            Some(val == (kCFBooleanTrue as *const c_void))
        } else {
            None
        }
    }

    unsafe fn get_rect(
        dict: CFDictionaryRef,
        key: core_foundation::string::CFStringRef,
    ) -> Option<CGRect> {
        let mut val: *const c_void = ptr::null();
        if CFDictionaryGetValueIfPresent(dict, key as *const _, &mut val) != 0 && !val.is_null() {
            let bounds_dict = CFDictionary::wrap_under_get_rule(val as _);
            CGRect::from_dict_representation(&bounds_dict)
        } else {
            None
        }
    }

    /// Queries the macOS Quartz Compositor window list in front-to-back Z-order.
    pub fn query_window_list() -> Result<Vec<WindowInfo>, String> {
        let cf_array = copy_window_info(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID,
        )
        .ok_or_else(|| {
            if !ScreenCaptureAccess::default().preflight() {
                "Screen Recording permission not granted. Please enable Screen Recording for Sidekick in macOS System Settings > Privacy & Security > Screen Recording.".to_string()
            } else {
                "Failed to query macOS window list via CGWindowListCopyWindowInfo".to_string()
            }
        })?;

        let count = cf_array.len();
        let mut list = Vec::with_capacity(count as usize);

        for i in 0..count {
            unsafe {
                let dict_ptr = CFArrayGetValueAtIndex(cf_array.as_concrete_TypeRef(), i);
                if dict_ptr.is_null() {
                    continue;
                }
                let dict = dict_ptr as CFDictionaryRef;

                let window_id = match get_i64(dict, kCGWindowNumber) {
                    Some(id) if id > 0 => id as u32,
                    _ => continue,
                };

                let pid = match get_i64(dict, kCGWindowOwnerPID) {
                    Some(p) => p,
                    None => continue,
                };

                let layer = get_i64(dict, kCGWindowLayer).unwrap_or(0) as i32;
                let alpha = get_f64(dict, kCGWindowAlpha).unwrap_or(1.0);
                let app_name = get_string(dict, kCGWindowOwnerName);
                let window_title = get_string(dict, kCGWindowName);
                let is_onscreen = get_bool(dict, kCGWindowIsOnscreen).unwrap_or(true);
                let rect = get_rect(dict, kCGWindowBounds).unwrap_or_else(|| {
                    CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(0.0, 0.0))
                });

                list.push(WindowInfo {
                    window_id,
                    pid,
                    layer,
                    app_name,
                    window_title,
                    x: rect.origin.x,
                    y: rect.origin.y,
                    width: rect.size.width,
                    height: rect.size.height,
                    alpha,
                    is_onscreen,
                });
            }
        }

        Ok(list)
    }

    /// Captures the visual bounds of a window by its CGWindowID silently via CGWindowListCreateImage.
    pub fn capture_cg_image(window_id: u32) -> Result<CGImage, String> {
        let screen_bounds = CGRect::new(
            &CGPoint::new(f64::INFINITY, f64::INFINITY),
            &CGSize::new(0.0, 0.0),
        );

        let image = create_image(
            screen_bounds,
            kCGWindowListOptionIncludingWindow,
            window_id,
            kCGWindowImageBoundsIgnoreFraming | kCGWindowImageBestResolution,
        );

        match image {
            Some(img) if img.width() > 0 && img.height() > 0 => Ok(img),
            _ => {
                if !ScreenCaptureAccess::default().preflight() {
                    Err("Screen Recording permission not granted. Please enable Screen Recording for Sidekick in macOS System Settings > Privacy & Security > Screen Recording.".to_string())
                } else {
                    Err(format!(
                        "Failed to capture window image for window {window_id}: capture yielded empty data or target window is minimized/hidden"
                    ))
                }
            }
        }
    }

    /// Redraws a CGImage so its longest edge is at most `max_edge` px (high-quality resampling).
    pub fn downscale_cg_image(image: &CGImage, max_edge: u32) -> Result<CGImage, String> {
        let (w, h) = fit_within(image.width() as u32, image.height() as u32, max_edge);
        let cs = CGColorSpace::create_device_rgb();
        let ctx = CGContext::create_bitmap_context(
            None,
            w as usize,
            h as usize,
            8,
            0,
            &cs,
            kCGImageAlphaPremultipliedLast,
        );
        let rect = CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(w as f64, h as f64));
        // JPEG has no alpha: paint white first so transparent window corners don't turn black
        ctx.set_rgb_fill_color(1.0, 1.0, 1.0, 1.0);
        ctx.fill_rect(rect);
        ctx.set_interpolation_quality(CGInterpolationQuality::CGInterpolationQualityHigh);
        ctx.draw_image(rect, image);
        ctx.create_image()
            .ok_or_else(|| "Failed to downscale captured window image".to_string())
    }

    /// Converts a CGImage to a JPEG in memory and formats as a base64 data URL (`data:image/jpeg;base64,...`).
    #[allow(deprecated, unexpected_cfgs)]
    pub fn encode_cg_image_to_jpeg_base64(image: &CGImage) -> Result<String, String> {
        autoreleasepool(|| unsafe {
            let rep_alloc: id = msg_send![class!(NSBitmapImageRep), alloc];
            if rep_alloc == nil {
                return Err("Failed to allocate NSBitmapImageRep".to_string());
            }

            let rep: id = msg_send![rep_alloc, initWithCGImage: image.as_ptr()];
            if rep == nil {
                return Err("Failed to initialize NSBitmapImageRep with CGImage".to_string());
            }

            // NSBitmapImageFileTypeJPEG = 3, compression factor 0.8
            let factor: id = msg_send![class!(NSNumber), numberWithDouble: 0.8f64];
            let props: id = msg_send![class!(NSDictionary), dictionaryWithObject: factor forKey: NSImageCompressionFactor];
            let data: id = msg_send![rep, representationUsingType: 3usize properties: props];

            if data == nil {
                let () = msg_send![rep, release];
                return Err("Failed to generate JPEG representation from image data".to_string());
            }

            let len: usize = msg_send![data, length];
            let bytes_ptr: *const u8 = msg_send![data, bytes];
            if len == 0 || bytes_ptr.is_null() {
                let () = msg_send![rep, release];
                return Err("Captured window JPEG buffer is empty".to_string());
            }

            let slice = std::slice::from_raw_parts(bytes_ptr, len);
            use base64::engine::general_purpose::STANDARD;
            use base64::Engine;
            let b64 = STANDARD.encode(slice);
            let () = msg_send![rep, release];

            Ok(format!("data:image/jpeg;base64,{}", b64))
        })
    }
}

/// Queries the macOS window hierarchy, detects the frontmost active application window,
/// captures its visual bounds silently, downscales it to `MAX_CAPTURE_EDGE`, and converts it to a
/// base64 JPEG data URL.
pub fn capture_frontmost_window() -> Result<WindowCaptureResponse, String> {
    #[cfg(target_os = "macos")]
    {
        let own_pid = std::process::id() as i64;
        let windows = macos_capture::query_window_list()?;
        let target = find_frontmost_active_window(&windows, own_pid).ok_or_else(|| {
            "No active application window found to capture (excluding Sidekick and system overlays)"
                .to_string()
        })?;

        let img = macos_capture::capture_cg_image(target.window_id)?;
        let small = macos_capture::downscale_cg_image(&img, MAX_CAPTURE_EDGE)?;
        let width = small.width() as u32;
        let height = small.height() as u32;
        let base64_image = macos_capture::encode_cg_image_to_jpeg_base64(&small)?;

        Ok(WindowCaptureResponse {
            base64_image,
            window_title: target.window_title.clone(),
            app_name: target.app_name.clone(),
            width,
            height,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Active window capture is only supported on macOS".to_string())
    }
}

/// Tauri IPC command: silently captures the active window and emits `sidekick://active_window_captured`.
#[tauri::command]
pub fn capture_active_window(
    app: tauri::AppHandle,
) -> Result<WindowCaptureResponse, String> {
    use tauri::Emitter;
    let capture = capture_frontmost_window()?;
    let _ = app.emit(crate::hotkeys::EVENT_ACTIVE_WINDOW_CAPTURED, &capture);
    Ok(capture)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_window(
        window_id: u32,
        pid: i64,
        layer: i32,
        app_name: Option<&str>,
        title: Option<&str>,
        width: f64,
        height: f64,
        alpha: f64,
        is_onscreen: bool,
    ) -> WindowInfo {
        WindowInfo {
            window_id,
            pid,
            layer,
            app_name: app_name.map(|s| s.to_string()),
            window_title: title.map(|s| s.to_string()),
            x: 0.0,
            y: 0.0,
            width,
            height,
            alpha,
            is_onscreen,
        }
    }

    #[test]
    fn test_filter_excludes_own_pid() {
        let own_pid = 12345;
        let sidekick_win = mock_window(
            1,
            own_pid,
            0,
            Some("Sidekick"),
            Some("Sidekick HUD"),
            800.0,
            600.0,
            1.0,
            true,
        );
        assert!(!is_valid_active_window(&sidekick_win, own_pid));
    }

    #[test]
    fn test_filter_excludes_non_zero_layers() {
        let own_pid = 12345;
        // Dock at layer 20
        let dock_win = mock_window(
            2,
            500,
            20,
            Some("Dock"),
            None,
            1440.0,
            80.0,
            1.0,
            true,
        );
        assert!(!is_valid_active_window(&dock_win, own_pid));

        // Menubar at layer 24
        let menu_win = mock_window(
            3,
            501,
            24,
            Some("Window Server"),
            Some("Menubar"),
            1440.0,
            25.0,
            1.0,
            true,
        );
        assert!(!is_valid_active_window(&menu_win, own_pid));

        // Desktop at negative layer
        let desktop_win = mock_window(
            4,
            502,
            -1000,
            Some("Finder"),
            None,
            1440.0,
            900.0,
            1.0,
            true,
        );
        assert!(!is_valid_active_window(&desktop_win, own_pid));
    }

    #[test]
    fn test_filter_excludes_invisible_or_tiny_windows() {
        let own_pid = 12345;
        // Invisible window (alpha < 0.05)
        let alpha_win = mock_window(
            5,
            600,
            0,
            Some("Google Chrome"),
            Some("Helper"),
            500.0,
            500.0,
            0.0,
            true,
        );
        assert!(!is_valid_active_window(&alpha_win, own_pid));

        // Offscreen window
        let offscreen_win = mock_window(
            6,
            600,
            0,
            Some("Google Chrome"),
            Some("Tab"),
            500.0,
            500.0,
            1.0,
            false,
        );
        assert!(!is_valid_active_window(&offscreen_win, own_pid));

        // Tiny tracking rect (width < 50)
        let tiny_win = mock_window(
            7,
            600,
            0,
            Some("Google Chrome"),
            Some("Tracker"),
            10.0,
            500.0,
            1.0,
            true,
        );
        assert!(!is_valid_active_window(&tiny_win, own_pid));
    }

    #[test]
    fn test_filter_excludes_system_processes() {
        let own_pid = 12345;
        for sys_app in &[
            "Window Server",
            "Dock",
            "SystemUIServer",
            "Control Center",
            "Notification Center",
            "Spotlight",
            "Wallpaper",
            "screencapture",
        ] {
            let win = mock_window(
                8,
                700,
                0,
                Some(sys_app),
                Some("Overlay"),
                800.0,
                600.0,
                1.0,
                true,
            );
            assert!(
                !is_valid_active_window(&win, own_pid),
                "Should reject system process '{sys_app}'"
            );
        }
    }

    #[test]
    fn test_filter_accepts_valid_applications() {
        let own_pid = 12345;
        let chrome_win = mock_window(
            10,
            2000,
            0,
            Some("Google Chrome"),
            Some("Two Sum - LeetCode"),
            1440.0,
            900.0,
            1.0,
            true,
        );
        assert!(is_valid_active_window(&chrome_win, own_pid));

        let vscode_win = mock_window(
            11,
            2001,
            0,
            Some("Code"),
            Some("solution.py - Sidekick"),
            1200.0,
            800.0,
            1.0,
            true,
        );
        assert!(is_valid_active_window(&vscode_win, own_pid));

        // Window without title is still acceptable if app is valid
        let nameless_win = mock_window(
            12,
            2002,
            0,
            Some("Terminal"),
            None,
            800.0,
            600.0,
            1.0,
            true,
        );
        assert!(is_valid_active_window(&nameless_win, own_pid));
    }

    #[test]
    fn test_find_frontmost_active_window_selects_first_valid() {
        let own_pid = 12345;
        let windows = vec![
            // Topmost window is Sidekick overlay
            mock_window(
                1,
                own_pid,
                0,
                Some("Sidekick"),
                Some("HUD"),
                800.0,
                600.0,
                1.0,
                true,
            ),
            // Dock overlay
            mock_window(
                2,
                500,
                20,
                Some("Dock"),
                None,
                1440.0,
                80.0,
                1.0,
                true,
            ),
            // Candidate: Chrome browser with LeetCode
            mock_window(
                3,
                2000,
                0,
                Some("Google Chrome"),
                Some("Two Sum - LeetCode"),
                1440.0,
                900.0,
                1.0,
                true,
            ),
            // Background app: VS Code
            mock_window(
                4,
                2001,
                0,
                Some("Code"),
                Some("app.rs"),
                1200.0,
                800.0,
                1.0,
                true,
            ),
        ];

        let target = find_frontmost_active_window(&windows, own_pid);
        assert!(target.is_some());
        let target = target.unwrap();
        assert_eq!(target.window_id, 3);
        assert_eq!(target.app_name.as_deref(), Some("Google Chrome"));
        assert_eq!(target.window_title.as_deref(), Some("Two Sum - LeetCode"));
    }

    #[test]
    fn test_find_frontmost_active_window_returns_none_when_no_valid_apps() {
        let own_pid = 12345;
        let windows = vec![
            mock_window(
                1,
                own_pid,
                0,
                Some("Sidekick"),
                None,
                800.0,
                600.0,
                1.0,
                true,
            ),
            mock_window(
                2,
                500,
                20,
                Some("Dock"),
                None,
                1440.0,
                80.0,
                1.0,
                true,
            ),
        ];
        assert!(find_frontmost_active_window(&windows, own_pid).is_none());
    }

    #[test]
    fn test_window_capture_response_serialization() {
        let response = WindowCaptureResponse {
            base64_image: "data:image/jpeg;base64,/9j/4AAQSkZJRg==".to_string(),
            window_title: Some("Two Sum - LeetCode".to_string()),
            app_name: Some("Google Chrome".to_string()),
            width: 1440,
            height: 900,
        };

        let json = serde_json::to_string(&response).expect("serialization failed");
        assert!(json.contains("data:image/jpeg;base64,"));
        assert!(json.contains("Two Sum - LeetCode"));
        assert!(json.contains("Google Chrome"));

        let deserialized: WindowCaptureResponse =
            serde_json::from_str(&json).expect("deserialization failed");
        assert_eq!(deserialized, response);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_encode_cg_image_produces_valid_jpeg() {
        use core_graphics::color_space::CGColorSpace;
        use core_graphics::context::CGContext;
        use core_graphics::geometry::{CGPoint, CGRect, CGSize};

        let cs = CGColorSpace::create_device_rgb();
        let ctx = CGContext::create_bitmap_context(
            None,
            16,
            16,
            8,
            0,
            &cs,
            core_graphics::base::kCGImageAlphaPremultipliedLast,
        );
        ctx.set_rgb_fill_color(0.2, 0.4, 0.8, 1.0);
        ctx.fill_rect(CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(16.0, 16.0)));

        let img = ctx.create_image().expect("failed to make image from context");
        assert_eq!(img.width(), 16);
        assert_eq!(img.height(), 16);

        let data_url = macos_capture::encode_cg_image_to_jpeg_base64(&img)
            .expect("encoding to jpeg base64 failed");
        assert!(
            data_url.starts_with("data:image/jpeg;base64,"),
            "Must start with data URL scheme"
        );

        let b64_part = data_url.trim_start_matches("data:image/jpeg;base64,");
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine;
        let jpeg_bytes = STANDARD.decode(b64_part).expect("valid base64");
        // JPEG start-of-image marker: FF D8
        assert_eq!(
            &jpeg_bytes[0..2],
            &[0xFF, 0xD8],
            "Decoded bytes must start with the JPEG SOI marker"
        );
    }

    #[test]
    fn test_fit_within_caps_longest_edge() {
        // Landscape and portrait keep their aspect ratio
        assert_eq!(fit_within(2560, 1600, 1280), (1280, 800));
        assert_eq!(fit_within(1600, 2560, 1280), (800, 1280));
        // Exactly the limit, or already smaller: unchanged
        assert_eq!(fit_within(1280, 1280, 1280), (1280, 1280));
        assert_eq!(fit_within(1280, 720, 1280), (1280, 720));
        assert_eq!(fit_within(800, 600, 1280), (800, 600));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn test_downscale_cg_image_to_max_edge() {
        use core_graphics::color_space::CGColorSpace;
        use core_graphics::context::CGContext;
        use core_graphics::geometry::{CGPoint, CGRect, CGSize};

        let cs = CGColorSpace::create_device_rgb();
        let ctx = CGContext::create_bitmap_context(
            None,
            2560,
            1600,
            8,
            0,
            &cs,
            core_graphics::base::kCGImageAlphaPremultipliedLast,
        );
        ctx.set_rgb_fill_color(0.2, 0.4, 0.8, 1.0);
        ctx.fill_rect(CGRect::new(&CGPoint::new(0.0, 0.0), &CGSize::new(2560.0, 1600.0)));
        let img = ctx.create_image().expect("failed to make image from context");

        let small = macos_capture::downscale_cg_image(&img, MAX_CAPTURE_EDGE)
            .expect("downscaling failed");
        assert_eq!((small.width(), small.height()), (1280, 800));
    }
}
