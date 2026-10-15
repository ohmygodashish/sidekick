import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { HUDContainer } from "./components/hud/HUDContainer";
import { NotchCompanion } from "./components/hud/NotchCompanion";
import { SettingsDrawer } from "./components/settings/SettingsDrawer";
import { setupAppEventListeners, useAppStore } from "./store/appStore";
import { useSettingsStore } from "./store/settingsStore";
import { useQuestionDetector } from "./hooks/useQuestionDetector";
import { useDeepSolver } from "./hooks/useDeepSolver";
import { setSttEngine, startAudioCapture } from "./lib/ipc";
import { cn } from "./lib/utils";

export default function App() {
  const syncFromBackend = useAppStore((state) => state.syncFromBackend);
  const opacity = useAppStore((state) => state.opacity);
  const layoutMode = useAppStore((state) => state.layoutMode);

  // Initialize live question detection and Enter / Cmd+Enter hotkeys (REQ-011, REQ-012)
  useQuestionDetector({ allowCandidate: true });

  // Initialize deep solver gateway with progressive streaming (REQ-014, REQ-015)
  useDeepSolver();

  useEffect(() => {
    // 1. Initial state synchronization with Tauri backend
    syncFromBackend();
    useSettingsStore.getState().loadApiKeysFromBackend();

    // Synchronize persisted STT mode to native backend (Task 10 review fix)
    const sttMode = useSettingsStore.getState().sttMode;
    setSttEngine(sttMode);

    // Auto-start driverless audio ingestion pipeline (REQ-007, REQ-008)
    startAudioCapture().catch((err) => {
      console.warn("[App] Could not initialize audio capture on mount:", err);
    });

    // 2. Setup hotkey and window event listeners
    let cleanupFn: (() => void) | undefined;
    setupAppEventListeners().then((unlisten) => {
      cleanupFn = unlisten;
    });

    // 3. Global settings hotkey: Cmd + ,
    const handleSettingsHotkey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        useSettingsStore.getState().toggleSettings();
      }
    };
    window.addEventListener("keydown", handleSettingsHotkey);

    return () => {
      if (cleanupFn) {
        cleanupFn();
      }
      window.removeEventListener("keydown", handleSettingsHotkey);
    };
  }, [syncFromBackend]);

  const isNotch = layoutMode === "dynamic_notch";

  // Check if running inside native Tauri webview
  // Inside Tauri, window alpha is managed natively via macOS NSWindow setAlphaValue.
  // Outside Tauri (e.g. browser, Vitest), apply CSS opacity fallback to avoid double-opacity attenuation.
  const isRunningInTauri = typeof window !== "undefined" && isTauri();

  return (
    <div
      data-testid="app-root"
      className={cn(
        "h-screen w-screen flex bg-transparent transition-all duration-300 ease-out select-none overflow-hidden",
        isNotch
          ? "items-start justify-center pt-0 sm:pt-1 px-2"
          : "items-center justify-center p-4"
      )}
      style={isRunningInTauri ? undefined : { opacity }}
    >
      <div
        key={layoutMode}
        className="w-full flex justify-center animate-in fade-in duration-200"
      >
        {isNotch ? <NotchCompanion /> : <HUDContainer />}
      </div>

      {/* Settings Sliding Overlay (REQ-002, REQ-016) */}
      <SettingsDrawer />
    </div>
  );
}
