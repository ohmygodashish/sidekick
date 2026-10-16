import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { HUDContainer } from "./components/hud/HUDContainer";
import { setupAppEventListeners, useAppStore } from "./store/appStore";
import { pushMicDevice, pushSttLanguage, useSettingsStore } from "./store/settingsStore";
import { useSessionStore } from "./store/sessionStore";
import { useLiveOptions } from "./hooks/useLiveOptions";
import { useDeepSolver } from "./hooks/useDeepSolver";
import { useTheme } from "./hooks/useTheme";
import { useFocusRelease } from "./hooks/useFocusRelease";
import { usePointerHover } from "./hooks/usePointerHover";
import { setSttEngine } from "./lib/ipc";
import { CODING_MODE_ID } from "./services/ai/modes";

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

  // Hover styles follow the pointer that Rust reports (WebKit doesn't track it over the overlay)
  usePointerHover();

  useEffect(() => {
    syncFromBackend();
    useSettingsStore.getState().loadApiKeysFromBackend();
    // Settings hydrate async inside Tauri; push the saved audio settings only once loaded
    const syncAudioSettings = () => {
      const { sttMode, activeModeId } = useSettingsStore.getState();
      // The language check runs after the engine is set: Rust answers with a note for the pair
      void setSttEngine(sttMode).then(pushSttLanguage);
      void pushMicDevice();
      // Coding turns the options' screen on at startup, as choosing it does
      useSessionStore.setState({ optionsUseScreen: activeModeId === CODING_MODE_ID });
    };
    let unsubHydration: (() => void) | undefined;
    if (useSettingsStore.persist.hasHydrated()) syncAudioSettings();
    else unsubHydration = useSettingsStore.persist.onFinishHydration(syncAudioSettings);
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
