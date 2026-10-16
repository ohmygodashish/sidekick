//! Global Shortcuts Engine & Instant Panic Killswitch
//!
//! Provides OS-level global keyboard shortcuts and Tauri IPC commands for:
//! - Panic Killswitch (`Cmd + Esc` / `Super + Escape`): Synchronously hides window, sets panic state, emits `sidekick://panic`, deletes the session DB, then quits the process.
//! - Window Visibility Toggle (`Cmd + Backslash` / `Super + Backslash`): Shows without taking focus, or hides and hands focus back.
//! - Meeting Toggle (`Cmd + Shift + Backslash`): Emits `sidekick://toggle_meeting` so the frontend starts or stops listening.
//! - Click-Through Toggle (`Cmd + Shift + C` / `Super + Shift + C`): Enables mouse pass-through to underlying apps.
//! - Layout Mode Toggle (`Cmd + Shift + M` / `Super + Shift + M`): Toggles compact view (control bar only) on and off.
//! - Visible-only shortcuts (`Cmd + Comma`, `Cmd + R`, `Cmd + Enter`, `Cmd + Arrows`, `Cmd + Shift + Up/Down`): Registered only while the window is visible, so other apps keep these keys while Sidekick is hidden. Open Settings, new chat, Assist, move the window, scroll the answer.
//! - Opacity Configuration: Controls window alpha level.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
pub use tauri_plugin_global_shortcut::{
    Code, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

/// Default shortcut string representations
pub const SHORTCUT_PANIC: &str = "Super+Escape";
pub const SHORTCUT_TOGGLE_VISIBILITY: &str = "Super+Backslash";
pub const SHORTCUT_TOGGLE_MEETING: &str = "Super+Shift+Backslash";
pub const SHORTCUT_TOGGLE_CLICK_THROUGH: &str = "Super+Shift+C";
pub const SHORTCUT_TOGGLE_LAYOUT_MODE: &str = "Super+Shift+M";
/// Cmd+Option+1/2/3 pick a live option; browsers own Cmd+1-9 and Cmd+Shift+3 is a screenshot
pub const SHORTCUT_PICK_OPTIONS: [&str; 3] = ["Super+Alt+Digit1", "Super+Alt+Digit2", "Super+Alt+Digit3"];
/// Only registered while the window is visible (see `set_visible_shortcuts`)
pub const SHORTCUT_OPEN_SETTINGS: &str = "Super+Comma";
pub const SHORTCUT_NEW_CHAT: &str = "Super+KeyR";
pub const SHORTCUT_MOVE_UP: &str = "Super+ArrowUp";
pub const SHORTCUT_MOVE_DOWN: &str = "Super+ArrowDown";
pub const SHORTCUT_MOVE_LEFT: &str = "Super+ArrowLeft";
pub const SHORTCUT_MOVE_RIGHT: &str = "Super+ArrowRight";
pub const SHORTCUT_SCROLL_UP: &str = "Super+Shift+ArrowUp";
pub const SHORTCUT_SCROLL_DOWN: &str = "Super+Shift+ArrowDown";
pub const SHORTCUT_ASSIST: &str = "Super+Enter";
pub const VISIBLE_ONLY_SHORTCUTS: [&str; 9] = [
    SHORTCUT_OPEN_SETTINGS,
    SHORTCUT_NEW_CHAT,
    SHORTCUT_MOVE_UP,
    SHORTCUT_MOVE_DOWN,
    SHORTCUT_MOVE_LEFT,
    SHORTCUT_MOVE_RIGHT,
    SHORTCUT_SCROLL_UP,
    SHORTCUT_SCROLL_DOWN,
    SHORTCUT_ASSIST,
];

/// Event names emitted to frontend
pub const EVENT_PANIC: &str = "sidekick://panic";
pub const EVENT_VISIBILITY_TOGGLED: &str = "sidekick://visibility_toggled";
pub const EVENT_CLICK_THROUGH_TOGGLED: &str = "sidekick://click_through_toggled";
pub const EVENT_TOGGLE_LAYOUT_MODE: &str = "sidekick://toggle_layout_mode";
pub const EVENT_OPACITY_CHANGED: &str = "sidekick://opacity_changed";
pub const EVENT_ACTIVE_WINDOW_CAPTURED: &str = "sidekick://active_window_captured";
pub const EVENT_PICK_OPTION: &str = "sidekick://pick_option";
pub const EVENT_TOGGLE_MEETING: &str = "sidekick://toggle_meeting";
pub const EVENT_OPEN_SETTINGS: &str = "sidekick://open_settings";
pub const EVENT_NEW_CHAT: &str = "sidekick://new_chat";
pub const EVENT_SCROLL_ANSWER: &str = "sidekick://scroll_answer";
pub const EVENT_ASSIST: &str = "sidekick://assist";

/// Layout display modes supported by Sidekick
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LayoutMode {
    /// Freely draggable, resizable window with opacity control
    FloatingHud,
    /// Compact view: the frontend shows only the control bar (name kept for config compatibility)
    DynamicNotch,
}

impl LayoutMode {
    /// Toggles compact view on and off
    pub fn toggle(&self) -> Self {
        match self {
            Self::FloatingHud => Self::DynamicNotch,
            Self::DynamicNotch => Self::FloatingHud,
        }
    }

    /// Returns canonical string representation
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::FloatingHud => "floating-hud",
            Self::DynamicNotch => "dynamic-notch",
        }
    }
}

