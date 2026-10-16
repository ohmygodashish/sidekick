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
import { cn } from "../../lib/utils";
import { usePresence } from "../../hooks/usePresence";

interface MenuItemProps {
  icon: LucideIcon;
  label: string;
  shortcut: string;
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
    <kbd className="sk-kbd">{shortcut}</kbd>
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
      <button
        ref={triggerRef}
        type="button"
        className="sk-icon-btn"
        aria-label="More options"
        title="More options"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Ellipsis className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

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
            shortcut="⌘⇧M"
            checked={layoutMode === "dynamic_notch"}
            onSelect={choose(toggleLayoutMode)}
          />
          <MenuItem
            icon={MousePointerClick}
            label="Click-through"
            shortcut="⌘⇧C"
            checked={isClickThrough}
            onSelect={choose(toggleClickThrough)}
          />
          <MenuItem
            icon={Settings}
            label="Settings"
            shortcut="⌘,"
            onSelect={choose(toggleSettings)}
          />
          <div role="separator" className="my-1 h-px bg-sk-line" />
          <MenuItem
            icon={OctagonX}
            label="Panic"
            shortcut="⌘Esc"
            danger
            onSelect={choose(triggerPanic)}
          />
        </div>
      )}
    </div>
  );
};
