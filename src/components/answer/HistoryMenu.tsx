import React, { useEffect, useRef, useState } from "react";
import { Check, History } from "lucide-react";
import { useSessionStore } from "../../store/sessionStore";
import { Tip } from "../hud/Tip";
import { usePresence } from "../../hooks/usePresence";

const menuItems = (menu: HTMLElement | null) =>
  Array.from(menu?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

// 14:05, from the thread's start time
const clock = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** This meeting's chats, newest first. Choosing one reopens it in the panel. */
export const HistoryMenu: React.FC = () => {
  const [open, setOpen] = useState(false);
  const menu = usePresence(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const threads = useSessionStore((s) => s.threads);
  const activeThreadId = useSessionStore((s) => s.activeThreadId);
  const openThread = useSessionStore((s) => s.openThread);

  // Focus the first item when the menu opens
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
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === "ArrowDown" ? (i + 1) % items.length : i <= 0 ? items.length - 1 : i - 1;
    items[next]?.focus();
  };

  return (
    <div ref={rootRef} className="relative" onKeyDown={handleKeyDown}>
      <Tip label="History" disabled={open}>
        <button
          ref={triggerRef}
          type="button"
          className="sk-icon-btn rounded-lg"
          aria-label="History"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <History className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </Tip>

      {menu.mounted && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="History"
          data-state={menu.state}
          inert={menu.state === "closed"}
          className="sk-menu sk-pop !origin-top-left absolute left-0 top-full z-10 mt-1 max-h-72 w-72 overflow-y-auto"
        >
          {threads.length === 0 && <p role="none" className="px-2.5 py-1.5 text-[13px] text-sk-fg-3">No chats yet</p>}
          {threads.map((thread) => {
            const active = thread.id === activeThreadId;
            return (
              <button
                key={thread.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className="sk-menu-item h-auto min-h-8 py-1.5"
                onClick={() => {
                  openThread(thread.id);
                  closeMenu();
                }}
              >
                <span className="min-w-0 flex-1 truncate">{thread.messages[0]?.question}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-sk-fg-3">{clock(thread.startedAt)}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0 text-sk-accent" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
