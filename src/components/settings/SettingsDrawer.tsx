import React, { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  KeyRound,
  LoaderCircle,
  TriangleAlert,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import { useSettingsStore, type SttMode } from "../../store/settingsStore";
import { useSessionStore } from "../../store/sessionStore";
import {
  safeInvoke,
  listLocalSttModels,
  downloadSttModel,
  type ModelAssetInfo,
} from "../../lib/ipc";
import { ApiKeyInputs } from "./ApiKeyInputs";
import { ProfileEditor } from "./ProfileEditor";
import { cn } from "../../lib/utils";

export type SettingsTab = "keys" | "profile" | "audio" | "danger";

interface SettingsDrawerProps {
  isOpen?: boolean;
  onClose?: () => void;
  defaultTab?: SettingsTab;
}

const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "keys", label: "Keys", icon: KeyRound },
  { id: "profile", label: "Profile", icon: User },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "danger", label: "Danger", icon: TriangleAlert },
];

const STT_OPTIONS: { id: SttMode; name: string; description: string }[] = [
  { id: "whisper_local", name: "On this Mac", description: "Runs offline. Audio stays on this device." },
  { id: "groq", name: "Groq cloud", description: "Fast cloud transcription. Needs a Groq key." },
  { id: "deepgram", name: "Deepgram streaming", description: "Live cloud streaming. Needs a Deepgram key." },
];

const CONFIRM_MS = 3000;
const CONFIRMED_MS = 2000;

