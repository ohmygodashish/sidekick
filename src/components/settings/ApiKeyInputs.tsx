import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useSettingsStore, type ApiProvider, type ThinkingLevel } from "../../store/settingsStore";
import { usePresence } from "../../hooks/usePresence";
import { reasoningSupport } from "../../services/ai/reasoning";
import { cn } from "../../lib/utils";

// Each check returns an error message, or null when the key format looks right.
// Format only: nothing is sent to the provider.
const requirePrefix = (prefix: string) => (key: string) =>
  !key ? "API key is required" : key.startsWith(prefix) ? null : `Invalid key format: Must start with ${prefix}`;

interface ProviderMeta {
  id: ApiProvider;
  name: string;
  description: string;
  placeholder: string;
  formatError: (key: string) => string | null;
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "Many models through one key",
    placeholder: "sk-or-v1-...",
    formatError: requirePrefix("sk-or-"),
  },
  {
    id: "anthropic",
    name: "Anthropic",
    description: "Claude models",
    placeholder: "sk-ant-api03-...",
    formatError: requirePrefix("sk-ant-"),
  },
  {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI models",
    placeholder: "sk-...",
    formatError: requirePrefix("sk-"),
  },
  {
    id: "groq",
    name: "Groq",
    description: "Fast question detection and speech-to-text",
    placeholder: "gsk_...",
    formatError: requirePrefix("gsk_"),
  },
];

interface KeyCheck {
  ok: boolean;
  message: string;
}

