//! Active Window Vision Capture Subsystem
//!
//! Provides silent capture of the frontmost application window (REQ-013, AC-003).

pub mod window_grab;

pub use window_grab::{
    capture_active_window, capture_frontmost_window, find_frontmost_active_window,
    is_valid_active_window, WindowCaptureResponse, WindowInfo,
};
