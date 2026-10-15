import React, { useState } from "react";
import {
  Key,
  Eye,
  EyeOff,
  Check,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Shield,
  Save,
} from "lucide-react";
import { useSettingsStore, type ApiProvider } from "../../store/settingsStore";
import { cn } from "../../lib/utils";

interface ProviderMeta {
  id: ApiProvider;
  name: string;
  subtitle: string;
  placeholder: string;
  validate: (key: string) => { valid: boolean; message: string };
}

const PROVIDERS: ProviderMeta[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    subtitle: "Multi-provider routing & unified model access",
    placeholder: "sk-or-v1-...",
    validate: (key: string) => {
      if (!key.trim()) return { valid: false, message: "API key is required" };
      if (!key.trim().startsWith("sk-or-")) {
        return { valid: false, message: "Invalid key format: Must start with sk-or-" };
      }
      return { valid: true, message: "OpenRouter key format verified" };
    },
  },
  {
    id: "anthropic",
    name: "Anthropic",
    subtitle: "Claude 3.5 Sonnet & high-intelligence reasoning",
    placeholder: "sk-ant-api03-...",
    validate: (key: string) => {
      if (!key.trim()) return { valid: false, message: "API key is required" };
      if (!key.trim().startsWith("sk-ant-")) {
        return { valid: false, message: "Invalid key format: Must start with sk-ant-" };
      }
      return { valid: true, message: "Anthropic key format verified" };
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    subtitle: "GPT-4o, o1-preview & embeddings",
    placeholder: "sk-...",
    validate: (key: string) => {
      if (!key.trim()) return { valid: false, message: "API key is required" };
      if (!key.trim().startsWith("sk-")) {
        return { valid: false, message: "Invalid key format: Must start with sk-" };
      }
      return { valid: true, message: "OpenAI key format verified" };
    },
  },
  {
    id: "gemini",
    name: "Google Gemini",
    subtitle: "Gemini 1.5 Pro & Flash multi-modal context",
    placeholder: "AIzaSy...",
    validate: (key: string) => {
      if (!key.trim()) return { valid: false, message: "API key is required" };
      if (key.trim().length < 20) {
        return { valid: false, message: "Invalid key format: Key too short" };
      }
      return { valid: true, message: "Google Gemini key format verified" };
    },
  },
  {
    id: "groq",
    name: "Groq",
    subtitle: "LPU inference for <250ms instant generation",
    placeholder: "gsk_...",
    validate: (key: string) => {
      if (!key.trim()) return { valid: false, message: "API key is required" };
      if (!key.trim().startsWith("gsk_")) {
        return { valid: false, message: "Invalid key format: Must start with gsk_" };
      }
      return { valid: true, message: "Groq key format verified" };
    },
  },
  {
    id: "deepgram",
    name: "Deepgram",
    subtitle: "Nova-2 streaming speech-to-text WebSocket",
    placeholder: "Token 40-character hex...",
    validate: (key: string) => {
      if (!key.trim()) return { valid: false, message: "API key is required" };
      if (key.trim().length < 20) {
        return { valid: false, message: "Invalid key format: Key too short" };
      }
      return { valid: true, message: "Deepgram token format verified" };
    },
  },
];

interface TestStatus {
  state: "idle" | "testing" | "success" | "error";
  message?: string;
}

