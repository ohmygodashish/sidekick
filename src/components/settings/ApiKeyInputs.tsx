import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useSettingsStore, type ApiProvider, type SolutionProvider, type ThinkingLevel } from "../../store/settingsStore";
import { usePresence } from "../../hooks/usePresence";
import { Segmented } from "./Segmented";
import { activeModel, EVALUATOR_MODEL, SOLUTION_MODELS } from "../../services/ai/models";
import { reasoningSupport } from "../../services/ai/reasoning";
import { cn } from "../../lib/utils";

const PROVIDERS: Record<ApiProvider, { name: string; description: string; placeholder: string }> = {
  anthropic: { name: "Anthropic", description: "Claude models", placeholder: "sk-ant-api03-..." },
  openai: { name: "OpenAI", description: "GPT models", placeholder: "sk-..." },
  openrouter: {
    name: "OpenRouter",
    description: "Claude and GPT models through one key",
    placeholder: "sk-or-v1-...",
  },
  groq: { name: "Groq", description: "Live options and Groq speech-to-text", placeholder: "gsk_..." },
};

const SOLUTION_CHOICES = (["anthropic", "openai", "openrouter"] as const).map((id) => ({
  id,
  label: PROVIDERS[id].name,
}));

const THINKING_LEVELS: { id: ThinkingLevel; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

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

interface KeyInputProps {
  provider: ApiProvider;
  value: string;
  required?: boolean;
  /** Id of a hint that describes the field */
  describedBy?: string;
  /** The last save of this key failed */
  failed?: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
}

/** A key field with a show/hide eye. Masked until the user asks to see it. */
const KeyInput: React.FC<KeyInputProps> = ({
  provider,
  value,
  required = false,
  describedBy,
  failed = false,
  onChange,
  onBlur,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const { name, placeholder } = PROVIDERS[provider];
  const inputId = `key-${provider}`;

  return (
    <>
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          {name} API key
        </label>
        <input
          id={inputId}
          type={isVisible ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          aria-required={required || undefined}
          aria-describedby={describedBy}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          className="sk-field pr-10"
        />
        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          aria-label={isVisible ? `Hide ${name} key` : `Show ${name} key`}
          aria-pressed={isVisible}
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
      {failed && (
        <p role="alert" className="sk-meta text-sk-danger">
          Couldn&apos;t save the {name} key. Try again.
        </p>
      )}
    </>
  );
};

export const ApiKeyInputs: React.FC = () => {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const selectedProvider = useSettingsStore((s) => s.selectedProvider);
  const setSelectedProvider = useSettingsStore((s) => s.setSelectedProvider);
  const setProviderModel = useSettingsStore((s) => s.setProviderModel);
  const model = useSettingsStore((s) => activeModel(s));
  const answerThinking = useSettingsStore((s) => s.answerThinking);
  const setAnswerThinking = useSettingsStore((s) => s.setAnswerThinking);
  const answerThinkingLevel = useSettingsStore((s) => s.answerThinkingLevel);
  const setAnswerThinkingLevel = useSettingsStore((s) => s.setAnswerThinkingLevel);
  const pickThinking = useSettingsStore((s) => s.pickThinking);
  const setPickThinking = useSettingsStore((s) => s.setPickThinking);

  // A model that always thinks can't take "off", so both switches stay on and locked
  const support = reasoningSupport(selectedProvider, model);
  const locked = support.supported && !support.canDisable;
  const thinkingOn = answerThinking || locked;
  // The level and the picks switch leave with a short fade when thinking is turned off
  const thinkingDetails = usePresence(thinkingOn);

  // Keys typed since their last save. Only these are saved, so an untouched field can't wipe a stored key.
  const dirtyKeys = useRef(new Set<ApiProvider>());
  const [saveFailed, setSaveFailed] = useState<Partial<Record<ApiProvider, boolean>>>({});

  // Closing Settings unmounts this tab (HUDContainer), so unsaved keys are saved here.
  // Nothing is left on screen to show a failure on, so this only warns.
  useEffect(
    () => () => {
      const { apiKeys: keys, saveApiKeyToBackend } = useSettingsStore.getState();
      for (const provider of dirtyKeys.current) {
        saveApiKeyToBackend(provider, keys[provider] ?? "").catch((err) =>
          console.warn("[Sidekick] saving the key failed:", err)
        );
      }
      dirtyKeys.current.clear();
    },
    []
  );

  const handleKeyChange = (provider: ApiProvider, value: string) => {
    setApiKey(provider, value);
    dirtyKeys.current.add(provider);
    setSaveFailed((prev) => ({ ...prev, [provider]: false }));
  };

  const handleKeyBlur = async (provider: ApiProvider) => {
    if (!dirtyKeys.current.has(provider)) return;
    const { apiKeys: keys, saveApiKeyToBackend } = useSettingsStore.getState();
    const value = keys[provider] ?? "";
    try {
      await saveApiKeyToBackend(provider, value);
      // Stays dirty until saved, so closing Settings mid-save or after a failure still saves it.
      // An edit made while this save ran is newer, so it stays dirty too.
      if (useSettingsStore.getState().apiKeys[provider] === value) dirtyKeys.current.delete(provider);
      setSaveFailed((prev) => ({ ...prev, [provider]: false }));
    } catch (err) {
      console.warn("[Sidekick] saving the key failed:", err);
      setSaveFailed((prev) => ({ ...prev, [provider]: true }));
    }
  };

  return (
    <div className="space-y-4">
      <p className="sk-meta">Keys are saved in ~/.config/sidekick/config.json, readable only by your user account.</p>

      <div className="space-y-2">
        <h3 id="solution-models-label" className="sk-label">
          Solution models
        </h3>
        <Segmented<SolutionProvider>
          labelledBy="solution-models-label"
          options={SOLUTION_CHOICES}
          value={selectedProvider}
          onChange={setSelectedProvider}
        />

        <div className="space-y-2 rounded-lg bg-sk-fill p-3">
          <div>
            <h4 className="text-[13px] font-medium text-sk-fg">{PROVIDERS[selectedProvider].name}</h4>
            <p className="sk-meta">{PROVIDERS[selectedProvider].description}</p>
          </div>
          <KeyInput
            key={selectedProvider}
            provider={selectedProvider}
            value={apiKeys[selectedProvider] ?? ""}
            describedBy={apiKeys[selectedProvider]?.trim() ? undefined : "solution-key-hint"}
            failed={saveFailed[selectedProvider]}
            onChange={(value) => handleKeyChange(selectedProvider, value)}
            onBlur={() => handleKeyBlur(selectedProvider)}
          />
          {!apiKeys[selectedProvider]?.trim() && (
            <p id="solution-key-hint" className="sk-meta">
              Add a key to get answers
            </p>
          )}
          <div className="space-y-1.5">
            <label htmlFor="solution-model" className="sk-meta">
              Model
            </label>
            <select
              id="solution-model"
              value={model}
              onChange={(e) => setProviderModel(selectedProvider, e.target.value)}
              className="sk-field"
            >
              {SOLUTION_MODELS[selectedProvider].map((m) => (
                <option key={m.id} value={m.id}>
                  {reasoningSupport(selectedProvider, m.id).canDisable ? m.label : `${m.label} · always thinks`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="space-y-3 rounded-lg bg-sk-fill p-3">
        <SwitchRow
          id="answer-thinking"
          label="Think before answering"
          help="Typed questions and ⌘↵ Assist."
          note={locked ? "This model doesn't support disabling thinking." : undefined}
          checked={thinkingOn}
          disabled={locked}
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
              <Segmented<ThinkingLevel>
                labelledBy="thinking-level-label"
                options={THINKING_LEVELS}
                value={answerThinkingLevel}
                onChange={setAnswerThinkingLevel}
              />
            </div>
            <SwitchRow
              id="pick-thinking"
              label="Also think for picked options"
              help="Option picks and the background answer for the asked question. Off is fastest."
              describedBy={locked ? ["answer-thinking-note"] : undefined}
              checked={pickThinking || locked}
              disabled={locked}
              onChange={setPickThinking}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h3 className="sk-label">Evaluator model</h3>
        <div className="space-y-2 rounded-lg bg-sk-fill p-3">
          <div>
            <div className="flex items-baseline gap-2">
              <h4 className="text-[13px] font-medium text-sk-fg">{PROVIDERS.groq.name}</h4>
              <span className="sk-meta">Required</span>
            </div>
            <p className="sk-meta">{PROVIDERS.groq.description}</p>
          </div>
          <KeyInput
            provider="groq"
            required
            value={apiKeys.groq ?? ""}
            failed={saveFailed.groq}
            onChange={(value) => handleKeyChange("groq", value)}
            onBlur={() => handleKeyBlur("groq")}
          />
          <div className="space-y-1.5">
            <label htmlFor="evaluator-model" className="sk-meta">
              Model
            </label>
            <select id="evaluator-model" defaultValue={EVALUATOR_MODEL.id} className="sk-field">
              <option value={EVALUATOR_MODEL.id}>{EVALUATOR_MODEL.label}</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};
