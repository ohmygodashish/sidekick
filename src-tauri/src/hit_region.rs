//! Click-through everywhere except the UI.
//!
//! The overlay is one fixed transparent window that never resizes (resizing a WKWebView blinks
//! the page). The frontend reports where its visible pieces are; a poller lets the window take
//! the mouse only while the cursor is over one of them, and passes clicks through elsewhere.

use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Manager, Runtime};

use crate::hotkeys::HotkeyState;

/// `[x, y, width, height]` in window points, origin top-left (CSS pixels of the web view).
pub type Rect = [f64; 4];

#[derive(Default)]
pub struct HitRegions(Mutex<Vec<Rect>>);

const POLL_INTERVAL: Duration = Duration::from_millis(16);

pub fn contains(rects: &[Rect], x: f64, y: f64) -> bool {
    rects
        .iter()
        .any(|[rx, ry, w, h]| x >= *rx && x < rx + w && y >= *ry && y < ry + h)
}

#[tauri::command]
pub fn set_hit_regions(state: tauri::State<'_, HitRegions>, rects: Vec<Rect>) {
    *state.0.lock().unwrap_or_else(|e| e.into_inner()) = rects;
}

/// Polls the cursor and flips the window's mouse handling only when it changes.
pub fn spawn_poller<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut ignoring: Option<bool> = None;
        loop {
            std::thread::sleep(POLL_INTERVAL);
            let Some(window) = app.get_webview_window("main") else { continue };
            if !window.is_visible().unwrap_or(false) {
                continue;
            }
            let forced = app
                .state::<HotkeyState>()
                .is_click_through
                .load(Ordering::SeqCst);
            let over_ui = || -> Option<bool> {
                let cursor = window.cursor_position().ok()?;
                let origin = window.outer_position().ok()?;
                let scale = window.scale_factor().ok()?;
                let x = (cursor.x - origin.x as f64) / scale;
                let y = (cursor.y - origin.y as f64) / scale;
                let rects = app.state::<HitRegions>();
                let rects = rects.0.lock().unwrap_or_else(|e| e.into_inner());
                Some(contains(&rects, x, y))
            };
            let ignore = forced || !over_ui().unwrap_or(false);
            if ignoring != Some(ignore) && window.set_ignore_cursor_events(ignore).is_ok() {
                ignoring = Some(ignore);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::contains;

    #[test]
    fn hit_test_uses_half_open_rects() {
        let rects = [[10.0, 10.0, 100.0, 40.0], [50.0, 60.0, 20.0, 20.0]];
        assert!(contains(&rects, 10.0, 10.0));
        assert!(contains(&rects, 109.9, 49.9));
        assert!(!contains(&rects, 110.0, 30.0));
        assert!(!contains(&rects, 30.0, 55.0)); // the gap between the two pieces
        assert!(contains(&rects, 60.0, 70.0));
        assert!(!contains(&[], 0.0, 0.0));
    }
}
