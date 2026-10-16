import { useEffect } from "react";
import { safeInvoke } from "../lib/ipc";
import { useSettingsStore } from "../store/settingsStore";

const TEXT_FIELD = 'input, textarea, select, [contenteditable="true"]';

/**
 * True when keyboard focus can go back to the app underneath: no text field has focus, no text is
 * selected, no menu is open (a closing menu is still mounted for its exit animation) and the
 * settings drawer is closed.
 */
export function shouldReleaseFocus(doc: Document, settingsOpen: boolean): boolean {
  const typing = doc.activeElement?.matches(TEXT_FIELD) ?? false;
  // Selected text keeps the keyboard too, so ⌘C on an answer still reaches Sidekick
  const selecting = Boolean(doc.getSelection()?.toString());
  return !typing && !selecting && !doc.querySelector('[role="menu"]:not([data-state="closed"])') && !settingsOpen;
}

/**
 * Hands keyboard focus back once the user clicks away from a text field, or closes settings, so
 * Sidekick never keeps keys it is not typing into. Focusing a text field makes Sidekick active.
 */
export function useFocusRelease() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Wait a tick so the DOM has settled: a click that opens a menu has rendered, and closed settings have unmounted
    const release = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (shouldReleaseFocus(document, useSettingsStore.getState().isSettingsOpen)) {
          safeInvoke("release_focus");
        }
      }, 0);
    };

    // pointerdown too: re-clicking a field that kept DOM focus fires no focusin
    const takeFocus = (event: Event) => {
      if (event.target instanceof Element && event.target.matches(TEXT_FIELD)) {
        safeInvoke("focus_for_typing");
      }
    };

    window.addEventListener("pointerup", release, true);
    window.addEventListener("focusin", takeFocus, true);
    window.addEventListener("pointerdown", takeFocus, true);
    const unsubscribeSettings = useSettingsStore.subscribe((state, prev) => {
      if (prev.isSettingsOpen && !state.isSettingsOpen) release();
    });

    return () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("focusin", takeFocus, true);
      window.removeEventListener("pointerdown", takeFocus, true);
      unsubscribeSettings();
      clearTimeout(timer);
    };
  }, []);
}
