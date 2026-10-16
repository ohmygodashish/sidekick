import { useLayoutEffect } from "react";
import { useSettingsStore } from "../store/settingsStore";

/** Sets data-theme with transitions off for two frames, so every colour changes in the same frame */
function setTheme(root: HTMLElement, next: string) {
  if (root.dataset.theme === next) return;
  const first = root.dataset.theme === undefined;
  if (!first) root.dataset.themeSwitching = "";
  root.dataset.theme = next;
  if (!first) requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching));
}

/** Applies the theme setting as data-theme on <html>; "system" follows macOS as it changes. */
export function useTheme() {
  const theme = useSettingsStore((s) => s.theme);

  // Layout effect: set before paint, so the first frame is already in the right theme
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (theme !== "system") {
      setTheme(root, theme);
      return;
    }
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const apply = () => setTheme(root, media?.matches ? "light" : "dark");
    apply();
    media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [theme]);
}
