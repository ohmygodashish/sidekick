import React from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { cn } from "../../lib/utils";

export interface LayoutSwitcherProps {
  className?: string;
  compact?: boolean;
  showHotkey?: boolean;
}

export const LayoutSwitcher: React.FC<LayoutSwitcherProps> = ({
  className,
  compact = false,
  showHotkey = true,
}) => {
  const layoutMode = useAppStore((state) => state.layoutMode);
  const toggleLayoutMode = useAppStore((state) => state.toggleLayoutMode);

  const isNotch = layoutMode === "dynamic_notch";

  return (
    <button
      type="button"
      data-testid="layout-switcher"
      onClick={() => toggleLayoutMode()}
      onMouseDown={(e) => e.stopPropagation()}
      title="Toggle Floating HUD / Dynamic Notch (Cmd + Shift + M)"
      aria-label={isNotch ? "Switch to Floating HUD" : "Switch to Dynamic Notch"}
      className={cn(
        "flex items-center gap-1.5 rounded-lg font-medium border transition-colors select-none",
        compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]",
        isNotch
          ? "bg-sky-500/15 text-sky-300 border-sky-500/30 hover:bg-sky-500/25"
          : "bg-zinc-900/60 text-zinc-400 border-zinc-800/60 hover:text-zinc-200 hover:border-zinc-700/60",
        className
      )}
    >
      {isNotch ? (
        <Maximize2 className={cn(compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
      ) : (
        <Minimize2 className={cn(compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
      )}
      <span>{isNotch ? "Notch" : "HUD"}</span>
      {showHotkey && (
        <kbd className="hidden sm:inline rounded bg-zinc-800/80 px-1 py-0.2 text-[9px] font-mono text-zinc-400 border border-zinc-700/40">
          ⌘⇧M
        </kbd>
      )}
    </button>
  );
};
