import React, { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useSettingsStore, type ApiProvider } from "../../store/settingsStore";
import { cn } from "../../lib/utils";

// Each check returns an error message, or null when the key format looks right.
// Format only: nothing is sent to the provider.
const requirePrefix = (prefix: string) => (key: string) =>
  !key ? "API key is required" : key.startsWith(prefix) ? null : `Invalid key format: Must start with ${prefix}`;

const requireLength = (min: number) => (key: string) =>
  !key ? "API key is required" : key.length < min ? "Invalid key format: Key too short" : null;

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
    id: "gemini",
    name: "Google Gemini",
    description: "Gemini models",
    placeholder: "AIzaSy...",
    formatError: requireLength(20),
  },
  {
    id: "groq",
    name: "Groq",
    description: "Fast question detection and speech-to-text",
    placeholder: "gsk_...",
    formatError: requirePrefix("gsk_"),
  },
  {
    id: "deepgram",
    name: "Deepgram",
    description: "Speech-to-text",
    placeholder: "40-character token",
    formatError: requireLength(20),
  },
];

interface KeyCheck {
  ok: boolean;
  message: string;
}

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
            <option value="gemini">Google Gemini</option>
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
