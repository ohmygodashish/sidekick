// Single source of truth for the shortcuts Sidekick shows: tooltips, the … menu and Settings → Keybinds.
// The bindings themselves live in Rust (hotkeys). Keys are glyphs, one chip each in the UI.

export type ShortcutGroup = "General" | "Window" | "Scroll" | "Options";

export type ShortcutId =
  | "show_hide"
  | "toggle_listening"
  | "new_chat"
  | "open_settings"
  | "panic"
  | "click_through"
  | "compact_view"
  | "move_up"
  | "move_down"
  | "move_left"
  | "move_right"
  | "scroll_up"
  | "scroll_down"
  | "pick_option";

export interface Shortcut {
  id: ShortcutId;
  label: string;
  keys: string[];
  group: ShortcutGroup;
  whileVisible: boolean; // only works while Sidekick is showing; other apps keep the keys when hidden
}

export const SHORTCUTS: Shortcut[] = [
  { id: "show_hide", label: "Show or hide Sidekick", keys: ["⌘", "\\"], group: "General", whileVisible: false },
  { id: "toggle_listening", label: "Start or stop listening", keys: ["⇧", "⌘", "\\"], group: "General", whileVisible: false },
  { id: "new_chat", label: "Start a new chat", keys: ["⌘", "R"], group: "General", whileVisible: true },
  { id: "open_settings", label: "Open settings", keys: ["⌘", ","], group: "General", whileVisible: true },
  { id: "panic", label: "Panic: wipe and quit", keys: ["⌘", "Esc"], group: "General", whileVisible: false },
  { id: "click_through", label: "Click-through", keys: ["⌘", "⇧", "C"], group: "General", whileVisible: false },
  { id: "compact_view", label: "Compact view", keys: ["⌘", "⇧", "M"], group: "General", whileVisible: false },
  { id: "move_up", label: "Move the window up", keys: ["⌘", "↑"], group: "Window", whileVisible: true },
  { id: "move_down", label: "Move the window down", keys: ["⌘", "↓"], group: "Window", whileVisible: true },
  { id: "move_left", label: "Move the window left", keys: ["⌘", "←"], group: "Window", whileVisible: true },
  { id: "move_right", label: "Move the window right", keys: ["⌘", "→"], group: "Window", whileVisible: true },
  { id: "scroll_up", label: "Scroll the answer up", keys: ["⇧", "⌘", "↑"], group: "Scroll", whileVisible: true },
  { id: "scroll_down", label: "Scroll the answer down", keys: ["⇧", "⌘", "↓"], group: "Scroll", whileVisible: true },
  { id: "pick_option", label: "Answer option 1, 2 or 3", keys: ["⌘", "⌥", "1–3"], group: "Options", whileVisible: false },
];

export function getShortcut(id: ShortcutId): Shortcut {
  const shortcut = SHORTCUTS.find((s) => s.id === id);
  if (!shortcut) throw new Error(`No shortcut with id "${id}"`);
  return shortcut;
}