type DangerAction = "burn" | "reset";

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen: propsIsOpen,
  onClose: propsOnClose,
  defaultTab = "keys",
}) => {
  const storeIsOpen = useSettingsStore((s) => s.isSettingsOpen);
  const setIsSettingsOpen = useSettingsStore((s) => s.setIsSettingsOpen);
  const resetSettings = useSettingsStore((s) => s.resetSettings);
  const sttMode = useSettingsStore((s) => s.sttMode);
  const setSttMode = useSettingsStore((s) => s.setSttMode);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const clearSession = useSessionStore((s) => s.clearSession);

  const isOpen = propsIsOpen !== undefined ? propsIsOpen : storeIsOpen;
  const handleClose = propsOnClose || (() => setIsSettingsOpen(false));

  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});

  const [localModels, setLocalModels] = useState<ModelAssetInfo[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [modelNotice, setModelNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [armed, setArmed] = useState<DangerAction | null>(null);
  const [done, setDone] = useState<DangerAction | null>(null);
  const armTimer = useRef<number | undefined>(undefined);
  const doneTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);

  useEffect(
    () => () => {
      window.clearTimeout(armTimer.current);
      window.clearTimeout(doneTimer.current);
      window.clearTimeout(noticeTimer.current);
    },
    []
  );

  // Escape closes the panel; Cmd/Ctrl+Escape is left alone for the panic shortcut
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // Move focus to the selected tab when the panel opens
  useEffect(() => {
    if (isOpen) tabRefs.current[activeTab]?.focus();
  }, [isOpen]);

  // Refresh local model status when the panel opens or the tab changes
  useEffect(() => {
    if (!isOpen) return;
    listLocalSttModels().then((models) => {
      if (models) setLocalModels(models);
    });
  }, [isOpen, activeTab]);

  if (!isOpen) {
    return null;
  }

  const tinyModel = localModels.find((m) => m.filename.includes("tiny"));
  const modelReady = Boolean(tinyModel?.is_available);
  const sttKeyMissing =
    (sttMode === "groq" && !apiKeys.groq) || (sttMode === "deepgram" && !apiKeys.deepgram);

  const handleDownloadModel = async () => {
    setDownloading(true);
    setModelNotice(null);
    try {
      const path = await downloadSttModel("tiny");
      if (!path) throw new Error("Model download returned no path");
      const updated = await listLocalSttModels();
      if (updated) setLocalModels(updated);
      setModelNotice({ ok: true, text: "Model downloaded" });
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setModelNotice(null), CONFIRMED_MS);
    } catch {
      setModelNotice({ ok: false, text: "Download failed. Check your connection." });
    } finally {
      setDownloading(false);
    }
  };

  // Two-step confirm: the first click arms the action, a second click within 3s runs it
  const runDanger = async (action: DangerAction) => {
    if (armed !== action) {
      window.clearTimeout(armTimer.current);
      setArmed(action);
      armTimer.current = window.setTimeout(() => setArmed(null), CONFIRM_MS);
      return;
    }
    window.clearTimeout(armTimer.current);
    setArmed(null);
    if (action === "burn") {
      clearSession();
      await safeInvoke("burn_session");
    } else {
      resetSettings();
    }
    setDone(action);
    window.clearTimeout(doneTimer.current);
    doneTimer.current = window.setTimeout(() => setDone(null), CONFIRMED_MS);
  };

  const onTabKeyDown = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = TABS.findIndex((t) => t.id === activeTab);
    const next = TABS[(index + step + TABS.length) % TABS.length].id;
    setActiveTab(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <section
      role="dialog"
      aria-label="Settings"
      data-testid="settings-drawer"
      className="sk-panel min-h-0"
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="sk-title flex-1">Settings</h2>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close settings"
          title="Close settings"
          className="sk-icon-btn"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div
        role="tablist"
        aria-label="Settings sections"
        onKeyDown={onTabKeyDown}
        className="mx-3 grid grid-cols-4 gap-1 rounded-lg bg-white/[0.04] p-1"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const selected = id === activeTab;
          return (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={selected}
              aria-controls="settings-tabpanel"
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(id)}
              className={cn(
                "flex h-7 items-center justify-center gap-1.5 rounded text-[12px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-400/70",
                selected ? "bg-white/10 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id="settings-tabpanel"
        aria-labelledby={`settings-tab-${activeTab}`}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-3 sk-scroll"
      >
        {activeTab === "keys" && <ApiKeyInputs />}

        {activeTab === "profile" && <ProfileEditor />}

        {activeTab === "audio" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <h3 className="sk-label">Speech-to-text engine</h3>
              <div role="radiogroup" aria-label="Speech-to-text engine" className="grid gap-1.5">
                {STT_OPTIONS.map((opt) => {
                  const selected = sttMode === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setSttMode(opt.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 rounded-lg p-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sky-400/70",
                        selected
                          ? "bg-sky-500/15 text-zinc-100 ring-1 ring-inset ring-sky-400/50"
                          : "bg-white/[0.04] text-zinc-300 hover:bg-white/[0.07]"
                      )}
                    >
                      <span className="text-[13px] font-medium">{opt.name}</span>
                      <span className="sk-meta">{opt.description}</span>
                    </button>
                  );
                })}
              </div>
              {sttKeyMissing && (
                <p className="sk-meta">
                  Add a {sttMode === "groq" ? "Groq" : "Deepgram"} key on the Keys tab to use this engine.
                </p>
              )}
            </div>

            {sttMode === "whisper_local" && (
              <div className="space-y-2 rounded-lg bg-white/[0.04] p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-zinc-100">
                    Local speech model (tiny, about 75 MB)
                  </span>
                  <span className="sk-meta">{modelReady ? "Downloaded" : "Not downloaded"}</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {!modelReady && (
                    <button
                      type="button"
                      onClick={handleDownloadModel}
                      disabled={downloading}
                      className="sk-btn-primary"
                    >
                      {downloading && (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      )}
                      <span>Download model</span>
                    </button>
                  )}
                  {modelNotice && (
                    <span
                      role="status"
                      className={cn("sk-meta", modelNotice.ok ? "text-emerald-400" : "text-red-300")}
                    >
                      {modelNotice.text}
                    </span>
                  )}
                </div>
              </div>
            )}

            <p className="sk-meta">Audio is captured only while a meeting is live.</p>
          </div>
        )}

        {activeTab === "danger" && (
          <div className="space-y-2">
            <p className="sk-meta">These can&apos;t be undone.</p>

            <div className="space-y-2 rounded-lg bg-white/[0.04] p-3">
              <h3 className="text-[13px] font-medium text-zinc-100">Burn session</h3>
              <p className="sk-meta">
                Clears transcripts, questions and answers, and stops listening.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => runDanger("burn")} className="sk-btn-danger">
                  {armed === "burn" ? "Click again to burn" : "Burn"}
                </button>
                {done === "burn" && (
                  <span role="status" className="sk-meta text-emerald-400">
                    Session cleared
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-lg bg-white/[0.04] p-3">
              <h3 className="text-[13px] font-medium text-zinc-100">Reset settings</h3>
              <p className="sk-meta">
                Restores models, persona and speech settings to their defaults.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => runDanger("reset")} className="sk-btn-secondary">
                  {armed === "reset" ? "Click again to reset" : "Reset"}
                </button>
                {done === "reset" && (
                  <span role="status" className="sk-meta text-emerald-400">
                    Settings reset
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