impl FromStr for LayoutMode {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let normalized = s.trim().to_lowercase().replace(['_', ' '], "-");
        match normalized.as_str() {
            "floating-hud" | "floating" | "hud" => Ok(Self::FloatingHud),
            "dynamic-notch" | "notch" => Ok(Self::DynamicNotch),
            _ => Err(format!(
                "Invalid layout mode: '{s}'. Expected 'floating-hud' or 'dynamic-notch'"
            )),
        }
    }
}

impl std::fmt::Display for LayoutMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Discrete high-level actions triggered by global shortcuts
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SidekickAction {
    /// Synchronously hide all UI, abort network streams, flush audio buffers, delete the session DB, then quit
    Panic,
    /// Toggle window visibility (show without focus if hidden, hide and release focus if visible)
    ToggleVisibility,
    /// Start or stop listening (the frontend handles `sidekick://toggle_meeting`)
    ToggleMeeting,
    /// Toggle mouse cursor transparency / event passthrough
    ToggleClickThrough,
    /// Toggle layout mode between Floating HUD and Dynamic Notch
    ToggleLayoutMode,
    /// Index 0-2 of the live option to answer
    PickOption(u8),
    /// Open or close the Settings drawer (visible only)
    OpenSettings,
    /// Clear the answer (visible only)
    NewChat,
    /// Move the window one step; each component is -1, 0 or 1 (visible only)
    MoveWindow(i32, i32),
    /// Scroll the answer, up when true (visible only)
    ScrollAnswer(bool),
    /// Assist: answer from the screen and transcript, or send the typed question (visible only)
    Assist,
}

/// Resolves a parsed `Shortcut` into the matching `SidekickAction`
pub fn resolve_action(shortcut: &Shortcut) -> Option<SidekickAction> {
    if shortcut.matches(Modifiers::SUPER, Code::Escape) {
        Some(SidekickAction::Panic)
    } else if shortcut.matches(Modifiers::SUPER, Code::Backslash) {
        Some(SidekickAction::ToggleVisibility)
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Backslash) {
        Some(SidekickAction::ToggleMeeting)
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyC) {
        Some(SidekickAction::ToggleClickThrough)
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyM) {
        Some(SidekickAction::ToggleLayoutMode)
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::ALT, Code::Digit1) {
        Some(SidekickAction::PickOption(0))
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::ALT, Code::Digit2) {
        Some(SidekickAction::PickOption(1))
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::ALT, Code::Digit3) {
        Some(SidekickAction::PickOption(2))
    } else if shortcut.matches(Modifiers::SUPER, Code::Comma) {
        Some(SidekickAction::OpenSettings)
    } else if shortcut.matches(Modifiers::SUPER, Code::KeyR) {
        Some(SidekickAction::NewChat)
    } else if shortcut.matches(Modifiers::SUPER, Code::ArrowUp) {
        Some(SidekickAction::MoveWindow(0, -1))
    } else if shortcut.matches(Modifiers::SUPER, Code::ArrowDown) {
        Some(SidekickAction::MoveWindow(0, 1))
    } else if shortcut.matches(Modifiers::SUPER, Code::ArrowLeft) {
        Some(SidekickAction::MoveWindow(-1, 0))
    } else if shortcut.matches(Modifiers::SUPER, Code::ArrowRight) {
        Some(SidekickAction::MoveWindow(1, 0))
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::ArrowUp) {
        Some(SidekickAction::ScrollAnswer(true))
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::ArrowDown) {
        Some(SidekickAction::ScrollAnswer(false))
    } else if shortcut.matches(Modifiers::SUPER, Code::Enter) {
        Some(SidekickAction::Assist)
    } else {
        None
    }
}

