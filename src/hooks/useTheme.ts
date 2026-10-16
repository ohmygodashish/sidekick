import { useLayoutEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";

/** Applies the theme setting as data-theme on <html>; "system" follows macOS as it changes. */
export function useTheme() {
  const theme = useSettingsStore((s) => s.theme);

  // Layout effect: set before paint, so the first frame is already in the right theme
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme !== "system") {
      root.dataset.theme = theme;
      return;
    }
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () => (root.dataset.theme = media?.matches ? "light" : "dark");
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [theme]);
}
