import React from "react";
import { Eye } from "lucide-react";
import { useAppStore } from "../../store/appStore";

interface OpacityControlProps {
  className?: string;
  compact?: boolean;
}

export const OpacityControl: React.FC<OpacityControlProps> = ({
  className = "",
  compact = false,
}) => {
  const opacity = useAppStore((state) => state.opacity);
  const setOpacity = useAppStore((state) => state.setOpacity);

  const percentage = Math.round(opacity * 100);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val)) {
      setOpacity(val);
    }
  };

  return (
    <div
      className={`flex items-center gap-2 rounded-lg bg-zinc-900/60 px-2.5 py-1.5 border border-zinc-800/50 backdrop-blur-sm text-zinc-300 transition-colors hover:border-zinc-700/60 ${className}`}
      onMouseDown={(e) => e.stopPropagation()}
      data-testid="opacity-control"
    >
      <Eye className="h-3.5 w-3.5 text-zinc-400 shrink-0" aria-hidden="true" />

      {!compact && (
        <label
          htmlFor="opacity-slider"
          className="text-[11px] font-medium text-zinc-400 select-none hidden sm:inline"
        >
          Alpha
        </label>
      )}

      <input
        id="opacity-slider"
        type="range"
        min={0.15}
        max={1.0}
        step={0.01}
        value={opacity}
        onChange={handleChange}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-16 sm:w-20 h-1.5 rounded-lg appearance-none cursor-pointer bg-zinc-800 accent-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400/50 transition-all"
        aria-label="Window Opacity"
        aria-valuemin={15}
        aria-valuemax={100}
        aria-valuenow={percentage}
        aria-valuetext={`${percentage}%`}
      />

      <span
        className="font-mono text-[11px] text-zinc-400 min-w-[30px] text-right select-none"
        aria-hidden="true"
      >
        {percentage}%
      </span>
    </div>
  );
};