/// Thread-safe in-memory state tracking for hotkeys and overlay status
#[derive(Debug)]
pub struct HotkeyState {
    /// Flag indicating whether panic mode was engaged
    pub is_panicked: AtomicBool,
    /// Flag indicating whether mouse clicks pass through the window
    pub is_click_through: AtomicBool,
    /// Current overlay layout mode
    pub layout_mode: RwLock<LayoutMode>,
    /// Current window alpha opacity (0.0 - 1.0)
    pub opacity: RwLock<f64>,
}

impl Default for HotkeyState {
    fn default() -> Self {
        Self {
            is_panicked: AtomicBool::new(false),
            is_click_through: AtomicBool::new(false),
            layout_mode: RwLock::new(LayoutMode::FloatingHud),
            opacity: RwLock::new(1.0),
        }
    }
}

/// Read-only snapshot of current hotkey engine state
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HotkeyStateSnapshot {
    pub is_panicked: bool,
    pub is_click_through: bool,
    pub layout_mode: LayoutMode,
    pub opacity: f64,
}

impl HotkeyState {
    /// Takes an atomic snapshot of current state
    pub fn snapshot(&self) -> HotkeyStateSnapshot {
        HotkeyStateSnapshot {
            is_panicked: self.is_panicked.load(Ordering::SeqCst),
            is_click_through: self.is_click_through.load(Ordering::SeqCst),
            layout_mode: *self.layout_mode.read().unwrap_or_else(|e| e.into_inner()),
            opacity: *self.opacity.read().unwrap_or_else(|e| e.into_inner()),
        }
    }
}

/// Dispatches shortcut events from the global shortcut plugin
pub fn handle_shortcut<R: Runtime>(app: &AppHandle<R>, shortcut: &Shortcut) {
    let state = app.state::<HotkeyState>();
    if let Some(action) = resolve_action(shortcut) {
        match action {
            SidekickAction::Panic => panic_and_quit(app, &state),
            SidekickAction::ToggleVisibility => {
                if let Err(e) = toggle_window_visibility(app, &state) {
                    eprintln!("[Sidekick Hotkeys] Failed to toggle visibility: {e}");
                }
            }
            SidekickAction::ToggleMeeting => {
                let _ = app.emit(EVENT_TOGGLE_MEETING, serde_json::json!({}));
            }
            SidekickAction::ToggleClickThrough => {
                if let Err(e) = toggle_click_through(app, &state) {
                    eprintln!("[Sidekick Hotkeys] Failed to toggle click-through: {e}");
                }
            }
            SidekickAction::ToggleLayoutMode => {
                if let Err(e) = toggle_layout_mode(app, &state) {
                    eprintln!("[Sidekick Hotkeys] Failed to toggle layout mode: {e}");
                }
            }
            SidekickAction::OpenSettings => {
                let _ = app.emit(EVENT_OPEN_SETTINGS, serde_json::json!({}));
            }
            SidekickAction::NewChat => {
                let _ = app.emit(EVENT_NEW_CHAT, serde_json::json!({}));
            }
            SidekickAction::MoveWindow(dx, dy) => {
                if let Err(e) = move_window_by(app, dx, dy) {
                    eprintln!("[Sidekick Hotkeys] Failed to move window: {e}");
                }
            }
            SidekickAction::ScrollAnswer(up) => {
                let direction = if up { "up" } else { "down" };
                let _ = app.emit(EVENT_SCROLL_ANSWER, serde_json::json!({ "direction": direction }));
            }
            SidekickAction::Assist => {
                let _ = app.emit(EVENT_ASSIST, serde_json::json!({}));
            }
            SidekickAction::PickOption(index) => {
                // The answer must be visible, so summon a hidden overlay first
                let hidden = app
                    .get_webview_window("main")
                    .map(|w| !w.is_visible().unwrap_or(true))
                    .unwrap_or(false);
                if hidden {
                    if let Err(e) = toggle_window_visibility(app, &state) {
                        eprintln!("[Sidekick Hotkeys] Failed to show window for option: {e}");
                    }
                }
                let _ = app.emit(EVENT_PICK_OPTION, serde_json::json!({ "index": index }));
            }
        }
    }
}

