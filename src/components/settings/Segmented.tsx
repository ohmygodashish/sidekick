import React, { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SegmentedProps<T extends string> {
  labelledBy: string;
  options: { id: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (id: T) => void;
  /** Container background; the thumb sits on top of it */
  className?: string;
}

/**
 * A radiogroup of buttons. Arrow keys move the selection and the focus together.
 * The selection thumb slides between segments; transform only, and it jumps under reduced motion.
 */
export function Segmented<T extends string>({
  labelledBy,
  options,
  value,
  onChange,
  className = "bg-sk-fill-2",
}: SegmentedProps<T>) {
  const buttons = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});

  const onKeyDown = (e: React.KeyboardEvent) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = options.findIndex((o) => o.id === value);
    const next = options[(index + step + options.length) % options.length].id;
    onChange(next);
    buttons.current[next]?.focus();
  };

  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const n = options.length;

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className={cn("relative grid gap-1 rounded-lg p-1", className)}
      style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
    >
      {/* p-1 = 0.25rem inset, gap-1 = 0.25rem: the thumb is one column wide and steps by column + gap */}
      <span
        aria-hidden="true"
        className="sk-thumb absolute bottom-1 left-1 top-1 rounded bg-sk-accent-tint transition-transform duration-200 motion-reduce:transition-none"
        style={{
          width: `calc((100% - 0.5rem - ${n - 1} * 0.25rem) / ${n})`,
          transform: `translateX(calc(${index} * (100% + 0.25rem)))`,
          transitionTimingFunction: "var(--sk-ease)",
        }}
      />
      {options.map(({ id, label, icon: Icon }) => {
        const selected = value === id;
        return (
          <button
            key={id}
            ref={(el) => {
              buttons.current[id] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            className={cn(
              "relative flex h-7 items-center justify-center gap-1.5 rounded text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sk-focus",
              selected ? "text-sk-fg" : "text-sk-fg-2 hover:bg-sk-hover"
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
