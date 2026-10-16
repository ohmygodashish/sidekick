import { useEffect } from "react";
import { useAppStore } from "../store/appStore";
import { useSettingsStore } from "../store/settingsStore";
import { warmConnections, warmPromptCache } from "../services/ai/warmup";

/**
 * Warms the answer provider when Sidekick is shown, and when a meeting goes live (which also warms the
 * prompt cache). Settings are read when the warm-up runs. Mounted once in App.
 */
export function useWarmup() {
  useEffect(
    () =>
      useAppStore.subscribe((state, prev) => {
        const shown = state.isVisible && !prev.isVisible;
        const live = state.meetingStatus === "live" && prev.meetingStatus !== "live";
        if (!shown && !live) return;
        const settings = useSettingsStore.getState();
        warmConnections(settings);
        if (live) void warmPromptCache(settings);
      }),
    []
  );
}