/// Synchronously hides the window, marks state as panicked, emits the panic event and deletes the
/// session DB files (< 25ms).
pub fn trigger_panic<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
) -> Result<(), String> {
    // 1. Immediately and synchronously hide the main window (< 1ms) and hand focus back.
    // Visible-only shortcuts aren't unregistered: the process exits right after and frees them.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
        let _ = crate::appkit::release_key_focus(&window);
    }

    // 2. Mark state as panicked
    state.is_panicked.store(true, Ordering::SeqCst);

    // 3. Halt all audio capture pipelines and purge ephemeral buffers immediately (< 5ms, REQ-004)
    if let Some(audio_state) = app.try_state::<crate::audio::AudioState>() {
        audio_state.purge();
    }

    // 3. Emit panic event to frontend to abort streaming requests and flush buffers
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let _ = app.emit(
        EVENT_PANIC,
        serde_json::json!({
            "action": "panic",
            "timestamp": timestamp,
        }),
    );

    // 4. Delete the session DB records and files (REQ-017)
    crate::storage::db::delete_session_db();

    Ok(())
}

/// Panic, then quit the process so nothing of Sidekick stays running. Never returns.
pub fn panic_and_quit<R: Runtime>(app: &AppHandle<R>, state: &HotkeyState) -> ! {
    if let Err(e) = trigger_panic(app, state) {
        eprintln!("[Sidekick Hotkeys] Failed to execute panic: {e}");
    }
    std::process::exit(0)
}

/// Hides the main window, hands keyboard focus back to the previous app, and tells the frontend.
pub fn hide_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window 'main' not found".to_string())?;
    window.hide().map_err(|e| e.to_string())?;
    set_visible_shortcuts(app, false);
    // Non-fatal: the window is already hidden, so the visibility event must still go out
    let _ = crate::appkit::release_key_focus(&window);
    let _ = app.emit(
        EVENT_VISIBILITY_TOGGLED,
        serde_json::json!({ "visible": false }),
    );
    Ok(())
}

/// Toggles window visibility. If hidden (or panicked), shows it without taking keyboard focus;
/// if visible, hides it and hands focus back.
pub fn toggle_window_visibility<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().map_err(|e| e.to_string())?;
        if is_visible {
            hide_window(app)?;
            Ok(false)
        } else {
            // Reset panic state when summoning the overlay
            state.is_panicked.store(false, Ordering::SeqCst);
            crate::appkit::show_without_activating(&window).map_err(|e| e.to_string())?;
            set_visible_shortcuts(app, true);
            let _ = app.emit(
                EVENT_VISIBILITY_TOGGLED,
                serde_json::json!({ "visible": true }),
            );
            Ok(true)
        }
    } else {
        Err("Main window 'main' not found".to_string())
    }
}

/// Registers the visible-only shortcuts when the window shows and releases them when it hides, so
/// the focused app keeps ⌘, ⌘R, ⌘←/→ and ⇧⌘↑/↓ while Sidekick is hidden.
pub fn set_visible_shortcuts<R: Runtime>(app: &AppHandle<R>, visible: bool) {
    let shortcuts = app.global_shortcut();
    for raw in VISIBLE_ONLY_SHORTCUTS {
        // Skip keys already in the requested state, so a second show or hide never fails
        if shortcuts.is_registered(raw) == visible {
            continue;
        }
        let result = if visible {
            shortcuts.register(raw)
        } else {
            shortcuts.unregister(raw)
        };
        if let Err(e) = result {
            // Another app may own the key; the other shortcuts still work
            let action = if visible { "register" } else { "unregister" };
            eprintln!("[Sidekick Hotkeys] Failed to {action} {raw}: {e}");
        }
    }
}

