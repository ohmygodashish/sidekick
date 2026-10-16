import React, { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Keyboard,
  KeyRound,
  Layers,
  LoaderCircle,
  Monitor,
  Moon,
  SunMoon,
  Sun,
  TriangleAlert,
  User,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  OUTPUT_LANGUAGES,
  STT_LANGUAGES,
  useSettingsStore,
  type SttLanguage,
  type SttMode,
  type ThemePreference,
} from "../../store/settingsStore";
import { useSessionStore } from "../../store/sessionStore";
import {
  invokeInTauri,
  listLocalSttModels,
  downloadSttModel,
  type ModelAssetInfo,
} from "../../lib/ipc";
import { ApiKeyInputs } from "./ApiKeyInputs";
import { ProfileEditor } from "./ProfileEditor";
import { ModesTab } from "./ModesTab";
import { MicSection } from "./MicSection";
import { cn } from "../../lib/utils";
import { SHORTCUTS, type Shortcut } from "../../lib/shortcuts";

export type SettingsTab = "keys" | "profile" | "modes" | "audio" | "appearance" | "keybinds" | "danger";

interface SettingsDrawerProps {
  isOpen?: boolean;
  onClose?: () => void;
  defaultTab?: SettingsTab;
}

const TABS: { id: SettingsTab; label: string; icon: LucideIcon }[] = [
  { id: "keys", label: "API keys", icon: KeyRound },
  { id: "profile", label: "Profile", icon: User },
  { id: "modes", label: "Modes", icon: Layers },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "appearance", label: "Appearance", icon: SunMoon },
  { id: "keybinds", label: "Keybinds", icon: Keyboard },
  { id: "danger", label: "Danger", icon: TriangleAlert },
];

const THEMES: { id: ThemePreference; label: string; icon: LucideIcon }[] = [
  { id: "system", label: "System", icon: Monitor },
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
];

const STT_OPTIONS: { id: SttMode; name: string; description: string }[] = [
  { id: "whisper_local", name: "On this Mac", description: "Runs offline. Audio stays on this device." },
  { id: "groq", name: "Groq cloud", description: "Fast cloud transcription. Needs a Groq key." },
];

