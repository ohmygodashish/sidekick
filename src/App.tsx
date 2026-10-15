import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { HUDContainer } from "./components/hud/HUDContainer";
import { setupAppEventListeners, useAppStore } from "./store/appStore";
import { useSettingsStore } from "./store/settingsStore";
import { useQuestionDetector } from "./hooks/useQuestionDetector";
import { useDeepSolver } from "./hooks/useDeepSolver";
import { setSttEngine } from "./lib/ipc";

export default function App() {
  const syncFromBackend = useAppStore((state) => state.syncFromBackend);
  const opacity = useAppStore((state) => state.opacity);

  // Live question detection (interviewer only) and Enter / Cmd+Enter to solve (REQ-011, REQ-012)
  useQuestionDetector();

  // Deep solver gateway with progressive streaming (REQ-014, REQ-015)
  useDeepSolver();

  useEffect(() => {
    syncFromBackend();
    useSettingsStore.getState().loadApiKeysFromBackend();
    // Settings hydrate async inside Tauri; push the saved STT engine only once loaded
    const syncSttEngine = () => setSttEngine(useSettingsStore.getState().sttMode);
    let unsubHydration: (() => void) | undefined;
    if (useSettingsStore.persist.hasHydrated()) syncSttEngine();
    else unsubHydration = useSettingsStore.persist.onFinishHydration(syncSttEngine);
    // Audio capture starts only when the user presses Start in the bar.

    // StrictMode mounts twice in dev; drop listeners that resolve after cleanup
    let cancelled = false;
    let cleanupFn: (() => void) | undefined;
    setupAppEventListeners().then((unlisten) => {
      if (cancelled) unlisten();
      else cleanupFn = unlisten;
    });

    const handleSettingsHotkey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        useSettingsStore.getState().toggleSettings();
      }
    };
    window.addEventListener("keydown", handleSettingsHotkey);

    return () => {
      cancelled = true;
      unsubHydration?.();
      cleanupFn?.();
      window.removeEventListener("keydown", handleSettingsHotkey);
    };
  }, [syncFromBackend]);

  // Inside Tauri the window alpha is set natively (NSWindow setAlphaValue); elsewhere fall back to CSS opacity.
  const isRunningInTauri = typeof window !== "undefined" && isTauri();

  return (
    <div
      data-testid="app-root"
      className="h-screen w-screen overflow-hidden bg-transparent select-none"
      style={isRunningInTauri ? undefined : { opacity }}
    >
      <HUDContainer />
    </div>
  );
}