/// Moves the main window one step (48 pt) in a direction. `dx` and `dy` are -1, 0 or 1. The move
/// is clamped to the work area, and the top of the window (the pill) stays on screen.
pub fn move_window_by<R: Runtime>(app: &AppHandle<R>, dx: i32, dy: i32) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window 'main' not found".to_string())?;
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .ok_or("No monitor found")?;
    let scale = monitor.scale_factor();
    let step = (48.0 * scale).round() as i32;
    let min_visible = (80.0 * scale).round() as i32;
    let area = monitor.work_area();
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let width = window.outer_size().map_err(|e| e.to_string())?.width;
    let (x, y) = clamp_position(
        position.x + dx * step,
        position.y + dy * step,
        width as i32,
        (area.position.x, area.position.y, area.size.width as i32, area.size.height as i32),
        min_visible,
    );
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// Clamps a window origin to a work area `(x, y, width, height)`. The left and right edges stay
/// inside it, and the top stays inside with at least `min_visible` px above the bottom edge. A
/// window wider than the area is pinned to the area's left edge.
fn clamp_position(
    x: i32,
    y: i32,
    win_w: i32,
    area: (i32, i32, i32, i32),
    min_visible: i32,
) -> (i32, i32) {
    let (area_x, area_y, area_w, area_h) = area;
    let x = x.min(area_x + area_w - win_w).max(area_x);
    let y = y.min(area_y + area_h - min_visible).max(area_y);
    (x, y)
}

/// Sets whether mouse clicks ignore the overlay window. The `hit_region` poller applies it
/// within one tick; it owns the window's ignore-cursor flag.
pub fn set_click_through<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
    enabled: bool,
) -> Result<(), String> {
    state.is_click_through.store(enabled, Ordering::SeqCst);
    let _ = app.emit(
        EVENT_CLICK_THROUGH_TOGGLED,
        serde_json::json!({ "enabled": enabled }),
    );
    Ok(())
}

/// Toggles mouse click-through on the main window.
pub fn toggle_click_through<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
) -> Result<bool, String> {
    let current = state.is_click_through.load(Ordering::SeqCst);
    let next = !current;
    set_click_through(app, state, next)?;
    Ok(next)
}

/// Toggles the layout mode between Floating HUD and Dynamic Notch.
pub fn toggle_layout_mode<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
) -> Result<LayoutMode, String> {
    let next_mode = {
        let mut guard = state.layout_mode.write().map_err(|e| e.to_string())?;
        *guard = guard.toggle();
        *guard
    };
    let _ = app.emit(
        EVENT_TOGGLE_LAYOUT_MODE,
        serde_json::json!({
            "mode": next_mode,
            "mode_str": next_mode.as_str(),
        }),
    );
    Ok(next_mode)
}

/// Sets the layout mode from a string identifier.
pub fn set_layout_mode<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
    mode_str: &str,
) -> Result<(), String> {
    let parsed: LayoutMode = mode_str.parse()?;
    {
        let mut guard = state.layout_mode.write().map_err(|e| e.to_string())?;
        *guard = parsed;
    }
    let _ = app.emit(
        EVENT_TOGGLE_LAYOUT_MODE,
        serde_json::json!({
            "mode": parsed,
            "mode_str": parsed.as_str(),
        }),
    );
    Ok(())
}

/// Sets the window opacity (clamped between 0.0 and 1.0).
pub fn set_window_opacity<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
    alpha: f64,
) -> Result<(), String> {
    if !(0.0..=1.0).contains(&alpha) {
        return Err(format!(
            "Opacity alpha must be between 0.0 and 1.0, got {alpha}"
        ));
    }

    if let Some(window) = app.get_webview_window("main") {
        crate::appkit::set_window_opacity(&window, alpha).map_err(|e| e.to_string())?;
    }

    {
        let mut guard = state.opacity.write().map_err(|e| e.to_string())?;
        *guard = alpha;
    }

    let _ = app.emit(
        EVENT_OPACITY_CHANGED,
        serde_json::json!({ "opacity": alpha }),
    );
    Ok(())
}

pub mod commands {
    use super::*;

