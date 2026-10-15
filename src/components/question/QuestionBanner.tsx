import React from "react";
import { Sparkles, FileQuestion, X } from "lucide-react";
import { useSessionStore, DetectedQuestion } from "../../store/sessionStore";
import { safeEmit } from "../../lib/ipc";
import { cn } from "../../lib/utils";

export interface QuestionBannerProps {
  question?: DetectedQuestion | null;
  variant?: "hud" | "notch";
  onDeepSolve?: (question: DetectedQuestion) => void;
  onDismiss?: () => void;
  className?: string;
  testId?: string;
}

export const QuestionBanner: React.FC<QuestionBannerProps> = ({
  question: propQuestion,
  variant = "hud",
  onDeepSolve,
  onDismiss,
  className,
  testId,
}) => {
  const storeQuestion = useSessionStore((s) => s.activeQuestion);
  const activeQuestion = propQuestion !== undefined ? propQuestion : storeQuestion;

  if (!activeQuestion) return null;

  const isNotch = variant === "notch";

  const handleDeepSolve = () => {
    onDeepSolve?.(activeQuestion);

    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("sidekick:deep_solve", {
          detail: activeQuestion,
        })
      );
    }

    safeEmit("sidekick://deep_solve_triggered", activeQuestion).catch(() => {});
  };

  const handleDismiss = () => {
    if (onDismiss) {
      onDismiss();
    } else {
      useSessionStore.getState().setActiveQuestion(null);
    }
  };

  const confidencePercent = (activeQuestion.confidence * 100).toFixed(0);

  return (
    <section
      role="region"
      aria-label="Live Detected Question"
      data-testid={testId || (isNotch ? "notch-question-card" : "question-banner")}
      className={cn(
        "rounded-xl border border-zinc-800/80 bg-zinc-900/60 shadow-lg backdrop-blur-sm transition-all duration-200 select-none",
        isNotch ? "p-2.5 space-y-2" : "p-3.5 space-y-2.5",
        className
      )}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-emerald-400 font-semibold text-xs min-w-0">
          <FileQuestion className={cn(isNotch ? "h-3 w-3" : "h-3.5 w-3.5", "shrink-0")} />
          <span className="truncate">
            {isNotch ? "Detected Question" : "Live Detected Question"}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            data-testid="question-confidence"
            className="text-[10px] font-mono text-zinc-400 bg-zinc-800/40 px-1.5 py-0.5 rounded border border-zinc-700/30"
          >
            {isNotch ? `${confidencePercent}% Match` : `Confidence: ${confidencePercent}%`}
          </span>

          <button
            type="button"
            data-testid="dismiss-question-btn"
            onClick={handleDismiss}
            title="Dismiss Question"
            aria-label="Dismiss Question"
            className="text-zinc-500 hover:text-zinc-300 p-0.5 rounded transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Extracted Core Question */}
      <p
        data-testid="question-text"
        className={cn(
          "font-medium text-zinc-100 leading-snug",
          isNotch ? "text-xs" : "text-sm"
        )}
      >
        {activeQuestion.extractedQuestion}
      </p>

      {/* Quick Pointers (3-4 bullet points) */}
      {activeQuestion.quickPointers.length > 0 && (
        <ul
          data-testid="question-pointers"
          className={cn(
            "space-y-1 text-zinc-300",
            isNotch ? "pt-1 border-t border-zinc-800/60 text-[11px]" : "mt-2 text-xs"
          )}
        >
          {activeQuestion.quickPointers.map((pointer, idx) => (
            <li key={idx} className="flex items-start gap-1.5">
              <span className="text-emerald-400 font-bold shrink-0">•</span>
              <span className="leading-tight">{pointer}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Action Footer: Deep Solve (Enter) Pill (REQ-012) */}
      <div
        className={cn(
          "flex items-center justify-between pt-1",
          !isNotch && "border-t border-zinc-800/60"
        )}
      >
        <button
          type="button"
          data-testid="deep-solve-btn"
          onClick={handleDeepSolve}
          title="Dispatch to Deep Intelligence Engine (Enter or Cmd+Enter)"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg font-semibold transition-all duration-150 active:scale-95 cursor-pointer shadow-sm",
            "bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 hover:border-emerald-500/50",
            isNotch ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs"
          )}
        >
          <Sparkles
            className={cn(
              isNotch ? "h-3 w-3" : "h-3.5 w-3.5",
              "text-emerald-400 shrink-0"
            )}
          />
          <span>Deep Solve (Enter)</span>
        </button>

        <span className="text-[10px] text-zinc-500 font-mono hidden sm:inline">
          ⌘↵
        </span>
      </div>
    </section>
  );
};