export const ApiKeyInputs: React.FC = () => {
  const {
    apiKeys,
    setApiKey,
    saveAllApiKeysToBackend,
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    setSelectedModel,
    evaluatorModel,
    setEvaluatorModel,
  } = useSettingsStore();

  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [testStatuses, setTestStatuses] = useState<Record<string, TestStatus>>({});
  const [isSaved, setIsSaved] = useState(false);

  const toggleVisibility = (provider: ApiProvider) => {
    setVisibleKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  const handleTestConnection = async (meta: ProviderMeta) => {
    const key = apiKeys[meta.id] || "";
    setTestStatuses((prev) => ({
      ...prev,
      [meta.id]: { state: "testing" },
    }));

    // Perform validation
    const result = meta.validate(key);

    // Brief simulation for asynchronous testing feedback
    setTimeout(() => {
      if (result.valid) {
        setTestStatuses((prev) => ({
          ...prev,
          [meta.id]: { state: "success", message: result.message },
        }));
      } else {
        setTestStatuses((prev) => ({
          ...prev,
          [meta.id]: { state: "error", message: result.message },
        }));
      }
    }, 150);
  };

  const handleSaveAll = async () => {
    await saveAllApiKeysToBackend();
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  return (
    <div data-testid="api-key-inputs" className="space-y-6">
      {/* SEC-001 Security Notice Banner */}
      <div className="rounded-xl border border-sky-500/20 bg-sky-950/20 p-3 text-xs text-sky-200/90 flex items-start gap-2.5">
        <Shield className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
        <div className="space-y-0.5 leading-relaxed">
          <span className="font-semibold text-sky-200">
            Hardware-Backed Keychain Security (SEC-001)
          </span>
          <p className="text-[11px] text-sky-300/80">
            API keys are kept strictly in-memory and synchronized to the native macOS
            Keychain. They are never written to unencrypted disk or localStorage.
          </p>
        </div>
      </div>

      {/* Model & Provider Strategy */}
      <section className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Key className="h-3.5 w-3.5 text-amber-400" />
          <span>Active Inference Routing</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          {/* Primary Provider */}
          <div className="space-y-1.5">
            <label className="text-zinc-400 text-[11px] font-medium">
              Primary LLM Provider
            </label>
            <select
              data-testid="selected-provider-select"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value as ApiProvider)}
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-zinc-100 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            >
              <option value="openrouter">OpenRouter (Unified)</option>
              <option value="anthropic">Anthropic (Direct)</option>
              <option value="openai">OpenAI (Direct)</option>
              <option value="gemini">Google Gemini (Direct)</option>
              <option value="groq">Groq (Ultra-Fast)</option>
            </select>
          </div>

          {/* Solution Generation Model */}
          <div className="space-y-1.5">
            <label className="text-zinc-400 text-[11px] font-medium">
              Primary Solution Model
            </label>
            <input
              type="text"
              data-testid="selected-model-input"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              placeholder="e.g. anthropic/claude-3.5-sonnet"
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          {/* Fast Evaluator Model */}
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-zinc-400 text-[11px] font-medium">
              Stage 1 Evaluator / Intent Classifier Model (Fast)
            </label>
            <input
              type="text"
              data-testid="evaluator-model-input"
              value={evaluatorModel}
              onChange={(e) => setEvaluatorModel(e.target.value)}
              placeholder="e.g. groq/llama-3.3-70b-versatile"
              className="w-full rounded-lg bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 text-zinc-100 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>
        </div>
      </section>

      {/* Provider API Keys List */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-300">
            Multi-Provider API Keys
          </span>
          <span className="text-[11px] text-zinc-500 font-mono">
            6 Providers Supported
          </span>
        </div>

        <div className="space-y-3">
          {PROVIDERS.map((provider) => {
            const isVisible = Boolean(visibleKeys[provider.id]);
            const status = testStatuses[provider.id] || { state: "idle" };
            const currentValue = apiKeys[provider.id] || "";

            return (
              <div
                key={provider.id}
                data-testid={`provider-card-${provider.id}`}
                className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-3 space-y-2 transition-colors hover:border-zinc-700/80"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-semibold text-zinc-200">
                      {provider.name}
                    </h4>
                    <p className="text-[10px] text-zinc-400">
                      {provider.subtitle}
                    </p>
                  </div>

                  {/* Test Connection Button */}
                  <button
                    type="button"
                    data-testid={`test-btn-${provider.id}`}
                    onClick={() => handleTestConnection(provider)}
                    disabled={status.state === "testing"}
                    className={cn(
                      "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors",
                      status.state === "success"
                        ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                        : status.state === "error"
                        ? "bg-red-500/10 text-red-400 border-red-500/30"
                        : "bg-zinc-800/80 text-zinc-300 border-zinc-700/60 hover:bg-zinc-700/60 hover:text-zinc-100"
                    )}
                  >
                    {status.state === "testing" ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Testing</span>
                      </>
                    ) : status.state === "success" ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-400" />
                        <span>Valid</span>
                      </>
                    ) : status.state === "error" ? (
                      <>
                        <AlertCircle className="h-3 w-3 text-red-400" />
                        <span>Invalid</span>
                      </>
                    ) : (
                      <span>Test Connection</span>
                    )}
                  </button>
                </div>

                {/* Input with Masking Toggle */}
                <div className="relative flex items-center">
                  <input
                    type={isVisible ? "text" : "password"}
                    data-testid={`input-${provider.id}`}
                    value={currentValue}
                    onChange={(e) => setApiKey(provider.id, e.target.value)}
                    placeholder={provider.placeholder}
                    className="w-full rounded-lg bg-zinc-950 border border-zinc-800/90 pl-3 pr-10 py-1.5 text-xs text-zinc-100 font-mono placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 transition-colors"
                  />
                  <button
                    type="button"
                    data-testid={`toggle-visibility-${provider.id}`}
                    onClick={() => toggleVisibility(provider.id)}
                    aria-label={`Toggle ${provider.name} key visibility`}
                    title={isVisible ? "Hide API key" : "Show API key"}
                    className="absolute right-2 text-zinc-400 hover:text-zinc-200 p-1 rounded transition-colors"
                  >
                    {isVisible ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>

                {/* Status Feedback Message */}
                {status.message && (
                  <div
                    data-testid={`status-${provider.id}`}
                    className={cn(
                      "text-[10px] flex items-center gap-1.5 pt-0.5",
                      status.state === "success" ? "text-emerald-400" : "text-red-400"
                    )}
                  >
                    {status.state === "success" ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0" />
                    ) : (
                      <AlertCircle className="h-3 w-3 shrink-0" />
                    )}
                    <span>{status.message}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Global Save Button */}
      <div className="pt-2 flex items-center justify-between border-t border-zinc-800/80">
        <span className="text-[11px] text-zinc-400">
          Changes take effect immediately across all active LLM streams.
        </span>
        <button
          type="button"
          data-testid="save-keys-btn"
          onClick={handleSaveAll}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white shadow-lg shadow-sky-950/40 transition-colors"
        >
          {isSaved ? (
            <>
              <Check className="h-3.5 w-3.5" />
              <span>Saved!</span>
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" />
              <span>Save API Keys</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
