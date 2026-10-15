import React, { useState, useEffect } from "react";
import {
  X,
  Key,
  User,
  Mic,
  AlertTriangle,
  Flame,
  RotateCcw,
  CheckCircle2,
  Shield,
  Radio,
  Cpu,
} from "lucide-react";
import { useSettingsStore } from "../../store/settingsStore";
import { useSessionStore } from "../../store/sessionStore";
import { safeInvoke } from "../../lib/ipc";
import { ApiKeyInputs } from "./ApiKeyInputs";
import { ProfileEditor } from "./ProfileEditor";
import { cn } from "../../lib/utils";

export type SettingsTab = "keys" | "profile" | "audio" | "danger";

interface SettingsDrawerProps {
  isOpen?: boolean;
  onClose?: () => void;
  defaultTab?: SettingsTab;
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen: propsIsOpen,
  onClose: propsOnClose,
  defaultTab = "keys",
}) => {
  const storeIsOpen = useSettingsStore((s) => s.isSettingsOpen);
  const setIsSettingsOpen = useSettingsStore((s) => s.setIsSettingsOpen);
  const toggleSettings = useSettingsStore((s) => s.toggleSettings);
  const resetSettings = useSettingsStore((s) => s.resetSettings);
  const sttMode = useSettingsStore((s) => s.sttMode);
  const setSttMode = useSettingsStore((s) => s.setSttMode);

  const clearSession = useSessionStore((s) => s.clearSession);

  const isOpen = propsIsOpen !== undefined ? propsIsOpen : storeIsOpen;
  const handleClose = propsOnClose || (() => setIsSettingsOpen(false));

  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);
  const [burnFeedback, setBurnFeedback] = useState<string | null>(null);
  const [resetFeedback, setResetFeedback] = useState<string | null>(null);

  // Global hotkey: Cmd + , to toggle, Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault();
        toggleSettings();
      } else if (e.key === "Escape" && isOpen) {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, toggleSettings, handleClose]);

  // Burn Session Action (REQ-017)
  const handleBurnSession = async () => {
    // 1. Immediately wipe sessionStore (transcripts, solutions, detected questions)
    clearSession();

    // 2. Call backend Tauri IPC command
    await safeInvoke("burn_session");

    // 3. Show instant visual feedback
    setBurnFeedback(
      "Session Burned: Active transcripts, solutions, and memory buffers have been permanently eradicated."
    );
    setTimeout(() => setBurnFeedback(null), 4000);
  };

  // Reset Settings Action
  const handleResetSettings = () => {
    resetSettings();
    setResetFeedback("All settings restored to factory defaults.");
    setTimeout(() => setResetFeedback(null), 3000);
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      data-testid="settings-modal-root"
      className="fixed inset-0 z-50 flex justify-end select-none"
    >
      {/* Backdrop overlay */}
      <div
        data-testid="settings-backdrop"
        onClick={handleClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 animate-in fade-in"
      />

      {/* Sliding Sheet Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        data-testid="settings-drawer"
        className={cn(
          "relative z-10 w-full sm:w-[500px] h-full max-h-screen",
          "bg-zinc-950/95 border-l border-zinc-800/80 shadow-2xl backdrop-blur-xl",
          "flex flex-col text-zinc-100 overflow-hidden",
          "animate-in slide-in-from-right duration-300 ease-out"
        )}
      >
        {/* Drawer Header */}
        <header className="flex items-center justify-between px-5 py-4 border-b border-zinc-800/80 bg-zinc-900/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400">
              <Shield className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-zinc-100">
                Settings & Personalization
              </h2>
              <span className="text-[10px] text-zinc-400">
                Stealth Copilot Overlay Configuration
              </span>
            </div>
          </div>

          <button
            type="button"
            data-testid="close-settings-btn"
            onClick={handleClose}
            aria-label="Close Settings"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 border border-zinc-800/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        {/* Tab Navigation */}
        <nav
          aria-label="Settings Tabs"
          className="flex border-b border-zinc-800/80 bg-zinc-900/30 px-3 text-xs overflow-x-auto shrink-0"
        >
          <button
            type="button"
            data-testid="tab-keys"
            onClick={() => setActiveTab("keys")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "keys"
                ? "border-sky-500 text-sky-400 bg-sky-500/5"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            <Key className="h-3.5 w-3.5" />
            <span>API Keys & Models</span>
          </button>

          <button
            type="button"
            data-testid="tab-profile"
            onClick={() => setActiveTab("profile")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "profile"
                ? "border-sky-500 text-sky-400 bg-sky-500/5"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            <User className="h-3.5 w-3.5" />
            <span>Profile & Context</span>
          </button>

          <button
            type="button"
            data-testid="tab-audio"
            onClick={() => setActiveTab("audio")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "audio"
                ? "border-sky-500 text-sky-400 bg-sky-500/5"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            )}
          >
            <Mic className="h-3.5 w-3.5" />
            <span>Audio & STT</span>
          </button>

          <button
            type="button"
            data-testid="tab-danger"
            onClick={() => setActiveTab("danger")}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 font-medium border-b-2 transition-colors whitespace-nowrap",
              activeTab === "danger"
                ? "border-red-500 text-red-400 bg-red-500/5"
                : "border-transparent text-zinc-400 hover:text-red-300"
            )}
          >
            <Flame className="h-3.5 w-3.5" />
            <span>Danger Zone</span>
          </button>
        </nav>

        {/* Tab Content Body */}
        <main className="flex-1 p-5 overflow-y-auto custom-scrollbar">
          {/* Tab 1: API Keys & Models */}
          {activeTab === "keys" && <ApiKeyInputs />}

          {/* Tab 2: Profile & Personalization */}
          {activeTab === "profile" && <ProfileEditor />}

          {/* Tab 3: Audio & Speech-to-Text */}
          {activeTab === "audio" && (
            <div data-testid="audio-settings" className="space-y-6">
              <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-3.5 space-y-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
                  <Mic className="h-3.5 w-3.5 text-sky-400" />
                  <span>Audio & Transcription Engine Settings</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Choose between 100% offline Metal STT for ultimate confidentiality or cloud low-latency transcription.
                </p>
              </div>

              {/* STT Mode Selection */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-zinc-300">
                  Speech-to-Text (STT) Backend
                </h4>

                <div className="space-y-2.5">
                  {/* Embedded Whisper Local */}
                  <button
                    type="button"
                    data-testid="stt-whisper-local"
                    onClick={() => setSttMode("whisper_local")}
                    className={cn(
                      "w-full text-left rounded-xl border p-3.5 transition-all",
                      sttMode === "whisper_local"
                        ? "border-emerald-500/80 bg-emerald-950/20 text-emerald-100 shadow-sm"
                        : "border-zinc-800/80 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700/80"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Cpu className="h-4 w-4 text-emerald-400" />
                        <span className="text-xs font-semibold text-zinc-100">
                          Embedded Whisper (Local Metal)
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        100% Offline • Recommended
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Runs locally on Apple Silicon GPU/ANE using whisper.cpp Metal shaders. Zero audio bytes ever leave your device.
                    </p>
                  </button>

                  {/* Groq Whisper */}
                  <button
                    type="button"
                    data-testid="stt-groq"
                    onClick={() => setSttMode("groq")}
                    className={cn(
                      "w-full text-left rounded-xl border p-3.5 transition-all",
                      sttMode === "groq"
                        ? "border-sky-500/80 bg-sky-950/20 text-sky-100 shadow-sm"
                        : "border-zinc-800/80 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700/80"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Radio className="h-4 w-4 text-sky-400" />
                        <span className="text-xs font-semibold text-zinc-100">
                          Groq Whisper Cloud
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        Ultra-Fast (&lt;250ms)
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Batched chunk streaming sent to Groq LPU inference engines. Requires Groq API Key.
                    </p>
                  </button>

                  {/* Deepgram Nova-2 */}
                  <button
                    type="button"
                    data-testid="stt-deepgram"
                    onClick={() => setSttMode("deepgram")}
                    className={cn(
                      "w-full text-left rounded-xl border p-3.5 transition-all",
                      sttMode === "deepgram"
                        ? "border-purple-500/80 bg-purple-950/20 text-purple-100 shadow-sm"
                        : "border-zinc-800/80 bg-zinc-900/40 text-zinc-300 hover:border-zinc-700/80"
                    )}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <Mic className="h-4 w-4 text-purple-400" />
                        <span className="text-xs font-semibold text-zinc-100">
                          Deepgram Nova-2 Streaming
                        </span>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-purple-500/20 text-purple-300 border border-purple-500/30">
                        Real-time Diarization
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 leading-relaxed">
                      Continuous bi-directional WebSocket audio stream with high accuracy speaker diarization.
                    </p>
                  </button>
                </div>
              </div>

              {/* Driverless Audio Architecture Note */}
              <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-3.5 space-y-2">
                <span className="text-xs font-semibold text-zinc-300">
                  Driverless ScreenCaptureKit Loopback
                </span>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  System audio and interviewer speech are extracted via Apple ScreenCaptureKit zero-driver loopback. No BlackHole or virtual audio drivers are installed.
                </p>
              </section>
            </div>
          )}

          {/* Tab 4: Danger Zone */}
          {activeTab === "danger" && (
            <div data-testid="danger-zone" className="space-y-6">
              {/* Alert Warning */}
              <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 space-y-2 text-red-200">
                <div className="flex items-center gap-2 text-xs font-bold text-red-400">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>Emergency Destruction & Privacy Purge</span>
                </div>
                <p className="text-[11px] text-red-300/80 leading-relaxed">
                  These operations immediately destroy sensitive active session state, transcripts, and in-memory caches. This cannot be undone.
                </p>
              </div>

              {/* Burn Feedback Banner */}
              {burnFeedback && (
                <div
                  data-testid="burn-session-feedback"
                  className="rounded-xl border border-red-500/50 bg-red-950/40 p-3 text-xs text-red-200 flex items-start gap-2 animate-in fade-in"
                >
                  <Flame className="h-4 w-4 text-red-400 shrink-0 mt-0.5 animate-bounce" />
                  <span>{burnFeedback}</span>
                </div>
              )}

              {/* Reset Feedback Banner */}
              {resetFeedback && (
                <div
                  data-testid="reset-feedback"
                  className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-3 text-xs text-amber-200 flex items-start gap-2 animate-in fade-in"
                >
                  <CheckCircle2 className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
                  <span>{resetFeedback}</span>
                </div>
              )}

              {/* Action 1: Burn Session (REQ-017) */}
              <section className="rounded-xl border border-red-900/50 bg-zinc-900/40 p-4 space-y-3">
                <div>
                  <h4 className="text-xs font-semibold text-red-400">
                    Burn Active Session (REQ-017)
                  </h4>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                    Instantly erases all recorded interview transcripts, progressive solution stages, questions, and active audio ring buffers.
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="burn-session-btn"
                  onClick={handleBurnSession}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-xs text-white bg-red-600 hover:bg-red-700 active:bg-red-800 border border-red-500 shadow-lg shadow-red-950/60 transition-all"
                >
                  <Flame className="h-4 w-4 text-red-200" />
                  <span>Burn Session</span>
                </button>
              </section>

              {/* Action 2: Reset All Settings */}
              <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 space-y-3">
                <div>
                  <h4 className="text-xs font-semibold text-zinc-300">
                    Reset Settings to Default
                  </h4>
                  <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                    Resets model selection, persona tone presets, STT mode, and clears configured keys from memory.
                  </p>
                </div>

                <button
                  type="button"
                  data-testid="reset-settings-btn"
                  onClick={handleResetSettings}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-zinc-300 bg-zinc-900 hover:bg-zinc-800 hover:text-zinc-100 border border-zinc-700/60 transition-colors"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-zinc-400" />
                  <span>Reset All Settings</span>
                </button>
              </section>
            </div>
          )}
        </main>

        {/* Drawer Footer with Hotkey Tip */}
        <footer className="px-5 py-3 border-t border-zinc-800/80 bg-zinc-950/80 flex items-center justify-between text-[11px] text-zinc-500 shrink-0">
          <span>
            Toggle Drawer: <kbd className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-400 border border-zinc-800">⌘ ,</kbd>
          </span>
          <span>
            Dismiss: <kbd className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-400 border border-zinc-800">Esc</kbd>
          </span>
        </footer>
      </div>
    </div>
  );
};
