import React from "react";
import { Monitor, MonitorOff } from "lucide-react";
import { Tip } from "./Tip";
import { cn } from "../../lib/utils";

interface ScreenToggleProps {
  on: boolean;
  onChange: (on: boolean) => void;
  className?: string;
}

/** Whether the next answer includes a screenshot of the active window. */
export const ScreenToggle: React.FC<ScreenToggleProps> = ({ on, onChange, className }) => (
  <Tip label={on ? "Don't include screen" : "Include screen"}>
    <button
      type="button"
      aria-label="Include screen"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cn("sk-icon-btn", on && "text-sk-accent", className)}
    >
      {on ? (
        <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <MonitorOff className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </button>
  </Tip>
);
