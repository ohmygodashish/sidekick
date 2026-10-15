import React, { useState, useEffect } from "react";
import {
  Sparkles,
  ChevronDown,
  ChevronUp,
  FileQuestion,
  AlertTriangle,
  MousePointer,
  Radio,
  Settings,
} from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import { LayoutSwitcher } from "./LayoutSwitcher";
import { ProgressiveCard } from "../cards/ProgressiveCard";
import { cn } from "../../lib/utils";

interface NotchCompanionProps {
  className?: string;
}

export const NotchCompanion: React.FC<NotchCompanionProps> = ({ className }) => {
  const {
    isPanicked,
    isClickThrough,
    triggerPanic,
    resetPanic,
    toggleClickThrough,
  } = useAppStore();

  const {
    activeQuestion,
    transcript,
    stage1Intuition,
    stage2Code,
    stage3Analysis,
  } = useSessionStore();

  const toggleSettings = useSettingsStore((s) => s.toggleSettings);

  const [isHovered, setIsHovered] = useState(false);
  // Manual override: null = auto (hover or activeQuestion), true = explicitly opened, false = explicitly closed
  const [manualOverride, setManualOverride] = useState<boolean | null>(null);

  // When a new question is detected, reset manual override to auto-expand
  const activeQuestionId = activeQuestion?.questionId;
  useEffect(() => {
    setManualOverride(null);
  }, [activeQuestionId]);

  // Determine expansion: explicit manual override takes top precedence
  const isExpanded =
    manualOverride !== null
      ? manualOverride
      : isHovered || Boolean(activeQuestion);

  const toggleManualExpansion = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setManualOverride((prev) => {
      const currentlyExpanded =
        prev !== null ? prev : isHovered || Boolean(activeQuestion);
      return !currentlyExpanded;
    });
  };

  // Determine current active speaker from transcript
  const lastTurn = transcript.length > 0 ? transcript[transcript.length - 1] : null;
  const speakerLabel = lastTurn
    ? lastTurn.speaker === "interviewer"
      ? "Interviewer"
      : "Candidate"
    : "Listening";

  return (
    <div
      data-testid="notch-companion"
      role="region"
      aria-label="Dynamic Notch Companion"
      aria-expanded={isExpanded}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={cn(
        // Centered horizontally within 400px focal span directly below camera (GUD-001, REQ-006)
        "relative flex flex-col w-[380px] sm:w-[390px] max-w-[400px] mx-auto rounded-b-2xl rounded-t-lg",
        "border border-zinc-800/80 border-t-0 bg-zinc-950/90 shadow-2xl backdrop-blur-md",
        "overflow-hidden select-none text-zinc-100 transition-all duration-300 ease-out isolate ring-1 ring-white/5",
        isExpanded ? "max-h-[540px]" : "h-[42px] min-h-[42px]",
        className
      )}
    >
      {/* Top Notch Tab Anchor Bar - Pinned horizontally under MacBook notch */}
      <div
        data-tauri-drag-region
        data-testid="notch-bar"
        className="flex items-center justify-between h-[42px] px-3 bg-zinc-900/50 cursor-grab active:cursor-grabbing border-b border-zinc-800/60"
      >
        {/* Left: Speaking indicator & Waveform */}
        <div className="flex items-center gap-2 pointer-events-none min-w-0 shrink-0">
          {/* Animated 5-bar Waveform */}
          <div
            data-testid="notch-waveform"
            className="flex items-center gap-[2px] h-4 w-5 justify-center"
            title="Live Audio Stream Waveform"
          >
            <span
              className={cn(
                "w-[2.5px] rounded-full transition-colors",
                activeQuestion ? "bg-emerald-400" : "bg-sky-400",
                "animate-waveform-1 motion-reduce:animate-none motion-reduce:h-2"
              )}
            />
            <span
              className={cn(
                "w-[2.5px] rounded-full transition-colors",
                activeQuestion ? "bg-emerald-400" : "bg-sky-400",
                "animate-waveform-2 motion-reduce:animate-none motion-reduce:h-3"
              )}
            />
            <span
              className={cn(
                "w-[2.5px] rounded-full transition-colors",
                activeQuestion ? "bg-emerald-400" : "bg-sky-400",
                "animate-waveform-3 motion-reduce:animate-none motion-reduce:h-4"
              )}
            />
            <span
              className={cn(
                "w-[2.5px] rounded-full transition-colors",
                activeQuestion ? "bg-emerald-400" : "bg-sky-400",
                "animate-waveform-4 motion-reduce:animate-none motion-reduce:h-2"
              )}
            />
            <span
              className={cn(
                "w-[2.5px] rounded-full transition-colors",
                activeQuestion ? "bg-emerald-400" : "bg-sky-400",
                "animate-waveform-5 motion-reduce:animate-none motion-reduce:h-3"
              )}
            />
          </div>

          {/* Speaker / Invisibility badge */}
          <div className="flex items-center gap-1">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isPanicked
                  ? "bg-red-400 animate-ping"
                  : activeQuestion
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-sky-400"
              )}
            />
            <span className="text-[10px] font-medium tracking-tight text-zinc-300">
              {speakerLabel}
            </span>
          </div>
        </div>

        {/* Center: Extracted Question Headline or Idle Eye Contact Indicator */}
        <div className="flex-1 px-2 text-center min-w-0 pointer-events-none">
          {activeQuestion ? (
            <p
              data-testid="notch-headline"
              className="text-[11px] font-medium text-emerald-300 truncate tracking-tight"
            >
              {activeQuestion.extractedQuestion}
            </p>
          ) : (
            <div className="flex items-center justify-center gap-1 text-[10px] text-zinc-400">
              <Radio className="h-2.5 w-2.5 text-sky-400 animate-pulse" />
              <span className="truncate">Notch Copilot</span>
            </div>
          )}
        </div>

        {/* Right: Quick Controls & Expand Toggle */}
        <div
          className="flex items-center gap-1 shrink-0"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Layout Switcher (Switch to HUD) */}
          <LayoutSwitcher compact showHotkey={false} />

          {/* Settings Drawer Button */}
          <button
            type="button"
            data-testid="notch-settings-btn"
            onClick={() => toggleSettings()}
            title="Settings & Personalization (Cmd + ,)"
            aria-label="Open Settings"
            className="flex items-center justify-center h-6 w-6 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>

          {/* Expand/Collapse Toggle Button */}
          <button
            type="button"
            data-testid="notch-expand-btn"
            onClick={toggleManualExpansion}
            title={isExpanded ? "Collapse Notch Companion" : "Expand Notch Companion"}
            aria-label={isExpanded ? "Collapse Notch Companion" : "Expand Notch Companion"}
            className="flex items-center justify-center h-6 w-6 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded Content Drawer - Animates downwards */}
      {isExpanded && (
        <div
          data-testid="notch-expanded-content"
          className="flex-1 p-3 space-y-2.5 overflow-y-auto max-h-[480px] custom-scrollbar animate-in fade-in slide-in-from-top-1 duration-200"
        >
          {/* Panic State Alert */}
          {isPanicked && (
            <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-2.5 text-red-200 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                  <span>Panic Mode Active</span>
                </div>
                <button
                  type="button"
                  onClick={resetPanic}
                  className="px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 font-medium border border-red-500/30 transition-colors"
                >
                  Resume
                </button>
              </div>
            </div>
          )}

          {/* Active Detected Question Card */}
          {activeQuestion ? (
            <div
              data-testid="notch-question-card"
              className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-2.5 space-y-2"
            >
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                  <FileQuestion className="h-3 w-3" />
                  <span>Detected Question</span>
                </div>
                <span className="text-[10px] font-mono text-zinc-500">
                  {(activeQuestion.confidence * 100).toFixed(0)}% Match
                </span>
              </div>
              <p className="text-xs font-medium text-zinc-100 leading-snug">
                {activeQuestion.extractedQuestion}
              </p>
              {activeQuestion.quickPointers.length > 0 && (
                <ul className="space-y-1 pt-1 border-t border-zinc-800/60 text-[11px] text-zinc-300">
                  {activeQuestion.quickPointers.map((ptr, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <span className="text-emerald-400 font-bold shrink-0">•</span>
                      <span>{ptr}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            /* Idle Notch State Info */
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-2.5 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-zinc-300">
                <Sparkles className="h-3 w-3 text-amber-400" />
                <span>Webcam Eye Contact Mode</span>
              </div>
              <p className="text-[11px] text-zinc-400 leading-relaxed">
                Positioned directly beneath your camera lens. Glancing at live hints keeps your gaze naturally locked with the interviewer.
              </p>
            </div>
          )}

          {/* Progressive Solution Stages (REQ-015, AC-006) */}
          {(stage1Intuition || stage2Code || stage3Analysis) && (
            <ProgressiveCard variant="compact" testIdPrefix="notch" />
          )}

          {/* Quick Toolbar */}
          <div className="flex items-center justify-between pt-1 border-t border-zinc-800/50 text-[10px] text-zinc-500">
            <button
              type="button"
              onClick={() => toggleClickThrough()}
              className={cn(
                "flex items-center gap-1 px-2 py-0.5 rounded border transition-colors",
                isClickThrough
                  ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                  : "bg-zinc-900/60 text-zinc-400 border-zinc-800/60 hover:text-zinc-200"
              )}
            >
              <MousePointer className="h-2.5 w-2.5" />
              <span>{isClickThrough ? "Click-Through" : "Clickable"}</span>
              <kbd className="font-mono text-[9px]">⌘⇧C</kbd>
            </button>

            <button
              type="button"
              data-testid="notch-toolbar-settings-btn"
              onClick={() => toggleSettings()}
              className="flex items-center gap-1 px-2 py-0.5 rounded border bg-zinc-900/60 text-zinc-400 border-zinc-800/60 hover:text-zinc-200 transition-colors"
            >
              <Settings className="h-2.5 w-2.5" />
              <span>Settings</span>
              <kbd className="font-mono text-[9px]">⌘,</kbd>
            </button>

            <button
              type="button"
              onClick={() => triggerPanic()}
              className="flex items-center gap-1 px-2 py-0.5 rounded border bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              <AlertTriangle className="h-2.5 w-2.5" />
              <span>Panic</span>
              <kbd className="font-mono text-[9px]">⌘Esc</kbd>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
