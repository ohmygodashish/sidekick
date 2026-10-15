import { useEffect } from "react";
import { HUDContainer } from "./components/hud/HUDContainer";
import { setupAppEventListeners, useAppStore } from "./store/appStore";

export default function App() {
  const syncFromBackend = useAppStore((state) => state.syncFromBackend);
  const opacity = useAppStore((state) => state.opacity);
  const layoutMode = useAppStore((state) => state.layoutMode);

  useEffect(() => {
    // 1. Initial state synchronization with Tauri backend
    syncFromBackend();

    // 2. Setup hotkey and window event listeners
    let cleanupFn: (() => void) | undefined;
    setupAppEventListeners().then((unlisten) => {
      cleanupFn = unlisten;
    });

    return () => {
      if (cleanupFn) {
        cleanupFn();
      }
    };
  }, [syncFromBackend]);

  const isNotch = layoutMode === "dynamic_notch";

  return (
    <div
      className={`min-h-screen w-screen p-4 flex ${
        isNotch ? "items-start justify-center pt-2" : "items-center justify-center"
      } bg-transparent transition-all duration-300`}
      style={{
        // Web fallback for opacity styling when outside Tauri native window
        opacity,
      }}
    >
      <HUDContainer />
    </div>
  );
}
