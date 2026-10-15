import React, { useState, useEffect } from "react";
import { Lightbulb, Code2, Cpu, ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useSessionStore, ProgressiveSolution } from "../../store/sessionStore";
import { CodeBlock } from "./CodeBlock";
import { ComplexityBadge } from "./ComplexityBadge";
import { cn } from "../../lib/utils";

export interface ProgressiveCardProps {
  solution?: ProgressiveSolution | null;
  variant?: "default" | "compact";
  testIdPrefix?: string;
  className?: string;
  enableHotkeys?: boolean;
  initialExpandedStages?: { 1?: boolean; 2?: boolean; 3?: boolean };
  streamingStage?: 1 | 2 | 3 | null;
}

export const ProgressiveCard: React.FC<ProgressiveCardProps> = ({
  solution: propSolution,
  variant = "default",
  testIdPrefix = "progressive",
  className,
  enableHotkeys = true,
  initialExpandedStages,
  streamingStage = null,
}) => {
  // Read session store progressive solution or individual stages
  const storeProgressiveSolution = useSessionStore((s) => s.progressiveSolution);
  const storeStage1 = useSessionStore((s) => s.stage1Intuition);
  const storeStage2 = useSessionStore((s) => s.stage2Code);
  const storeStage3 = useSessionStore((s) => s.stage3Analysis);

  // Active solution resolution: prop overrides store
  const stage1 = propSolution !== undefined ? propSolution?.stage1Intuition : (storeProgressiveSolution?.stage1Intuition ?? storeStage1);
  const stage2 = propSolution !== undefined ? propSolution?.stage2Code : (storeProgressiveSolution?.stage2Code ?? storeStage2);
  const stage3 = propSolution !== undefined ? propSolution?.stage3Analysis : (storeProgressiveSolution?.stage3Analysis ?? storeStage3);

  // Collapsible tier open states (default to expanded)
  const [stage1Open, setStage1Open] = useState(
    initialExpandedStages?.["1"] ?? true
  );
  const [stage2Open, setStage2Open] = useState(
    initialExpandedStages?.["2"] ?? true
  );
  const [stage3Open, setStage3Open] = useState(
    initialExpandedStages?.["3"] ?? true
  );

  // Global keyboard shortcuts for '1', '2', '3' keys
  useEffect(() => {
    if (!enableHotkeys) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in form inputs
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      // Do not intercept if Cmd, Ctrl, or Alt modifiers are active
      if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      }

      if (e.key === "1") {
        setStage1Open((prev) => !prev);
      } else if (e.key === "2") {
        setStage2Open((prev) => !prev);
      } else if (e.key === "3") {
        setStage3Open((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enableHotkeys]);

  // If no stages are available and not streaming, return null
  const hasContent = Boolean(stage1 || stage2 || stage3 || streamingStage);
  if (!hasContent) {
    return null;
  }

  const isCompact = variant === "compact";

  // Tier Titles
  const stage1Title = isCompact ? "Intuition & Tradeoffs" : "Stage 1: Intuition & Tradeoffs";
  const stage2Title = isCompact
    ? "Code Solution"
    : stage2?.language
      ? `Stage 2: Code (${stage2.language})`
      : "Stage 2: Code";
  const stage3Title = isCompact ? "Complexity & Edge Cases" : "Stage 3: Complexity & Edge Cases";

  return (
    <div
      data-testid="progressive-card"
      className={cn("space-y-2.5 w-full text-zinc-100", className)}
    >
      {/* ── STAGE 1: INTUITION & TRADEOFFS ── */}
      {(stage1 || streamingStage === 1) && (
        <section
          data-testid={`${testIdPrefix}-stage1-card`}
          className={cn(
            "rounded-xl border transition-all duration-200 overflow-hidden",
            "border-emerald-500/25 bg-emerald-950/20 backdrop-blur-sm"
          )}
        >
          {/* Stage 1 Accordion Header */}
          <button
            type="button"
            data-testid={`${testIdPrefix}-stage1-toggle`}
            onClick={() => setStage1Open((prev) => !prev)}
            aria-expanded={stage1Open}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2 text-left select-none transition-colors",
              "hover:bg-emerald-500/10"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/20 text-emerald-400 shrink-0">
                <Lightbulb className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold text-emerald-300 truncate">
                {stage1Title}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <kbd className="hidden sm:inline rounded bg-emerald-950/60 px-1.5 py-0.5 text-[9px] font-mono text-emerald-400 border border-emerald-800/40">
                1
              </kbd>
              {stage1Open ? (
                <ChevronUp className="h-3.5 w-3.5 text-emerald-400/80" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-emerald-400/80" />
              )}
            </div>
          </button>

          {/* Stage 1 Collapsible Content Drawer */}
          {stage1Open && (
            <div
              data-testid={`${testIdPrefix}-stage1-content`}
              className="px-3 pb-3 pt-1 space-y-2 text-xs border-t border-emerald-500/15 animate-in fade-in duration-150"
            >
              {stage1 ? (
                <>
                  <p className="text-zinc-200 leading-relaxed font-normal">
                    {stage1.verbalSummary}
                  </p>

                  {stage1.keyTradeoffs && stage1.keyTradeoffs.length > 0 && (
                    <div className="space-y-1 pt-1.5 border-t border-emerald-500/10">
                      <span className="text-[10px] font-semibold text-emerald-400/90 uppercase tracking-wider">
                        Key Trade-offs
                      </span>
                      <ul className="space-y-1 text-[11px] text-zinc-300">
                        {stage1.keyTradeoffs.map((item, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <span className="text-emerald-400 font-bold shrink-0">›</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                /* Streaming indicator for Stage 1 */
                <div className="flex items-center gap-2 text-zinc-400 text-xs py-1">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-400 animate-spin" />
                  <span>Synthesizing intuition & algorithm selection...</span>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── STAGE 2: PRODUCTION CODE ── */}
      {(stage2 || streamingStage === 2) && (
        <section
          data-testid={`${testIdPrefix}-stage2-card`}
          className={cn(
            "rounded-xl border transition-all duration-200 overflow-hidden",
            "border-sky-500/25 bg-sky-950/20 backdrop-blur-sm"
          )}
        >
          {/* Stage 2 Accordion Header */}
          <button
            type="button"
            data-testid={`${testIdPrefix}-stage2-toggle`}
            onClick={() => setStage2Open((prev) => !prev)}
            aria-expanded={stage2Open}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2 text-left select-none transition-colors",
              "hover:bg-sky-500/10"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-sky-500/20 text-sky-400 shrink-0">
                <Code2 className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold text-sky-300 truncate">
                {stage2Title}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <kbd className="hidden sm:inline rounded bg-sky-950/60 px-1.5 py-0.5 text-[9px] font-mono text-sky-400 border border-sky-800/40">
                2
              </kbd>
              {stage2Open ? (
                <ChevronUp className="h-3.5 w-3.5 text-sky-400/80" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-sky-400/80" />
              )}
            </div>
          </button>

          {/* Stage 2 Collapsible Content Drawer */}
          {stage2Open && (
            <div
              data-testid={`${testIdPrefix}-stage2-content`}
              className="px-3 pb-3 pt-1 space-y-2 text-xs border-t border-sky-500/15 animate-in fade-in duration-150"
            >
              {stage2 ? (
                <>
                  {stage2.explanation && (
                    <p className="text-[11px] text-zinc-300 leading-relaxed">
                      {stage2.explanation}
                    </p>
                  )}
                  <CodeBlock
                    code={stage2.code}
                    language={stage2.language}
                    maxHeight={isCompact ? "260px" : "360px"}
                  />
                </>
              ) : (
                /* Streaming indicator for Stage 2 */
                <div className="flex items-center gap-2 text-zinc-400 text-xs py-1">
                  <Sparkles className="h-3.5 w-3.5 text-sky-400 animate-spin" />
                  <span>Synthesizing production code solution...</span>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── STAGE 3: COMPLEXITY & EDGE CASES ── */}
      {(stage3 || streamingStage === 3) && (
        <section
          data-testid={`${testIdPrefix}-stage3-card`}
          className={cn(
            "rounded-xl border transition-all duration-200 overflow-hidden",
            "border-purple-500/25 bg-purple-950/20 backdrop-blur-sm"
          )}
        >
          {/* Stage 3 Accordion Header */}
          <button
            type="button"
            data-testid={`${testIdPrefix}-stage3-toggle`}
            onClick={() => setStage3Open((prev) => !prev)}
            aria-expanded={stage3Open}
            className={cn(
              "w-full flex items-center justify-between px-3 py-2 text-left select-none transition-colors",
              "hover:bg-purple-500/10"
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-purple-500/20 text-purple-400 shrink-0">
                <Cpu className="h-3.5 w-3.5" />
              </span>
              <span className="text-xs font-semibold text-purple-300 truncate">
                {stage3Title}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 ml-2">
              <kbd className="hidden sm:inline rounded bg-purple-950/60 px-1.5 py-0.5 text-[9px] font-mono text-purple-400 border border-purple-800/40">
                3
              </kbd>
              {stage3Open ? (
                <ChevronUp className="h-3.5 w-3.5 text-purple-400/80" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-purple-400/80" />
              )}
            </div>
          </button>

          {/* Stage 3 Collapsible Content Drawer */}
          {stage3Open && (
            <div
              data-testid={`${testIdPrefix}-stage3-content`}
              className="px-3 pb-3 pt-1 space-y-2 text-xs border-t border-purple-500/15 animate-in fade-in duration-150"
            >
              {stage3 ? (
                <>
                  <ComplexityBadge
                    timeComplexity={stage3.timeComplexity}
                    spaceComplexity={stage3.spaceComplexity}
                    compact={isCompact}
                  />

                  {stage3.edgeCases && stage3.edgeCases.length > 0 && (
                    <div className="space-y-1 pt-1.5 border-t border-purple-500/15">
                      <span className="text-[10px] font-semibold text-purple-400/90 uppercase tracking-wider">
                        Critical Edge Cases
                      </span>
                      <ul className="space-y-1 text-[11px] text-zinc-300">
                        {stage3.edgeCases.map((ec, idx) => (
                          <li key={idx} className="flex items-start gap-1.5">
                            <span className="text-purple-400 font-bold shrink-0">›</span>
                            <span>{ec}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              ) : (
                /* Streaming indicator for Stage 3 */
                <div className="flex items-center gap-2 text-zinc-400 text-xs py-1">
                  <Sparkles className="h-3.5 w-3.5 text-purple-400 animate-spin" />
                  <span>Evaluating Big-O complexity & boundary conditions...</span>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
};
