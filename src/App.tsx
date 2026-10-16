import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { HUDContainer } from "./components/hud/HUDContainer";
import { setupAppEventListeners, useAppStore } from "./store/appStore";
import { useSettingsStore } from "./store/settingsStore";
import { useLiveOptions } from "./hooks/useLiveOptions";
import { useDeepSolver } from "./hooks/useDeepSolver";
import { useTheme } from "./hooks/useTheme";
import { useFocusRelease } from "./hooks/useFocusRelease";
import { setSttEngine } from "./lib/ipc";

export default function App() {
  const syncFromBackend = useAppStore((state) => state.syncFromBackend);
  const opacity = useAppStore((state) => state.opacity);

  // Live options from the transcript, picked by click or Cmd+Option+1/2/3
  useLiveOptions();

  // Deep solver gateway with progressive streaming (REQ-014, REQ-015)
  useDeepSolver();

  // System / Light / Dark from Settings
  useTheme();

  // Keyboard focus returns to the previous app after clicks outside text fields
  useFocusRelease();

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

    return () => {
      cancelled = true;
      unsubHydration?.();
      cleanupFn?.();
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
