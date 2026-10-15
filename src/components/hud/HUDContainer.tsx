import React from "react";
import {
  Shield,
  ShieldAlert,
  MousePointer,
  Sparkles,
  AlertTriangle,
  Radio,
  FileQuestion,
  Cpu,
} from "lucide-react";
import { useAppStore } from "../../store/appStore";
import { useSessionStore } from "../../store/sessionStore";
import { useSettingsStore } from "../../store/settingsStore";
import { OpacityControl } from "./OpacityControl";
import { LayoutSwitcher } from "./LayoutSwitcher";
import { ProgressiveCard } from "../cards/ProgressiveCard";
import { cn } from "../../lib/utils";

interface HUDContainerProps {
  children?: React.ReactNode;
  className?: string;
}

export const HUDContainer: React.FC<HUDContainerProps> = ({
  children,
  className,
}) => {
  const {
    layoutMode,
    isClickThrough,
    isPanicked,
    toggleClickThrough,
    triggerPanic,
    resetPanic,
  } = useAppStore();

  const {
    activeQuestion,
    stage1Intuition,
    stage2Code,
    stage3Analysis,
  } = useSessionStore();

  const { sttMode, selectedModel } = useSettingsStore();

  const isNotchMode = layoutMode === "dynamic_notch";

  return (
    <div
      data-testid="hud-container"
      className={cn(
        "relative flex flex-col w-full max-w-2xl mx-auto rounded-2xl border border-zinc-800/60 bg-zinc-950/80 shadow-2xl backdrop-blur-md overflow-hidden select-none text-zinc-100 transition-all duration-300 isolate",
        isNotchMode && "ring-1 ring-sky-500/20",
        className
      )}
    >
      {/* Draggable Header Bar */}
      <header
        data-tauri-drag-region
        data-testid="hud-header"
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b border-zinc-800/60 bg-zinc-900/40 cursor-grab active:cursor-grabbing select-none"
      >
        {/* Left: Branding & Invisibility Indicator */}
        <div className="flex items-center gap-2.5 pointer-events-none">
          <div
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors",
              isPanicked
                ? "bg-red-500/10 border-red-500/30 text-red-400"
                : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
            )}
          >
            {isPanicked ? (
              <ShieldAlert className="h-4 w-4 animate-bounce" />
            ) : (
              <Shield className="h-4 w-4" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold tracking-wide text-zinc-100">
                Sidekick
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border",
                  isPanicked
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    isPanicked ? "bg-red-400 animate-ping" : "bg-emerald-400 animate-pulse"
                  )}
                />
                {isPanicked ? "Panicked" : "Invisible"}
              </span>
            </div>
          </div>
        </div>

        {/* Center/Right: Quick Interactive Controls */}
        <div
          className="flex items-center gap-2"
          onMouseDown={(e) => e.stopPropagation()}
        >
          {/* Opacity Control */}
          <OpacityControl compact />

          {/* Click-Through Toggle Badge */}
          <button
            type="button"
            onClick={() => toggleClickThrough()}
            title="Toggle Mouse Click-Through (Cmd + Shift + C)"
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors",
              isClickThrough
                ? "bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-sm"
                : "bg-zinc-900/60 text-zinc-400 border-zinc-800/60 hover:text-zinc-200 hover:border-zinc-700/60"
            )}
          >
            <MousePointer className="h-3 w-3" />
            <span className="hidden sm:inline">
              {isClickThrough ? "Click-Through" : "Interactive"}
            </span>
            <kbd className="hidden md:inline rounded bg-zinc-800/80 px-1 py-0.2 text-[9px] font-mono text-zinc-400 border border-zinc-700/40">
              ⌘⇧C
            </kbd>
          </button>

          {/* Layout Mode Switcher */}
          <LayoutSwitcher />

          {/* Panic Key Killswitch Button */}
          <button
            type="button"
            onClick={() => triggerPanic()}
            title="Instant Panic Killswitch: Synchronously hides overlay and flushes buffers (Cmd + Esc)"
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 hover:border-red-500/40 transition-colors"
          >
            <AlertTriangle className="h-3 w-3" />
            <span className="hidden sm:inline">Panic</span>
            <kbd className="rounded bg-red-950/60 px-1 py-0.2 text-[9px] font-mono text-red-300 border border-red-800/40">
              ⌘Esc
            </kbd>
          </button>
        </div>
      </header>

      {/* Main Shell Content Area */}
      <main className="p-4 space-y-3 overflow-y-auto max-h-[calc(100vh-120px)] custom-scrollbar">
        {/* Panic Alert Banner if engaged */}
        {isPanicked && (
          <div className="rounded-xl border border-red-500/30 bg-red-950/30 p-3.5 text-red-200 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                <span className="text-xs font-semibold">
                  Panic Mode Engaged — Streams Aborted & Buffers Flushed
                </span>
              </div>
              <button
                type="button"
                onClick={resetPanic}
                className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 font-medium border border-red-500/30 transition-colors"
              >
                Resume Copilot
              </button>
            </div>
            <p className="mt-1 text-[11px] text-red-300/80 leading-relaxed">
              The window was instantaneously hidden from the display server. Press{" "}
              <kbd className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-zinc-300 border border-zinc-700/50">
                Cmd + Shift + Space
              </kbd>{" "}
              to summon Sidekick back.
            </p>
          </div>
        )}

        {/* Dynamic Notch Mode Companion Hint */}
        {isNotchMode && !isPanicked && (
          <div className="rounded-xl border border-sky-500/25 bg-sky-950/20 p-2.5 text-xs text-sky-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Radio className="h-3.5 w-3.5 text-sky-400 animate-pulse" />
              <span>
                Dynamic Notch Companion active — docked beneath MacBook camera
              </span>
            </div>
            <span className="text-[10px] text-sky-400 font-mono">
              Webcam Eye Contact Mode
            </span>
          </div>
        )}

        {/* If child components (Notch, Solution, etc.) are provided, render them */}
        {children ? (
          children
        ) : (
          /* Default Shell Content: Live question, progressive preview, or stealth status */
          <div className="space-y-3">
            {/* Active Detected Question (Spec §4.2) */}
            {activeQuestion ? (
              <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                    <FileQuestion className="h-3.5 w-3.5" />
                    <span>Live Detected Question</span>
                  </div>
                  <span className="text-[10px] font-mono text-zinc-500">
                    Confidence: {(activeQuestion.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <p className="text-sm font-medium text-zinc-100 leading-snug">
                  {activeQuestion.extractedQuestion}
                </p>
                {activeQuestion.quickPointers.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                    {activeQuestion.quickPointers.map((ptr, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-emerald-400 font-bold">•</span>
                        <span>{ptr}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              /* Idle Stealth Copilot Status Card */
              <section className="rounded-xl border border-zinc-800/60 bg-zinc-900/40 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                    <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                    <span>Stealth Copilot Ready</span>
                  </div>
                  <span className="text-[10px] text-zinc-500 font-mono">
                    Model: {selectedModel.split("/").pop()}
                  </span>
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Awaiting live interviewer speech. System audio is captured silently
                  via ScreenCaptureKit and processed with offline Metal STT.
                </p>

                {/* Subsystem Badges */}
                <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                  <div className="flex items-center gap-2 rounded-lg bg-zinc-950/40 px-2.5 py-1.5 border border-zinc-800/40 text-zinc-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span className="text-[11px]">NSWindowSharingNone</span>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-zinc-950/40 px-2.5 py-1.5 border border-zinc-800/40 text-zinc-300">
                    <Cpu className="h-3 w-3 text-sky-400" />
                    <span className="text-[11px] capitalize">STT: {sttMode.replace("_", " ")}</span>
                  </div>
                </div>
              </section>
            )}

            {/* Progressive Disclosure Solution Engine (REQ-015, AC-006) */}
            {(stage1Intuition || stage2Code || stage3Analysis) && (
              <ProgressiveCard />
            )}
          </div>
        )}
      </main>

      {/* Footer Hotkey Guide */}
      <footer className="px-4 py-2 border-t border-zinc-800/60 bg-zinc-950/60 flex items-center justify-between text-[10px] text-zinc-500">
        <div className="flex items-center gap-3">
          <span>
            Summon: <kbd className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-400 border border-zinc-800">⌘⇧Space</kbd>
          </span>
          <span>
            Pass-Through: <kbd className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-400 border border-zinc-800">⌘⇧C</kbd>
          </span>
          <span>
            Layout: <kbd className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-400 border border-zinc-800">⌘⇧M</kbd>
          </span>
        </div>
        <div>
          Killswitch: <kbd className="rounded bg-red-950/50 px-1 py-0.5 text-red-400 border border-red-900/40">⌘Esc</kbd>
        </div>
      </footer>
    </div>
  );
};
