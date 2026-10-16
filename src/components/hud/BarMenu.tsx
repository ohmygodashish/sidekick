import React, { useEffect, useRef, useState } from "react";
import {
  Check,
  Ellipsis,
  Minimize2,
  MousePointerClick,
  OctagonX,
  Settings,
  SunDim,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSettingsStore } from "../../store/settingsStore";
import { OpacityControl } from "./OpacityControl";
import { Tip } from "./Tip";
import { cn } from "../../lib/utils";
import { usePresence } from "../../hooks/usePresence";
import { getShortcut, type ShortcutId } from "../../lib/shortcuts";
import { allModes, resolveMode } from "../../services/ai/modes";

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  shortcut: ShortcutId;
  onSelect: () => void;
  checked?: boolean; // only for checkbox items
  danger?: boolean;
}

const MenuItem: React.FC<MenuItemProps> = ({
  icon: Icon,
  label,
  shortcut,
  onSelect,
  checked,
  danger,
}) => (
  <button
    type="button"
    role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
    aria-checked={checked}
    className={cn("sk-menu-item", danger && "text-sk-danger")}
    onClick={onSelect}
  >
    <Icon className={cn("h-3.5 w-3.5", danger ? "text-sk-danger" : "text-sk-fg-3")} aria-hidden="true" />
    <span className="flex-1">{label}</span>
    {checked && <Check className="h-3.5 w-3.5 text-sk-accent" aria-hidden="true" />}
    <kbd className="sk-kbd">{getShortcut(shortcut).keys.join("")}</kbd>
  </button>
);

const menuItems = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

export const BarMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const menu = usePresence(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const opacity = useAppStore((state) => state.opacity);
  const layoutMode = useAppStore((state) => state.layoutMode);
  const isClickThrough = useAppStore((state) => state.isClickThrough);
  const toggleLayoutMode = useAppStore((state) => state.toggleLayoutMode);
  const toggleClickThrough = useAppStore((state) => state.toggleClickThrough);
  const triggerPanic = useAppStore((state) => state.triggerPanic);
  const toggleSettings = useSettingsStore((state) => state.toggleSettings);
  const customModes = useSettingsStore((state) => state.modes);
  const activeModeId = useSettingsStore((state) => state.activeModeId);
  const setActiveMode = useSettingsStore((state) => state.setActiveMode);
  const activeMode = resolveMode(activeModeId, customModes);

  // Focus the first menu item when the menu opens
  useEffect(() => {
    if (open) menuItems(menuRef.current)[0]?.focus();
  }, [open]);

  // Close on pointer-down outside the trigger and menu
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Clicks outside the UI pass through to other apps, so leaving the window closes it too
    const onBlur = () => setOpen(false);
    document.addEventListener("mousedown", onMouseDown);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [open]);

  const closeMenu = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const choose = (action: () => unknown) => () => {
    action();
    closeMenu();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = menuItems(menuRef.current);
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1;
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={handleKeyDown}>
      <Tip label="More options" disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          className="sk-icon-btn"
          aria-label="More options"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <Ellipsis className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </Tip>

      {menu.mounted && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="More options"
          data-state={menu.state}
          inert={menu.state === "closed"}
          className="sk-menu sk-pop absolute right-0 top-full z-10 mt-2 w-64"
        >
          <div className="flex items-center gap-2 px-2.5 py-1.5">
            <SunDim className="h-3.5 w-3.5 shrink-0 text-sk-fg-3" aria-hidden="true" />
            <label htmlFor="sk-opacity" className="text-[13px] text-sk-fg-2">
              Opacity
            </label>
            <OpacityControl />
            <span className="w-9 text-right text-[12px] tabular-nums text-sk-fg-3">
              {Math.round(opacity * 100)}%
            </span>
          </div>
          <div role="separator" className="my-1 h-px bg-sk-line" />
          <MenuItem
            icon={Minimize2}
            label="Compact view"
            shortcut="compact_view"
            checked={layoutMode === "dynamic_notch"}
            onSelect={choose(toggleLayoutMode)}
          />
          <MenuItem
            icon={MousePointerClick}
            label="Click-through"
            shortcut="click_through"
            checked={isClickThrough}
            onSelect={choose(toggleClickThrough)}
          />
          <MenuItem
            icon={Settings}
            label="Settings"
            shortcut="open_settings"
            onSelect={choose(toggleSettings)}
          />
          <div role="separator" className="my-1 h-px bg-sk-line" />
          <div role="group" aria-label="Mode">
            <div className="flex items-center gap-2 px-2.5 pb-0.5 pt-1 text-[12px] text-sk-fg-3">
              <span className="flex-1">Mode</span>
              <span className="min-w-0 truncate">{activeMode.name}</span>
            </div>
            <div className="max-h-48 overflow-y-auto sk-scroll">
              {allModes(customModes).map((mode) => {
                // Checked against the resolved mode, so a deleted custom mode shows General as checked
                const active = mode.id === activeMode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={active}
                    title={mode.description}
                    className="sk-menu-item"
                    onClick={choose(() => setActiveMode(mode.id))}
                  >
                    <span className="min-w-0 flex-1 truncate">{mode.name}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-sk-accent" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
          <div role="separator" className="my-1 h-px bg-sk-line" />
          <MenuItem
            icon={OctagonX}
            label="Panic: wipe and quit"
            shortcut="panic"
            danger
            onSelect={choose(triggerPanic)}
          />
        </div>
      )}
    </div>
  );
};