    /// IPC command: sets click-through mode
    #[tauri::command]
    pub fn set_click_through(
        app: AppHandle,
        state: State<'_, HotkeyState>,
        enabled: bool,
    ) -> Result<(), String> {
        super::set_click_through(&app, &state, enabled)
    }

    /// IPC command: panic shutdown (< 25ms). Wipes the session and quits the process; never returns
    #[tauri::command]
    pub fn trigger_panic(
        app: AppHandle,
        state: State<'_, HotkeyState>,
    ) -> Result<(), String> {
        super::panic_and_quit(&app, &state)
    }

    /// IPC command: hides the overlay and hands keyboard focus back to the previous app
    #[tauri::command]
    pub fn hide_window(app: AppHandle) -> Result<(), String> {
        super::hide_window(&app)
    }

    /// IPC command: hands keyboard focus back to the previous app (the frontend calls this when
    /// the user clicks away from a text field)
    #[tauri::command]
    pub fn release_focus(app: AppHandle) -> Result<(), String> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "Main window 'main' not found".to_string())?;
        crate::appkit::release_key_focus(&window).map_err(|e| e.to_string())
    }

    /// IPC command: makes Sidekick the active app so the text field just focused can take keys
    #[tauri::command]
    pub fn focus_for_typing(app: AppHandle) -> Result<(), String> {
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| "Main window 'main' not found".to_string())?;
        crate::appkit::focus_for_typing(&window).map_err(|e| e.to_string())
    }

    /// IPC command: sets window opacity
    #[tauri::command]
    pub fn set_window_opacity(
        app: AppHandle,
        state: State<'_, HotkeyState>,
        alpha: f64,
    ) -> Result<(), String> {
        super::set_window_opacity(&app, &state, alpha)
    }

    /// IPC command: sets layout mode ("floating-hud" or "dynamic-notch")
    #[tauri::command]
    pub fn set_layout_mode(
        app: AppHandle,
        state: State<'_, HotkeyState>,
        mode: String,
    ) -> Result<(), String> {
        super::set_layout_mode(&app, &state, &mode)
    }

    /// IPC command: retrieves atomic state snapshot
    #[tauri::command]
    pub fn get_hotkey_state(
        state: State<'_, HotkeyState>,
    ) -> Result<HotkeyStateSnapshot, String> {
        Ok(state.snapshot())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_layout_mode_parse_and_toggle() {
        assert_eq!("floating-hud".parse::<LayoutMode>().unwrap(), LayoutMode::FloatingHud);
        assert_eq!("floating".parse::<LayoutMode>().unwrap(), LayoutMode::FloatingHud);
        assert_eq!("HUD".parse::<LayoutMode>().unwrap(), LayoutMode::FloatingHud);
        assert_eq!("Floating HUD".parse::<LayoutMode>().unwrap(), LayoutMode::FloatingHud);

        assert_eq!("dynamic-notch".parse::<LayoutMode>().unwrap(), LayoutMode::DynamicNotch);
        assert_eq!("notch".parse::<LayoutMode>().unwrap(), LayoutMode::DynamicNotch);
        assert_eq!("Dynamic Notch".parse::<LayoutMode>().unwrap(), LayoutMode::DynamicNotch);

        assert!("invalid_mode".parse::<LayoutMode>().is_err());

        let hud = LayoutMode::FloatingHud;
        let notch = hud.toggle();
        assert_eq!(notch, LayoutMode::DynamicNotch);
        assert_eq!(notch.toggle(), LayoutMode::FloatingHud);
    }

    #[test]
    fn test_hotkey_state_default_and_snapshot() {
        let state = HotkeyState::default();
        let snap = state.snapshot();
        assert!(!snap.is_panicked);
        assert!(!snap.is_click_through);
        assert_eq!(snap.layout_mode, LayoutMode::FloatingHud);
        assert_eq!(snap.opacity, 1.0);

        state.is_panicked.store(true, Ordering::SeqCst);
        state.is_click_through.store(true, Ordering::SeqCst);
        *state.layout_mode.write().unwrap() = LayoutMode::DynamicNotch;
        *state.opacity.write().unwrap() = 0.75;

        let snap2 = state.snapshot();
        assert!(snap2.is_panicked);
        assert!(snap2.is_click_through);
        assert_eq!(snap2.layout_mode, LayoutMode::DynamicNotch);
        assert_eq!(snap2.opacity, 0.75);
    }

    #[test]
    fn test_resolve_action_panic() {
        let s1: Shortcut = SHORTCUT_PANIC.parse().expect("Failed to parse SHORTCUT_PANIC");
        assert_eq!(resolve_action(&s1), Some(SidekickAction::Panic));

        let s2: Shortcut = "Cmd+Escape".parse().expect("Failed to parse Cmd+Escape");
        assert_eq!(resolve_action(&s2), Some(SidekickAction::Panic));

        let s3: Shortcut = "Cmd+Esc".parse().expect("Failed to parse Cmd+Esc");
        assert_eq!(resolve_action(&s3), Some(SidekickAction::Panic));
    }

    #[test]
    fn test_resolve_action_toggle_visibility() {
        let s1: Shortcut = SHORTCUT_TOGGLE_VISIBILITY.parse().expect("Failed to parse visibility shortcut");
        assert_eq!(resolve_action(&s1), Some(SidekickAction::ToggleVisibility));

        let s2: Shortcut = "Cmd+Backslash".parse().expect("Failed to parse Cmd+Backslash");
        assert_eq!(resolve_action(&s2), Some(SidekickAction::ToggleVisibility));
    }

    #[test]
    fn test_resolve_action_toggle_meeting() {
        let s1: Shortcut = SHORTCUT_TOGGLE_MEETING.parse().expect("Failed to parse meeting shortcut");
        assert_eq!(resolve_action(&s1), Some(SidekickAction::ToggleMeeting));

        let s2: Shortcut = "Cmd+Shift+Backslash".parse().expect("Failed to parse Cmd+Shift+Backslash");
        assert_eq!(resolve_action(&s2), Some(SidekickAction::ToggleMeeting));
    }

    #[test]
    fn test_resolve_action_toggle_click_through() {
        let s1: Shortcut = SHORTCUT_TOGGLE_CLICK_THROUGH.parse().expect("Failed to parse click-through shortcut");
        assert_eq!(resolve_action(&s1), Some(SidekickAction::ToggleClickThrough));

        let s2: Shortcut = "Cmd+Shift+C".parse().expect("Failed to parse Cmd+Shift+C");
        assert_eq!(resolve_action(&s2), Some(SidekickAction::ToggleClickThrough));
    }

    #[test]
    fn test_resolve_action_toggle_layout_mode() {
        let s1: Shortcut = SHORTCUT_TOGGLE_LAYOUT_MODE.parse().expect("Failed to parse layout shortcut");
        assert_eq!(resolve_action(&s1), Some(SidekickAction::ToggleLayoutMode));

        let s2: Shortcut = "Cmd+Shift+M".parse().expect("Failed to parse Cmd+Shift+M");
        assert_eq!(resolve_action(&s2), Some(SidekickAction::ToggleLayoutMode));
    }

    #[test]
    fn test_resolve_action_pick_option() {
        for (i, raw) in SHORTCUT_PICK_OPTIONS.iter().enumerate() {
            let s: Shortcut = raw.parse().expect("Failed to parse pick-option shortcut");
            assert_eq!(resolve_action(&s), Some(SidekickAction::PickOption(i as u8)));
        }
        // Plain Cmd+1 belongs to the browser and must not be taken
        let plain: Shortcut = "Super+Digit1".parse().expect("Failed to parse Cmd+1");
        assert_eq!(resolve_action(&plain), None);
    }

    #[test]
    fn test_resolve_action_visible_only() {
        let cases = [
            (SHORTCUT_OPEN_SETTINGS, SidekickAction::OpenSettings),
            (SHORTCUT_NEW_CHAT, SidekickAction::NewChat),
            (SHORTCUT_MOVE_UP, SidekickAction::MoveWindow(0, -1)),
            (SHORTCUT_MOVE_DOWN, SidekickAction::MoveWindow(0, 1)),
            (SHORTCUT_MOVE_LEFT, SidekickAction::MoveWindow(-1, 0)),
            (SHORTCUT_MOVE_RIGHT, SidekickAction::MoveWindow(1, 0)),
            (SHORTCUT_SCROLL_UP, SidekickAction::ScrollAnswer(true)),
            (SHORTCUT_SCROLL_DOWN, SidekickAction::ScrollAnswer(false)),
        ];
        for (raw, expected) in cases {
            assert!(VISIBLE_ONLY_SHORTCUTS.contains(&raw), "{raw} missing from VISIBLE_ONLY_SHORTCUTS");
            let s: Shortcut = raw.parse().expect("Failed to parse visible-only shortcut");
            assert_eq!(resolve_action(&s), Some(expected), "{raw}");
        }

        // Modifiers must match exactly: Shift+Left is not bound, and Cmd+Up is not Cmd+Shift+Up
        let shift_left: Shortcut = "Cmd+Shift+ArrowLeft".parse().expect("Failed to parse Cmd+Shift+ArrowLeft");
        assert_eq!(resolve_action(&shift_left), None);
    }

    #[test]
    fn test_resolve_action_assist() {
        let s: Shortcut = SHORTCUT_ASSIST.parse().expect("Failed to parse assist shortcut");
        assert!(VISIBLE_ONLY_SHORTCUTS.contains(&SHORTCUT_ASSIST));
        assert_eq!(resolve_action(&s), Some(SidekickAction::Assist));

        // Shift+Enter and plain Enter stay with the focused app (the Ask box and other fields)
        let shift_enter: Shortcut = "Super+Shift+Enter".parse().expect("Failed to parse Super+Shift+Enter");
        assert_eq!(resolve_action(&shift_enter), None);
        let enter: Shortcut = "Enter".parse().expect("Failed to parse Enter");
        assert_eq!(resolve_action(&enter), None);
    }

    #[test]
    fn test_resolve_action_removed_shortcuts() {
        // Super+Shift+Space is replaced by Super+Backslash; the focused app keeps these keys
        let old_visibility: Shortcut = "Super+Shift+Space".parse().expect("Failed to parse Super+Shift+Space");
        assert_eq!(resolve_action(&old_visibility), None);
        let capture: Shortcut = "Super+Shift+KeyS".parse().expect("Failed to parse Super+Shift+KeyS");
        assert_eq!(resolve_action(&capture), None);
    }

    #[test]
    fn test_clamp_position_within_bounds_is_unchanged() {
        let area = (0, 25, 1440, 875);
        assert_eq!(clamp_position(100, 100, 300, area, 80), (100, 100));
        assert_eq!(clamp_position(0, 25, 300, area, 80), (0, 25));
    }

    #[test]
    fn test_clamp_position_stops_at_each_edge() {
        let area = (0, 25, 1000, 800);
        // Left and top edges of the work area
        assert_eq!(clamp_position(-48, 100, 300, area, 80), (0, 100));
        assert_eq!(clamp_position(100, -20, 300, area, 80), (100, 25));
        // Right edge: the window's right side meets the area's right side
        assert_eq!(clamp_position(800, 100, 300, area, 80), (700, 100));
        // Bottom: the top edge may go no lower than 80 px above the area's bottom (825 - 80)
        assert_eq!(clamp_position(100, 790, 300, area, 80), (100, 745));
    }

    #[test]
    fn test_clamp_position_window_wider_than_area() {
        // Pinned to the area's left edge rather than oscillating or going negative
        assert_eq!(clamp_position(50, 0, 1200, (0, 0, 1000, 800), 80), (0, 0));
        assert_eq!(clamp_position(500, 0, 1200, (100, 40, 1000, 800), 80), (100, 40));
    }

    #[test]
    fn test_unrecognized_shortcut_returns_none() {
        let s1: Shortcut = "Control+Alt+KeyA".parse().expect("Failed to parse Control+Alt+KeyA");
        assert_eq!(resolve_action(&s1), None);
    }

    #[test]
    fn test_layout_mode_display() {
        assert_eq!(LayoutMode::FloatingHud.to_string(), "floating-hud");
        assert_eq!(LayoutMode::DynamicNotch.to_string(), "dynamic-notch");
    }

    #[test]
    fn test_opacity_range_validation() {
        let valid_alpha = 0.85;
        assert!((0.0..=1.0).contains(&valid_alpha));

        let negative_alpha = -0.1;
        assert!(!(0.0..=1.0).contains(&negative_alpha));

        let excessive_alpha = 1.05;
        assert!(!(0.0..=1.0).contains(&excessive_alpha));
    }
}
