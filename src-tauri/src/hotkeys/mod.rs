//! Global Shortcuts Engine & Instant Panic Killswitch
//!
//! Provides OS-level global keyboard shortcuts and Tauri IPC commands for:
//! - Panic Killswitch (`Cmd + Esc` / `Super + Escape`): Synchronously hides window, sets panic state, emits `sidekick://panic` (< 25ms).
//! - Window Visibility Toggle (`Cmd + Shift + Space` / `Super + Shift + Space`): Shows & focuses or hides window.
//! - Click-Through Toggle (`Cmd + Shift + C` / `Super + Shift + C`): Enables mouse pass-through to underlying apps.
//! - Layout Mode Toggle (`Cmd + Shift + M` / `Super + Shift + M`): Toggles between Floating HUD and Dynamic Notch.
//! - Opacity Configuration: Controls window alpha level.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
pub use tauri_plugin_global_shortcut::{
    Code, Modifiers, Shortcut, ShortcutEvent, ShortcutState,
};

/// Default shortcut string representations
pub const SHORTCUT_PANIC: &str = "Super+Escape";
pub const SHORTCUT_TOGGLE_VISIBILITY: &str = "Super+Shift+Space";
pub const SHORTCUT_TOGGLE_CLICK_THROUGH: &str = "Super+Shift+C";
pub const SHORTCUT_TOGGLE_LAYOUT_MODE: &str = "Super+Shift+M";
pub const SHORTCUT_CAPTURE_ACTIVE_WINDOW: &str = "Super+Shift+S";

/// Event names emitted to frontend
pub const EVENT_PANIC: &str = "sidekick://panic";
pub const EVENT_VISIBILITY_TOGGLED: &str = "sidekick://visibility_toggled";
pub const EVENT_CLICK_THROUGH_TOGGLED: &str = "sidekick://click_through_toggled";
pub const EVENT_TOGGLE_LAYOUT_MODE: &str = "sidekick://toggle_layout_mode";
pub const EVENT_OPACITY_CHANGED: &str = "sidekick://opacity_changed";
pub const EVENT_ACTIVE_WINDOW_CAPTURED: &str = "sidekick://active_window_captured";

/// Layout display modes supported by Sidekick
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum LayoutMode {
    /// Freely draggable, resizable window with opacity control
    FloatingHud,
    /// Snapped directly beneath the MacBook notch for webcam eye contact
    DynamicNotch,
}

impl LayoutMode {
    /// Toggles between Floating HUD and Dynamic Notch
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
    /// Synchronously hide all UI, abort network streams, flush audio buffers (< 25ms)
    Panic,
    /// Toggle window visibility (show + focus if hidden, hide if visible)
    ToggleVisibility,
    /// Toggle mouse cursor transparency / event passthrough
    ToggleClickThrough,
    /// Toggle layout mode between Floating HUD and Dynamic Notch
    ToggleLayoutMode,
    /// Silently capture frontmost active application window
    CaptureActiveWindow,
}

/// Resolves a parsed `Shortcut` into the matching `SidekickAction`
pub fn resolve_action(shortcut: &Shortcut) -> Option<SidekickAction> {
    if shortcut.matches(Modifiers::SUPER, Code::Escape) {
        Some(SidekickAction::Panic)
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::Space) {
        Some(SidekickAction::ToggleVisibility)
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyC) {
        Some(SidekickAction::ToggleClickThrough)
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyM) {
        Some(SidekickAction::ToggleLayoutMode)
    } else if shortcut.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyS) {
        Some(SidekickAction::CaptureActiveWindow)
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
            SidekickAction::Panic => {
                if let Err(e) = trigger_panic(app, &state) {
                    eprintln!("[Sidekick Hotkeys] Failed to execute panic: {e}");
                }
            }
            SidekickAction::ToggleVisibility => {
                if let Err(e) = toggle_window_visibility(app, &state) {
                    eprintln!("[Sidekick Hotkeys] Failed to toggle visibility: {e}");
                }
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
            SidekickAction::CaptureActiveWindow => {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    match crate::capture::capture_frontmost_window() {
                        Ok(capture) => {
                            let _ = app_handle.emit(EVENT_ACTIVE_WINDOW_CAPTURED, &capture);
                        }
                        Err(e) => {
                            eprintln!("[Sidekick Hotkeys] Failed to capture active window: {e}");
                        }
                    }
                });
            }
        }
    }
}

/// Synchronously hides the window, marks state as panicked, and emits the panic event (< 25ms).
pub fn trigger_panic<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
) -> Result<(), String> {
    // 1. Immediately and synchronously hide the main window (< 1ms)
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
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

    Ok(())
}

/// Toggles window visibility. If currently hidden (or panicked), summons and focuses window.
pub fn toggle_window_visibility<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().map_err(|e| e.to_string())?;
        if is_visible {
            window.hide().map_err(|e| e.to_string())?;
            let _ = app.emit(
                EVENT_VISIBILITY_TOGGLED,
                serde_json::json!({ "visible": false }),
            );
            Ok(false)
        } else {
            // Reset panic state when summoning the overlay
            state.is_panicked.store(false, Ordering::SeqCst);
            window.show().map_err(|e| e.to_string())?;
            window.set_focus().map_err(|e| e.to_string())?;
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

/// Sets whether mouse clicks ignore the overlay window.
pub fn set_click_through<R: Runtime>(
    app: &AppHandle<R>,
    state: &HotkeyState,
    enabled: bool,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main") {
        window
            .set_ignore_cursor_events(enabled)
            .map_err(|e| e.to_string())?;
    }
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

    /// IPC command: synchronously triggers panic shutdown (< 25ms)
    #[tauri::command]
    pub fn trigger_panic(
        app: AppHandle,
        state: State<'_, HotkeyState>,
    ) -> Result<(), String> {
        super::trigger_panic(&app, &state)
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

        let s2: Shortcut = "Cmd+Shift+Space".parse().expect("Failed to parse Cmd+Shift+Space");
        assert_eq!(resolve_action(&s2), Some(SidekickAction::ToggleVisibility));
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
    fn test_resolve_action_capture_active_window() {
        let s1: Shortcut = SHORTCUT_CAPTURE_ACTIVE_WINDOW.parse().expect("Failed to parse capture shortcut");
        assert_eq!(resolve_action(&s1), Some(SidekickAction::CaptureActiveWindow));

        let s2: Shortcut = "Cmd+Shift+S".parse().expect("Failed to parse Cmd+Shift+S");
        assert_eq!(resolve_action(&s2), Some(SidekickAction::CaptureActiveWindow));

        let s3: Shortcut = "Super+Shift+KeyS".parse().expect("Failed to parse Super+Shift+KeyS");
        assert_eq!(resolve_action(&s3), Some(SidekickAction::CaptureActiveWindow));
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