const THINKING_LEVELS: { id: ThinkingLevel; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

/** Under the thinking switches when the model can't take a thinking setting at all */
const UNSUPPORTED_NOTE = "Thinking settings apply to Claude and OpenAI models.";
/** Under the thinking switches when the model always thinks, so "off" means its default level */
const ALWAYS_THINKS_NOTE = "This model always thinks; off uses its default level.";

interface SwitchRowProps {
  id: string;
  label: string;
  help: string;
  /** Read as part of the switch's description, and shown under its help text */
  note?: string;
  /** Other elements that also describe this switch */
  describedBy?: string[];
  checked: boolean;
  /** Greyed out and no-op, but still focusable, so the description can be read */
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/** A labelled on/off switch with its help text. A native button, so Space and Enter work. */
const SwitchRow: React.FC<SwitchRowProps> = ({
  id,
  label,
  help,
  note,
  describedBy = [],
  checked,
  disabled = false,
  onChange,
}) => (
  <div className={cn("flex items-start gap-3", disabled && "opacity-50")}>
    <div className="min-w-0 flex-1">
      <span id={`${id}-label`} className="block text-[13px] font-medium text-sk-fg">
        {label}
      </span>
      <span id={`${id}-help`} className="sk-meta block">
        {help}
      </span>
      {note && (
        <span id={`${id}-note`} className="sk-meta block">
          {note}
        </span>
      )}
    </div>
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-disabled={disabled}
      aria-labelledby={`${id}-label`}
      aria-describedby={[`${id}-help`, note && `${id}-note`, ...describedBy].filter(Boolean).join(" ")}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={cn(
        "relative mt-0.5 h-5 w-9 shrink-0 rounded-full outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sk-focus",
        disabled && "cursor-not-allowed",
        checked ? "bg-sk-accent-solid" : "bg-sk-hover"
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0.5 top-0.5 h-4 w-4 rounded-full transition-transform duration-150 ease-out",
          checked ? "translate-x-4 bg-sk-on-solid" : "bg-sk-fg-3"
        )}
      />
    </button>
  </div>
);

export const ApiKeyInputs: React.FC = () => {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const saveAllApiKeysToBackend = useSettingsStore((s) => s.saveAllApiKeysToBackend);
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const setSelectedProvider = useSettingsStore((s) => s.setSelectedProvider);
  const selectedModel = useSettingsStore((s) => s.selectedModel);
  const setSelectedModel = useSettingsStore((s) => s.setSelectedModel);
  const evaluatorModel = useSettingsStore((s) => s.evaluatorModel);
  const setEvaluatorModel = useSettingsStore((s) => s.setEvaluatorModel);
  const answerThinking = useSettingsStore((s) => s.answerThinking);
  const setAnswerThinking = useSettingsStore((s) => s.setAnswerThinking);
  const answerThinkingLevel = useSettingsStore((s) => s.answerThinkingLevel);
  const setAnswerThinkingLevel = useSettingsStore((s) => s.setAnswerThinkingLevel);
  const pickThinking = useSettingsStore((s) => s.pickThinking);
  const setPickThinking = useSettingsStore((s) => s.setPickThinking);
  // Only some providers and models take a thinking setting; the switches grey out for the rest
  const thinkingSupport = reasoningSupport(selectedProvider, selectedModel);
  const alwaysThinks = thinkingSupport.supported && !thinkingSupport.canDisable;
  const answerNote = !thinkingSupport.supported ? UNSUPPORTED_NOTE : alwaysThinks ? ALWAYS_THINKS_NOTE : undefined;
  // The level and the picks switch leave with a short fade when thinking is turned off
  const thinkingDetails = usePresence(answerThinking);
  const levelRefs = useRef<Partial<Record<ThinkingLevel, HTMLButtonElement | null>>>({});

  const [visible, setVisible] = useState<Partial<Record<ApiProvider, boolean>>>({});
  const [checks, setChecks] = useState<Partial<Record<ApiProvider, KeyCheck>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const savedTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const toggleVisible = (provider: ApiProvider) => {
    setVisible((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleKeyChange = (provider: ApiProvider, value: string) => {
    setApiKey(provider, value);
    // A format check describes the old value, so drop it
    setChecks((prev) => ({ ...prev, [provider]: undefined }));
  };

  // Arrow keys move the level and its selection together, as in the theme control
  const onLevelKeyDown = (e: React.KeyboardEvent) => {
    if (!thinkingSupport.supported) return;
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    const index = THINKING_LEVELS.findIndex((l) => l.id === answerThinkingLevel);
    const next = THINKING_LEVELS[(index + step + THINKING_LEVELS.length) % THINKING_LEVELS.length].id;
    setAnswerThinkingLevel(next);
    levelRefs.current[next]?.focus();
  };

  const handleCheck = (provider: ProviderMeta) => {
    const error = provider.formatError((apiKeys[provider.id] ?? "").trim());
    setChecks((prev) => ({
      ...prev,
      [provider.id]: error ? { ok: false, message: error } : { ok: true, message: "Format looks right" },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveFailed(false);
    try {
      await saveAllApiKeysToBackend();
      setSaved(true);
      window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.warn("[Sidekick] saving API keys failed:", err);
      setSaved(false);
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="sk-meta">Keys are saved in ~/.config/sidekick/config.json, readable only by your user account.</p>

      <div className="space-y-2">
        <div className="space-y-1.5">
          <label htmlFor="keys-provider" className="sk-label">
            Primary provider
          </label>
          <select
            id="keys-provider"
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value as ApiProvider)}
            className="sk-field"
          >
            <option value="openrouter">OpenRouter</option>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="groq">Groq</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="keys-model" className="sk-label">
            Solution model
          </label>
          <input
            id="keys-model"
            type="text"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            placeholder="provider/model-name"
            className="sk-field"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="keys-evaluator" className="sk-label">
            Evaluator model (fast)
          </label>
          <input
            id="keys-evaluator"
            type="text"
            value={evaluatorModel}
            onChange={(e) => setEvaluatorModel(e.target.value)}
            placeholder="provider/model-name"
            className="sk-field"
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg bg-sk-fill p-3">
        <SwitchRow
          id="answer-thinking"
          label="Think before answering"
          help="Typed questions and ⌘↵ Assist."
          note={answerNote}
          // An unsupported model shows off: the switch does nothing there, so it mustn't look on
          checked={answerThinking && thinkingSupport.supported}
          disabled={!thinkingSupport.supported}
          onChange={setAnswerThinking}
        />
        {thinkingDetails.mounted && (
          <div
            data-state={thinkingDetails.state}
            inert={thinkingDetails.state === "closed"}
            className="sk-pop space-y-3"
          >
            <div className="space-y-1.5">
              <span id="thinking-level-label" className="sk-meta block">
                Thinking level
              </span>
              <div
                role="radiogroup"
                aria-labelledby="thinking-level-label"
                aria-disabled={!thinkingSupport.supported}
                aria-describedby={thinkingSupport.supported ? undefined : "answer-thinking-note"}
                onKeyDown={onLevelKeyDown}
                className={cn(
                  "grid grid-cols-3 gap-1 rounded-lg bg-sk-fill-2 p-1",
                  !thinkingSupport.supported && "opacity-50"
                )}
              >
                {THINKING_LEVELS.map(({ id, label }) => {
                  const selected = answerThinkingLevel === id;
                  return (
                    <button
                      key={id}
                      ref={(el) => {
                        levelRefs.current[id] = el;
                      }}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      aria-disabled={!thinkingSupport.supported}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => {
                        if (thinkingSupport.supported) setAnswerThinkingLevel(id);
                      }}
                      className={cn(
                        "flex h-7 items-center justify-center rounded text-[13px] font-medium outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-sk-focus",
                        selected ? "bg-sk-accent-tint text-sk-fg" : "text-sk-fg-2 hover:bg-sk-hover",
                        !thinkingSupport.supported && "cursor-not-allowed hover:bg-transparent"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <SwitchRow
              id="pick-thinking"
              label="Also think for picked options"
              help={
                alwaysThinks
                  ? `Option picks and the background answer for the asked question. ${ALWAYS_THINKS_NOTE}`
                  : "Option picks and the background answer for the asked question. Off is fastest."
              }
              describedBy={thinkingSupport.supported ? [] : ["answer-thinking-note"]}
              checked={pickThinking && thinkingSupport.supported}
              disabled={!thinkingSupport.supported}
              onChange={setPickThinking}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="sk-label">Provider keys</h3>
        {PROVIDERS.map((provider) => {
          const isVisible = Boolean(visible[provider.id]);
          const check = checks[provider.id];
          const inputId = `key-${provider.id}`;

          return (
            <div key={provider.id} className="space-y-2 rounded-lg bg-sk-fill p-3">
              <div>
                <h4 className="text-[13px] font-medium text-sk-fg">{provider.name}</h4>
                <p className="sk-meta">{provider.description}</p>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <label htmlFor={inputId} className="sr-only">
                    {provider.name} API key
                  </label>
                  <input
                    id={inputId}
                    type={isVisible ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKeys[provider.id] ?? ""}
                    onChange={(e) => handleKeyChange(provider.id, e.target.value)}
                    placeholder={provider.placeholder}
                    className="sk-field pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => toggleVisible(provider.id)}
                    aria-label={isVisible ? "Hide key" : "Show key"}
                    title={isVisible ? "Hide key" : "Show key"}
                    className="sk-icon-btn absolute right-0.5 top-1/2 -translate-y-1/2"
                  >
                    {isVisible ? (
                      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => handleCheck(provider)}
                  className="sk-btn-secondary shrink-0"
                >
                  Check format
                </button>
              </div>

              {check && (
                <p
                  role="status"
                  className={cn("sk-meta", check.ok ? "text-sk-success" : "text-sk-danger")}
                >
                  {check.message}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-end gap-3">
        {saved && (
          <span role="status" className="sk-meta text-sk-success">
            Saved
          </span>
        )}
        {saveFailed && (
          <span role="status" className="sk-meta text-sk-danger">
            Couldn&apos;t save keys. Try again.
          </span>
        )}
        <button type="button" onClick={handleSave} disabled={saving} className="sk-btn-primary">
          {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          <span>Save keys</span>
        </button>
      </div>
    </div>
  );
};
