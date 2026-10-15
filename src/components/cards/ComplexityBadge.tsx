import React from "react";
import { Clock, Cpu } from "lucide-react";
import { cn } from "../../lib/utils";

export interface ComplexityBadgeProps {
  type?: "time" | "space" | "both";
  timeComplexity?: string;
  spaceComplexity?: string;
  complexity?: string;
  className?: string;
  compact?: boolean;
}

export const ComplexityBadge: React.FC<ComplexityBadgeProps> = ({
  type = "both",
  timeComplexity,
  spaceComplexity,
  complexity,
  className,
  compact = false,
}) => {
  // If specific type is requested (single badge mode)
  if (type === "time") {
    const val = complexity || timeComplexity;
    if (!val) return null;
    return (
      <span
        data-testid="complexity-badge-time"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border font-mono font-medium",
          "bg-amber-500/10 border-amber-500/25 text-amber-300",
          compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
          className
        )}
      >
        <Clock className={compact ? "h-3 w-3 text-amber-400" : "h-3.5 w-3.5 text-amber-400"} />
        <span>Time: {val}</span>
      </span>
    );
  }

  if (type === "space") {
    const val = complexity || spaceComplexity;
    if (!val) return null;
    return (
      <span
        data-testid="complexity-badge-space"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border font-mono font-medium",
          "bg-purple-500/10 border-purple-500/25 text-purple-300",
          compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs",
          className
        )}
      >
        <Cpu className={compact ? "h-3 w-3 text-purple-400" : "h-3.5 w-3.5 text-purple-400"} />
        <span>Space: {val}</span>
      </span>
    );
  }

  // Dual/combined badge mode
  const tVal = timeComplexity;
  const sVal = spaceComplexity;

  if (!tVal && !sVal) return null;

  return (
    <div
      data-testid="complexity-badges"
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {tVal && (
        <span
          data-testid="complexity-badge-time"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border font-mono font-medium",
            "bg-amber-500/10 border-amber-500/25 text-amber-300",
            compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
          )}
        >
          <Clock className={compact ? "h-3 w-3 text-amber-400" : "h-3.5 w-3.5 text-amber-400"} />
          <span>Time: {tVal}</span>
        </span>
      )}
      {sVal && (
        <span
          data-testid="complexity-badge-space"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border font-mono font-medium",
            "bg-purple-500/10 border-purple-500/25 text-purple-300",
            compact ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
          )}
        >
          <Cpu className={compact ? "h-3 w-3 text-purple-400" : "h-3.5 w-3.5 text-purple-400"} />
          <span>Space: {sVal}</span>
        </span>
      )}
    </div>
  );
};