// Keybinds tab: groups in the order they first appear in SHORTCUTS
const SHORTCUT_GROUPS = Object.entries(
  SHORTCUTS.reduce<Record<string, Shortcut[]>>((groups, shortcut) => {
    groups[shortcut.group] ??= [];
    groups[shortcut.group].push(shortcut);
    return groups;
  }, {})
);

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
  const sttLanguage = useSettingsStore((s) => s.sttLanguage);
  const sttLanguageNotice = useSettingsStore((s) => s.sttLanguageNotice);
  const setSttLanguage = useSettingsStore((s) => s.setSttLanguage);
  const outputLanguage = useSettingsStore((s) => s.outputLanguage);
  const setOutputLanguage = useSettingsStore((s) => s.setOutputLanguage);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const clearSession = useSessionStore((s) => s.clearSession);

  const isOpen = propsIsOpen !== undefined ? propsIsOpen : storeIsOpen;
  const handleClose = propsOnClose || (() => setIsSettingsOpen(false));

  const [activeTab, setActiveTab] = useState<SettingsTab>(defaultTab);
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const themeRefs = useRef<Partial<Record<ThemePreference, HTMLButtonElement | null>>>({});

  const [localModels, setLocalModels] = useState<ModelAssetInfo[]>([]);
  const [downloading, setDownloading] = useState(false);
  const [modelNotice, setModelNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [armed, setArmed] = useState<DangerAction | null>(null);
  const [done, setDone] = useState<DangerAction | null>(null);
  const [burnFailed, setBurnFailed] = useState(false);
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
  const sttKeyMissing = sttMode === "groq" && !apiKeys.groq;

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
      try {
        await invokeInTauri("burn_session");
      } catch (err) {
        console.warn("[Sidekick] burn_session failed:", err);
        setBurnFailed(true);
        return;
      }
      setBurnFailed(false);
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

  // Arrow keys move the selection as well as focus, so the theme applies as you move
  const onThemeKeyDown = (e: React.KeyboardEvent) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = THEMES.findIndex((t) => t.id === theme);
    const next = THEMES[(index + step + THEMES.length) % THEMES.length].id;
    setTheme(next);
    themeRefs.current[next]?.focus();
  };

  return (
    <section
      role="dialog"
      aria-label="Settings"
      data-testid="settings-drawer"
      className="sk-panel sk-pop min-h-0"
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
        className="mx-3 grid grid-cols-7 gap-1"
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
                "flex min-w-0 flex-col items-center gap-1 rounded-lg py-1.5 text-[12px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sk-focus",
                selected ? "bg-sk-fill-2 text-sk-fg" : "text-sk-fg-3 hover:bg-sk-fill hover:text-sk-fg-2"
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
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

        {activeTab === "modes" && <ModesTab />}

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
                        "flex w-full flex-col items-start gap-0.5 rounded-lg p-3 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sk-focus",
                        selected
                          ? "bg-sk-accent-tint text-sk-fg"
                          : "bg-sk-fill text-sk-fg-2 hover:bg-sk-hover"
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
                  Add a Groq key on the API keys tab to use this engine.
                </p>
              )}
            </div>

            {sttMode === "whisper_local" && (
              <div className="space-y-2 rounded-lg bg-sk-fill p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[13px] font-medium text-sk-fg">
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
                      className={cn("sk-meta", modelNotice.ok ? "text-sk-success" : "text-sk-danger")}
                    >
                      {modelNotice.text}
                    </span>
                  )}
                </div>
              </div>
            )}

            <MicSection />

            <div className="space-y-2 rounded-lg bg-sk-fill p-3">
              <h3 className="sk-label">Language</h3>
              <div className="space-y-1.5">
                <label htmlFor="stt-language" className="sk-meta">
                  Transcription language
                </label>
                <select
                  id="stt-language"
                  value={sttLanguage}
                  onChange={(e) => setSttLanguage(e.target.value as SttLanguage)}
                  className="sk-field"
                >
                  {STT_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {lang.name}
                    </option>
                  ))}
                </select>
                {sttLanguageNotice && (
                  <p role="status" className="sk-meta text-sk-warn">
                    {sttLanguageNotice}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="output-language" className="sk-meta">
                  Output language
                </label>
                <select
                  id="output-language"
                  value={outputLanguage}
                  onChange={(e) => setOutputLanguage(e.target.value)}
                  className="sk-field"
                >
                  {OUTPUT_LANGUAGES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
                <p className="sk-meta">Answers are written in this language.</p>
              </div>
            </div>

            <p className="sk-meta">Audio is captured only while a meeting is live.</p>
          </div>
        )}

        {activeTab === "appearance" && (
          <div className="space-y-2">
            <h3 className="sk-label">Theme</h3>
            <div
              role="radiogroup"
              aria-label="Theme"
              onKeyDown={onThemeKeyDown}
              className="grid grid-cols-3 gap-1 rounded-lg bg-sk-fill p-1"
            >
              {THEMES.map(({ id, label, icon: Icon }) => {
                const selected = theme === id;
                return (
                  <button
                    key={id}
                    ref={(el) => {
                      themeRefs.current[id] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => setTheme(id)}
                    className={cn(
                      "flex h-8 items-center justify-center gap-1.5 rounded text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sk-focus",
                      selected ? "bg-sk-accent-tint text-sk-fg" : "bg-sk-fill text-sk-fg-2 hover:bg-sk-hover"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
            <p className="sk-meta">System follows your macOS appearance.</p>
          </div>
        )}

        {activeTab === "keybinds" && (
          <div className="space-y-4">
            <p className="sk-meta">
              Shortcuts marked “while visible” only work while Sidekick is showing, so other apps keep those keys
              when it&apos;s hidden.
            </p>
            {SHORTCUT_GROUPS.map(([group, shortcuts]) => (
              <div key={group} className="space-y-1.5">
                <h3 className="sk-label">{group}</h3>
                <ul className="space-y-1">
                  {shortcuts.map((shortcut) => (
                    <li
                      key={shortcut.id}
                      className="flex min-h-8 items-center gap-2 rounded-lg bg-sk-fill px-3 py-1.5 text-[13px] text-sk-fg-2"
                    >
                      <span className="min-w-0 flex-1">{shortcut.label}</span>
                      {shortcut.whileVisible && <span className="sk-meta">while visible</span>}
                      <span className="flex shrink-0 items-center gap-1">
                        {shortcut.keys.map((key) => (
                          <kbd key={key} className="sk-kbd">
                            {key}
                          </kbd>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {activeTab === "danger" && (
          <div className="space-y-2">
            <p className="sk-meta">These can&apos;t be undone.</p>

            <div className="space-y-2 rounded-lg bg-sk-fill p-3">
              <h3 className="text-[13px] font-medium text-sk-fg">Burn session</h3>
              <p className="sk-meta">
                Clears transcripts, questions and answers, and stops listening.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => runDanger("burn")} className="sk-btn-danger">
                  {armed === "burn" ? "Click again to burn" : "Burn"}
                </button>
                {done === "burn" && (
                  <span role="status" className="sk-meta text-sk-success">
                    Session cleared
                  </span>
                )}
                {burnFailed && (
                  <span role="status" className="sk-meta text-sk-danger">
                    Couldn&apos;t clear the session in the backend. Try again.
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 rounded-lg bg-sk-fill p-3">
              <h3 className="text-[13px] font-medium text-sk-fg">Reset settings</h3>
              <p className="sk-meta">
                Restores models, thinking, persona, speech, language, microphone and theme settings to their defaults, and the
                active mode to General. API keys and custom modes are kept.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => runDanger("reset")} className="sk-btn-secondary">
                  {armed === "reset" ? "Click again to reset" : "Reset"}
                </button>
                {done === "reset" && (
                  <span role="status" className="sk-meta text-sk-success">
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
