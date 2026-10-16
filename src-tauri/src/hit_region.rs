//! Click-through everywhere except the UI.
//!
//! The overlay is one fixed transparent window that never resizes (resizing a WKWebView blinks
//! the page). The frontend reports where its visible pieces are; a poller lets the window take
//! the mouse only while the cursor is over one of them, and passes clicks through elsewhere.

use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, Runtime};

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

/// Where the pointer is, in window points: over the UI, outside it (or forced click-through), or hidden.
#[derive(Clone, Copy, Debug)]
pub enum Pointer {
    Hidden,
    Outside,
    Over(f64, f64),
}

/// What the page was last told by `sidekick://pointer`.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PointerReport {
    pub inside: bool,
    pub x: f64,
    pub y: f64,
}

/// Moves smaller than this, in points, are jitter and not reported while over the UI.
const MOVE_EPSILON: f64 = 0.5;

/// What to tell the page after this poll, if anything. Over the UI it hears the entry and each
/// real move. Leaving or hiding it hears once, at the last spot, so it drops its hover marks.
pub fn pointer_report(last: PointerReport, now: Pointer) -> Option<PointerReport> {
    match now {
        Pointer::Over(x, y) => {
            let moved = (x - last.x).hypot(y - last.y) >= MOVE_EPSILON;
            (!last.inside || moved).then_some(PointerReport { inside: true, x, y })
        }
        Pointer::Outside | Pointer::Hidden => {
            last.inside.then_some(PointerReport { inside: false, ..last })
        }
    }
}

/// Polls the cursor and flips the window's mouse handling only when it changes; reports the pointer to the page.
pub fn spawn_poller<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
        let mut ignoring: Option<bool> = None;
        let mut reported = PointerReport::default();
        loop {
            std::thread::sleep(POLL_INTERVAL);
            let Some(window) = app.get_webview_window("main") else { continue };
            let visible = window.is_visible().unwrap_or(false);
            let forced = app
                .state::<HotkeyState>()
                .is_click_through
                .load(Ordering::SeqCst);
            let window_point = || -> Option<(f64, f64)> {
                let cursor = window.cursor_position().ok()?;
                let origin = window.outer_position().ok()?;
                let scale = window.scale_factor().ok()?;
                Some(((cursor.x - origin.x as f64) / scale, (cursor.y - origin.y as f64) / scale))
            };
            let over_ui = |x: f64, y: f64| {
                let rects = app.state::<HitRegions>();
                let rects = rects.0.lock().unwrap_or_else(|e| e.into_inner());
                contains(&rects, x, y)
            };
            let pointer = if !visible {
                Pointer::Hidden
            } else {
                match window_point() {
                    Some((x, y)) if !forced && over_ui(x, y) => Pointer::Over(x, y),
                    _ => Pointer::Outside,
                }
            };
            if visible {
                let ignore = !matches!(pointer, Pointer::Over(..));
                if ignoring != Some(ignore) && window.set_ignore_cursor_events(ignore).is_ok() {
                    ignoring = Some(ignore);
                }
            }
            if let Some(report) = pointer_report(reported, pointer) {
                reported = report;
                let _ = app.emit(
                    "sidekick://pointer",
                    serde_json::json!({ "inside": report.inside, "x": report.x, "y": report.y }),
                );
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{contains, pointer_report, Pointer, PointerReport};

    #[test]
    fn pointer_report_follows_entry_moves_and_exit() {
        let entered = pointer_report(PointerReport::default(), Pointer::Over(10.0, 20.0)).unwrap();
        assert_eq!(entered, PointerReport { inside: true, x: 10.0, y: 20.0 });

        // Jitter under half a point is ignored; a half-point move is reported
        assert_eq!(pointer_report(entered, Pointer::Over(10.3, 20.3)), None);
        let moved = pointer_report(entered, Pointer::Over(10.5, 20.0)).unwrap();
        assert_eq!(moved, PointerReport { inside: true, x: 10.5, y: 20.0 });

        // Leaving reports once, at the last reported spot, then stays quiet
        let left = pointer_report(moved, Pointer::Outside).unwrap();
        assert_eq!(left, PointerReport { inside: false, x: 10.5, y: 20.0 });
        assert_eq!(pointer_report(left, Pointer::Outside), None);
        assert_eq!(pointer_report(PointerReport::default(), Pointer::Outside), None);
    }

    #[test]
    fn pointer_report_clears_once_when_hidden() {
        let over = PointerReport { inside: true, x: 5.0, y: 6.0 };
        let cleared = pointer_report(over, Pointer::Hidden).unwrap();
        assert_eq!(cleared, PointerReport { inside: false, x: 5.0, y: 6.0 });
        assert_eq!(pointer_report(cleared, Pointer::Hidden), None);
        // Showing again with the pointer over the UI reports the entry afresh
        assert!(pointer_report(cleared, Pointer::Over(5.0, 6.0)).is_some_and(|r| r.inside));
    }

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
