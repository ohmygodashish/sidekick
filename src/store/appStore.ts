import { create } from "zustand";

export type LayoutMode = "floating_hud" | "dynamic_notch";

export interface AppState {
  layoutMode: LayoutMode;
  opacity: number; // 0.15 to 1.0, default 0.85
  isClickThrough: boolean; // default false
  isVisible: boolean; // default false
  isPanicked: boolean; // default false

  // Actions
  setLayoutMode: (mode: LayoutMode) => Promise<void>;
  toggleLayoutMode: () => Promise<void>;
  setOpacity: (opacity: number) => Promise<void>;
  setClickThrough: (enabled: boolean) => Promise<void>;
  toggleClickThrough: () => Promise<void>;
  setIsVisible: (visible: boolean) => void;
  triggerPanic: () => Promise<void>;
  resetPanic: () => void;
  syncFromBackend: () => Promise<void>;
}

/**
 * Safely invokes a Tauri IPC command.
 * Gracefully falls back if running in browser/test environment.
 */
async function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(cmd, args);
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[Sidekick IPC] '${cmd}' failed or running outside Tauri context:`, err);
    }
    return null;
  }
}

export const useAppStore = create<AppState>((set, get) => ({
  layoutMode: "floating_hud",
  opacity: 0.85,
  isClickThrough: false,
  isVisible: false,
  isPanicked: false,

  setLayoutMode: async (mode: LayoutMode) => {
    set({ layoutMode: mode });
    // Rust accepts kebab-case or snake_case
    await safeInvoke("set_layout_mode", { mode: mode.replace("_", "-") });
  },

  toggleLayoutMode: async () => {
    const nextMode: LayoutMode =
      get().layoutMode === "floating_hud" ? "dynamic_notch" : "floating_hud";
    set({ layoutMode: nextMode });
    await safeInvoke("set_layout_mode", { mode: nextMode.replace("_", "-") });
  },

  setOpacity: async (rawOpacity: number) => {
    const clamped = Math.min(1.0, Math.max(0.15, Number(rawOpacity.toFixed(2))));
    set({ opacity: clamped });
    await safeInvoke("set_window_opacity", { alpha: clamped });
  },

  setClickThrough: async (enabled: boolean) => {
    set({ isClickThrough: enabled });
    await safeInvoke("set_click_through", { enabled });
  },

  toggleClickThrough: async () => {
    const next = !get().isClickThrough;
    set({ isClickThrough: next });
    await safeInvoke("set_click_through", { enabled: next });
  },

  setIsVisible: (visible: boolean) => {
    set({
      isVisible: visible,
      ...(visible ? { isPanicked: false } : {}),
    });
  },

  triggerPanic: async () => {
    set({ isPanicked: true, isVisible: false });
    await safeInvoke("trigger_panic");
  },

  resetPanic: () => {
    set({ isPanicked: false });
  },

  syncFromBackend: async () => {
    interface HotkeySnapshot {
      is_panicked: boolean;
      is_click_through: boolean;
      layout_mode: string;
      opacity: number;
    }

    const snapshot = await safeInvoke<HotkeySnapshot>("get_hotkey_state");
    if (snapshot) {
      const modeNormalized = (snapshot.layout_mode || "").toLowerCase().includes("notch")
        ? "dynamic_notch"
        : "floating_hud";

      set({
        isPanicked: snapshot.is_panicked,
        isClickThrough: snapshot.is_click_through,
        layoutMode: modeNormalized,
        opacity: Math.min(1.0, Math.max(0.15, snapshot.opacity)),
      });
    }
  },
}));

/**
 * Subscribes to Tauri backend events to synchronize hotkeys and window state.
 * Returns an unlisten function for cleanup on component unmount.
 */
export async function setupAppEventListeners(): Promise<() => void> {
  const unlisteners: (() => void)[] = [];

  try {
    const { listen } = await import("@tauri-apps/api/event");

    // 1. Panic event (Cmd + Esc)
    const unlistenPanic = await listen<{ action: string; timestamp: number }>(
      "sidekick://panic",
      () => {
        useAppStore.setState({ isPanicked: true, isVisible: false });
      }
    );
    unlisteners.push(unlistenPanic);

    // 2. Visibility toggled event (Cmd + Shift + Space)
    const handleVisibility = (payload: { visible: boolean }) => {
      useAppStore.setState({
        isVisible: payload.visible,
        ...(payload.visible ? { isPanicked: false } : {}),
      });
    };

    const unlistenVis1 = await listen<{ visible: boolean }>(
      "sidekick://visibility_toggled",
      (e) => handleVisibility(e.payload)
    );
    unlisteners.push(unlistenVis1);

    const unlistenVis2 = await listen<{ visible: boolean }>(
      "sidekick://toggle_visibility",
      (e) => handleVisibility(e.payload)
    );
    unlisteners.push(unlistenVis2);

    // 3. Click-through toggled event (Cmd + Shift + C)
    const handleClickThrough = (payload: { enabled: boolean }) => {
      useAppStore.setState({ isClickThrough: payload.enabled });
    };

    const unlistenClick1 = await listen<{ enabled: boolean }>(
      "sidekick://click_through_toggled",
      (e) => handleClickThrough(e.payload)
    );
    unlisteners.push(unlistenClick1);

    const unlistenClick2 = await listen<{ enabled: boolean }>(
      "sidekick://toggle_click_through",
      (e) => handleClickThrough(e.payload)
    );
    unlisteners.push(unlistenClick2);

    // 4. Layout mode toggled event (Cmd + Shift + M)
    const unlistenLayout = await listen<{ mode: string; mode_str?: string }>(
      "sidekick://toggle_layout_mode",
      (e) => {
        const modeStr = (e.payload.mode || e.payload.mode_str || "").toLowerCase();
        const mode: LayoutMode = modeStr.includes("notch")
          ? "dynamic_notch"
          : "floating_hud";
        useAppStore.setState({ layoutMode: mode });
      }
    );
    unlisteners.push(unlistenLayout);

    // 5. Opacity changed event
    const unlistenOpacity = await listen<{ opacity: number }>(
      "sidekick://opacity_changed",
      (e) => {
        if (typeof e.payload.opacity === "number") {
          const clamped = Math.min(1.0, Math.max(0.15, e.payload.opacity));
          useAppStore.setState({ opacity: clamped });
        }
      }
    );
    unlisteners.push(unlistenOpacity);
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("[Sidekick Events] Failed to bind Tauri event listeners:", err);
    }
  }

  return () => {
    unlisteners.forEach((unlisten) => {
      try {
        unlisten();
      } catch (err) {
        console.error("Error unlistening event:", err);
      }
    });
  };
}
